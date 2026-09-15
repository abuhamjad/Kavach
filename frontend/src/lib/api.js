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
export async function post(endpoint, body, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${API_ORIGIN}${endpoint}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
    throw new ApiError(`${endpoint} — server returned ${res.status}`, {
      status: res.status,
      endpoint,
    });
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
