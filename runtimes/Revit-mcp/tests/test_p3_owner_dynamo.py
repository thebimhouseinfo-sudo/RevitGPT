"""P3 owner-local Dynamo preflight: offline path boundary tests (not live Revit proof)."""
from __future__ import annotations

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from services.dynamo_preflight import validate_staged_dyn, DynamoPreflightError


class OwnerLocalDynamoTests(unittest.TestCase):
    def test_owned_dynamo_and_temp_are_preflighted_without_staging(self):
        with TemporaryDirectory() as tmp, patch.dict(os.environ, {"LOCALAPPDATA": tmp}):
            root = Path(tmp) / "RevitGPT"
            graph = {"Nodes": [{"Id": "node-1", "NodeType": "CodeBlockNode"}], "Connectors": []}
            for dirname in (
                ("libraries", "dynamo", "example"),
                ("libraries", "jobs", "example"),
                ("temp-jobs", "example"),
                ("dynamo", "staging"),
            ):
                folder = root.joinpath(*dirname)
                folder.mkdir(parents=True)
                source = folder / "sample.dyn"
                source.write_text(json.dumps(graph), encoding="utf-8")
                report = validate_staged_dyn(str(source))
                self.assertEqual(report["path"], str(source.resolve()))
                self.assertEqual(report["node_count"], 1)

    def test_python_node_only_in_owned_graph(self):
        with TemporaryDirectory() as tmp, patch.dict(os.environ, {"LOCALAPPDATA": tmp}):
            root = Path(tmp) / "RevitGPT"
            graph = {"Nodes": [{"Id": "python-1", "NodeType": "PythonScriptNode"}],
                     "Connectors": []}
            owner = root / "temp-jobs" / "python-example"
            staging = root / "dynamo" / "staging"
            owner.mkdir(parents=True)
            staging.mkdir(parents=True)
            source = owner / "graph.dyn"
            source.write_text(json.dumps(graph), encoding="utf-8")
            self.assertEqual(validate_staged_dyn(str(source))["node_count"], 1)
            legacy = staging / "graph.dyn"
            legacy.write_text(json.dumps(graph), encoding="utf-8")
            with self.assertRaisesRegex(DynamoPreflightError, "Python Node requires"):
                validate_staged_dyn(str(legacy))

    def test_nonowner_graph_denied(self):
        with TemporaryDirectory() as tmp, patch.dict(os.environ, {"LOCALAPPDATA": tmp}):
            source = Path(tmp) / "outside.dyn"
            source.write_text(json.dumps({"Nodes": [], "Connectors": []}), encoding="utf-8")
            with self.assertRaises(DynamoPreflightError):
                validate_staged_dyn(str(source))


if __name__ == "__main__":
    unittest.main()
