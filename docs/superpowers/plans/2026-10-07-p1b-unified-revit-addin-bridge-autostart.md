# P1B Unified Revit Add-in + Bridge Auto-Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one RevitGPT Revit add-in that automatically starts a thread-safe native bridge, exposes the ChatGPT WebView only after bridge readiness, and makes the normal flow “open Revit -> type `@rg` -> work.”

**Architecture:** A single `RevitGPT.Addin.dll` owns the Revit application lifecycle, DockablePane, WebView2 host, native HTTP bridge, readiness state, and UI-thread dispatcher. The local RevitGPT control plane continues to own the lazy Python MCP process; every Revit API request from the bridge is serialized through `ExternalEvent` with a per-request completion object. Auto-start is the required first implementation; a user-visible `Refresh` recovery path is added only if real-host evidence proves it is needed.

**Tech Stack:** Revit 2024 API, .NET Framework 4.8, C#, WPF DockablePane, Microsoft WebView2 `1.0.2420.47`, `HttpListener`, `ExternalEvent`, `ConcurrentQueue<T>`, Newtonsoft.Json, PowerShell, Python `unittest`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-07-unified-revit-addin-bridge-autostart-design.md`

## Global Constraints

- Implementation source of truth remains `work/J-AFC4-p1-revit-mcp-bootstrap`; do not create another long-lived implementation branch.
- P1B targets Revit 2024 / `net48`; multi-version packaging is outside this phase.
- Production target is one `RevitGPT.addin` registration and one RevitGPT add-in package; the old standalone `RevitMCPBridge` add-in is not a required second host.
- Native bridge endpoint remains `http://127.0.0.1:8765`.
- Bridge is application-scoped: pane hide/show and WebView recreation must not stop it.
- Full Python Revit MCP remains lazy and owned by the RevitGPT local runtime; the add-in does not spawn or own it.
- Every Revit API read and write runs on the Revit UI thread through the dispatcher; no Revit API access from HTTP worker threads.
- Do not use the old singleton `_pendingMutateAction/_pendingResult/_pendingCompleted` pattern and do not use `System.Windows.Forms.Application.DoEvents()`.
- Preserve bridge API compatibility with `runtimes/Revit-mcp/connection/bridge.py`; existing native-only routes may remain for backward compatibility.
- DockablePane registration happens in `IExternalApplication.OnStartup`; bridge initialization is deferred to `ControlledApplication.ApplicationInitialized`, where a `UIApplication` can be constructed from the event sender's Revit `Application`.
- WebView2 uses a persistent profile under `%LOCALAPPDATA%\RevitGPT\webview\revit` and navigates only to `https://chatgpt.com/` after bridge readiness.
- P1B does not implement final model authority, automatic model rebinding, or final `Lease + Bind Current`; those remain downstream.
- `Refresh` is not implemented merely for convenience. First collect AUTO evidence; add HYBRID recovery only when the evidence rule in the spec is met.

## Review Focus

1. **Revit starts with no active RVT document:** bridge must still reach infrastructure READY using a non-destructive UIApplication probe; absence of `ActiveUIDocument` must not be treated as bridge failure. Pinned by Task 4 host/static tests.
2. **Multiple HTTP requests arrive together:** each request must complete with its own result, timeout, or cancellation; no cross-request overwrite. Pinned by Task 2 concurrency contract and Task 7 live concurrency probe.
3. **Port 8765 is already owned:** do not kill an unknown process or silently start a second listener; emit a deterministic ownership/readiness failure and let evidence determine recovery. Pinned by Tasks 4 and 7.
4. **Pane/WebView is hidden, recreated, or crashes:** bridge remains READY and a recreated WebView can reuse the persistent profile. Pinned by Tasks 5 and 7.
5. **Revit shuts down and immediately relaunches:** listener is closed cleanly, events are unsubscribed, and the next Revit process can acquire port 8765 without manual cleanup. Pinned by Tasks 4, 6, and 7.

---

## File Structure Locked by This Plan

### New unified add-in

```text
addins/revitgpt-revit/
  RevitGPT.Addin.csproj
  App.cs
  RevitGptHost.cs
  Infrastructure/
    AddinLog.cs
  Bridge/
    BridgePhase.cs
    BridgeReadinessController.cs
    BridgeRequest.cs
    BridgeRouteCatalog.cs
    BridgeHostService.cs
    RevitRequestDispatcher.cs
    BridgeRequestRouter.cs
    RevitReadEndpoints.cs
    RevitMutationEndpoints.cs
    RevitAnnotationEndpoints.cs
  UI/
    ChatPane.xaml
    ChatPane.xaml.cs
    ChatPaneProvider.cs
    ChatPaneCreator.cs
    WebViewProfile.cs
```

