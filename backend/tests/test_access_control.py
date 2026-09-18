"""Access-control tests for the API surface.

These cover the boundary a hostile caller actually touches: the operator token,
the origin allowlist, and the request-body limits. They exercise the real app
object via TestClient rather than asserting on source text, so a regression that
removes a dependency or widens a model is caught.

Run from the backend/ folder:

    python -m unittest discover -s tests -t .
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config

try:
    from fastapi.testclient import TestClient
    from app import server
    STACK_AVAILABLE = True
except ImportError as exc:                              # pragma: no cover
    STACK_AVAILABLE = False
    IMPORT_ERROR = exc


TOKEN = config.AUTH_TOKEN if STACK_AVAILABLE else ""
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ALLOWED_ORIGIN = f"http://localhost:{config.PORT}"
HOSTILE_ORIGIN = "https://evil.example.com"

VALID_ZONE = {"name": "gate", "points": [[1, 1], [2, 2], [3, 1]]}
STATE_CHANGING = [
    ("/add_zone", VALID_ZONE),
    ("/add_tripwire", {"name": "wire", "p1": [0, 0], "p2": [1, 1]}),
    ("/start_detection", None),
    ("/stop_detection", None),
    ("/set_mode", {"mode": "night", "value": True}),
]


@unittest.skipUnless(STACK_AVAILABLE, "FastAPI stack not installed")
class AccessControlTestCase(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        server.pending_commands.clear()

    def post(self, path, body=None, **kwargs):
        return self.client.post(path, json=body, **kwargs)


class TestOperatorToken(AccessControlTestCase):
    """Every endpoint that touches the detector requires the shared token."""

    def test_state_changing_endpoints_reject_anonymous_callers(self):
        for path, body in STATE_CHANGING:
            with self.subTest(path=path):
                self.assertEqual(self.post(path, body).status_code, 401)

    def test_state_changing_endpoints_accept_the_token(self):
        for path, body in STATE_CHANGING:
            with self.subTest(path=path):
                self.assertEqual(self.post(path, body, headers=AUTH).status_code, 200)

    def test_wrong_token_is_rejected(self):
        headers = {"Authorization": "Bearer not-the-real-token-at-all"}
        self.assertEqual(self.post("/add_zone", VALID_ZONE, headers=headers).status_code, 401)

    def test_non_bearer_scheme_is_rejected(self):
        headers = {"Authorization": f"Basic {TOKEN}"}
        self.assertEqual(self.post("/add_zone", VALID_ZONE, headers=headers).status_code, 401)

    def test_auth_check_validates_without_side_effects(self):
        self.assertEqual(self.post("/auth/check", headers=AUTH).status_code, 200)
        self.assertEqual(server.pending_commands, [])


class TestCrossSiteRequests(AccessControlTestCase):
    """A page on another origin must not be able to drive the detector."""

    def test_hostile_origin_is_refused_even_with_a_valid_token(self):
        headers = {**AUTH, "Origin": HOSTILE_ORIGIN}
        self.assertEqual(self.post("/stop_detection", headers=headers).status_code, 403)

    def test_allowlisted_origin_is_accepted(self):
        headers = {**AUTH, "Origin": ALLOWED_ORIGIN}
        self.assertEqual(self.post("/stop_detection", headers=headers).status_code, 200)

    def test_preflight_from_hostile_origin_is_not_approved(self):
        response = self.client.options("/stop_detection", headers={
            "Origin": HOSTILE_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        })
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_wildcard_origin_is_not_configured(self):
        self.assertNotIn("*", server.ALLOWED_ORIGINS)


class TestRequestLimits(AccessControlTestCase):
    """Bodies are bounded, so one POST cannot exhaust memory or inject keys."""

    def test_set_mode_rejects_unknown_modes(self):
        body = {"mode": "arbitrary_key", "value": True}
        self.assertEqual(self.post("/set_mode", body, headers=AUTH).status_code, 422)

    def test_set_mode_accepts_every_real_mode(self):
        for mode in shared_state_modes():
            with self.subTest(mode=mode):
                body = {"mode": mode, "value": True}
                self.assertEqual(self.post("/set_mode", body, headers=AUTH).status_code, 200)

    def test_zone_point_count_is_capped(self):
        body = {"name": "flood", "points": [[1, 1]] * (config.MAX_ZONE_POINTS + 1)}
        self.assertEqual(self.post("/add_zone", body, headers=AUTH).status_code, 422)

    def test_zone_needs_at_least_three_points(self):
        body = {"name": "line", "points": [[1, 1], [2, 2]]}
        self.assertEqual(self.post("/add_zone", body, headers=AUTH).status_code, 422)

    def test_coordinates_are_bounded(self):
        body = {"name": "far", "points": [[1, 1], [2, 2], [config.MAX_COORDINATE + 1, 3]]}
        self.assertEqual(self.post("/add_zone", body, headers=AUTH).status_code, 422)

    def test_name_must_be_non_empty_and_bounded(self):
        for name in ("", "x" * (config.MAX_NAME_LENGTH + 1)):
            with self.subTest(length=len(name)):
                body = {"name": name, "points": [[1, 1], [2, 2], [3, 3]]}
                self.assertEqual(self.post("/add_zone", body, headers=AUTH).status_code, 422)

    def test_unknown_fields_are_refused(self):
        body = {**VALID_ZONE, "unexpected": "value"}
        self.assertEqual(self.post("/add_zone", body, headers=AUTH).status_code, 422)

    def test_tripwire_points_must_be_pairs(self):
        body = {"name": "wire", "p1": [0, 0, 0], "p2": [1, 1]}
        self.assertEqual(self.post("/add_tripwire", body, headers=AUTH).status_code, 422)

    def test_command_queue_is_bounded(self):
        for _ in range(config.MAX_PENDING_COMMANDS + 50):
            self.post("/add_zone", VALID_ZONE, headers=AUTH)
        self.assertLessEqual(len(server.pending_commands), config.MAX_PENDING_COMMANDS)


class TestTelemetrySocket(AccessControlTestCase):
    """The socket carries the live video feed, so it is gated like the rest."""

    def connect(self, subprotocols=None, origin=None):
        kwargs = {}
        if subprotocols:
            kwargs["subprotocols"] = subprotocols
        if origin:
            kwargs["headers"] = {"Origin": origin}
        return self.client.websocket_connect("/ws", **kwargs)

    def assertHandshakeRefused(self, **kwargs):
        with self.assertRaises(Exception):
            with self.connect(**kwargs):
                pass

    def test_anonymous_handshake_is_refused(self):
        self.assertHandshakeRefused()

    def test_wrong_token_handshake_is_refused(self):
        self.assertHandshakeRefused(
            subprotocols=[config.WS_PROTOCOL, config.WS_TOKEN_PREFIX + "wrong-token-value"])

    def test_hostile_origin_handshake_is_refused(self):
        self.assertHandshakeRefused(
            subprotocols=[config.WS_PROTOCOL, config.WS_TOKEN_PREFIX + TOKEN],
            origin=HOSTILE_ORIGIN)

    def test_valid_handshake_is_accepted(self):
        with self.connect(
            subprotocols=[config.WS_PROTOCOL, config.WS_TOKEN_PREFIX + TOKEN],
            origin=ALLOWED_ORIGIN,
        ) as ws:
            self.assertIsNotNone(ws)


class TestTokenConfiguration(unittest.TestCase):
    """The generated token must be usable in the headers that carry it."""

    def test_token_is_long_enough_to_resist_guessing(self):
        self.assertGreaterEqual(len(config.AUTH_TOKEN), 16)

    def test_token_is_a_valid_websocket_subprotocol_name(self):
        self.assertRegex(config.AUTH_TOKEN, r"^[A-Za-z0-9._~-]+$")

    def test_allowlist_covers_the_serving_port(self):
        self.assertIn(f"http://localhost:{config.PORT}", config.allowed_origins())


def shared_state_modes():
    """The mode keys the detection loop actually honours."""
    return sorted(server.shared_state["modes"])


if __name__ == "__main__":
    unittest.main()
