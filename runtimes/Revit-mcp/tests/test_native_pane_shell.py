"""Static shell guard. Does not replace real Revit/WebView2 host testing."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / "bridge" / "unified_native"


class NativePaneShellTests(unittest.TestCase):
    def test_pane_recreated_and_registered(self):
        provider = (ROOT / "RevitGptPaneProvider.cs").read_text(encoding="utf-8")
        host = (ROOT / "RevitGptApplication.cs").read_text(encoding="utf-8")
        self.assertIn("IFrameworkElementCreator", provider)
        self.assertIn("data.FrameworkElement = null", provider)
        self.assertIn("data.FrameworkElementCreator = this", provider)
        self.assertIn("new RevitGptPane(_binding)", provider)
        self.assertIn("public RevitGptPaneProvider(NativeModelBindingState binding)", provider)
        self.assertIn("RegisterDockablePane", host)
        self.assertIn("_initialPaneShowPending = true;", host)
        self.assertIn("TryShowInitialPane(uiapp);", host)
        self.assertIn("uiapp.GetDockablePane(RevitGptPaneProvider.PaneId)", host)
        self.assertIn("if (!pane.IsShown()) pane.Show();", host)
        self.assertIn("_initialPaneShowPending = false;", host)
        self.assertIn("_initialPaneShowAttempts >= 3", host)
        # Reopening the pane on every Idling tick would override manual hide.
        self.assertEqual(host.count("pane.Show();"), 1)
        self.assertLess(host.index("TryShowInitialPane(uiapp);"),
                        host.index("if (_server != null && _server.IsRunning)"))
        self.assertIn("RevitGptPaneProvider.PaneId", host)
        self.assertNotIn(".Wait()", host)
        self.assertNotIn("GetAwaiter().GetResult()", host)

    def test_chat_profile_and_authority_boundary(self):
        source = (ROOT / "RevitGptPane.cs").read_text(encoding="utf-8")
        self.assertIn("https://chatgpt.com/", source)
        self.assertIn('"webview", "revit"', source)
        self.assertIn("CoreWebView2Environment.CreateAsync", source)
        self.assertIn("EnsureCoreWebView2Async", source)
        self.assertIn('Content = "Bind Current"', source)
        self.assertIn('new ToggleButton', source)
        self.assertIn('Content = "Dark"', source)
        self.assertIn("CoreWebView2PreferredColorScheme", source)
        self.assertIn("ZoomFactor = 0.8", source)
        self.assertIn("Color.FromRgb(180, 83, 9)", source)
        self.assertIn("Color.FromRgb(253, 224, 71)", source)
        self.assertIn("_binding.RequestBindCurrent()", source)
        for forbidden in ('Content = "Pair"', 'Content = "Refresh"',
                          'Text = "RevitGPT"', "NativePanelPairingClient",
                          "NativePanelSession"):
            self.assertNotIn(forbidden, source)
        self.assertNotIn("RevitApiRouter.Execute", source)
        self.assertNotIn("CoreWebView2.Reload()", source)
        for forbidden in ("ExecuteScriptAsync", "GetCookiesAsync",
                          "document.querySelector", "Lease + Bind Current"):
            self.assertNotIn(forbidden, source)

    def test_build_references(self):
        text = (ROOT / "RevitGPT.Native.csproj").read_text(encoding="utf-8")
        self.assertIn("<UseWPF>true</UseWPF>", text)
        self.assertIn('PackageReference Include="Microsoft.Web.WebView2"', text)


if __name__ == "__main__":
    unittest.main()
