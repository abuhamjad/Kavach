"""Detection loop.

Structure note: this module defines things and runs nothing at import. It used
to execute its main loop as a side effect of being imported, which meant the
analysis functions below could not be exercised from a test, the loop could not
be started or stopped by a caller, and the cleanup after it was unreachable —
the alert log was never closed cleanly.

The split is:

    pure helpers        geometry, threat scoring, surge/zigzag detection.
                        No state, no I/O — this is what the tests target.
    DetectionState      all mutable per-run state, with bounded growth.
    run()               the loop. Started explicitly by run.py.
"""

import base64
import os
import sys
import threading
import time
from collections import deque

import cv2
import numpy as np

from app import config
from app import server

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════
#  All paths and tunables come from app/config.py — do not hardcode them here.
VIDEO_FILE = config.VIDEO_FILE
LIVE_URL   = config.LIVE_URL

DETECT_EVERY_N_FRAMES = config.DETECT_EVERY_N_FRAMES
PUSH_EVERY_N_FRAMES   = config.PUSH_EVERY_N_FRAMES
FRAME_SIZE            = (config.FRAME_WIDTH, config.FRAME_HEIGHT)

LOITER_SECONDS   = config.LOITER_SECONDS
SURGE_WINDOW     = config.SURGE_WINDOW
SURGE_THRESHOLD  = config.SURGE_THRESHOLD
PATH_HISTORY_LEN = config.PATH_HISTORY_LEN
ZIGZAG_THRESHOLD = config.ZIGZAG_THRESHOLD
MAX_ALERTS       = config.MAX_ALERTS

THREAT_DEBOUNCE_FRAMES   = config.THREAT_DEBOUNCE_FRAMES
TRACK_EVICT_AFTER_FRAMES = config.TRACK_EVICT_AFTER_FRAMES
TRACK_EVICT_EVERY_FRAMES = config.TRACK_EVICT_EVERY_FRAMES
# ══════════════════════════════════════════════════════════════════════════════

ALLOWED_CLASSES = [0, 2, 3, 5, 7]
PERSON_CLASS    = 0

THREAT_COLORS = {
    "HIGH":   (0, 0, 255),
    "MEDIUM": (0, 165, 255),
    "LOW":    (0, 255, 0),
}


class StopDetection(Exception):
    """Operator pressed stop. Return to setup."""


class SwitchSource(Exception):
    """Operator changed the video source. Reopen the capture."""


# ══════════════════════════════════════════════════════════════════════════════
#  Pure helpers — no state, no I/O
# ══════════════════════════════════════════════════════════════════════════════

def point_in_zone(cx, cy, points):
    if len(points) < 3:
        return False
    return cv2.pointPolygonTest(
        np.array(points, dtype=np.int32), (cx, cy), False) >= 0


def is_night(frame):
    # bool(), not the bare comparison: numpy returns np.bool_, which json.dumps
    # cannot serialize — it crashed the /ws handler the moment night mode engaged.
    return bool(np.mean(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)) < 80)


def detect_surge(history, current, window=SURGE_WINDOW, threshold=SURGE_THRESHOLD):
    """True when `current` exceeds the count `window` samples ago by `threshold`.

    `history` holds the samples *before* `current`. Callers append afterwards,
    so every series is compared against its own past rather than a stale one.
    """
    if len(history) < window:
        return False
    # Same numpy-bool hazard as is_night() when counts come from numpy types.
    return bool(current - history[-window] >= threshold)


def segments_intersect(p1, p2, p3, p4):
    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    d1 = cross(p3, p4, p1)
    d2 = cross(p3, p4, p2)
    d3 = cross(p1, p2, p3)
    d4 = cross(p1, p2, p4)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    return False


def get_threat_level(person_count, vehicle_count, has_loiterer, night, surge):
    score = 0
    if person_count >= 10 or vehicle_count >= 5: score += 3
    elif person_count >= 3 or vehicle_count >= 2: score += 1
    if has_loiterer: score += 2
    if night:        score += 1
    if surge:        score += 2
    if score >= 4:   return "HIGH",   (0, 0, 255)
    elif score >= 2: return "MEDIUM", (0, 165, 255)
    else:            return "LOW",    (0, 255, 0)


