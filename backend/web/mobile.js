(function () {
'use strict';
// Scoped in an IIFE so no top-level declaration can collide with a Window
// property. A bare top-level  wrote to window.history — a
// getter-only accessor — which threw under strict mode and killed the whole
// script before any listener was bound: the page rendered but every control
// was dead. Scoping removes the entire class of bug.

// Installed before anything else can throw: a phone has no console to open, so
// an uncaught error has to put itself on screen or the page just looks broken.
function reportFatal(message) {
  var box = document.getElementById('boot-error');
  if (!box) return;
  box.textContent = 'Interface error — ' + message;
  box.hidden = false;
}
window.onerror = function (msg, src, line) {
  reportFatal(msg + ' (line ' + line + ')');
};

// ═══════════════════════════════════════════════════════════════════════════
//  Kavach mobile client.
//
//  Rewritten to fix, in order of severity:
//
//  1. STORED XSS. Zone names and alert messages were interpolated into
//     innerHTML. Zone names come from /add_zone — then unauthenticated, so any
//     device on the LAN could POST a zone named `<img src=x onerror=...>` and
//     get script execution in the operator's browser. That endpoint now
//     requires the operator token, but the sink is fixed regardless: everything
//     user- or backend-supplied is written with textContent. Defence in depth —
//     an authenticated operator can still fat-finger a name with markup in it.
//  2. Two dead features (change_source -> HTTP 405, current_source never sent).
//  3. Full DOM rebuild at 20Hz over an uncapped alert list.
//  4. A chart with three different scales in one frame.
// ═══════════════════════════════════════════════════════════════════════════

// Derived from location, so the page works behind a proxy, on a non-8000 port,
// and over TLS (ws:// on an https:// page is blocked as mixed content).
var ORIGIN   = location.origin;
var WS_URL   = ORIGIN.replace(/^http/, 'ws') + '/ws';

// ── Operator token ─────────────────────────────────────────────────────────
//
// The backend rejects every control endpoint and the telemetry socket without
// the shared token run.py prints at startup. run.py's mobile URL carries it in
// the fragment — fragments are never sent to the server, so it stays out of
// access logs — and we strip it from the address bar once consumed.
//
// Not a cookie, deliberately: browsers attach cookies to cross-site requests,
// so a cookie session would still be forgeable by a hostile page. A custom
// header cannot be set cross-origin without a preflight the server refuses.
var TOKEN_KEY = 'kavach.token';
// Must match config.WS_PROTOCOL / config.WS_TOKEN_PREFIX in backend/app/config.py.
var WS_PROTOCOL = 'kavach.v1';
var WS_TOKEN_PREFIX = 'kavach-token.';
var TOKEN_PATTERN = /^[A-Za-z0-9._~-]{16,}$/;

var token = '';

function storedToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  catch (e) { return ''; }   // private mode / storage blocked — memory only
}

function rememberToken(value) {
  token = (value || '').replace(/^\s+|\s+$/g, '');
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
  return token;
}

function tokenFromHash() {
  var hash = location.hash || '';
  var m = /[#&]token=([^&]+)/.exec(hash);
  if (!m) return '';
  var found = decodeURIComponent(m[1]);
  var rest = hash.replace(/[#&]token=[^&]+/, '').replace(/^[#&]/, '');
  // replaceState leaves no history entry and no navigation, so the token cannot
  // linger in the address bar or ride out in a Referer.
  if (history.replaceState) {
    history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
  }
  return found;
}

rememberToken(tokenFromHash() || storedToken());

var MAX_ALERTS_RENDERED = 100;
var MAX_TOASTS = 3;
var RENDER_HZ = 5;
var RECONNECT_BASE = 1000, RECONNECT_MAX = 15000;
var THREAT_ORDER = ['LOW', 'MEDIUM', 'HIGH'];

var MODES = [
  { key: 'loitering', name: 'Loiter detection', desc: 'Flag persons staying too long' },
  { key: 'night',     name: 'Night vision',     desc: 'Auto-engage on low light' },
  { key: 'surge',     name: 'Surge detection',  desc: 'Detect sudden crowd increases' }
];

var state = {
  zones: [], alerts: [], persons: 0, vehicles: 0,
  surge: false, night: false,
  modes: { loitering: true, night: true, surge: true },
  threat: 'LOW', setupDone: false
};

var authorized = false, soundOn = true, audioCtx = null;
var prevAlertId = 0, totalAlerts = 0, lastHighThreat = false;
var activeRange = 'realtime';
var series = { realtime: [], perSec: [], per10s: [] };
var secBucket = [], tenBucket = [], lastSecT = 0, lastTenT = 0;
var pending = null, renderTimer = null;

var $ = function (id) { return document.getElementById(id); };

function threatScore(level) {
  var i = THREAT_ORDER.indexOf(level);
  return i === -1 ? 1 : i + 1;
}
function scoreToThreat(score) {
  return THREAT_ORDER[Math.min(3, Math.max(1, Math.round(score))) - 1];
}
function badgeWord(t) {
  return t === 'HIGH' ? 'CRITICAL' : t === 'MEDIUM' ? 'ELEVATED' : 'NOMINAL';
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ── Audio / haptics ────────────────────────────────────────────────────────
function beep(critical) {
  if (!audioCtx || !soundOn) return;
  var freqs = critical ? [880, 1100, 880, 1100] : [660, 880];
  var dur = critical ? 0.12 : 0.1;
  var t0 = audioCtx.currentTime;
  freqs.forEach(function (f, i) {
    var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = f; osc.type = 'square';
    gain.gain.setValueAtTime(0.08, t0 + i * dur);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * dur + dur * 0.9);
    osc.start(t0 + i * dur); osc.stop(t0 + i * dur + dur);
  });
}

function highThreatTone() {
  if (!audioCtx || !soundOn) return;
  var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.frequency.setValueAtTime(440, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.5);
  osc.type = 'sawtooth';
  gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
  osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.6);
}

function buzz(pattern) {
  if (navigator.vibrate && soundOn) { try { navigator.vibrate(pattern); } catch (e) {} }
}

// ── Toasts (textContent only) ──────────────────────────────────────────────
var ICON_WARN = 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z';

function showToast(msg, time, critical) {
  var container = $('toast-container');
  while (container.children.length >= MAX_TOASTS) container.removeChild(container.firstChild);

  var el = document.createElement('div');
  el.className = 'toast' + (critical ? ' critical' : '');

  var icon = document.createElement('div');
  icon.className = 'toast-icon';
  icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="' + ICON_WARN + '"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

  var body = document.createElement('div');
  body.className = 'toast-body';
  var title = document.createElement('div');
  title.className = 'toast-title';
  title.textContent = msg;                 // ← never innerHTML
  var stamp = document.createElement('div');
  stamp.className = 'toast-time';
  stamp.textContent = time;                // ← never innerHTML
  body.appendChild(title); body.appendChild(stamp);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toast-silence';
  btn.textContent = 'SILENCE';

  var remove = function () {
    el.classList.remove('show');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
  };
  btn.addEventListener('click', remove);

  el.appendChild(icon); el.appendChild(body); el.appendChild(btn);
  container.appendChild(el);
  requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('show'); }); });
  setTimeout(remove, 5000);
}