### New/changed verification and packaging

```text
runtimes/Revit-mcp/tests/test_unified_addin_contract.py   # new
scripts/build-revitgpt-addin.ps1                         # new
scripts/install-revitgpt-addin.ps1                       # new
scripts/check-unified-revit-addin.ps1                    # new
scripts/capture-revit-addin-autostart.ps1                # new
scripts/install-revit-bridge-addin.ps1                   # compatibility wrapper
scripts/check-revit-bridge-host.ps1                      # unified host detection
scripts/diagnose-revit-bridge.ps1                        # unified lifecycle diagnostics
setup.bat
run.bat
doctor.bat
.github/workflows/p1-revit-mcp-bootstrap.yml
docs/evidence/P1B-revit-addin-autostart-result.md
docs/roadmap/DETAIL_EXECUTION_PLAN.md
```

The old `runtimes/Revit-mcp/bridge/standalone_addin/` and pyRevit bridge remain reference/fallback source during P1B implementation. Do not delete them until the unified add-in passes the real-host gate.

---

### Task 1: Establish the unified add-in shell and source-level contract

**Files:**
- Create: `runtimes/Revit-mcp/tests/test_unified_addin_contract.py`
- Create: `addins/revitgpt-revit/RevitGPT.Addin.csproj`
- Create: `addins/revitgpt-revit/App.cs`
- Create: `addins/revitgpt-revit/RevitGptHost.cs`
- Create: `addins/revitgpt-revit/UI/ChatPaneProvider.cs`
- Create: `addins/revitgpt-revit/UI/ChatPaneCreator.cs`
- Create: `addins/revitgpt-revit/UI/ChatPane.xaml`
- Create: `addins/revitgpt-revit/UI/ChatPane.xaml.cs`
- Create: `addins/revitgpt-revit/UI/WebViewProfile.cs`
- Create: `scripts/check-unified-revit-addin.ps1`

**Interfaces:**
- Produces: `RevitGptApplication : IExternalApplication`.
- Produces: `RevitGptHost.RegisterPane(UIControlledApplication application)`.
- Produces: `RevitGptHost.Start(UIApplication application)` and `RevitGptHost.Stop()`.
- Produces: `ChatPaneProvider : IDockablePaneProvider` using an `IFrameworkElementCreator` so Revit can recreate browser-backed pane content without reusing a stale WebView2 control.
- Produces: `ChatPaneCreator : IFrameworkElementCreator` whose `CreateFrameworkElement()` returns a fresh `ChatPane` bound to the application-scoped readiness controller.
- Produces: `WebViewProfile.UserDataPath` and `WebViewProfile.StartupUrl`.
- Later tasks fill bridge startup/readiness inside `RevitGptHost`; this task only establishes the compile/source boundary and pane ownership.

- [ ] **Step 1: Write the failing source contract tests**

Add tests named:
- `test_unified_addin_project_targets_net48_wpf_and_webview2`
- `test_application_registers_revitgpt_dockable_pane`
- `test_dockable_pane_uses_framework_element_creator_for_webview`
- `test_webview_profile_is_revitgpt_localappdata_and_chatgpt_https`
- `test_unified_addin_does_not_define_manual_start_bridge_command`

Assertions must require:
- `TargetFramework` = `net48`;
- `UseWPF` = `true`;
- `Microsoft.Web.WebView2` = `1.0.2420.47`;
- namespace/class `RevitGPT.Addin.RevitGptApplication`;
- `RegisterDockablePane`;
- `FrameworkElementCreator` / `IFrameworkElementCreator` is used instead of caching a single WebView-backed framework element;
- no `StartBridgeCommand : IExternalCommand`;
- WebView profile contains `RevitGPT\webview\revit` and `https://chatgpt.com/`.

- [ ] **Step 2: Run the test and verify it fails because the unified add-in tree does not exist**

Run:

```powershell
pushd runtimes\Revit-mcp
python -m unittest tests.test_unified_addin_contract -v
popd
```

Expected: FAIL on missing `addins/revitgpt-revit` artifacts.

- [ ] **Step 3: Create `RevitGPT.Addin.csproj`**

Use:
- `TargetFramework=net48`;
- `UseWPF=true`;
- `PlatformTarget=x64`;
- Revit references from `$(RevitInstallDir)`;
- WebView2 package `1.0.2420.47`;
- `Microsoft.NETFramework.ReferenceAssemblies.net48` as private build support if needed by CI/source tooling;
- assembly name `RevitGPT.Addin`;
- root namespace `RevitGPT.Addin`.