def detect_zigzag(positions, threshold=ZIGZAG_THRESHOLD):
    positions = list(positions)
    if len(positions) < 6:
        return False
    direction_changes = 0
    prev_angle = None
    for i in range(1, len(positions)):
        dx = positions[i][0] - positions[i-1][0]
        dy = positions[i][1] - positions[i-1][1]
        if np.sqrt(dx**2 + dy**2) < 2:
            continue
        angle = np.degrees(np.arctan2(dy, dx))
        if prev_angle is not None:
            diff = abs(angle - prev_angle)
            if diff > 180: diff = 360 - diff
            if diff > 45:  direction_changes += 1
        prev_angle = angle
    return direction_changes >= threshold


def apply_threat(zone, candidate, debounce_frames=THREAT_DEBOUNCE_FRAMES):
    """Commit a threat level to `zone`, but only once it has held.

    Returns the previous level if the zone actually changed, else None.

    Threat is recomputed every evaluation, so a person count sitting on a
    threshold boundary used to flip the level — and log an alert — on every
    single frame, flooding the log and evicting real alerts from the ring.
    A candidate now has to survive `debounce_frames` consecutive evaluations
    before it is believed.
    """
    current = zone.get('threat', 'LOW')

    if candidate == current:
        zone['pending_threat'] = None
        zone['pending_frames'] = 0
        return None

    if candidate == zone.get('pending_threat'):
        zone['pending_frames'] = zone.get('pending_frames', 0) + 1
    else:
        zone['pending_threat'] = candidate
        zone['pending_frames'] = 1

    if zone['pending_frames'] >= debounce_frames:
        zone['threat'] = candidate
        zone['pending_threat'] = None
        zone['pending_frames'] = 0
        return current

    return None


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
        'history': deque(maxlen=SURGE_WINDOW + 1),
        'pending_threat': None,
        'pending_frames': 0,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Mutable state
# ══════════════════════════════════════════════════════════════════════════════

class DetectionState:
    """Everything the loop mutates, with bounds on all of it.

    Every per-track structure here used to grow for the life of the process —
    one entry per track ID ever seen, never freed. Tracks are now dropped once
    they have been unseen for TRACK_EVICT_AFTER_FRAMES.
    """

    def __init__(self, log_file=None, echo=True):
        self.log_file = log_file
        self.echo = echo          # operators watch the terminal; tests do not
        self.reset()

    def reset(self):
        self.zones = []
        self.tripwires = []

        self.path_history = {}          # track_id -> deque of (x, y)
        self.prev_positions = {}        # track_id -> (x, y)
        self.crossed_ids = set()
        self.suspicious_ids = set()
        self.loitering_ids = set()
        self.last_seen = {}             # track_id -> frame number

        # Keyed by (zone_name, track_id) tuples. These were once string keys in
        # one shared dict — f"{zone}_{id}" alongside f"loiter_alerted_{id}" —
        # so a zone named "loiter_alerted" collided with the alerted marker and
        # silently suppressed its own alerts.
        self.loiter_start = {}
        self.loiter_alerted = set()

        self.person_count_history = deque(maxlen=SURGE_WINDOW + 1)
        self.alert_log = deque(maxlen=MAX_ALERTS)
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
            self.path_history[track_id] = deque(maxlen=PATH_HISTORY_LEN)
        return self.path_history[track_id]

    def evict_stale_tracks(self, frame_count, after=TRACK_EVICT_AFTER_FRAMES):
        """Drop bookkeeping for tracks that have not been seen recently."""
        stale = [tid for tid, seen in self.last_seen.items()
                 if frame_count - seen > after]
        for tid in stale:
            self.last_seen.pop(tid, None)
            self.path_history.pop(tid, None)
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
        return [
            {'name': z['name'], 'threat': z.get('threat', 'LOW'),
             'persons': z.get('persons', 0), 'vehicles': z.get('vehicles', 0)}
            for z in self.zones
        ]

    def alert_summaries(self):
        return [{'id': a['id'], 'time': a['time'], 'msg': a['msg']} for a in self.alert_log]


# ══════════════════════════════════════════════════════════════════════════════
#  Video source
# ══════════════════════════════════════════════════════════════════════════════

def get_stream_url(url):
    """Resolve a page URL to a playable stream, or None.

    Broad except by design: yt_dlp is optional, the call is network-bound, and
    every failure mode here means the same thing to the caller — fall back to
    the local file. The reason is printed rather than swallowed.
    """
    try:
        import yt_dlp
    except ImportError:
        print("yt_dlp is not installed; cannot resolve live stream URL.")
        return None

    try:
        print(f"Fetching stream URL from: {url}")
        ydl_opts = {'quiet': True, 'format': 'best[ext=mp4]/best'}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            stream = info.get('url') or info['formats'][-1]['url']
            print("Stream URL fetched successfully.")
            return stream
    except Exception as e:
        print(f"Stream fetch failed: {type(e).__name__}: {e}")
        return None


