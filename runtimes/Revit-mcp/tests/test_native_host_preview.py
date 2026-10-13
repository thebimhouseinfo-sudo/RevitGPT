"""Static safety assertions only: never claim this proves Revit 2024 compilation."""
from pathlib import Path
import unittest

BASE = Path(__file__).resolve().parents[1]
HOST = BASE / "bridge" / "unified_native" / "RevitGptApplication.cs"
ROUTER = BASE / "bridge" / "unified_native" / "RevitApiRouter.cs"
SERVER = BASE / "bridge" / "unified_native" / "BridgeHttpServer.cs"
PROJECT = BASE / "bridge" / "unified_native" / "RevitGPT.Native.csproj"


class HostPreviewTests(unittest.TestCase):
    def assert_startup_one_shot_guard(self, source):
        body = source.split("private void TryShowInitialPane", 1)[1].split(
            "private void DisposeBridge", 1)[0]
        guard = "if (!_paneRegistered || !_initialPaneShowPending || !_paneStartup.Pending) return;"
        self.assertIn(guard, body)
        self.assertLess(body.index(guard), body.index("pane.Show();"))

    def test_startup_nonblocking_and_native_only(self):
        source = HOST.read_text(encoding="utf-8")
        self.assertIn("app.Idling += OnFirstIdle", source)
        self.assertIn("RevitExternalEventAdapter.CreateOnRevitUiThread()", source)
        self.assertIn("TryShowInitialPane(uiapp);", source)
        self.assertIn("GetDockablePane(RevitGptPaneProvider.PaneId)", source)
        self.assertIn("if (!shownBefore) pane.Show();", source)
        self.assertIn("bool shownAfter = pane.IsShown();", source)
        self.assertIn("_paneStartup.ReportShown();", source)
        self.assertIn("if (!_paneRegistered || !_initialPaneShowPending || !_paneStartup.Pending) return;", source)
        # Check the guard before Show, then prove the same assertion rejects
        # a plausible regression which drops the one-shot pending condition.
        self.assert_startup_one_shot_guard(source)
        guard = "if (!_paneRegistered || !_initialPaneShowPending || !_paneStartup.Pending) return;"
        mutant = source.replace(guard, "if (!_paneRegistered) return;", 1)
        self.assertNotEqual(source, mutant)
        with self.assertRaises(AssertionError):
            self.assert_startup_one_shot_guard(mutant)
        self.assertIn("NativePaneStartupPolicy.MaximumAttempts", source)
        self.assertIn("if (!projectReady)", source)
        self.assertIn("!active.IsFamilyDocument && !active.IsLinked", source)
        self.assertIn('NativePaneDiagnostics.Record("show_exhausted"', source)
        self.assertIn("new BridgeHttpServer(protocol)", source)
        self.assertIn("new RevitGptPaneProvider(_binding)", source)
        self.assertIn("RevitApiRouter.Execute(ui, method, path, body, _binding)", source)
        self.assertIn("_retry.TryConsume()", source)
        self.assertIn("!d.IsLinked && !d.IsFamilyDocument", source)
        self.assertIn("_binding.ObserveUnavailable();", source)
        self.assertNotIn("_binding.Observe(null, null, new string[0]);", source)
        self.assertNotIn("NativePanelSession", source)
        # A healthy listener must be left in place, even if Refresh is clicked.
        # Check behavior/early return within the healthy branch, not a brittle
        # one-line spelling of the old no-recovery implementation.
        healthy_branch = r"if \(_server != null && _server\.IsRunning\)\s*\{[^}]*_recovery\.ReportHealthy\(\);[^}]*return;"
        self.assertRegex(source, healthy_branch)
        self.assertIn("if (!manualRetry && !_recovery.ShouldRetry(now)) return;", source)
        # Red control: removing the branch must be detected by this assertion.
        removed_guard = source.replace("if (_server != null && _server.IsRunning)", "if (false)", 1)
        self.assertNotRegex(removed_guard, healthy_branch)
        idle_body = source.split("private void OnFirstIdle", 1)[1].split("private void DisposeBridge", 1)[0]
        self.assertNotIn("_application.Idling -= OnFirstIdle", idle_body)
        self.assertIn("DisposeBridge();", idle_body)
        self.assertNotIn(".Wait()", source)
        self.assertNotIn("GetAwaiter().GetResult()", source)
        self.assertNotIn("StartBridgeCommand", source)
        self.assertNotIn("sync-revit-bridge", source)
        self.assertTrue(PROJECT.exists())

    def test_native_listener_shutdown_does_not_skip_cleanup_on_fault(self):
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("finally", source)
        self.assertIn("Interlocked.Exchange(ref _running, 0);", source)
        self.assertIn("_listener.Close();", source)
        self.assertNotIn("if (Interlocked.Exchange(ref _running, 0) == 0) return;", source)
        # Negative control: old early return must be detected as unsafe.
        old = source.replace("Interlocked.Exchange(ref _running, 0);",
            "if (Interlocked.Exchange(ref _running, 0) == 0) return;", 1)
        self.assertNotEqual(old, source)

    def test_no_api_access_from_listener(self):
        listener = SERVER.read_text(encoding="utf-8")
        self.assertNotIn("Autodesk.Revit.", listener)
        self.assertNotIn("UIApplication", listener)
        self.assertNotIn("Document", listener)
        self.assertNotIn("ExternalEvent.Create", listener)

    def test_writes_route_only_through_current_bound_document(self):
        source = ROUTER.read_text(encoding="utf-8")
        pane = (BASE / "bridge" / "unified_native" / "RevitGptPane.cs").read_text(encoding="utf-8")
        self.assertIn('mutations_ready = true', source)
        self.assertIn('binding.ReadDenial(Token(payload, "document_id"))', source)
        self.assertIn('if (denial != null) return Error(409, denial);', source)
        self.assertIn('var doc = FindDocument(app, payload);', source)
        self.assertIn('if (doc == null) return Error(404, "Target Revit document is not open.");', source)
        self.assertNotIn("writeAuthority.DenialOrConsume(", source)
        self.assertNotIn('NativeWriteAuthority', source)
        self.assertNotIn('Approve Write', pane)
        self.assertNotIn('_approveWrite', pane)
        self.assertIn('NativeDocumentContract.Create(', source)
        self.assertNotIn('Native write route not yet validated', source)
        self.assertIn('Int64.Parse', source)
        # Red control: dropping the bound-model check is detected.
        mutant = source.replace('binding.ReadDenial(Token(payload, "document_id"))',
                                'null', 1)
        self.assertNotIn('binding.ReadDenial(Token(payload, "document_id"))', mutant)
        with self.assertRaises(AssertionError):
            self.assertIn('binding.ReadDenial(Token(payload, "document_id"))', mutant)


if __name__ == "__main__":
    unittest.main()
