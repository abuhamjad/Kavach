import { fireEvent, render, screen } from '@testing-library/react';
import { VehiclePanel } from './VehiclePanel';

const base = {
  type: 'CAR', color: 'WHITE', color_hex: '#e8e8e8', speed_kmh: 24, heading: 'WEST',
  zones: [], first_seen: '10:00:00', in_view: true, year: 2019, rto: 'DL-03 Delhi', confidence: 0.94,
};

const vehicles = [
  { ...base, id: 3, plate: 'DL 03 CA 4471', make: 'Honda City', status: 'REPORTED STOLEN', level: 'alert' },
  { ...base, id: 2, plate: 'UP 14 JM 7715', make: 'Tata Nexon', status: 'REGISTERED', level: 'ok', in_view: false },
  { ...base, id: 1, plate: null, make: null, status: null, level: null },
];

test('lists vehicles, spotlights a watchlist match, and filters', () => {
  render(<VehiclePanel vehicles={vehicles} panelStyle={{}} reduced />);

  expect(screen.getByRole('alert')).toHaveTextContent('WATCHLIST MATCH');
  expect(screen.getAllByText('DL 03 CA 4471')).toHaveLength(2);
  expect(screen.getByText('UP 14 JM 7715')).toBeInTheDocument();
  // An unread plate is counted in the header, not listed as a row.
  expect(screen.getByText('READING 1')).toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(3);

  fireEvent.click(screen.getByRole('button', { name: 'IN VIEW' }));
  expect(screen.queryByText('UP 14 JM 7715')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'FLAGGED' }));
  expect(screen.getAllByRole('row')).toHaveLength(2);
});

test('empty state before any vehicle is detected', () => {
  render(<VehiclePanel vehicles={[]} panelStyle={{}} reduced />);
  expect(screen.getByText('NO VEHICLES DETECTED YET')).toBeInTheDocument();
});
