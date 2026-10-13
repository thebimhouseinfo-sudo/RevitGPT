# P1 — Stable Runtime & Connection | Implementation and Acceptance Plan
Status: PLAN REVIEW PASS (design only); implementation NOT STARTED; real Revit acceptance NOT RUN.
Date: 2026-10-13. Source baseline: repository main inspected 2026-10-13.
Authority: this file defines P1 scope; legacy roadmap lifecycle/TTL statements are superseded for P1 by the goal and decisions below. Do not silently edit unrelated phases.

## PHASE GOAL — immutable review anchor
After explicit `@rg`, RevitGPT must remain available and stable until explicit `rg/stop` or a legitimate host/lifecycle transition. Once FULLY AWAKE, a normal tool error, internal timeout, chat inactivity, WebView reload, transport replacement, or another chat must **never** cause the application to discard the shared model binding or shut down the full MCP. Recover only the failed layer, report actual failures, and never silently replay uncertain writes. Support STANDBY → WORKSPACE AWAKE → FULLY AWAKE, a single intentional primary Revit model binding shared by multiple chats, and eventual P2/P3 extensions without implementing their features in P1. Reuse existing code, test before changing, and do not claim absolute immunity to external outages, Revit crash or OS shutdown.

**Review invariant:** every task and review change must cite a specific clause of this goal. If it cannot, defer it to P2/P3. Do not turn P1 into Job Runtime, Dynamo Writer, comprehensive MCP-tool authoring, or capability leasing.

## Explicit lifecycle contract
- STANDBY: lightweight tray and only the minimum reachable admission/control transport required for remote `@rg`; no active workspace work and no full Python/Revit MCP. Opening Revit or ChatGPT alone must not wake it.
- WORKSPACE AWAKE: explicit `@rg` with Revit absent; workspace/system functions available without Revit; Revit MCP off. If Revit later opens, transition automatically to FULLY AWAKE without another `@rg`.
- FULLY AWAKE: workspace plus Revit-dependent MCP/bridge, using one shared bound model. Opening additional chats does not steal ownership or reset runtime. Closing WebView/browser/chat does not shut down runtime.
- Revit exits: FULLY AWAKE → WORKSPACE AWAKE; preserve workspace state and user-owned files. Revit reopens while awake: auto-recover full MCP.
- `rg/stop`: global explicit FULLY/WORKSPACE → STANDBY; while Revit remains open, do not auto-awaken until next `@rg`. `run.bat stop` remains a distinct administrative host shutdown and must not be conflated with in-chat `rg/stop`.
- Sleep/wake, temporary network loss, tunnel replacement and transport reconstruction: preserve intended awake state; detect actual process/transport health, reconnect affected layer only, do not replay unknown-outcome write requests.
- No idle-based expiry of workspace, MCP, bound model, chat authority or job data. Finite **startup/probe/request** deadlines may remain only when justified, localized and proven not to deactivate healthy unrelated layers. A timed-out operation is not proof of connection death.

