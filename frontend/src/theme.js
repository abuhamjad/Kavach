// ─────────────────────────────────────────────────────────────────────────────
//  Kavach — design tokens
//
//  DATA colours (series + threat) are validated, not chosen by eye. Before
//  changing any hex in SERIES or THREAT, re-run the dataviz validator against
//  the panel surface these marks actually render on:
//
//    node scripts/validate_palette.js "#3987e5,#d95926" --mode dark --surface "#0a0808"
//
//  Current results (all checks pass):
//    SERIES  persons↔vehicles  CVD ΔE 26.8 (protan) · 32.4 (tritan) · normal 31.8
//    THREAT  low↔med↔high      CVD ΔE 11.3 worst adjacent · all ≥ 3:1 on surface
//
//  CHROME colours below are brand decoration (borders, glows, brand wordmark).
//  They never encode a value, so they are not bound by the palette gates.
// ─────────────────────────────────────────────────────────────────────────────

export const FONT = {
  display: "'Anton', Impact, 'Arial Narrow Bold', sans-serif",
  ui: "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif",
  mono: "'Share Tech Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace",
};

export const SURFACE = {
  page: '#0d0d0d',
  panel: '#0a0808',
  raised: '#110808',
  sunken: '#080606',
};

export const INK = {
  primary: '#f2ebe8',
  secondary: '#c8baba',
  muted: '#8a7070',
  faint: '#5f4444',
  // Hairlines. `line` is the workhorse panel border.
  line: '#4a3030',
  lineSoft: '#2a1a1a',
};

export const BRAND = {
  red: '#cc0000',
  redDim: '#882200',
  redGlow: 'rgba(204,0,0,0.25)',
};

// Categorical — identity, not magnitude. Fixed slot order, never cycled.
export const SERIES = {
  persons: '#3987e5',
  vehicles: '#d95926',
};

// Status — reserved. Never reused as a series colour. Always shipped with a
// text label (see <ThreatLevel/>), never hue alone.
export const THREAT = {
  LOW: '#0ca30c',
  MEDIUM: '#fab219',
  HIGH: '#d03b3b',
};

export const THREAT_ORDER = ['LOW', 'MEDIUM', 'HIGH'];

/** Threat label → ordinal score (1-3). Unknown/missing degrades to LOW. */
export function threatToScore(level) {
  const i = THREAT_ORDER.indexOf(level);
  return i === -1 ? 1 : i + 1;
}

/** Ordinal score → threat label. Clamped, so a bad score can never blank the UI. */
export function scoreToThreat(score) {
  const i = Math.min(THREAT_ORDER.length, Math.max(1, Math.round(score))) - 1;
  return THREAT_ORDER[i];
}

/** Highest threat present across zones. Empty/!Array → LOW. */
export function aggregateThreat(zones) {
  if (!Array.isArray(zones) || zones.length === 0) return 'LOW';
  return scoreToThreat(
    zones.reduce((max, z) => Math.max(max, threatToScore(z?.threat)), 1)
  );
}

export const threatColor = (level) => THREAT[level] || THREAT.LOW;

// Video geometry the backend encodes at (detect.py resizes every frame to this).
// The draw overlay maps clicks into this space, so it must stay in sync.
export const FRAME_W = 1280;
export const FRAME_H = 720;
