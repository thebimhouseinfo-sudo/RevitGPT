# Unified Revit Add-in + Bridge Auto-Start Design

Date: 2026-10-07  
Status: **DESIGN SPEC — HUMAN ARCHITECTURE APPROVED, IMPLEMENTATION NOT YET AUTHORIZED**  
Project: RevitGPT  
Implementation source of truth: `work/J-AFC4-p1-revit-mcp-bootstrap`

## 1. Decision summary

RevitGPT must target the same normal user experience already proven desirable in CadGPT:

```text
Open Revit
  -> RevitGPT add-in loads
  -> native Revit bridge becomes READY automatically
  -> dockable WebView shows ChatGPT
  -> user types @rg
  -> work begins
```

The user must not need to understand or manually operate the bridge, local port, Python MCP process, tunnel, or binding plumbing during a healthy startup.

The implementation must first attempt to make **automatic bridge startup reliable**. Fallback UI is not the primary design goal; it exists only if real-host evidence shows auto-start cannot be made reliable enough.

Outcome priority:

1. **AUTO** — preferred final mode. Bridge auto-start is reliable; no recovery gate is shown during normal startup.
2. **HYBRID** — acceptable only if auto-start is usually successful but still has real lifecycle failure modes that cannot be removed safely. Failed startup shows a recovery overlay with a single `Refresh` action.
3. **REFRESH-GATED** — last resort only if Revit lifecycle constraints make reliable automatic bridge startup impractical. Chat is hidden until `Refresh` successfully establishes bridge readiness.

No implementation may choose HYBRID or REFRESH-GATED merely because it is easier to code. The decision must be evidence-driven.

## 2. Why this phase exists

The current RevitGPT control plane can expose a ChatGPT MCP tunnel and can launch the Python Revit MCP process, but actual Revit access ultimately depends on the local HTTP bridge at:

```text
http://127.0.0.1:8765
```

Current native bridge code was migrated from the older CAD-Agent approach and still expects a user to invoke a `Start Bridge` command manually. That is incompatible with the intended RevitGPT UX.

The Revit add-in and the native bridge therefore become one product host:

```text
RevitGPT.Addin.dll
  ├─ Revit application lifecycle
  ├─ native bridge lifecycle
  ├─ Revit API dispatcher
  ├─ DockablePane
  ├─ WebView2 host
  ├─ local add-in control client
  └─ Revit context observer
```

There must not be a production UX where users install one add-in for the dockable ChatGPT panel and a second independent add-in to start the bridge.

## 3. Alternatives considered

### 3.1 Auto-start only

Bridge startup is owned by the RevitGPT add-in and occurs automatically at the earliest safe Revit lifecycle point.

Advantages:
- Best UX.
- Matches the intended CadGPT-like experience.
- Removes a user-visible infrastructure step.
- Simplifies support because healthy startup has one path.

Risk:
- Revit startup timing may expose edge cases around `UIApplication`, `ExternalEvent`, document availability, reload, or recovery.

**Preferred outcome if host evidence passes.**

### 3.2 Hybrid auto-start + recovery gate

The add-in auto-starts the bridge first. If readiness cannot be established, the dockable panel covers the ChatGPT area with a recovery overlay.

```text
RevitGPT is not ready

[ Refresh ]
```

`Refresh` retries bridge initialization and health verification. Chat becomes visible only after readiness succeeds.

Advantages:
- Keeps the normal path automatic.
- Gives the user a simple recovery mechanism without exposing MCP internals.
- Avoids forcing a Revit restart for recoverable failures.

Cost:
- Adds a second lifecycle path and therefore more state-machine/test complexity.

**Use only if real evidence shows AUTO cannot be made sufficiently reliable.**

### 3.3 Refresh-gated startup

WebView chat is hidden at startup and the user must press `Refresh` before using `@rg`.

Advantages:
- Simple deterministic startup gating.

Disadvantages:
- Worse UX.
- Reintroduces an infrastructure action every session.
- Fails the desired “open Revit, type @rg, work” experience.

**Last resort only.**

## 4. Lifecycle ownership

### 4.1 Add-in application scope

The native bridge belongs to the Revit application/add-in lifecycle, not the WebView lifecycle.

The bridge must:
- start once per Revit process when possible;
- remain alive if the dockable pane is hidden;
- remain alive if WebView2 is recreated;
- remain alive while the user changes Revit views or documents;
- stop cleanly during add-in/Revit shutdown;
- release its HTTP listener/port during shutdown;
- never depend on a specific ChatGPT conversation.

### 4.2 WebView scope

The WebView belongs to the dockable-panel/session shell.

WebView2 may:
- initialize after bridge readiness;
- preserve its profile and ChatGPT login/session;
- be recreated after a renderer/process failure;
- be hidden/covered during a bridge outage without destroying the ChatGPT conversation.