// ── Transport ──────────────────────────────────────────────────────────────
function showError(msg) {
  $('error-text').textContent = msg;
  $('error-banner').hidden = false;
}

function post(path, body) {
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(ORIGIN + path, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  }).then(function (r) {
    if (!r.ok) {
      var err = new Error(
        r.status === 401 || r.status === 403
          ? path + ' rejected — operator token missing, wrong, or expired'
          : path + ' returned ' + r.status
      );
      err.status = r.status;
      throw err;
    }
    return r.json().catch(function () { return {}; });
  });
}

var ws = null, reconnectTimer = null, attempt = 0;

function setLive(on) {
  $('live-dot').classList.toggle('on', on);
  $('live-label').classList.toggle('on', on);
  $('live-label').textContent = on ? 'LIVE' : 'OFFLINE';
  $('cfg-conn').textContent = on ? 'Connected' : 'Offline';
  $('cfg-server').textContent = location.host;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  var delay = Math.min(RECONNECT_BASE * Math.pow(2, attempt), RECONNECT_MAX);
  attempt++;
  reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(); }, delay);
}

function connect() {
  // The token rides in the subprotocol list — the WebSocket API cannot set
  // headers, and the server closes the handshake without it.
  // This page shows telemetry only, so it opts out of the video frames.
  // Must match config.WS_TELEMETRY_ONLY in backend/app/config.py.
  var protocols = [WS_PROTOCOL, 'kavach.telemetry-only'];
  if (token) protocols.push(WS_TOKEN_PREFIX + token);
  try { ws = new WebSocket(WS_URL, protocols); }
  catch (e) { scheduleReconnect(); return; }

  ws.onopen = function () { attempt = 0; setLive(true); };
  ws.onerror = function () { try { ws.close(); } catch (e) {} };
  ws.onclose = function (event) {
    setLive(false);
    // 1008 (policy violation) is the server refusing the handshake — bad or
    // missing token. Redialling with the same credential loops forever, so
    // forget it and say so instead.
    if (event && event.code === 1008) {
      rememberToken('');
      showError('Link refused: operator token rejected. Reload and enter the current token.');
      return;
    }
    scheduleReconnect();
  };

  ws.onmessage = function (event) {
    var d;
    try { d = JSON.parse(event.data); }
    catch (e) { return; }              // drop the bad frame, keep the stream
    if (!d || typeof d !== 'object') return;
    ingest(d);
  };
}

