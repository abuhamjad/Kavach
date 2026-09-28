import { useMemo, useState } from 'react';
import { motionSafe } from '../lib/useReducedMotion';
import { BRAND, FONT, INK, SERIES, SURFACE, THREAT } from '../theme';

const LEVEL_COLOR = { ok: THREAT.LOW, warn: THREAT.MEDIUM, alert: THREAT.HIGH };

const FILTERS = [
  { key: 'all', label: 'ALL' },
  { key: 'live', label: 'IN VIEW' },
  { key: 'flagged', label: 'FLAGGED' },
];

const HEADING_ARROW = { EAST: '→', WEST: '←', APPROACHING: '↓', RECEDING: '↑', HALTED: '■' };

/** Styled like an Indian HSRP plate: white field, IND strip, black characters. */
function Plate({ plate, large }) {
  if (!plate) {
    return (
      <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', letterSpacing: '0.15em', color: INK.muted }}>
        READING…
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        border: '1px solid #222',
        borderRadius: 3,
        background: '#f4f4f0',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          background: '#1b4fa0',
          color: '#fff',
          fontFamily: FONT.ui,
          fontWeight: 700,
          fontSize: large ? '0.55rem' : '0.45rem',
          padding: '0 3px',
          display: 'flex',
          alignItems: 'flex-end',
          paddingBottom: 2,
        }}
      >
        IND
      </span>
      <span
        style={{
          color: '#111',
          fontFamily: FONT.mono,
          fontWeight: 700,
          fontSize: large ? '1.05rem' : '0.74rem',
          letterSpacing: '0.08em',
          padding: large ? '3px 9px' : '1px 6px',
        }}
      >
        {plate}
      </span>
    </span>
  );
}

function Status({ record, reduced }) {
  if (!record.status) {
    return <span style={{ fontSize: '0.6rem', letterSpacing: '0.12em', color: INK.muted }}>VERIFYING…</span>;
  }
  const color = LEVEL_COLOR[record.level] || INK.muted;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        border: `1px solid ${color}`,
        background: `${color}1f`,
        color,
        fontFamily: FONT.ui,
        fontWeight: 700,
        fontSize: '0.64rem',
        letterSpacing: '0.1em',
        whiteSpace: 'nowrap',
        animation: motionSafe(reduced, record.level === 'alert' ? 'pulse-r 1.2s ease-in-out infinite' : 'none'),
      }}
    >
      {record.status}
    </span>
  );
}

function Spotlight({ record }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '10px 18px',
        margin: '0 12px 10px',
        padding: '10px 12px',
        border: `1px solid ${THREAT.HIGH}`,
        borderLeft: `3px solid ${THREAT.HIGH}`,
        background: 'rgba(208,59,59,0.08)',
      }}
    >
      <span style={{ fontFamily: FONT.display, fontSize: '0.8rem', letterSpacing: '0.18em', color: THREAT.HIGH }}>
        WATCHLIST MATCH
      </span>
      <Plate plate={record.plate} large />
      <span style={{ fontSize: '0.7rem', color: INK.primary, lineHeight: 1.5 }}>
        {record.make} · {record.color ?? '—'} · {record.year}
        <span style={{ display: 'block', fontSize: '0.6rem', color: INK.secondary, letterSpacing: '0.08em' }}>
          {record.status} · REG {record.rto} · FIRST SEEN {record.first_seen}
        </span>
      </span>
    </div>
  );
}

