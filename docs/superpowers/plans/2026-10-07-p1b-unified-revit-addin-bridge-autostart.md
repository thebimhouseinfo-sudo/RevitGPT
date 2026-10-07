# P1B Bridge Hosting Decision + Conditional Revit Add-in Implementation Plan

> **For agentic workers:** This plan is evidence-gated. Do **not** implement a native bridge before E-PY selects that architecture.

**Goal:** Determine whether the existing pyRevit bridge can remain a separate, fully automatic and invisible RevitGPT infrastructure component. Only if it cannot meet the production contract after bounded remediation should RevitGPT build one unified native add-in containing both bridge and docked WebView.

**Design:** `docs/superpowers/specs/2026-10-07-unified-revit-addin-bridge-autostart-design.md`

**Current source branch:** `work/J-AFC4-p1-revit-mcp-bootstrap`

## 1. Planner correction after CR

The previous plan prematurely assumed a unified native add-in.

The corrected causal chain is:

```text
P1 current MCP bootstrap
  ↓
E-PY prove pyRevit auto-start + API safety + capability
  ↓
  ├─ PYREVIT_SEPARATE
  │    ↓
  │  linked P1B-WebView-only Job
  │    ↓
  │  E1
  │
  └─ UNIFIED_NATIVE
       ↓
     linked P1B-Unified-native Job
       ↓
     E1
```

Two add-ins are acceptable only when the pyRevit bridge is fully automatic and invisible.

If routine manual bridge start/recovery is required, bridge + WebView must become one RevitGPT native add-in so the only user-facing recovery UI lives in the docked panel.

## 2. CR findings disposition

All six findings from CR verification `01a116bc-8344-70ca-ad21-c55063ce8992` are mandatory planning constraints.

### CR-1 ExternalEvent lost-wakeup risk — ACCEPTED

Applies if pyRevit is hardened with an ExternalEvent dispatcher or if the unified native path is selected.

Required scheduler contract:

- per-request completion;
- `ConcurrentQueue` or equivalent queue;
- atomic single-flight scheduled/draining state;
- explicit handling of `ExternalEvent.Raise()` result;
- no assumption that every `Raise()` creates a new event;
- atomic drain/exit handoff so no request is stranded;
- concurrency test that targets the arrival-during-drain boundary.

### CR-2 startup deadlock risk — ACCEPTED

Any `ApplicationInitialized` native startup implementation must:

- create required objects;
- schedule readiness work;
- return immediately.

Never synchronously wait for an ExternalEvent-backed task inside a Revit callback.

### CR-3 pyRevit/native port collision — ACCEPTED AND MOVED EARLIER

Before E-PY, establish a clean single-owner baseline for `127.0.0.1:8765`.

For E-PY specifically:

- installed legacy native `RevitMCPBridge.addin` must not compete for the port;
- only the pyRevit bridge under test may own `8765`;
- unknown port owners are reported, never killed automatically.

If later `UNIFIED_NATIVE` is selected:

- installed pyRevit bridge autostart must be disabled/removed before unified-native evidence;
- exactly one bridge owner is again required.

### CR-4 write/readback/delete acceptance mismatch — ACCEPTED

E-PY includes:

```text
read -> controlled disposable write -> readback -> delete -> verify absent
```

E1 still follows afterward as the deeper real-project capability checkpoint.

### CR-5 conditional task dependency deadlock — ACCEPTED AND ELIMINATED

The implementation is split into linked Jobs.

E-PY always completes with one architecture decision.

Only the selected implementation Job is created afterward.

There is no skipped Task 8 that another task depends on.

### CR-6 route-only parity too shallow — ACCEPTED

Bridge contract fixtures must pin:

- path;
- HTTP method;
- minimal required payload;
- minimal success response shape;
- expected error behavior.

This applies to whichever bridge host is selected.

## 3. New source finding: current pyRevit bridge threading must be tested/hardened

Current source:

`runtimes/Revit-mcp/bridge/pyrevit_extension/RevitMCPBridge.extension/RevitMCPBridge.bundle/Contents/revit_mcp_bridge.py`

starts `HTTPServer.serve_forever()` on a Python background thread and request handlers directly call Revit API objects.