Do not add final add-in-control/pair dependencies in P1B.

- [ ] **Step 4: Create the application and DockablePane shell**

`RevitGptApplication.OnStartup(UIControlledApplication)` calls only:
- create/retain `RevitGptHost`;
- `RegisterPane(application)`;
- subscribe application lifecycle needed by later tasks.

`ChatPaneProvider.SetupDockablePane(DockablePaneProviderData)` supplies the WPF pane and a right-docked initial state.

- [ ] **Step 5: Create the persistent WebView profile helper and initial pane layout**

`WebViewProfile` exposes exact static properties:
- `string UserDataPath`
- `string StartupUrl`

`ChatPane.xaml` contains:
- bridge status/connecting layer;
- WebView2 control;
- no final binding/mismatch UI from P2B.

Do not navigate WebView yet; Task 5 wires readiness.

- [ ] **Step 6: Run source contract tests and PowerShell contract check**

Run:

```powershell
pushd runtimes\Revit-mcp
python -m unittest tests.test_unified_addin_contract -v
popd
.\scripts\check-unified-revit-addin.ps1
```

Expected: Task 1 tests PASS; later-task tests may remain skipped/not yet defined.

- [ ] **Step 7: Commit**

```bash
git add addins/revitgpt-revit runtimes/Revit-mcp/tests/test_unified_addin_contract.py scripts/check-unified-revit-addin.ps1
git commit -m "J-8A2C P1B: add unified Revit add-in shell"
```

---

### Task 2: Replace singleton mutation state with a queued UI-thread dispatcher

**Files:**
- Create: `addins/revitgpt-revit/Bridge/BridgeRequest.cs`
- Create: `addins/revitgpt-revit/Bridge/RevitRequestDispatcher.cs`
- Modify: `runtimes/Revit-mcp/tests/test_unified_addin_contract.py`

**Interfaces:**
- Produces: `BridgeRequest(string path, string method, string body)` with request-specific `TaskCompletionSource<string>`.
- Produces: `RevitRequestDispatcher : IExternalEventHandler`.
- Produces: `Task<string> EnqueueAsync(string path, string method, string body, TimeSpan timeout, CancellationToken cancellationToken)`.
- Consumes in Task 3: `BridgeRequestRouter.Execute(UIApplication application, BridgeRequest request) -> string`.

- [ ] **Step 1: Add failing dispatcher contract tests**

Add:
- `test_dispatcher_uses_concurrent_queue_and_per_request_completion`
- `test_dispatcher_has_no_singleton_pending_mutation_fields`
- `test_dispatcher_has_no_application_doevents`
- `test_dispatcher_routes_every_request_from_external_event_execute`

Require:
- `ConcurrentQueue<BridgeRequest>`;
- `TaskCompletionSource<string>` belongs to each request;
- no `_pendingMutateAction`, `_pendingResult`, `_pendingCompleted`;
- no `Application.DoEvents`;
- `Execute(UIApplication app)` drains queued requests and calls `BridgeRequestRouter.Execute`.

- [ ] **Step 2: Run the new tests and verify failure**

Run the specific unittest class/methods.

Expected: FAIL because dispatcher files do not exist.

- [ ] **Step 3: Implement `BridgeRequest`**

Exact data:
- `Path`
- `Method`
- `Body`
- `TaskCompletionSource<string> Completion`
- cancellation/expired state sufficient for the UI thread to skip a request whose HTTP caller already timed out.

Use `TaskCreationOptions.RunContinuationsAsynchronously`.

- [ ] **Step 4: Implement `RevitRequestDispatcher`**

Requirements:
- queue is `ConcurrentQueue<BridgeRequest>`;
- `ExternalEvent` is created only from a valid Revit UI context;
- `EnqueueAsync` enqueues then raises the event;
- `Execute` serially drains queued requests on the Revit UI thread;
- each request completes independently;
- timeout/cancellation completes only that request;
- one exception becomes that request's JSON error and does not stop draining the queue.

- [ ] **Step 5: Run tests**

Expected: dispatcher contract tests PASS.

- [ ] **Step 6: Commit**

```bash
git add addins/revitgpt-revit/Bridge/BridgeRequest.cs addins/revitgpt-revit/Bridge/RevitRequestDispatcher.cs runtimes/Revit-mcp/tests/test_unified_addin_contract.py
git commit -m "J-8A2C P1B: serialize bridge requests on Revit UI thread"
```

---

### Task 3: Build one complete bridge route contract and migrate endpoint implementations

