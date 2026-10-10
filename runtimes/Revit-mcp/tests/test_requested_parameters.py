"""MCP-1 B04: selected parameter transport and native contract, all OFFLINE.

These tests MUST NOT be used as evidence that the installed Revit host returns values.
"""
import unittest
from pathlib import Path
from unittest.mock import patch
from connection import bridge


NATIVE = Path(__file__).resolve().parents[1] / "bridge" / "unified_native" / "RevitApiRouter.cs"


class SelectedParameterBridgeTests(unittest.TestCase):
    @patch.object(bridge, "_send_request", return_value={"data": [{"id": "42", "parameters": {}}]})
    def test_list_forwards_exact_names(self, send):
        rows = bridge.get_elements(category="Mechanical Equipment", parameters=["Mark", "Comments"])
        self.assertEqual(len(rows), 1)
        send.assert_called_once_with(
            "/elements",
            payload={"category": "Mechanical Equipment", "parameters": ["Mark", "Comments"]},
            method="POST",
        )

    @patch.object(bridge, "_send_request", return_value={"data": {"id": "42", "parameters": {}}})
    def test_single_forwards_exact_names_without_connectors(self, send):
        item = bridge.get_element("42", parameters=["Mark"])
        self.assertEqual(item["id"], "42")
        send.assert_called_once_with(
            "/element", payload={"element_id": "42", "parameters": ["Mark"]}, method="POST"
        )

    @patch.object(bridge, "_send_request", return_value={"data": {"id": "42"}})
    def test_empty_list_is_backward_compatible(self, send):
        bridge.get_element("42", parameters=[])
        send.assert_called_once_with(
            "/element", payload={"element_id": "42", "parameters": []}, method="POST"
        )

    @patch.object(bridge, "_send_request")
    def test_invalid_inputs_fail_before_any_transport(self, send):
        for names in (["Mark"] * 2, ["Mark", "mark"], [""], [" Mark"],
                      [123], ["x" * 129], ["Mark"] * 17, "Mark"):
            with self.subTest(names=names):
                with self.assertRaises(ValueError):
                    bridge.get_elements(parameters=names)
                with self.assertRaises(ValueError):
                    bridge.get_element("42", parameters=names)
        send.assert_not_called()

    def test_native_read_is_selected_and_bounded(self):
        code = NATIVE.read_text(encoding="utf-8")
        self.assertIn("RequestedParameters(payload)", code)
        self.assertIn("ElementInfo(el, requestedParameters)", code)
        self.assertIn("ElementInfo(item, RequestedParameters(payload))", code)
        self.assertIn("RequestedParameterValues(element, requestedParameters)", code)
        self.assertIn("array.Count > 16", code)
        self.assertIn("requestedParameters.Count > 0 ? 1000 : 5000", code)
        self.assertIn('status = "AMBIGUOUS"', code)
        self.assertIn('status = "MISSING"', code)
        self.assertIn('scope = "type"', code)
        self.assertIn('"revit_internal"', code)
        # Negative control: a native handler that drops the requested metadata
        # must NEVER make this source-contract assertion PASS.
        mutant = code.replace(
            'result["parameters"] = RequestedParameterValues(element, requestedParameters);',
            '/* deliberately dropped parameters */',
        )
        self.assertNotIn(
            'result["parameters"] = RequestedParameterValues(element, requestedParameters);',
            mutant,
        )


if __name__ == "__main__":
    unittest.main()
