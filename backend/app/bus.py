"""The hand-off between the detection loop and the API.

Detection writes telemetry and reads operator commands; the API does the
reverse. Neither side imports the other — both import this. It used to live
inside server.py, which made the detection layer depend on the web framework.

Two threads touch what follows, so `state_lock` guards both structures. Writers
always *replace* nested values rather than mutating them in place, which is what
makes the shallow copy in snapshot_state() safe.
"""

import threading

from app import config

state_lock = threading.RLock()

shared_state = {
    "frame":          None,      # latest JPEG bytes, sent as a binary message
    "alerts":         [],
    "zones":          [],
    "tripwires":      [],
    "total_persons":  0,
    "total_vehicles": 0,
    "vehicle_log":    [],
    "night":          False,
    "surge":          False,
    "modes":          {'loitering': True, 'night': True, 'surge': True},
    "setup_done":     False,
    "frame_width":    config.FRAME_WIDTH,
    "frame_height":   config.FRAME_HEIGHT,
}
pending_commands = []

# Bumped on every write, so readers can skip an unchanged state.
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

    If the loop wedges, an unbounded queue is a memory leak a caller could
    drive. Newest wins — a stale command is worth less than the current one.
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


# ── Hardware events ───────────────────────────────────────────────────────────
#
# Thread-safe pathway for hardware events (e.g. ESP32 alerts, LED triggers).
# Bounded queue: oldest events are dropped when full to prevent memory growth.

MAX_HARDWARE_EVENTS = 64

_hardware_events = []


def publish_hardware_event(event):
    """Queue a hardware event for consumption. Thread-safe, bounded.

    Args:
        event: dict with fields like event, threat, sector, person_id, etc.
    """
    with state_lock:
        _hardware_events.append(dict(event))
        while len(_hardware_events) > MAX_HARDWARE_EVENTS:
            _hardware_events.pop(0)


def drain_hardware_events():
    """Atomically drain all pending hardware events. Returns list of dicts."""
    with state_lock:
        drained = _hardware_events[:]
        del _hardware_events[:]
        return drained
