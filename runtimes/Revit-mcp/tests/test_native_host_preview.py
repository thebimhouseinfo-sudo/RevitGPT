"""Static safety assertions only: never claim this proves Revit 2024 compilation."""
from pathlib import Path
import unittest

BASE = Path(__file__).resolve().parents[1]
HOST = BASE / "bridge" / "unified_native" / "RevitGptApplication.cs"
ROUTER = BASE / "bridge" / "unified_native" / "RevitApiRouter.cs"
SERVER = BASE / "bridge" / "unified_native" / "BridgeHttpServer.cs"
PROJECT = BASE / "bridge" / "unified_native" / "RevitGPT.Native.csproj"


class HostPreviewTests(unittest.TestCase):
    def test_startup_nonblocking_and_native_only(self):
        source = HOST.read_text(encoding="utf-8")
        self.assertIn("app.Idling += OnFirstIdle", source)
        self.assertIn("RevitExternalEventAdapter.CreateOnRevitUiThread()", source)
        self.assertIn("new BridgeHttpServer(protocol)", source)
        self.assertIn("new RevitGptPaneProvider(_retry.Request, _binding)", source)
        self.assertIn("_retry.TryConsume()", source)
        self.assertIn("if (_server != null && _server.IsRunning) return;", source)
        idle_body = source.split("private void OnFirstIdle", 1)[1].split("private void DisposeBridge", 1)[0]
        self.assertNotIn("_application.Idling -= OnFirstIdle", idle_body)
        self.assertIn("DisposeBridge();", idle_body)
        self.assertNotIn(".Wait()", source)
        self.assertNotIn("GetAwaiter().GetResult()", source)
        self.assertNotIn("StartBridgeCommand", source)
        self.assertNotIn("sync-revit-bridge", source)
        self.assertTrue(PROJECT.exists())

    def test_no_api_access_from_listener(self):
        listener = SERVER.read_text(encoding="utf-8")
        self.assertNotIn("Autodesk.Revit.", listener)
        self.assertNotIn("UIApplication", listener)
        self.assertNotIn("Document", listener)
        self.assertNotIn("ExternalEvent.Create", listener)

    def test_writes_fail_closed_until_live_mutation_fixture(self):
        source = ROUTER.read_text(encoding="utf-8")
        self.assertIn("if (BridgeHttpProtocol.IsWrite(path))", source)
        self.assertIn("return Error(501,", source)
        self.assertIn("Int64.Parse", source)
        self.assertIn("NativeDocumentContract.Create(", source)
        self.assertIn(".Value", source)
        self.assertNotIn("IntegerValue", source)
        for dangerous in ("new Transaction(", "Transaction.Start(", ".Delete(",
                          "ElementTransformUtils.MoveElement", "Duct.Create(", "Pipe.Create("):
            self.assertNotIn(dangerous, source)


if __name__ == "__main__":
    unittest.main()
