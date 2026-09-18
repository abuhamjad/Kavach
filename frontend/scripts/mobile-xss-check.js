// Loads the real mobile.html in jsdom and checks three things:
//   1. the page boots cleanly
//   2. the operator-token gate actually gates — a bad token does not get in
//   3. hostile zone names / alert messages render as inert text
//
// Run: npm run check:mobile-xss
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../../backend/web/mobile.html'), 'utf8');

const PAYLOADS = [
  '<img src=x onerror="window.__PWNED=1">',
  '<script>window.__PWNED=1<\/script>',
  '"><svg onload="window.__PWNED=1">',
];

// Shape-valid token — the page checks the character set before calling the API.
const TOKEN = 'test-token-abcdefghijklmnop';

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.log('jsdom error:', e.message));

const dom = new JSDOM(HTML, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost:8000/mobile',
  virtualConsole: vc,
});

const { window } = dom;
let sockets = [];
window.WebSocket = class {
  constructor(url, protocols) { sockets.push({ url, protocols }); }
  close() {}
};

// Stands in for the backend's /auth/check: accepts exactly one token.
let authResponse = (body, headers) =>
  headers.Authorization === `Bearer ${TOKEN}`
    ? { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
    : { ok: false, status: 401, json: async () => ({}) };

window.fetch = (url, init = {}) =>
  Promise.resolve(authResponse(init.body, init.headers || {}));

const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
const $ = (id) => window.document.getElementById(id);

/** Poll until `predicate` holds. Replaces the old fixed sleeps, which raced the
 *  async auth call and were flaky on a loaded machine. */
function until(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) fail(`timed out waiting for ${label}`);
      setTimeout(poll, 10);
    };
    poll();
  });
}

/** Submit the auth gate with `token`. */
function submitToken(token) {
  $('auth-token').value = token;
  $('auth-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true })
  );
}

const authScreenVisible = () => $('auth-screen').style.display !== 'none';

async function main() {
  // ── Boot ──────────────────────────────────────────────────────────────────
  await until(() => window.__kavach, 'script to finish executing');

  const banner = $('boot-error');
  if (banner && !banner.hidden) fail('page reported an error on load: ' + banner.textContent);

  const api = window.__kavach;

  // No stray globals: the IIFE exists because a top-level `var history` used to
  // collide with the getter-only window.history and abort the whole script.
  ['series', 'state', 'connect', 'tick', 'ingest', 'token'].forEach((name) => {
    if (Object.prototype.hasOwnProperty.call(window, name)) {
      fail('global leaked to window: ' + name);
    }
  });
  console.log('boot clean · no globals leaked');

  // ── The gate must gate ────────────────────────────────────────────────────
  submitToken('short');
  await until(() => !$('auth-error').hidden, 'malformed token to be reported');
  if (!authScreenVisible()) fail('a malformed token dismissed the auth screen');
  if (sockets.length) fail('a malformed token opened a socket');
  console.log('malformed token rejected locally · no socket');

  submitToken('wrong-token-but-well-formed-xyz');
  await until(
    () => /rejected/i.test($('auth-error').textContent),
    'server rejection to be reported'
  );
  if (!authScreenVisible()) fail('a token the server refused dismissed the auth screen');
  if (sockets.length) fail('a refused token opened a socket');
  console.log('server-refused token rejected · no socket');

  // ── The gate must open for a real token ───────────────────────────────────
  submitToken(TOKEN);
  await until(() => !authScreenVisible(), 'the auth screen to dismiss');
  await until(() => sockets.length === 1, 'the telemetry socket to open');

  if (banner && !banner.hidden) fail('authorize raised an error: ' + banner.textContent);

  // The token travels in the subprotocol header, never the URL.
  const [socket] = sockets;
  if (socket.url.includes(TOKEN)) fail('token leaked into the WebSocket URL');
  if (!socket.protocols || socket.protocols[1] !== `kavach-token.${TOKEN}`) {
    fail('socket did not offer the operator token as a subprotocol');
  }
  console.log('valid token accepted · socket opened with token in subprotocol');

  // ── XSS ───────────────────────────────────────────────────────────────────
  PAYLOADS.forEach((payload, i) => {
    api.ingest({
      zones: [{ name: payload, threat: 'HIGH', persons: 1, vehicles: 0 }],
      alerts: [{ time: payload, msg: payload }],
      total_persons: 1, total_vehicles: 0,
      night: false, surge: false,
      modes: { loitering: true, night: true, surge: true },
      setup_done: true,
    });
    api.render();

    if (window.__PWNED) fail(`payload ${i} EXECUTED — still vulnerable`);

    const zoneName = window.document.querySelector('.zone-name');
    if (!zoneName) fail(`payload ${i}: zone row not rendered`);
    if (zoneName.textContent !== payload) {
      fail(`payload ${i}: expected literal text, got ${JSON.stringify(zoneName.textContent)}`);
    }
    if (zoneName.querySelector('img, svg, script')) {
      fail(`payload ${i}: payload parsed into live DOM nodes`);
    }
    console.log(`payload ${i + 1} neutralised -> text, ${zoneName.childElementCount} child elements`);
  });

  api.switchTab('alerts');
  const msg = window.document.querySelector('.alert-msg');
  if (!msg) fail('alert row not rendered');
  if (msg.querySelector('img, svg, script')) fail('alert message parsed into DOM nodes');
  if (window.__PWNED) fail('payload executed at some point');

  console.log('\nPASS — boots clean, gate holds, no payload executed.');
  process.exit(0);
}

const watchdog = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 30000);
watchdog.unref?.();

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
