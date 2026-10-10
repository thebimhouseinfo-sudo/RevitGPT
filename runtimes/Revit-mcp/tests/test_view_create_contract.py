"""Offline view creation/duplicate request and Native transaction contract."""
import unittest
from pathlib import Path
from unittest.mock import patch
from connection import bridge

BASE = Path(__file__).resolve().parents[1]


class ViewCreateTests(unittest.TestCase):
    @patch.object(bridge, "_send_request", return_value={"data": {"id": "14"}})
    def test_plan_creation(self, request):
        result = bridge.create_or_duplicate_view("floor_plan", name="Test Floor", level_id="10")
        self.assertEqual(result["id"], "14")
        request.assert_called_once_with("/view/create", payload={
            "action": "floor_plan", "name": "Test Floor", "level_id": "10"},
            method="POST", timeout=bridge.WRITE_TIMEOUT)

    @patch.object(bridge, "_send_request")
    def test_invalid_requests(self, request):
        for action in ("dangerous", "floor_plan", "duplicate"):
            with self.subTest(action=action):
                with self.assertRaises(ValueError):
                    bridge.create_or_duplicate_view(action)
        with self.assertRaises(ValueError):
            bridge.create_or_duplicate_view("isometric_3d", name="")
        request.assert_not_called()

    def test_native_guard_and_transaction(self):
        native = (BASE/"bridge/unified_native/NativeViewCreate.cs").read_text(encoding="utf-8")
        proto = (BASE/"bridge/unified_native/BridgeHttpProtocol.cs").read_text(encoding="utf-8")
        self.assertIn("ViewPlan.Create(", native)
        self.assertIn("View3D.CreateIsometric(", native)
        self.assertIn("ViewSection.CreateSection(", native)
        self.assertIn("bx.CrossProduct(by).DistanceTo(bz)", native)
        self.assertIn("source.Duplicate(", native)
        self.assertIn("tx.RollBack()", native)
        self.assertIn('path == "/view/create"', proto)


if __name__ == "__main__":
    unittest.main()
