import { useEffect, useState } from 'react';

/**
 * Tracks `prefers-reduced-motion`. The console flashes red on HIGH threat and
 * runs several infinite animations; all of them must be suppressible, both as a
 * WCAG 2.3.1 (seizure) concern and for operators on long shifts.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** Returns `animation` shorthand, or 'none' when the user opted out of motion. */
export const motionSafe = (reduced, animation) => (reduced ? 'none' : animation);
