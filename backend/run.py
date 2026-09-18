"""Kavach entry point.

Copies the React build into web/static, starts the FastAPI server in a
background thread, then runs the detection loop in the foreground.

    python run.py
"""

import os
import shutil
import sys
import threading
import time
import webbrowser

import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import config

SERVER_START_TIMEOUT = 15   # seconds to wait for uvicorn to report ready


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


def start_server():
    """Start uvicorn in a background thread and wait until it is really serving.

    Returns the server object. Startup used to be `time.sleep(2)` followed by
    opening a browser and hoping — too long on a fast machine, and a race on a
    slow one. uvicorn exposes `started`, so wait on the actual signal.
    """
    server = uvicorn.Server(uvicorn.Config(
        "app.server:app", host=config.HOST, port=config.PORT, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()

    deadline = time.time() + SERVER_START_TIMEOUT
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:
        print(f"WARNING: server did not report ready within {SERVER_START_TIMEOUT}s; "
              f"continuing anyway.")
    return server


def print_banner(local_ip):
    token = config.AUTH_TOKEN
    mobile_url = f"http://{local_ip}:{config.PORT}/mobile#token={token}"

    print("\n" + "=" * 55)
    print("  KAVACH BORDER SURVEILLANCE SYSTEM")
    print("=" * 55)
    print(f"  Desktop  : http://localhost:{config.PORT}")
    print(f"  Mobile   : http://{local_ip}:{config.PORT}/mobile")
    print("=" * 55)
    print("\n  OPERATOR TOKEN:")
    print(f"  {token}")
    if config.AUTH_TOKEN_IS_EPHEMERAL:
        print("  (new token each run — set KAVACH_TOKEN to keep it stable)")
    print("  Required to control detection or view the feed.")
    print("=" * 55)
    print("\n  MOBILE SETUP:")
    print("  1. Connect your phone to the SAME WiFi")
    print("  2. Open browser on phone")
    print(f"  3. Go to: {mobile_url}")
    print("     (or open /mobile and paste the token above)")
    print("  4. Add to home screen for app-like experience")
    print("=" * 55 + "\n")


def main():
    config.ensure_runtime_dirs()
    sync_dashboard_build()

    start_server()

    print_banner(config.local_ip())
    # The token rides in the fragment: fragments are never sent to the server,
    # so it stays out of access logs. The console consumes it and strips it from
    # the address bar on load.
    webbrowser.open(f"http://localhost:{config.PORT}/#token={config.AUTH_TOKEN}")

    from app import detect
    detect.run()


if __name__ == "__main__":
    main()