def open_capture(live=False):
    if live:
        url = get_stream_url(LIVE_URL)
        if url:
            cap = cv2.VideoCapture(url)
            if cap.isOpened():
                print("Live stream opened.")
                return cap, True
        print("Live stream failed. Falling back to video file.")
    print(f"Opening video file: {VIDEO_FILE}")
    return cv2.VideoCapture(VIDEO_FILE), False


def read_resized(cap):
    """Read one frame, resized to the working geometry. None if unavailable."""
    ret, frame = cap.read()
    if not ret or frame is None:
        return None
    return cv2.resize(frame, FRAME_SIZE)


# ══════════════════════════════════════════════════════════════════════════════
#  Drawing
# ══════════════════════════════════════════════════════════════════════════════

def draw_direction_arrow(frame, prev_pos, curr_pos, color=(0, 255, 255)):
    dx = curr_pos[0] - prev_pos[0]
    dy = curr_pos[1] - prev_pos[1]
    dist = np.sqrt(dx**2 + dy**2)
    if dist < 3:
        return
    scale = min(dist * 1.5, 40)
    end_x = int(curr_pos[0] + (dx / dist) * scale)
    end_y = int(curr_pos[1] + (dy / dist) * scale)
    cv2.arrowedLine(frame, curr_pos, (end_x, end_y), color, 2, tipLength=0.4)


def draw_path_trail(frame, positions, color):
    positions = list(positions)
    for i in range(1, len(positions)):
        alpha     = i / len(positions)
        thickness = 1 if alpha < 0.5 else 2
        pt_color  = tuple(int(c * alpha) for c in color)
        cv2.line(frame, positions[i-1], positions[i], pt_color, thickness)