The WebView is not the authority for model binding, bridge state, or Revit API state.

### 4.3 Python MCP scope

The Python Revit MCP remains owned by the RevitGPT local runtime/control plane.

The unified Revit add-in must **not** directly own the Python MCP child process.

Normal intent:

```text
Revit starts
  -> native bridge auto-starts and becomes READY
  -> WebView available
  -> user invokes @rg
  -> local control plane lazily activates full Revit MCP
  -> MCP calls bridge
```

This preserves the existing separation between a light application-scoped bridge and a demand-driven full MCP runtime.

## 5. Safe Revit startup sequence

The add-in must not assume that all Revit UI/API facilities are safe during the first line of `IExternalApplication.OnStartup`.

Target sequence:

```text
IExternalApplication.OnStartup
  -> register DockablePane
  -> register lifecycle/event handlers
  -> schedule/defer bridge initialization to a safe Revit UI lifecycle point
  -> construct Revit API dispatcher / ExternalEvent on the UI thread
  -> start localhost bridge listener
  -> GET /health
  -> perform minimal bridge readiness probe
  -> mark bridge READY
  -> allow WebView/chat surface
```

The implementation may use the earliest safe Revit callback/event proven by host testing. The exact event is an implementation detail; the design requirement is that bridge initialization happens automatically on a valid Revit UI/API context.

## 6. Revit API threading model

All Revit API access, including reads, must be serialized through a Revit UI-thread dispatcher.

Do not preserve the old pattern where some read endpoints execute Revit API calls directly from HTTP worker threads.

Required conceptual flow:

```text
HTTP request
  -> parse/validate
  -> create RevitRequest
  -> enqueue request
  -> ExternalEvent.Raise()
  -> Revit UI thread
  -> execute Revit API operation
  -> complete request-specific TaskCompletionSource
  -> HTTP response
```

Requirements:
- one request has one independent completion primitive;
- concurrent HTTP requests cannot overwrite each other's pending state;
- writes are serialized through the same dispatcher;
- reads are also serialized through the dispatcher;
- request timeout/cancellation cannot corrupt another request;
- one failed request cannot poison the dispatcher queue.

The existing singleton pending fields in the migrated standalone bridge are not sufficient for this contract.

## 7. Readiness state machine

The add-in must keep bridge readiness distinct from ChatGPT pairing and model binding.

Minimum bridge states:

```text
STARTING
READY
FAILED
STOPPING
STOPPED
```

Optional recovery state:

```text
RECOVERING
```

### READY

READY means:
- native bridge listener owns the expected localhost endpoint;
- `/health` succeeds;
- the bridge dispatcher has a valid Revit UI execution path;
- a minimal non-destructive Revit probe succeeds or the host is validly waiting for a document according to the final endpoint contract.

READY does **not** mean:
- `@rg` has already paired a ChatGPT conversation;
- a primary model has already been bound;
- the Python MCP must already be running.

Those are separate dimensions.

## 8. WebView gating rules

### AUTO success

When auto-start reaches READY:

```text
show ChatGPT WebView
no bridge button
user can type @rg
```

### Auto-start failure

Only if HYBRID is retained after evidence:

```text
cover/hide ChatGPT interaction
show simple RevitGPT recovery surface
show [ Refresh ]
```

The label must be `Refresh` rather than `Start MCP` or `Start Bridge`. Infrastructure terminology is intentionally hidden from normal users.

Refresh performs a bounded recovery action:
- inspect existing listener/process state;
- repair stale bridge ownership if safe;
- recreate dispatcher/listener if needed;
- rerun readiness checks;
- expose the chat surface only after READY.

If an already-open WebView existed before a bridge outage, recovery must preserve the WebView profile and current ChatGPT conversation whenever possible.

## 9. UX contract

### Healthy session

```text
User opens Revit
User sees usable RevitGPT ChatGPT panel
User types @rg
User works
```

No manual:
- Start Bridge;
- Start MCP;
- port selection;
- Python launch;
- .bat command;
- workspace discovery;
- transport reconnect.

### Recoverable failure

If HYBRID is required:

```text
User opens Revit
RevitGPT cannot reach READY automatically
Chat surface is not interactive
User sees [ Refresh ]
User presses Refresh
READY succeeds
Chat surface appears
User types @rg
```

### Non-recoverable failure

After bounded recovery attempts fail, the panel may show a concise diagnostic state, but it must still avoid requiring the user to understand internal process topology. Detailed logs belong in diagnostics, not primary UX.

## 10. Interaction with model authority

This phase does not change the already-approved authority rules:

- one primary bound Revit model per logical session/workspace;
- changing active view/document does not auto-rebind;
- mismatch is visualized;
- explicit `Lease + Bind Current` performs intentional rebinding;
- WebView state does not define model authority.

Bridge auto-start is infrastructure readiness only.

## 11. Production packaging

Target production installation:

