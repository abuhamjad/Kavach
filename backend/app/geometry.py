"""Pure geometry and scoring. No state, no I/O — this is what the tests target."""

import cv2
import numpy as np

from app import config


def point_in_zone(cx, cy, points):
    if len(points) < 3:
        return False
    return cv2.pointPolygonTest(
        np.array(points, dtype=np.int32), (cx, cy), False) >= 0


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


def _rect(box):
    x1, y1, x2, y2 = box
    return (int(x1), int(y1), max(1, int(x2 - x1) + 1), max(1, int(y2 - y1) + 1))


def box_touches_line(box, p1, p2):
    """True if any part of the bounding box touches the segment p1-p2.

    Tripwires used to fire only when an object's *centre* moved across the
    line, so a vehicle could have half its body over the wire unreported.
    """
    return cv2.clipLine(_rect(box), tuple(map(int, p1)), tuple(map(int, p2)))[0]


def box_touches_zone(box, points):
    """True if any part of the bounding box overlaps the zone polygon.

    Zones used to test only the box centre, so an object had to be half inside
    before it counted. Now: a zone edge crossing the box, or the box lying
    wholly inside the zone (then no edge touches it, but its centre is in).
    """
    if len(points) < 3:
        return False
    rect = _rect(box)
    for a, b in zip(points, points[1:] + points[:1]):
        if cv2.clipLine(rect, tuple(map(int, a)), tuple(map(int, b)))[0]:
            return True
    x1, y1, x2, y2 = box
    return point_in_zone((x1 + x2) // 2, (y1 + y2) // 2, points)


def is_night(frame):
    # bool(), not the bare comparison: numpy returns np.bool_, which json.dumps
    # cannot serialize — it crashed the /ws handler the moment night mode engaged.
    return bool(np.mean(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)) < 80)


def detect_surge(history, current, window=config.SURGE_WINDOW, threshold=config.SURGE_THRESHOLD):
    """True when `current` exceeds the count `window` samples ago by `threshold`.

    `history` holds the samples *before* `current`. Callers append afterwards,
    so every series is compared against its own past rather than a stale one.
    """
    if len(history) < window:
        return False
    # Same numpy-bool hazard as is_night() when counts come from numpy types.
    return bool(current - history[-window] >= threshold)


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


def detect_zigzag(positions, threshold=config.ZIGZAG_THRESHOLD,
                  min_step=config.ZIGZAG_MIN_STEP, min_turn=config.ZIGZAG_MIN_TURN):
    positions = list(positions)
    if len(positions) < 6:
        return False
    # Steps are measured from the last point that moved at least min_step away,
    # so YOLO box jitter on a slow or parked object never registers as a turn.
    direction_changes = 0
    prev_angle = None
    anchor = positions[0]
    for point in positions[1:]:
        dx = point[0] - anchor[0]
        dy = point[1] - anchor[1]
        if np.hypot(dx, dy) < min_step:
            continue
        angle = np.degrees(np.arctan2(dy, dx))
        if prev_angle is not None:
            diff = abs(angle - prev_angle)
            if diff > 180: diff = 360 - diff
            if diff > min_turn: direction_changes += 1
        prev_angle = angle
        anchor = point
    return direction_changes >= threshold


def apply_threat(zone, candidate, debounce_frames=config.THREAT_DEBOUNCE_FRAMES):
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
