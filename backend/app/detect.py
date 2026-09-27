"""Detection loop.

Structure note: this module defines things and runs nothing at import. It used
to execute its main loop as a side effect of being imported, which meant the
analysis functions below could not be exercised from a test, the loop could not
be started or stopped by a caller, and the cleanup after it was unreachable —
the alert log was never closed cleanly.

The backend is split by concern:

    bus.py       shared state + command queue between this loop and the API
    geometry.py  pure hit-testing, threat scoring, surge/zigzag. No state, no I/O.
    tracking.py  DetectionState — all mutable per-run state, with bounded growth.
    source.py    video file / live stream capture
    render.py    drawing, JPEG encoding, publishing to the dashboard
    commands.py  operator commands, from the API and the terminal
    detect.py    this file: per-frame analysis, the Detector thread, run()
"""

import os
import threading
import time

import cv2

from app import bus, config
from app.commands import StopDetection, SwitchSource, process_commands, start_input_listener
from app.geometry import (apply_threat, box_touches_line, box_touches_zone, detect_surge,
                          detect_zigzag, get_threat_level, is_night, segments_intersect)
from app.render import (THREAT_COLORS, DashboardPublisher, draw_all_tripwires,
                        draw_all_zones, draw_overlay, draw_source_label)
from app.source import open_capture, read_resized
from app.tracking import DetectionState

ALLOWED_CLASSES = [0, 2, 3, 5, 7]
PERSON_CLASS    = 0


def track_velocity(state, track_id, prev_position, prev_seen, position, frame_count):
    """Smoothed pixels-per-frame velocity of a track, stored on the state.

    Two-point velocity from jittery boxes would make the extrapolated overlay
    wobble; an even blend with the previous estimate damps that while still
    settling to zero within a couple of detections once an object stops.
    """
    if prev_position is None or prev_seen is None or frame_count <= prev_seen:
        return state.velocity.get(track_id, (0.0, 0.0))
    dt = frame_count - prev_seen
    raw = ((position[0] - prev_position[0]) / dt, (position[1] - prev_position[1]) / dt)
    old = state.velocity.get(track_id)
    v = raw if old is None else ((raw[0] + old[0]) / 2, (raw[1] + old[1]) / 2)
    state.velocity[track_id] = v
    return v


