# RevitGPT Bridge Hosting Decision + Docked WebView Design

Date: 2026-10-07  
Status: **REVISED DESIGN — HUMAN APPROVED DIRECTION, IMPLEMENTATION EVIDENCE REQUIRED**  
Project: RevitGPT  
Implementation source of truth: `work/J-AFC4-p1-revit-mcp-bootstrap`

## 1. Product UX contract

The target user experience is:

```text
Open Revit
  -> RevitGPT infrastructure becomes ready automatically
  -> docked ChatGPT WebView is usable
  -> user types @rg
  -> work begins
```

Normal users must not need to understand or operate bridge ports, pyRevit, Python MCP, tunnel processes, or binding plumbing.

The architecture must not be chosen before testing the bridge host that already exists.

## 2. Architecture decision gate: E-PY

Before writing a native C# bridge into the docked WebView add-in, RevitGPT must first prove whether the existing pyRevit bridge can remain a separate, invisible infrastructure add-in.

The decision rule is:

```text
E-PY — pyRevit bridge auto-start + safety + capability evidence
    |
    +-- PASS
    |    -> keep pyRevit bridge separate and invisible
    |    -> native RevitGPT add-in hosts DockablePane + WebView2 only
    |
    +-- FAIL after bounded pyRevit remediation
         -> manual recovery/start would be required
         -> build one unified RevitGPT native add-in:
              DockablePane + WebView2 + native bridge + Refresh recovery
```

The reason for this rule is product-facing:

- two add-ins are acceptable when the bridge is fully automatic and invisible;
- two add-ins are not acceptable when users must leave the RevitGPT panel to start or recover a second add-in;
- if manual recovery is necessary, both capabilities serve one product and must be presented through one RevitGPT panel.

## 3. What counts as E-PY PASS

E-PY is not a port-open test.

PASS requires all of the following:

### 3.1 Startup/lifecycle stability

The **unmodified pre-safety baseline** observes startup logs, bridge thread/listener state and port ownership only. It must not call HTTP endpoints that touch Revit API until section 3.2 is satisfied.

- pyRevit `startup.py` auto-starts the bridge without a manual ribbon action;
- repeated cold Revit launches succeed;
- launch with no active RVT is supported or the limitation is explicitly shown to be harmless;
- opening/closing/switching multiple models does not kill the bridge;
- pyRevit reload does not produce an unrecoverable duplicate/stale server;
- Windows sleep/resume does not require a manual bridge start;
- normal shutdown releases the listener;
- immediate relaunch reacquires the port cleanly;
- crash/force-close followed by relaunch recovers without manual bridge start.

### 3.2 Revit API safety

The bridge must not be accepted merely because unsupported threading happens to pass a few tests.

Current source evidence shows:

```text
pyRevit startup.py
  -> ensure_server_started()
  -> Python HTTPServer runs on a background thread
  -> request handlers call Revit API directly
```

The current pyRevit bridge source does not contain an `ExternalEvent` dispatcher.

Therefore E-PY must explicitly determine and repair the Revit API execution model before production acceptance. A bounded pyRevit hardening pass is allowed only after a feasibility check against the **exact attached pyRevit build and CPython engine**.

Because the current bridge is `#! python3`, bounded remediation may reuse only an already-shipped, supported CPython-safe UI-thread dispatch surface exposed by that installed pyRevit/Revit runtime and adapt to it with extension-local Python changes.

E-PY remediation must not:
- switch the bridge to IronPython;
- modify pyRevit core/runtime source;
- add a new compiled native helper;
- perform a broad engine migration;
- substantially rewrite the bridge to recreate native dispatch infrastructure.

If no proven reusable CPython-safe dispatcher exists in the attached runtime, E-PY records a decisive dispatch-unavailable result and selects `UNIFIED_NATIVE`.

If a supported dispatcher exists, the hardening must still preserve:
- automatic startup;
- invisible infrastructure UX;
- no manual recovery control;
- separate pyRevit bridge ownership.

If safe Revit UI-thread dispatch cannot be achieved reliably within those bounds, E-PY fails.

### 3.3 Bridge API compatibility

The selected bridge host must match the current Python consumer contract in:

`runtimes/Revit-mcp/connection/bridge.py`.

Contract verification must include:

- route;
- HTTP method;
- required/minimal request payload;
- success response shape;
- error response behavior.

String-only route presence is insufficient.

