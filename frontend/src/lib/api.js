// ─────────────────────────────────────────────────────────────────────────────
//  Backend transport.
//
//  Origins are derived from window.location so the console works from any device
//  on the LAN and survives being served over TLS. Override at build time with
//  REACT_APP_API_ORIGIN (e.g. "https://kavach.local:8443") when the API is not
//  co-hosted with the bundle.
// ─────────────────────────────────────────────────────────────────────────────

// run.py serves the React build from the same origin as the API, so same-origin
// is the correct default. The :3000 case is `npm start`, where CRA's dev server
// holds port 3000 and the backend is on 8000.
const DEV_API_PORT = '8000';

function resolveHttpOrigin() {
  const configured = process.env.REACT_APP_API_ORIGIN;
  if (configured) return configured.replace(/\/+$/, '');

  const { protocol, hostname, port } = window.location;
  const apiPort = port === '3000' ? DEV_API_PORT : port;
  return `${protocol}//${hostname}${apiPort ? `:${apiPort}` : ''}`;
}

export const API_ORIGIN = resolveHttpOrigin();

// ws: for http:, wss: for https: — a hardcoded ws:// is blocked as mixed content
// on a TLS-served page.
export const WS_URL = `${API_ORIGIN.replace(/^http/, 'ws')}/ws`;

// ─────────────────────────────────────────────────────────────────────────────
//  Operator token.
//
//  The backend requires a shared token on every control endpoint and on the
//  telemetry socket. run.py prints it and opens the console with it in the URL
//  fragment — fragments are never sent to the server, so it stays out of access
//  logs. We consume it once, keep it in sessionStorage (per-tab, cleared when
//  the tab closes), and strip it from the address bar.
//
//  It is deliberately NOT a cookie: browsers attach cookies to cross-site
//  requests, so a cookie session would still be forgeable from a hostile page.
//  A header cannot be set cross-origin without a preflight the server refuses.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_KEY = 'kavach.token';

// Must match config.WS_TOKEN_PREFIX / config.WS_PROTOCOL in backend/app/config.py.
const WS_PROTOCOL = 'kavach.v1';
const WS_TOKEN_PREFIX = 'kavach-token.';

/** Token character set accepted by the backend (it becomes a WS subprotocol). */
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{16,}$/;

let token = '';

function readStoredToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return ''; // Private mode / storage disabled — fall back to in-memory only.
  }
}

/** Pull `#token=…` out of the URL, if run.py put it there, and clean up. */
function consumeTokenFromHash() {
  const hash = window.location.hash || '';
  const match = /[#&]token=([^&]+)/.exec(hash);
  if (!match) return '';

  const found = decodeURIComponent(match[1]);
  const rest = hash.replace(/[#&]token=[^&]+/, '').replace(/^[#&]/, '');
  // replaceState, not location.hash = '': no navigation, no history entry, and
  // the token never lingers where a screenshot or a Referer could carry it.
  window.history.replaceState(null, '', window.location.pathname + window.location.search + (rest ? `#${rest}` : ''));
  return found;
}

export const isWellFormedToken = (value) => TOKEN_PATTERN.test((value || '').trim());

export function getToken() {
  return token;
}

export function hasToken() {
  return Boolean(token);
}

/** Persist a token for this tab. Pass '' to forget it. */
export function setToken(value) {
  token = (value || '').trim();
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* in-memory only */
  }
  return token;
}

setToken(consumeTokenFromHash() || readStoredToken());

/** Subprotocols for `new WebSocket(url, protocols)` — carries the token. */
export function wsProtocols() {
  return token ? [WS_PROTOCOL, `${WS_TOKEN_PREFIX}${token}`] : [WS_PROTOCOL];
}

// A token can be refused in two unrelated places — an HTTP 401 and a socket
// handshake closed with 1008 — and both mean the same thing: this console is no
// longer authorized. Routing both through the token's owner keeps the app from
// retrying a credential the server has already refused, which would otherwise
// be an endless reconnect loop.
const TOKEN_REJECTED = 'kavach:token-rejected';

/** Forget the token and tell the app to re-prompt. */
export function rejectToken() {
  if (!token) return;
  setToken('');
  window.dispatchEvent(new Event(TOKEN_REJECTED));
}

/** Subscribe to rejection. Returns an unsubscribe function. */
export function onTokenRejected(handler) {
  window.addEventListener(TOKEN_REJECTED, handler);
  return () => window.removeEventListener(TOKEN_REJECTED, handler);
}

/** Verify a token against the backend without committing it. */
export async function checkToken(candidate) {
  const previous = token;
  token = (candidate || '').trim();
  try {
    await post('/auth/check', undefined, { signalRejection: false });
    return true;
  } finally {
    token = previous;
  }
}

/** Thrown for any non-2xx response or transport failure. */
export class ApiError extends Error {
  constructor(message, { status = 0, endpoint = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

/**
 * POST JSON to the backend.
 *
 * Rejects on transport failure AND on non-2xx. Callers must await this before
 * reflecting the change in local state — otherwise the console shows a zone or
 * a running detector that the backend never accepted.
 */
export async function post(endpoint, body, { timeoutMs = 8000, signalRejection = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_ORIGIN}${endpoint}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (cause) {
    const reason =
      cause?.name === 'AbortError'
        ? `timed out after ${timeoutMs}ms`
        : 'could not reach the detection server';
    throw new ApiError(`${endpoint} — ${reason}`, { endpoint });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const unauthorized = res.status === 401 || res.status === 403;
    // Not for /auth/check, which is *testing* a candidate — a failure there
    // must not discard the token the console is currently running on.
    if (unauthorized && signalRejection) rejectToken();

    const reason = unauthorized
      ? 'rejected — the operator token is missing, wrong, or expired'
      : `server returned ${res.status}`;
    throw new ApiError(`${endpoint} — ${reason}`, { status: res.status, endpoint });
  }

  // Endpoints return {"status":"ok"}; tolerate an empty body rather than throwing
  // a parse error on what was a successful call.
  return res.json().catch(() => ({}));
}

export const addZone = (name, points) => post('/add_zone', { name, points });
export const addTripwire = (name, p1, p2) => post('/add_tripwire', { name, p1, p2 });
export const startDetection = () => post('/start_detection');
export const stopDetection = () => post('/stop_detection');
export const setMode = (mode, value) => post('/set_mode', { mode, value });
