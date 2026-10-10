"""Offline UI-action contract: no live selection or document changes."""
import unittest
from unittest.mock import patch
from pathlib import Path
from connection import bridge

BASE = Path(__file__).resolve().parents[1]


class UiSelectionContractTests(unittest.TestCase):
    @patch.object(bridge, "_send_request", return_value={"data": {"element_ids": ["42"], "active_view_id": "3"}})
    def test_read_selection(self, send):
        self.assertEqual(bridge.get_selection()["element_ids"], ["42"])
        send.assert_called_once_with("/ui/selection", payload={}, method="POST")

    @patch.object(bridge, "_send_request", return_value={"data": {"element_ids": [], "active_view_id": "3"}})
    def test_clear_selection(self, send):
        self.assertEqual(bridge.set_selection([])["element_ids"], [])
        send.assert_called_once_with("/ui/selection/set", payload={"element_ids": []}, method="POST")

    @patch.object(bridge, "_send_request", return_value={"data": {"shown": 1}})
    def test_show(self, send):
        self.assertEqual(bridge.show_elements(["42"])["shown"], 1)
        send.assert_called_once_with("/ui/show", payload={"element_ids": ["42"]}, method="POST")

    @patch.object(bridge, "_send_request")
    def test_invalid_targets_rejected_before_transport(self, send):
        for ids in (["42", "42"], [""], ["-1"], [0], ["0"], ["12"] * 501, "42"):
            with self.subTest(ids=ids):
                with self.assertRaises(ValueError):
                    bridge.set_selection(ids)
                with self.assertRaises(ValueError):
                    bridge.show_elements(ids)
        with self.assertRaises(ValueError):
            bridge.show_elements([])
        send.assert_not_called()

    @patch.object(bridge, "_send_request", return_value={"data": {"active_view_id": "17"}})
    def test_activate_valid_view(self, send):
        self.assertEqual(bridge.activate_view("17")["active_view_id"], "17")
        send.assert_called_once_with("/ui/view/activate",
            payload={"view_id": "17"}, method="POST")

    @patch.object(bridge, "_send_request")
    def test_reject_invalid_view_id(self, send):
        for invalid in ("", "0", "-2", "ab", None, 17):
            with self.subTest(view_id=invalid):
                with self.assertRaises(ValueError):
                    bridge.activate_view(invalid)
        send.assert_not_called()

    @patch.object(bridge, "_send_request", return_value={"data": {"element_ids": ["12", "15"]}})
    def test_selection_add_mode(self, send):
        bridge.set_selection(["15"], mode="add")
        send.assert_called_once_with("/ui/selection/set",
            payload={"element_ids": ["15"], "mode": "add"}, method="POST")

    @patch.object(bridge, "_send_request", return_value={"data": {"element_ids": []}})
    def test_selection_remove_mode(self, send):
        bridge.set_selection(["15"], mode="remove")
        send.assert_called_once_with("/ui/selection/set",
            payload={"element_ids": ["15"], "mode": "remove"}, method="POST")

    @patch.object(bridge, "_send_request")
    def test_invalid_selection_mode_fail_closed(self, send):
        with self.assertRaises(ValueError):
            bridge.set_selection(["15"], mode="toggle")
        with self.assertRaises(ValueError):
            bridge.set_selection(["15"], mode="clear")
        send.assert_not_called()

    @patch.object(bridge, "_send_request", return_value={"data": {"mode": "isolate", "count": 1}})
    def test_temporary_isolate_transport(self, send):
        self.assertEqual(bridge.temporary_visibility("isolate", ["42"])["count"], 1)
        send.assert_called_once_with("/ui/visibility/temporary",
            payload={"mode": "isolate", "element_ids": ["42"]}, method="POST")

    @patch.object(bridge, "_send_request", return_value={"data": {"mode": "reset", "count": 0}})
    def test_temporary_reset_empty_target(self, send):
        self.assertEqual(bridge.temporary_visibility("reset")["count"], 0)
        send.assert_called_once_with("/ui/visibility/temporary",
            payload={"mode": "reset", "element_ids": []}, method="POST")

    @patch.object(bridge, "_send_request")
    def test_invalid_visibility_never_sends(self, send):
        for mode, ids in (("flip", ["42"]), ("hide", []),
                          ("isolate", None), ("reset", ["42"])):
            with self.subTest(mode=mode, ids=ids):
                with self.assertRaises(ValueError):
                    bridge.temporary_visibility(mode, ids)
        send.assert_not_called()

    def test_native_exact_binding_and_ui_guard(self):
        code = (BASE/"bridge/unified_native/RevitApiRouter.cs").read_text(encoding="utf-8")
        self.assertIn("binding.ReadDenial(Token(payload, \"document_id\"))", code)
        self.assertIn("uidoc.Selection.SetElementIds(ids)", code)
        self.assertIn("uidoc.ShowElements(ids)", code)
        self.assertIn("uidoc.ActiveView = view", code)
        self.assertIn("Bound document must be active before switching views.", code)
        self.assertIn("Object.ReferenceEquals(uidoc.Document, doc)", code)
        self.assertIn("activeView.Id", code)
        self.assertIn("input.Count > 500", code)
        self.assertIn('if (BridgeHttpProtocol.IsWrite(path))', code)


if __name__ == "__main__":
    unittest.main()