For **every** route consumed by `connection/bridge.py`, E-PY must provide executable handler/router conformance evidence. Mutating and annotation routes may use host-independent stubs/fakes for routing, validation and serialization, while at least one representative mutation also runs live in Revit. Any route that cannot be validated host-independently must receive an equivalent safe live fixture before `PYREVIT_SEPARATE` can be selected.

### 3.4 Real capability smoke

E-PY acceptance includes a disposable real-Revit round trip:

```text
read
-> controlled disposable write
-> readback
-> delete
-> verify absent
```

This is intentionally retained before E1 because bridge threading/transaction execution is exactly what E-PY is deciding.

E1 remains the deeper real-project capability checkpoint after the bridge-host architecture is selected.

## 4. E-PY test environment must have exactly one bridge owner

E-PY evidence is invalid if multiple bridge implementations compete for `127.0.0.1:8765`.

Before E-PY:

- detect native `RevitMCPBridge.addin`;
- record exact legacy manifest path/content/hash/enabled state before neutralizing it so the test setup is reversible until the architecture decision is durable;
- detect installed `RevitMCPBridge.extension` copies;
- detect the actual port owner;
- ensure only the pyRevit bridge under test can bind `8765`;
- do not kill unknown processes automatically;
- record any collision as evidence.

This avoids falsely classifying pyRevit auto-start as unstable because an older native bridge already owns the port.

## 5. PASS architecture: separate invisible pyRevit bridge + native WebView add-in

If E-PY passes:

```text
Revit
├─ pyRevit / RevitMCPBridge.extension
│    └─ startup.py
│         └─ bridge :8765
│
└─ RevitGPT.addin
     └─ DockablePane
          └─ WebView2
               └─ ChatGPT Web
```

The native RevitGPT add-in does not duplicate bridge code.

Responsibilities:

### pyRevit bridge

- auto-start;
- safe Revit UI-thread execution;
- complete Python bridge-client contract;
- lifecycle logging;
- no user-facing control in the normal product UX.

### RevitGPT native add-in

- register DockablePane;
- create/recreate browser-backed pane content safely;
- persistent WebView2 profile;
- observe bridge readiness before exposing chat;
- preserve the WebView/session shell independently from bridge internals.

If this architecture later requires a routine manual bridge-start/recovery button, it no longer satisfies the PASS architecture and must be reconsidered.

## 6. FAIL architecture: one unified native RevitGPT add-in

If E-PY remains unreliable after bounded pyRevit remediation and user intervention would be required, RevitGPT moves to one native add-in:

```text
RevitGPT.Addin.dll
├─ DockablePane + WebView2
├─ native bridge
├─ Revit UI-thread dispatcher
└─ Refresh recovery UI
```

Normal flow still attempts automatic bridge readiness.

Fallback flow:

```text
auto bridge readiness fails
  -> chat is covered/non-interactive
  -> [ Refresh ]
  -> bridge retry/recovery
  -> READY
  -> reveal existing ChatGPT WebView/session
```

The label is `Refresh`, not `Start Bridge` or `Start MCP`.

## 7. Unified native bridge concurrency contract

This section applies only if E-PY selects the unified native path.

All Revit API reads and writes must run through a Revit UI-thread dispatcher.

Required conceptual flow:

```text
HTTP request
  -> validate/parse
  -> per-request BridgeRequest
  -> ConcurrentQueue
  -> single-flight ExternalEvent scheduler
  -> Revit UI thread
  -> execute request
  -> per-request completion
  -> HTTP response
```

### 7.1 No singleton pending request state

Do not use shared fields equivalent to:

- `_pendingMutateAction`
- `_pendingResult`
- `_pendingCompleted`

Each request owns its own completion primitive.

### 7.2 No lost wakeups

The scheduler must define an atomic single-flight protocol.

At minimum:

- maintain an atomic `scheduled/draining` state;
- enqueue before signaling;
- inspect `ExternalEvent.Raise()` result;
- only `Accepted` is treated as a newly scheduled Revit event;
- requests arriving while a handler is already pending/draining must not cause duplicate unsafe scheduling;
- before `Execute()` exits, it must atomically hand off/re-signal if the queue became non-empty;
- a queued request must never be stranded because it arrived during the drain/exit boundary.

Concurrency tests must include multiple simultaneous HTTP requests and the drain/exit race.

### 7.3 No blocking Revit callback on ExternalEvent work

If startup uses `ApplicationInitialized`:

```text
ApplicationInitialized
  -> construct UIApplication / dispatcher / listener
  -> schedule readiness probe
  -> RETURN immediately
```