```text
one RevitGPT .addin registration
one RevitGPT add-in package/DLL set
```

The old standalone `RevitMCPBridge` add-in becomes migration/reference code and must not remain a required second production add-in.

The pyRevit bridge may remain temporarily as a development/recovery reference during migration, but successful completion removes it from the normal setup path.

Any old “Revit MCP Bridge > Start Bridge” ribbon action must no longer be required. If a diagnostic action remains, it should behave as status/restart tooling, not as mandatory startup.

## 12. Evidence-driven AUTO / HYBRID / FALLBACK decision

The implementation phase must not decide the final UX mode from static code review alone.

### AUTO acceptance target

AUTO is accepted when repeated real-host testing shows:
- bridge auto-starts on cold Revit launch;
- bridge auto-starts when opening Revit before any project is opened, if that host flow is supported;
- opening/closing models does not kill bridge readiness;
- hiding/showing the dockable pane does not affect bridge readiness;
- WebView recreation does not affect bridge readiness;
- Windows sleep/resume does not leave an unrecoverable stale listener;
- Revit shutdown frees the listener cleanly;
- relaunch does not encounter stale port ownership;
- repeated launch/close cycles do not require the manual Start Bridge command.

### HYBRID trigger

HYBRID is retained only when:
- AUTO works for the normal path; **and**
- at least one reproducible host lifecycle condition can still leave the bridge unavailable; **and**
- that condition can be safely repaired by an in-panel `Refresh` without restarting Revit.

### REFRESH-GATED trigger

REFRESH-GATED startup is allowed only when:
- automatic initialization remains unsafe or materially unreliable after bounded fixes; **and**
- the failure is inherent to a Revit lifecycle/API constraint rather than an implementation defect.

The evidence report must state which mode was selected and why.

## 13. Test matrix

Implementation acceptance must cover at least:

1. Cold Revit launch with a normal project.
2. Cold Revit launch without an immediately open project, when applicable.
3. Open second model.
4. Switch active views repeatedly.
5. Hide/show RevitGPT pane.
6. Recreate WebView process.
7. Close bound/unbound models.
8. Sleep/resume Windows.
9. Bridge HTTP request concurrency.
10. Read + write + readback + delete through MCP.
11. Revit shutdown.
12. Immediate Revit relaunch.
13. Stale listener/port simulation.
14. Auto-start failure injection and recovery behavior if HYBRID exists.
15. Repeated full startup/shutdown cycles.

The test report must distinguish:
- Revit process health;
- bridge health;
- Python MCP health;
- ChatGPT pair status;
- model authority/binding status.

## 14. Roadmap integration

The current causal chain starts:

```text
P0 -> P1 -> E1 -> E2 -> E3 -> P2A ...
```

This design introduces a bounded phase before E1:

```text
P0
-> P1
-> P1B Unified Revit Add-in + Bridge Auto-Start
-> E1 real Revit read/write/delete
-> E2 lifecycle evidence
-> E3 strong model identity
-> P2A managed WebView session shell
...
```

P1B is required because E1 should test the production-intent bridge lifecycle rather than a temporary manual Start Bridge workflow.

P1B must not silently absorb P2B model-authority scope. It may create the DockablePane/WebView host foundation necessary for the unified add-in, but final pair/authority behavior remains governed by the existing downstream phases unless the durable roadmap is separately revised and reviewed.

## 15. Implementation boundary for P1B

P1B should include:
- create/establish `addins/revitgpt-revit/`;
- unified Revit `IExternalApplication`;
- DockablePane registration;
- native bridge hosted by the RevitGPT add-in;
- automatic bridge startup at a proven safe lifecycle point;
- UI-thread request dispatcher with per-request completion;
- bridge health/readiness state;
- clean shutdown;
- initial WebView host integration sufficient to enforce readiness gating;
- optional `Refresh` recovery only if evidence justifies HYBRID;
- installer migration toward one add-in;
- static checks and real-host evidence hooks.

P1B must not include:
- automatic model rebinding;
- final `Lease + Bind Current` transaction logic;
- final strong model identity scheme;
- job runtime changes unrelated to bridge/add-in hosting;
- unrelated UI redesign.

## 16. Rollback

Rollback must preserve the last known working P1 implementation line.

If unified native hosting fails during development:
- revert the bounded P1B commits;
- restore the previous standalone bridge/dev path for diagnostics;
- do not rewrite the P0/P1 historical commits;
- do not merge a partially working unified add-in into `main`.

Rollback is an engineering safety path, not an accepted product mode.

## 17. Definition of design success

This design is successful when implementation can demonstrate:

> Open Revit, type `@rg` in the RevitGPT panel, and work.

If that flow is reliably achieved, the user-facing recovery gate is unnecessary during normal operation.

If a recovery gate is retained, it must exist only because real Revit lifecycle evidence justifies it, and its only normal user action is `Refresh`.
