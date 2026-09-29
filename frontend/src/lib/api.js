// ─────────────────────────────────────────────────────────────────────────────
//  Backend transport.
//
//  Override at build time with REACT_APP_API_URL / REACT_APP_WS_URL when the
//  API is deployed separately (e.g. on Render) while the frontend is on Vercel.
// ─────────────────────────────────────────────────────────────────────────────

const DEV_API_PORT = '8000';

function resolveHttpOrigin() {
  const configured = process.env.REACT_APP_API_URL;
  if (configured) return configured.replace(/\/+$/, '');

  const { protocol, hostname, port } = window.location;
  const apiPort = port === '3000' ? DEV_API_PORT : port;
  return `${protocol}//${hostname}${apiPort ? `:${apiPort}` : ''}`;
}

export const API_ORIGIN = resolveHttpOrigin();

export const WS_URL = process.env.REACT_APP_WS_URL || `${API_ORIGIN.replace(/^http/, 'ws')}/ws`;

// ─────────────────────────────────────────────────────────────────────────────
//  Operator token — removed for deployed access.
// ─────────────────────────────────────────────────────────────────────────────

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
 */
export async function post(endpoint, body, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';

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
    throw new ApiError(`${endpoint} — server returned ${res.status}`, { status: res.status, endpoint });
  }

  return res.json().catch(() => ({}));
}

export const addZone = (name, points) => post('/add_zone', { name, points });
export const addTripwire = (name, p1, p2) => post('/add_tripwire', { name, p1, p2 });
export const startDetection = () => post('/start_detection');
export const stopDetection = () => post('/stop_detection');
export const setMode = (mode, value) => post('/set_mode', { mode, value });
export const clearZones = () => post('/clear_zones');
export const removeShape = (kind, name) => post('/remove_shape', { kind, name });