function ingest(d) {
  if (Array.isArray(d.zones)) state.zones = d.zones;
  if (Array.isArray(d.alerts)) state.alerts = d.alerts;
  if (typeof d.total_persons === 'number') state.persons = d.total_persons;
  if (typeof d.total_vehicles === 'number') state.vehicles = d.total_vehicles;
  if (typeof d.surge === 'boolean') state.surge = d.surge;
  if (typeof d.night === 'boolean') state.night = d.night;
  if (d.modes && typeof d.modes === 'object') state.modes = d.modes;
  if (typeof d.setup_done === 'boolean') state.setupDone = d.setup_done;

  state.threat = state.zones.reduce(function (max, z) {
    return Math.max(max, threatScore(z && z.threat));
  }, 1);
  state.threat = scoreToThreat(state.threat);

  // Keyed on the server's monotonic alert id, not on the list getting longer.
  // The server's log is a fixed-size ring: once it saturates the length stops
  // changing, and a length-based offset means every later alert goes unnoticed
  // — no toast, no beep, for the rest of the shift. A lower id than we have
  // seen means the server restarted, so the offset resets.
  var newestId = state.alerts.length ? (state.alerts[state.alerts.length - 1].id || 0) : 0;
  if (newestId < prevAlertId) prevAlertId = 0;

  var fresh = state.alerts.filter(function (a) { return (a.id || 0) > prevAlertId; });
  if (fresh.length && authorized) {
    fresh.slice(-MAX_TOASTS).forEach(function (a) {
      var critical = state.threat === 'HIGH' || /suspicious|intrusion|breach|high/i.test(a.msg || '');
      showToast(a.msg || '', a.time || '', critical);
      beep(critical);
    });
    buzz([100, 50, 100]);
    totalAlerts += fresh.length;
  }
  prevAlertId = Math.max(prevAlertId, newestId);

  if (state.threat === 'HIGH' && !lastHighThreat && authorized) {
    highThreatTone();
    buzz([200, 100, 200, 100, 400]);
  }
  lastHighThreat = state.threat === 'HIGH';

  var sample = {
    persons: state.persons, vehicles: state.vehicles,
    threat: threatScore(state.threat), alerted: fresh.length > 0
  };
  secBucket.push(sample); tenBucket.push(sample);
  pending = true;
}

// ── Render loop (throttled) ────────────────────────────────────────────────
function avg(rows, key) {
  return rows.length ? rows.reduce(function (s, r) { return s + r[key]; }, 0) / rows.length : 0;
}
function collapse(rows) {
  return {
    persons: avg(rows, 'persons'),
    vehicles: avg(rows, 'vehicles'),
    threat: Math.max.apply(null, rows.map(function (r) { return r.threat; })),
    alerted: rows.some(function (r) { return r.alerted; })
  };
}

