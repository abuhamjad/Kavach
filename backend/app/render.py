"""Everything that paints a frame or ships it to the dashboard."""

import cv2
import numpy as np

from app import bus, config


THREAT_COLORS = {
    "HIGH":   (0, 0, 255),
    "MEDIUM": (0, 165, 255),
    "LOW":    (0, 255, 0),
}


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


def predicted_offset(item, frame_count):
    """(dx, dy) to move a detection from the frame it was seen on to `frame_count`.

    Detection runs a few times a second while video plays at ~30, so a box
    drawn where the detector saw it trails a moving object. Extrapolate along
    the track's velocity instead, capped so a stale track is not flung away.
    """
    ahead = min(max(0, frame_count - item['frame']), config.MAX_EXTRAPOLATE_FRAMES)
    vx, vy = item['velocity']
    return int(round(vx * ahead)), int(round(vy * ahead))


def draw_overlay(frame, state, frame_count=None):
    """Paint zones, tripwires and the latest detections onto a display frame.

    With `frame_count`, each box is drawn at its predicted current position.
    """
    draw_all_zones(frame, state.zones)
    draw_all_tripwires(frame, state.tripwires)
    for t in state.overlay:
        dx, dy = predicted_offset(t, frame_count) if frame_count is not None else (0, 0)
        if len(t['trail']) > 1:
            draw_path_trail(frame, t['trail'], t['trail_color'])
        x1, y1, x2, y2 = t['box']
        x1, y1, x2, y2 = x1 + dx, y1 + dy, x2 + dx, y2 + dy
        cv2.rectangle(frame, (x1, y1), (x2, y2), t['color'], 2)
        cv2.putText(frame, t['label'], (x1, y1-5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, t['color'], 1)
        if t['arrow'] is not None:
            (px, py), (cx, cy) = t['arrow']
            draw_direction_arrow(frame, (px + dx, py + dy), (cx + dx, cy + dy), t['arrow_color'])


def draw_source_label(frame, source_label, is_live):
    cv2.putText(frame, f"SOURCE: {source_label}",
                (frame.shape[1]-200, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                (0, 255, 0) if is_live else (0, 165, 255), 1)


def encode_frame(frame):
    """Raw JPEG bytes, or None if the encoder refused the frame.

    Sent as a binary WebSocket message. It used to travel as base64 inside the
    JSON payload: a third bigger, and re-serialised once per viewer per frame.
    """
    ok, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 65])
    if not ok:
        return None
    return buffer.tobytes()


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
        bus.update_state(
            frame=encoded,
            zones=[dict(z, threat='LOW', persons=0, vehicles=0)
                   for z in state.zone_summaries()],
            tripwires=state.tripwire_summaries(),
            alerts=state.alert_summaries(),
        )

    def publish_detection(self, frame, state):
        encoded = self._encoded(frame)
        if encoded is None:
            return
        bus.update_state(
            frame=encoded,
            alerts=state.alert_summaries(),
            zones=state.zone_summaries(),
            tripwires=state.tripwire_summaries(),
            total_persons=state.total_persons,
            total_vehicles=state.total_vehicles,
            night=state.night,
            surge=state.surge,
            modes=dict(state.modes),
        )
