"""Dynamo LOAD-only API must keep MANUAL and no-RUN flags, and reject escapes."""
import unittest
from pathlib import Path
from unittest.mock import patch
from connection import bridge

BASE = Path(__file__).resolve().parents[1]


class DynamoNativeLoadContracts(unittest.TestCase):
    def test_no_execution_journal_flags_are_explicit(self):
        code = (BASE/"bridge/unified_native/NativeDynamoLoad.cs").read_text(encoding="utf-8")
        for marker in ('{ "dynAutomation", "False" }',
                       '{ "dynPathExecute", "False" }',
                       '{ "dynForceManualRun", "True" }',
                       'IsLocalTrustedFile(path)',
                       'FileAttributes.ReparsePoint',
                       'String.Equals(digest, expected',
                       'LOADED_MANUAL_HOST_UNVERIFIED'):
            self.assertIn(marker, code)
        self.assertNotIn('modelToRun.Run()', code)
        self.assertNotIn('ExecuteGraph()', code)
        self.assertIn('rootDirectory', code)

    @patch.object(bridge, "_send_request", return_value={
        "data": {"status": "LOADED_MANUAL_HOST_UNVERIFIED"}
    })
    @patch("services.dynamo_preflight.validate_staged_dyn",
           return_value={"path":"C:/mock/staging/safe.dyn","sha256":"b"*64})
    def test_calls_adapter_after_preflight(self, validate, transport):
        result = bridge.load_dyn_file("C:/mock/staging/safe.dyn")
        self.assertEqual(result["status"], "LOADED_MANUAL_HOST_UNVERIFIED")
        validate.assert_called_once()
        transport.assert_called_once_with("/dynamo/load",
            payload={"path":"C:/mock/staging/safe.dyn","sha256":"b"*64},
            method="POST", timeout=bridge.WRITE_TIMEOUT)


if __name__ == "__main__":
    unittest.main()
