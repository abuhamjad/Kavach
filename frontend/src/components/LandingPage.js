import { useEffect, useRef, useState } from 'react';
import { BRAND, FONT, INK, SURFACE } from '../theme';
import { useReducedMotion, motionSafe } from '../lib/useReducedMotion';
import { AnimatedStat, MagneticBtn, Reveal, Typewriter } from './Motion';
import { ParticleField } from './ParticleField';
import { Ic } from './Icons';

const NAV_LINKS = [
  ['#about', 'ABOUT'],
  ['#mission', 'MISSION'],
  ['#system', 'SYSTEM'],
];

const STATS = [
  ['99.7', '%', 'Detection Accuracy'],
  ['50', 'ms', 'Response Time'],
  ['24', 'h', 'Active Monitoring'],
  ['360', '°', 'Perimeter Coverage'],
];

const VALUES = [
  {
    Icon: Ic.Target,
    n: '01',
    title: 'MISSION',
    desc: 'To provide impenetrable border security through advanced AI-powered detection and rapid response systems that never sleep.',
  },
  {
    Icon: Ic.Eye,
    n: '02',
    title: 'VISION',
    desc: 'A future where borders are secured autonomously, minimizing human risk while maximizing detection accuracy and perimeter coverage.',
  },
  {
    Icon: Ic.Zap,
    n: '03',
    title: 'GOAL',
    desc: 'Deploy real-time AI surveillance across critical sectors, reducing intrusion incidents through intelligent multi-layer threat classification.',
  },
];

const TYPED = [
  'Technological unit deploying AI-powered border defense.',
  'Real-time threat detection across all sectors.',
  'Zero intrusion. Zero compromise. Zero failure.',
  'Protecting perimeters with machine precision.',
];

/**
 * Sector display. Replaces the two `picsum.photos` placeholders the landing page
 * used to load — the README promises the system runs fully offline, and a
 * surveillance console should not be fetching decoration from a third party.
 * Pure inline SVG, no network.
 */
function RadarPanel({ reduced }) {
  return (
    <svg
      viewBox="0 0 400 340"
      role="img"
      aria-label="Stylised radar sweep over a monitored sector"
      style={{ width: '100%', display: 'block', background: '#0a0606' }}
    >
      <defs>
        <radialGradient id="rp-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#cc0000" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#cc0000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="rp-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#cc0000" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#cc0000" stopOpacity="0" />
        </linearGradient>
        <pattern id="rp-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M28 0H0v28" fill="none" stroke="#cc0000" strokeOpacity="0.07" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="400" height="340" fill="url(#rp-grid)" />
      <circle cx="200" cy="170" r="150" fill="url(#rp-glow)" />

      {[52, 92, 132, 150].map((r) => (
        <circle key={r} cx="200" cy="170" r={r} fill="none" stroke="#cc0000" strokeOpacity="0.22" strokeWidth="1" />
      ))}
      <line x1="50" y1="170" x2="350" y2="170" stroke="#cc0000" strokeOpacity="0.16" />
      <line x1="200" y1="20" x2="200" y2="320" stroke="#cc0000" strokeOpacity="0.16" />

      <g transform="translate(200 170)">
        <path d="M0 0 L150 0 A150 150 0 0 0 106 -106 Z" fill="url(#rp-sweep)">
          {!reduced && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0"
              to="360"
              dur="4s"
              repeatCount="indefinite"
            />
          )}
        </path>
      </g>

      {[
        [262, 120, 'TRK-04'],
        [150, 214, 'TRK-07'],
        [228, 236, 'TRK-11'],
      ].map(([x, y, id]) => (
        <g key={id}>
          <rect x={x - 9} y={y - 9} width="18" height="18" fill="none" stroke="#d95926" strokeWidth="1.2" />
          <circle cx={x} cy={y} r="2.5" fill="#d95926">
            {!reduced && <animate attributeName="opacity" values="1;0.25;1" dur="2s" repeatCount="indefinite" />}
          </circle>
          <text x={x + 14} y={y + 4} fill="#8a7070" fontSize="8" fontFamily="'Share Tech Mono', monospace">
            {id}
          </text>
        </g>
      ))}

      <text x="16" y="326" fill="#5f4444" fontSize="9" fontFamily="'Share Tech Mono', monospace" letterSpacing="1.5">
        CAM-ALPHA // ACTIVE
      </text>
    </svg>
  );
}

