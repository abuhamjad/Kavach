"""Unit tests for the detection logic.

None of this was reachable before: detect.py ran its main loop at import, so a
test could not so much as import the module. The analysis functions are now
pure and the mutable state is a class, which is what makes the cases below
possible.

Run from the backend/ folder:

    python -m unittest discover -s tests -t .
"""

import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config

try:
    from app import detect
    DETECT_AVAILABLE = True
except ImportError as exc:                              # pragma: no cover
    DETECT_AVAILABLE = False
    IMPORT_ERROR = exc


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestSegmentsIntersect(unittest.TestCase):
    """Tripwire crossing detection."""

    def test_crossing_segments_intersect(self):
        self.assertTrue(detect.segments_intersect((0, 0), (10, 10), (0, 10), (10, 0)))

    def test_parallel_segments_do_not_intersect(self):
        self.assertFalse(detect.segments_intersect((0, 0), (10, 0), (0, 5), (10, 5)))

    def test_disjoint_segments_do_not_intersect(self):
        self.assertFalse(detect.segments_intersect((0, 0), (1, 1), (5, 5), (6, 6)))

    def test_touching_endpoint_is_not_a_crossing(self):
        # Strict inequalities in the cross products: a track that merely grazes
        # the wire should not raise an intrusion alert.
        self.assertFalse(detect.segments_intersect((0, 0), (5, 5), (5, 5), (10, 0)))

    def test_order_of_arguments_does_not_matter(self):
        a = detect.segments_intersect((0, 0), (10, 10), (0, 10), (10, 0))
        b = detect.segments_intersect((0, 10), (10, 0), (0, 0), (10, 10))
        self.assertEqual(a, b)


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestZigzag(unittest.TestCase):
    """Evasive-movement detection."""

    def test_straight_line_is_not_zigzag(self):
        path = [(x, 100) for x in range(0, 200, 20)]
        self.assertFalse(detect.detect_zigzag(path))

    def test_short_path_is_never_zigzag(self):
        self.assertFalse(detect.detect_zigzag([(0, 0), (10, 10), (0, 20)]))

    def test_alternating_path_is_zigzag(self):
        path = []
        for i in range(12):
            path.append((i * 20, 100 + (40 if i % 2 else -40)))
        self.assertTrue(detect.detect_zigzag(path))

    def test_stationary_jitter_is_not_zigzag(self):
        # Sub-2px steps are skipped, so a stationary object does not accumulate
        # direction changes from noise.
        path = [(100 + (i % 2), 100) for i in range(20)]
        self.assertFalse(detect.detect_zigzag(path))

    def test_threshold_is_honoured(self):
        path = [(i * 20, 100 + (40 if i % 2 else -40)) for i in range(12)]
        self.assertFalse(detect.detect_zigzag(path, threshold=999))

    def test_accepts_a_deque(self):
        from collections import deque
        path = deque((i * 20, 100 + (40 if i % 2 else -40)) for i in range(12))
        self.assertTrue(detect.detect_zigzag(path))


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestThreatLevel(unittest.TestCase):
    """Threat scoring."""

    def level(self, *args):
        return detect.get_threat_level(*args)[0]

    def test_empty_zone_is_low(self):
        self.assertEqual(self.level(0, 0, False, False, False), "LOW")

    def test_crowd_size_alone_never_reaches_high(self):
        # Documenting the scoring, which is deliberately multi-signal: the
        # largest contribution any single factor makes is 3, and HIGH needs 4.
        # So crowd size alone tops out at MEDIUM no matter how large it gets.
        self.assertEqual(self.level(10, 0, False, False, False), "MEDIUM")
        self.assertEqual(self.level(500, 0, False, False, False), "MEDIUM")
        self.assertEqual(self.level(0, 5, False, False, False), "MEDIUM")

    def test_a_large_crowd_plus_one_other_signal_is_high(self):
        self.assertEqual(self.level(10, 0, False, True, False), "HIGH")
        self.assertEqual(self.level(10, 0, True, False, False), "HIGH")
        self.assertEqual(self.level(10, 0, False, False, True), "HIGH")

    def test_small_group_is_medium_only_with_another_factor(self):
        self.assertEqual(self.level(3, 0, False, False, False), "LOW")
        self.assertEqual(self.level(3, 0, False, True, False), "MEDIUM")

    def test_loiterer_alone_is_medium(self):
        self.assertEqual(self.level(1, 0, True, False, False), "MEDIUM")

    def test_factors_accumulate_to_high(self):
        self.assertEqual(self.level(3, 0, True, False, False), "MEDIUM")
        self.assertEqual(self.level(3, 0, True, True, False), "HIGH")

    def test_surge_and_night_together_reach_high(self):
        self.assertEqual(self.level(3, 0, False, True, True), "HIGH")

    def test_returns_a_colour_for_every_level(self):
        for args in [(0, 0, False, False, False), (1, 0, True, False, False),
                     (10, 0, False, False, False)]:
            label, color = detect.get_threat_level(*args)
            self.assertIn(label, detect.THREAT_COLORS)
            self.assertEqual(color, detect.THREAT_COLORS[label])


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestSurge(unittest.TestCase):
    """Surge detection compares a series against its own past."""

    def test_no_surge_before_the_window_fills(self):
        self.assertFalse(detect.detect_surge([1, 2, 3], 99, window=90))

    def test_rise_across_the_window_is_a_surge(self):
        history = [0] * 90
        self.assertTrue(detect.detect_surge(history, 5, window=90, threshold=5))

    def test_rise_below_threshold_is_not_a_surge(self):
        history = [0] * 90
        self.assertFalse(detect.detect_surge(history, 4, window=90, threshold=5))

    def test_growth_smaller_than_the_threshold_is_not_a_surge(self):
        # Steady occupancy that drifts up by less than the threshold across the
        # whole window is normal activity, not a spike.
        history = [10] * 89 + [12]
        self.assertFalse(detect.detect_surge(history, 14, window=90, threshold=5))

    def test_the_comparison_is_against_the_start_of_the_window(self):
        # Not against the immediately preceding sample: a crowd that builds
        # steadily still trips the surge once the total rise clears threshold.
        history = list(range(90))          # oldest in window is 0
        self.assertTrue(detect.detect_surge(history, 90, window=90, threshold=5))

    def test_returns_a_builtin_bool_not_numpy(self):
        # np.bool_ is not JSON-serialisable and crashed the telemetry socket.
        import numpy as np
        history = [np.int64(0)] * 90
        result = detect.detect_surge(history, np.int64(9), window=90, threshold=5)
        self.assertIs(type(result), bool)


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestPointInZone(unittest.TestCase):
    SQUARE = [(0, 0), (100, 0), (100, 100), (0, 100)]

    def test_interior_point_is_inside(self):
        self.assertTrue(detect.point_in_zone(50, 50, self.SQUARE))

    def test_exterior_point_is_outside(self):
        self.assertFalse(detect.point_in_zone(150, 50, self.SQUARE))

    def test_degenerate_polygon_contains_nothing(self):
        self.assertFalse(detect.point_in_zone(5, 5, [(0, 0), (10, 10)]))
        self.assertFalse(detect.point_in_zone(5, 5, []))


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestThreatDebounce(unittest.TestCase):
    """A threat level must hold before it is committed and alerted on."""

    def setUp(self):
        self.zone = detect.new_zone("SECTOR-A", [(0, 0), (10, 0), (10, 10)])

    def test_a_single_frame_does_not_change_the_level(self):
        self.assertIsNone(detect.apply_threat(self.zone, "HIGH", debounce_frames=5))
        self.assertEqual(self.zone['threat'], "LOW")

    def test_a_sustained_level_is_committed(self):
        for _ in range(4):
            self.assertIsNone(detect.apply_threat(self.zone, "HIGH", debounce_frames=5))
        self.assertEqual(detect.apply_threat(self.zone, "HIGH", debounce_frames=5), "LOW")
        self.assertEqual(self.zone['threat'], "HIGH")

    def test_flapping_never_commits(self):
        # The exact failure this exists to prevent: a count oscillating on a
        # threshold boundary used to log a transition every single frame.
        for i in range(50):
            changed = detect.apply_threat(
                self.zone, "HIGH" if i % 2 else "LOW", debounce_frames=5)
            self.assertIsNone(changed)
        self.assertEqual(self.zone['threat'], "LOW")

    def test_returning_to_the_current_level_clears_the_pending_candidate(self):
        detect.apply_threat(self.zone, "HIGH", debounce_frames=5)
        detect.apply_threat(self.zone, "HIGH", debounce_frames=5)
        detect.apply_threat(self.zone, "LOW", debounce_frames=5)
        self.assertIsNone(self.zone['pending_threat'])
        self.assertEqual(self.zone['pending_frames'], 0)

    def test_commit_reports_the_level_it_replaced(self):
        for _ in range(5):
            detect.apply_threat(self.zone, "MEDIUM", debounce_frames=5)
        self.assertEqual(self.zone['threat'], "MEDIUM")
        previous = None
        for _ in range(5):
            previous = detect.apply_threat(self.zone, "HIGH", debounce_frames=5) or previous
        self.assertEqual(previous, "MEDIUM")


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestDetectionState(unittest.TestCase):
    def setUp(self):
        self.state = detect.DetectionState(echo=False)

    def test_alerts_are_bounded_and_carry_monotonic_ids(self):
        for i in range(config.MAX_ALERTS + 25):
            self.state.add_alert(f"alert {i}")

        self.assertEqual(len(self.state.alert_log), config.MAX_ALERTS)
        ids = [a['id'] for a in self.state.alert_log]
        self.assertEqual(ids, sorted(ids))
        # The id keeps climbing after the ring saturates — that is precisely
        # what lets a console detect new alerts once the length stops changing.
        self.assertEqual(ids[-1], config.MAX_ALERTS + 25)

    def test_alert_summaries_expose_the_id(self):
        self.state.add_alert("something happened")
        summary = self.state.alert_summaries()[0]
        self.assertEqual(set(summary), {"id", "time", "msg"})

    def test_path_history_is_bounded_per_track(self):
        trail = self.state.touch_track(7, frame_count=1)
        for i in range(config.PATH_HISTORY_LEN * 3):
            trail.append((i, i))
        self.assertEqual(len(self.state.path_history[7]), config.PATH_HISTORY_LEN)

    def test_person_count_history_is_bounded(self):
        for i in range(config.SURGE_WINDOW * 5):
            self.state.person_count_history.append(i)
        self.assertLessEqual(len(self.state.person_count_history), config.SURGE_WINDOW + 1)

    def test_stale_tracks_are_evicted(self):
        self.state.touch_track(1, frame_count=0)
        self.state.touch_track(2, frame_count=0)
        self.state.prev_positions[1] = (5, 5)
        self.state.suspicious_ids.add(1)
        self.state.crossed_ids.add(1)
        self.state.loitering_ids.add(1)
        self.state.loiter_start[("SECTOR-A", 1)] = time.time()
        self.state.loiter_alerted.add(("SECTOR-A", 1))

        self.state.touch_track(2, frame_count=500)      # 2 is still around
        evicted = self.state.evict_stale_tracks(frame_count=500, after=300)

        self.assertEqual(evicted, 1)
        self.assertNotIn(1, self.state.path_history)
        self.assertNotIn(1, self.state.prev_positions)
        self.assertNotIn(1, self.state.suspicious_ids)
        self.assertNotIn(1, self.state.crossed_ids)
        self.assertNotIn(1, self.state.loitering_ids)
        self.assertEqual(self.state.loiter_start, {})
        self.assertEqual(self.state.loiter_alerted, set())
        self.assertIn(2, self.state.path_history)

    def test_active_tracks_survive_eviction(self):
        self.state.touch_track(1, frame_count=400)
        self.state.evict_stale_tracks(frame_count=500, after=300)
        self.assertIn(1, self.state.path_history)

    def test_reset_clears_everything(self):
        self.state.add_alert("before reset")
        self.state.touch_track(1, frame_count=1)
        self.state.zones.append(detect.new_zone("Z", [(0, 0), (1, 0), (1, 1)]))
        self.state.reset()
        self.assertEqual(len(self.state.alert_log), 0)
        self.assertEqual(self.state.path_history, {})
        self.assertEqual(self.state.zones, [])
        self.assertEqual(self.state.alert_seq, 0)


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestLoiterKeyNamespace(unittest.TestCase):
    """Loiter bookkeeping must not collide across zones."""

    def setUp(self):
        self.state = detect.DetectionState(echo=False)

    def test_a_zone_named_like_the_alert_marker_does_not_collide(self):
        # The two key families used to share one dict as f"{zone}_{id}" and
        # f"loiter_alerted_{id}", so a zone literally named "loiter_alerted"
        # suppressed its own alerts. Tuple keys cannot collide.
        self.state.loiter_start[("loiter_alerted", 7)] = 1.0
        self.state.loiter_alerted.add(("SECTOR-A", 7))
        self.assertIn(("loiter_alerted", 7), self.state.loiter_start)
        self.assertNotIn(("loiter_alerted", 7), self.state.loiter_alerted)

    def test_the_same_track_loiters_independently_per_zone(self):
        self.state.loiter_start[("SECTOR-A", 7)] = 1.0
        self.state.loiter_start[("SECTOR-B", 7)] = 2.0
        self.assertEqual(len(self.state.loiter_start), 2)

    def test_forgetting_a_zone_leaves_other_zones_alone(self):
        self.state.loiter_start[("SECTOR-A", 7)] = 1.0
        self.state.loiter_start[("SECTOR-B", 7)] = 2.0
        self.state.loiter_alerted.update({("SECTOR-A", 7), ("SECTOR-B", 7)})
        self.state.forget_zone_loitering("SECTOR-A")
        self.assertEqual(list(self.state.loiter_start), [("SECTOR-B", 7)])
        self.assertEqual(self.state.loiter_alerted, {("SECTOR-B", 7)})


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestZoneRecord(unittest.TestCase):
    def test_new_zone_has_its_own_surge_history(self):
        a = detect.new_zone("A", [(0, 0), (1, 0), (1, 1)])
        b = detect.new_zone("B", [(0, 0), (1, 0), (1, 1)])
        a['history'].append(5)
        # Per-zone, not shared: surge used to compare one zone's occupancy
        # against the site-wide total.
        self.assertEqual(len(b['history']), 0)

    def test_zone_history_is_bounded(self):
        zone = detect.new_zone("A", [(0, 0), (1, 0), (1, 1)])
        for i in range(config.SURGE_WINDOW * 4):
            zone['history'].append(i)
        self.assertLessEqual(len(zone['history']), config.SURGE_WINDOW + 1)

    def test_points_are_tuples(self):
        zone = detect.new_zone("A", [[0, 0], [1, 0], [1, 1]])
        self.assertTrue(all(isinstance(p, tuple) for p in zone['points']))


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestCommandProcessing(unittest.TestCase):
    """Commands are drained from the API queue and applied to state."""

    def setUp(self):
        from app import server
        self.server = server
        server.take_commands()          # start from empty
        self.state = detect.DetectionState(echo=False)
        self.source = {'live': False}

    def test_add_zone_creates_a_zone_and_an_alert(self):
        self.server.queue_command({
            'type': 'add_zone',
            'data': {'name': 'SECTOR-A', 'points': [[0, 0], [10, 0], [10, 10]]},
        })
        detect.process_commands(self.state, self.source)
        self.assertEqual(len(self.state.zones), 1)
        self.assertEqual(self.state.zones[0]['name'], 'SECTOR-A')
        self.assertEqual(len(self.state.alert_log), 1)

    def test_add_tripwire_creates_a_tripwire(self):
        self.server.queue_command({
            'type': 'add_tripwire',
            'data': {'name': 'WIRE-1', 'p1': [0, 0], 'p2': [10, 10]},
        })
        detect.process_commands(self.state, self.source)
        self.assertEqual(self.state.tripwires[0]['p1'], (0, 0))

    def test_set_mode_updates_the_mode(self):
        self.server.queue_command({'type': 'set_mode', 'mode': 'night', 'value': False})
        detect.process_commands(self.state, self.source)
        self.assertFalse(self.state.modes['night'])

    def test_stop_raises_a_named_exception(self):
        # Not StopIteration: the interpreter special-cases it and converts it
        # to RuntimeError inside any generator frame.
        self.server.queue_command({'type': 'stop_detection'})
        with self.assertRaises(detect.StopDetection):
            detect.process_commands(self.state, self.source)
        self.assertFalse(issubclass(detect.StopDetection, StopIteration))

    def test_switch_source_records_the_choice_and_raises(self):
        self.server.queue_command({'type': 'switch_source', 'value': True})
        with self.assertRaises(detect.SwitchSource):
            detect.process_commands(self.state, self.source)
        self.assertTrue(self.source['live'])

    def test_the_queue_is_drained(self):
        self.server.queue_command({'type': 'set_mode', 'mode': 'surge', 'value': False})
        detect.process_commands(self.state, self.source)
        self.assertEqual(self.server.pending_commands, [])


