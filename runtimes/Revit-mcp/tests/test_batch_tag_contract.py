"""Batch tag input and authorization contract (offline only)."""
import unittest
from unittest.mock import patch
from pathlib import Path
from connection import bridge

ROOT = Path(__file__).resolve().parents[1]


class BatchTagTests(unittest.TestCase):
    @patch.object(bridge, "_send_request", return_value={"data": {"tagged_count": 2}})
    def test_bounded_batch(self, send):
        result = bridge.batch_tag("100", ["200", "201"], has_leader=True)
        self.assertEqual(result["tagged_count"], 2)
        send.assert_called_once_with("/annotation/batch-tag", payload={
            "view_id": "100", "element_ids": ["200", "201"],
            "has_leader": True
        }, method="POST", timeout=bridge.WRITE_TIMEOUT)

    @patch.object(bridge, "_send_request")
    def test_invalid_inputs_rejected_without_transport(self, send):
        for ids in ([], ["1", "1"], ["-1"], ["0"], ["bad"], ["1"] * 51):
            with self.subTest(ids=ids):
                with self.assertRaises(ValueError):
                    bridge.batch_tag("100", ids)
        with self.assertRaises(ValueError):
            bridge.batch_tag("0", ["1"])
        with self.assertRaises(ValueError):
            bridge.batch_tag("100", ["1"], has_leader="yes")
        send.assert_not_called()

    def test_native_transaction_and_no_duplicate_tags(self):
        source = (ROOT/"bridge/unified_native/NativeBatchTags.cs").read_text(encoding="utf-8")
        protocol = (ROOT/"bridge/unified_native/BridgeHttpProtocol.cs").read_text(encoding="utf-8")
        self.assertIn("GetTaggedLocalElementIds()", source)
        self.assertIn("tx.RollBack()", source)
        self.assertIn("IndependentTag.Create(", source)
        self.assertIn('path.StartsWith("/annotation/"', protocol)


if __name__ == "__main__":
    unittest.main()
