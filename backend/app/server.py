import asyncio
import json
import os
import secrets
import threading
from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from typing import Annotated, List, Literal

from app import config

app = FastAPI()

# An explicit allowlist, not ["*"]. With a wildcard, any page an operator visited
# could script cross-site requests against the detection server on their LAN.
ALLOWED_ORIGINS = config.allowed_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ── Shared state ─────────────────────────────────────────────────────────────
#
# Two threads touch what follows: the detection loop writes it, and the asyncio
# event loop serialises it for every connected socket. `state_lock` guards both
# structures — it used to be declared here and never taken, so a reader could
# (and occasionally did) serialise a half-written frame.
#
# The accessors below are the supported way in. Reach for shared_state directly
# and you are back to the unsynchronised version. Writers always *replace* the
# nested lists rather than mutating them in place, which is what makes the
# shallow copy in snapshot_state() safe.

state_lock = threading.RLock()

shared_state = {
    "frame":          None,
    "alerts":         [],
    "zones":          [],
    "total_persons":  0,
    "total_vehicles": 0,
    "night":          False,
    "surge":          False,
    "modes":          {'loitering': True, 'night': True, 'surge': True},
    "setup_done":     False,
    "frame_width":    config.FRAME_WIDTH,
    "frame_height":   config.FRAME_HEIGHT,
}
pending_commands = []

# Bumped on every write. The socket compares it instead of re-sending an
# unchanged payload — an idle system was pushing a full base64 JPEG to every
# client twenty times a second.
_state_version = 0


def update_state(**fields):
    """Publish new telemetry. The only supported writer."""
    global _state_version
    with state_lock:
        shared_state.update(fields)
        _state_version += 1


def snapshot_state():
    """A consistent copy of the state, plus its version."""
    with state_lock:
        return dict(shared_state), _state_version


def get_setup_done():
    with state_lock:
        return shared_state["setup_done"]


def queue_command(command):
    """Enqueue work for the detection loop, dropping the oldest if it stalls.

    The loop drains this list; if it wedges, an unbounded queue is a memory leak
    an unauthenticated caller could once drive. Newest wins — a stale command is
    worth less than the current one.
    """
    with state_lock:
        pending_commands.append(command)
        while len(pending_commands) > config.MAX_PENDING_COMMANDS:
            pending_commands.pop(0)


def take_commands():
    """Atomically drain the queue. Returns the commands in arrival order."""
    with state_lock:
        drained = pending_commands[:]
        del pending_commands[:]
        return drained


# ── Authentication ───────────────────────────────────────────────────────────
#
# Every state-changing endpoint and the video socket require the shared operator
# token (config.AUTH_TOKEN, printed by run.py at startup).
#
# The token is sent as an Authorization header rather than a cookie, and that is
# deliberate: cookies are attached by the browser on cross-site requests, so a
# cookie session would still be forgeable from a malicious page. A custom header
# cannot be set cross-origin without a CORS preflight, and the allowlist above
# rejects that preflight. The explicit Origin check below is the second line of
# defence, independent of middleware behaviour.

def _token_matches(candidate: str) -> bool:
    return secrets.compare_digest(candidate, config.AUTH_TOKEN)


def require_operator(request: Request, authorization: Annotated[str, Header()] = ""):
    origin = request.headers.get("origin")
    if origin is not None and origin not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="Origin not allowed")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token or not _token_matches(token):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid operator token",
            headers={"WWW-Authenticate": "Bearer"},
        )


OPERATOR = [Depends(require_operator)]

# ── Request models ───────────────────────────────────────────────────────────
Name = Annotated[str, Field(min_length=1, max_length=config.MAX_NAME_LENGTH)]
Coordinate = Annotated[int, Field(ge=-config.MAX_COORDINATE, le=config.MAX_COORDINATE)]
Point = Annotated[List[Coordinate], Field(min_length=2, max_length=2)]

class StrictModel(BaseModel):
    # Unknown keys are a client bug or a probe; either way, say so rather than
    # silently discarding them.
    model_config = ConfigDict(extra="forbid")

class ZoneData(StrictModel):
    name: Name
    points: Annotated[List[Point], Field(min_length=3, max_length=config.MAX_ZONE_POINTS)]

class TripwireData(StrictModel):
    name: Name
    p1: Point
    p2: Point

class ModeData(StrictModel):
    # A Literal, not a bare str: set_mode writes straight into the detection
    # loop's modes dict, so an unconstrained key let a caller add arbitrary
    # entries to it.
    mode: Literal["loitering", "night", "surge"]
    value: bool

@app.post("/add_zone", dependencies=OPERATOR)
def add_zone(zone: ZoneData):
    queue_command({'type': 'add_zone', 'data': zone.model_dump()})
    return {"status": "ok"}