def draw_all_zones(frame, zones):
    for zone in zones:
        pts     = np.array(zone['points'], dtype=np.int32)
        threat  = zone.get('threat', 'LOW')
        color   = THREAT_COLORS.get(threat, (0, 255, 0))
        overlay = frame.copy()
        cv2.fillPoly(overlay, [pts], color)
        cv2.addWeighted(overlay, 0.2, frame, 0.8, 0, frame)
        cv2.polylines(frame, [pts], True, color, 2)
        cx = int(np.mean([p[0] for p in zone['points']]))
        cy = int(np.mean([p[1] for p in zone['points']]))
        cv2.putText(frame, zone['name'], (cx-30, cy),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        cv2.putText(frame, threat, (cx-20, cy+22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)


def draw_all_tripwires(frame, tripwires):
    for tw in tripwires:
        cv2.line(frame, tw['p1'], tw['p2'], (0, 255, 255), 2)
        mid = ((tw['p1'][0]+tw['p2'][0])//2, (tw['p1'][1]+tw['p2'][1])//2)
        cv2.putText(frame, tw['name'], (mid[0]+5, mid[1]-5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)


def draw_source_label(frame, source_label, is_live):
    cv2.putText(frame, f"SOURCE: {source_label}",
                (frame.shape[1]-200, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                (0, 255, 0) if is_live else (0, 165, 255), 1)


def encode_frame(frame):
    """JPEG-encode to base64, or None if the encoder refused the frame."""
    ok, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 65])
    if not ok:
        return None
    return base64.b64encode(buffer).decode('utf-8')


# ══════════════════════════════════════════════════════════════════════════════
#  Dashboard
# ══════════════════════════════════════════════════════════════════════════════

class DashboardPublisher:
    """Pushes frames and telemetry to the API's shared state.

    Encode failures used to be caught and printed, which degraded a broken feed
    into a frozen one that looked live. Consecutive failures are counted and
    escalated so the operator learns the picture has stopped updating.
    """

    WARN_AFTER = 30

    def __init__(self):
        self.consecutive_failures = 0

    def _encoded(self, frame):
        try:
            encoded = encode_frame(frame)
        except cv2.error as exc:
            encoded = None
            print(f"Frame encode error: {exc}")

        if encoded is None:
            self.consecutive_failures += 1
            if self.consecutive_failures % self.WARN_AFTER == 1:
                print(f"WARNING: {self.consecutive_failures} consecutive frame "
                      f"encode failures — the dashboard feed is frozen.")
            return None

        if self.consecutive_failures:
            print(f"Frame encoding recovered after {self.consecutive_failures} failures.")
            self.consecutive_failures = 0
        return encoded

    def publish_setup(self, frame, state):
        encoded = self._encoded(frame)
        if encoded is None:
            return
        server.update_state(
            frame=encoded,
            zones=[{'name': z['name'], 'threat': 'LOW', 'persons': 0, 'vehicles': 0}
                   for z in state.zones],
            alerts=state.alert_summaries(),
        )

    def publish_detection(self, frame, state):
        encoded = self._encoded(frame)
        if encoded is None:
            return
        server.update_state(
            frame=encoded,
            alerts=state.alert_summaries(),
            zones=state.zone_summaries(),
            total_persons=state.total_persons,
            total_vehicles=state.total_vehicles,
            night=state.night,
            surge=state.surge,
            modes=dict(state.modes),
        )


# ══════════════════════════════════════════════════════════════════════════════
#  Commands
# ══════════════════════════════════════════════════════════════════════════════

def process_commands(state, source):
    """Apply queued operator commands.

    Raises StopDetection / SwitchSource — named exceptions rather than the old
    StopIteration, which the interpreter special-cases and silently converts to
    a RuntimeError inside any generator frame.
    """
    for cmd in server.take_commands():
        kind = cmd['type']

        if kind == 'add_zone':
            d = cmd['data']
            state.zones.append(new_zone(d['name'], d['points']))
            state.add_alert(f"Zone '{d['name']}' created", (0, 255, 0))

        elif kind == 'add_tripwire':
            d = cmd['data']
            state.tripwires.append({
                'name': d['name'],
                'p1': tuple(d['p1']),
                'p2': tuple(d['p2']),
            })
            state.add_alert(f"Tripwire '{d['name']}' created", (0, 255, 255))

        elif kind == 'set_mode':
            state.modes[cmd['mode']] = cmd['value']

        elif kind == 'stop_detection':
            raise StopDetection

        elif kind == 'switch_source':
            source['live'] = cmd['value']
            raise SwitchSource


def input_listener():
    print("\n=== SOURCE CONTROL ===")
    print("Type 'v' + Enter -> switch to video file")
    print("Type 'l' + Enter -> switch to live stream")
    print("======================\n")
    while True:
        try:
            key = input().strip().lower()
        except (EOFError, KeyboardInterrupt):
            return
        if key == 'l':
            server.queue_command({'type': 'switch_source', 'value': True})
            print("Switching to LIVE stream...")
        elif key == 'v':
            server.queue_command({'type': 'switch_source', 'value': False})
            print("Switching to VIDEO file...")


def start_input_listener():
    """Start terminal source control, but only where a terminal exists.

    Under systemd, Docker without -it, or CI, stdin is at EOF and input()
    returns immediately — the thread spun once and died without saying so.
    """
    if not (sys.stdin and sys.stdin.isatty()):
        print("stdin is not a terminal — keyboard source control disabled.")
        return None
    thread = threading.Thread(target=input_listener, daemon=True)
    thread.start()
    return thread


# ══════════════════════════════════════════════════════════════════════════════
#  Per-frame analysis
# ══════════════════════════════════════════════════════════════════════════════

def analyse_frame(frame, results, state, frame_count):
    """Update tracking state and draw overlays for one detected frame.

    Only ever called on a frame that YOLO actually ran on. Previously the loop
    reused the last results on skipped frames and wrote trails, previous
    positions and tripwire crossings from coordinates up to N frames stale.
    """
    state.night = is_night(frame) if state.modes['night'] else False

    for zone in state.zones:
        zone['persons'] = 0
        zone['vehicles'] = 0
        zone['loiterer'] = False

    total_persons = 0
    total_vehicles = 0

    draw_all_zones(frame, state.zones)
    draw_all_tripwires(frame, state.tripwires)

    boxes = results[0].boxes
    if boxes is not None and boxes.id is not None:
        for box, raw_id in zip(boxes, boxes.id):
            cls      = int(box.cls[0])
            track_id = int(raw_id)
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            cx, cy   = (x1+x2)//2, (y1+y2)//2
            is_person = cls == PERSON_CLASS
            label = "Person" if is_person else "Vehicle"

            trail = state.touch_track(track_id, frame_count)
            trail.append((cx, cy))

            was_suspicious = track_id in state.suspicious_ids
            if detect_zigzag(trail):
                state.suspicious_ids.add(track_id)
                if not was_suspicious:
                    state.add_alert(f"Suspicious movement! {label} ID:{track_id}")

            if track_id in state.prev_positions and track_id not in state.crossed_ids:
                px, py = state.prev_positions[track_id]
                for tw in state.tripwires:
                    if segments_intersect((px, py), (cx, cy), tw['p1'], tw['p2']):
                        state.crossed_ids.add(track_id)
                        state.add_alert(f"{label} crossed {tw['name']}!")

            prev_position = state.prev_positions.get(track_id)
            state.prev_positions[track_id] = (cx, cy)

            # Every containing zone, not just the first. The loop used to break
            # on the first match, so an object standing in overlapping zones was
            # counted in exactly one of them.
            in_any_zone = False
            for zone in state.zones:
                if not point_in_zone(cx, cy, zone['points']):
                    continue
                in_any_zone = True
                if is_person: zone['persons'] += 1
                else:         zone['vehicles'] += 1

                if state.modes['loitering']:
                    key = (zone['name'], track_id)
                    if key not in state.loiter_start:
                        state.loiter_start[key] = time.time()
                    elif time.time() - state.loiter_start[key] > LOITER_SECONDS:
                        state.loitering_ids.add(track_id)
                        zone['loiterer'] = True
                        if key not in state.loiter_alerted:
                            state.add_alert(f"Loitering in {zone['name']}! ID:{track_id}")
                            state.loiter_alerted.add(key)

            if len(trail) > 1:
                trail_color = (0, 0, 255) if track_id in state.suspicious_ids else (100, 100, 255)
                draw_path_trail(frame, trail, trail_color)

            is_suspicious = track_id in state.suspicious_ids
            is_loitering  = track_id in state.loitering_ids
            if is_suspicious:
                box_color, tag = (0, 0, 255), " SUSPICIOUS!"
            elif is_loitering:
                box_color, tag = (0, 0, 255), " LOITER!"
            elif in_any_zone:
                box_color, tag = (0, 165, 255), ""
            else:
                box_color = (0, 255, 0) if is_person else (255, 255, 0)
                tag = ""

            cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
            cv2.putText(frame, f"{'person' if is_person else 'vehicle'}#{track_id}{tag}",
                        (x1, y1-5), cv2.FONT_HERSHEY_SIMPLEX, 0.42, box_color, 1)

            if prev_position is not None:
                arrow_color = (0, 0, 255) if is_suspicious else (0, 255, 255)
                draw_direction_arrow(frame, prev_position, (cx, cy), arrow_color)

            # Site-wide totals count everything detected. They used to count
            # only in-zone objects despite the name, so a deployment with no
            # zones drawn reported zero people forever.
            if is_person: total_persons += 1
            else:         total_vehicles += 1

    state.total_persons = total_persons
    state.total_vehicles = total_vehicles

    # Surge: each zone against its own past, the site against the site's past.
    # Compare before appending, so `current` is never compared with itself.
    surge_on = state.modes['surge']
    for zone in state.zones:
        zone_surge = detect_surge(zone['history'], zone['persons']) if surge_on else False
        zone['history'].append(zone['persons'])

        candidate, _ = get_threat_level(
            zone['persons'], zone['vehicles'],
            zone.get('loiterer', False), state.night, zone_surge,
        )
        previous = apply_threat(zone, candidate)
        if previous is not None:
            state.add_alert(f"{zone['name']} threat: {previous} -> {zone['threat']}",
                            THREAT_COLORS[zone['threat']])

    state.surge = detect_surge(state.person_count_history, total_persons) if surge_on else False
    state.person_count_history.append(total_persons)

    if frame_count % TRACK_EVICT_EVERY_FRAMES == 0:
        state.evict_stale_tracks(frame_count)


# ══════════════════════════════════════════════════════════════════════════════
#  Main loop
# ══════════════════════════════════════════════════════════════════════════════

def load_model():
    print("Loading model...")
    from ultralytics import YOLO
    model = YOLO(config.MODEL_FILE)
    print("Model loaded.")
    return model


def open_log_file():
    config.ensure_runtime_dirs()
    path = os.path.join(
        config.LOGS_DIR, f"alert_log_{time.strftime('%Y%m%d_%H%M%S')}.txt")
    return open(path, 'a', encoding='utf-8'), path


def _publish_reset(state):
    state.reset()
    server.update_state(
        frame=None, alerts=[], zones=[],
        total_persons=0, total_vehicles=0,
        night=False, surge=False, setup_done=False,
    )
    print("Detection reset.")


def run(model=None, stop_event=None):
    """Run the detection loop until `stop_event` is set.

    Explicit entry point. This module no longer does any of it on import, so a
    caller decides when detection starts and the cleanup below actually runs.
    """
    model = model or load_model()
    log_file, log_path = open_log_file()
    state = DetectionState(log_file=log_file)
    publisher = DashboardPublisher()
    source = {'live': False}
    cap = None

    start_input_listener()

    def should_run():
        return stop_event is None or not stop_event.is_set()

    try:
        while should_run():
            _publish_reset(state)

            cap, is_live = open_capture(source['live'])
            first_frame = read_resized(cap)
            if first_frame is None:
                print("Could not read frame. Falling back to video file.")
                cap.release()
                cap, is_live = open_capture(False)
                first_frame = read_resized(cap)

            # The fallback can fail too — an absent video file, a dead camera.
            # Resizing None raises, which used to take the whole process down.
            if first_frame is None:
                print(f"No video source available. Retrying in "
                      f"{config.SOURCE_RETRY_SECONDS}s...")
                cap.release()
                time.sleep(config.SOURCE_RETRY_SECONDS)
                continue

            source_label = "LIVE" if is_live else "VIDEO"
            print(f"Source: {source_label}")
            print("Waiting for zones to be drawn in browser...")

            # ── Setup phase ───────────────────────────────────────────────────
            restart_source = False
            while should_run() and not server.get_setup_done():
                try:
                    process_commands(state, source)
                except StopDetection:
                    # Already in setup; nothing to stop. Said out loud rather
                    # than silently discarded, which is what used to happen.
                    print("Stop requested while in setup — already stopped.")
                except SwitchSource:
                    cap.release()
                    cap, is_live = open_capture(source['live'])
                    switched = read_resized(cap)
                    if switched is None:
                        print("New source produced no frame. Reopening...")
                        restart_source = True
                        break
                    first_frame = switched
                    source_label = "LIVE" if is_live else "VIDEO"
                    print(f"Source switched to: {source_label}")
                    continue

                display = first_frame.copy()
                draw_all_zones(display, state.zones)
                draw_all_tripwires(display, state.tripwires)
                draw_source_label(display, source_label, is_live)
                publisher.publish_setup(display, state)
                time.sleep(0.05)

            if restart_source:
                continue
            if not should_run():
                break

            print("Detection started!")
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

            # ── Detection phase ───────────────────────────────────────────────
            frame_count = 0
            last_push_frame = -PUSH_EVERY_N_FRAMES

            try:
                while should_run() and cap.isOpened():
                    frame = read_resized(cap)
                    if frame is None:
                        if is_live:
                            print("Live stream dropped. Reconnecting...")
                            cap.release()
                            cap, is_live = open_capture(True)
                        else:
                            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue

                    process_commands(state, source)
                    frame_count += 1

                    # Analysis and drawing happen only on frames the detector
                    # actually ran on, so nothing is ever derived from stale
                    # coordinates. Skipped frames are simply consumed.
                    if frame_count % DETECT_EVERY_N_FRAMES != 0:
                        continue

                    results = model.track(frame, verbose=False, conf=0.3,
                                          classes=ALLOWED_CLASSES, persist=True)
                    if results is None:
                        continue

                    analyse_frame(frame, results, state, frame_count)

                    if frame_count - last_push_frame >= PUSH_EVERY_N_FRAMES:
                        draw_source_label(frame, source_label, is_live)
                        publisher.publish_detection(frame, state)
                        last_push_frame = frame_count

            except StopDetection:
                print("Detection stopped. Back to setup mode.")
                cap.release()
                continue

            except SwitchSource:
                print("Source switch during detection. Restarting...")
                cap.release()
                continue

    except KeyboardInterrupt:
        print("\nInterrupted.")
    finally:
        # Reachable now. The loop used to run at import behind an unconditional
        # `while True`, so the cleanup after it was dead code and the alert log
        # was never closed.
        if cap is not None:
            cap.release()
        log_file.close()
        print(f"Alert log saved to: {log_path}")


if __name__ == "__main__":
    run()
