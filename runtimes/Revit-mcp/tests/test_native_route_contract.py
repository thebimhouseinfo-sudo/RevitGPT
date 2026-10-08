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
