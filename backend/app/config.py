"""Central configuration: every filesystem path and tunable lives here.

Nothing else in the backend should hardcode a path — import from this module so
that moving a directory is a one-line change.
"""

import os
import re
import secrets
import socket

# ── Directory layout ─────────────────────────────────────────────────────────
APP_DIR      = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR  = os.path.dirname(APP_DIR)
PROJECT_DIR  = os.path.dirname(BACKEND_DIR)

WEB_DIR      = os.path.join(BACKEND_DIR, "web")
STATIC_DIR   = os.path.join(WEB_DIR, "static")          # React build, copied by run.py
MOBILE_PAGE  = os.path.join(WEB_DIR, "mobile.html")

MODELS_DIR   = os.path.join(BACKEND_DIR, "models")
VIDEOS_DIR   = os.path.join(BACKEND_DIR, "data", "videos")
LOGS_DIR     = os.path.join(BACKEND_DIR, "logs")

FRONTEND_BUILD_DIR = os.path.join(PROJECT_DIR, "frontend", "build")

# ── Model / media ────────────────────────────────────────────────────────────
# KAVACH_MODEL swaps in a lighter checkpoint on small hosts (Render sets yolov8n.pt).
MODEL_FILE = os.path.join(MODELS_DIR, os.environ.get("KAVACH_MODEL", "yolov8m.pt"))
# VIDEO_FILE = os.path.join(VIDEOS_DIR, "Vehicle and Surge Detection.mp4")
VIDEO_FILE = os.path.join(VIDEOS_DIR, "Person Detection.mp4")
LIVE_URL   = "https://www.youtube.com/watch?v=zMCea32gpmg"

# ── Server ───────────────────────────────────────────────────────────────────
# 0.0.0.0 is the default because the mobile console is a core feature and the
# phone reaches the box over the LAN. That exposure is only defensible because
# every state-changing endpoint and the video socket now require a token (see
# AUTH_TOKEN below). Set KAVACH_HOST=127.0.0.1 for a desktop-only deployment.
HOST = os.environ.get("KAVACH_HOST", "0.0.0.0")
# PORT is what Render (and most PaaS hosts) assign; KAVACH_PORT still wins locally.
PORT = int(os.environ.get("KAVACH_PORT") or os.environ.get("PORT", "8000"))

DEV_SERVER_PORT = 3000      # CRA's `npm start` server, during frontend development

# ── Access control ───────────────────────────────────────────────────────────
# Shared-secret bearer token. Set KAVACH_TOKEN to keep it stable across restarts
# (open dashboards survive a reload); leave it unset and a fresh one is minted
# per run and printed in the startup banner.
#
# The token travels in an Authorization header on HTTP and in the WebSocket
# subprotocol header — never in a URL query string, so it stays out of access
# logs and Referer headers. Both of those are header *tokens*, so the character
# set is restricted.
_TOKEN_CHARSET = re.compile(r"^[A-Za-z0-9._~-]{16,}$")

_env_token = os.environ.get("KAVACH_TOKEN")
if _env_token and not _TOKEN_CHARSET.match(_env_token):
    raise SystemExit(
        "KAVACH_TOKEN must be at least 16 characters from [A-Za-z0-9._~-]. "
        "It is sent as a WebSocket subprotocol name, which forbids other bytes."
    )

AUTH_TOKEN = _env_token or secrets.token_urlsafe(24)
AUTH_TOKEN_IS_EPHEMERAL = _env_token is None

# WebSocket subprotocol names. The browser WebSocket API cannot set headers, so
# the token rides in Sec-WebSocket-Protocol — the standard workaround.
WS_PROTOCOL = "kavach.v1"
WS_TOKEN_PREFIX = "kavach-token."
WS_TELEMETRY_ONLY = "kavach.telemetry-only"   # offered by clients that show no video


