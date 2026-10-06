import importlib.util
import pathlib
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch


MODULE_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "bridge"
    / "pyrevit_extension"
    / "RevitMCPBridge.extension"
    / "RevitMCPBridge.bundle"
    / "Contents"
    / "revit_mcp_bridge.py"
)


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


class PyRevitBridgeStartupTests(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge_module()
        self.bridge._SERVER_THREAD = None
        self.bridge._SERVER_START_EVENT = threading.Event()
        self.bridge._SERVER_START_ERROR = None
        self.bridge._SERVER_READY = False

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
