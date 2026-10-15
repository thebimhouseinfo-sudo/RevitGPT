"""Offline-only proof that .dyn preflight never starts Dynamo or runs nodes."""
import json
import tempfile
import unittest
from pathlib import Path
from services.dynamo_preflight import validate_staged_dyn, DynamoPreflightError


class DynamoPreflightTests(unittest.TestCase):
    def test_bounded_safe_graph(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            graph = root / "safe.dyn"
            graph.write_text(json.dumps({
                "Nodes": [{"Id": "abc", "NodeType": "NumberInput"}],
                "Connectors": []
            }), encoding="utf-8")
            report = validate_staged_dyn(str(graph), tmp)
            self.assertEqual(report["status"], "PREFLIGHT_ONLY_NOT_LOADED")
            self.assertFalse(report["safe_to_execute"])
            self.assertFalse(report["manual_no_run_host_verified"])
            self.assertEqual(report["node_count"], 1)

    def test_reject_code_and_bad_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            graph = Path(tmp) / "unsafe.dyn"
            graph.write_text(json.dumps({
                "Nodes": [{"Id": "a", "NodeType": "PythonScriptNode"}],
                "Connectors": []
            }), encoding="utf-8")
            with self.assertRaises(DynamoPreflightError):
                validate_staged_dyn(str(graph), tmp)
            graph.write_text("{ invalid", encoding="utf-8")
            with self.assertRaises(DynamoPreflightError):
                validate_staged_dyn(str(graph), tmp)

    def test_allow_built_in_codeblock_and_core_zerotouch(self):
        with tempfile.TemporaryDirectory() as tmp:
            graph = Path(tmp) / "builtins.dyn"
            graph.write_text(json.dumps({
                "Nodes": [
                    {"Id": "a", "NodeType": "CodeBlockNode",
                     "ConcreteType": "Dynamo.Graph.Nodes.CodeBlockNodeModel, DynamoCore",
                     "Code": "1+1;"},
                    {"Id": "b", "NodeType": "FunctionNode",
                     "ConcreteType": "Dynamo.Graph.Nodes.ZeroTouch.DSFunction, DynamoCore",
                     "FunctionSignature": "DSCore.List.Count@var[]..[]"}
                ],
                "Connectors": []
            }), encoding="utf-8")
            self.assertEqual(validate_staged_dyn(str(graph), tmp)["node_count"], 2)
            broken = json.loads(graph.read_text(encoding="utf-8"))
            broken["Nodes"][1]["ConcreteType"] = "Bad.ZeroTouch, ExternalPackage"
            graph.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaises(DynamoPreflightError):
                validate_staged_dyn(str(graph), tmp)

    def test_reject_escape_symlink_and_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            invalid = root / "graph.json"
            invalid.write_text('{"Nodes":[],"Connectors":[]}', encoding="utf-8")
            with self.assertRaises(DynamoPreflightError):
                validate_staged_dyn(str(invalid), tmp)
            with tempfile.TemporaryDirectory() as outside:
                remote = Path(outside) / "outside.dyn"
                remote.write_text('{"Nodes":[],"Connectors":[]}', encoding="utf-8")
                with self.assertRaises(DynamoPreflightError):
                    validate_staged_dyn(str(remote), tmp)
                symlink = root / "link.dyn"
                try:
                    symlink.symlink_to(remote)
                except (OSError, NotImplementedError):
                    pass
                else:
                    with self.assertRaises(DynamoPreflightError):
                        validate_staged_dyn(str(symlink), tmp)


if __name__ == "__main__":
    unittest.main()
