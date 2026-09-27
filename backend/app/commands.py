"""Operator commands, from the API queue and from the terminal."""

import sys
import threading

from app import bus
from app.tracking import new_zone


class StopDetection(Exception):
    """Operator pressed stop. Return to setup."""


class SwitchSource(Exception):
    """Operator changed the video source. Reopen the capture."""


def unique_name(name, existing):
    """`name`, suffixed if taken. Zones persist across runs and a reloaded
    console restarts its SECTOR-A/B/C numbering, so names can collide — and
    loitering is keyed by zone name."""
    taken = {item['name'] for item in existing}
    candidate, n = name, 2
    while candidate in taken:
        candidate, n = f"{name}-{n}", n + 1
    return candidate


def process_commands(state, source):
    """Apply queued operator commands.

    Raises StopDetection / SwitchSource — named exceptions rather than the old
    StopIteration, which the interpreter special-cases and silently converts to
    a RuntimeError inside any generator frame.
    """
    for cmd in bus.take_commands():
        kind = cmd['type']

        if kind == 'add_zone':
            d = cmd['data']
            name = unique_name(d['name'], state.zones)
            state.zones.append(new_zone(name, d['points']))
            state.add_alert(f"Zone '{name}' created", (0, 255, 0))

        elif kind == 'add_tripwire':
            d = cmd['data']
            name = unique_name(d['name'], state.tripwires)
            state.tripwires.append({
                'name': name,
                'p1': tuple(d['p1']),
                'p2': tuple(d['p2']),
            })
            state.add_alert(f"Tripwire '{name}' created", (0, 255, 255))

        elif kind == 'remove_shape':
            if cmd['kind'] == 'zone':
                state.forget_zone_loitering(cmd['name'])
                state.zones = [z for z in state.zones if z['name'] != cmd['name']]
            else:
                state.tripwires = [t for t in state.tripwires if t['name'] != cmd['name']]
            state.add_alert(f"{cmd['kind'].title()} '{cmd['name']}' removed", (0, 255, 255))

        elif kind == 'clear_zones':
            for zone in state.zones:
                state.forget_zone_loitering(zone['name'])
            state.zones = []
            state.tripwires = []
            state.add_alert("All zones and tripwires cleared", (0, 255, 255))

        elif kind == 'set_mode':
            state.modes[cmd['mode']] = cmd['value']

        elif kind == 'stop_detection':
            raise StopDetection

        elif kind == 'switch_source':
            source['live'] = cmd['value']
            raise SwitchSource


def input_listener():
    print("\n=== SOURCE CONTROL ===")
    print("Type 'v' + Enter -> switch to video file")
    print("Type 'l' + Enter -> switch to live stream")
    print("======================\n")
    while True:
        try:
            key = input().strip().lower()
        except (EOFError, KeyboardInterrupt):
            return
        if key == 'l':
            bus.queue_command({'type': 'switch_source', 'value': True})
            print("Switching to LIVE stream...")
        elif key == 'v':
            bus.queue_command({'type': 'switch_source', 'value': False})
            print("Switching to VIDEO file...")


def start_input_listener():
    """Start terminal source control, but only where a terminal exists.

    Under systemd, Docker without -it, or CI, stdin is at EOF and input()
    returns immediately — the thread spun once and died without saying so.
    """
    if not (sys.stdin and sys.stdin.isatty()):
        print("stdin is not a terminal — keyboard source control disabled.")
        return None
    thread = threading.Thread(target=input_listener, daemon=True)
    thread.start()
    return thread
