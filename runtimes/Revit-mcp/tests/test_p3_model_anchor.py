"""P3 Model Anchor Python MCP routes: contract tests; no Revit host needed."""
import unittest
from unittest.mock import patch
from connection import bridge

class AnchorBridgeTests(unittest.TestCase):
    @patch.object(bridge, "_send_request", return_value={"data": {"found": False, "model_id": None}})
    def test_read_only_route(self, send):
        result=bridge.read_model_anchor("123")
        self.assertFalse(result["found"])
        send.assert_called_once_with("/model-anchor/read", payload={"document_id":"123"},method="POST")

    @patch.object(bridge, "_send_request", return_value={"data": {"initialized": True, "requires_save": True}})
    def test_initialize_is_explicit_write(self, send):
        result=bridge.initialize_model_anchor("123")
        self.assertTrue(result["requires_save"])
        send.assert_called_once_with("/model-anchor/initialize", payload={"document_id":"123"},
                                     method="POST",timeout=bridge.WRITE_TIMEOUT)

    def test_native_source_distinguishes_read_and_write(self):
        from pathlib import Path
        root=Path(__file__).resolve().parents[1]
        source=(root/"bridge/unified_native/NativeModelAnchor.cs").read_text(encoding="utf-8")
        router=(root/"bridge/unified_native/RevitApiRouter.cs").read_text(encoding="utf-8")
        for expected in ('get_Parameter(DefinitionGuid)', 'if (!initialize)',
                         'ProjectInformation', 'GenerateModelId(doc)', 'Transaction(doc,',
                         'SharedParametersFilename = previous'):
            self.assertIn(expected,source)
        self.assertIn('"/model-anchor/read"',router)
        self.assertIn('"/model-anchor/initialize"',router)
        routes=(root/"bridge/unified_native/BridgeRouteContract.cs").read_text(encoding="utf-8")
        protocol=(root/"bridge/unified_native/BridgeHttpProtocol.cs").read_text(encoding="utf-8")
        self.assertIn('"POST /model-anchor/read"',routes)
        self.assertIn('"POST /model-anchor/initialize"',routes)
        self.assertIn('path == "/model-anchor/initialize"',protocol)
        self.assertIn("DuplicateOpenModels",source)
        # Different Revit DB.Document managed wrappers can refer to the SAME RVT.
        # Native bound/document IDs already use GetHashCode(); never count self as a copy.
        self.assertIn("other.GetHashCode() != doc.GetHashCode()",source)
        self.assertNotIn("other != doc &&",source)
        self.assertIn('"yyyyMMddTHHmmssfffZ"',source)
        self.assertIn('Guid.NewGuid().ToString("N").Substring(0, 8)',source)
        self.assertIn("duplicate_open_model_count",source)
        self.assertIn("valid = ValidModelId(value)",source)
        self.assertNotIn("valid = ValidModelId(value) && conflicts.Length == 0",source)
        self.assertNotIn("Another open RVT has the same persistent Model ID",source)

if __name__=="__main__":
    unittest.main()
