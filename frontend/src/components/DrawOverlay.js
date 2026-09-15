import { useCallback, useEffect, useRef, useState } from 'react';
import { addTripwire, addZone } from '../lib/api';
import { useVideoContentRect, toFramePoint } from '../lib/useVideoContentRect';
import { BRAND, FONT, FRAME_H, FRAME_W, INK, SURFACE } from '../theme';
import { Ic } from './Icons';

const ZONE_COLOR = '#cc0000';
const WIRE_COLOR = '#d95926';

/**
 * Zone / tripwire drawing surface.
 *
 * Two bugs lived here and both were operationally serious:
 *
 *  1. Clicks were mapped with a flat `(clientX - box.left) * (1280 / box.width)`
 *     while the feed rendered with `object-fit: cover` inside a container that
 *     was not 16:9. `cover` crops; the canvas covered the *uncropped* box. The
 *     polygon the operator drew was therefore not the polygon the backend
 *     received — restricted zones silently guarded the wrong pixels. The feed is
 *     `contain` now and the canvas is pinned to the measured picture rect, so
 *     screen space and frame space line up exactly at any container shape.
 *
 *  2. saveZone/saveWire fired and forgot. A failed POST still pushed the zone
 *     into local state, so the toolbar reported zones the backend never got.
 *     Nothing is committed locally until the server accepts it.
 */
