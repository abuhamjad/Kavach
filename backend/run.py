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
    print("\n" + "=" * 55)
    print("  KAVACH BORDER SURVEILLANCE SYSTEM")
    print("=" * 55)
    print(f"  Backend : http://localhost:{config.PORT}")
    print(f"  Frontend: http://localhost:3000")
    print(f"  Mobile  : http://{local_ip}:{config.PORT}/mobile")
    print("=" * 55)
    print("\n  MOBILE SETUP:")
    print("  1. Connect your phone to the SAME WiFi")
    print("  2. Open browser on phone")
    print(f"  3. Go to: http://{local_ip}:{config.PORT}/mobile")
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
