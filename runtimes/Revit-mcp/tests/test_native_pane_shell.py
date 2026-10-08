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
        self.assertIn("new RevitGptPane()", provider)
        self.assertIn("RegisterDockablePane", host)
        self.assertIn("RevitGptPaneProvider.PaneId", host)
        self.assertNotIn(".Wait()", host)
        self.assertNotIn("GetAwaiter().GetResult()", host)

    def test_chat_profile_and_authority_boundary(self):
        source = (ROOT / "RevitGptPane.cs").read_text(encoding="utf-8")
        self.assertIn("https://chatgpt.com/", source)
        self.assertIn('"webview", "revit"', source)
        self.assertIn("CoreWebView2Environment.CreateAsync", source)
        self.assertIn("EnsureCoreWebView2Async", source)
        self.assertIn("Native bridge preview (read only)", source)
        for forbidden in ("ExecuteScriptAsync", "GetCookiesAsync",
                          "document.querySelector", "Lease + Bind Current"):
            self.assertNotIn(forbidden, source)

    def test_build_references(self):
        text = (ROOT / "RevitGPT.Native.csproj").read_text(encoding="utf-8")
        self.assertIn("<UseWPF>true</UseWPF>", text)
        self.assertIn('PackageReference Include="Microsoft.Web.WebView2"', text)


if __name__ == "__main__":
    unittest.main()