def local_ip():
    """Best-effort LAN address of this machine, or 'localhost' if offline."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return "localhost"


def allowed_origins():
    """Browser origins permitted to call the API.

    Replaces the previous allow_origins=["*"], which let any website an operator
    visited issue cross-site requests at the detection server on their LAN. Add
    a reverse proxy or a hostname with KAVACH_ALLOWED_ORIGINS (comma-separated).
    """
    hosts = ["localhost", "127.0.0.1"]
    ip = local_ip()
    if ip not in hosts:
        hosts.append(ip)

    origins = [
        f"{scheme}://{host}:{port}"
        for scheme in ("http", "https")
        for host in hosts
        for port in (PORT, DEV_SERVER_PORT)
    ]
    origins += [
        o.strip().rstrip("/")
        for o in os.environ.get("KAVACH_ALLOWED_ORIGINS", "").split(",")
        if o.strip()
    ]
    return origins


# ── Frame geometry ───────────────────────────────────────────────────────────
# Every frame is resized to this before detection, drawing, or encoding, and
# operator-drawn zone coordinates are expressed in it. It was previously spelled
# out in four places across two languages; the backend now publishes it in the
# telemetry payload so the console cannot drift out of sync with it.
FRAME_WIDTH  = 1280
FRAME_HEIGHT = 720

# ── Detection tuning ─────────────────────────────────────────────────────────
DISPLAY_FPS = 25            # dashboard frame-rate cap; YOLO runs beside it, not in its path

# YOLO input size (multiple of 32). 640 finds the smallest, farthest objects and
# separates people walking in a group; on CPU, 480 is ~40% faster and loses only
# tiny ones. The CPU size is used automatically when no CUDA GPU is available.
DETECT_IMGSZ     = 640
DETECT_IMGSZ_CPU = 480

# Boxes are drawn where each track is predicted to be *now*, from its measured
# velocity, rather than where it was when the (slower) detector last saw it.
# Capped so a track that vanished is not flung across the screen.
MAX_EXTRAPOLATE_FRAMES = 15

# When a new detection corrects a box's position, this fraction of the
# correction is applied per displayed frame, so boxes glide instead of snapping.
# Steady motion is followed exactly; only the correction is eased.
BOX_SMOOTHING = 0.5

LOITER_SECONDS   = 5        # dwell in a zone before it counts as loitering
SURGE_WINDOW     = 90       # rolling frame window for surge comparison
SURGE_THRESHOLD  = 5        # person-count rise across the window that trips a surge
PATH_HISTORY_LEN = 20       # trail length kept per tracked object
ZIGZAG_THRESHOLD = 4        # direction changes before movement reads as evasive
ZIGZAG_MIN_STEP  = 15       # px a track must move before a step counts (filters box jitter)
ZIGZAG_MIN_TURN  = 90       # degrees a step must turn to count as a direction change
TRAIL_DRAW_LEN   = 10       # most recent trail points drawn for a flagged track
ARROW_MIN_MOVE   = 8        # px between detections before a heading arrow is drawn

# A threat level must hold for this many consecutive evaluations before it is
# committed and alerted on. Without it, a count sitting on a threshold boundary
# re-alerts every frame and floods the alert log with flapping transitions.
THREAT_DEBOUNCE_FRAMES = 5

# Tracks vanish (occlusion, exit, tracker ID churn) and never come back. Their
# trails, positions and flags are dropped once unseen this long, which is what
# keeps the per-track bookkeeping from growing for the life of the process.
TRACK_EVICT_AFTER_FRAMES = 300
TRACK_EVICT_EVERY_FRAMES = 120

MAX_ALERTS = 200            # alert_log ring size; the console renders up to this

# ── Vehicle intelligence (demo: plate/registration data is simulated) ────────
PLATE_READ_DETECTIONS  = 4    # detections of a vehicle before its plate "reads"
DEMO_WATCHLIST_AT      = 4    # plates read before the first watchlist hit
DEMO_WATCHLIST_GAP_SECONDS = 75   # minimum time between watchlist hits
WATCHLIST_MIN_BOX_H    = 110  # px; hits only land on clearly visible vehicles
VEHICLE_REASSOC_FRAMES = 60   # a vehicle lost this recently can be re-claimed
VEHICLE_LOG_MAX        = 150  # vehicles kept in the console's log
VEHICLE_IN_VIEW_FRAMES = 20   # unseen longer than this = left the frame

SOURCE_RETRY_SECONDS = 5    # wait before retrying when no video source opens

# ── Request limits ───────────────────────────────────────────────────────────
# Bounds on operator-drawn geometry. Without these a single POST carrying a
# multi-million-point polygon is a trivial denial of service.
MAX_ZONE_POINTS  = 64
MAX_NAME_LENGTH  = 64
MAX_COORDINATE   = 10_000   # generous vs. the 1280x720 working frame
MAX_PENDING_COMMANDS = 256


def ensure_runtime_dirs():
    """Create the directories that are written to at runtime."""
    os.makedirs(LOGS_DIR, exist_ok=True)
