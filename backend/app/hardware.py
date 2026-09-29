"""ESP32 hardware communication over USB serial.

This module encapsulates all ESP32 serial communication. It is designed to:
- Handle connection/disconnection safely without crashing Kavach
- Keep COM-port details isolated within this module
- Provide a clean interface for later integration tasks
- Avoid blocking the detection loop

Usage:
    from app.hardware import hardware

    # Check if ESP32 is connected
    if hardware.connected:
        hardware.send("ALERT:Intruder")

    # Hardware events are consumed from bus.py automatically when connected.
"""

import atexit
import json
import logging
import os
import queue
import serial
import serial.tools.list_ports
import threading
import time

from app import bus

logger = logging.getLogger(__name__)


class Hardware:
    """Thread-safe ESP32 serial communication handler."""

    def __init__(self, port=None, baudrate=115200, timeout=1.0):
        self._port = port or os.environ.get("KAVACH_ESP32_PORT")
        self._baudrate = baudrate
        self._timeout = timeout
        self._serial = None
        self._reader_thread = None
        self._running = False
        self._message_queue = queue.Queue()
        self._callbacks = []

    @property
    def connected(self):
        """True if ESP32 is currently connected and responsive."""
        return self._serial is not None and self._serial.is_open

    def connect(self):
        """Connect to ESP32 on the configured serial port."""
        if self.connected:
            return True

        port = self._port
        if not port:
            port = self._auto_detect_port()
            if not port:
                logger.warning("ESP32: No serial port configured and none detected")
                return False

        try:
            self._serial = serial.Serial(
                port=port,
                baudrate=self._baudrate,
                timeout=self._timeout,
                write_timeout=1.0,
            )
            self._running = True
            self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._reader_thread.start()
            self._event_thread = threading.Thread(target=self._event_loop, daemon=True)
            self._event_thread.start()
            atexit.register(self.disconnect)
            logger.info(f"ESP32: Connected on {port}")
            return True
        except serial.SerialException as e:
            logger.warning(f"ESP32: Failed to connect on {port}: {e}")
            self._serial = None
            return False

    def disconnect(self):
        """Safely disconnect from ESP32."""
        self._running = False
        if self._serial and self._serial.is_open:
            try:
                self._serial.close()
            except Exception as e:
                logger.warning(f"ESP32: Error closing serial: {e}")
        self._serial = None
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=2.0)
        self._reader_thread = None
        if self._event_thread and self._event_thread.is_alive():
            self._event_thread.join(timeout=1.0)
        self._event_thread = None
        logger.info("ESP32: Disconnected")

    def send(self, message):
        """Send a message to ESP32. Non-blocking."""
        if not self.connected:
            return False
        try:
            self._serial.write(f"{message}\n".encode("utf-8"))
            self._serial.flush()
            return True
        except serial.SerialException as e:
            logger.warning(f"ESP32: Send failed: {e}")
            self._handle_disconnect()
            return False

    def on_message(self, callback):
        """Register a callback for incoming messages from ESP32.

        Callback receives: (message: str)
        """
        self._callbacks.append(callback)

    def _read_loop(self):
        """Background thread: read lines from ESP32 and dispatch to callbacks."""
        while self._running and self._serial and self._serial.is_open:
            try:
                line = self._serial.readline().decode("utf-8", errors="ignore").strip()
                if line:
                    for cb in self._callbacks:
                        try:
                            cb(line)
                        except Exception as e:
                            logger.warning(f"ESP32: Callback error: {e}")
            except serial.SerialException:
                break
            except Exception as e:
                logger.warning(f"ESP32: Read error: {e}")

    def _handle_disconnect(self):
        """Called when serial connection is lost."""
        self._running = False
        if self._serial:
            try:
                self._serial.close()
            except Exception:
                pass
        self._serial = None
        logger.warning("ESP32: Connection lost")

    def _event_loop(self):
        """Background thread: drain hardware events from bus and send to ESP32."""
        while self._running and self.connected:
            try:
                events = bus.drain_hardware_events()
                for event in events:
                    msg = json.dumps({"type": "alert", **event})
                    self.send(msg)
            except Exception as e:
                logger.warning(f"ESP32: Event loop error: {e}")
            time.sleep(0.1)

    def _auto_detect_port(self):
        """Find ESP32 by looking for common USB-UART vendor/product identifiers.

        Falls back to the first available port if no known ESP32 chip is found.
        """
        first_port = None
        for port_info in serial.tools.list_ports.comports():
            if first_port is None:
                first_port = port_info.device
            vid = port_info.vid
            pid = port_info.pid
            # Common ESP32 USB-UART chips
            if vid in (0x0403, 0x1A86) or "CH340" in port_info.description or "CP210" in port_info.description:
                logger.info(f"ESP32: Auto-detected on {port_info.device} ({port_info.description})")
                return port_info.device
        # Fall back to first available port
        if first_port:
            logger.info(f"ESP32: Using first available port: {first_port}")
            return first_port
        return None

    def available_ports(self):
        """Return list of available serial ports for UI selection."""
        return [p.device for p in serial.tools.list_ports.comports()]


# Singleton instance — import and use throughout Kavach
hardware = Hardware()
