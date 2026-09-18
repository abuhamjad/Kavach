"""Smoke tests for the backend layout and configuration.

Run from the backend/ folder:

    python -m unittest discover -s tests -t .
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config


class TestDirectoryLayout(unittest.TestCase):
    """The folders the code writes to or reads from must exist."""

    def test_expected_directories_exist(self):
        for name in ("WEB_DIR", "MODELS_DIR", "VIDEOS_DIR", "LOGS_DIR"):
            path = getattr(config, name)
            self.assertTrue(os.path.isdir(path), f"{name} missing: {path}")

    def test_source_lives_in_app_package(self):
        for module in ("__init__.py", "config.py", "server.py", "detect.py"):
            self.assertTrue(os.path.isfile(os.path.join(config.APP_DIR, module)),
                            f"app/{module} missing")

    def test_no_stray_python_at_backend_root(self):
        stray = [f for f in os.listdir(config.BACKEND_DIR)
                 if f.endswith(".py") and f != "run.py"]
        self.assertEqual(stray, [], f"Python files outside app/: {stray}")

    def test_ensure_runtime_dirs_is_idempotent(self):
        config.ensure_runtime_dirs()
        config.ensure_runtime_dirs()
        self.assertTrue(os.path.isdir(config.LOGS_DIR))


class TestConfiguredAssets(unittest.TestCase):
    """Paths in config must point at real files, not leftovers from a move."""

    def test_mobile_page_exists(self):
        self.assertTrue(os.path.isfile(config.MOBILE_PAGE), config.MOBILE_PAGE)

    def test_model_file_is_valid_when_present(self):
        # The weights are gitignored (52MB), so a fresh clone legitimately has
        # no model. Asserting its presence failed for every new contributor on
        # their first run; it passed locally only because the file was already
        # there. Check the path is sane, and the file only when it exists.
        self.assertTrue(config.MODEL_FILE.endswith(".pt"), config.MODEL_FILE)
        if not os.path.isfile(config.MODEL_FILE):
            self.skipTest(
                f"model weights not downloaded: {config.MODEL_FILE} "
                f"(see README step 3)")
        self.assertGreater(os.path.getsize(config.MODEL_FILE), 0)

    def test_paths_are_absolute(self):
        for name in ("MODEL_FILE", "VIDEO_FILE", "STATIC_DIR", "MOBILE_PAGE"):
            self.assertTrue(os.path.isabs(getattr(config, name)), name)


class TestServerImport(unittest.TestCase):
    """server.py must import cleanly as part of the app package."""

    def test_app_and_state_import(self):
        try:
            from app.server import app, shared_state, pending_commands
        except ImportError as exc:
            self.skipTest(f"FastAPI stack not installed: {exc}")
        self.assertIsNotNone(app)
        self.assertIn("frame", shared_state)
        self.assertIsInstance(pending_commands, list)


if __name__ == "__main__":
    unittest.main()