export function VehiclePanel({ vehicles, panelStyle, reduced }) {
  const [filter, setFilter] = useState('all');

  const counts = useMemo(
    () => ({
      live: vehicles.filter((v) => v.in_view).length,
      read: vehicles.filter((v) => v.plate).length,
      reading: vehicles.filter((v) => !v.plate && v.in_view).length,
      flagged: vehicles.filter((v) => v.level === 'alert').length,
    }),
    [vehicles]
  );

  // Vehicles whose plate has not been read yet are counted, not listed:
  // they sit at the top of a newest-first log and would crowd out real reads.
  const rows = useMemo(() => {
    const read = vehicles.filter((v) => v.plate);
    if (filter === 'live') return read.filter((v) => v.in_view);
    if (filter === 'flagged') return read.filter((v) => v.level === 'alert' || v.level === 'warn');
    return read;
  }, [vehicles, filter]);

  const spotlight = vehicles.find((v) => v.level === 'alert' && v.in_view)
    || vehicles.find((v) => v.level === 'alert');

  const th = {
    textAlign: 'left',
    padding: '6px 8px',
    fontFamily: FONT.ui,
    fontWeight: 600,
    fontSize: '0.58rem',
    letterSpacing: '0.18em',
    color: INK.muted,
    borderBottom: `1px solid ${INK.line}`,
    position: 'sticky',
    top: 0,
    background: SURFACE.panel,
    whiteSpace: 'nowrap',
  };
  const td = { padding: '6px 8px', borderBottom: `1px solid ${SURFACE.sunken}`, fontSize: '0.68rem', color: INK.secondary, verticalAlign: 'middle' };

  return (
    <section style={{ ...panelStyle, overflow: 'hidden' }} aria-label="Vehicle intelligence">
      <div
        style={{
          padding: '12px',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px 16px',
        }}
      >
        <h2
          style={{
            fontFamily: FONT.ui,
            fontWeight: 600,
            fontSize: '0.64rem',
            letterSpacing: '0.2em',
            color: INK.muted,
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: BRAND.red }} />
          VEHICLE INTELLIGENCE · ANPR
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontSize: '0.6rem', letterSpacing: '0.14em' }}>
          <span style={{ color: SERIES.vehicles }}>IN VIEW {counts.live}</span>
          <span style={{ color: INK.secondary }}>PLATES READ {counts.read}</span>
          <span style={{ color: INK.muted }}>READING {counts.reading}</span>
          <span style={{ color: counts.flagged ? THREAT.HIGH : INK.muted }}>WATCHLIST {counts.flagged}</span>
          <span
            title="Registration lookups use a simulated VAHAN feed in this build"
            style={{ border: `1px solid ${INK.line}`, padding: '1px 6px', color: INK.muted }}
          >
            VAHAN: SIMULATED
          </span>
        </div>
      </div>

      {spotlight && <Spotlight record={spotlight} />}

      <div role="group" aria-label="Filter vehicles" style={{ display: 'flex', gap: 6, padding: '0 12px 8px' }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            style={{
              fontFamily: FONT.mono,
              fontSize: '0.6rem',
              letterSpacing: '0.15em',
              padding: '3px 10px',
              cursor: 'pointer',
              border: `1px solid ${filter === f.key ? '#7a2a2a' : INK.line}`,
              background: filter === f.key ? 'rgba(204,0,0,0.12)' : 'transparent',
              color: filter === f.key ? '#ff6b6b' : INK.muted,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ maxHeight: 340, overflow: 'auto', borderTop: `1px solid ${INK.line}` }}>
        {rows.length === 0 ? (
          <p style={{ padding: '20px', textAlign: 'center', fontSize: '0.6rem', letterSpacing: '0.15em', color: INK.muted }}>
            {vehicles.length === 0
              ? 'NO VEHICLES DETECTED YET'
              : counts.read === 0
                ? 'READING PLATES…'
                : 'NO VEHICLES MATCH THIS FILTER'}
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th scope="col" style={th}>SEEN</th>
                <th scope="col" style={th}>PLATE</th>
                <th scope="col" style={th}>VEHICLE</th>
                <th scope="col" style={th}>COLOUR</th>
                <th scope="col" style={th}>SPEED</th>
                <th scope="col" style={th}>HEADING</th>
                <th scope="col" style={th}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr
                  key={v.id}
                  style={{
                    background: v.level === 'alert' ? 'rgba(208,59,59,0.08)' : 'transparent',
                    boxShadow: v.level === 'alert' ? `inset 3px 0 0 ${THREAT.HIGH}` : 'none',
                  }}
                >
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        marginRight: 6,
                        background: v.in_view ? THREAT.LOW : INK.faint,
                      }}
                    />
                    {v.first_seen}
                    <span className="sr-only">{v.in_view ? ', in view' : ', left frame'}</span>
                  </td>
                  <td style={td}>
                    <Plate plate={v.plate} />
                    {v.confidence && (
                      <span style={{ marginLeft: 6, fontSize: '0.56rem', color: INK.muted }}>
                        {Math.round(v.confidence * 100)}%
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    <span style={{ display: 'block', color: INK.primary }}>{v.make ?? '—'}</span>
                    <span style={{ display: 'block', fontSize: '0.56rem', letterSpacing: '0.12em', color: INK.muted }}>
                      {v.type}{v.year ? ` · ${v.year}` : ''}{v.rto ? ` · ${v.rto}` : ''}
                    </span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {v.color_hex && (
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          marginRight: 6,
                          verticalAlign: '-1px',
                          background: v.color_hex,
                          border: `1px solid ${INK.line}`,
                        }}
                      />
                    )}
                    {v.color ?? '—'}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontFamily: FONT.mono }}>
                    {v.speed_kmh ? `${v.speed_kmh} km/h` : '0 km/h'}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span aria-hidden="true" style={{ marginRight: 5 }}>{HEADING_ARROW[v.heading] ?? ''}</span>
                    {v.heading ?? '—'}
                  </td>
                  <td style={td}>
                    <Status record={v} reduced={reduced} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default VehiclePanel;
