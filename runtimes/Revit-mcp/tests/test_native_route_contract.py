"""Fail on any drift between Python MCP bridge calls and native route surface."""
import ast
from pathlib import Path
import re
import unittest

BASE = Path(__file__).resolve().parents[1]
CLIENT = BASE / "connection" / "bridge.py"
NATIVE = BASE / "bridge" / "unified_native" / "BridgeRouteContract.cs"


class RouteParityTests(unittest.TestCase):
    def test_exact_client_paths_and_methods(self):
        tree = ast.parse(CLIENT.read_text(encoding="utf-8"))
        expected = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            if node.func.id != "_send_request" or not node.args:
                continue
            if not isinstance(node.args[0], ast.Constant):
                continue
            path = node.args[0].value
            method = "GET"
            for kw in node.keywords:
                if kw.arg != "method":
                    continue
                if isinstance(kw.value, ast.Constant):
                    method = kw.value.value
                elif isinstance(kw.value, ast.IfExp):
                    options = {n.value for n in (kw.value.body, kw.value.orelse)
                               if isinstance(n, ast.Constant)}
                    for opt in options:
                        expected.add((opt, path))
                    method = None
                else:
                    self.fail(f"Unknown dynamic method for {path}")
            if method is not None:
                expected.add((method, path))
        self.assertGreaterEqual(len(expected), 20)
        code = NATIVE.read_text(encoding="utf-8")
        actual = set(re.findall(r'"(GET|POST) (/[^"]+)"', code))
        self.assertEqual(expected, actual)

    def test_annotation_native_handlers_are_reachable(self):
        router = (BASE / "bridge" / "unified_native" / "RevitApiRouter.cs").read_text(encoding="utf-8")
        operations = (BASE / "bridge" / "unified_native" / "NativeWriteOperations.cs").read_text(encoding="utf-8")
        policy = (BASE / "bridge" / "unified_native" / "BridgeHttpProtocol.cs").read_text(encoding="utf-8")
        for route in ("/annotation/tag", "/annotation/dimension", "/annotation/spot_elevation"):
            with self.subTest(route=route):
                self.assertIn(f'path == "{route}"', router)
                self.assertIn(f'if (path == "{route}")', operations)
                self.assertIn('path.StartsWith("/annotation/", StringComparison.Ordinal)', policy)
        self.assertEqual(router.count('if (path == "/annotation/get")'), 1)
        self.assertEqual(router.count("private static string GetAnnotation("), 1)
        self.assertNotIn("private static string ReadAnnotation(", router)

    def test_negative_control_detects_unrouted_annotation(self):
        router = (BASE / "bridge" / "unified_native" / "RevitApiRouter.cs").read_text(encoding="utf-8")
        self.assertIn('path == "/annotation/spot_elevation"', router)
        stripped = router.replace('path == "/annotation/spot_elevation"', 'path == "/annotation/unknown"')
        self.assertNotIn('path == "/annotation/spot_elevation"', stripped)

    def test_element_connector_expansion_reuses_native_collector(self):
        router = (BASE / "bridge" / "unified_native" / "RevitApiRouter.cs").read_text(encoding="utf-8")
        self.assertIn('payload.Value<bool?>("include_connectors") != true', router)
        self.assertIn('JObject.Parse(Connectors(doc, payload))', router)
        self.assertIn('connectorEnvelope["error"] != null', router)
        self.assertIn('connectors = connectorEnvelope["data"]', router)
        self.assertNotIn('Connector readback has not passed host verification.', router)

    def test_native_write_type_and_level_disambiguation(self):
        writes = (BASE / "bridge" / "unified_native" / "NativeWriteOperations.cs").read_text(encoding="utf-8")
        self.assertIn('Type selection is ambiguous; provide an exact unique type name.', writes)
        self.assertIn('level_id required unless the model has exactly one level.', writes)
        self.assertNotIn('OrderBy(x => x.Id.Value).FirstOrDefault()', writes)
        self.assertNotIn('OrderBy(x => x.Elevation).FirstOrDefault()', writes)
        self.assertIn('matches.SingleOrDefault()', writes)

    def test_negative_control_detects_missing_mutating_route(self):
        code = NATIVE.read_text(encoding="utf-8")
        self.assertIn('"POST /annotation/detail_line"', code)
        mutated = code.replace('"POST /annotation/detail_line"', '"POST /unknown"')
        self.assertNotIn('"POST /annotation/detail_line"', mutated)
        self.assertNotEqual(
            set(re.findall(r'"(GET|POST) (/[^"]+)"', code)),
            set(re.findall(r'"(GET|POST) (/[^"]+)"', mutated)),
        )


if __name__ == "__main__":
    unittest.main()
