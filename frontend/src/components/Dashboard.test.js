import { act, render, screen, waitFor, within } from '@testing-library/react';
import { Dashboard } from './Dashboard';

/**
 * Controllable WebSocket double. Tracks every instance ever constructed, which
 * is how we assert the reconnect loop does not outlive the component.
 */
class MockSocket {
  static instances = [];

  static reset() {
    MockSocket.instances = [];
  }

  static get last() {
    return MockSocket.instances[MockSocket.instances.length - 1];
  }

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    MockSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  emit(payload) {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }
}

const frameOf = (state) => ({
  frame: 'AAAA',
  alerts: [],
  zones: [],
  total_persons: 0,
  total_vehicles: 0,
  night: false,
  surge: false,
  modes: { loitering: true, night: true, surge: true },
  setup_done: true,
  ...state,
});

/** Advance past the hook's telemetry commit interval (200ms). */
const flush = async (ms = 250) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

/**
 * Reads a StatTile's value by its label. Scoped to the stat row because both the
 * raw digits (footer readout) and the labels themselves (chart legend) appear
 * more than once on the page.
 */
const statValue = (label) => {
  const row = document.querySelector('.stat-row');
  return within(row).getByText(label).previousSibling.textContent;
};

beforeEach(() => {
  MockSocket.reset();
  global.WebSocket = MockSocket;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'ok' }) });
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('renders telemetry pushed over the socket', async () => {
  render(<Dashboard onBack={() => {}} />);
  act(() => MockSocket.last.open());

  act(() =>
    MockSocket.last.emit(
      frameOf({
        total_persons: 7,
        total_vehicles: 3,
        zones: [{ name: 'SECTOR-A', threat: 'HIGH', persons: 4, vehicles: 1 }],
        alerts: [{ time: '12:00:01', msg: 'INTRUSION IN SECTOR-A' }],
      })
    )
  );
  await flush();

  expect(statValue('PERSONS')).toBe('7');
  expect(statValue('VEHICLES')).toBe('3');
  expect(statValue('ZONES')).toBe('1');
  expect(statValue('ALERTS')).toBe('1');
  expect(screen.getByText('SECTOR-A')).toBeInTheDocument();
  expect(screen.getByText('INTRUSION IN SECTOR-A')).toBeInTheDocument();
  // Threat chip appears in the header and on the zone row.
  expect(screen.getAllByText('HIGH').length).toBeGreaterThan(0);
});

test('a malformed payload does not tear down the stream', async () => {
  render(<Dashboard onBack={() => {}} />);
  act(() => MockSocket.last.open());

  act(() => MockSocket.last.emit('{ this is not json'));
  await flush();

  // Still mounted, still live, and a subsequent good frame is applied.
  act(() => MockSocket.last.emit(frameOf({ total_persons: 12 })));
  await flush();

  expect(statValue('PERSONS')).toBe('12');
  expect(screen.getByRole('status')).toHaveTextContent('LIVE');
});

test('does not reconnect after unmount', async () => {
  const { unmount } = render(<Dashboard onBack={() => {}} />);
  act(() => MockSocket.last.open());
  expect(MockSocket.instances).toHaveLength(1);

  unmount();

  // The old implementation closed the socket in cleanup, which fired onclose,
  // which unconditionally scheduled connect() again — leaving an immortal
  // reconnect loop behind on every navigation.
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });

  expect(MockSocket.instances).toHaveLength(1);
  expect(MockSocket.instances[0].closed).toBe(true);
});

test('reconnects while still mounted when the socket drops', async () => {
  render(<Dashboard onBack={() => {}} />);
  act(() => MockSocket.last.open());
  expect(MockSocket.instances).toHaveLength(1);

  act(() => MockSocket.last.close());
  expect(await screen.findByText('OFFLINE')).toBeInTheDocument();

  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  expect(MockSocket.instances.length).toBeGreaterThan(1);
});

test('a rejected mode toggle surfaces an error and does not flip the switch', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

  render(<Dashboard onBack={() => {}} />);
  act(() => MockSocket.last.open());
  act(() => MockSocket.last.emit(frameOf({ modes: { loitering: true, night: true, surge: true } })));
  await flush();

  const loiter = screen.getByRole('switch', { name: 'LOITER DETECT' });
  expect(loiter).toHaveAttribute('aria-checked', 'true');

  await act(async () => {
    loiter.click();
  });

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/500/));
  // The switch must still reflect the server, not the click.
  expect(screen.getByRole('switch', { name: 'LOITER DETECT' })).toHaveAttribute('aria-checked', 'true');
});

test('detection modules are exposed as real switches', async () => {
  render(<Dashboard onBack={() => {}} />);
  act(() => MockSocket.last.open());
  act(() => MockSocket.last.emit(frameOf({})));
  await flush();

  const switches = screen.getAllByRole('switch');
  expect(switches).toHaveLength(3);
  switches.forEach((s) => expect(s).toHaveAttribute('aria-checked'));
});
