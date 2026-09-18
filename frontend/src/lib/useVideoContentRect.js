import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_FRAME_SIZE } from '../theme';

/**
 * Geometry of the *letterboxed video content* inside its container.
 *
 * The feed is rendered with `object-fit: contain`, so when the container's
 * aspect ratio differs from the frame's 16:9 the picture does not fill the box —
 * it is centred with bars on two sides. Mapping a click with a naive
 * `clientX - box.left` scaled by `FRAME_W / box.width` is therefore wrong by
 * however wide those bars are, which is exactly how operator-drawn zones ended
 * up guarding the wrong pixels.
 *
 * This returns the real content rect (relative to the container) plus the scale
 * factor, so the overlay canvas can be positioned dead-on and clicks converted
 * exactly.
 */
export function useVideoContentRect(containerRef, frameSize = DEFAULT_FRAME_SIZE) {
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0, scale: 0 });
  const frame = useRef(0);

  const frameW = frameSize?.width || DEFAULT_FRAME_SIZE.width;
  const frameH = frameSize?.height || DEFAULT_FRAME_SIZE.height;

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    // `contain` scales to the limiting dimension.
    const scale = Math.min(width / frameW, height / frameH);
    const w = frameW * scale;
    const h = frameH * scale;

    setRect((prev) => {
      const next = { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h, scale };
      const same =
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.top - next.top) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.height - next.height) < 0.5;
      return same ? prev : next;
    });
  }, [containerRef, frameW, frameH]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    measure();

    // Coalesce burst resizes into one measurement per frame.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    });
    observer.observe(el);

    return () => {
      cancelAnimationFrame(frame.current);
      observer.disconnect();
    };
  }, [containerRef, measure]);

  return rect;
}

/**
 * Viewport point → frame coordinate, or null when the click landed on a
 * letterbox bar (outside the picture) and therefore means nothing.
 */
export function toFramePoint(event, canvas, frameSize = DEFAULT_FRAME_SIZE) {
  if (!canvas) return null;
  const box = canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;

  const frameW = frameSize?.width || DEFAULT_FRAME_SIZE.width;
  const frameH = frameSize?.height || DEFAULT_FRAME_SIZE.height;

  const x = Math.round(((event.clientX - box.left) / box.width) * frameW);
  const y = Math.round(((event.clientY - box.top) / box.height) * frameH);

  if (x < 0 || y < 0 || x > frameW || y > frameH) return null;
  return [x, y];
}