export function DrawOverlay({ setupDone, onStart, containerRef, starting }) {
  const [mode, setMode] = useState('zone');
  const [points, setPoints] = useState([]);
  const [wirePoints, setWirePoints] = useState([]);
  const [zones, setZones] = useState([]);
  const [wires, setWires] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');

  const canvasRef = useRef(null);
  const rect = useVideoContentRect(containerRef);

  // A new detection run starts from a clean slate on the backend
  // (detect.py resets `zones = []`), so the overlay must not keep showing the
  // previous run's shapes.
  useEffect(() => {
    if (!setupDone) return;
    setPoints([]);
    setWirePoints([]);
    setZones([]);
    setWires([]);
    setError(null);
  }, [setupDone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, FRAME_W, FRAME_H);

    zones.forEach((z) => {
      if (z.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(z.points[0][0], z.points[0][1]);
      z.points.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
      ctx.closePath();
      ctx.fillStyle = 'rgba(204,0,0,0.07)';
      ctx.strokeStyle = ZONE_COLOR;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      const cx = z.points.reduce((s, p) => s + p[0], 0) / z.points.length;
      const cy = z.points.reduce((s, p) => s + p[1], 0) / z.points.length;
      ctx.fillStyle = ZONE_COLOR;
      ctx.font = "bold 16px 'Share Tech Mono', monospace";
      ctx.textAlign = 'center';
      ctx.fillText(z.name, cx, cy);
      ctx.textAlign = 'left';
    });

    wires.forEach((w) => {
      ctx.beginPath();
      ctx.moveTo(w.p1[0], w.p1[1]);
      ctx.lineTo(w.p2[0], w.p2[1]);
      ctx.strokeStyle = WIRE_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = WIRE_COLOR;
      ctx.font = "13px 'Share Tech Mono', monospace";
      ctx.fillText(w.name, (w.p1[0] + w.p2[0]) / 2 + 6, (w.p1[1] + w.p2[1]) / 2 - 6);
    });

    if (mode === 'zone' && points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
      ctx.strokeStyle = 'rgba(204,0,0,0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
        ctx.fillStyle = ZONE_COLOR;
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = "12px 'Share Tech Mono', monospace";
        ctx.fillText(String(i + 1), p[0] + 7, p[1] - 5);
      });
    }

    if (mode === 'tripwire' && wirePoints.length > 0) {
      wirePoints.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
        ctx.strokeStyle = WIRE_COLOR;
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      if (wirePoints.length === 2) {
        ctx.beginPath();
        ctx.moveTo(wirePoints[0][0], wirePoints[0][1]);
        ctx.lineTo(wirePoints[1][0], wirePoints[1][1]);
        ctx.strokeStyle = WIRE_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [points, wirePoints, zones, wires, mode]);

  const handleClick = useCallback(
    (e) => {
      if (setupDone) return;
      const point = toFramePoint(e, canvasRef.current);
      if (!point) return; // click landed on a letterbox bar

      if (mode === 'zone') {
        setPoints((prev) => {
          setStatus(`Point ${prev.length + 1} added at ${point[0]}, ${point[1]}`);
          return [...prev, point];
        });
      } else {
        setWirePoints((prev) => {
          if (prev.length >= 2) return prev;
          setStatus(`Tripwire endpoint ${prev.length + 1} of 2 set`);
          return [...prev, point];
        });
      }
    },
    [mode, setupDone]
  );

  const saveZone = async () => {
    if (points.length < 3 || saving) return;
    const name = `SECTOR-${String.fromCharCode(65 + zones.length)}`;
    setSaving(true);
    setError(null);
    try {
      await addZone(name, points);
      setZones((prev) => [...prev, { name, points }]);
      setPoints([]);
      setStatus(`${name} saved with ${points.length} points`);
    } catch (err) {
      setError(`Could not save ${name}: ${err.message}`);
      setStatus(`${name} was rejected by the server`);
    } finally {
      setSaving(false);
    }
  };

  const saveWire = async () => {
    if (wirePoints.length < 2 || saving) return;
    const name = `WIRE-${wires.length + 1}`;
    setSaving(true);
    setError(null);
    try {
      await addTripwire(name, wirePoints[0], wirePoints[1]);
      setWires((prev) => [...prev, { name, p1: wirePoints[0], p2: wirePoints[1] }]);
      setWirePoints([]);
      setStatus(`${name} saved`);
    } catch (err) {
      setError(`Could not save ${name}: ${err.message}`);
      setStatus(`${name} was rejected by the server`);
    } finally {
      setSaving(false);
    }
  };

  if (setupDone) return null;

  const btn = {
    fontFamily: FONT.mono,
    fontSize: '0.62rem',
    letterSpacing: '0.15em',
    padding: '5px 11px',
    border: '1px solid',
    background: 'transparent',
    cursor: 'pointer',
  };
  const ghost = { ...btn, borderColor: INK.line, color: INK.muted };

  return (
    <>
      <canvas
        ref={canvasRef}
        width={FRAME_W}
        height={FRAME_H}
        onClick={handleClick}
        aria-label={
          mode === 'zone'
            ? 'Restricted zone drawing surface. Click to place boundary points.'
            : 'Tripwire drawing surface. Click two points to lay a wire.'
        }
        style={{
          position: 'absolute',
          // Pinned to the measured picture, not the container — this is the fix.
          left: rect.left,
          top: rect.top,
          width: rect.width || '100%',
          height: rect.height || '100%',
          cursor: 'crosshair',
          zIndex: 10,
        }}
      />

      <p className="sr-only" role="status" aria-live="polite">{status}</p>

      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            bottom: '52px',
            left: '12px',
            right: '12px',
            zIndex: 25,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(40,6,6,0.96)',
            border: '1px solid #d03b3b',
            color: '#ffb0b0',
            fontFamily: FONT.mono,
            fontSize: '0.64rem',
            letterSpacing: '0.05em',
            padding: '8px 12px',
          }}
        >
          <Ic.Warning />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ ...ghost, borderColor: '#d03b3b', color: '#ffb0b0' }}>
            DISMISS
          </button>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          background: 'rgba(0,0,0,0.92)',
          borderTop: `1px solid ${INK.line}`,
          padding: '8px 12px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontFamily: FONT.display, fontSize: '0.75rem', letterSpacing: '0.2em', color: INK.muted }}>
          DRAW
        </span>

        <div role="group" aria-label="Drawing mode" style={{ display: 'flex', gap: '6px' }}>
          {[
            ['zone', 'ZONE', ZONE_COLOR],
            ['tripwire', 'WIRE', WIRE_COLOR],
          ].map(([value, label, color]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                if (value === 'zone') setWirePoints([]);
                else setPoints([]);
              }}
              style={{
                ...btn,
                borderColor: mode === value ? color : INK.line,
                background: mode === value ? `${color}22` : 'transparent',
                color: mode === value ? color : INK.muted,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <span aria-hidden="true" style={{ width: 1, height: 16, background: INK.line, margin: '0 2px' }} />

        {mode === 'zone' ? (
          <>
            <button
              type="button"
              onClick={saveZone}
              disabled={points.length < 3 || saving}
              style={{
                ...btn,
                borderColor: points.length < 3 ? INK.line : ZONE_COLOR,
                color: points.length < 3 ? INK.faint : ZONE_COLOR,
                cursor: points.length < 3 || saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'SAVING…' : `SAVE ZONE (${points.length} PTS)`}
            </button>
            <button type="button" onClick={() => setPoints((p) => p.slice(0, -1))} disabled={!points.length} style={ghost}>
              UNDO
            </button>
            <button type="button" onClick={() => setPoints([])} disabled={!points.length} style={ghost}>
              CLEAR
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={saveWire}
              disabled={wirePoints.length < 2 || saving}
              style={{
                ...btn,
                borderColor: wirePoints.length < 2 ? INK.line : WIRE_COLOR,
                color: wirePoints.length < 2 ? INK.faint : WIRE_COLOR,
                cursor: wirePoints.length < 2 || saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'SAVING…' : `SAVE WIRE (${wirePoints.length}/2)`}
            </button>
            <button type="button" onClick={() => setWirePoints([])} disabled={!wirePoints.length} style={ghost}>
              CLEAR
            </button>
          </>
        )}

        <span style={{ marginLeft: 'auto', fontFamily: FONT.mono, fontSize: '0.6rem', color: INK.muted, letterSpacing: '0.1em' }}>
          {zones.length} ZONES · {wires.length} WIRES
        </span>

        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          style={{
            fontFamily: FONT.display,
            fontSize: '0.85rem',
            letterSpacing: '0.2em',
            padding: '6px 22px',
            border: `1px solid ${BRAND.red}`,
            background: starting ? SURFACE.raised : BRAND.red,
            color: starting ? INK.muted : '#000',
            cursor: starting ? 'wait' : 'pointer',
          }}
        >
          {starting ? 'STARTING…' : 'INITIATE'}
        </button>
      </div>

      {zones.length === 0 && wires.length === 0 && points.length === 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 5,
            width: '90%',
          }}
        >
          <div style={{ fontFamily: FONT.display, fontSize: 'clamp(0.9rem,2.5vw,1.2rem)', letterSpacing: '0.3em', color: 'rgba(204,0,0,0.45)', marginBottom: '8px' }}>
            DEFINE RESTRICTED ZONES
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)' }}>
            CLICK TO ADD BOUNDARY POINTS
          </div>
        </div>
      )}
    </>
  );
}

export default DrawOverlay;
