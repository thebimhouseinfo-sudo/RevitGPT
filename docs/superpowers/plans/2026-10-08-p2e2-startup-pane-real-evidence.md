# RevitGPT dockable pane startup after Home

Observed: user chose Always Load, but panel not visible after prior Show() fix.
Autodesk documents that Revit may not show dockable panes in zero-document state and that IsShown also means a pane is present as a tab. Prior code exhausted three Idling retries on Revit Home before first RVT.

## Changes
- Defer startup pane Show until a real active project RVT exists (no Family/Link).
- Do not consume retry budget during Revit Home; 8 bounded attempts after model open, separated by 3 seconds.
- On successful IsShown (pane onscreen or tab), stop auto-show so manual hide is respected.
- Write local diagnostics only for lifecycle events and exceptions, under %LOCALAPPDATA%\\RevitGPT\\logs\\native-pane.ndjson.
- Instrument registration, creator invocation, WPF Loaded and WebView2 Ready to disambiguate: pane not registered, pane not shown, tab behind another pane, WebView failed.
- Native read-only model authority, user preferences, 80% zoom and sleep/wake remain unchanged.

## Host acceptance
Revit Home 30+ seconds -> open RG-Test-A -> pane automatically appears. Also verify already-open file, pane manual hide stays hidden, reopen Revit auto-shows. If native-pane log reports `show_result after=true` but no visible pane, inspect Revit tab group (IsShown includes background tabs); do not claim it is foreground.