**Files:**
- Create: `addins/revitgpt-revit/Bridge/BridgeRouteCatalog.cs`
- Create: `addins/revitgpt-revit/Bridge/BridgeRequestRouter.cs`
- Create: `addins/revitgpt-revit/Bridge/RevitReadEndpoints.cs`
- Create: `addins/revitgpt-revit/Bridge/RevitMutationEndpoints.cs`
- Create: `addins/revitgpt-revit/Bridge/RevitAnnotationEndpoints.cs`
- Modify: `runtimes/Revit-mcp/tests/test_unified_addin_contract.py`
- Reference only: `runtimes/Revit-mcp/bridge/standalone_addin/StartBridgeCommand.cs`
- Reference only: `runtimes/Revit-mcp/bridge/pyrevit_extension/RevitMCPBridge.extension/RevitMCPBridge.bundle/Contents/revit_mcp_bridge.py`
- Contract source: `runtimes/Revit-mcp/connection/bridge.py`

**Interfaces:**
- Produces: `BridgeRouteCatalog.IsKnown(string path) -> bool`.
- Produces: `BridgeRequestRouter.Execute(UIApplication application, BridgeRequest request) -> string`.
- Produces domain handlers that execute only when called from `RevitRequestDispatcher.Execute`.
- Consumes: all requests from Task 2 dispatcher.

- [ ] **Step 1: Add a failing route-parity test**

Parse every literal path passed to `_send_request(...)` in `connection/bridge.py` and assert each exists in `BridgeRouteCatalog.cs`.

The required Python-client routes currently include:

```text
/health
/document/active
/documents
/views
/levels
/elements
/element
/element/connectors
/families
/family/types
/system/types
/place
/create/duct
/create/pipe
/parameter/set
/delete
/move
/annotations
/annotation/text
/annotation/tag
/annotation/dimension
/annotation/spot_elevation
/annotation/detail_line
```

Also preserve native-only legacy reads if they remain useful:
`/view/active`, `/elements/in_view`, `/tags/in_view`.

- [ ] **Step 2: Run parity test and verify it fails**

Expected: FAIL because unified route catalog is absent.

- [ ] **Step 3: Implement `BridgeRouteCatalog` and router**

Unknown routes return the existing JSON 404 shape.

All known routes enter the router **after** the ExternalEvent dispatcher; the router never performs Revit API work from an HTTP worker.

- [ ] **Step 4: Port existing native C# endpoint behavior into focused domain files**

Use `StartBridgeCommand.cs` as the first source for endpoints it already implements.

Preserve response shapes consumed by `connection/bridge.py`; do not redesign tool schemas in P1B.

- [ ] **Step 5: Port missing route behavior from the pyRevit bridge reference**

The current native C# source is missing at least:
- `/element/connectors`
- `/system/types`
- `/annotation/text`
- `/annotation/dimension`
- `/annotation/spot_elevation`
- `/annotation/detail_line`

Use the pyRevit bridge only as behavior/API reference and implement the equivalent Revit API calls in C# on the dispatcher/UI thread.

- [ ] **Step 6: Run route parity plus existing Python bridge unit tests**

Run:

```powershell
pushd runtimes\Revit-mcp
python -m unittest tests.test_unified_addin_contract -v
python -m unittest discover -s tests -p "test_*.py"
popd
```

Expected: all source contract and existing mocked bridge tests PASS.

- [ ] **Step 7: Commit**

```bash
git add addins/revitgpt-revit/Bridge runtimes/Revit-mcp/tests/test_unified_addin_contract.py
git commit -m "J-8A2C P1B: unify native bridge endpoint contract"
```

---

### Task 4: Auto-start the bridge safely from the Revit application lifecycle

**Files:**
- Create: `addins/revitgpt-revit/Bridge/BridgePhase.cs`
- Create: `addins/revitgpt-revit/Bridge/BridgeHostService.cs`
- Create: `addins/revitgpt-revit/Bridge/BridgeReadinessController.cs`
- Create: `addins/revitgpt-revit/Infrastructure/AddinLog.cs`
- Modify: `addins/revitgpt-revit/App.cs`
- Modify: `addins/revitgpt-revit/RevitGptHost.cs`
- Modify: `runtimes/Revit-mcp/tests/test_unified_addin_contract.py`

