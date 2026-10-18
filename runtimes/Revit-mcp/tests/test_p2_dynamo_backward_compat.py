"""Compatibility scenarios for Dynamo stage/load preflight used before P3.
No Revit runtime is needed; does not assert graph execution."""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest

from services.dynamo_preflight import (
    stage_dynamo_graph, validate_staged_dyn, DynamoPreflightError
)

class LegacyP2DynamoCompatibility(unittest.TestCase):
    def test_legacy_draft_to_stage_and_preflight_is_still_available(self):
        with TemporaryDirectory() as temp, patch.dict(os.environ, {"LOCALAPPDATA": temp}):
            root=Path(temp)/"RevitGPT"
            draft=root/"workspace"/"dynamo-draft"
            draft.mkdir(parents=True)
            graph=draft/"baseline.dyn"
            graph.write_text(json.dumps({
                "Nodes":[{"Id":"n1","NodeType":"CodeBlockNode"}],
                "Connectors":[]
            }),encoding="utf-8")
            staged=stage_dynamo_graph(str(graph))
            self.assertEqual(staged["status"],"STAGED_NOT_RUN")
            self.assertEqual(staged["node_count"],1)
            reread=validate_staged_dyn(staged["path"])
            self.assertEqual(reread["sha256"],staged["sha256"])
            self.assertFalse(reread["safe_to_execute"])
            self.assertTrue(Path(staged["path"]).is_relative_to(root/"dynamo"/"staging"))

    def test_legacy_staging_still_rejects_python_node(self):
        with TemporaryDirectory() as temp, patch.dict(os.environ, {"LOCALAPPDATA": temp}):
            stage=Path(temp)/"RevitGPT"/"dynamo"/"staging"
            stage.mkdir(parents=True)
            file=stage/"python.dyn"
            file.write_text(json.dumps({"Nodes":[{"Id":"1","NodeType":"PythonScriptNode"}],"Connectors":[]}),encoding="utf-8")
            with self.assertRaisesRegex(DynamoPreflightError,"Python Node requires"):
                validate_staged_dyn(str(file))

    def test_external_graph_still_cannot_bypass_staging(self):
        with TemporaryDirectory() as temp, patch.dict(os.environ, {"LOCALAPPDATA": temp}):
            file=Path(temp)/"rogue.dyn"
            file.write_text('{"Nodes":[],"Connectors":[]}',encoding="utf-8")
            with self.assertRaises(DynamoPreflightError):
                validate_staged_dyn(str(file))

if __name__=="__main__":
    unittest.main()
