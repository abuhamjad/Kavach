import { useId, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FONT, INK, SERIES, SURFACE, THREAT, THREAT_ORDER, scoreToThreat } from '../theme';

// ─────────────────────────────────────────────────────────────────────────────
//  Activity monitor.
//
//  The previous chart plotted person/vehicle COUNTS and a 1-3 THREAT ordinal on
//  a single y-axis whose ticks were hardcoded to [0..4] and relabelled L/M/H.
//  With a dozen people in frame Recharts auto-scaled the domain to ~[0,12], the
//  threat series flattened against the baseline, and the L/M/H labels ended up
//  annotating count values. That is the dual-axis anti-pattern with extra steps.
//
//  Two measures of different scale get two charts sharing one x-axis — small
//  multiples, one axis each. Alerts are marked on the threat plot rather than
//  smuggled in as a fake 4th series pinned to a magic value.
// ─────────────────────────────────────────────────────────────────────────────

const GRID = '#241818';
const AXIS = '#3a2828';

const axisTick = { fill: INK.muted, fontSize: 9, fontFamily: FONT.mono };

// Labels name the actual window each buffer covers. The old tabs read
// RT / 1M / 5M, where "RT" was 60 samples at 20Hz — three seconds, not
// real-time-in-general — and "LIVE" collided with the connection badge.
const RANGES = [
  { key: 'realtime', label: '12S', hint: 'last ~12 seconds' },
  { key: 'perSec', label: '1M', hint: '1-second averages, last 60' },
  { key: 'per10s', label: '5M', hint: '10-second averages, last 30' },
];

const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(1)) : v);

function Swatch({ color }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 8,
        height: 8,
        borderRadius: 2,
        background: color,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: SURFACE.panel,
        border: `1px solid ${INK.line}`,
        padding: '8px 12px',
        fontFamily: FONT.mono,
        fontSize: '0.65rem',
      }}
    >
      <div style={{ color: INK.muted, marginBottom: '6px' }}>{label}</div>
      {payload.map((p) => (
        <div
          key={p.dataKey}
          style={{ display: 'flex', alignItems: 'center', gap: '7px', color: INK.secondary }}
        >
          <Swatch color={p.color} />
          <span style={{ color: INK.muted }}>
            {p.dataKey === 'threat' ? 'THREAT' : String(p.name || p.dataKey).toUpperCase()}
          </span>
          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {p.dataKey === 'threat' ? scoreToThreat(p.value) : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Renders a marker only where an alert fired — no dot on every point. */
function AlertDot({ cx, cy, payload }) {
  if (!payload?.alerted || cx == null || cy == null) return null;
  return (
    <g>
      {/* 2px surface ring so the marker reads against the line it sits on. */}
      <circle cx={cx} cy={cy} r={5} fill={SURFACE.panel} />
      <circle cx={cx} cy={cy} r={3.5} fill={THREAT.HIGH} />
    </g>
  );
}

function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
      {items.map(({ label, color }) => (
        <span
          key={label}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontFamily: FONT.ui,
            fontWeight: 600,
            fontSize: '0.62rem',
            letterSpacing: '0.16em',
            color: INK.muted,
          }}
        >
          <Swatch color={color} />
          {label}
        </span>
      ))}
    </div>
  );
}

