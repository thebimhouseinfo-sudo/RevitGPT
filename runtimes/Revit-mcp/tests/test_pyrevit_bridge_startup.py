import importlib.util
import os
import pathlib
import runpy
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch


EXTENSION_ROOT = (
    pathlib.Path(__file__).resolve().parents[1]
    / "bridge"
    / "pyrevit_extension"
    / "RevitMCPBridge.extension"
)
MODULE_PATH = (
    EXTENSION_ROOT
    / "RevitMCPBridge.bundle"
    / "Contents"
    / "revit_mcp_bridge.py"
)
STARTUP_PATH = EXTENSION_ROOT / "startup.py"


def load_bridge_module():
    fake_clr = types.ModuleType("clr")

    def add_reference(_name):
        raise ImportError("Revit API intentionally unavailable in unit test")

    fake_clr.AddReference = add_reference
    old_clr = sys.modules.get("clr")
    sys.modules["clr"] = fake_clr
    try:
        spec = importlib.util.spec_from_file_location("revit_mcp_bridge_test", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if old_clr is None:
            sys.modules.pop("clr", None)
        else:
            sys.modules["clr"] = old_clr


class FakeHTTPServer:
    instances = []

    def __init__(self, address, handler):
        self.address = address
        self.handler = handler
        self.stop_event = threading.Event()
        self.closed = False
        type(self).instances.append(self)

    def serve_forever(self):
        self.stop_event.wait(5.0)

    def server_close(self):
        self.closed = True
        self.stop_event.set()


class PyRevitBridgeStartupTests(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge_module()
        self.bridge._SERVER_THREAD = None
        self.bridge._SERVER_START_EVENT = threading.Event()
        self.bridge._SERVER_START_ERROR = None
        self.bridge._SERVER_READY = False
        FakeHTTPServer.instances = []

    def _run_startup_with_fake_bridge(self, ensure_func, appdata_root):
        fake_bridge = types.ModuleType("revit_mcp_bridge")
        fake_bridge.ensure_server_started = ensure_func
        old_bridge = sys.modules.get("revit_mcp_bridge")
        old_path = list(sys.path)
        sys.modules["revit_mcp_bridge"] = fake_bridge
        try:
            with patch.dict(
                os.environ,
                {"REVITGPT_APPDATA_ROOT": str(appdata_root)},
                clear=False,
            ):
                runpy.run_path(str(STARTUP_PATH), run_name="__main__")
        finally:
            sys.path[:] = old_path
            if old_bridge is None:
                sys.modules.pop("revit_mcp_bridge", None)
            else:
                sys.modules["revit_mcp_bridge"] = old_bridge

    def test_startup_py_executes_ensure_server_started_and_logs_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def ensure():
                calls.append("called")
                return {
                    "started": True,
                    "running": True,
                    "ready": True,
                    "port": 8765,
                }

            self._run_startup_with_fake_bridge(ensure, pathlib.Path(tmp))

            self.assertEqual(calls, ["called"])
            log_path = pathlib.Path(tmp) / "logs" / "bridge-startup.ndjson"
            text = log_path.read_text()
            self.assertIn('"event": "startup_begin"', text)
            self.assertIn('"event": "startup_complete"', text)
            self.assertNotIn('"event": "startup_failed"', text)

    def test_startup_py_logs_failure_without_crashing_revit_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            def ensure():
                raise RuntimeError("synthetic startup failure")

            self._run_startup_with_fake_bridge(ensure, pathlib.Path(tmp))

            log_path = pathlib.Path(tmp) / "logs" / "bridge-startup.ndjson"
            text = log_path.read_text()
            self.assertIn('"event": "startup_failed"', text)
            self.assertIn("synthetic startup failure", text)

    def test_server_start_success_is_ready_and_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = pathlib.Path(tmp) / "bridge.ndjson"
            self.bridge.BRIDGE_LOG_PATH = str(log_path)
            self.bridge.PORT = 8765

            with patch.object(self.bridge, "HTTPServer", FakeHTTPServer):
                first = self.bridge.ensure_server_started()
                self.assertTrue(first["started"])
                self.assertTrue(first["running"])
                self.assertTrue(first["ready"])
                self.assertEqual(first["port"], 8765)
                self.assertEqual(len(FakeHTTPServer.instances), 1)

                second = self.bridge.ensure_server_started()
                self.assertFalse(second["started"])
                self.assertTrue(second["running"])
                self.assertTrue(second["ready"])
                self.assertEqual(len(FakeHTTPServer.instances), 1)

                FakeHTTPServer.instances[0].server_close()
                self.bridge._SERVER_THREAD.join(2.0)
                self.assertFalse(self.bridge._SERVER_THREAD.is_alive())

            text = log_path.read_text()
            self.assertIn('"event": "bridge_thread_started"', text)
            self.assertIn('"event": "bridge_start"', text)

    def test_bind_failure_is_reported_and_logged(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = pathlib.Path(tmp) / "bridge.ndjson"
            self.bridge.BRIDGE_LOG_PATH = str(log_path)
            self.bridge.PORT = 8765

            with patch.object(
                self.bridge,
                "HTTPServer",
                side_effect=OSError("synthetic bind failure"),
            ):
                result = self.bridge.ensure_server_started()

            self.assertFalse(result["running"])
            self.assertFalse(result["ready"])
            self.assertIn("synthetic bind failure", result["error"])
            self.assertTrue(log_path.exists())
            text = log_path.read_text()
            self.assertIn('"event": "bridge_bind_failed"', text)
            self.assertIn("synthetic bind failure", text)


if __name__ == "__main__":
    unittest.main()