function tick() {
  var now = Date.now();
  if (!lastSecT) lastSecT = now;
  if (!lastTenT) lastTenT = now;

  if (pending) {
    series.realtime.push({
      persons: state.persons, vehicles: state.vehicles,
      threat: threatScore(state.threat),
      alerted: secBucket.some(function (s) { return s.alerted; })
    });
    if (series.realtime.length > 60) series.realtime.shift();
  }

  if (now - lastSecT >= 1000 && secBucket.length) {
    series.perSec.push(collapse(secBucket));
    if (series.perSec.length > 60) series.perSec.shift();
    secBucket = []; lastSecT = now;
  }
  if (now - lastTenT >= 10000 && tenBucket.length) {
    series.per10s.push(collapse(tenBucket));
    if (series.per10s.length > 30) series.per10s.shift();
    tenBucket = []; lastTenT = now;
  }

  if (pending) {
    pending = false;
    $('cfg-update').textContent = new Date().toLocaleTimeString();
    $('cfg-total').textContent = String(totalAlerts);
    render();
  }
}

var lastSig = { zones: '', alerts: '' };

function render() {
  var t = state.threat;

  $('threat-card').className = 'card ' + t;
  var tv = $('threat-value');
  tv.className = t; tv.textContent = t;
  $('threat-timestamp').textContent = new Date().toLocaleTimeString();
  var tb = $('threat-badge');
  tb.className = 'threat-badge ' + t; tb.textContent = badgeWord(t);
  var ob = $('overall-badge');
  ob.className = 'zone-badge ' + t; ob.textContent = badgeWord(t);

  $('s-persons').textContent = String(state.persons);
  $('s-vehicles').textContent = String(state.vehicles);
  $('s-zones').textContent = String(state.zones.length);
  $('s-alerts').textContent = String(state.alerts.length);

  setCondition('surge', state.surge);
  setCondition('night', state.night);

  MODES.forEach(function (m) {
    var el = $('tog-' + m.key);
    if (el && !el.disabled) el.setAttribute('aria-checked', String(!!state.modes[m.key]));
  });

  var nb = $('alert-nav-badge');
  if (state.alerts.length) { nb.textContent = String(state.alerts.length); nb.classList.add('show'); }
  else nb.classList.remove('show');
  $('alert-count-label').textContent = state.alerts.length ? state.alerts.length + ' events' : '';

  // Rebuild lists only when they actually changed — the old code re-created
  // every zone and alert node on every socket message (20Hz).
  var zSig = state.zones.map(function (z) { return z.name + z.threat + z.persons + z.vehicles; }).join('|');
  if (zSig !== lastSig.zones) { lastSig.zones = zSig; renderZones(); }

  // Keyed on the newest id, not the timestamp: alert times have one-second
  // resolution, so two alerts in the same second produced an identical
  // signature and the second one never rendered.
  var aSig = state.alerts.length + ':' + (state.alerts.length ? (state.alerts[state.alerts.length - 1].id || 0) : 0);
  if (aSig !== lastSig.alerts) { lastSig.alerts = aSig; renderAlerts(); }

  drawCharts();
}

function setCondition(key, active) {
  $('cond-' + key + '-dot').className = 'cond-indicator' + (active ? ' active' : '');
  var s = $('cond-' + key + '-status');
  s.className = 'cond-status' + (active ? ' active' : '');
  s.textContent = active ? 'ACTIVE' : 'CLEAR';
}

function renderZones() {
  var list = $('zones-list');
  list.textContent = '';
  if (!state.zones.length) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No zones defined';
    list.appendChild(empty);
    return;
  }
  state.zones.forEach(function (z) {
    var threat = THREAT_ORDER.indexOf(z.threat) === -1 ? 'LOW' : z.threat;
    var row = document.createElement('div');
    row.className = 'zone-row';

    var left = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'zone-name';
    name.textContent = z.name;                       // ← was an XSS sink
    var detail = document.createElement('div');
    detail.className = 'zone-detail';
    detail.textContent = (z.persons || 0) + ' persons · ' + (z.vehicles || 0) + ' vehicles';
    left.appendChild(name); left.appendChild(detail);

    var badge = document.createElement('span');
    badge.className = 'zone-badge ' + threat;
    badge.textContent = threat;

    row.appendChild(left); row.appendChild(badge);
    list.appendChild(row);
  });
}

