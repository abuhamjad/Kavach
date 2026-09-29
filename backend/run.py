"""Kavach entry point.

Starts the FastAPI backend server. The detector is started automatically
via FastAPI's lifespan when the server starts.

    python run.py
"""

import os
import sys

import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import config


def print_banner(local_ip):
    token = config.AUTH_TOKEN
    mobile_url = f"http://{local_ip}:{config.PORT}/mobile#token={token}"

    print("\n" + "=" * 55)
    print("  KAVACH BORDER SURVEILLANCE SYSTEM")
    print("=" * 55)
    print(f"  Backend : http://localhost:{config.PORT}")
    print(f"  Mobile  : http://{local_ip}:{config.PORT}/mobile")
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


if __name__ == "__main__":
    config.ensure_runtime_dirs()

    print_banner(config.local_ip())

    uvicorn.run(
        "app.server:app",
        host=config.HOST,
        port=config.PORT,
        log_level="warning"
    )
