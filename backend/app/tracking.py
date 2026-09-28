"""Mutable per-run detection state, with bounded growth."""

import time
from collections import deque

from app import config
from app.vehicles import VehicleRegistry


def new_zone(name, points):
    """A zone record with every field the loop expects already present."""
    return {
        'name': name,
        'points': [tuple(p) for p in points],
        'threat': 'LOW',
        'persons': 0,
        'vehicles': 0,
        'loiterer': False,
        # Per-zone occupancy history. Surge used to compare a single zone's
        # count against the site-wide total, so a quiet zone inherited the
        # whole site's activity.
        'history': deque(maxlen=config.SURGE_WINDOW + 1),
        'pending_threat': None,
        'pending_frames': 0,
    }


class DetectionState:
    """Everything the loop mutates, with bounds on all of it.

    Every per-track structure here used to grow for the life of the process —
    one entry per track ID ever seen, never freed. Tracks are now dropped once
    they have been unseen for config.TRACK_EVICT_AFTER_FRAMES.
    """

    def __init__(self, log_file=None, echo=True):
        self.log_file = log_file
        self.echo = echo          # operators watch the terminal; tests do not
        self.reset()

    def reset(self, keep_zones=False):
        """Clear all run state. With keep_zones, the operator's zones and
        tripwires survive — rebuilt fresh, so no threat level, surge history
        or debounce carries over. HALT used to wipe them, forcing a redraw."""
        kept = getattr(self, 'zones', []) if keep_zones else []
        self.zones = [new_zone(z['name'], z['points']) for z in kept]
        self.tripwires = list(getattr(self, 'tripwires', [])) if keep_zones else []

        self.path_history = {}          # track_id -> deque of (x, y)
        self.prev_positions = {}        # track_id -> (x, y)
        self.crossed_ids = set()
        self.suspicious_ids = set()
        self.loitering_ids = set()
        self.last_seen = {}             # track_id -> frame number
        self.velocity = {}              # track_id -> smoothed (vx, vy) px/frame

        # Keyed by (zone_name, track_id) tuples. These were once string keys in
        # one shared dict — f"{zone}_{id}" alongside f"loiter_alerted_{id}" —
        # so a zone named "loiter_alerted" collided with the alerted marker and
        # silently suppressed its own alerts.
        self.loiter_start = {}
        self.loiter_alerted = set()

        self.overlay = []               # per-track draw data from the last detection
        self.display_boxes = {}         # track_id -> (box as last drawn, frame drawn on)
        self.vehicles = VehicleRegistry()
        self.vehicle_log = []
        self.last_evict = 0

        self.person_count_history = deque(maxlen=config.SURGE_WINDOW + 1)
        self.alert_log = deque(maxlen=config.MAX_ALERTS)
        self.alert_seq = 0

        self.total_persons = 0
        self.total_vehicles = 0
        self.night = False
        self.surge = False
        self.modes = {'loitering': True, 'night': True, 'surge': True}

    # ── Alerts ───────────────────────────────────────────────────────────────
    def add_alert(self, msg, color=(0, 0, 255)):
        t = time.strftime("%H:%M:%S")
        self.alert_seq += 1
        # The id is what lets the console tell "a new alert arrived" from "the
        # log is full". It inferred that from list length, which stops growing
        # once the ring saturates — after which new alerts stopped registering.
        self.alert_log.append({'id': self.alert_seq, 'time': t, 'msg': msg, 'color': color})
        if self.log_file is not None:
            self.log_file.write(f"[{t}] {msg}\n")
            self.log_file.flush()
        if self.echo:
            print(f"[{t}] ALERT: {msg}")

    # ── Track lifecycle ──────────────────────────────────────────────────────
    def touch_track(self, track_id, frame_count):
        self.last_seen[track_id] = frame_count
        if track_id not in self.path_history:
            self.path_history[track_id] = deque(maxlen=config.PATH_HISTORY_LEN)
        return self.path_history[track_id]

    def evict_stale_tracks(self, frame_count, after=config.TRACK_EVICT_AFTER_FRAMES):
        """Drop bookkeeping for tracks that have not been seen recently."""
        stale = [tid for tid, seen in self.last_seen.items()
                 if frame_count - seen > after]
        for tid in stale:
            self.last_seen.pop(tid, None)
            self.path_history.pop(tid, None)
            self.velocity.pop(tid, None)
            self.prev_positions.pop(tid, None)
            self.crossed_ids.discard(tid)
            self.suspicious_ids.discard(tid)
            self.loitering_ids.discard(tid)

        if stale:
            gone = set(stale)
            for key in [k for k in self.loiter_start if k[1] in gone]:
                del self.loiter_start[key]
            self.loiter_alerted -= {k for k in self.loiter_alerted if k[1] in gone}
        return len(stale)

    def forget_zone_loitering(self, zone_name):
        for key in [k for k in self.loiter_start if k[0] == zone_name]:
            del self.loiter_start[key]
        self.loiter_alerted -= {k for k in self.loiter_alerted if k[0] == zone_name}

    # ── Publishing ───────────────────────────────────────────────────────────
    def zone_summaries(self):
        # Points ride along so the console can list, draw and undo saved zones
        # from the server — it no longer keeps a copy that a reload would lose.
        return [
            {'name': z['name'], 'threat': z.get('threat', 'LOW'),
             'persons': z.get('persons', 0), 'vehicles': z.get('vehicles', 0),
             'points': [list(p) for p in z['points']]}
            for z in self.zones
        ]

    def tripwire_summaries(self):
        return [{'name': t['name'], 'p1': list(t['p1']), 'p2': list(t['p2'])}
                for t in self.tripwires]

    def alert_summaries(self):
        return [{'id': a['id'], 'time': a['time'], 'msg': a['msg']} for a in self.alert_log]