## Source audit and disposition (not host PASS)
| ID | Source / observed behavior | Disposition | Goal implication |
|---|---|---|---|
| A01 | `revitgpt-tray.ps1` tray, Windows startup, tunnel and slim MCP self-heal exist; it starts slim MCP+tunnel immediately | KEEP/ADAPT: distinguish always-reachable lightweight admission from awake state; preserve existing tray | remote wake and minimal standby |
| A02 | `src/index.mjs` admission turns MCP on when Revit present; with Revit off it reports OFF; watcher deactivates on Revit exit | ADAPT: explicit persistent awake intent and automatic Revit-arrival activation | lifecycle |
| A03 | `src/revit-fake-cli.mjs` parser has no `rg/stop` | ADD: global stop route and idempotent semantics | explicit stop |
| A04 | `src/revit-upstream.mjs:121-130` catches every callTool exception and invokes `deactivate()` | FIX: classify tool result/error vs transport death; no whole-MCP shutdown for ordinary tool failures | failure isolation |
| A05 | `src/revit-upstream.mjs` 15s shared initial handshake/list deadline | REVIEW: retain bounded startup diagnostics; distinguish slow initialization from actual failure, avoid false global state changes | timeout correctness |
| A06 | `src/mcp-session-manager.mjs` has 24h session TTL and cleanup | ADAPT: remove idle eviction; retain protocol-correct explicit close and bounded stale-transport cleanup without dropping awake state | no idle disconnect |
| A07 | `src/model-authority.mjs` requires BOUND_CURRENT and active_id==bound_id; `NativeModelBindingState.cs` also enforces active context | VERIFY first: bound-but-inactive operations must not target wrong model; determine Revit API-safe approach per operation before changing gate | one bound model, safety |
| A08 | `src/index.mjs` creates per-transport MCP sessions with a shared `revitUpstream` singleton; recovery path exists | KEEP/VERIFY: simultaneous chats, transport churn, concurrency and global stop | multi-chat |
| A09 | `RevitGptApplication.cs` has native listener recovery and Revit UI-thread dispatch; pane supports Bind Current | KEEP/VERIFY: avoid reimplementing working add-in, test real host and sleep/wake | binding/recovery |
| A10 | `src/read-intent-gate.mjs` cold tool call can activate MCP | ADAPT: gate activation by global awake intent, never allow post-stop request to wake unexpectedly | standby authority |
| A11 | `revitgpt-tray.ps1` self-heal restarts failed slim MCP/tunnel | REVIEW: distinguish healthy probe latency from actual failure, preserve awake intent across control-plane restart | localized recovery |
| A12 | `docs/roadmap/ROADMAP.md`, `docs/architecture/AUTHORITY_LIFECYCLE.md` contain legacy per-chat TTL/ownership statements | DOCUMENT: reconcile during implementation, do not silently use them as P1 authority | avoid goal drift |

## Ordered implementation work
### P1-A — Contract and baseline, before edits
1. Snapshot branch/commit, inventory native bridge, tray, tunnel, Node and Python entry points, test inventory and relevant logs. Run existing offline tests first; classify KEEP, VERIFY, MODIFY, ADD or REMOVE.
2. Record one state-transition table for Revit OFF/ON, `@rg`, `rg/stop`, chat close/reload, sleep/wake, process crash, bridge loss, tunnel loss and multiple chats. Define persistent awake-intent owner and where it is restored after component restart; avoid dual competing authorities.
3. Review ambiguous active-vs-bound model API semantics and timeout/error classes; do not weaken wrong-model protections just to pass a test.
**Gate A:** reviewed design contract and baseline evidence; no speculative refactor.

### P1-B — Lifecycle and stop
4. Adapt tray/control-plane boundary to keep remote admission reachable in STANDBY without activating workspace/full MCP. Do not create a second unnecessary daemon.
5. Implement explicit global awake intent, idempotent `@rg` and `rg/stop`; verify post-stop Revit presence cannot auto-wake. Preserve awake intent through recoverable control-plane restarts, but not explicit stop.
6. Revit-process transitions activate/deactivate only Revit-dependent layer; preserve workspace. Avoid multiple Revit-process ambiguity by testing target process/model identity.
7. Remove idle-expiry semantics and outdated per-chat authority ownership; keep explicit protocol transport closure separate from global runtime state.
**Gate B:** offline transition-matrix tests green, including stop/restart and Revit arrival.

