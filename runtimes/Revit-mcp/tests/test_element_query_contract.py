"""Bounded parameter predicate/keyset query contracts; no live model mutation."""
import unittest
from pathlib import Path
from unittest.mock import patch
from connection import bridge

BASE = Path(__file__).resolve().parents[1]


class ElementQueryTests(unittest.TestCase):
    @patch.object(bridge, "_send_request", return_value={"data":{"elements":[{"element_id":"42"}],"has_more":False}})
    def test_predicate(self, call):
        result = bridge.query_elements(category="Mechanical Equipment",
            predicate={"parameter":"Mark","operator":"equals","value":"0012"},page_size=10)
        self.assertEqual(result["elements"][0]["element_id"], "42")
        call.assert_called_once_with("/elements/query",payload={
            "category":"Mechanical Equipment",
            "predicate":{"parameter":"Mark","operator":"equals","value":"0012"},
            "page_size":10
        },method="POST")

    @patch.object(bridge, "_send_request")
    def test_invalid_query_never_sent(self, call):
        for kwargs in ({"page_size":0}, {"page_size":201}, {"after_id":"-3"},
                       {"predicate":{"parameter":"Mark","operator":"run","value":"x"}},
                       {"predicate":{"parameter":"Mark","operator":"equals"}}):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(ValueError):
                    bridge.query_elements(**kwargs)
        call.assert_not_called()

    def test_non_snapshot_cursor_is_explicit(self):
        code = (BASE/"bridge/unified_native/NativeElementQuery.cs").read_text(encoding="utf-8")
        self.assertIn('snapshot_consistency = "none"', code)
        self.assertIn('next_after_id = hasMore', code)
        self.assertIn('page_size must be 1..200', code)
        self.assertIn('Ambiguous parameter display name', code)
        self.assertIn('Math.Abs(p.AsDouble() - needle)', code)


if __name__ == "__main__":
    unittest.main()
