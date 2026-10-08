import importlib.util
import os
import pathlib
import unittest
from unittest.mock import patch


MODULE_PATH = pathlib.Path(__file__).with_name("test_real_connection.py")


def load_live_probe():
    spec = importlib.util.spec_from_file_location("revit_live_probe_gate_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LiveProbeSafetyGateTests(unittest.TestCase):
    def setUp(self):
        self.probe = load_live_probe()

    def test_missing_safe_dispatch_confirmation_blocks_before_health_call(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(self.probe, "health_check") as health,
        ):
            result = self.probe.main()

        self.assertEqual(result, 2)
        health.assert_not_called()

    def test_exact_confirmation_allows_read_only_call_path(self):
        active = {"runtime_id": "doc-1", "title": "Disposable Model"}
        with (
            patch.dict(
                os.environ,
                {self.probe.SAFE_DISPATCH_ENV: "1"},
                clear=True,
            ),
            patch.object(
                self.probe,
                "health_check",
                return_value={"available": True, "bridge": {"status": "ok"}},
            ) as health,
            patch.object(
                self.probe,
                "get_active_document",
                return_value=active,
            ) as active_document,
            patch.object(
                self.probe,
                "get_documents",
                return_value=[active],
            ) as documents,
            patch.object(self.probe, "get_views", return_value=[]) as views,
            patch.object(self.probe, "get_levels", return_value=[]) as levels,
        ):
            result = self.probe.main()

        self.assertEqual(result, 0)
        health.assert_called_once_with()
        active_document.assert_called_once_with()
        documents.assert_called_once_with()
        views.assert_called_once_with()
        levels.assert_called_once_with()

    def test_missing_runtime_ids_cannot_match_as_none(self):
        active = {"title": "Disposable Model", "id": "100"}
        listed = [{"title": "Disposable Model", "id": "100"}]
        with (
            patch.dict(os.environ, {self.probe.SAFE_DISPATCH_ENV: "1"}, clear=True),
            patch.object(self.probe, "health_check",
                         return_value={"available": True, "bridge": {"status": "ok"}}),
            patch.object(self.probe, "get_active_document", return_value=active),
            patch.object(self.probe, "get_documents", return_value=listed) as docs,
            patch.object(self.probe, "get_views") as views,
        ):
            result = self.probe.main()
        self.assertEqual(result, 1)
        docs.assert_not_called()
        views.assert_not_called()

    def test_missing_listed_runtime_id_fails_closed(self):
        active = {"title": "Disposable Model", "runtime_id": "100"}
        listed = [{"title": "Disposable Model", "id": "100"}]
        with (
            patch.dict(os.environ, {self.probe.SAFE_DISPATCH_ENV: "1"}, clear=True),
            patch.object(self.probe, "health_check",
                         return_value={"available": True, "bridge": {"status": "ok"}}),
            patch.object(self.probe, "get_active_document", return_value=active),
            patch.object(self.probe, "get_documents", return_value=listed),
            patch.object(self.probe, "get_views") as views,
        ):
            result = self.probe.main()
        self.assertEqual(result, 1)
        views.assert_not_called()

    def test_mismatched_runtime_ids_fail_closed(self):
        active = {"title": "Disposable Model", "runtime_id": "100"}
        listed = [{"title": "Another Model", "runtime_id": "200"}]
        with (
            patch.dict(os.environ, {self.probe.SAFE_DISPATCH_ENV: "1"}, clear=True),
            patch.object(self.probe, "health_check",
                         return_value={"available": True, "bridge": {"status": "ok"}}),
            patch.object(self.probe, "get_active_document", return_value=active),
            patch.object(self.probe, "get_documents", return_value=listed),
            patch.object(self.probe, "get_views") as views,
        ):
            result = self.probe.main()
        self.assertEqual(result, 1)
        views.assert_not_called()

    def test_truthy_but_unapproved_value_still_blocks(self):
        with (
            patch.dict(
                os.environ,
                {self.probe.SAFE_DISPATCH_ENV: "true"},
                clear=True,
            ),
            patch.object(self.probe, "health_check") as health,
        ):
            result = self.probe.main()

        self.assertEqual(result, 2)
        health.assert_not_called()


if __name__ == "__main__":
    unittest.main()