function renderAlerts() {
  var list = $('alerts-list');
  list.textContent = '';
  if (!state.alerts.length) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No events recorded';
    list.appendChild(empty);
    return;
  }

  var recent = state.alerts.slice(-MAX_ALERTS_RENDERED).reverse();
  recent.forEach(function (a) {
    var msg = a.msg || '';
    var critical = /suspicious|intrusion|breach|high/i.test(msg);

    var row = document.createElement('div');
    row.className = 'alert-row';

    var icon = document.createElement('div');
    icon.className = 'alert-icon' + (critical ? ' critical' : '');
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="' + ICON_WARN + '"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

    var body = document.createElement('div');
    body.className = 'alert-row-body';

    var timeRow = document.createElement('div');
    timeRow.className = 'alert-time-row';
    var time = document.createElement('span');
    time.className = 'alert-time-text';
    time.textContent = a.time || '';                 // ← was an XSS sink
    var sev = document.createElement('span');
    sev.className = 'alert-severity ' + (critical ? 'CRITICAL' : 'WARNING');
    sev.textContent = critical ? 'CRITICAL' : 'WARNING';
    timeRow.appendChild(time); timeRow.appendChild(sev);

    var text = document.createElement('div');
    text.className = 'alert-msg';
    text.textContent = msg;                          // ← was an XSS sink

    body.appendChild(timeRow); body.appendChild(text);
    row.appendChild(icon); row.appendChild(body);
    list.appendChild(row);
  });
}

// ── Charts ─────────────────────────────────────────────────────────────────
function prepCanvas(canvas, height) {
  if (!canvas.offsetParent) return null;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = canvas.offsetWidth;
  if (!w) return null;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.height = height + 'px';
  var ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, height);
  return { ctx: ctx, w: w, h: height };
}

function drawCharts() {
  var data = series[activeRange] || [];
  drawCounts(data);
  drawThreat(data);
}

function drawCounts(data) {
  var c = prepCanvas($('chart-counts'), 120);
  if (!c) return;
  var ctx = c.ctx, W = c.w, H = c.h;
  var pad = { t: 10, r: 8, b: 16, l: 30 };
  var cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;

  if (data.length < 2) { emptyChart(ctx, W, H); return; }

  // ONE shared scale for both series. The old chart normalised persons and
  // vehicles to separate maxima, so two lines at the same height meant
  // completely different counts.
  var peak = Math.max(1, data.reduce(function (m, d) {
    return Math.max(m, d.persons, d.vehicles);
  }, 0));
  var top = Math.max(4, Math.ceil(peak * 1.15));

  ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
  ctx.fillStyle = cssVar('--text-tertiary');
  ctx.font = '9px -apple-system,system-ui,sans-serif';
  ctx.textAlign = 'right';
  [0, 0.5, 1].forEach(function (f) {
    var y = pad.t + ch * (1 - f);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
    ctx.fillText(String(Math.round(top * f)), pad.l - 5, y + 3);
  });

  [['vehicles', cssVar('--series-vehicles')], ['persons', cssVar('--series-persons')]]
    .forEach(function (pair) {
      var key = pair[0], color = pair[1];
      var pts = data.map(function (d, i) {
        return {
          x: pad.l + (i / (data.length - 1)) * cw,
          y: pad.t + ch * (1 - Math.min(1, (d[key] || 0) / top))
        };
      });
      ctx.beginPath();
      pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    });
}