function TableView({ data }) {
  const cell = {
    padding: '4px 10px',
    fontFamily: FONT.mono,
    fontSize: '0.62rem',
    color: INK.secondary,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  };
  const head = { ...cell, color: INK.muted, letterSpacing: '0.12em', position: 'sticky', top: 0, background: SURFACE.panel };

  return (
    <div style={{ maxHeight: 250, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption className="sr-only">
          Activity readings: time, person count, vehicle count, threat level, and whether an alert fired.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ ...head, textAlign: 'left' }}>TIME</th>
            <th scope="col" style={head}>PERSONS</th>
            <th scope="col" style={head}>VEHICLES</th>
            <th scope="col" style={head}>THREAT</th>
            <th scope="col" style={head}>ALERT</th>
          </tr>
        </thead>
        <tbody>
          {[...data].reverse().map((row, i) => (
            <tr key={`${row.t}-${i}`} style={{ borderTop: `1px solid ${SURFACE.sunken}` }}>
              <td style={{ ...cell, textAlign: 'left' }}>{row.t}</td>
              <td style={cell}>{fmt(row.persons)}</td>
              <td style={cell}>{fmt(row.vehicles)}</td>
              <td style={{ ...cell, color: THREAT[scoreToThreat(row.threat)] }}>
                {scoreToThreat(row.threat)}
              </td>
              <td style={cell}>{row.alerted ? 'YES' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActivityChart({ history }) {
  const [range, setRange] = useState('realtime');
  const [asTable, setAsTable] = useState(false);
  const gradientId = useId();

  // Memoised so the `?? []` fallback does not hand downstream hooks a fresh
  // array reference on every render.
  const data = useMemo(() => history[range] ?? [], [history, range]);
  const active = RANGES.find((r) => r.key === range);

  // Direct-label the endpoint only — a value on every point is unreadable.
  const last = data[data.length - 1];

  const countsDomain = useMemo(() => {
    const peak = data.reduce((m, d) => Math.max(m, d.persons, d.vehicles), 0);
    return [0, Math.max(4, Math.ceil(peak * 1.15))];
  }, [data]);

  const tabBtn = (selected) => ({
    fontFamily: FONT.mono,
    fontSize: '0.55rem',
    letterSpacing: '0.15em',
    padding: '3px 8px',
    border: `1px solid ${selected ? '#7a2a2a' : INK.line}`,
    background: selected ? 'rgba(204,0,0,0.12)' : 'transparent',
    color: selected ? '#ff6b6b' : INK.muted,
    cursor: 'pointer',
  });

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          marginBottom: '10px',
        }}
      >
        <Legend
          items={[
            { label: 'PERSONS', color: SERIES.persons },
            { label: 'VEHICLES', color: SERIES.vehicles },
          ]}
        />
        <div style={{ display: 'flex', gap: '4px' }} role="group" aria-label="Chart time range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              title={r.hint}
              style={tabBtn(range === r.key)}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            title="Show the same readings as a table"
            style={{ ...tabBtn(asTable), marginLeft: '6px' }}
          >
            TABLE
          </button>
        </div>
      </div>

      <div style={{ height: 1, background: `linear-gradient(90deg,${INK.line},transparent)`, marginBottom: '10px' }} />

      {data.length === 0 ? (
        <div
          style={{
            height: 196,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: FONT.mono,
            fontSize: '0.6rem',
            letterSpacing: '0.2em',
            color: INK.muted,
          }}
        >
          AWAITING SIGNAL
        </div>
      ) : asTable ? (
        <TableView data={data} />
      ) : (
        <>
          {/* ── Counts: one axis, count scale ── */}
          <div style={{ position: 'relative' }}>
            <ResponsiveContainer width="100%" height={130}>
              <AreaChart data={data} margin={{ top: 6, right: 44, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`${gradientId}-p`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES.persons} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={SERIES.persons} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id={`${gradientId}-v`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES.vehicles} stopOpacity={0.24} />
                    <stop offset="100%" stopColor={SERIES.vehicles} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
                <XAxis dataKey="t" hide />
                <YAxis
                  width={30}
                  domain={countsDomain}
                  allowDecimals={false}
                  tick={axisTick}
                  axisLine={{ stroke: AXIS }}
                  tickLine={false}
                  label={{
                    value: 'COUNT',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: INK.muted, fontSize: 8, fontFamily: FONT.mono, letterSpacing: '0.1em' },
                  }}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="persons"
                  name="persons"
                  stroke={SERIES.persons}
                  strokeWidth={2}
                  fill={`url(#${gradientId}-p)`}
                  dot={false}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="vehicles"
                  name="vehicles"
                  stroke={SERIES.vehicles}
                  strokeWidth={2}
                  fill={`url(#${gradientId}-v)`}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>

            {/* Selective direct labels: current value per series, at the endpoint. */}
            {last && (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  pointerEvents: 'none',
                }}
              >
                {[
                  { v: last.persons, c: SERIES.persons },
                  { v: last.vehicles, c: SERIES.vehicles },
                ].map(({ v, c }, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontFamily: FONT.mono,
                      fontSize: '0.62rem',
                      color: INK.secondary,
                    }}
                  >
                    <Swatch color={c} />
                    {fmt(v)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Threat: its own ordinal axis ── */}
          <div style={{ marginTop: '6px' }}>
            <ResponsiveContainer width="100%" height={66}>
              <LineChart data={data} margin={{ top: 8, right: 44, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
                <XAxis dataKey="t" hide />
                <YAxis
                  width={30}
                  domain={[1, THREAT_ORDER.length]}
                  ticks={[1, 2, 3]}
                  tick={axisTick}
                  axisLine={{ stroke: AXIS }}
                  tickLine={false}
                  tickFormatter={(v) => scoreToThreat(v).slice(0, 3)}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
                <Line
                  type="stepAfter"
                  dataKey="threat"
                  name="threat"
                  stroke={THREAT.MEDIUM}
                  strokeWidth={2}
                  dot={<AlertDot />}
                  activeDot={{ r: 4, fill: THREAT.MEDIUM, stroke: SURFACE.panel, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ marginTop: '4px' }}>
              <Legend items={[{ label: 'THREAT LEVEL', color: THREAT.MEDIUM }, { label: 'ALERT FIRED', color: THREAT.HIGH }]} />
            </div>
          </div>

          <p className="sr-only" aria-live="polite">
            {active?.label} window. Latest reading: {fmt(last?.persons ?? 0)} persons,{' '}
            {fmt(last?.vehicles ?? 0)} vehicles, threat {scoreToThreat(last?.threat ?? 1)}.
          </p>
        </>
      )}
    </div>
  );
}

export default ActivityChart;
