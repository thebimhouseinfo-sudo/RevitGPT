# E-PY-5A — CPython UI dispatch feasibility evidence

Date: 2026-10-08
Branch: `work/J-AFC4-p1-revit-mcp-bootstrap`
Source baseline: `3c48c72b656586e5be304870242cabda409d7186`
Status: **PYREVIT_DISPATCH_UNAVAILABLE — installed helper not viable for CPython; architecture review pending formal E-PY closeout**
Safety: **NO LIVE BRIDGE HTTP / Revit-API requests authorized**

## Direct evidence from the user's Revit 2024 host

- Installed pyRevit: 7.0.0.26278, `pyRevit.addin` attached for Revit 2024 with existing `pyRevitLoader.dll`.
- RevitGPT extension startup selector: `#! python3` (CPython).
- Real local startup at 2026-10-08T02:28:23Z: `startup_complete`, `running:true`, `ready:true`, port 8765; bridge log `revit_available:true`. These prove Python/.NET API imports and listener start, **not safe API dispatch**.
- Local installed pyRevit source: `%APPDATA%\pyRevit-Master\pyrevitlib\pyrevit\revit\events.py`.
  - Line 224: `execute_in_revit_context(func, *args, **kwargs)`.
  - Lines 259–260: `if not compat.IRONPY: PyRevitCPythonNotSupported("pyrevit.revit.events.execute_in_revit_context")`.
  - Line 209, 218: `ExternalEvent.Create(...)` exists but is not evidence of a CPython-compatible reusable handler.
- Upstream pyRevit source `pyrevitlib/pyrevit/revit/events.py`, checked on `develop` (blob `d63dc65d7b8ba1926c6c03068ab101283a09162c`):
  - Lines 205–211 instantiate `_HANDLER` and `_EXTERNAL_EVENT` only when `compat.IRONPY`.
  - Lines 259–260 explicitly mark `execute_in_revit_context` unsupported under CPython.
  - Lines 293–299 rely on the IronPython-only handler; helper is async/fire-and-forget and does not return request values.
- RevitGPT CPython bridge `runtimes/Revit-mcp/bridge/pyrevit_extension/RevitMCPBridge.extension/RevitMCPBridge.bundle/Contents/revit_mcp_bridge.py`:
  - `ensure_server_started()` creates a background Python `HTTPServer` thread.
  - `BridgeHandler.do_GET/do_POST` call Revit API directly (including `/health` and document routes).
  - No UI-thread dispatcher, `ExternalEvent`, `Idling` marshal, bounded request queue, or per-request completion exists in this implementation.

## E-PY-5A classification

**PYREVIT_DISPATCH_UNAVAILABLE for the installed CPython bridge under the approved bounded-remediation contract.**

The pyRevit helper inspected on the actual workstation is not a supported CPython dispatcher. Using it would require unsupported engine behavior; constructing a new Python.NET `IExternalEventHandler`, changing to IronPython, modifying pyRevit core, or adding a compiled C# helper are **outside** the authorized E-PY-5B remediation scope. No other already-shipped, supported, CPython-safe dispatch mechanism has been proven.

This classification does not assert CPython can never interoperate with Revit API, nor does it invalidate proven pyRevit auto-start. It means the current supported pyRevit surfaces do not satisfy the project's required **safe, response-bearing, background-HTTP-to-Revit-UI dispatch**.

## Consequences

1. Keep the existing pyRevit bridge **untrusted for Revit API HTTP calls**. Do not call `/health`, `@rg`, or any bridge read/write endpoint to "see if it works".
2. **Do not run pyRevit-only mutation, concurrent HTTP, sleep/crash lifecycle, or destructive host tests** after this decisive dispatch finding; mark such tests `NOT_APPLICABLE_AFTER_DECISIVE_FAIL` at their evidence gates.
3. Follow the approved fallback direction **UNIFIED_NATIVE**: one RevitGPT native add-in owns `DockablePane + WebView2 + bridge + C# ExternalEvent UI-thread dispatcher + Refresh recovery`, preserving one primary model binding and no automatic rebind on view changes.
4. The GSA Job `J-A38C` remains `IN_PROGRESS` until required predecessor baselines, explicit N/A evidence, reviewer verification, and formal E-PY-9 decision closeout are recorded. Do not claim that P1B implementation or actual `@rg` connectivity is complete.
5. Before installing any unified-native replacement, close Revit, inspect actual add-in/port ownership, and retain the reversible `RevitMCPBridge.addin.e-py-disabled` evidence. Avoid dual listeners on port 8765.

## Test validity / evidence boundaries

- `startup_complete` and `revit_available:true` are **import/server-lifecycle evidence only**.
- The user-supplied local pyRevit source is the installed-runtime evidence; upstream code provides an independently checked correspondence.
- No live HTTP/Revit API test was performed because the current thread model is unsafe.
- Full 10-cycle cold-start and broader lifecycle baseline were **not** executed. They cannot establish API safety; formal GSA sequencing may require an explicit review of predecessor tasks before closeout.
