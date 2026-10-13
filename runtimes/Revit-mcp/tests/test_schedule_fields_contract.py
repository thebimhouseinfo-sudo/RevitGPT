"""Schedule filter/sort support and invalid-value controls (offline only)."""
import unittest
from pathlib import Path
from unittest.mock import patch
from connection import bridge

BASE = Path(__file__).resolve().parents[1]


class ScheduleWriteTests(unittest.TestCase):
    @patch.object(bridge, "_send_request", return_value={"data": {"action":"add_filter_equals","filter_count":1}})
    def test_string_filter(self, request):
        result = bridge.update_schedule("200", "add_filter_equals", "1", value="FCU")
        self.assertEqual(result["filter_count"], 1)
        request.assert_called_once_with("/schedule/update", payload={
            "schedule_id": "200", "action": "add_filter_equals",
            "field_id": "1", "value": "FCU"
        }, method="POST", timeout=bridge.WRITE_TIMEOUT)

    @patch.object(bridge, "_send_request", return_value={"data":{"action":"clear_sorts"}})
    def test_clear_sorts(self, request):
        bridge.update_schedule("200", "clear_sorts")
        request.assert_called_once_with("/schedule/update",
            payload={"schedule_id":"200","action":"clear_sorts"},
            method="POST", timeout=bridge.WRITE_TIMEOUT)

    @patch.object(bridge, "_send_request")
    def test_bad_action_never_sent(self, request):
        for args in (("200","bad","1"),("200","add_filter_equals","1"),
                     ("200","add_sort",None)):
            with self.subTest(args=args):
                with self.assertRaises(ValueError):
                    bridge.update_schedule(*args)
        request.assert_not_called()

    def test_native_transaction_and_clear(self):
        source = (BASE/"bridge/unified_native/NativeSchedules.cs").read_text(encoding="utf-8")
        for marker in ("new ScheduleFilter(", "new ScheduleSortGroupField(",
                       "def.ClearFilters()", "def.ClearSortGroupFields()", "tx.RollBack()"):
            self.assertIn(marker, source)


if __name__ == "__main__":
    unittest.main()