Forbidden inside Revit callbacks:

- `.Wait()`
- `.Result`
- `GetAwaiter().GetResult()`
- any equivalent synchronous wait for an ExternalEvent-backed task.

The readiness probe completes only after Revit regains an event-processing opportunity.

## 8. DockablePane/WebView lifecycle

The native panel should use Revit's browser-friendly framework-element recreation pattern rather than treating one WebView control as permanently reusable.

Target:

- DockablePane registered in `OnStartup`;
- browser-backed content can be recreated through `IFrameworkElementCreator`;
- WebView2 uses a persistent profile under `%LOCALAPPDATA%\RevitGPT\webview\revit`;
- startup URL is `https://chatgpt.com/`;
- browser recreation does not redefine model authority;
- bridge lifetime is independent from pane/WebView lifetime.

On the PASS/separate architecture, WebView observes pyRevit bridge readiness.

On the FAIL/unified architecture, WebView observes the unified bridge readiness controller.

## 9. Python MCP ownership

The full Python Revit MCP remains owned by the RevitGPT local runtime/control plane.

Normal intent:

```text
Revit starts
  -> selected bridge host becomes ready
  -> WebView available
  -> user invokes @rg
  -> local control plane lazily activates Python Revit MCP
  -> MCP calls selected bridge
```

Neither architecture moves Python MCP process ownership into the Revit add-in.

## 10. Authority boundary

This design does not implement final model authority.

Still canonical:

- one primary bound model per logical session;
- active view/model changes do not auto-rebind;
- WebView state does not define authority;
- final pairing and `Lease + Bind Current` stay downstream.

E-PY/P1B are infrastructure-hosting decisions only.

## 11. Evidence-driven architecture selection

The decision artifact must select exactly one result:

### `PYREVIT_SEPARATE`

Allowed only if:

- auto-start is stable;
- API threading is safe;
- route/method/schema contract is compatible;
- read/write/readback/delete passes;
- no routine manual bridge control is needed.

### `UNIFIED_NATIVE`

Selected when, after bounded pyRevit remediation:

- automatic pyRevit startup/lifecycle remains unreliable; or
- safe Revit API dispatch cannot be made reliable; or
- routine recovery requires user action.

When `UNIFIED_NATIVE` is selected, the manual/recovery control belongs inside the RevitGPT docked panel.

## 12. Test matrix

All disruptive host tests use a dedicated disposable Revit test session/model with no unsaved user work. Revit must be fully closed before enabling/disabling add-in manifests. Sleep/resume and force-close/crash-like tests require explicit Human approval immediately before execution; an automated agent must never kill an arbitrary active user Revit process.

E-PY must cover at least:

1. clean single-owner port baseline;
2. cold Revit launch with a project;
3. cold Revit launch without an active project where possible;
4. at least 10 repeated cold launch/shutdown cycles;
5. open second model;
6. switch active views/models repeatedly;
7. close/reopen models without closing Revit;
8. pyRevit reload;
9. at least 10 concurrent non-mutating bridge requests;
10. request arrival during dispatcher drain/exit if a dispatcher is introduced;
11. read -> write -> readback -> delete -> verify absent;
12. Windows sleep/resume;
13. normal shutdown -> immediate relaunch;
14. force-close/crash-like termination -> relaunch;
15. stale/occupied port observation without killing unknown owner;
16. `@rg` end-to-end call through Python MCP to the bridge.

If E-PY passes, proceed to a linked WebView-only implementation Job.

If E-PY fails, proceed to a linked unified-native implementation Job whose acceptance repeats the relevant lifecycle/concurrency/capability tests.

## 13. Job boundary

E-PY is its own finite evidence Job.

Do not prepare both implementation branches in advance as executable Jobs.

After E-PY result:

```text
E-PY completed
   |
   +-- PYREVIT_SEPARATE
   |      -> create linked P1B-WebView-only Job
   |
   +-- UNIFIED_NATIVE
          -> create linked P1B-Unified-native Job
```

This avoids conditional-task deadlocks and prevents implementation effort on an architecture that evidence does not select.

## 14. Definition of success

Preferred result:

> Open Revit, pyRevit bridge becomes ready invisibly, RevitGPT WebView is available, type `@rg`, work.

Fallback result when pyRevit cannot satisfy that contract:

> Open Revit, unified RevitGPT add-in auto-connects; if recovery is genuinely required, the same docked panel exposes `Refresh`, then type `@rg`, work.