**Interfaces:**
- Produces enum: `BridgePhase { Stopped, Starting, Ready, Failed, Stopping }`.
- Produces: `BridgeHostService.Start(UIApplication application)`, `Task<BridgeProbeResult> ProbeAsync(...)`, `Stop()`, `IsRunning`.
- Produces: `BridgeReadinessController.Start(UIApplication application)`, `Retry()` only as an internal API, `Stop()`, `Phase`, `LastError`, `StateChanged`.
- `RevitGptHost.Start(UIApplication)` delegates to readiness controller and shows the registered pane.
- `RevitGptApplication` subscribes/unsubscribes `ControlledApplication.ApplicationInitialized`.

- [ ] **Step 1: Add failing lifecycle tests**

Add:
- `test_application_initialized_constructs_uiapplication_and_starts_host`
- `test_onshutdown_stops_host_and_unsubscribes_events`
- `test_bridge_host_binds_only_loopback_8765`
- `test_bridge_startup_probe_does_not_require_active_document`
- `test_bridge_host_does_not_kill_unknown_port_owner`

The test should require the startup handler to use the `ApplicationInitialized` event sender `Autodesk.Revit.ApplicationServices.Application` to construct `new UIApplication(revitApplication)`.

- [ ] **Step 2: Run lifecycle tests and verify failure**

Expected: FAIL because lifecycle service is absent.

- [ ] **Step 3: Implement `BridgeHostService`**

Responsibilities only:
- construct dispatcher/ExternalEvent in valid UI context;
- own `HttpListener` at `127.0.0.1:8765`;
- accept HTTP requests on background threads;
- forward every Revit-bearing request to dispatcher;
- return HTTP JSON responses;
- stop/close listener idempotently.

For port collision: fail with a stable error such as `BRIDGE_PORT_IN_USE`; do not terminate the owning process.

- [ ] **Step 4: Implement readiness probe and state controller**

The startup probe must prove:
- listener is alive;
- dispatcher can execute a non-destructive UIApplication-level operation on the Revit UI thread.

The probe may return Revit version and whether an active document exists. `ActiveUIDocument == null` is a valid probe result, not a bridge failure.

State transitions:
`Stopped -> Starting -> Ready` or `Stopped -> Starting -> Failed`;
shutdown uses `Ready/Failed -> Stopping -> Stopped`.

- [ ] **Step 5: Wire automatic startup to `ApplicationInitialized`**

`OnStartup` registers pane and subscribes.

The `ApplicationInitialized` handler:
1. obtains the event sender as Revit `Application`;
2. constructs `UIApplication`;
3. calls `RevitGptHost.Start(uiApp)`;
4. never requires a ribbon command.

`OnShutdown` stops host, closes bridge, disposes pane-owned resources, and unsubscribes.

- [ ] **Step 6: Add NDJSON lifecycle evidence**

`AddinLog` writes under:

```text
%LOCALAPPDATA%\RevitGPT\logs\revit-addin.ndjson
```

At minimum log:
- add-in startup;
- ApplicationInitialized received;
- bridge listener start;
- dispatcher probe PASS/FAIL;
- READY/FAILED;
- shutdown/listener stop;
- port-collision error.

Do not log secrets, chat content, or model data payloads.

- [ ] **Step 7: Run tests**

Expected: lifecycle/source tests PASS.

- [ ] **Step 8: Commit**

```bash
git add addins/revitgpt-revit runtimes/Revit-mcp/tests/test_unified_addin_contract.py
git commit -m "J-8A2C P1B: auto-start Revit bridge on application initialization"
```

---

### Task 5: Gate WebView availability on bridge readiness without coupling bridge lifetime to the pane

**Files:**
- Modify: `addins/revitgpt-revit/UI/ChatPane.xaml`
- Modify: `addins/revitgpt-revit/UI/ChatPane.xaml.cs`
- Modify: `addins/revitgpt-revit/UI/ChatPaneProvider.cs`
- Modify: `addins/revitgpt-revit/RevitGptHost.cs`
- Modify: `runtimes/Revit-mcp/tests/test_unified_addin_contract.py`

**Interfaces:**
- `ChatPane` consumes `BridgeReadinessController`.
- `ChatPane.InitializeBrowserAsync()` initializes the persistent WebView2 environment only after `BridgePhase.Ready`.
- Pane disposal/recreation never calls `BridgeHostService.Stop()`.

- [ ] **Step 1: Add failing WebView lifecycle tests**

Add:
- `test_webview_navigation_requires_bridge_ready`
- `test_pane_dispose_does_not_stop_bridge`
- `test_webview_uses_persistent_profile`
- `test_p1b_has_no_pair_or_model_authority_implementation`

