// Loads the real mobile.html in jsdom and checks two things:
//   1. the page boots cleanly and the AUTHORIZE button works
//   2. hostile zone names / alert messages render as inert text
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

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.log('jsdom error:', e.message));

const dom = new JSDOM(HTML, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost:8000/mobile',
  virtualConsole: vc,
});

const { window } = dom;
let sockets = 0;
window.WebSocket = class {
  constructor(url) { sockets++; this.url = url; }
  close() {}
};
window.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });

const fail = (m) => { console.log('FAIL:', m); process.exit(1); };

setTimeout(() => {
  // ── Boot ────────────────────────────────────────────────────────────────
  const banner = window.document.getElementById('boot-error');
  if (banner && !banner.hidden) fail('page reported an error on load: ' + banner.textContent);

  const api = window.__kavach;
  if (!api) fail('script did not finish executing (window.__kavach missing)');

  // No stray globals: the IIFE exists because a top-level `var history` used to
  // collide with the getter-only window.history and abort the whole script.
  ['series', 'state', 'connect', 'tick', 'ingest'].forEach((name) => {
    if (Object.prototype.hasOwnProperty.call(window, name)) {
      fail('global leaked to window: ' + name);
    }
  });
  console.log('boot clean · no globals leaked');

  window.document.getElementById('auth-btn').click();
  if (window.document.getElementById('auth-screen').style.display !== 'none') {
    fail('AUTHORIZE did not dismiss the auth screen');
  }
  if (sockets !== 1) fail('expected 1 socket after authorize, got ' + sockets);
  if (banner && !banner.hidden) fail('authorize raised an error: ' + banner.textContent);
  console.log('authorize works · socket opened');

  // ── XSS ─────────────────────────────────────────────────────────────────
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

  console.log('\nPASS — boots clean, authorize works, no payload executed.');
  process.exit(0);
}, 600);

setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 20000);
