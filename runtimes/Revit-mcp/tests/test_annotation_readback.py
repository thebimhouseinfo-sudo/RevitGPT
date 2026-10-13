"""Read-only annotation detail route and bound-service contract."""
import unittest
from unittest.mock import patch
from connection import bridge
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


class AnnotationDetailTests(unittest.TestCase):
    @patch.object(bridge, "_send_request", return_value={"data": {"kind":"tag","element_id":"42","has_leader":True}})
    def test_exact_annotation_read(self, mock):
        result = bridge.get_annotation("42")
        self.assertEqual(result["kind"], "tag")
        mock.assert_called_once_with("/annotation/get",
                                     payload={"element_id":"42"}, method="POST")

    @patch.object(bridge, "_send_request")
    def test_invalid_ids_never_sent(self, mock):
        for invalid in ("", "0", "-2", "abc", 42, None):
            with self.subTest(value=invalid):
                with self.assertRaises(ValueError):
                    bridge.get_annotation(invalid)
        mock.assert_not_called()

    def test_native_annotation_read_does_not_require_write_grant(self):
        route = (BASE/"bridge/unified_native/BridgeHttpProtocol.cs").read_text(encoding="utf-8")
        native = (BASE/"bridge/unified_native/RevitApiRouter.cs").read_text(encoding="utf-8")
        self.assertIn('path != "/annotation/get"', route)
        self.assertIn('if (path == "/annotation/get") return GetAnnotation(doc, payload)', native)
        self.assertIn('element.OwnerViewId.Value', native)
        self.assertIn('pinned = element.Pinned', native)


if __name__ == "__main__":
    unittest.main()
