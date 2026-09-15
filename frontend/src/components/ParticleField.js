import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';

const LINK_DIST = 100;
const REPEL_DIST = 120;
const MAX_PARTICLES = 90;
const AREA_PER_PARTICLE = 22000; // px² — scales the count to the viewport

/**
 * Decorative particle field.
 *
 * Fixes over the original: the neighbour search was O(n²) (80 particles → 3,160
 * distance checks per frame, forever, even on a hidden tab), a particle sitting
 * exactly under the cursor divided by a zero distance and became permanently
 * NaN, and `getContext` was never null-checked — which is what made the test
 * suite explode under jsdom.
 */
export function ParticleField() {
  const canvasRef = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    // jsdom (and any canvas-less environment) returns null here.
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return undefined;

    const mouse = { x: -9999, y: -9999 };
    let width = 0;
    let height = 0;
    let particles = [];
    let raf = 0;
    let running = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth || window.innerWidth;
      height = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.min(MAX_PARTICLES, Math.round((width * height) / AREA_PER_PARTICLE));
      if (particles.length > target) particles.length = target;
      while (particles.length < target) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          size: Math.random() * 1.5 + 0.5,
          opacity: Math.random() * 0.4 + 0.1,
        });
      }
    };

    const onMove = (e) => {
      const box = canvas.getBoundingClientRect();
      mouse.x = e.clientX - box.left;
      mouse.y = e.clientY - box.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    // Uniform spatial grid: each particle only tests the 8 neighbouring cells,
    // turning the O(n²) sweep into roughly O(n).
    const cell = LINK_DIST;
    const grid = new Map();
    const key = (cx, cy) => `${cx},${cy}`;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      grid.clear();

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        else if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        else if (p.y > height) p.y = 0;

        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const distSq = dx * dx + dy * dy;
        // `> 0` guard: an exact overlap gave 0/0 = NaN and killed the particle.
        if (distSq > 0 && distSq < REPEL_DIST * REPEL_DIST) {
          const dist = Math.sqrt(distSq);
          const force = (REPEL_DIST - dist) / REPEL_DIST;
          p.x += (dx / dist) * force * 2;
          p.y += (dy / dist) * force * 2;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,20,20,${p.opacity})`;
        ctx.fill();

        const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
        const bucket = grid.get(k);
        if (bucket) bucket.push(p);
        else grid.set(k, [p]);
      }

      ctx.lineWidth = 0.5;
      for (const [k, bucket] of grid) {
        const [cx, cy] = k.split(',').map(Number);
        for (let ox = 0; ox <= 1; ox++) {
          for (let oy = ox === 0 ? 0 : -1; oy <= 1; oy++) {
            const other = ox === 0 && oy === 0 ? bucket : grid.get(key(cx + ox, cy + oy));
            if (!other) continue;
            for (let i = 0; i < bucket.length; i++) {
              const a = bucket[i];
              for (let j = other === bucket ? i + 1 : 0; j < other.length; j++) {
                const b = other[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const dSq = dx * dx + dy * dy;
                if (dSq >= LINK_DIST * LINK_DIST) continue;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.strokeStyle = `rgba(150,10,10,${0.15 * (1 - Math.sqrt(dSq) / LINK_DIST)})`;
                ctx.stroke();
              }
            }
          }
        }
      }

      if (running) raf = requestAnimationFrame(draw);
    };

    // Stop burning CPU on a backgrounded tab.
    const onVisibility = () => {
      const shouldRun = !document.hidden;
      if (shouldRun === running) return;
      running = shouldRun;
      if (running) raf = requestAnimationFrame(draw);
      else cancelAnimationFrame(raf);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseout', onLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduced]);

  // A continuously animating field is exactly what reduced-motion is for.
  if (reduced) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', width: '100%', height: '100%' }}
    />
  );
}

export default ParticleField;
