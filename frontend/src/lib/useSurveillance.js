import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WS_URL, rejectToken, wsProtocols } from './api';
import { DEFAULT_FRAME_SIZE, threatToScore } from '../theme';

// ─────────────────────────────────────────────────────────────────────────────
//  Live telemetry socket.
//
//  The backend pushes its ENTIRE shared_state every 50ms (~20Hz) — a base64
//  JPEG plus the full, uncapped alert log. Committing that to React state at
//  20Hz re-renders the whole console (charts included) twenty times a second,
//  so this hook splits the stream in two:
//
//    • Video frames  → written straight to the <img> via videoRef. Zero renders.
//    • Telemetry     → coalesced in a ref, committed at TELEMETRY_HZ.
//
//  Frames stay smooth; React only does work at a rate a human can read.
// ─────────────────────────────────────────────────────────────────────────────

const TELEMETRY_HZ = 5;
const TELEMETRY_INTERVAL = 1000 / TELEMETRY_HZ;

// The server keeps a bounded ring of its own; this is a second bound so a
// server that is reconfigured upward cannot grow the console's memory. Newest
// wins.
const MAX_ALERTS = 200;

const RT_SAMPLES = 60;   // at TELEMETRY_HZ → ~12s
const SEC_SAMPLES = 60;  // 1s buckets     → 60s
const TEN_S_SAMPLES = 30; // 10s buckets   → 300s

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

const EMPTY_TELEMETRY = {
  alerts: [],
  zones: [],
  persons: 0,
  vehicles: 0,
  night: false,
  surge: false,
  modes: { loitering: true, night: true, surge: true },
  setupDone: false,
  frameSize: DEFAULT_FRAME_SIZE,
};

/**
 * Highest alert id in a payload, or 0.
 *
 * The console used to infer "a new alert arrived" from the alert array getting
 * longer. The server's log is a fixed-size ring, so once it saturates the
 * length never increases again and every subsequent alert went unnoticed —
 * alert markers stopped appearing on the activity charts for the rest of the
 * session. Ids are monotonic and survive truncation.
 */
export function newestAlertId(alerts) {
  if (!Array.isArray(alerts) || !alerts.length) return 0;
  const last = alerts[alerts.length - 1];
  return Number.isFinite(last?.id) ? last.id : 0;
}

const EMPTY_HISTORY = { realtime: [], perSec: [], per10s: [] };

const clockLabel = () => new Date().toLocaleTimeString();

const mean = (rows, key) =>
  rows.length ? rows.reduce((sum, r) => sum + r[key], 0) / rows.length : 0;

/** Collapse a bucket of samples into one point. */
const collapse = (rows) => ({
  t: clockLabel(),
  persons: mean(rows, 'persons'),
  vehicles: mean(rows, 'vehicles'),
  threat: Math.max(...rows.map((r) => r.threat)),
  alerted: rows.some((r) => r.alerted),
});

/**
 * Normalise a raw socket payload. The backend is trusted but not assumed
 * well-formed — a malformed field degrades to its previous value instead of
 * throwing inside the message handler and killing the stream.
 */
function mergePayload(prev, d) {
  return {
    alerts: Array.isArray(d.alerts) ? d.alerts.slice(-MAX_ALERTS) : prev.alerts,
    zones: Array.isArray(d.zones) ? d.zones : prev.zones,
    persons: Number.isFinite(d.total_persons) ? d.total_persons : prev.persons,
    vehicles: Number.isFinite(d.total_vehicles) ? d.total_vehicles : prev.vehicles,
    night: typeof d.night === 'boolean' ? d.night : prev.night,
    surge: typeof d.surge === 'boolean' ? d.surge : prev.surge,
    modes: d.modes && typeof d.modes === 'object' ? { ...prev.modes, ...d.modes } : prev.modes,
    setupDone: typeof d.setup_done === 'boolean' ? d.setup_done : prev.setupDone,
    // Frame geometry is server-authoritative: zone coordinates are expressed in
    // it, so a hardcoded copy here would silently misplace zones if the backend
    // ever changed resolution.
    frameSize:
      Number.isFinite(d.frame_width) && Number.isFinite(d.frame_height)
        ? { width: d.frame_width, height: d.frame_height }
        : prev.frameSize,
  };
}

