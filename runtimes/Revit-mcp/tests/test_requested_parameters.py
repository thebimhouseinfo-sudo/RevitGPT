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

    @patch.object(bridge, "_send_request", return_value={"data": {"id": "42"}})
    def test_identifier_selectors_forward_unchanged(self, send):
        selectors = ["guid:12345678-1234-1234-1234-1234567890ab",
                     "bip:ALL_MODEL_MARK"]
        bridge.get_element("42", parameters=selectors)
        self.assertEqual(send.call_args.kwargs["payload"]["parameters"], selectors)

    @patch.object(bridge, "_send_request", return_value={"data": {"count": 5010,
        "complete": True, "groups": []}})
    def test_aggregate_count_avoids_element_list(self, send):
        count = bridge.aggregate_elements(category="Mechanical Equipment")
        self.assertEqual(count["count"], 5010)
        send.assert_called_once_with("/elements/aggregate",
            payload={"category": "Mechanical Equipment"}, method="POST")

    @patch.object(bridge, "_send_request", return_value={"data": {"count": 22,
        "complete": True, "groups": [{"key": "FCU", "count": 22}]}})
    def test_aggregate_group_selector(self, send):
        grouped = bridge.aggregate_elements(group_by="family", category="Mechanical Equipment")
        self.assertEqual(grouped["groups"][0]["count"], 22)
        self.assertEqual(send.call_args.kwargs["payload"]["group_by"], "family")

    @patch.object(bridge, "_send_request")
    def test_invalid_aggregate_group_fails_before_transport(self, send):
        with self.assertRaises(ValueError):
            bridge.aggregate_elements(group_by="arbitrary_parameter")
        send.assert_not_called()

    def test_native_aggregate_is_bounded_and_read_only(self):
        code = NATIVE.read_text(encoding="utf-8")
        self.assertIn('path == "/elements/aggregate"', code)
        self.assertIn("WhereElementIsNotElementType()", code)
        self.assertIn("if (counts.Count >= 500)", code)
        self.assertIn("complete = true", code)
        self.assertIn('if (BridgeHttpProtocol.IsWrite(path))', code)

    @patch.object(bridge, "_send_request", return_value={"data": [{"id": "400", "name": "SA-1", "kind": "duct", "member_count": 8}]})
    def test_actual_system_instances_transport(self, send):
        systems = bridge.get_mep_systems(kind="duct")
        self.assertEqual(systems[0]["member_count"], 8)
        send.assert_called_once_with("/mep/systems", payload={"kind": "duct"}, method="POST")

    @patch.object(bridge, "_send_request")
    def test_invalid_system_kind_never_sends(self, send):
        with self.assertRaises(ValueError):
            bridge.get_mep_systems(kind="electrical")
        send.assert_not_called()

    @patch.object(bridge, "_send_request", return_value={"data": {"id": "17", "scale": 100}})
    def test_read_view_properties(self, send):
        self.assertEqual(bridge.get_view_properties("17")["scale"], 100)
        send.assert_called_once_with("/view/properties",
            payload={"view_id": "17"}, method="POST")

    @patch.object(bridge, "_send_request")
    def test_read_view_rejects_bad_id(self, send):
        for bad in ("0", "-1", "abc", 17):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    bridge.get_view_properties(bad)
        send.assert_not_called()

    def test_native_system_instances_not_type_inventory(self):
        code = NATIVE.read_text(encoding="utf-8")
        self.assertIn("private static string MepSystems(Document doc, JObject payload)", code)
        self.assertIn("OfClass(typeof(MechanicalSystem))", code)
        self.assertIn("OfClass(typeof(PipingSystem))", code)
        self.assertIn("member_count = sys.Elements.Size", code)

    @patch.object(bridge, "_send_request", return_value={"data": {"total_instances": 10, "groups": []}})
    def test_mep_quantities_transport(self, send):
        report = bridge.get_mep_quantities(category="Ducts")
        self.assertEqual(report["total_instances"], 10)
        send.assert_called_once_with("/mep/quantities",
            payload={"mode": "all", "category": "Ducts"}, method="POST")

    @patch.object(bridge, "_send_request")
    def test_mep_quantities_bad_mode_rejected(self, send):
        with self.assertRaises(ValueError):
            bridge.get_mep_quantities(mode="untrusted")
        send.assert_not_called()

    def test_mep_quantities_explicit_length_coverage(self):
        code = NATIVE.read_text(encoding="utf-8")
        self.assertIn("private static string MepQuantities(Document doc, JObject payload)", code)
        self.assertIn("length_measured_count = x.MeasuredCount", code)
        self.assertIn("total_length_internal_feet = x.LengthFeet", code)
        self.assertIn('length_unit = "revit_internal_feet"', code)

    def test_connector_handler_still_requires_host_qa(self):
        code = NATIVE.read_text(encoding="utf-8")
        self.assertIn("private static string Connectors(Document doc, JObject payload)", code)
        self.assertIn("foreach (Connector connector in manager.Connectors)", code)
        self.assertIn("if (connectors.Count >= 256)", code)
        self.assertIn("reference.Owner?.Id.Value", code)

    def test_native_read_is_selected_and_bounded(self):
        code = NATIVE.read_text(encoding="utf-8")
        self.assertIn("RequestedParameters(payload)", code)
        self.assertIn("ResolveParameters(element, name)", code)
        self.assertIn("ResolveParameters(typeElement, name)", code)
        self.assertIn("Guid.TryParseExact(selector.Substring(5)", code)
        self.assertIn("Enum.TryParse<BuiltInParameter>", code)
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
