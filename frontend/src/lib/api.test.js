// ─────────────────────────────────────────────────────────────────────────────
//  Operator token handling.
//
//  api.js reads the token once, at module load, from the URL fragment or
//  sessionStorage. Every test therefore has to arrange the environment *before*
//  requiring the module, which is what the isolate() helper below is for — a
//  plain top-level import would bind whatever the first test happened to set.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = 'abcdefghijklmnopqrstuvwx';
const OTHER_TOKEN = 'zyxwvutsrqponmlkjihgfed';

/** Load a fresh copy of api.js against the current window/storage state. */
function isolate() {
  let api;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    api = require('./api');
  });
  return api;
}

function setHash(hash) {
  window.history.replaceState(null, '', `/${hash}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
  setHash('');
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

const okResponse = () => ({ ok: true, status: 200, json: async () => ({ status: 'ok' }) });
const denied = () => ({ ok: false, status: 401, json: async () => ({}) });

describe('token acquisition', () => {
  test('starts with no token when none was supplied', () => {
    const api = isolate();
    expect(api.hasToken()).toBe(false);
    expect(api.getToken()).toBe('');
  });

  test('consumes a token from the URL fragment', () => {
    setHash(`#token=${TOKEN}`);
    const api = isolate();
    expect(api.getToken()).toBe(TOKEN);
  });

  test('strips the token from the address bar so it cannot leak or be shoulder-read', () => {
    setHash(`#token=${TOKEN}`);
    isolate();
    expect(window.location.hash).toBe('');
  });

  test('preserves any other fragment content while removing the token', () => {
    setHash(`#panel=alerts&token=${TOKEN}`);
    const api = isolate();
    expect(api.getToken()).toBe(TOKEN);
    expect(window.location.hash).toBe('#panel=alerts');
  });

  test('falls back to the stored token when the URL carries none', () => {
    window.sessionStorage.setItem('kavach.token', TOKEN);
    expect(isolate().getToken()).toBe(TOKEN);
  });

  test('a token in the URL wins over a stale stored one', () => {
    window.sessionStorage.setItem('kavach.token', OTHER_TOKEN);
    setHash(`#token=${TOKEN}`);
    expect(isolate().getToken()).toBe(TOKEN);
  });

  test('persists the token for the tab, not the browser profile', () => {
    setHash(`#token=${TOKEN}`);
    isolate();
    expect(window.sessionStorage.getItem('kavach.token')).toBe(TOKEN);
    expect(window.localStorage.getItem('kavach.token')).toBeNull();
  });
});

describe('token shape', () => {
  test('accepts what the backend generates', () => {
    const { isWellFormedToken } = isolate();
    expect(isWellFormedToken(TOKEN)).toBe(true);
    expect(isWellFormedToken('AZaz09._~-AZaz09._~-')).toBe(true);
  });

  test('rejects values the backend could never have issued', () => {
    const { isWellFormedToken } = isolate();
    expect(isWellFormedToken('')).toBe(false);
    expect(isWellFormedToken('short')).toBe(false);
    expect(isWellFormedToken('has spaces in it here')).toBe(false);
    expect(isWellFormedToken('has/slashes/and:colons!!')).toBe(false);
  });
});

describe('request authorisation', () => {
  test('attaches the token as a bearer header', async () => {
    setHash(`#token=${TOKEN}`);
    const api = isolate();
    global.fetch.mockResolvedValue(okResponse());

    await api.startDetection();

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test('sends no Authorization header when there is no token', async () => {
    const api = isolate();
    global.fetch.mockResolvedValue(okResponse());

    await api.startDetection();

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  test('does not put the token in the URL, where logs and Referer would catch it', async () => {
    setHash(`#token=${TOKEN}`);
    const api = isolate();
    global.fetch.mockResolvedValue(okResponse());

    await api.setMode('night', true);

    const [url] = global.fetch.mock.calls[0];
    expect(url).not.toContain(TOKEN);
  });

  test('reports a rejected token distinctly from a generic failure', async () => {
    setHash(`#token=${TOKEN}`);
    const api = isolate();
    global.fetch.mockResolvedValue(denied());

    await expect(api.stopDetection()).rejects.toThrow(/operator token/i);
  });
});

describe('socket handshake', () => {
  test('offers the token as a subprotocol', () => {
    setHash(`#token=${TOKEN}`);
    const api = isolate();
    expect(api.wsProtocols()).toEqual(['kavach.v1', `kavach-token.${TOKEN}`]);
  });

  test('offers the bare protocol when unauthenticated', () => {
    const api = isolate();
    expect(api.wsProtocols()).toEqual(['kavach.v1']);
  });
});

describe('rejection', () => {
  test('a 401 discards the token and announces it', async () => {
    setHash(`#token=${TOKEN}`);
    const api = isolate();
    const onRejected = jest.fn();
    api.onTokenRejected(onRejected);
    global.fetch.mockResolvedValue(denied());

    await expect(api.stopDetection()).rejects.toThrow();

    expect(api.hasToken()).toBe(false);
    expect(window.sessionStorage.getItem('kavach.token')).toBeNull();
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  test('a failed token *check* leaves the working token intact', async () => {
    // Otherwise mistyping a token in the gate would log out a console that was
    // already authorised.
    setHash(`#token=${TOKEN}`);
    const api = isolate();
    const onRejected = jest.fn();
    api.onTokenRejected(onRejected);
    global.fetch.mockResolvedValue(denied());

    await expect(api.checkToken(OTHER_TOKEN)).rejects.toThrow();

    expect(api.getToken()).toBe(TOKEN);
    expect(onRejected).not.toHaveBeenCalled();
  });

  test('a successful check does not disturb the current token', async () => {
    setHash(`#token=${TOKEN}`);
    const api = isolate();
    global.fetch.mockResolvedValue(okResponse());

    await expect(api.checkToken(OTHER_TOKEN)).resolves.toBe(true);

    expect(api.getToken()).toBe(TOKEN);
  });

  test('unsubscribing stops delivery', async () => {
    setHash(`#token=${TOKEN}`);
    const api = isolate();
    const onRejected = jest.fn();
    api.onTokenRejected(onRejected)();      // subscribe, then immediately unsubscribe
    global.fetch.mockResolvedValue(denied());

    await expect(api.stopDetection()).rejects.toThrow();

    expect(onRejected).not.toHaveBeenCalled();
  });
});