function drawThreat(data) {
  var c = prepCanvas($('chart-threat'), 74);
  if (!c) return;
  var ctx = c.ctx, W = c.w, H = c.h;
  var pad = { t: 10, r: 8, b: 14, l: 30 };
  var cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;

  if (data.length < 2) { emptyChart(ctx, W, H); return; }

  ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
  ctx.fillStyle = cssVar('--text-tertiary');
  ctx.font = '9px -apple-system,system-ui,sans-serif';
  ctx.textAlign = 'right';
  ['LOW', 'MED', 'HIGH'].forEach(function (label, i) {
    var y = pad.t + ch * (1 - i / 2);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
    ctx.fillText(label, pad.l - 5, y + 3);
  });

  var pts = data.map(function (d, i) {
    return {
      x: pad.l + (i / (data.length - 1)) * cw,
      y: pad.t + ch * (1 - (Math.min(3, Math.max(1, d.threat)) - 1) / 2),
      alerted: d.alerted
    };
  });

  ctx.beginPath();
  pts.forEach(function (p, i) {
    if (!i) { ctx.moveTo(p.x, p.y); return; }
    ctx.lineTo(p.x, pts[i - 1].y);   // stepAfter: threat is ordinal, not continuous
    ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = cssVar('--threat-med'); ctx.lineWidth = 2; ctx.stroke();

  // Markers only where an alert fired, with a surface ring so they read
  // against the line.
  pts.forEach(function (p) {
    if (!p.alerted) return;
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = cssVar('--card'); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = cssVar('--threat-high'); ctx.fill();
  });
}

function emptyChart(ctx, W, H) {
  ctx.fillStyle = cssVar('--text-tertiary');
  ctx.font = '12px -apple-system,system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Awaiting signal…', W / 2, H / 2);
}

// ── Modes ──────────────────────────────────────────────────────────────────
function buildModes() {
  var card = $('modes-card');
  card.textContent = '';
  MODES.forEach(function (m) {
    var row = document.createElement('div');
    row.className = 'mode-row';

    var label = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'mode-name'; name.textContent = m.name;
    var desc = document.createElement('div');
    desc.className = 'mode-desc'; desc.textContent = m.desc;
    label.appendChild(name); label.appendChild(desc);

    var sw = document.createElement('button');
    sw.type = 'button'; sw.className = 'switch'; sw.id = 'tog-' + m.key;
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(!!state.modes[m.key]));
    sw.setAttribute('aria-label', m.name);

    sw.addEventListener('click', function () {
      var next = sw.getAttribute('aria-checked') !== 'true';
      sw.disabled = true;
      // Optimistic, but reverted if the server refuses — the old code fired and
      // forgot, so a failed request left the toggle showing a state the
      // detector was never in.
      sw.setAttribute('aria-checked', String(next));
      post('/set_mode', { mode: m.key, value: next })
        .then(function () { state.modes[m.key] = next; })
        .catch(function (err) {
          sw.setAttribute('aria-checked', String(!next));
          showError('Could not change ' + m.name + ': ' + err.message);
        })
        .then(function () { sw.disabled = false; });
    });

    row.appendChild(label); row.appendChild(sw);
    card.appendChild(row);
  });
}

// ── Tabs ───────────────────────────────────────────────────────────────────
function switchTab(tab) {
  ['monitor', 'alerts', 'config'].forEach(function (name) {
    $('page-' + name).hidden = name !== tab;
    $('tab-' + name).setAttribute('aria-selected', String(name === tab));
  });
  if (tab === 'alerts') $('alert-nav-badge').classList.remove('show');
  if (tab === 'config') requestAnimationFrame(drawCharts);
}

// ── Wiring ─────────────────────────────────────────────────────────────────
//
// Order and defensiveness here are deliberate. Previously the AUTHORIZE handler
// was attached last, after three `document.querySelectorAll(...).forEach(...)`
// calls — and NodeList.prototype.forEach does not exist on older Android
// WebViews. One TypeError there aborted the whole script, so the page rendered
// (HTML and CSS are unaffected) but no listener was ever bound and the button
// did nothing. Auth is now wired first, every other step is isolated, and any
// failure is surfaced on screen instead of dying silently in a console nobody
// can open on a phone.

/** NodeList-safe iteration. */
function each(list, fn) {
  Array.prototype.forEach.call(list || [], fn);
}

/** Runs a wiring step so one failure cannot take the rest of the page with it. */
function safely(label, fn) {
  try { fn(); }
  catch (err) { reportFatal(label + ': ' + (err && err.message ? err.message : err)); }
}