Require:
- `CoreWebView2Environment.CreateAsync(..., WebViewProfile.UserDataPath)`;
- navigation to `WebViewProfile.StartupUrl` only from READY handling;
- no call from `ChatPane.Dispose` to bridge stop;
- no `Lease + Bind Current`, model authority, or add-in pair protocol implementation in P1B UI.

- [ ] **Step 2: Run tests and verify failure**

Expected: FAIL on readiness wiring.

- [ ] **Step 3: Implement READY-gated WebView initialization**

Initial pane state shows a small neutral “Connecting RevitGPT…” surface while auto-start is in progress.

On READY:
- initialize WebView2 once;
- set zoom/profile behavior consistent with CadGPT where host-neutral;
- navigate to `https://chatgpt.com/`;
- expose chat.

On FAILED in the initial AUTO implementation:
- keep chat non-interactive;
- show concise startup failure text;
- do **not** yet add `Refresh`; Task 7 evidence decides whether Task 8 is needed.

- [ ] **Step 4: Preserve bridge across pane and WebView lifecycle**

Pane hide/show, WebView renderer failure, and WebView recreation must not stop/recreate the native bridge.

WebView recovery may recreate only browser resources using the same profile.

- [ ] **Step 5: Run tests**

Expected: WebView gating/lifecycle tests PASS.

- [ ] **Step 6: Commit**

```bash
git add addins/revitgpt-revit/UI addins/revitgpt-revit/RevitGptHost.cs runtimes/Revit-mcp/tests/test_unified_addin_contract.py
git commit -m "J-8A2C P1B: gate Revit WebView on bridge readiness"
```

---

### Task 6: Replace the standalone bridge installer with unified add-in packaging and diagnostics

**Files:**
- Create: `scripts/build-revitgpt-addin.ps1`
- Create: `scripts/install-revitgpt-addin.ps1`
- Modify: `scripts/install-revit-bridge-addin.ps1`
- Modify: `scripts/check-revit-bridge-host.ps1`
- Modify: `scripts/diagnose-revit-bridge.ps1`
- Modify: `scripts/check-unified-revit-addin.ps1`
- Modify: `setup.bat`
- Modify: `run.bat`
- Modify: `doctor.bat`
- Modify: `.github/workflows/p1-revit-mcp-bootstrap.yml`
- Modify: `runtimes/Revit-mcp/tests/test_unified_addin_contract.py`

**Interfaces:**
- `build-revitgpt-addin.ps1 -RevitYear 2024` probes the real Revit install and builds the add-in.
- `install-revitgpt-addin.ps1 -RevitYear 2024` installs the built output and creates `RevitGPT.addin`.
- Legacy `install-revit-bridge-addin.ps1` becomes a compatibility wrapper to the unified installer.
- Doctor recognizes `RevitGPT.Addin.RevitGptApplication` as the native host.

- [ ] **Step 1: Add failing packaging tests**

Require:
- installer writes `RevitGPT.addin`;
- `FullClassName` is `RevitGPT.Addin.RevitGptApplication`;
- destination directory is `%APPDATA%\Autodesk\Revit\Addins\2024\RevitGPT`;
- installer copies the complete build output needed by WebView2, not only the main DLL;
- installer removes only the known legacy `RevitMCPBridge.addin` registration during migration;
- no final setup text tells the user to click “Start Bridge”;
- doctor says Revit ON + bridge unavailable is an auto-start failure, not an instruction to click a ribbon command.

- [ ] **Step 2: Run tests and verify failure**

Expected: FAIL against the existing standalone installer/setup text.

- [ ] **Step 3: Implement real-host build script**

The script:
- validates `C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll` and `RevitAPIUI.dll`;
- runs `dotnet build addins/revitgpt-revit/RevitGPT.Addin.csproj -c Release -p:RevitInstallDir=...`;
- fails on compile error;
- identifies the Release output directory for installer use.

No pinned CAD-Agent binary fallback is allowed for the unified add-in.

- [ ] **Step 4: Implement unified installer and compatibility wrapper**

Installer:
- requires successful source build;
- copies RevitGPT add-in output/dependencies;
- writes the single application manifest;
- removes the exact legacy manifest to prevent dual port ownership;
- if Revit is running, asks for a full Revit restart rather than trying to hot-replace loaded DLLs.

The old installer script delegates to the new installer so existing `run.bat install-bridge` callers do not break.

- [ ] **Step 5: Update host detection, doctor, diagnostics, and setup copy**

Normal instructions become:

```text
Restart/open Revit.
Open the RevitGPT panel if needed.
Type @rg.
```

Diagnostics separately report:
- Revit process;
- unified add-in manifest/assembly;
- port 8765 owner;
- bridge `/health`;
- last `revit-addin.ndjson` lines;
- optional legacy pyRevit presence as fallback/reference only.

