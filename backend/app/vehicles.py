"""Vehicle registry for the demo console: ANPR and registration data is SIMULATED.

Detection, tracking, vehicle class, colour and speed are measured from the
video. The number plate, make/model, registration details and watchlist status
are generated — there is no plate reader or VAHAN lookup behind them. Each
vehicle's profile is seeded from its track id, so it stays stable while the
vehicle is in view.
"""

import random
import time
from collections import Counter, OrderedDict

import cv2
import numpy as np

from app import config

CLASS_TYPES = {2: 'CAR', 3: 'TWO-WHEELER', 5: 'BUS', 7: 'TRUCK'}

MODELS = {
    'CAR': ['Maruti Suzuki Swift', 'Maruti Suzuki WagonR', 'Maruti Suzuki Dzire',
            'Maruti Suzuki Baleno', 'Hyundai i20', 'Hyundai Creta', 'Tata Nexon',
            'Tata Punch', 'Mahindra Scorpio-N', 'Honda City', 'Toyota Innova Crysta',
            'Kia Seltos', 'Maruti Suzuki Ertiga', 'Hyundai Venue'],
    'TWO-WHEELER': ['Hero Splendor Plus', 'Honda Activa 6G', 'Bajaj Pulsar 150',
                    'TVS Jupiter', 'Royal Enfield Classic 350', 'Honda Shine',
                    'TVS Apache RTR 160', 'Suzuki Access 125', 'Hero HF Deluxe'],
    'BUS': ['Tata Starbus', 'Ashok Leyland Viking', 'Eicher Skyline Pro'],
    'TRUCK': ['Tata 407', 'Ashok Leyland Dost', 'Mahindra Bolero Pik-Up',
              'Eicher Pro 2049', 'Tata Ace Gold'],
}

# (state code, RTO number, registering office), weighted toward the NCR.
RTOS = [
    ('DL', 1, 'Delhi North'), ('DL', 3, 'Delhi Sheikh Sarai'), ('DL', 4, 'Delhi Janakpuri'),
    ('DL', 7, 'Delhi Mayur Vihar'), ('DL', 8, 'Delhi Wazirpur'), ('DL', 12, 'Delhi Vasant Vihar'),
    ('UP', 14, 'Ghaziabad'), ('UP', 16, 'Gautam Buddh Nagar'), ('UP', 32, 'Lucknow'),
    ('HR', 26, 'Gurugram'), ('HR', 51, 'Faridabad'), ('HR', 55, 'Gurugram (Comm.)'),
    ('RJ', 14, 'Jaipur'), ('PB', 10, 'Ludhiana'),
]
PLATE_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'   # I, O and Q are not issued

# (status, level, alert text or None, weight). Watchlist hits are scheduled
# rather than drawn at random: with dense traffic, even a small random rate
# fires several times a minute and reads as fake.
STATUSES = [
    ('REGISTERED', 'ok', None, 84),
    ('INSURANCE EXPIRED', 'warn', None, 9),
    ('PUC EXPIRED', 'warn', None, 7),
]
WATCHLIST = [
    ('REPORTED STOLEN', 'alert', 'reported stolen', 0),
    ('WANTED — CASE LINKED', 'alert', 'linked to an open case', 0),
]

# Real-world height used to turn pixel speed into ground speed.
TYPE_HEIGHT_M = {'CAR': 1.5, 'TWO-WHEELER': 1.6, 'BUS': 3.2, 'TRUCK': 2.8}

COLOR_SWATCH = {
    'WHITE': '#e8e8e8', 'SILVER': '#a9adb3', 'GREY': '#6b6f75', 'BLACK': '#1c1c1c',
    'RED': '#c62828', 'MAROON': '#6d1b1b', 'ORANGE': '#e0702a', 'YELLOW': '#e3c02b',
    'GREEN': '#2e7d32', 'BLUE': '#1f5fbf', 'BROWN': '#6d4c33',
}


def classify_color(crop):
    """Name the dominant body colour of a BGR crop."""
    if crop is None or crop.size == 0:
        return None
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    h, s, v = (float(np.median(hsv[:, i])) for i in range(3))
    if v < 55:
        return 'BLACK'
    # Camera white balance tints grey paint and road slightly blue, so the
    # neutral band is wider for blue hues than for the rest.
    if s < 60 or (85 <= h < 130 and s < 95):
        return 'WHITE' if v > 175 else 'SILVER' if v > 115 else 'GREY'
    if h < 8 or h >= 170:
        return 'RED' if v > 110 else 'MAROON'
    if h < 20:
        return 'ORANGE' if v > 140 else 'BROWN'
    if h < 34:
        return 'YELLOW'
    if h < 85:
        return 'GREEN'
    if h < 130:
        return 'BLUE'
    return 'MAROON'


def heading(vx, vy):
    """Compass-style heading from on-screen motion."""
    if abs(vx) < 0.3 and abs(vy) < 0.3:
        return 'HALTED'
    if abs(vx) >= abs(vy):
        return 'EAST' if vx > 0 else 'WEST'
    return 'APPROACHING' if vy > 0 else 'RECEDING'