No `ExternalEvent` implementation is present in that bridge source.

Therefore:

- a successful `/health` response is not sufficient for PASS;
- repeated functional success alone does not override an unsafe host-thread model;
- E-PY may perform a bounded pyRevit hardening pass to marshal Revit API work safely while keeping pyRevit separate and automatic;
- if that hardening cannot be made reliable, select `UNIFIED_NATIVE`.

## 4. Executable Job 1 — E-PY pyRevit bridge evidence gate

This is the **only executable Job that should be prepared now**.

### Task E-PY-1 — Build a clean single-owner baseline

**Read/inspect:**
- `scripts/check-revit-bridge-host.ps1`
- `scripts/diagnose-revit-bridge.ps1`
- `scripts/sync-revit-bridge.ps1`
- native `RevitMCPBridge.addin` installations;
- installed `RevitMCPBridge.extension` copies;
- port `8765` owner.

**Required evidence:**
- Revit version/process;
- pyRevit runtime/attachment;
- installed extension path;
- source hash match;
- port owner before launch and after bridge start;
- confirmation that no native bridge add-in is competing during E-PY.

**Rule:** never kill an unknown process automatically.

### Task E-PY-2 — Create full bridge consumer-contract fixtures

Contract source:

`runtimes/Revit-mcp/connection/bridge.py`

For every Python bridge call, capture:

```text
path
method
minimal request shape
minimal success response shape
error behavior
```

The fixture must include the existing bridge surface such as:

- `/health`
- `/document/active`
- `/documents`
- `/views`
- `/levels`
- `/elements`
- `/element`
- `/element/connectors`
- `/families`
- `/family/types`
- `/system/types`
- mutation endpoints;
- annotation endpoints.

String-only path matching is not sufficient.

### Task E-PY-3 — Baseline current pyRevit auto-start

Without clicking any bridge command:

1. cold launch Revit;
2. confirm `startup.py` runs;
3. confirm bridge listener readiness;
4. confirm a real non-destructive Revit read;
5. capture startup/bridge logs.

Run at least 10 cold launch/shutdown cycles.

A single successful launch does not count as stable.

### Task E-PY-4 — Exercise lifecycle edge cases

Run and record:

- Revit starts with no active RVT where host flow permits;
- open first model after startup;
- open a second model;
- switch views/models repeatedly;
- close/reopen models without closing Revit;
- reload pyRevit;
- sleep/resume Windows;
- normal Revit shutdown -> immediate relaunch;
- force-close/crash-like termination -> relaunch;
- occupied/stale `8765` observation.

No manual bridge-start action is allowed during PASS testing.

### Task E-PY-5 — Prove API execution safety

**Dependency:** complete E-PY-3 and E-PY-4 first so the unmodified current pyRevit bridge has a durable startup/lifecycle baseline before any remediation.

First classify the current pyRevit request execution model.

Because current source directly accesses Revit API from the HTTP server thread, E-PY must not promote it unchanged to production merely from lucky functional runs.

Allowed bounded remediation:

- implement a pyRevit/Revit-supported UI-thread dispatch mechanism;
- keep bridge startup automatic;
- keep bridge invisible to users;
- keep pyRevit bridge separate from the WebView add-in.

If an ExternalEvent-style dispatcher is used, it must satisfy CR-1 and CR-2:

- single-flight scheduler;
- explicit `Raise()` result handling;
- no lost wakeups;
- no synchronous wait from Revit callbacks;
- independent per-request completion.

After any remediation, repeat E-PY-3 and E-PY-4 from a clean install.

If safe dispatch cannot be made reliable within the bounded pyRevit remediation scope, record a decisive `PYREVIT_THREADING_FAIL`. Downstream concurrency/capability/@rg tasks then close as `NOT_APPLICABLE_AFTER_DECISIVE_FAIL` with that evidence reference; they must not block the final architecture decision.

### Task E-PY-6 — Concurrency test

Run at least 10 concurrent non-mutating bridge requests.

Also test the scheduler boundary where a new request arrives while the current UI-thread drain is finishing.

Acceptance when pyRevit remains a viable candidate:

- every request returns its own result;
- no result cross-talk;
- no stranded request;
- no Revit API thread/context exception;
- no permanently pending request after timeout/cancellation.

