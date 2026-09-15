import { useEffect, useMemo, useRef, useState } from 'react';
import { FONT, BRAND, INK } from '../theme';
import { useReducedMotion } from '../lib/useReducedMotion';

const SEP = '\u0000';

/**
 * Button (or link) that leans toward the cursor.
 *
 * The original signature destructured only {children, className, onClick, href}
 * and silently dropped everything else — so both call sites that passed `style`
 * (the nav CTA and ACCESS DASHBOARD) rendered at the wrong size. Extra props are
 * forwarded now, and the magnet is disabled under reduced-motion.
 */
export function MagneticBtn({
  children,
  className = 'cta-btn cta-primary',
  onClick,
  href,
  style,
  strength = 0.2,
  ...rest
}) {
  const ref = useRef(null);
  const reduced = useReducedMotion();

  const onMouseMove = (e) => {
    const node = ref.current;
    if (!node || reduced) return;
    const r = node.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    node.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
  };

  const reset = () => {
    const node = ref.current;
    if (node) node.style.transform = 'translate(0,0)';
  };

  const shared = {
    ref,
    className,
    style,
    onMouseMove,
    onMouseLeave: reset,
    onBlur: reset,
    ...rest,
  };

  if (href) {
    return (
      <a {...shared} href={href} onClick={onClick}>
        <span>{children}</span>
      </a>
    );
  }

  return (
    // Explicit type: a bare <button> inside a form defaults to submit.
    <button {...shared} type="button" onClick={onClick}>
      <span>{children}</span>
    </button>
  );
}

/** Fades content in once it scrolls into view. Immediate under reduced-motion. */
export function Reveal({ children, delay = 0, style }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      return undefined;
    }
    const node = ref.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(28px)',
        transition: reduced
          ? 'none'
          : `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Counts up to `end` when scrolled into view.
 *
 * The original started a 16ms setInterval and only disconnected the observer on
 * cleanup — unmounting mid-count (clicking LAUNCH while the stats bar animates)
 * leaked the interval and kept calling setState on a dead component.
 */
export function AnimatedStat({ end, suffix = '', label, duration = 1100 }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const target = parseFloat(end);
  const decimals = String(end).includes('.') ? 1 : 0;
  const [value, setValue] = useState(() => (reduced ? target : 0));

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    if (reduced) {
      setValue(target);
      return undefined;
    }

    let raf = 0;
    let startTs = 0;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const step = (ts) => {
          if (!startTs) startTs = ts;
          const p = Math.min((ts - startTs) / duration, 1);
          const eased = 1 - (1 - p) ** 3;
          setValue(target * eased);
          if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.5 }
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf); // ← the leak
    };
  }, [target, duration, reduced]);

  return (
    <div ref={ref} style={{ textAlign: 'center' }}>
      <div
        style={{
          fontFamily: FONT.display,
          fontSize: 'clamp(2.2rem, 6vw, 3.2rem)',
          lineHeight: 1,
          color: BRAND.red,
          textShadow: `0 0 40px ${BRAND.redGlow}`,
          letterSpacing: '-0.02em',
        }}
      >
        {value.toFixed(decimals)}
        {suffix}
      </div>
      <div
        style={{
          fontFamily: FONT.ui,
          fontWeight: 400,
          fontSize: '0.72rem',
          letterSpacing: '0.25em',
          color: INK.muted,
          marginTop: '6px',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Cycles through `texts`.
 *
 * Callers pass an inline array literal, which is a new reference on every
 * parent render. That array was in the effect's dep list, so while the landing
 * page re-rendered on scroll the timer was cleared and restarted continuously
 * and the animation stalled. Depending on the joined *contents* makes it stable
 * regardless of how the caller passes it.
 */
export function Typewriter({ texts, speed = 80, pause = 2000 }) {
  const reduced = useReducedMotion();
  const key = Array.isArray(texts) ? texts.join(SEP) : String(texts ?? '');
  const list = useMemo(() => key.split(SEP).filter(Boolean), [key]);

  const [display, setDisplay] = useState('');
  const [index, setIndex] = useState(0);
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    setDisplay('');
    setIndex(0);
    setTyping(true);
  }, [key]);

  useEffect(() => {
    if (reduced || list.length === 0) return undefined;

    const current = list[index % list.length];
    let timer;

    if (typing) {
      timer =
        display.length < current.length
          ? setTimeout(() => setDisplay(current.slice(0, display.length + 1)), speed)
          : setTimeout(() => setTyping(false), pause);
    } else if (display.length > 0) {
      timer = setTimeout(() => setDisplay(display.slice(0, -1)), speed / 2);
    } else {
      setIndex((i) => (i + 1) % list.length);
      setTyping(true);
    }

    return () => clearTimeout(timer);
  }, [display, typing, index, list, speed, pause, reduced]);

  if (reduced) return <span>{list[0] ?? ''}</span>;

  return (
    <span>
      {display}
      <span aria-hidden="true" style={{ animation: 'blink 1s step-end infinite', color: BRAND.red }}>
        |
      </span>
    </span>
  );
}
