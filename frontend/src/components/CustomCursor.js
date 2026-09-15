import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';

const INTERACTIVE = 'button, a, [role="switch"], [role="button"], input, .feature-card';

/**
 * Decorative pointer. Renders only on a fine pointer and only when the user has
 * not asked for reduced motion — and it is the thing that hides the system
 * cursor, via a body class it adds on mount and removes on unmount. Previously a
 * blanket `body { cursor: none }` lived in global CSS, which left touch users
 * (and anyone who hit a JS error before this mounted) with no pointer at all.
 */
export function CustomCursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const target = useRef({ x: -100, y: -100 });
  const ring = useRef({ x: -100, y: -100 });
  const reduced = useReducedMotion();

  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia?.('(pointer: fine)').matches ?? false;
    setEnabled(fine && !reduced);
  }, [reduced]);

  useEffect(() => {
    if (!enabled) return undefined;

    document.body.classList.add('has-custom-cursor');

    const onMove = (e) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;

      // `closest` on the event target is a cheap tree walk. The previous code
      // called document.elementFromPoint() on every mousemove, forcing a
      // synchronous hit-test (and layout) per event.
      const hovering = e.target instanceof Element && e.target.closest(INTERACTIVE) !== null;
      dotRef.current?.classList.toggle('is-hover', hovering);
      ringRef.current?.classList.toggle('is-hover', hovering);
    };

    let raf = 0;
    const tick = () => {
      const { x, y } = target.current;
      ring.current.x += (x - ring.current.x) * 0.16;
      ring.current.y += (y - ring.current.y) * 0.16;

      // transform, not left/top — avoids a layout pass per frame.
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform =
          `translate3d(${ring.current.x}px, ${ring.current.y}px, 0) translate(-50%, -50%)`;
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
      document.body.classList.remove('has-custom-cursor');
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <div ref={dotRef} className="custom-cursor" aria-hidden="true" />
      <div ref={ringRef} className="custom-cursor-ring" aria-hidden="true" />
    </>
  );
}

export default CustomCursor;
