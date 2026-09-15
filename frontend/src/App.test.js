import { render, screen, within } from '@testing-library/react';
import App from './App';
import { aggregateThreat, scoreToThreat, threatToScore } from './theme';
import { toFramePoint } from './lib/useVideoContentRect';

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
});