class VehicleRegistry:
    def __init__(self):
        self.records = OrderedDict()   # record id -> record, oldest first
        self.alias = {}                # tracker id -> record id it was re-associated to
        self.fps = 30.0
        self.registered = 0
        self.hits = 0
        self.last_hit = None           # time.monotonic() of the last watchlist hit

    def _reassociate(self, vtype, box, frame_count):
        """A record recently lost at this spot, or None.

        In dense traffic the tracker drops a vehicle behind another and returns
        it under a new id. Without this the same car would be re-read with a
        different plate — the one thing an ANPR demo cannot survive.
        """
        x1, y1, x2, y2 = box
        cx, cy, size = (x1 + x2) / 2, (y1 + y2) / 2, max(x2 - x1, y2 - y1)
        best, best_d = None, None
        for rec in self.records.values():
            gap = frame_count - rec['last_frame']
            if rec['type'] != vtype or not 0 < gap <= config.VEHICLE_REASSOC_FRAMES:
                continue
            px1, py1, px2, py2 = rec['box']
            d = np.hypot((px1 + px2) / 2 - cx, (py1 + py2) / 2 - cy)
            if d < 0.6 * size and (best_d is None or d < best_d):
                best, best_d = rec, d
        return best

    def _watchlist_due(self, vtype, box_h):
        # Only on a vehicle big enough that its red box reads from the back of
        # the room, and spaced out in time so it never looks scripted.
        if vtype == 'TWO-WHEELER' or box_h < config.WATCHLIST_MIN_BOX_H:
            return False
        if self.registered < config.DEMO_WATCHLIST_AT:
            return False
        return (self.last_hit is None or
                time.monotonic() - self.last_hit >= config.DEMO_WATCHLIST_GAP_SECONDS)

    def _profile(self, track_id, vtype, box_h):
        rng = random.Random(track_id * 7919 + 17)
        state, rto, office = rng.choice(RTOS)
        series = ''.join(rng.choice(PLATE_LETTERS) for _ in range(rng.choice((1, 2, 2))))
        plate = f"{state} {rto:02d} {series} {rng.randint(1, 9999):04d}"

        self.registered += 1
        if self._watchlist_due(vtype, box_h):
            status = WATCHLIST[self.hits % len(WATCHLIST)]
            self.hits += 1
            self.last_hit = time.monotonic()
        else:
            status = rng.choices(STATUSES, weights=[s[3] for s in STATUSES])[0]

        return {
            'plate': plate,
            'confidence': round(rng.uniform(0.86, 0.99), 2),
            'make': rng.choice(MODELS[vtype]),
            'year': rng.randint(2012, 2025),
            'rto': f"{state}-{rto:02d} {office}",
            'status': status[0],
            'level': status[1],
            'reason': status[2],
        }

    def observe(self, track_id, cls, frame, box, velocity, frame_count, zones):
        """Update one vehicle from a detection. Returns (record, newly_flagged)."""
        seen_type = CLASS_TYPES.get(cls, 'CAR')
        rec = self.records.get(self.alias.get(track_id, track_id))
        vtype = rec['type'] if rec is not None else seen_type
        if rec is None:
            rec = self._reassociate(vtype, box, frame_count)
            if rec is not None:
                self.alias[track_id] = rec['id']
            else:
                rec = {
                    'id': track_id, 'type': vtype, 'types': Counter(), 'sightings': 0,
                    'colors': Counter(),
                    'color': None, 'speed': 0.0, 'first_seen': time.strftime('%H:%M:%S'),
                    'profile': None, 'alerted': False,
                }
                self.records[track_id] = rec
                while len(self.records) > config.VEHICLE_LOG_MAX:
                    self.records.popitem(last=False)
                if len(self.alias) > 4 * config.VEHICLE_LOG_MAX:
                    self.alias = {k: v for k, v in self.alias.items() if v in self.records}

        rec['sightings'] += 1
        # YOLO flips class on the same vehicle between frames (truck/bus/car);
        # vote until the plate is read, then the type is fixed with the make.
        if rec['profile'] is None:
            rec['types'][seen_type] += 1
            rec['type'] = vtype = rec['types'].most_common(1)[0][0]
        rec['last_frame'] = frame_count
        rec['box'] = box
        rec['zones'] = zones

        x1, y1, x2, y2 = box
        if rec['sightings'] <= config.PLATE_READ_DETECTIONS + 4:
            w, h = x2 - x1, y2 - y1
            crop = frame[max(0, y1 + h // 4):max(0, y2 - h // 3),
                         max(0, x1 + w // 5):max(0, x2 - w // 5)]
            name = classify_color(crop)
            if name:
                rec['colors'][name] += 1
                rec['color'] = rec['colors'].most_common(1)[0][0]

        vx, vy = velocity
        box_h = max(1, y2 - y1)
        metres_per_px = TYPE_HEIGHT_M[vtype] / box_h
        kmh = float(np.hypot(vx, vy)) * self.fps * metres_per_px * 3.6
        rec['speed'] = rec['speed'] * 0.7 + min(kmh, 140.0) * 0.3
        rec['heading'] = heading(vx, vy)

        newly_flagged = False
        if rec['profile'] is None and rec['sightings'] >= config.PLATE_READ_DETECTIONS:
            rec['profile'] = self._profile(rec['id'], vtype, box_h)
            if rec['profile']['level'] == 'alert' and not rec['alerted']:
                rec['alerted'] = newly_flagged = True
        return rec, newly_flagged

    def summaries(self, frame_count):
        """Newest first, for the console's vehicle panel."""
        out = []
        for rec in reversed(self.records.values()):
            p = rec['profile'] or {}
            speed = rec['speed']
            out.append({
                'id': rec['id'],
                'type': rec['type'],
                'plate': p.get('plate'),
                'confidence': p.get('confidence'),
                'make': p.get('make'),
                'year': p.get('year'),
                'rto': p.get('rto'),
                'status': p.get('status'),
                'level': p.get('level'),
                'color': rec['color'],
                'color_hex': COLOR_SWATCH.get(rec['color']),
                'speed_kmh': 0 if speed < 3 else round(speed),
                'heading': rec.get('heading'),
                'zones': rec.get('zones', []),
                'first_seen': rec['first_seen'],
                'in_view': frame_count - rec.get('last_frame', 0) <= config.VEHICLE_IN_VIEW_FRAMES,
            })
        return out
