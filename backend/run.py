"""Kavach entry point.

Copies the React build into web/static, starts the FastAPI server in a
background thread, then runs the detection loop in the foreground.

    python run.py
"""

import os
import shutil
import socket
import sys
import threading
import time
import webbrowser

import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import config


def sync_dashboard_build():
    """Copy the frontend production build into web/static so the API can serve it."""
    if not os.path.exists(config.FRONTEND_BUILD_DIR):
        print("WARNING: React build not found at:", config.FRONTEND_BUILD_DIR)
        print("         Run `npm run build` in the frontend/ folder first.")
        return
    if os.path.exists(config.STATIC_DIR):
        shutil.rmtree(config.STATIC_DIR)
    shutil.copytree(config.FRONTEND_BUILD_DIR, config.STATIC_DIR)
    print("Dashboard build ready.")


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "localhost"


def start_server():
    uvicorn.run("app.server:app", host=config.HOST, port=config.PORT,
                log_level="warning")


def print_banner(local_ip):
    print("\n" + "=" * 55)
    print("  KAVACH BORDER SURVEILLANCE SYSTEM")
    print("=" * 55)
    print(f"  Desktop  : http://localhost:{config.PORT}")
    print(f"  Mobile   : http://{local_ip}:{config.PORT}/mobile")
    print("=" * 55)
    print("\n  MOBILE SETUP:")
    print("  1. Connect your phone to the SAME WiFi")
    print("  2. Open browser on phone")
    print(f"  3. Go to: http://{local_ip}:{config.PORT}/mobile")
    print("  4. Add to home screen for app-like experience")
    print("=" * 55 + "\n")


def main():
    config.ensure_runtime_dirs()
    sync_dashboard_build()

    threading.Thread(target=start_server, daemon=True).start()
    time.sleep(2)

    print_banner(get_local_ip())
    webbrowser.open(f"http://localhost:{config.PORT}")

    # detect.py is a top-level script (its detection loop runs on import), so
    # importing it here is what actually starts detection.
    import app.detect  # noqa: F401


if __name__ == "__main__":
    main()