### P1-C — Failure isolation and recovery
8. Classify MCP responses: normal tool error, application exception, request timeout, transport broken, Python process exit, native bridge failure, Revit host exit. Only proven dead dependencies may be re-created; tool failure cannot globally deactivate MCP.
9. Review startup handshake timeout and HTTP binding probe timeout (currently 2500ms in `model-authority.mjs`) separately. Timeouts must report correct uncertainty, must not revoke shared binding, and must not trigger unbounded reconnect storms.
10. Add targeted health/diagnostic events with correlation IDs and state transitions, retaining errors across reconnect; preserve existing logging. Explicitly prevent automatic replay of writes with unknown completion status.
11. Ensure bridge, upstream and tunnel recover independently with bounded backoff and no repeated destructive reset of healthy layers.
**Gate C:** negative-control tests prove tool failures retain connection, real transport deaths recover, genuine errors remain visible.

### P1-D — Binding and multi-chat
12. Verify single primary bound model, Bind Current-only intentional rebind, view-tab churn and bound-model closure. Active-tab mismatch must never redirect writes to the wrong model. Where host API cannot safely execute on inactive bound document, return a precise operation-level limitation without discarding binding; resolve behavior based on host evidence, not assumptions.
13. Verify multiple concurrent chats share runtime/model identity; chat session initialization/closure/recovery never owns the global binding. Serialize only conflicting Revit API work, not all offline/system work.
14. Verify WebView reload/close, tunnel reconnect and browser transport replacement preserve awake state.
**Gate D:** automated multi-session/authority regression green; native behavior marked HOST_RETEST_REQUIRED.

### P1-E — Test and release
15. Reuse `scripts/test-revit-upstream-lifecycle.mjs`, `test-mcp-session.mjs`, `test-model-authority.mjs`, `test-bridge-health.mjs`, `test-revit-upstream-lifecycle.mjs` (single file, not duplicate), plus native bridge fixtures. Update obsolete assertions; add only missing coverage.
16. Run CI/offline negative controls and review loop: Planner proposes → Reviewer identifies violations against Phase Goal → Planner revises → Reviewer rechecks until PASS. Preserve findings, do not label simulated fixtures as host PASS.
17. One consolidated human Revit test round: H01 standby/offline wake/Revit arrival; H02 repeated reads/writes plus intentional tool failure; H03 simultaneous WebView/browser chats; H04 two-model tabs/bind/close; H05 reload, actual tunnel/bridge interruption and sleep/wake; H06 stop/restart. For writes use safe reversible fixtures, verify effects once and no unsafe replay.
18. Release only after explicit human approval; document host outcomes and unresolved environmental failures. Do not merge/deploy merely because offline CI passed.

## Acceptance criteria
- While FULLY AWAKE and Revit host remains healthy: zero unexpected global MCP deactivations from tool exceptions, request timeout, idle, chat churn or routine view switching.
- Tool error surfaces correctly; next independent tool call works without `@rg` or manual restart. Actual transport death recovers locally without silent write replay.
- One global awake intent, one intentional primary model binding; no session takeover, no automatic rebind, no wrong-model writes.
- `rg/stop` reliably returns to standby; Revit alone cannot re-awaken. Workspace remains awake after Revit exit unless explicitly stopped.
- Repeated test runs plus sustained idle and fault-injection coverage. No claim of absolute immunity to network/OS/Revit crashes; graceful detection/recovery is required.

## Review loop record — 2026-10-13
- R1 FAIL: initial plan treated all timeouts as unwanted and could encourage deleting startup failure detection. Corrected to localized, classified startup/probe deadlines and negative controls.
- R2 FAIL: initial plan risked changing BOUND_CURRENT guard without proving Revit API safe behavior for inactive documents. Corrected to VERIFY-first and no wrong-model writes.
- R3 FAIL: initial plan could confuse tray-only standby with no reachable control plane, making remote `@rg` impossible. Corrected to minimal reachable admission transport in standby.
- R4 FAIL: initial plan did not distinguish global `rg/stop` from administrative `run.bat stop`, nor preserve awake intent across process recovery. Corrected both.
- R5 PASS (plan consistency review): every task maps to Phase Goal, future phases excluded, explicit real-host gate, no unverified code marked complete. This is an internal plan review, **not** an independent CR execution or CI/host test.