class FakeBox:
    """One detection, shaped like an ultralytics box."""

    def __init__(self, cls, xyxy):
        self.cls = [cls]
        self.xyxy = [xyxy]


class FakeBoxes:
    def __init__(self, detections):
        self._boxes = [FakeBox(cls, xyxy) for cls, xyxy, _ in detections]
        self.id = [track_id for _, _, track_id in detections]

    def __iter__(self):
        return iter(self._boxes)


class FakeResult:
    def __init__(self, detections):
        self.boxes = FakeBoxes(detections) if detections is not None else None


def fake_results(detections):
    """Stand in for model.track() output. (class, (x1,y1,x2,y2), track_id)."""
    return [FakeResult(detections)]


def blank_frame(brightness=200):
    import numpy as np
    return np.full((config.FRAME_HEIGHT, config.FRAME_WIDTH, 3), brightness, dtype="uint8")


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestAnalyseFrame(unittest.TestCase):
    """The per-frame analysis pass, driven with synthetic detections."""

    # A 200x200 square at the origin, and one overlapping it from (100,100).
    SQUARE_A = [(0, 0), (200, 0), (200, 200), (0, 200)]
    SQUARE_B = [(100, 100), (300, 100), (300, 300), (100, 300)]

    def setUp(self):
        self.state = detect.DetectionState(echo=False)
        self.frame = blank_frame()

    def person_at(self, cx, cy, track_id=1):
        return (detect.PERSON_CLASS, (cx - 10, cy - 10, cx + 10, cy + 10), track_id)

    def vehicle_at(self, cx, cy, track_id=2):
        return (2, (cx - 10, cy - 10, cx + 10, cy + 10), track_id)

    def analyse(self, detections, frame_count=2):
        detect.analyse_frame(self.frame, fake_results(detections), self.state, frame_count)

    # ── Totals (#13) ─────────────────────────────────────────────────────────
    def test_totals_count_objects_outside_every_zone(self):
        # With no zones drawn the dashboard used to read zero forever, because
        # the totals only counted objects that were inside a zone.
        self.analyse([self.person_at(600, 600, 1), self.vehicle_at(700, 600, 2)])
        self.assertEqual(self.state.total_persons, 1)
        self.assertEqual(self.state.total_vehicles, 1)

    def test_totals_count_the_whole_site_not_just_zones(self):
        self.state.zones.append(detect.new_zone("A", self.SQUARE_A))
        self.analyse([self.person_at(50, 50, 1), self.person_at(900, 900, 2)])
        self.assertEqual(self.state.total_persons, 2)
        self.assertEqual(self.state.zones[0]['persons'], 1)

    # ── Overlapping zones (#13) ──────────────────────────────────────────────
    def test_an_object_counts_in_every_zone_containing_it(self):
        self.state.zones.append(detect.new_zone("A", self.SQUARE_A))
        self.state.zones.append(detect.new_zone("B", self.SQUARE_B))
        self.analyse([self.person_at(150, 150, 1)])     # inside both
        self.assertEqual(self.state.zones[0]['persons'], 1)
        self.assertEqual(self.state.zones[1]['persons'], 1)

    def test_counts_reset_between_frames(self):
        self.state.zones.append(detect.new_zone("A", self.SQUARE_A))
        self.analyse([self.person_at(50, 50, 1)], frame_count=2)
        self.analyse([], frame_count=4)
        self.assertEqual(self.state.zones[0]['persons'], 0)

    # ── Per-zone surge history (#7) ──────────────────────────────────────────
    def test_each_zone_accumulates_its_own_history(self):
        self.state.zones.append(detect.new_zone("A", self.SQUARE_A))
        self.state.zones.append(detect.new_zone("B", self.SQUARE_B))
        self.analyse([self.person_at(50, 50, 1)])       # in A only

        self.assertEqual(list(self.state.zones[0]['history']), [1])
        self.assertEqual(list(self.state.zones[1]['history']), [0])

    def test_zone_history_is_independent_of_the_site_total(self):
        self.state.zones.append(detect.new_zone("A", self.SQUARE_A))
        for i in range(5):
            # One person in the zone, several outside it.
            self.analyse([
                self.person_at(50, 50, 1),
                self.person_at(800, 800, 2),
                self.person_at(900, 900, 3),
            ], frame_count=(i + 1) * 2)

        self.assertEqual(list(self.state.zones[0]['history']), [1] * 5)
        self.assertEqual(list(self.state.person_count_history), [3] * 5)

    # ── Tracking state (#8 / growth) ─────────────────────────────────────────
    def test_positions_and_trails_follow_the_detections(self):
        self.analyse([self.person_at(100, 100, 7)], frame_count=2)
        self.assertEqual(self.state.prev_positions[7], (100, 100))
        self.analyse([self.person_at(140, 100, 7)], frame_count=4)
        self.assertEqual(self.state.prev_positions[7], (140, 100))
        self.assertEqual(list(self.state.path_history[7]), [(100, 100), (140, 100)])

    def test_tracks_are_evicted_on_the_eviction_cadence(self):
        self.analyse([self.person_at(100, 100, 7)], frame_count=2)
        self.assertIn(7, self.state.path_history)
        # Far enough ahead to be stale, and on a multiple of the sweep interval.
        self.analyse([], frame_count=config.TRACK_EVICT_EVERY_FRAMES * 10)
        self.assertNotIn(7, self.state.path_history)

    # ── Tripwires ────────────────────────────────────────────────────────────
    def test_crossing_a_tripwire_raises_one_alert(self):
        self.state.tripwires.append({'name': 'WIRE-1', 'p1': (100, 0), 'p2': (100, 400)})
        self.analyse([self.person_at(50, 200, 1)], frame_count=2)
        self.analyse([self.person_at(150, 200, 1)], frame_count=4)

        crossings = [a for a in self.state.alert_log if 'crossed' in a['msg']]
        self.assertEqual(len(crossings), 1)

        # Crossing back does not re-alert — the id is already marked.
        self.analyse([self.person_at(50, 200, 1)], frame_count=6)
        crossings = [a for a in self.state.alert_log if 'crossed' in a['msg']]
        self.assertEqual(len(crossings), 1)

    # ── Loitering (#15) ──────────────────────────────────────────────────────
    def test_loitering_is_tracked_per_zone_and_alerts_once(self):
        self.state.zones.append(detect.new_zone("A", self.SQUARE_A))
        self.state.zones.append(detect.new_zone("loiter_alerted", self.SQUARE_B))

        self.analyse([self.person_at(150, 150, 1)], frame_count=2)
        # Both zones contain the track, each with its own timer.
        self.assertEqual(set(self.state.loiter_start),
                         {("A", 1), ("loiter_alerted", 1)})

        # Backdate the timers past the dwell threshold.
        past = time.time() - (config.LOITER_SECONDS + 1)
        for key in self.state.loiter_start:
            self.state.loiter_start[key] = past

        self.analyse([self.person_at(150, 150, 1)], frame_count=4)
        loiter_alerts = [a for a in self.state.alert_log if 'Loitering' in a['msg']]
        self.assertEqual(len(loiter_alerts), 2)      # one per zone

        self.analyse([self.person_at(150, 150, 1)], frame_count=6)
        loiter_alerts = [a for a in self.state.alert_log if 'Loitering' in a['msg']]
        self.assertEqual(len(loiter_alerts), 2)      # not repeated

    # ── Threat evaluation ────────────────────────────────────────────────────
    def test_threat_changes_only_after_the_debounce_window(self):
        self.state.zones.append(detect.new_zone("A", self.SQUARE_A))
        crowd = [self.person_at(20 + i * 5, 20, i) for i in range(10)]

        for i in range(config.THREAT_DEBOUNCE_FRAMES - 1):
            self.analyse(crowd, frame_count=(i + 1) * 2)
        self.assertEqual(self.state.zones[0]['threat'], "LOW")

        self.analyse(crowd, frame_count=999 * 2)
        self.assertEqual(self.state.zones[0]['threat'], "MEDIUM")

    def test_no_detections_is_handled(self):
        self.state.zones.append(detect.new_zone("A", self.SQUARE_A))
        detect.analyse_frame(self.frame, fake_results(None), self.state, 2)
        self.assertEqual(self.state.total_persons, 0)

    # ── Modes ────────────────────────────────────────────────────────────────
    def test_night_mode_off_reports_no_night(self):
        self.state.modes['night'] = False
        detect.analyse_frame(blank_frame(0), fake_results([]), self.state, 2)
        self.assertFalse(self.state.night)

    def test_night_mode_on_detects_a_dark_frame(self):
        self.state.modes['night'] = True
        detect.analyse_frame(blank_frame(0), fake_results([]), self.state, 2)
        self.assertTrue(self.state.night)

    def test_surge_mode_off_never_reports_a_surge(self):
        self.state.modes['surge'] = False
        for i in range(config.SURGE_WINDOW + 5):
            self.analyse([], frame_count=(i + 1) * 2)
        self.assertFalse(self.state.surge)


@unittest.skipUnless(DETECT_AVAILABLE, "OpenCV/numpy not installed")
class TestModuleIsInert(unittest.TestCase):
    """Importing the module must not start anything."""

    def test_run_is_a_function_not_a_side_effect(self):
        self.assertTrue(callable(detect.run))

    def test_no_log_file_is_opened_at_import(self):
        self.assertFalse(hasattr(detect, "log_file"))

    def test_no_model_is_loaded_at_import(self):
        self.assertFalse(hasattr(detect, "model"))

    def test_frame_geometry_comes_from_config(self):
        self.assertEqual(detect.FRAME_SIZE, (config.FRAME_WIDTH, config.FRAME_HEIGHT))


if __name__ == "__main__":
    unittest.main()
