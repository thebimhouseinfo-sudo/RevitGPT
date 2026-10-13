# E-PY-9 — RevitGPT Bridge Host Architecture Decision

**Decision:** `UNIFIED_NATIVE`

**Decision date:** 2026-10-08

**Human gate:** User explicitly approved ending the remaining pyRevit-only test cycles and moving to unified native implementation after the decisive CPython dispatch failure. This approval **does not authorize** disruptive sleep/crash testing, destructive model writes, automatic manifest replacement, or production activation.

**Evidence baseline:** `work/J-AFC4-p1-revit-mcp-bootstrap@5977f4f20da5cfc559243fc9a7384cb539488da4`

**GSA decision job:** `J-A38C / 01a11765-45d0-7355-9707-696c6f7aa38c`. This document is source-repository evidence. Do not represent the GSA Job or P1B Job as completed until their independent lifecycle and review gates have been satisfied.

## Decision and causal reason

The exact installed pyRevit 7.0.0.26278 on Revit 2024 automatically executes extension `startup.py` under `#! python3` and loads Revit API types. That establishes successful startup/import **only**. The RevitGPT Python HTTP handlers run on a background HTTP thread and invoke Revit API directly; they cannot be promoted to production on that basis.

The installed `%APPDATA%\pyRevit-Master\pyrevitlib\pyrevit\revit\events.py` lines 259–260 explicitly guard `execute_in_revit_context` with `if not compat.IRONPY: PyRevitCPythonNotSupported(...)`. Upstream source likewise initializes the helper's `ExternalEvent` handler for IronPython, not for this CPython extension. There is **no proven supported, installed CPython-safe, response-bearing Revit UI dispatcher** that can be reused within the approved E-PY-5B bounded Python-only scope. Recreating native dispatch in Python.NET, switching engines, modifying pyRevit core, or adding a new C# helper under the pyRevit host is outside that scope.

This is a **decisive architectural rejection of `PYREVIT_SEPARATE`** under the approved criteria, not a general claim that CPython could never interoperate with Revit API.

## Evidence inventory / disposition

| Gate | Result | Evidence / reason |
|---|---|---|
| E-PY-1 — Reversible single-owner host baseline | **OBSERVED PASS (single run)** | Windows Revit 2024 host inspected; legacy native `RevitMCPBridge.addin` reversibly disabled as `.e-py-disabled`; installed pyRevit loader manifest and DLL validated; extension startup/bridge hashes matched; port 8765 initially free |
| E-PY-2 — Full bridge consumer fixtures | **DEFERRED TO P1B NATIVE CONTRACT WORK** | Consumer `runtimes/Revit-mcp/connection/bridge.py` remains authoritative; full route/method/request/response/error conformance was *not* completed during E-PY, and is required before native acceptance |
| E-PY-3 — 10 cold starts | **NOT_RUN — HUMAN_APPROVED_EARLY_TERMINATION** | One real startup produced `startup_begin`, `startup_complete`, `running:true`, `port:8765`; logs also showed `revit_available:true` after correcting invalid `Autodesk.Revit.Creation.XYZ` import. A single success is **not** a 10-cycle lifecycle PASS |
| E-PY-4A — Multi-model non-disruptive baseline | **NOT_RUN — HUMAN_APPROVED_EARLY_TERMINATION** | Not needed to choose unified-native once the mandatory CPython dispatch safety gate was rejected |
| E-PY-5A — Exact runtime dispatch feasibility | **PYREVIT_DISPATCH_UNAVAILABLE (decisive)** | `docs/evidence/E-PY-5A-cpython-dispatch-feasibility.md`; installed `events.py` `compat.IRONPY` guard; no qualifying safe dispatcher proven |
| E-PY-5B — Python-only remediation | **NOT_APPLICABLE_AFTER_DECISIVE_FAIL** | Required reusable CPython dispatcher absent; no unapproved Python.NET/C# workaround attempted |
| E-PY-6 — pyRevit route tests + concurrency | **NOT_APPLICABLE_AFTER_DECISIVE_FAIL** | No unsafe live HTTP requests performed; native P1B must independently prove all-route and multi-request parity |
| E-PY-7 — Live pyRevit mutation/readback/cleanup | **NOT_APPLICABLE_AFTER_DECISIVE_FAIL** | No model was mutated by the unsafe bridge |
| E-PY-8 — `@rg` through pyRevit bridge | **NOT_APPLICABLE_AFTER_DECISIVE_FAIL** | Intentionally not invoked while HTTP requests were unsafe |
| E-PY-5C — Sleep/resume and force-close tests | **NOT_APPLICABLE_AFTER_DECISIVE_FAIL** | Not performed; prior Human approvals never granted for these operations and are not implied by the architecture decision |
| E-PY-9 — Host choice | **UNIFIED_NATIVE selected** | User approved early stop; the mandatory pyRevit CPython dispatch criterion failed |

