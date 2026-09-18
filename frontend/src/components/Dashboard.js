import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { setMode as apiSetMode, startDetection, stopDetection } from '../lib/api';
import { useSurveillance } from '../lib/useSurveillance';
import { useReducedMotion, motionSafe } from '../lib/useReducedMotion';
import { BRAND, FONT, INK, SERIES, SURFACE, THREAT, aggregateThreat, threatColor } from '../theme';
import { ActivityChart } from './ActivityChart';
import { DrawOverlay } from './DrawOverlay';
import { Ic } from './Icons';

const MODULES = [
  { key: 'loitering', short: 'L', label: 'LOITER DETECT' },
  { key: 'night', short: 'N', label: 'NIGHT VISION' },
  { key: 'surge', short: 'S', label: 'SURGE DETECT' },
];

function PanelCorners({ color = BRAND.red, size = 8 }) {
  const base = { position: 'absolute', width: size, height: size, borderColor: color, borderStyle: 'solid' };
  return (
    <>
      <span aria-hidden="true" style={{ ...base, top: 0, left: 0, borderWidth: '1px 0 0 1px' }} />
      <span aria-hidden="true" style={{ ...base, top: 0, right: 0, borderWidth: '1px 1px 0 0' }} />
      <span aria-hidden="true" style={{ ...base, bottom: 0, left: 0, borderWidth: '0 0 1px 1px' }} />
      <span aria-hidden="true" style={{ ...base, bottom: 0, right: 0, borderWidth: '0 1px 1px 0' }} />
    </>
  );
}

function SectionLabel({ children }) {
  return (
    <h2
      style={{
        fontFamily: FONT.ui,
        fontWeight: 600,
        fontSize: '0.64rem',
        letterSpacing: '0.2em',
        color: INK.muted,
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        margin: 0,
      }}
    >
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: BRAND.red, flexShrink: 0 }} />
      {children}
    </h2>
  );
}

/**
 * Threat chip.
 *
 * The old THREAT_COLORS mapped HIGH/MEDIUM/LOW to #ff0000 / #cc2200 / #ff3333 —
 * three near-identical reds (validator: adjacent ΔE 5.3 under protanopia, 10.0
 * with normal vision, both hard fails). LOW was actually *brighter* than MEDIUM.
 * The threat level, the single most important readout on the console, was
 * effectively uncoded. These are the reserved status colours, and they ship with
 * an icon and a text label so the state never rests on hue alone.
 */
function ThreatLevel({ level, reduced }) {
  const color = threatColor(level);
  const Icon = level === 'LOW' ? Ic.Check : Ic.Warning;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 10px',
        border: `1px solid ${color}`,
        background: `${color}1a`,
        fontFamily: FONT.display,
        fontSize: '0.8rem',
        letterSpacing: '0.15em',
        color,
        animation: motionSafe(reduced, level === 'HIGH' ? 'pulse-r 1.2s ease-in-out infinite' : 'none'),
      }}
    >
      <Icon />
      {level}
      <span className="sr-only">threat level</span>
    </span>
  );
}

function StatTile({ label, value, color }) {
  return (
    <div
      style={{
        background: SURFACE.panel,
        border: `1px solid ${INK.line}`,
        borderLeft: `2px solid ${color}`,
        position: 'relative',
        overflow: 'hidden',
        padding: '12px 14px',
      }}
    >
      <PanelCorners color={color} size={6} />
      <div style={{ fontFamily: FONT.display, fontSize: 'clamp(1.6rem,4vw,2.4rem)', color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: FONT.ui, fontWeight: 600, fontSize: '0.62rem', letterSpacing: '0.2em', color: INK.muted, marginTop: '4px' }}>
        {label}
      </div>
    </div>
  );
}

function ZoneRow({ zone, reduced }) {
  const color = threatColor(zone.threat);
  return (
    <li
      className={zone.threat === 'HIGH' && !reduced ? 'high-threat' : ''}
      style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${SURFACE.sunken}`,
        borderLeft: `2px solid ${color}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <span>
        <span style={{ display: 'block', fontFamily: FONT.ui, fontWeight: 700, fontSize: '0.85rem', color: INK.secondary, letterSpacing: '0.05em' }}>
          {zone.name}
        </span>
        <span style={{ display: 'block', fontSize: '0.6rem', color: INK.muted, marginTop: '2px', letterSpacing: '0.1em' }}>
          {zone.persons ?? 0} PERSONS · {zone.vehicles ?? 0} VEHICLES
        </span>
      </span>
      <ThreatLevel level={zone.threat} reduced={reduced} />
    </li>
  );
}