### Task E-PY-7 — Real capability smoke

If E-PY-5 produced a decisive threading failure, persist `NOT_APPLICABLE_AFTER_DECISIVE_FAIL` and do not exercise an unsafe bridge.

Otherwise, through the actual Python MCP/bridge chain where practical:

```text
read
-> create or modify a disposable test entity/value
-> readback
-> delete/revert
-> verify absent/restored
```

Record exact test element/value and cleanup evidence.

This closes CR-4 before architecture selection.

### Task E-PY-8 — Full `@rg` smoke

If E-PY-5 produced a decisive threading failure, persist `NOT_APPLICABLE_AFTER_DECISIVE_FAIL` and do not expose the unsafe bridge to the full connector path.

Otherwise, with Revit still using the pyRevit bridge:

```text
ChatGPT @rg
-> RevitGPT control plane
-> lazy Python Revit MCP
-> pyRevit bridge
-> Revit API
```

Confirm at least:

- active/open document read;
- one additional harmless view/element query.

The mutation smoke from E-PY-7 remains part of the same evidence set.

### Task E-PY-9 — Architecture decision

Create:

`docs/evidence/E-PY-pyrevit-autostart-result.md`

It must choose exactly one. A decisive pyRevit failure is sufficient evidence for `UNIFIED_NATIVE`; downstream pyRevit-only tests may be recorded as not applicable rather than becoming dead dependencies:

#### `PYREVIT_SEPARATE`

Only if:

- auto-start/lifecycle matrix passes;
- Revit API execution model is safe;
- consumer-contract fixtures pass;
- concurrency passes;
- read/write/readback/delete passes;
- no routine manual recovery/start is required.

#### `UNIFIED_NATIVE`

If, after bounded pyRevit remediation:

- auto-start remains materially unreliable; or
- safe request dispatch cannot be made reliable; or
- routine operation/recovery requires user action.

No third ambiguous state may close E-PY.

## 5. Linked Job created only after E-PY

### If `PYREVIT_SEPARATE`

Planner prepares **P1B-WebView-only**.

Target structure:

```text
Revit
├─ pyRevit bridge — separate, automatic, invisible
└─ RevitGPT.addin
     └─ DockablePane + WebView2
```

Scope:

- native RevitGPT DockablePane;
- `IFrameworkElementCreator`/browser-safe recreation;
- persistent WebView profile;
- bridge health observation;
- expose ChatGPT only after bridge readiness;
- no duplicate native bridge implementation;
- no routine Refresh bridge switch.

Acceptance:

```text
open Revit -> WebView ready -> type @rg -> work
```

### If `UNIFIED_NATIVE`

Planner prepares **P1B-Unified-native**.

Target structure:

```text
RevitGPT.Addin.dll
├─ DockablePane + WebView2
├─ native bridge
├─ single-flight ExternalEvent dispatcher
└─ Refresh recovery
```

Mandatory constraints inherited from CR:

- all Revit API reads/writes through UI-thread dispatcher;
- single-flight/lost-wakeup-safe scheduler;
- no sync wait in `ApplicationInitialized`;
- full route/method/payload/response contract parity;
- disable/remove installed pyRevit bridge autostart before native evidence;
- exactly one `8765` owner;
- real read/write/readback/delete acceptance;
- `Refresh` is the only user bridge-recovery control.

## 6. Final roadmap relation

The durable causal chain becomes:

```text
P0
-> P1
-> E-PY bridge-host evidence
-> [selected P1B implementation Job]
-> E1 deeper real-project capability
-> E2 lifecycle
-> E3 identity/topology
-> P2A/P2B downstream authority/session work
```

P1B does not absorb final model authority or pair/rebind semantics.

## 7. Definition of planning success

This plan is ready to execute only when Reviewer confirms:

- E-PY is the first executable gate;
- no native bridge is implemented before E-PY selects it;
- all six CR findings are explicitly closed by plan requirements;
- pyRevit threading is treated as a real production-safety question, not only a startup question;
- conditional architecture is represented as linked Jobs, not skipped-task dependencies;
- the user experience remains:
  `open Revit -> type @rg -> work`
  whenever evidence allows it.