CI `37718398523` was **PASS on Node 20 and Node 24** at evidence commit `5977f4f20da5cfc559243fc9a7384cb539488da4`. This was an offline/static suite only; it does **not** constitute real-host safety or functionality certification.

## Native implementation direction (a separate linked P1B Job)

Build **one native RevitGPT add-in** that owns the dockable WebView2 panel, the HTTP bridge on loopback `127.0.0.1:8765`, and **all** Revit API entry via a proper C# `IExternalEventHandler` UI-context dispatcher. The service must automatically start and recover through the panel without a Start Bridge button. Maintain the approved user experience: one primary bound Revit model per session; switching tabs/views must not silently rebind; show mismatch and expose `Lease + Bind Current`; retain a `Refresh` action. Prefer one representative view tab per model where safely allowed by the UX design.

**Do not activate existing `runtimes/Revit-mcp/bridge/standalone_addin/StartBridgeCommand.cs` unchanged.** Source review revealed an old manually-started ribbon command; `RequestHandler.ProcessRequest` performs Revit-bearing reads from HTTP worker tasks, and a single shared `_pendingMutateAction/_pendingResult/_pendingCompleted` slot is exposed to concurrent writes. Existing `ExternalEvent.Create` usage **does not make this implementation safe**. Treat it as legacy/reference code to be replaced/rewritten under a reviewed P1B Job.

Native safety/acceptance checks required:

1. One bridge owner; check current process/port and existing pyRevit/native manifests before install or activation. Disable pyRevit bridge auto-start **only after** Revit is closed and the new host is ready for a controlled switch; preserve rollback. Never kill unknown listeners or processes.
2. Nonblocking `OnStartup`/initialization; no waiting synchronously in an Autodesk callback on its own `ExternalEvent`.
3. Every Revit-API-bearing read **and write** executes in valid Revit UI/API context; `/health` must not mask an unready dispatcher.
4. Per-request immutable ID/completion; bounded queues/timeouts/cancellation, single-flight scheduler with checked `ExternalEvent.Raise` result, and no lost wakeup on the drain/exit race. Safe shutdown and pending request handling.
5. Exact client contract parity from `connection/bridge.py`: every route, HTTP method, minimal payload, response shape and representative error, including annotations/mutations. Use positive + negative controls and independent Reviewer test-script inspection to avoid false-green CI.
6. Real disposable-model read → write → readback → delete/revert → verify absent/restored; `@rg` end-to-end, multi-model binding mismatch and recovery; explicit Human approval immediately before any disruptive sleep/crash test.

## Safety/current workstation state

The user confirmed Revit is **closed** before this decision. This is not a guarantee of future process state. The pyRevit extension and reversible `.e-py-disabled` native manifest were left unchanged; **no manifest switch, package installation, remote action on Revit, or live HTTP/API call was performed** for this decision. Before any later native install/replacement, repeat process and port inspection on the workstation.

**Decision is fixed for this E-PY evidence set:** `UNIFIED_NATIVE`. Reconsideration would require a new reviewed plan and new exact-installed-runtime CPython-safe dispatch evidence, not rerunning the skipped lifecycle checks.