export function LandingPage({ onEnter }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const reduced = useReducedMotion();
  const exitTimer = useRef(0);

  // The original wrote raw window.scrollY into state on every scroll event,
  // re-rendering the whole landing tree per tick (and, through the inline
  // Typewriter `texts` array, resetting the typing animation continuously).
  // Only the boolean threshold is actually used, and it is rAF-coalesced.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrolled(window.scrollY > 40);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  // Close the mobile menu on Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const handleEnter = () => {
    setMenuOpen(false);
    if (reduced) {
      onEnter();
      return;
    }
    setExiting(true);
    exitTimer.current = setTimeout(onEnter, 380);
  };

  const heading = (size) => ({
    fontFamily: FONT.display,
    fontSize: size,
    letterSpacing: '-0.01em',
    lineHeight: 0.9,
    color: '#fff',
  });

  return (
    <div className={`scanlines ${exiting ? 'page-exit' : 'page-enter'}`} style={{ minHeight: '100vh', background: SURFACE.page }}>
      <nav
        className="landing-nav"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: scrolled ? 'rgba(13,13,13,0.95)' : 'transparent',
          backdropFilter: 'blur(14px)',
          borderBottom: `1px solid ${scrolled ? INK.line : 'transparent'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'background 0.4s, border-color 0.4s',
        }}
      >
        <a href="#top" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none' }}>
          <span style={{ width: 36, height: 36, border: '1px solid #5a1010', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND.red }}>
            <Ic.Shield />
          </span>
          <span>
            <span style={{ display: 'block', fontFamily: FONT.display, fontSize: '1rem', letterSpacing: '0.15em', color: '#fff', lineHeight: 1.1 }}>
              KAVACH
            </span>
            <span style={{ display: 'block', fontFamily: FONT.mono, fontSize: '0.46rem', letterSpacing: '0.2em', color: INK.muted }}>
              BORDER SURVEILLANCE
            </span>
          </span>
        </a>

        {/* The hamburger and the menu state existed in the original but were never
            rendered or read — the nav simply overflowed on narrow screens. */}
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <Ic.X /> : <Ic.Menu />}
        </button>

        <div id="primary-nav" className="nav-links" data-open={menuOpen}>
          {NAV_LINKS.map(([href, label]) => (
            <a key={href} href={href} className="nav-link" onClick={() => setMenuOpen(false)}>
              {label}
            </a>
          ))}
          <MagneticBtn className="cta-btn cta-primary cta-sm" onClick={handleEnter}>
            LAUNCH SYSTEM <Ic.Arrow />
          </MagneticBtn>
        </div>
      </nav>

      <section
        id="top"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          paddingTop: '68px',
        }}
      >
        <ParticleField />

        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            background:
              'radial-gradient(ellipse 120% 80% at 50% 100%, rgba(26,0,0,0.5) 0%, #0d0d0d 70%),' +
              'radial-gradient(circle at 18% 22%, rgba(204,0,0,0.05) 0%, transparent 40%),' +
              'radial-gradient(circle at 82% 30%, rgba(204,0,0,0.04) 0%, transparent 38%)',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            backgroundImage:
              'linear-gradient(to right,rgba(204,0,0,0.04) 1px,transparent 1px),linear-gradient(to bottom,rgba(204,0,0,0.04) 1px,transparent 1px)',
            backgroundSize: '60px 60px',
            animation: motionSafe(reduced, 'gridDrift 20s linear infinite'),
          }}
        />

        <div style={{ position: 'relative', zIndex: 3, maxWidth: '1100px', margin: '0 auto', padding: '0 24px', textAlign: 'center' }}>
          <div
            className="hero-1"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '5px 16px',
              border: '1px solid #5a1010',
              background: 'rgba(204,0,0,0.05)',
              marginBottom: '28px',
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 5, height: 5, borderRadius: '50%', background: BRAND.red, animation: motionSafe(reduced, 'pulse-r 1.5s ease-in-out infinite') }}
            />
            <span style={{ fontFamily: FONT.mono, fontSize: '0.58rem', letterSpacing: '0.25em', color: '#ff6b6b' }}>
              SYSTEM ACTIVE · THREAT MONITORING ONLINE
            </span>
          </div>

          <h1 className="hero-2" style={{ ...heading('clamp(2.8rem,13vw,11rem)'), marginBottom: '4px' }}>
            ON THE WATCH
          </h1>
          <p
            className="hero-3"
            style={{
              ...heading('clamp(2.8rem,13vw,11rem)'),
              marginBottom: '8px',
              background: 'linear-gradient(180deg, #c8c0bc 0%, #4a3838 60%, #1a0f0f 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            AT YOUR
          </p>
          <p
            className="hero-3"
            style={{
              ...heading('clamp(2.8rem,13vw,11rem)'),
              marginBottom: '40px',
              background: 'linear-gradient(180deg, #8a7070 0%, #2a1010 80%, #0d0d0d 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            BORDERS
          </p>

          <div
            className="hero-4"
            style={{ fontFamily: FONT.ui, fontWeight: 300, fontSize: '1.15rem', letterSpacing: '0.05em', color: INK.muted, marginBottom: '48px', minHeight: '3rem' }}
          >
            <Typewriter texts={TYPED} />
          </div>

          <div className="hero-5" style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <MagneticBtn className="cta-btn cta-primary" onClick={handleEnter}>
              LAUNCH DETECTION SYSTEM <Ic.ArrowRight />
            </MagneticBtn>
            <MagneticBtn className="cta-btn cta-outline" href="#about">
              LEARN MORE
            </MagneticBtn>
          </div>
        </div>

        <div
          aria-hidden="true"
          style={{ position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)', zIndex: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}
        >
          <span style={{ fontFamily: FONT.mono, fontSize: '0.5rem', letterSpacing: '0.2em', color: INK.muted }}>SCROLL</span>
          <span style={{ width: 1, height: 48, background: `linear-gradient(${BRAND.red},transparent)`, animation: motionSafe(reduced, 'pulse-r 2s ease-in-out infinite') }} />
        </div>
      </section>

      <div className="stats-bar" style={{ borderTop: `1px solid ${INK.line}`, borderBottom: `1px solid ${INK.line}`, display: 'grid' }}>
        {STATS.map(([n, s, l], i) => (
          <div key={l} style={{ padding: '36px 24px', borderRight: i < STATS.length - 1 ? `1px solid ${INK.line}` : 'none' }}>
            <AnimatedStat end={n} suffix={s} label={l} />
          </div>
        ))}
      </div>

      <section id="about" style={{ padding: 'clamp(64px,10vw,120px) 24px', maxWidth: '1200px', margin: '0 auto' }}>
        <div className="about-grid" style={{ display: 'grid', alignItems: 'center' }}>
          <div>
            <Reveal>
              <p className="section-tag">{'// 01 — ABOUT THE SYSTEM'}</p>
              <h2 style={{ ...heading('clamp(2.2rem,6vw,5.5rem)'), lineHeight: 0.88, marginBottom: '32px' }}>
                MADE BY
                <br />
                <span style={{ background: 'linear-gradient(135deg,#cc0000,#7a0000)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  TEAM BOOMER
                </span>
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <div style={{ fontFamily: FONT.ui, fontWeight: 300, fontSize: '1.05rem', lineHeight: 1.8, color: INK.muted, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p>
                  We are building a new architecture for border surveillance. Utilizing cutting-edge AI, computer vision,
                  and real-time object tracking to secure perimeters with unprecedented accuracy.
                </p>
                <p>
                  YOLOv8-powered detection engines with multi-zone threat classification, loitering detection, crowd
                  surge analysis, and suspicious movement tracking — all in real-time.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.15}>
            <div style={{ position: 'relative', border: `1px solid ${INK.line}` }}>
              <RadarPanel reduced={reduced} />
            </div>
          </Reveal>
        </div>
      </section>

      <section id="mission" style={{ padding: 'clamp(64px,10vw,120px) 24px', borderTop: `1px solid ${INK.line}`, background: '#0a0808' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <Reveal>
            <div style={{ textAlign: 'center', marginBottom: '56px' }}>
              <p className="section-tag">{'// 02 — CORE DIRECTIVES'}</p>
              <h2 style={heading('clamp(2.2rem,7vw,5.5rem)')}>
                OUR CORE <span style={{ color: INK.muted }}>VALUES</span>
              </h2>
            </div>
          </Reveal>

          <div className="values-grid" style={{ display: 'grid', gap: '1px', background: INK.line }}>
            {VALUES.map(({ Icon, n, title, desc }, i) => (
              <Reveal key={n} delay={i * 0.1}>
                <div className="feature-card">
                  <div style={{ fontFamily: FONT.display, fontSize: '3rem', letterSpacing: '0.05em', color: INK.line, lineHeight: 1, marginBottom: '16px' }}>
                    {n}
                  </div>
                  <div style={{ color: BRAND.red, marginBottom: '16px' }}>
                    <Icon />
                  </div>
                  <h3 style={{ fontFamily: FONT.display, fontSize: '1.4rem', letterSpacing: '0.1em', color: INK.secondary, marginBottom: '14px', fontWeight: 400 }}>
                    {title}
                  </h3>
                  <p style={{ fontFamily: FONT.ui, fontWeight: 300, fontSize: '0.95rem', lineHeight: 1.7, color: INK.muted }}>{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="system" style={{ padding: 'clamp(80px,12vw,140px) 24px', borderTop: `1px solid ${INK.line}`, position: 'relative', overflow: 'hidden' }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(to right,rgba(204,0,0,0.03) 1px,transparent 1px),linear-gradient(to bottom,rgba(204,0,0,0.03) 1px,transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <Reveal>
          <div style={{ position: 'relative', zIndex: 1, maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
            <p className="section-tag">{'// 03 — DETECTION ENGINE'}</p>
            <h2 style={{ ...heading('clamp(2.4rem,9vw,7rem)'), lineHeight: 0.88, marginBottom: '24px' }}>
              INTELLIGENCE
              <br />
              <span style={{ background: 'linear-gradient(135deg,#cc0000,#9a0000)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                THAT NEVER SLEEPS
              </span>
            </h2>
            <p style={{ fontFamily: FONT.ui, fontWeight: 300, fontSize: '1.1rem', lineHeight: 1.7, color: INK.muted, marginBottom: '48px' }}>
              Experience our real-time AI-powered threat detection dashboard. Draw restricted zones, set tripwires,
              monitor sectors, and receive instant threat alerts.
            </p>
            <MagneticBtn className="cta-btn cta-primary cta-lg" onClick={handleEnter}>
              <Ic.Shield /> ACCESS DASHBOARD
            </MagneticBtn>
          </div>
        </Reveal>
      </section>

      <footer style={{ background: '#0a0808', borderTop: `1px solid ${INK.line}`, padding: '72px 24px 36px' }}>
        <div className="footer-grid" style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', marginBottom: '48px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <span style={{ width: 40, height: 40, border: '1px solid #5a1010', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND.red }}>
                <Ic.Shield />
              </span>
              <span>
                <span style={{ display: 'block', fontFamily: FONT.display, fontSize: '1rem', letterSpacing: '0.15em', color: '#fff' }}>KAVACH</span>
                <span style={{ display: 'block', fontFamily: FONT.mono, fontSize: '0.46rem', letterSpacing: '0.2em', color: INK.muted }}>
                  BORDER SURVEILLANCE AI
                </span>
              </span>
            </div>
            <p style={{ fontFamily: FONT.ui, fontWeight: 300, fontSize: '0.9rem', lineHeight: 1.7, color: INK.muted, maxWidth: '260px' }}>
              Advanced AI-powered border surveillance. Real-time threat detection and perimeter monitoring.
            </p>
          </div>

          <div>
            <h3 style={{ fontFamily: FONT.display, fontSize: '0.85rem', letterSpacing: '0.2em', color: INK.secondary, marginBottom: '20px', fontWeight: 400 }}>
              NAVIGATION
            </h3>
            {[['#about', 'About Us'], ['#mission', 'Mission'], ['#system', 'Detection']].map(([href, label]) => (
              <div key={href} style={{ marginBottom: '12px' }}>
                <a href={href} className="nav-link" style={{ fontSize: '0.9rem', letterSpacing: '0.05em', textTransform: 'none' }}>
                  {label}
                </a>
              </div>
            ))}
          </div>

          <div>
            <h3 style={{ fontFamily: FONT.display, fontSize: '0.85rem', letterSpacing: '0.2em', color: INK.secondary, marginBottom: '20px', fontWeight: 400 }}>
              CONTACT
            </h3>
            {[
              [<Ic.Mail key="m" />, 'contact@kavach-ai.in'],
              [<Ic.Pin key="p" />, 'Command Center Alpha'],
            ].map(([icon, text]) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', color: INK.muted, fontFamily: FONT.ui, fontSize: '0.9rem' }}>
                {icon}
                {text}
              </div>
            ))}
          </div>
        </div>

        <div style={{ maxWidth: '1200px', margin: '0 auto', borderTop: `1px solid ${INK.line}`, paddingTop: '24px', textAlign: 'center' }}>
          <span style={{ fontFamily: FONT.mono, fontSize: '0.52rem', letterSpacing: '0.15em', color: INK.muted }}>
            © {new Date().getFullYear()} KAVACH BORDER SURVEILLANCE AI · BUILT FOR SMART INDIA HACKATHON 2026
          </span>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
