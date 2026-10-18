"""P1 ribbon/panel reopening contract must survive P3 changes."""
from pathlib import Path
import unittest

BASE = Path(__file__).resolve().parents[1] / "bridge" / "unified_native"

class P1RibbonRegression(unittest.TestCase):
    def test_visible_reopen_button_is_registered(self):
        source=(BASE/"RevitGptApplication.cs").read_text(encoding="utf-8")
        self.assertIn('app.CreateRibbonPanel("RevitGPT")',source)
        self.assertIn('new PushButtonData("RevitGPT_OpenPane", "RevitGPT",',source)
        self.assertIn('typeof(OpenRevitGptPaneCommand).FullName',source)
        self.assertIn('NativePaneDiagnostics.Record("ribbon_registered")',source)
        self.assertIn('NativePaneDiagnostics.Record("ribbon_failed"',source)

    def test_reopen_is_ui_only_and_uses_original_dockable_pane(self):
        source=(BASE/"OpenRevitGptPaneCommand.cs").read_text(encoding="utf-8")
        self.assertIn('GetDockablePane(RevitGptPaneProvider.PaneId)',source)
        self.assertIn('if (!shownBefore) pane.Show()',source)
        self.assertNotIn('BindCurrent',source)
        self.assertNotIn('RestartBridge',source)

if __name__=="__main__":
    unittest.main()
