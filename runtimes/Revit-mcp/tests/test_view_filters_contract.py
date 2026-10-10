"""View parameter filter read/edit: explicit action validation and Native grant."""
import unittest
from pathlib import Path
from unittest.mock import patch
from connection import bridge

BASE = Path(__file__).resolve().parents[1]


class FilterContracts(unittest.TestCase):
    @patch.object(bridge, "_send_request", return_value={"data": {"filters": [], "complete": True}})
    def test_read_view_filters(self, request):
        result = bridge.list_view_filters("15")
        self.assertTrue(result["complete"])
        request.assert_called_once_with("/view/filters", payload={"view_id": "15"}, method="POST")

    @patch.object(bridge, "_send_request", return_value={"data": {"attached": True}})
    def test_apply_filter(self, request):
        result = bridge.manage_view_filters("15", "44", "apply")
        self.assertTrue(result["attached"])
        request.assert_called_once_with("/view/filter/write",
            payload={"view_id": "15", "filter_id": "44", "action": "apply"},
            method="POST", timeout=bridge.WRITE_TIMEOUT)

    @patch.object(bridge, "_send_request")
    def test_invalid_requests_never_sent(self, request):
        for args in (("0","15","apply"),("15","0","apply"),
                     ("15","44","unsafe"),("15","44","visibility")):
            with self.subTest(args=args):
                with self.assertRaises(ValueError):
                    bridge.manage_view_filters(*args)
        with self.assertRaises(ValueError):
            bridge.manage_view_filters("15", "44", "apply", visible=True)
        request.assert_not_called()

    def test_view_edit_transaction_guard(self):
        native = (BASE/"bridge/unified_native/NativeViewFilters.cs").read_text(encoding="utf-8")
        proto = (BASE/"bridge/unified_native/BridgeHttpProtocol.cs").read_text(encoding="utf-8")
        self.assertIn("view.GetFilters()", native)
        self.assertIn("tx.RollBack()", native)
        self.assertIn("view.SetFilterVisibility(", native)
        self.assertIn('path == "/view/filter/write"', proto)


if __name__ == "__main__":
    unittest.main()