- [ ] **Step 6: Update CI source-contract coverage**

Replace the old CAD-Agent-pattern assertion with `check-unified-revit-addin.ps1`.

CI remains host-independent; the real Revit build is a local-host gate because GitHub Actions does not ship Revit API assemblies.

- [ ] **Step 7: Run all host-independent verification**

```powershell
.\scripts\check-node-syntax.ps1
.\scripts\check-powershell-syntax.ps1
.\scripts\check-unified-revit-addin.ps1
pushd runtimes\Revit-mcp
python -m unittest discover -s tests -p "test_*.py"
popd
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts setup.bat run.bat doctor.bat .github/workflows/p1-revit-mcp-bootstrap.yml runtimes/Revit-mcp/tests/test_unified_addin_contract.py
git commit -m "J-8A2C P1B: install unified RevitGPT add-in"
```

---

### Task 7: Prove AUTO on a real Revit host and choose the final UX mode from evidence

**Files:**
- Create: `scripts/capture-revit-addin-autostart.ps1`
- Create: `docs/evidence/P1B-revit-addin-autostart-result.md`

**Interfaces:**
- Evidence script reads only local runtime/manifest/port/health/log state and prints a deterministic PASS/FAIL matrix.
- Evidence result ends with exactly one selection: `AUTO`, `HYBRID`, or `REFRESH-GATED`.

- [ ] **Step 1: Write the evidence capture script before running the host test**

It must capture:
- Revit PID/version;
- unified manifest and assembly path;
- port 8765 owner PID;
- `/health` response;
- latest add-in startup/readiness/shutdown log events;
- whether active document exists;
- timestamped result.

It must not infer READY only from “port open”; dispatcher probe evidence is required.

- [ ] **Step 2: Build/install on the actual Revit 2024 workstation**

Run:

```powershell
.\scripts\build-revitgpt-addin.ps1 -RevitYear 2024
.\scripts\install-revitgpt-addin.ps1 -RevitYear 2024
```

Expected: source build PASS; exactly one RevitGPT manifest installed.

- [ ] **Step 3: Cold-start Revit and verify zero manual bridge actions**

Acceptance:
- do not click any Start Bridge/Start MCP control;
- bridge reaches READY automatically;
- ChatGPT WebView becomes available;
- typing `@rg` can activate the existing lazy Python MCP path.

- [ ] **Step 4: Run the AUTO lifecycle matrix**

Execute and record:
1. cold Revit launch with project;
2. cold Revit launch without an immediately active project if host flow permits;
3. open second model;
4. switch views/models repeatedly;
5. hide/show RevitGPT pane;
6. force/recreate WebView process;
7. concurrent bridge reads (at least 10 parallel non-mutating requests);
8. Windows sleep/resume;
9. close Revit;
10. immediately relaunch Revit;
11. simulate/observe port 8765 collision without killing the owner;
12. repeat full launch/shutdown cycle at least 5 times.

Expected for AUTO: no manual bridge action needed in normal/relaunch cycles, no request cross-talk, no stale listener after shutdown.

- [ ] **Step 5: Run the minimum end-to-end MCP capability smoke**

Through `@rg`:
- list/open-document information;
- one harmless element/view read.

Do not turn this P1B gate into E1's full write/readback/delete acceptance; E1 remains the next phase.

- [ ] **Step 6: Record the mode decision**

Select:
- `AUTO` if the normal/restart matrix is reliable and no user recovery action is justified;
- `HYBRID` only if AUTO normally works but a reproducible lifecycle condition is safely repairable with in-panel retry;
- `REFRESH-GATED` only if automatic initialization remains inherently unsafe/unreliable after bounded fixes.

If AUTO passes, mark Task 8 **NOT REQUIRED**.

- [ ] **Step 7: Commit evidence**

```bash
git add scripts/capture-revit-addin-autostart.ps1 docs/evidence/P1B-revit-addin-autostart-result.md
git commit -m "J-8A2C P1B: record Revit bridge autostart evidence"
```

---

### Task 8: Add the `Refresh` recovery gate only if Task 7 selects HYBRID or REFRESH-GATED

**Condition:** Skip this entire task when Task 7 selects AUTO.

**Files:**
- Modify: `addins/revitgpt-revit/UI/ChatPane.xaml`
- Modify: `addins/revitgpt-revit/UI/ChatPane.xaml.cs`
- Modify: `addins/revitgpt-revit/Bridge/BridgeReadinessController.cs`
- Modify: `runtimes/Revit-mcp/tests/test_unified_addin_contract.py`
- Modify: `docs/evidence/P1B-revit-addin-autostart-result.md`

