import { fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { DEFAULT_FRAME_SIZE, aggregateThreat, scoreToThreat, threatToScore } from './theme';
import { toFramePoint } from './lib/useVideoContentRect';
import { newestAlertId } from './lib/useSurveillance';

// Environment stubs (ResizeObserver, IntersectionObserver, WebSocket,
// matchMedia, canvas) live in setupTests.js.

test('renders the landing page with Kavach branding', () => {
  render(<App />);
  const nav = screen.getByRole('navigation');
  expect(within(nav).getByText('KAVACH')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: /on the watch/i })).toBeInTheDocument();
});

test('exposes a keyboard-reachable route into the console', () => {
  render(<App />);
  expect(screen.getAllByRole('button', { name: /launch/i }).length).toBeGreaterThan(0);
});

test('gates the console behind the operator token', async () => {
  // No token in this environment, so entering must land on the gate rather than
  // a console whose socket will never open and whose controls reach nothing.
  // findBy rather than getBy: the landing page plays a 380ms exit before it
  // hands over.
  render(<App />);
  fireEvent.click(screen.getAllByRole('button', { name: /launch/i })[0]);

  expect(await screen.findByLabelText(/operator token/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /authorize console/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start detection/i })).not.toBeInTheDocument();
});

describe('threat scale', () => {
  test('maps levels to ordinals and back', () => {
    expect(threatToScore('LOW')).toBe(1);
    expect(threatToScore('MEDIUM')).toBe(2);
    expect(threatToScore('HIGH')).toBe(3);
    expect(scoreToThreat(1)).toBe('LOW');
    expect(scoreToThreat(3)).toBe('HIGH');
  });

  test('degrades unknown input to LOW instead of blanking the readout', () => {
    expect(threatToScore(undefined)).toBe(1);
    expect(threatToScore('BOGUS')).toBe(1);
    expect(scoreToThreat(99)).toBe('HIGH');
    expect(scoreToThreat(-4)).toBe('LOW');
  });

  test('aggregates zones to the highest threat present', () => {
    expect(aggregateThreat([])).toBe('LOW');
    expect(aggregateThreat(null)).toBe('LOW');
    expect(aggregateThreat([{ threat: 'LOW' }, { threat: 'HIGH' }, { threat: 'MEDIUM' }])).toBe('HIGH');
    expect(aggregateThreat([{ threat: 'LOW' }, { threat: 'MEDIUM' }])).toBe('MEDIUM');
  });
});

describe('draw overlay coordinate mapping', () => {
  // A 640x360 on-screen canvas is exactly half of the 1280x720 frame, so screen
  // point (320,180) must land dead-centre at (640,360) in frame space.
  const canvas = {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 640, height: 360 }),
  };

  test('maps a screen click into frame coordinates', () => {
    expect(toFramePoint({ clientX: 100, clientY: 50 }, canvas)).toEqual([0, 0]);
    expect(toFramePoint({ clientX: 420, clientY: 230 }, canvas)).toEqual([640, 360]);
    expect(toFramePoint({ clientX: 740, clientY: 410 }, canvas)).toEqual([1280, 720]);
  });

  test('rejects clicks outside the picture rather than clamping them onto it', () => {
    expect(toFramePoint({ clientX: 40, clientY: 230 }, canvas)).toBeNull();
    expect(toFramePoint({ clientX: 420, clientY: 900 }, canvas)).toBeNull();
    expect(toFramePoint({ clientX: 420, clientY: 230 }, null)).toBeNull();
  });

  test('honours a server-supplied frame size instead of the baked-in default', () => {
    // Frame geometry is server-authoritative. If the backend switches to 1920x1080
    // the same click must resolve into *that* space, or every zone the operator
    // draws guards the wrong pixels.
    const size = { width: 1920, height: 1080 };
    expect(toFramePoint({ clientX: 420, clientY: 230 }, canvas, size)).toEqual([960, 540]);
    expect(toFramePoint({ clientX: 740, clientY: 410 }, canvas, size)).toEqual([1920, 1080]);
  });

  test('falls back to the default when no frame size has arrived yet', () => {
    expect(toFramePoint({ clientX: 420, clientY: 230 }, canvas, undefined))
      .toEqual(toFramePoint({ clientX: 420, clientY: 230 }, canvas, DEFAULT_FRAME_SIZE));
  });
});

describe('alert freshness tracking', () => {
  // The server's alert log is a fixed-size ring. The console used to detect new
  // alerts by the array getting longer, so once the ring saturated the length
  // stopped changing and every later alert went unnoticed — chart markers
  // stopped appearing for the rest of the session. Ids survive truncation.
  const ring = (startId, count) =>
    Array.from({ length: count }, (_, i) => ({ id: startId + i, msg: 'x', time: '00:00:00' }));

  test('reports the highest id present', () => {
    expect(newestAlertId(ring(1, 12))).toBe(12);
  });

  test('keeps climbing after the log saturates at a fixed length', () => {
    const before = ring(1, 200);
    const after = ring(60, 200); // same length, newer window
    expect(before).toHaveLength(after.length);
    expect(newestAlertId(after)).toBeGreaterThan(newestAlertId(before));
  });

  test('degrades to 0 for empty or malformed input', () => {
    expect(newestAlertId([])).toBe(0);
    expect(newestAlertId(null)).toBe(0);
    expect(newestAlertId([{ msg: 'no id' }])).toBe(0);
  });
});
