import asyncio
import json
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from typing import Annotated, List, Literal

from app import config

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
).split(",")


@asynccontextmanager
async def lifespan(app: FastAPI):
    def start_detector():
        from app import detect
        detect.run()

    threading.Thread(target=start_detector, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Shared state and the command queue live in app.bus; re-exported here because
# they are part of this module's surface (tests and callers use them).
from app.bus import (  # noqa: E402,F401
    get_setup_done, pending_commands, queue_command, shared_state,
    snapshot_state, take_commands, update_state,
)

# ── Request models ───────────────────────────────────────────────────────────
Name = Annotated[str, Field(min_length=1, max_length=config.MAX_NAME_LENGTH)]
Coordinate = Annotated[int, Field(ge=-config.MAX_COORDINATE, le=config.MAX_COORDINATE)]
Point = Annotated[List[Coordinate], Field(min_length=2, max_length=2)]

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

class ZoneData(StrictModel):
    name: Name
    points: Annotated[List[Point], Field(min_length=3, max_length=config.MAX_ZONE_POINTS)]

class TripwireData(StrictModel):
    name: Name
    p1: Point
    p2: Point

class ModeData(StrictModel):
    mode: Literal["loitering", "night", "surge"]
    value: bool

@app.post("/add_zone")
def add_zone(zone: ZoneData):
    queue_command({'type': 'add_zone', 'data': zone.model_dump()})
    return {"status": "ok"}

@app.post("/add_tripwire")
def add_tripwire(tw: TripwireData):
    queue_command({'type': 'add_tripwire', 'data': tw.model_dump()})
    return {"status": "ok"}

@app.post("/start_detection")
def start_detection():
    queue_command({'type': 'start_detection'})
    update_state(setup_done=True)
    return {"status": "ok"}

@app.post("/stop_detection")
def stop_detection():
    queue_command({'type': 'stop_detection'})
    update_state(setup_done=False)
    return {"status": "ok"}

@app.post("/set_mode")
def set_mode(data: ModeData):
    queue_command({'type': 'set_mode', 'mode': data.mode, 'value': data.value})
    return {"status": "ok"}

class ShapeRef(StrictModel):
    kind: Literal["zone", "tripwire"]
    name: Name

@app.post("/remove_shape")
def remove_shape(ref: ShapeRef):
    queue_command({'type': 'remove_shape', 'kind': ref.kind, 'name': ref.name})
    return {"status": "ok"}

@app.post("/clear_zones")
def clear_zones():
    queue_command({'type': 'clear_zones'})
    return {"status": "ok"}

@app.get("/ws")
def ws_info():
    return {"status": "ok", "message": "WebSocket endpoint available at /ws"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    try:
        last_version, last_frame, last_telemetry = None, None, None
        while True:
            await asyncio.sleep(0.02)
            state, version = snapshot_state()
            frame = state.pop("frame")
            if version == last_version or not frame:
                continue
            last_version = version

            telemetry = json.dumps(state)
            if telemetry != last_telemetry:
                await websocket.send_text(telemetry)
                last_telemetry = telemetry
            if frame is not last_frame:
                await websocket.send_bytes(frame)
                last_frame = frame
    except WebSocketDisconnect:
        pass

# ── Mobile page ──────────────────────────────────────────────────────────────
MOBILE_PATH = config.MOBILE_PAGE

@app.get("/mobile")
def serve_mobile():
    if os.path.exists(MOBILE_PATH):
        return FileResponse(MOBILE_PATH)
    return HTMLResponse("<h1>mobile.html not found. Expected it at backend/web/mobile.html</h1>")

@app.get("/mobile.css")
def serve_mobile_css():
    return FileResponse(os.path.join(config.WEB_DIR, "mobile.css"), media_type="text/css")

@app.get("/mobile.js")
def serve_mobile_js():
    return FileResponse(os.path.join(config.WEB_DIR, "mobile.js"), media_type="text/javascript")

# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}