export function useSurveillance() {
  const [connected, setConnected] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);
  const [history, setHistory] = useState(EMPTY_HISTORY);

  /** Attach to the <img> that shows the feed. Frames bypass React entirely. */
  const videoRef = useRef(null);

  // Latest payload awaiting commit, plus the bucket accumulators.
  const pending = useRef(null);
  const latest = useRef(EMPTY_TELEMETRY);
  const secBucket = useRef([]);
  const tenSBucket = useRef([]);
  const lastSecFlush = useRef(0);
  const lastTenSFlush = useRef(0);
  const prevAlertId = useRef(0);
  const sawFrame = useRef(false);

  const resetHistory = useCallback(() => {
    pending.current = null;
    latest.current = EMPTY_TELEMETRY;
    secBucket.current = [];
    tenSBucket.current = [];
    lastSecFlush.current = 0;
    lastTenSFlush.current = 0;
    prevAlertId.current = 0;
    setHistory(EMPTY_HISTORY);
    setTelemetry(EMPTY_TELEMETRY);
  }, []);

  /** Optimistic local echo, so a toggle feels instant but is still server-led. */
  const applyLocal = useCallback((patch) => {
    latest.current = { ...latest.current, ...patch };
    setTelemetry((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    // `cancelled` is the StrictMode / unmount guard: React 18+ mounts effects
    // twice in dev, and the old code's onclose handler re-dialled unconditionally
    // — including the close *we* issued during cleanup, which left an immortal
    // reconnect loop behind on every navigation.
    let cancelled = false;
    let socket = null;
    let reconnectTimer = null;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;

      let ws;
      try {
        // The operator token rides in the subprotocol list — the WebSocket API
        // has no way to set headers, and the server rejects the handshake
        // without it.
        ws = new WebSocket(WS_URL, wsProtocols());
      } catch {
        scheduleReconnect();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setConnected(true);
      };

      ws.onmessage = (event) => {
        if (cancelled) return;

        let d;
        try {
          d = JSON.parse(event.data);
        } catch {
          return; // Drop the bad frame; keep the stream alive.
        }
        if (!d || typeof d !== 'object') return;

        // Frames go straight to the DOM node — no setState, no re-render.
        if (typeof d.frame === 'string' && d.frame && videoRef.current) {
          videoRef.current.src = `data:image/jpeg;base64,${d.frame}`;
          if (!sawFrame.current) {
            sawFrame.current = true;
            setHasFrame(true);
          }
        }

        const merged = mergePayload(latest.current, d);
        latest.current = merged;
        pending.current = merged;

        // Sample into the history buckets at full socket rate so the 1m/5m
        // averages stay accurate even though we only commit at TELEMETRY_HZ.
        const newestId = newestAlertId(merged.alerts);
        const alerted = newestId > prevAlertId.current;
        prevAlertId.current = Math.max(prevAlertId.current, newestId);
        const sample = {
          persons: merged.persons,
          vehicles: merged.vehicles,
          threat: merged.zones.reduce((max, z) => Math.max(max, threatToScore(z?.threat)), 1),
          alerted,
        };
        secBucket.current.push(sample);
        tenSBucket.current.push(sample);
      };

      const onDown = (event) => {
        if (cancelled) return;
        setConnected(false);

        // 1008 (policy violation) is the server refusing the handshake: bad or
        // missing operator token. Redialling with the same credential would
        // loop forever, so hand it to api.js, which drops the token and
        // re-prompts.
        if (event?.code === 1008) {
          rejectToken();
          return;
        }
        scheduleReconnect();
      };

      // onerror fires before onclose on a failed dial; closing here funnels both
      // paths through onclose so we schedule exactly one reconnect.
      ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
      ws.onclose = onDown;
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    // Commit loop — the only place telemetry enters React state.
    const commit = setInterval(() => {
      const now = Date.now();

      if (lastSecFlush.current === 0) lastSecFlush.current = now;
      if (lastTenSFlush.current === 0) lastTenSFlush.current = now;

      const next = pending.current;
      pending.current = null;
      if (next) setTelemetry(next);

      const rtPoint = next
        ? {
            t: clockLabel(),
            persons: next.persons,
            vehicles: next.vehicles,
            threat: next.zones.reduce((max, z) => Math.max(max, threatToScore(z?.threat)), 1),
            alerted: secBucket.current.some((s) => s.alerted),
          }
        : null;

      const secDue = now - lastSecFlush.current >= 1000 && secBucket.current.length > 0;
      const tenDue = now - lastTenSFlush.current >= 10000 && tenSBucket.current.length > 0;

      if (!rtPoint && !secDue && !tenDue) return;

      const secPoint = secDue ? collapse(secBucket.current) : null;
      if (secDue) { secBucket.current = []; lastSecFlush.current = now; }

      const tenPoint = tenDue ? collapse(tenSBucket.current) : null;
      if (tenDue) { tenSBucket.current = []; lastTenSFlush.current = now; }

      setHistory((prev) => ({
        realtime: rtPoint ? [...prev.realtime, rtPoint].slice(-RT_SAMPLES) : prev.realtime,
        perSec: secPoint ? [...prev.perSec, secPoint].slice(-SEC_SAMPLES) : prev.perSec,
        per10s: tenPoint ? [...prev.per10s, tenPoint].slice(-TEN_S_SAMPLES) : prev.per10s,
      }));
    }, TELEMETRY_INTERVAL);

    connect();

    return () => {
      cancelled = true;
      clearInterval(commit);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) {
        // Detach before closing: onclose must not re-dial after unmount.
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try { socket.close(); } catch { /* never throws in practice */ }
      }
    };
  }, []);

  return useMemo(
    () => ({ connected, hasFrame, telemetry, history, videoRef, resetHistory, applyLocal }),
    [connected, hasFrame, telemetry, history, resetHistory, applyLocal]
  );
}