@app.post("/add_tripwire", dependencies=OPERATOR)
def add_tripwire(tw: TripwireData):
    queue_command({'type': 'add_tripwire', 'data': tw.model_dump()})
    return {"status": "ok"}

@app.post("/start_detection", dependencies=OPERATOR)
def start_detection():
    queue_command({'type': 'start_detection'})
    update_state(setup_done=True)
    return {"status": "ok"}

@app.post("/stop_detection", dependencies=OPERATOR)
def stop_detection():
    queue_command({'type': 'stop_detection'})
    update_state(setup_done=False)
    return {"status": "ok"}

@app.post("/set_mode", dependencies=OPERATOR)
def set_mode(data: ModeData):
    queue_command({'type': 'set_mode', 'mode': data.mode, 'value': data.value})
    return {"status": "ok"}

@app.post("/auth/check", dependencies=OPERATOR)
def auth_check():
    """Lets a console validate a token before storing it. No side effects."""
    return {"status": "ok"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # WebSockets are exempt from the same-origin policy and CORS does not apply
    # to them, so the handshake is checked here by hand.
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in ALLOWED_ORIGINS:
        await websocket.close(code=1008)
        return

    # The browser WebSocket API cannot set an Authorization header, so the token
    # is offered as a subprotocol. That keeps it out of the URL, and therefore
    # out of access logs and Referer headers.
    offered = [
        p.strip()
        for p in websocket.headers.get("sec-websocket-protocol", "").split(",")
        if p.strip()
    ]
    token = next(
        (p[len(config.WS_TOKEN_PREFIX):] for p in offered
         if p.startswith(config.WS_TOKEN_PREFIX)),
        "",
    )
    if not token or not _token_matches(token):
        await websocket.close(code=1008)
        return

    # RFC 6455: the accepted subprotocol must be one the client offered.
    await websocket.accept(
        subprotocol=config.WS_PROTOCOL if config.WS_PROTOCOL in offered else None
    )
    try:
        last_sent = None
        while True:
            await asyncio.sleep(0.05)
            state, version = snapshot_state()
            # Only send what the client has not already got. Without this an
            # idle system pushed a full base64 JPEG at 20Hz to every viewer.
            if version == last_sent or not state["frame"]:
                continue
            last_sent = version
            await websocket.send_text(json.dumps(state))
    except WebSocketDisconnect:
        pass

# ── Mobile page ──────────────────────────────────────────────────────────────
MOBILE_PATH = config.MOBILE_PAGE

@app.get("/mobile")
def serve_mobile():
    if os.path.exists(MOBILE_PATH):
        return FileResponse(MOBILE_PATH)
    return HTMLResponse("<h1>mobile.html not found. Expected it at backend/web/mobile.html</h1>")

# ── Static (React dashboard) ─────────────────────────────────────────────────
STATIC_PATH = config.STATIC_DIR

# The inner directory, not the outer one. StaticFiles raises at construction if
# its directory is missing, and that happens at import — so checking only the
# outer path meant a half-copied build took the whole server down on startup
# instead of just serving no dashboard.
_STATIC_ASSETS = os.path.join(STATIC_PATH, "static")
if os.path.isdir(_STATIC_ASSETS):
    app.mount("/static", StaticFiles(directory=_STATIC_ASSETS), name="static")

# Paths the API owns. A GET to one of these fell through to the SPA catch-all
# and returned 200 + index.html, so a typo'd endpoint or a wrong-method call
# looked like a success.
API_PATHS = {
    "/add_zone", "/add_tripwire", "/start_detection",
    "/stop_detection", "/set_mode", "/auth/check", "/ws",
}


def _serve_index():
    index = os.path.join(STATIC_PATH, "index.html")
    if os.path.exists(index):
        return FileResponse(index)
    return HTMLResponse(
        "<h1>Dashboard build not found.</h1>"
        "<p>Run <code>npm run build</code> in frontend/, then restart.</p>",
        status_code=503,
    )

@app.get("/")
def serve_react():
    return _serve_index()

@app.get("/{full_path:path}")
def catch_all(full_path: str):
    if full_path == "mobile":
        return serve_mobile()

    path = "/" + full_path
    if path in API_PATHS:
        raise HTTPException(status_code=405, detail="Method not allowed on this endpoint")

    # Anything with an extension is an asset request, not a client-side route.
    # Handing it index.html yields HTML served as a .js/.css/.png, which fails
    # confusingly far from the cause.
    if os.path.splitext(full_path)[1]:
        raise HTTPException(status_code=404, detail="Not found")

    return _serve_index()
