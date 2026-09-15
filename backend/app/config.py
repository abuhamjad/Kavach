"""Central configuration: every filesystem path and tunable lives here.

Nothing else in the backend should hardcode a path — import from this module so
that moving a directory is a one-line change.
"""

import os

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
MODEL_FILE = os.path.join(MODELS_DIR, "yolov8m.pt")
VIDEO_FILE = os.path.join(VIDEOS_DIR, "test.mp4")
LIVE_URL   = "https://www.youtube.com/watch?v=zMCea32gpmg"

# ── Server ───────────────────────────────────────────────────────────────────
HOST = "0.0.0.0"
PORT = 8000

# ── Detection tuning ─────────────────────────────────────────────────────────
DETECT_EVERY_N_FRAMES = 2   # run YOLO every N frames (higher = faster, less smooth)
PUSH_EVERY_N_FRAMES   = 3   # push a frame to the dashboard every N frames


def ensure_runtime_dirs():
    """Create the directories that are written to at runtime."""
    os.makedirs(LOGS_DIR, exist_ok=True)
