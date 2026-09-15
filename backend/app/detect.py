import os
import cv2
import numpy as np
import time
import base64
import threading
from ultralytics import YOLO

from app import config
from app.server import shared_state, pending_commands

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════
#  All paths and tunables come from app/config.py — do not hardcode them here.
VIDEO_FILE  = config.VIDEO_FILE
LIVE_URL    = config.LIVE_URL

DETECT_EVERY_N_FRAMES = config.DETECT_EVERY_N_FRAMES
PUSH_EVERY_N_FRAMES   = config.PUSH_EVERY_N_FRAMES
# ══════════════════════════════════════════════════════════════════════════════

use_live    = False
source_lock = threading.Lock()

def get_stream_url(url):
    try:
        import yt_dlp
        print(f"Fetching stream URL from: {url}")
        ydl_opts = {'quiet': True, 'format': 'best[ext=mp4]/best'}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            stream = info.get('url') or info['formats'][-1]['url']
            print("Stream URL fetched successfully.")
            return stream
    except Exception as e:
        print(f"Stream fetch failed: {e}")
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

def push_to_dashboard(frame, zones, total_persons, total_vehicles, night, surge, modes):
    try:
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 65])
        shared_state["frame"]          = base64.b64encode(buffer).decode('utf-8')
        shared_state["alerts"]         = [{'time': a['time'], 'msg': a['msg']} for a in alert_log]
        shared_state["zones"]          = [
            {'name': z['name'], 'threat': z.get('threat', 'LOW'),
             'persons': z.get('persons', 0), 'vehicles': z.get('vehicles', 0)}
            for z in zones
        ]
        shared_state["total_persons"]  = total_persons
        shared_state["total_vehicles"] = total_vehicles
        shared_state["night"]          = night
        shared_state["surge"]          = surge
        shared_state["modes"]          = modes.copy()
    except Exception as e:
        print(f"Dashboard push error: {e}")

print("Loading model...")
model = YOLO(config.MODEL_FILE)
ALLOWED_CLASSES = [0, 2, 3, 5, 7]
print("Model loaded.")

zones            = []
tripwires        = []
zone_counter     = 1
tripwire_counter = 1

loiter_start         = {}
loitering_ids        = set()
LOITER_SECONDS       = 5
prev_positions       = {}
crossed_ids          = set()
person_count_history = []
SURGE_WINDOW         = 90
SURGE_THRESHOLD      = 5

path_history     = {}
suspicious_ids   = set()
PATH_HISTORY_LEN = 20
ZIGZAG_THRESHOLD = 4

alert_log    = []
MAX_ALERTS   = 12
config.ensure_runtime_dirs()
log_filename = os.path.join(
    config.LOGS_DIR, f"alert_log_{time.strftime('%Y%m%d_%H%M%S')}.txt"
)
log_file     = open(log_filename, 'a', encoding='utf-8')

def add_alert(msg, color=(0, 0, 255)):
    t = time.strftime("%H:%M:%S")
    alert_log.append({'time': t, 'msg': msg, 'color': color})
    if len(alert_log) > MAX_ALERTS:
        alert_log.pop(0)
    log_file.write(f"[{t}] {msg}\n")
    log_file.flush()
    print(f"[{t}] ALERT: {msg}")

modes = {'loitering': True, 'night': True, 'surge': True}

THREAT_COLORS = {
    "HIGH":   (0, 0, 255),
    "MEDIUM": (0, 165, 255),
    "LOW":    (0, 255, 0),
}

def point_in_zone(cx, cy, points):
    if len(points) < 3:
        return False
    return cv2.pointPolygonTest(
        np.array(points, dtype=np.int32), (cx, cy), False) >= 0

def is_night(frame):
    # bool(), not the bare comparison: numpy returns np.bool_, which json.dumps
    # cannot serialize — it crashed the /ws handler the moment night mode engaged.
    return bool(np.mean(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)) < 80)

def detect_surge(history, current):
    if len(history) >= SURGE_WINDOW:
        # Same numpy-bool hazard as is_night() when counts come from numpy types.
        return bool(current - history[-SURGE_WINDOW] >= SURGE_THRESHOLD)
    return False

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

def detect_zigzag(positions):
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
    return direction_changes >= ZIGZAG_THRESHOLD

def draw_path_trail(frame, positions, color):
    for i in range(1, len(positions)):
        alpha     = i / len(positions)
        thickness = 1 if alpha < 0.5 else 2
        pt_color  = tuple(int(c * alpha) for c in color)
        cv2.line(frame, positions[i-1], positions[i], pt_color, thickness)

def draw_all_zones(frame):
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

