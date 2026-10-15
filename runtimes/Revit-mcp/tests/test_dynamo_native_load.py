"""Native Dynamo loader: manual-open and explicit internal-engine autorun."""
import unittest
from pathlib import Path
from unittest.mock import patch
from connection import bridge

BASE = Path(__file__).resolve().parents[1]


class DynamoNativeLoadContracts(unittest.TestCase):
    def test_explicit_dynamo_journal_modes_are_distinct(self):
        code = (BASE / "bridge/unified_native/NativeDynamoLoad.cs").read_text(encoding="utf-8")
        for marker in (
            'payload.Value<bool?>("run") ?? false',
            '{ "dynAutomation", autoRun ? "True" : "False" }',
            '{ "dynPathExecute", autoRun ? "True" : "False" }',
            '{ "dynForceManualRun", autoRun ? "False" : "True" }',
            'IsLocalTrustedFile(path)', 'FileAttributes.ReparsePoint',
            'String.Equals(digest, expected',
            'LOADED_MANUAL_HOST_UNVERIFIED',
            'DYNAMO_AUTORUN_DISPATCHED_OUTCOME_UNVERIFIED',
            'graph_execution_requested = autoRun',
            'host_run_evidence_pending = autoRun'
        ):
            self.assertIn(marker, code)
        self.assertNotIn("modelToRun.Run()", code)
        self.assertNotIn("ExecuteGraph()", code)
        self.assertIn("rootDirectory", code)

    @patch.object(bridge, "_send_request", return_value={
        "data": {"status": "LOADED_MANUAL_HOST_UNVERIFIED"}
    })
    @patch("services.dynamo_preflight.validate_staged_dyn",
           return_value={"path": "C:/mock/staging/safe.dyn", "sha256": "b" * 64})
    def test_load_keeps_manual_mode(self, validate, transport):
        result = bridge.load_dyn_file("C:/mock/staging/safe.dyn")
        self.assertEqual(result["status"], "LOADED_MANUAL_HOST_UNVERIFIED")
        validate.assert_called_once()
        transport.assert_called_once_with(
            "/dynamo/load",
            payload={"path": "C:/mock/staging/safe.dyn", "sha256": "b" * 64},
            method="POST", timeout=bridge.WRITE_TIMEOUT
        )

    @patch.object(bridge, "_send_request", return_value={
        "data": {"status": "DYNAMO_AUTORUN_DISPATCHED_OUTCOME_UNVERIFIED"}
    })
    @patch("services.dynamo_preflight.validate_staged_dyn",
           return_value={"path": "C:/mock/staging/graph.dyn", "sha256": "c" * 64})
    def test_explicit_autorun_request(self, validate, transport):
        result = bridge.run_dyn_file("C:/mock/staging/graph.dyn", "30988800")
        self.assertEqual(result["status"], "DYNAMO_AUTORUN_DISPATCHED_OUTCOME_UNVERIFIED")
        validate.assert_called_once()
        transport.assert_called_once_with(
            "/dynamo/load",
            payload={
                "path": "C:/mock/staging/graph.dyn", "sha256": "c" * 64,
                "run": True, "document_id": "30988800"
            },
            method="POST", timeout=bridge.WRITE_TIMEOUT
        )


if __name__ == "__main__":
    unittest.main()
