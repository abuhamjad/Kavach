import unittest
from unittest import mock

import numpy as np

from app import config
from app.vehicles import VehicleRegistry, classify_color

CAR = 2
FRAME = np.full((720, 1280, 3), 200, dtype=np.uint8)


def read_plate(reg, track_id, box, start_frame):
    frame = start_frame
    for _ in range(config.PLATE_READ_DETECTIONS):
        rec, _ = reg.observe(track_id, CAR, FRAME, box, (0.0, 0.0), frame, [])
        frame += 2
    return rec, frame


class TestVehicleRegistry(unittest.TestCase):
    def test_plate_is_read_after_enough_detections(self):
        reg = VehicleRegistry()
        rec, _ = reg.observe(1, CAR, FRAME, (100, 100, 300, 250), (0, 0), 1, [])
        self.assertIsNone(rec['profile'])
        rec, _ = read_plate(reg, 1, (100, 100, 300, 250), 3)
        self.assertRegex(rec['profile']['plate'], r'^[A-Z]{2} \d{2} [A-Z]{1,2} \d{4}$')

    def test_vehicle_keeps_its_plate_when_the_tracker_reassigns_its_id(self):
        reg = VehicleRegistry()
        rec, frame = read_plate(reg, 1, (100, 100, 300, 250), 1)
        plate = rec['profile']['plate']
        # Lost behind traffic, then back a few px away under a new tracker id.
        again, _ = reg.observe(57, CAR, FRAME, (110, 104, 310, 254), (0, 0), frame + 10, [])
        self.assertEqual(again['profile']['plate'], plate)
        self.assertEqual(len(reg.summaries(frame + 10)), 1)

    def test_a_different_vehicle_elsewhere_gets_its_own_record(self):
        reg = VehicleRegistry()
        read_plate(reg, 1, (100, 100, 300, 250), 1)
        reg.observe(2, CAR, FRAME, (900, 400, 1100, 560), (0, 0), 20, [])
        self.assertEqual(len(reg.summaries(20)), 2)

    def test_watchlist_hits_are_spaced_out(self):
        reg = VehicleRegistry()
        with mock.patch('app.vehicles.time.monotonic', return_value=1000.0):
            flagged = 0
            for i in range(30):
                x = (i % 5) * 250
                _, frame = read_plate(reg, 100 + i, (x, 300, x + 200, 500), i * 1000)
                flagged += reg.records[100 + i]['profile']['level'] == 'alert'
        self.assertEqual(flagged, 1)

    def test_colour_names(self):
        white = np.full((20, 20, 3), 235, dtype=np.uint8)
        red = np.zeros((20, 20, 3), dtype=np.uint8); red[:, :, 2] = 200
        self.assertEqual(classify_color(white), 'WHITE')
        self.assertEqual(classify_color(red), 'RED')


if __name__ == '__main__':
    unittest.main()
