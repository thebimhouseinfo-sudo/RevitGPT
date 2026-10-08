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

    def test_startup_py_records_not_ready_as_failure_not_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            def unavailable():
                return {
                    "started": False,
                    "running": False,
                    "ready": False,
                    "port": 8765,
                    "error": "Revit API import unavailable",
                }

            self._run_startup_with_fake_bridge(unavailable, pathlib.Path(tmp))
            log_path = pathlib.Path(tmp) / "logs" / "bridge-startup.ndjson"
            content = log_path.read_text()
            self.assertIn('"event": "startup_failed"', content)
            self.assertIn('"reason": "bridge_not_ready"', content)
            self.assertNotIn('"event": "startup_complete"', content)

    def test_startup_py_logs_failure_without_crashing_revit_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            def ensure():
                raise RuntimeError("synthetic startup failure")

            self._run_startup_with_fake_bridge(ensure, pathlib.Path(tmp))

            log_path = pathlib.Path(tmp) / "logs" / "bridge-startup.ndjson"
            text = log_path.read_text()
            self.assertIn('"event": "startup_failed"', text)
            self.assertIn("synthetic startup failure", text)


    def test_correct_revit_db_xyz_import_with_negative_control(self):
        """Prove the Revit 2024 import path; do not rely only on source grep."""
        import ast

        source = MODULE_PATH.read_text(encoding="utf-8")
        fake_modules = {}
        for name in (
            "Autodesk",
            "Autodesk.Revit",
            "Autodesk.Revit.DB",
            "Autodesk.Revit.DB.Mechanical",
            "Autodesk.Revit.DB.Plumbing",
            "Autodesk.Revit.UI",
            "Autodesk.Revit.Creation",
        ):
            item = types.ModuleType(name)
            item.__path__ = []
            fake_modules[name] = item
        fake_clr = types.ModuleType("clr")
        fake_clr.AddReference = lambda _name: None
        fake_modules["clr"] = fake_clr

        # Supply the Revit DB/UI types exposed by a healthy Revit host,
        # deliberately leaving Autodesk.Revit.Creation.XYZ undefined.
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.ImportFrom) and node.module in fake_modules:
                if node.module == "Autodesk.Revit.Creation":
                    continue
                for alias in node.names:
                    setattr(fake_modules[node.module], alias.name, type(alias.name, (), {}))

        def load_source(text_source, unique_name):
            with tempfile.TemporaryDirectory() as temp:
                fixture = pathlib.Path(temp) / "bridge_import_fixture.py"
                fixture.write_text(text_source, encoding="utf-8")
                with patch.dict(sys.modules, fake_modules):
                    spec = importlib.util.spec_from_file_location(unique_name, fixture)
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                return module

        positive = load_source(source, "revit_db_import_positive")
        self.assertTrue(positive.REVIT_AVAILABLE, positive.REVIT_IMPORT_ERROR)
        self.assertIsNone(positive.REVIT_IMPORT_ERROR)
        self.assertIs(positive.XYZ, fake_modules["Autodesk.Revit.DB"].XYZ)

        bad_import = "    from Autodesk.Revit.Creation import XYZ as CreateXYZ\n"
        self.assertNotIn(bad_import, source)
        mutated = source.replace(
            "    REVIT_AVAILABLE = True",
            bad_import + "    REVIT_AVAILABLE = True",
            1,
        )
        self.assertNotEqual(mutated, source)
        negative = load_source(mutated, "revit_db_import_negative")
        self.assertFalse(negative.REVIT_AVAILABLE)
        self.assertIn("Autodesk.Revit.Creation", negative.REVIT_IMPORT_ERROR)
        self.assertIn("XYZ", negative.REVIT_IMPORT_ERROR)

    def test_server_does_not_bind_when_revit_api_import_failed(self):
        self.bridge.PORT = 8765
        self.assertFalse(self.bridge.REVIT_AVAILABLE)
        self.assertIn("Revit API intentionally unavailable", self.bridge.REVIT_IMPORT_ERROR)
        events = []

        with (
            patch.object(self.bridge, "HTTPServer") as server,
            patch.object(
                self.bridge, "bridge_log",
                side_effect=lambda event, **fields: events.append((event, fields)),
            ),
        ):
            response = self.bridge.ensure_server_started()
            self.assertFalse(response["started"])
            self.assertFalse(response["running"])
            self.assertFalse(response["ready"])
            self.assertIn("Revit API import unavailable", response["error"])
            self.assertIn("Revit API intentionally unavailable", response["import_error"])
            self.assertIsNone(self.bridge._SERVER_THREAD)
            server.assert_not_called()
            self.bridge.run_server()
            server.assert_not_called()

        self.assertTrue(any(event == "bridge_start_blocked" for event, _ in events))

    def test_server_start_success_is_ready_and_idempotent(self):
        self.bridge.REVIT_AVAILABLE = True
        self.bridge.PORT = 8765
        events = []
        events_lock = threading.Lock()

        def record_event(event, **_fields):
            with events_lock:
                events.append(event)

        with (
            patch.object(self.bridge, "HTTPServer", FakeHTTPServer),
            patch.object(self.bridge, "bridge_log", side_effect=record_event),
        ):
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

        self.assertIn("bridge_thread_started", events)
        self.assertIn("bridge_start", events)

    def test_bind_failure_is_reported_and_logged(self):
        self.bridge.REVIT_AVAILABLE = True
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