def analyse_frame(frame, results, state, frame_count):
    """Update tracking state and record the overlay for one detected frame.

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
    overlay = []

    boxes = results[0].boxes
    if boxes is not None and boxes.id is not None:
        for box, raw_id in zip(boxes, boxes.id):
            cls      = int(box.cls[0])
            track_id = int(raw_id)
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            cx, cy   = (x1+x2)//2, (y1+y2)//2
            is_person = cls == PERSON_CLASS
            label = "Person" if is_person else "Vehicle"

            prev_seen = state.last_seen.get(track_id)
            trail = state.touch_track(track_id, frame_count)
            trail.append((cx, cy))

            was_suspicious = track_id in state.suspicious_ids
            if detect_zigzag(trail):
                state.suspicious_ids.add(track_id)
                if not was_suspicious:
                    state.add_alert(f"Suspicious movement! {label} ID:{track_id}")

            box = (x1, y1, x2, y2)

            # A hit is any part of the box on the wire, OR the centre's path
            # since the last detection crossing it. Detection runs a few times
            # a second, so a fast object can jump the wire between analysed
            # frames without its box ever overlapping it.
            prev = state.prev_positions.get(track_id)
            if track_id not in state.crossed_ids:
                for tw in state.tripwires:
                    if box_touches_line(box, tw['p1'], tw['p2']) or (
                            prev is not None and
                            segments_intersect(prev, (cx, cy), tw['p1'], tw['p2'])):
                        state.crossed_ids.add(track_id)
                        state.add_alert(f"{label} crossed {tw['name']}!")
                        break

            prev_position = state.prev_positions.get(track_id)
            state.prev_positions[track_id] = (cx, cy)
            velocity = track_velocity(state, track_id, prev_position, prev_seen,
                                      (cx, cy), frame_count)

            # Every containing zone, not just the first. The loop used to break
            # on the first match, so an object standing in overlapping zones was
            # counted in exactly one of them.
            in_any_zone = False
            for zone in state.zones:
                # Partial overlap counts: any part of the box inside the zone.
                if not box_touches_zone(box, zone['points']):
                    continue
                in_any_zone = True
                if is_person: zone['persons'] += 1
                else:         zone['vehicles'] += 1

                if state.modes['loitering']:
                    key = (zone['name'], track_id)
                    if key not in state.loiter_start:
                        state.loiter_start[key] = time.time()
                    elif time.time() - state.loiter_start[key] > config.LOITER_SECONDS:
                        state.loitering_ids.add(track_id)
                        zone['loiterer'] = True
                        if key not in state.loiter_alerted:
                            state.add_alert(f"Loitering in {zone['name']}! ID:{track_id}")
                            state.loiter_alerted.add(key)

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

            overlay.append({
                'box': (x1, y1, x2, y2), 'color': box_color,
                'label': f"{'person' if is_person else 'vehicle'}#{track_id}{tag}",
                'trail': list(trail),
                'trail_color': (0, 0, 255) if is_suspicious else (100, 100, 255),
                'arrow': (prev_position, (cx, cy)) if prev_position is not None else None,
                'arrow_color': (0, 0, 255) if is_suspicious else (0, 255, 255),
                'velocity': velocity, 'frame': frame_count,
            })

            # Site-wide totals count everything detected. They used to count
            # only in-zone objects despite the name, so a deployment with no
            # zones drawn reported zero people forever.
            if is_person: total_persons += 1
            else:         total_vehicles += 1

    state.total_persons = total_persons
    state.total_vehicles = total_vehicles
    state.overlay = overlay

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

    # Elapsed, not `% N == 0`: detection runs on whichever frame is freshest, so
    # frame numbers arrive with gaps and an exact multiple may never come up.
    if frame_count - state.last_evict >= config.TRACK_EVICT_EVERY_FRAMES:
        state.evict_stale_tracks(frame_count)
        state.last_evict = frame_count


class Detector(threading.Thread):
    """Runs YOLO beside the display loop instead of in it.

    Inference is ~200ms a frame on CPU. Run inline, it capped the dashboard at
    under 2 FPS; here it always works on the freshest frame (older ones are
    dropped, never queued) while the video plays at its own rate.
    """

    def __init__(self, model, state, lock):
        super().__init__(daemon=True)
        self.model, self.state, self.lock = model, state, lock
        self._cond = threading.Condition()
        self._pending = None
        self._stopped = False

    def submit(self, frame, frame_count):
        with self._cond:
            self._pending = (frame, frame_count)   # latest wins
            self._cond.notify()

    def stop(self):
        with self._cond:
            self._stopped = True
            self._cond.notify()

    def run(self):
        while True:
            with self._cond:
                while self._pending is None and not self._stopped:
                    self._cond.wait()
                if self._stopped:
                    return
                frame, frame_count = self._pending
                self._pending = None
            try:
                results = self.model.track(frame, verbose=False, conf=0.3,
                                           imgsz=config.DETECT_IMGSZ,
                                           classes=ALLOWED_CLASSES, persist=True)
                with self.lock:
                    analyse_frame(frame, results, self.state, frame_count)
            except Exception as exc:   # one bad frame must not kill detection for the session
                print(f"Detection error on frame {frame_count}: {type(exc).__name__}: {exc}")


def load_model():
    print("Loading model...")
    from ultralytics import YOLO
    # Thread count deliberately left at torch's default (half the logical
    # cores). Measured: raising it to all-but-two halved detections/sec, as
    # inference then fights video decode/encode for the same cores.
    model = YOLO(config.MODEL_FILE)
    print("Model loaded.")
    return model


def open_log_file():
    config.ensure_runtime_dirs()
    path = os.path.join(
        config.LOGS_DIR, f"alert_log_{time.strftime('%Y%m%d_%H%M%S')}.txt")
    return open(path, 'a', encoding='utf-8'), path


def _publish_reset(state):
    state.reset(keep_zones=True)
    bus.update_state(
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
            published = None
            while should_run() and not bus.get_setup_done():
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

                # Re-encode only when the picture changed. The still frame used
                # to be redrawn and JPEG-encoded 20x/sec while nothing happened.
                shown = (id(first_frame), source_label, len(state.zones),
                         len(state.tripwires), state.alert_seq)
                if shown != published:
                    display = first_frame.copy()
                    draw_all_zones(display, state.zones)
                    draw_all_tripwires(display, state.tripwires)
                    draw_source_label(display, source_label, is_live)
                    publisher.publish_setup(display, state)
                    published = shown
                time.sleep(0.05)

            if restart_source:
                continue
            if not should_run():
                break

            print("Detection started!")
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

            # ── Detection phase ───────────────────────────────────────────────
            # Video plays at its native rate; the Detector thread analyses the
            # freshest frame it can keep up with, and every displayed frame gets
            # the latest overlay. `lock` serialises state between the two.
            frame_count = 0
            src_fps = cap.get(cv2.CAP_PROP_FPS)
            if not 1 <= src_fps <= 120:
                src_fps = 25.0
            publish_every = max(1, round(src_fps / config.DISPLAY_FPS))
            next_due = time.monotonic()

            lock = threading.Lock()
            detector = Detector(model, state, lock)
            detector.start()

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

                    with lock:
                        process_commands(state, source)
                    frame_count += 1
                    detector.submit(frame.copy(), frame_count)

                    if frame_count % publish_every == 0:
                        # ponytail: boxes lag moving objects by one inference
                        # (~200ms on CPU); a GPU closes the gap, no code change.
                        with lock:
                            draw_overlay(frame, state, frame_count)
                            draw_source_label(frame, source_label, is_live)
                            publisher.publish_detection(frame, state)

                    # A file decodes faster than real time; pace it so playback
                    # is not a fast-forward. Live streams arrive at their own rate.
                    if not is_live:
                        next_due += 1 / src_fps
                        delay = next_due - time.monotonic()
                        if delay > 0:
                            time.sleep(delay)
                        elif delay < -0.5:
                            next_due = time.monotonic()   # fell behind; don't burst to catch up

            except StopDetection:
                print("Detection stopped. Back to setup mode.")
                cap.release()
                continue

            except SwitchSource:
                print("Source switch during detection. Restarting...")
                cap.release()
                continue

            finally:
                detector.stop()

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