**Interfaces:**
- `BridgeReadinessController.RetryAsync(CancellationToken) -> Task<bool>`.
- `ChatPane` exposes exactly one user recovery action labeled `Refresh`.
- Chat surface remains non-interactive until READY.

- [ ] **Step 1: Add failing recovery tests tied to the exact Task 7 finding**

Tests must reproduce the selected host failure class at the controller/state level.

Also require:
- button text `Refresh`;
- no `Start Bridge` or `Start MCP` user copy;
- Retry never kills an unknown port owner;
- success transitions FAILED/RECOVERING -> READY and reveals existing WebView/session;
- failure keeps chat gated and updates concise diagnostics.

- [ ] **Step 2: Run tests and verify failure**

Expected: FAIL because recovery UI/API is not yet implemented.

- [ ] **Step 3: Implement only the recovery required by evidence**

Do not add speculative recovery branches.

For HYBRID:
- auto-start remains primary;
- `Refresh` appears only after FAILED;
- retry reuses/recreates only bridge resources that are safe to recreate.

For REFRESH-GATED:
- document the Revit lifecycle reason that makes user action necessary;
- startup remains gated until `Refresh` succeeds.

- [ ] **Step 4: Re-run the failed host scenario and full normal AUTO path**

Ensure recovery does not degrade healthy startup.

- [ ] **Step 5: Update evidence and commit**

```bash
git add addins/revitgpt-revit runtimes/Revit-mcp/tests/test_unified_addin_contract.py docs/evidence/P1B-revit-addin-autostart-result.md
git commit -m "J-8A2C P1B: add evidence-driven Revit bridge recovery"
```

---

### Task 9: Close P1B, update the durable execution chain, and hand off to E1

**Files:**
- Modify: `docs/roadmap/DETAIL_EXECUTION_PLAN.md`
- Modify: `docs/roadmap/RG-CG-ADDIN-PLAN.md`
- Modify: `README.md` only if it still instructs manual Start Bridge
- Verify: `docs/evidence/P1B-revit-addin-autostart-result.md`

**Interfaces:**
- Durable causal chain becomes `P0 -> P1 -> P1B -> E1 -> E2 -> E3 -> P2A ...`.
- E1 consumes the unified native bridge and verifies real read/write/readback/delete capability.
- P2A still owns managed ChatGPT pair/session behavior; P2B still owns final model authority/rebind behavior.

- [ ] **Step 1: Add a docs contract assertion**

Extend source contract test/check script so roadmap text cannot regress to “click Start Bridge” and includes P1B before E1.

- [ ] **Step 2: Update execution plan and add-in plan**

Record:
- selected AUTO/HYBRID/REFRESH-GATED outcome;
- unified add-in path;
- old standalone add-in as legacy reference;
- P1B acceptance evidence link;
- E1 starts only after P1B evidence PASS.

Do not move P2A/P2B behavior into P1B documentation.

- [ ] **Step 3: Run complete P1B host-independent suite**

```powershell
.\scripts\check-node-syntax.ps1
.\scripts\check-powershell-syntax.ps1
.\scripts\check-unified-revit-addin.ps1
pushd runtimes\Revit-mcp
python -m unittest discover -s tests -p "test_*.py"
popd
```

Expected: PASS.

- [ ] **Step 4: Run local Revit build + doctor one final time**

```powershell
.\scripts\build-revitgpt-addin.ps1 -RevitYear 2024
.\doctor.bat
```

Expected with Revit running:
- unified add-in installed;
- bridge reachable/READY automatically;
- no manual Start Bridge guidance.

- [ ] **Step 5: Whole-branch review against the design spec**

Reviewer must explicitly check:
- no second production bridge add-in required;
- all Revit API work is dispatched to UI thread;
- endpoint parity with Python bridge client;
- AUTO evidence supports selected UX mode;
- bridge survives pane/WebView lifecycle;
- shutdown/relaunch releases port;
- no P2B model-authority scope drift.

- [ ] **Step 6: Commit P1B closure**

```bash
git add docs README.md scripts runtimes/Revit-mcp/tests/test_unified_addin_contract.py
git commit -m "J-8A2C P1B: close unified Revit add-in autostart phase"
```

- [ ] **Step 7: Handoff to E1**

E1 must now use the unified add-in path and perform the existing real capability gate:
read -> controlled disposable write -> readback -> delete -> verify absent.

No P2A work starts until E1, E2, and E3 gates pass in the durable sequence.