// ── 1. Authorize: bound first, so nothing below can prevent it. ────────────
//
// This gate now does two separate jobs, and it is worth being explicit about
// which is which:
//
//   1. Access control. The token is verified against /auth/check before it is
//      stored, so a bad paste fails here instead of silently producing a
//      console that connects to nothing. Previously this screen was audio
//      unlock only — the button's wording implied a gate that did not exist.
//   2. Audio unlock. The AudioContext must be constructed inside a user
//      gesture or mobile browsers start it suspended.
//
// Both must happen in the click handler: constructing the AudioContext after
// an await loses the gesture on Safari, so it is built first, synchronously.

function authError(message) {
  var el = $('auth-error');
  el.textContent = message;          // ← never innerHTML
  el.hidden = false;
}

/** Dismiss the gate and bring the console up. */
function enterConsole() {
  authorized = true;
  $('auth-screen').style.display = 'none';

  // Each of these is independent; a failure in one must not leave the operator
  // staring at an auth screen that will not dismiss.
  safely('modules', buildModes);
  safely('status', function () { setLive(false); });
  safely('connect', connect);
  safely('render loop', function () {
    renderTimer = setInterval(tick, 1000 / RENDER_HZ);
  });
}

$('auth-form').addEventListener('submit', function (event) {
  event.preventDefault();

  // Built synchronously, inside the gesture — see the note above.
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}

  var candidate = ($('auth-token').value || '').replace(/^\s+|\s+$/g, '') || token;
  if (!TOKEN_PATTERN.test(candidate)) {
    authError('That does not look like a Kavach token. Copy the full value from the server console.');
    return;
  }

  var btn = $('auth-btn');
  btn.disabled = true;
  btn.textContent = 'VERIFYING…';

  var previous = token;
  token = candidate;
  post('/auth/check', {}).then(function () {
    rememberToken(candidate);
    enterConsole();
  }).catch(function (err) {
    token = previous;
    btn.disabled = false;
    btn.textContent = 'AUTHORIZE SYSTEM LINK';
    authError(
      err && (err.status === 401 || err.status === 403)
        ? 'Rejected by the detection server. The token may be from a previous run.'
        : 'Could not reach the detection server. Check the WiFi connection.'
    );
  });
});

// A token arriving in the URL fragment (run.py's mobile link) still needs one
// tap to unlock audio, so the gate stays — it just comes pre-filled.
if (token) {
  $('auth-token').value = token;
  $('auth-desc').textContent =
    'Token received from the server link. Tap to open the link and enable audio-visual alerts.';
}

// ── 2. Everything else. ────────────────────────────────────────────────────
safely('tabs', function () {
  each(document.querySelectorAll('.nav-item'), function (btn) {
    btn.addEventListener('click', function () {
      switchTab(btn.getAttribute('data-tab'));
    });
  });
});

safely('chart ranges', function () {
  each(document.querySelectorAll('.g-tab'), function (btn) {
    btn.addEventListener('click', function () {
      activeRange = btn.getAttribute('data-range');
      each(document.querySelectorAll('.g-tab'), function (b) {
        b.setAttribute('aria-selected', String(b === btn));
      });
      drawCharts();
    });
  });
});

safely('error banner', function () {
  $('error-dismiss').addEventListener('click', function () {
    $('error-banner').hidden = true;
  });
});

safely('sound toggle', function () {
  $('tog-sound').addEventListener('click', function () {
    soundOn = !soundOn;
    this.setAttribute('aria-checked', String(soundOn));
  });
});

safely('resize', function () {
  var resizeRaf = 0;
  window.addEventListener('resize', function () {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(drawCharts);
  });
});

// Clock keeps ticking even when the feed drops, so a stale timestamp can never
// masquerade as a live one.
setInterval(function () {
  if (!authorized) return;
  $('threat-timestamp').textContent = new Date().toLocaleTimeString();
}, 1000);

// Deliberate test surface (scripts/mobile-xss-check.js). Nothing else leaks.
window.__kavach = { ingest: ingest, render: render, switchTab: switchTab, state: state };
})();