def draw_all_tripwires(frame):
    for tw in tripwires:
        cv2.line(frame, tw['p1'], tw['p2'], (0, 255, 255), 2)
        mid = ((tw['p1'][0]+tw['p2'][0])//2, (tw['p1'][1]+tw['p2'][1])//2)
        cv2.putText(frame, tw['name'], (mid[0]+5, mid[1]-5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

def reset_detection():
    global zones, tripwires, zone_counter, tripwire_counter
    global loiter_start, loitering_ids, prev_positions, crossed_ids
    global person_count_history, path_history, suspicious_ids, alert_log
    zones                = []
    tripwires            = []
    zone_counter         = 1
    tripwire_counter     = 1
    loiter_start         = {}
    loitering_ids        = set()
    prev_positions       = {}
    crossed_ids          = set()
    person_count_history = []
    path_history         = {}
    suspicious_ids       = set()
    alert_log            = []
    shared_state["frame"]          = None
    shared_state["alerts"]         = []
    shared_state["zones"]          = []
    shared_state["total_persons"]  = 0
    shared_state["total_vehicles"] = 0
    print("Detection reset.")

class SwitchSource(Exception):
    pass

def process_commands():
    global zone_counter, tripwire_counter, use_live
    while pending_commands:
        cmd = pending_commands.pop(0)
        if cmd['type'] == 'add_zone':
            d = cmd['data']
            zones.append({
                'name': d['name'],
                'points': [tuple(p) for p in d['points']],
                'threat': 'LOW', 'persons': 0, 'vehicles': 0, 'loiterer': False,
            })
            add_alert(f"Zone '{d['name']}' created", (0, 255, 0))
        elif cmd['type'] == 'add_tripwire':
            d = cmd['data']
            tripwires.append({
                'name': d['name'],
                'p1': tuple(d['p1']),
                'p2': tuple(d['p2']),
            })
            add_alert(f"Tripwire '{d['name']}' created", (0, 255, 255))
        elif cmd['type'] == 'set_mode':
            modes[cmd['mode']] = cmd['value']
        elif cmd['type'] == 'stop_detection':
            raise StopIteration
        elif cmd['type'] == 'switch_source':
            use_live = cmd['value']
            raise SwitchSource

def input_listener():
    global use_live
    print("\n=== SOURCE CONTROL ===")
    print("Type 'v' + Enter -> switch to video file")
    print("Type 'l' + Enter -> switch to live stream")
    print("======================\n")
    while True:
        try:
            key = input().strip().lower()
            if key == 'l':
                pending_commands.append({'type': 'switch_source', 'value': True})
                print("Switching to LIVE stream...")
            elif key == 'v':
                pending_commands.append({'type': 'switch_source', 'value': False})
                print("Switching to VIDEO file...")
        except Exception:
            break

input_thread = threading.Thread(target=input_listener, daemon=True)
input_thread.start()

# ── Main loop ──────────────────────────────────────────────────────────────────
while True:
    reset_detection()
    shared_state["setup_done"] = False

    cap, is_live = open_capture(use_live)
    ret, first_frame = cap.read()
    if not ret or first_frame is None:
        print("Could not read frame. Falling back to video file.")
        cap.release()
        cap, is_live = open_capture(False)
        ret, first_frame = cap.read()

    first_frame  = cv2.resize(first_frame, (1280, 720))
    source_label = "LIVE" if is_live else "VIDEO"
    print(f"Source: {source_label}")
    print("Waiting for zones to be drawn in browser...")

    # ── Setup phase ────────────────────────────────────────────────────────────
    while not shared_state["setup_done"]:
        try:
            process_commands()
        except StopIteration:
            pass
        except SwitchSource:
            cap.release()
            cap, is_live = open_capture(use_live)
            ret, first_frame = cap.read()
            if ret and first_frame is not None:
                first_frame  = cv2.resize(first_frame, (1280, 720))
                source_label = "LIVE" if is_live else "VIDEO"
                print(f"Source switched to: {source_label}")
            continue

        display = first_frame.copy()
        draw_all_zones(display)
        draw_all_tripwires(display)
        cv2.putText(display, f"SOURCE: {source_label}",
                    (display.shape[1]-200, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (0,255,0) if is_live else (0,165,255), 1)

        _, buffer = cv2.imencode('.jpg', display, [cv2.IMWRITE_JPEG_QUALITY, 65])
        shared_state["frame"] = base64.b64encode(buffer).decode('utf-8')
        shared_state["zones"] = [
            {'name': z['name'], 'threat': 'LOW', 'persons': 0, 'vehicles': 0}
            for z in zones
        ]
        time.sleep(0.05)

    print("Detection started!")
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    # ── Detection phase ────────────────────────────────────────────────────────
    frame_count  = 0
    last_results = None

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                if is_live:
                    print("Live stream dropped. Reconnecting...")
                    cap.release()
                    cap, is_live = open_capture(True)
                    continue
                else:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue

            process_commands()

            frame_count += 1
            frame = cv2.resize(frame, (1280, 720))

            # ── Run YOLO every N frames only ───────────────────────────────
            if frame_count % DETECT_EVERY_N_FRAMES == 0:
                last_results = model.track(frame, verbose=False, conf=0.3,
                                           classes=ALLOWED_CLASSES, persist=True)
            results = last_results
            if results is None:
                continue

            night = is_night(frame) if modes['night'] else False

            for zone in zones:
                zone['persons']  = 0
                zone['vehicles'] = 0
                zone['loiterer'] = False

            total_persons  = 0
            total_vehicles = 0

            draw_all_zones(frame)
            draw_all_tripwires(frame)

            cv2.putText(frame, f"SOURCE: {source_label}",
                        (frame.shape[1]-200, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                        (0,255,0) if is_live else (0,165,255), 1)

            if results[0].boxes is not None and results[0].boxes.id is not None:
                for box, track_id in zip(results[0].boxes, results[0].boxes.id):
                    cls      = int(box.cls[0])
                    track_id = int(track_id)
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cx, cy   = (x1+x2)//2, (y1+y2)//2

                    if track_id not in path_history:
                        path_history[track_id] = []
                    path_history[track_id].append((cx, cy))
                    if len(path_history[track_id]) > PATH_HISTORY_LEN:
                        path_history[track_id].pop(0)

                    was_suspicious = track_id in suspicious_ids
                    if detect_zigzag(path_history[track_id]):
                        suspicious_ids.add(track_id)
                        if not was_suspicious:
                            label = "Person" if cls == 0 else "Vehicle"
                            add_alert(f"Suspicious movement! {label} ID:{track_id}")

                    if track_id in prev_positions and track_id not in crossed_ids:
                        px, py = prev_positions[track_id]
                        for tw in tripwires:
                            if segments_intersect((px,py),(cx,cy), tw['p1'], tw['p2']):
                                crossed_ids.add(track_id)
                                label = "Person" if cls == 0 else "Vehicle"
                                add_alert(f"{label} crossed {tw['name']}!")

                    prev_positions[track_id] = (cx, cy)

                    in_any_zone = False
                    for zone in zones:
                        if point_in_zone(cx, cy, zone['points']):
                            in_any_zone = True
                            if cls == 0: zone['persons']  += 1
                            else:        zone['vehicles'] += 1
                            if modes['loitering']:
                                key_id = f"{zone['name']}_{track_id}"
                                if key_id not in loiter_start:
                                    loiter_start[key_id] = time.time()
                                elif time.time() - loiter_start[key_id] > LOITER_SECONDS:
                                    loitering_ids.add(track_id)
                                    zone['loiterer'] = True
                                    alerted_key = f"loiter_alerted_{track_id}"
                                    if alerted_key not in loiter_start:
                                        add_alert(f"Loitering in {zone['name']}! ID:{track_id}")
                                        loiter_start[alerted_key] = time.time()
                            break

                    if len(path_history[track_id]) > 1:
                        trail_color = (0,0,255) if track_id in suspicious_ids else (100,100,255)
                        draw_path_trail(frame, path_history[track_id], trail_color)

                    is_suspicious = track_id in suspicious_ids
                    is_loitering  = track_id in loitering_ids
                    if is_suspicious:
                        box_color, tag = (0,0,255), " SUSPICIOUS!"
                    elif is_loitering:
                        box_color, tag = (0,0,255), " LOITER!"
                    elif in_any_zone:
                        box_color, tag = (0,165,255), ""
                    else:
                        box_color = (0,255,0) if cls==0 else (255,255,0)
                        tag = ""

                    cv2.rectangle(frame, (x1,y1),(x2,y2), box_color, 2)
                    label = "person" if cls==0 else "vehicle"
                    cv2.putText(frame, f"{label}#{track_id}{tag}",
                                (x1, y1-5), cv2.FONT_HERSHEY_SIMPLEX, 0.42, box_color, 1)

                    if track_id in prev_positions:
                        arrow_color = (0,0,255) if is_suspicious else (0,255,255)
                        draw_direction_arrow(frame, prev_positions[track_id], (cx,cy), arrow_color)

                    if in_any_zone:
                        if cls==0: total_persons  += 1
                        else:      total_vehicles += 1

            for zone in zones:
                old_threat = zone.get('threat', 'LOW')
                threat, _  = get_threat_level(
                    zone['persons'], zone['vehicles'],
                    zone.get('loiterer', False), night,
                    detect_surge(person_count_history, zone['persons']) if modes['surge'] else False
                )
                zone['threat'] = threat
                if threat != old_threat:
                    add_alert(f"{zone['name']} threat: {old_threat} -> {threat}",
                              THREAT_COLORS[threat])

            person_count_history.append(total_persons)
            surge = detect_surge(person_count_history, total_persons) if modes['surge'] else False

            # ── Push to dashboard every N frames only ──────────────────────
            if frame_count % PUSH_EVERY_N_FRAMES == 0:
                push_to_dashboard(frame, zones, total_persons, total_vehicles,
                                  night, surge, modes)

    except StopIteration:
        print("Detection stopped. Back to setup mode.")
        cap.release()
        continue

    except SwitchSource:
        print("Source switch during detection. Restarting...")
        cap.release()
        continue

cap.release()
log_file.close()
print(f"Alert log saved to: {log_filename}")
