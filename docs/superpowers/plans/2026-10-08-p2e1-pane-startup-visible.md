# P2E-1 — restore automatic RevitGPT dockable pane opening

Reported by user: P2E native WebView2 panel does not open automatically.

## Root cause
The provider already uses `VisibleByDefault = true`, but Autodesk documents
that this affects first launch only; subsequent launches restore visibility
from Revit's saved UI state. The host registered the pane but did not call
`DockablePane.Show()`.

## Fix
- Preserve stable dockable pane GUID and `IFrameworkElementCreator`.
- After registration, flag a **one-time** startup show.
- Call `UIApplication.GetDockablePane(id)`, `IsShown()`, `Show()`
  from Revit `Idling` (valid Revit UI API context).
- Never re-show on later Idling after success, so user's manual close wins.
- Retry at most 3 times if startup layout/API not yet ready, then leave logs
  in Debug; do not crash or block bridge startup.
- Reset flags on Revit shutdown.

## Acceptance
Native Revit 2024 compilation and host static tests, then real host check:
pane automatically appears even if previously hidden when Revit was closed;
manual hide after startup stays hidden; reopening Revit auto-shows again.
Do not touch model contents or rebind policy; no writes enabled.