/** Accessible switch. The original was a <div onClick> — unfocusable, no role. */
function Switch({ checked, onChange, label, disabled }) {
  // useId, not a slug built from `label`: these labels contain spaces, and
  // aria-labelledby splits on whitespace into multiple ID references — so
  // "sw-LOITER DETECT" resolved to no accessible name at all.
  const labelId = useId();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${SURFACE.sunken}`, gap: '10px' }}>
      <span id={labelId} style={{ fontFamily: FONT.ui, fontWeight: 600, fontSize: '0.74rem', letterSpacing: '0.1em', color: INK.secondary }}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={onChange}
        style={{
          width: 34,
          height: 18,
          borderRadius: 9,
          padding: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: checked ? 'rgba(204,0,0,0.25)' : SURFACE.sunken,
          border: `1px solid ${checked ? BRAND.red : INK.line}`,
          position: 'relative',
          transition: 'background 0.2s, border-color 0.2s',
          opacity: disabled ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 'calc(100% - 14px)' : 2,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: checked ? BRAND.red : INK.muted,
            transition: 'left 0.2s',
          }}
        />
      </button>
    </div>
  );
}

export function Dashboard({ onBack }) {
  const { connected, hasFrame, telemetry, history, videoRef, resetHistory, applyLocal } = useSurveillance();
  const reduced = useReducedMotion();
  const videoBoxRef = useRef(null);

  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString());

  // The footer clock previously re-rendered only when a socket message arrived,
  // so it froze at the last received time the moment the feed dropped — a stale
  // timestamp that still looked live. It owns its own tick now.
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  const { alerts, zones, persons, vehicles, night, surge, modes, setupDone } = telemetry;
  const threat = useMemo(() => aggregateThreat(zones), [zones]);
  const threatTone = threatColor(threat);

  const run = useCallback(async (tag, fn, onOk) => {
    setBusy(tag);
    setError(null);
    try {
      await fn();
      onOk?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, []);

  const handleStart = () => run('start', startDetection, () => applyLocal({ setupDone: true }));

  const handleStop = () =>
    run('stop', stopDetection, () => {
      resetHistory();
    });

  const handleMode = (key) => {
    const next = !modes[key];
    return run(`mode:${key}`, () => apiSetMode(key, next), () =>
      applyLocal({ modes: { ...modes, [key]: next } })
    );
  };

  // Newest first for display, but keyed by position in the source list so the
  // keys stay stable as alerts arrive (index-keying a reversed array re-creates
  // every row on each update and replays the entrance animation across all of them).
  const orderedAlerts = useMemo(
    () => alerts.map((a, i) => ({ ...a, id: `${i}-${a.time}-${a.msg}` })).reverse(),
    [alerts]
  );

  const headerBtn = (on) => ({
    fontFamily: FONT.mono,
    fontSize: '0.62rem',
    letterSpacing: '0.15em',
    padding: '4px 10px',
    border: `1px solid ${on ? '#7a2a2a' : INK.line}`,
    background: on ? 'rgba(204,0,0,0.12)' : 'transparent',
    color: on ? '#ff6b6b' : INK.muted,
    cursor: 'pointer',
  });

  const panel = {
    background: SURFACE.panel,
    border: `1px solid ${INK.line}`,
    position: 'relative',
  };

  return (
    <div
      className="scanlines page-enter"
      style={{
        minHeight: '100vh',
        padding: '12px',
        background: SURFACE.page,
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        gap: '10px',
        fontFamily: FONT.mono,
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          borderBottom: `1px solid ${INK.line}`,
          paddingBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button type="button" onClick={onBack} style={{ ...headerBtn(false), display: 'flex', alignItems: 'center', gap: '6px' }}>
            ← BACK
          </button>
          <div style={{ position: 'relative' }}>
            <span style={{ fontFamily: FONT.display, fontSize: 'clamp(1.3rem,4vw,2rem)', letterSpacing: '0.15em', color: '#fff', lineHeight: 1 }}>
              KAVACH
            </span>
            {!reduced && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  fontFamily: FONT.display,
                  fontSize: 'clamp(1.3rem,4vw,2rem)',
                  letterSpacing: '0.15em',
                  color: BRAND.red,
                  lineHeight: 1,
                  opacity: 0.3,
                  animation: 'glitch 4s infinite',
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
              >
                KAVACH
              </span>
            )}
          </div>
          <span style={{ fontFamily: FONT.ui, fontSize: '0.65rem', letterSpacing: '0.3em', color: INK.muted }}>
            BORDER SURVEILLANCE SYSTEM
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontFamily: FONT.display, fontSize: '0.65rem', letterSpacing: '0.3em', color: INK.muted }}>
            THREAT STATUS
          </span>
          <ThreatLevel level={threat} reduced={reduced} />
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div role="group" aria-label="Detection modules" style={{ display: 'flex', gap: '6px' }}>
            {MODULES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => handleMode(m.key)}
                disabled={busy === `mode:${m.key}`}
                aria-pressed={!!modes[m.key]}
                aria-label={m.label}
                title={m.label}
                style={headerBtn(!!modes[m.key])}
              >
                {m.short}
              </button>
            ))}
          </div>
          <span aria-hidden="true" style={{ width: 1, height: 16, background: INK.line }} />
          {setupDone && (
            <button type="button" onClick={handleStop} disabled={busy === 'stop'} style={headerBtn(true)}>
              {busy === 'stop' ? 'HALTING…' : 'HALT'}
            </button>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: connected ? THREAT.LOW : THREAT.HIGH,
                animation: motionSafe(reduced, connected ? 'none' : 'pulse-r 1.5s ease-in-out infinite'),
              }}
            />
            <span
              role="status"
              style={{ fontFamily: FONT.ui, fontWeight: 600, fontSize: '0.64rem', letterSpacing: '0.2em', color: connected ? THREAT.LOW : THREAT.HIGH }}
            >
              {connected ? 'LIVE' : 'OFFLINE'}
            </span>
          </span>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'rgba(40,6,6,0.96)',
            border: `1px solid ${THREAT.HIGH}`,
            color: '#ffb0b0',
            fontSize: '0.68rem',
            padding: '9px 14px',
          }}
        >
          <Ic.Warning />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ ...headerBtn(false), borderColor: THREAT.HIGH, color: '#ffb0b0' }}>
            DISMISS
          </button>
        </div>
      )}

      <main className="console-main" style={{ display: 'grid', gap: '10px', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          <section
            ref={videoBoxRef}
            style={{
              ...panel,
              border: `1px solid ${setupDone ? threatTone : INK.line}`,
              flex: '1 1 auto',
              overflow: 'hidden',
              minHeight: 280,
              // Keeps the picture 16:9 so `contain` letterboxing stays minimal.
              aspectRatio: '16 / 9',
            }}
          >
            <PanelCorners color={setupDone ? threatTone : INK.line} size={12} />

            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 30,
                background: 'linear-gradient(180deg,rgba(0,0,0,0.8) 0%,transparent 100%)',
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: BRAND.red,
                    animation: motionSafe(reduced, 'pulse-r 1s ease-in-out infinite'),
                  }}
                />
                <span style={{ fontFamily: FONT.ui, fontWeight: 600, fontSize: '0.62rem', letterSpacing: '0.2em', color: BRAND.red }}>REC</span>
                <span style={{ fontFamily: FONT.mono, fontSize: '0.58rem', color: INK.muted, marginLeft: '8px' }}>CAM-01 // ACTIVE</span>
              </span>
              {setupDone && <ThreatLevel level={threat} reduced={reduced} />}
            </div>

            {/* Frames are written straight to this node by the socket hook — it is
                deliberately uncontrolled, so a 20Hz feed causes zero re-renders. */}
            <img
              ref={videoRef}
              alt="Live detection feed"
              style={{
                width: '100%',
                height: '100%',
                display: hasFrame ? 'block' : 'none',
                objectFit: 'contain',
                background: '#000',
              }}
            />

            {!hasFrame && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    border: '1px solid rgba(204,0,0,0.25)',
                    borderTop: `1px solid ${BRAND.red}`,
                    borderRadius: '50%',
                    animation: motionSafe(reduced, 'spin 1s linear infinite'),
                  }}
                />
                <span style={{ fontFamily: FONT.mono, fontSize: '0.65rem', letterSpacing: '0.2em', color: INK.muted }}>
                  {connected ? 'INITIALIZING FEED…' : 'WAITING FOR DETECTION SERVER…'}
                </span>
              </div>
            )}

            <DrawOverlay
              setupDone={setupDone}
              onStart={handleStart}
              starting={busy === 'start'}
              containerRef={videoBoxRef}
              frameSize={telemetry.frameSize}
            />
          </section>

          <div className="stat-row" style={{ display: 'grid', gap: '8px' }}>
            <StatTile label="PERSONS" value={persons} color={SERIES.persons} />
            <StatTile label="VEHICLES" value={vehicles} color={SERIES.vehicles} />
            <StatTile label="ZONES" value={zones.length} color={INK.secondary} />
            <StatTile label="ALERTS" value={alerts.length} color={threatTone} />
          </div>

          <section style={{ ...panel, padding: '12px' }}>
            <PanelCorners color={INK.line} size={8} />
            <div style={{ marginBottom: '10px' }}>
              <SectionLabel>Activity monitor</SectionLabel>
            </div>
            <ActivityChart history={history} />
          </section>
        </div>

        <div className="console-side" style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          <section style={{ ...panel, padding: '12px' }}>
            <PanelCorners color={INK.line} size={6} />
            <SectionLabel>Active modules</SectionLabel>
            <div style={{ height: 1, background: `linear-gradient(90deg,${INK.line},transparent)`, margin: '10px 0' }} />
            {MODULES.map((m) => (
              <Switch
                key={m.key}
                label={m.label}
                checked={!!modes[m.key]}
                disabled={busy === `mode:${m.key}`}
                onChange={() => handleMode(m.key)}
              />
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '10px' }}>
              {[
                ['NIGHT', night],
                ['SURGE', surge],
              ].map(([label, active]) => (
                <div
                  key={label}
                  style={{
                    padding: '7px',
                    textAlign: 'center',
                    border: `1px solid ${active ? THREAT.MEDIUM : SURFACE.sunken}`,
                    background: active ? 'rgba(250,178,25,0.08)' : 'transparent',
                  }}
                >
                  <div style={{ fontFamily: FONT.mono, fontSize: '0.55rem', letterSpacing: '0.15em', color: active ? THREAT.MEDIUM : INK.muted }}>
                    {label}
                  </div>
                  <div style={{ fontFamily: FONT.display, fontSize: '0.78rem', letterSpacing: '0.1em', color: active ? THREAT.MEDIUM : INK.muted }}>
                    {active ? 'ACTIVE' : 'CLEAR'}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ ...panel, overflow: 'hidden' }}>
            <PanelCorners color={INK.line} size={6} />
            <div style={{ padding: '12px 12px 8px' }}>
              <SectionLabel>Restricted zones</SectionLabel>
            </div>
            <div style={{ height: 1, background: `linear-gradient(90deg,${INK.line},transparent)` }} />
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {zones.length === 0 ? (
                <p style={{ padding: '20px', textAlign: 'center', fontSize: '0.6rem', letterSpacing: '0.15em', color: INK.muted }}>
                  {setupDone ? 'NO ZONES' : 'DEFINE ZONES ON FEED'}
                </p>
              ) : (
                <ul style={{ listStyle: 'none' }}>
                  {zones.map((z, i) => (
                    <ZoneRow key={`${z.name}-${i}`} zone={z} reduced={reduced} />
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section style={{ ...panel, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 200 }}>
            <PanelCorners color={INK.line} size={6} />
            <div style={{ padding: '12px 12px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <SectionLabel>Alert log</SectionLabel>
              {alerts.length > 0 && (
                <span style={{ fontFamily: FONT.display, fontSize: '0.75rem', letterSpacing: '0.1em', color: threatTone }}>
                  {alerts.length} EVENTS
                </span>
              )}
            </div>
            <div style={{ height: 1, background: `linear-gradient(90deg,${INK.line},transparent)` }} />

            {/* aria-live so a screen-reader operator is actually told when an
                alert fires — previously this list was silent. */}
            <div style={{ overflowY: 'auto', flex: 1, maxHeight: 300 }} aria-live="polite" aria-relevant="additions">
              {orderedAlerts.length === 0 ? (
                <p style={{ padding: '20px', textAlign: 'center', fontSize: '0.6rem', letterSpacing: '0.15em', color: INK.muted }}>
                  NO EVENTS RECORDED
                </p>
              ) : (
                <ul style={{ listStyle: 'none' }}>
                  {orderedAlerts.map((a, i) => (
                    <li
                      key={a.id}
                      className={i === 0 ? 'alert-row' : undefined}
                      style={{
                        padding: '6px 12px',
                        borderBottom: `1px solid ${SURFACE.sunken}`,
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'flex-start',
                        background: i === 0 ? 'rgba(204,0,0,0.05)' : 'transparent',
                      }}
                    >
                      <time style={{ color: INK.muted, fontSize: '0.58rem', whiteSpace: 'nowrap', marginTop: '1px' }}>
                        {a.time}
                      </time>
                      {/* Older entries were faded to 0.25 opacity by index, which
                          made everything past the 10th alert unreadable. */}
                      <span style={{ color: i === 0 ? '#ff8080' : INK.secondary, fontSize: '0.68rem', lineHeight: 1.45 }}>
                        {a.msg}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer style={{ borderTop: `1px solid ${INK.line}`, paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.55rem', letterSpacing: '0.2em', color: INK.muted }}>
          KAVACH v2.0 // RESTRICTED ACCESS // AUTHORIZED PERSONNEL ONLY
        </span>
        <span style={{ fontSize: '0.55rem', letterSpacing: '0.15em', color: INK.muted, display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span>P:{persons} V:{vehicles}</span>
          <time>{clock}</time>
        </span>
      </footer>
    </div>
  );
}

export default Dashboard;
