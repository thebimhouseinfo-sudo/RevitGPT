# P1 — Stable Runtime & Connection | Detailed Implementation Plan

**Status:** PLANNER REVISION 8 — CR-13/CR-14 incorporated; planning review pending; implementation NOT STARTED; CI/real-Revit acceptance NOT RUN.
**Date:** 2026-10-13.
**Baseline:** RevitGPT main at 1803660b853ad9d376c065baa63b356dddd6083a; preceding P1 plan commit 16837e6106694f6cc31989eca0a320fd6d50ba96.
**Change scope:** plan file only. No implementation, merge, deployment or claim of real-host PASS.

## PHASE GOAL — fixed anchor for all planning and review

After explicit **@rg**, RevitGPT must remain available and stable until an explicit permitted lifecycle transition. Once **FULLY AWAKE**, an ordinary tool error, timeout, chat inactivity, WebView reload, transport replacement, or another chat must **never** discard the shared model binding or shut down the whole MCP. Recover only a genuinely failed layer, surface real failures and never silently replay a write with unknown outcome.

Support **STANDBY → WORKSPACE AWAKE → FULLY AWAKE**, single intentional primary-model binding shared across chats, and architecture compatible with future P2 (MCP/Dynamo execution) and P3 (Jobs/skills/capability reuse). Reuse and verify brownfield code before modification. Do not claim immunity to Revit crash, external outages or OS shutdown.

**Critical stop refinement (human decision after CR-05):** **rg/stop must not interrupt active work.** If accepted work remains, report **BUSY / STOP_PENDING**, keep dependencies alive, block unrelated new work while permitting validated continuation steps of previously accepted work, and transition to STANDBY **only after the previously accepted work has reached a known terminal outcome**. An HTTP timeout does not establish that an already executing Revit operation has finished. The user must not have to issue stop a second time.

**Scope fence:** every proposed task, code change, review comment and test must trace to this Goal. Otherwise defer to P2/P3. P1 does NOT implement full Job Runtime, Dynamo Writer, Job File Ownership, capability registry leasing or all MCP tools.

## 1. Explicit runtime contract

### 1.1 Lifecycle and authority

| State | Always-reachable component | Workspace | Full Python/Revit MCP | Transition |
|---|---|---|---|---|
| STANDBY | Lightweight tray + minimum remote control/admission transport | Inactive | OFF | Only explicit @rg awakens |
| WORKSPACE_AWAKE | Tray/control plane | ON, independent of Revit | OFF | Revit appears + healthy bridge → FULLY_AWAKE |
| FULLY_AWAKE | Tray/control plane | ON | ON | Revit closes → WORKSPACE_AWAKE |
| STOP_PENDING | Control/status path retained; execution dependencies kept alive | Accepted work and validated continuations may run | Kept alive as needed for accepted work | Zero confirmed active work → STANDBY |
| STOP_BLOCKED | Diagnostic/status and required execution dependencies retained | No new work | Do not tear down while outcome unknown | Resolve or confirm terminal status before automatic stop |

- **@rg** is idempotent and sets one **global awake intent**, not a per-chat model lease. Revit being opened alone never wakes a STANDBY workspace.
- Revit's native add-in listener may exist whenever Revit is open; this is NOT the same as activating the Python MCP or workspace. Do not rewrite the already-installed add-in solely to suppress its idle listener.
- Opening/closing/reloading WebView, changing active Revit view/tab, creating/deleting MCP transports and multiple browser chats must not alter global awake intent or binding.
- **rg/stop** is global, not a per-chat close and not the administrative **run.bat stop**. A stop with active work enters STOP_PENDING; idle stop may transition directly to STANDBY. No automatic idle stop. An **@rg** arriving during STOP_PENDING/STOP_BLOCKED returns the current draining/blocked status and cannot cancel stop or admit new work; after STANDBY, a fresh @rg may awaken.
- During STOP_PENDING, give immediate visible result **BUSY — work in progress; stop after completion** with active/queued/unknown counts and current phase where known. Status/diagnostics remain available. Repeated stop requests are idempotent.
- Work admitted **before** the stop fence must be allowed to finish, including work already accepted into the Revit dispatch queue. After the fence, reject **new unrelated work** (including another chat's new task), but allow **validated continuation steps belonging to a previously accepted work unit** until that unit finishes. Same chat/session alone is not evidence of valid continuation: require work identity, step lineage and terminal tracking. Status and reconciliation remain permitted. The stop command itself is not counted as active work.
- Known terminal statuses are succeeded, failed or canceled **before starting**. Error completion does not mean success. **Unknown-outcome write remains unresolved** even if its upstream HTTP request ended.
- If host has exited, an in-flight operation cannot be guaranteed to finish: report **STOP_BLOCKED/EXTERNAL_INTERRUPTION** with unresolved operation IDs, never falsely declare graceful completion. **STOP_BLOCKED takes precedence** over ordinary FULLY_AWAKE → WORKSPACE_AWAKE during an unresolved pending stop. Explicit administrative process termination is outside the graceful rg/stop guarantee.
- Future P3 jobs integrate through a minimal active-work/quiescence and continuation-admission interface: begin accepted work → register follow-on steps to that work ID → complete terminally → notify stop drain. P1 tests this minimal interface with fixtures, but **does not implement P3 Job Runtime or workflow**. A new work unit cannot impersonate an existing continuation just by sharing a chat/session.

### 1.2 Minimal stop-drain implementation boundary

- P1 **must not infer multi-step work identity from conversational language, chat ID or MCP session ID**. Native tool operations are single-step units today. For a future P3 Job, its owner will explicitly register an accepted work unit (ID, owner scope, cancellation/continuation token, terminal marker) through a small P1 interface; a fixture tests this interface now. P1 does **not** attempt to detect when a user's future natural-language Job has finished.
- At admission, atomically commit the stop-fence epoch and accepted work-unit identity before dispatch. If the admission record cannot be durably written, fail the request *before dispatch* rather than executing untracked work. Every tool request is marked either **new work** or **authorized continuation** of an already registered work unit. Continuations are allowed only while the parent remains nonterminal, and are included in the parent’s active count; a parent must explicitly close when terminal. No implicit “chat still open” ownership. Admission and stop cannot race into an uncounted accepted request.
- **Durable, minimal execution journal** under managed LocalAppData stores stop epoch, accepted operation/work IDs, native host ID, cross-layer request IDs, stage, known terminal marker and outcome-unknown disposition. Correlation must propagate Node admission ID → Python bridge request → native X-Request-ID (currently generated in `connection/bridge.py`) or maintain an exact persisted parent-child mapping, including when Python/Node disconnect. This is a *control-plane safety journal*, not P3 Job storage, planning, progress model or capability registry. Persist before handing writes to native; reconcile from native operation status after Node/Python/tunnel restart, never replay a write as reconciliation.
- Native operation status must outlive an individual HTTP request **and** a listener restart within the same Revit host: put completion accounting under add-in/dispatcher owner, not an HTTP response object. On listener recovery, never dispose/replace an active ExternalEvent dispatcher blindly. Preserve executing operations until terminal; safely resume listener only after assessing pending/executing queue and ownership. Host exit makes previously executing operations unresolved unless durable evidence proves termination.
- **STOP_PENDING** means known active work exists; **STOP_BLOCKED** means an operation is unresolved and may have mutated Revit despite request timeout or host loss. A normal request timeout alone does not prove STOP_BLOCKED: first query the native operation status and keep STOP_PENDING while execution is confirmed ongoing. If recovery cannot resolve unknown work, expose a clear incident and stop remains blocked; do not invent a force-complete after a timer.
- Quiescence to STANDBY is an **atomic** compare-and-transition: stop fence active AND all pre-fence work units terminal AND no registered continuation pending AND native in-flight queue drained for that epoch. Verify crash recovery before declaring STOPPED. Do not close bridge/upstream/tunnel until all required completions and status probes are observed.
- **Status UX:** the initial rg/stop reply can be BUSY immediately; status subsequently updates automatically via control-plane monitoring. If the original chat closes, a different chat can query status; no repeated rg/stop is required. An accepted future Job waiting for a human input remains BUSY/AWAITING_INPUT, and only validated input/continuation for that work is admitted during drain; never infer that a chat has completed work because it became silent.

### 1.3 Awake-intent persistence and manual commands

- **Owner:** one local control-plane authority coordinated with the tray. Do not persist per-chat awake ownership or establish a second registry.
- Persist/reconstruct awake intent **only for the current Windows boot/logon generation**, using a verifiable boot/logon identity (not elapsed time or a stale PID alone). Recover from Node/tray crash, tunnel replacement and sleep/wake within the same generation; boot restart/logoff must invalidate old awake intent and return to STANDBY.
- **rg/stop** clears awake intent only after the drain conditions above are met. Durable STOP_PENDING must survive recoverable control-plane restart without silently completing or accepting new work.
- **run.bat stop** is an explicit administrative host shutdown, not an alias of graceful rg/stop, and may interrupt active work by administrator intent. **run.bat restart** is explicit administrative stop→start and returns to STANDBY (the current script calls stop then start); it is NOT unplanned crash recovery. Test this behavior. Do not auto-awake on a new Windows login.
- If boot/session identity cannot be verified at startup, **do not restore stale awake intent**. With no admitted/unresolved work, remain STANDBY; if a durable journal indicates accepted/unresolved native work, preserve its safety status as RECOVERY_UNVERIFIED/STOP_BLOCKED and reconcile the actual host/operation before tearing down dependencies. Never declare STOPPED merely because the boot probe failed.
- A stop on an idle runtime returns STOPPED and STANDBY immediately. No new work is admitted during drain, and rg/stop is not an unconditional force-kill.

### 1.4 Binding and host selection

- Maintain **one primary bound model** for a Revit host session. **Bind Current** is the intentional rebinding action; switching tabs does not rebind and does not release binding. Audit the existing use of `Document.GetHashCode()` as model identity in `RevitGptApplication.cs` and `RevitApiRouter.cs`: verify stability across managed Document wrapper churn, simultaneous documents and close/reopen; never assume a hash alone proves model identity without Revit-host evidence. Preserve explicit host-generation + document identity and fail closed on ambiguity.
- **Document-scoped** reads/writes must target the bound Document by exact host/document identity, even when another model tab is visible **where Revit API permits**. Do not accept global ACTIVE_MODEL_MISMATCH as sufficient success for these operations.
- **UI-scoped** selection, zoom, view activation, temporary visibility and other active-UIDocument operations must satisfy UI context requirements. Return a precise *operation-only* limitation when context cannot be satisfied; do not switch model or drop global binding. Verify classification against actual router tools before changing guards.
- **Multiple Revit.exe processes:** the current native listener uses fixed 127.0.0.1:8765, so P1 supports **one authoritative bridge-host/process per binding at a time**, not an invented multi-host routing system. Bind/discover using host_instance_id plus documented process ownership. A second Revit process cannot silently seize the port or inherit another host's bound model. On owner exit with a second process still alive, detect stale host, safely reconnect a newly available bridge and require explicit Bind Current before model work; never treat “some Revit.exe exists” as proof the old host/binding is healthy.
- An awake workspace may remain active without a currently usable bound model. Distinguish AWAKE, HOST_AVAILABLE and BOUND_READY in diagnostics rather than calling every state READY.

### 1.5 CR-08 to CR-12 — runtime safety contracts (amendments to sections 1.1–1.4)

**CR-08 — Unified in-flight accounting.** All tool registrations in src/index.mjs, src/managed-tools.mjs and src/revit-mcp-dev.mjs (when development mode is enabled) must pass one common admission/work tracker. Include SYSTEM reads and writes, file/library/registry changes, searches, validations and their external subprocesses, not just revitgpt_call and the native queue. Registration inventory must detect unclassified new tools and fail closed. Pure stop/status/health/reconciliation controls remain available during STOP_PENDING without deadlocking the drain. All other work (including read-only business calls) participates in the stop fence. Accepted work completes successfully or with an accurately recorded terminal failure; HTTP completion is not proof an independently launched subprocess has finished.

**CR-09 — Actual side-effect classification.** Use one verified operation-effect inventory: READ_ONLY, UI_SIDE_EFFECT, MODEL_MUTATION, SYSTEM_SIDE_EFFECT, CONTROL. Classify Native routes by method/path AND payload, not POST alone: /ui/selection/set, /ui/view/activate, /ui/show and /ui/select-related when apply=true change UI state; /ui/select-related with apply=false is read-only. The existing BridgeHttpProtocol.IsWrite(path) does not cover these side effects and applies its 2.5-second read timeout to them. Align Native timeout, Python client timeout, Node retry/response classification and outcome-tracking for UI side effects. Side-effect timeout must never trigger automatic replay, even if the RVT model transaction did not change. Preserve bounded read deadlines for genuine reads; do not blanket-increase every timeout.

**CR-10 — Prompt stop from the SAME session.** src/mcp-session-manager.mjs serializes non-GET requests per MCP transport using enqueue. Implement and VERIFY the smallest authenticated MCP-compliant priority control path for rg/stop and status that can accept a stop while a long business request from that same session is still running. Do not bypass MCP authentication/session validation, fabricate SDK results, expose an unauthenticated endpoint or move Revit API execution onto the Node HTTP thread. Atomic ordering between stop fence and normal admission must ensure earlier accepted work is counted and subsequent unrelated work rejected. If the MCP SDK or connected client cannot deliver a second request concurrently, investigate the supported existing control channel rather than silently claiming immediate same-session response. Test actual server-receipt-to-BUSY latency, not time before the client sends the request.

**CR-11 — No idle expiry does not imply orphan transport retention.** Keep workspace, awake intent and primary binding independent of transport idle age. Reclaim MCP transport/server resources only after proven protocol DELETE, confirmed closure, or verified replacement AND all its requests reach terminal state. Check sessions, pendingRecoveries, graceTimers and opChains; never close a live but quiet session on a wall-clock threshold or terminate accepted work during stale recovery. Retain recovery context, expose resource counters/cleanup reasons, stress-test connection/replacement/deletion/idle churn. Unknown liveness cannot justify silent eviction; report unverified accumulation.

**CR-12 — Crash-safe dispatch handoff.** A durable Node admission record alone does not prove Python or Native received the request. Use stable cross-layer operation ID/receipt and explicit journal states INTENT_DURABLE → DISPATCH_ATTEMPTED → NATIVE_ACCEPTED → NATIVE_EXECUTING → NATIVE_TERMINAL, plus HANDOFF_UNKNOWN for a crash or lost acknowledgement. Reconcile only against the authoritative native host generation/operation-status record; absence of a record after crash is NOT proof the operation did not run. Never replay an unknown-outcome side effect. During STOP_PENDING retain the unresolved work and display STOP_BLOCKED if recovery cannot establish terminal status. Inject crashes before/after every Node→Python→Native receipt and execution boundary. This is a P1 safety journal, NOT a P3 Job Runtime.

### 1.6 CR-13 — GSA Job authority reconciliation (read-only)

Source: GSA Memory Repo `thebimhouseinfo-sudo/GSA-Projects`, Project `01a0f866-d3a2-71db-83f1-94a0bc367b89`, current Job JSON records (2026-10-13 snapshot). IN_PROGRESS means persisted lifecycle, **not proof that a Run is currently executing**. Before any code changes, refresh SHA, current Run/Verification/cursor and dependencies. This plan does not mutate Project Memory or supersede any Job.

| Job | Persisted state / blob SHA prefix | Suggested plan disposition and conflict |
|---|---|---|
| J-8A2C (`01a10fb1-c725-702b-8a5d-32d12f2f8a2c`) | IN_PROGRESS / `6d39df6e2d54` | VERIFY_CONFLICT: old BROWSER_TTL=15m and ADDIN_MANAGED policy; reconcile with new no-idle workspace/binding policy; distinguish logical runtime from reclaimable transport |
| J-A38C (`01a11765-45d0-7355-9707-696c6f7aa38c`) | IN_PROGRESS / `9bd19f29bf3c` | VERIFY / SUPERSEDE_CANDIDATE: old pyRevit vs Unified Native selection gate; current main already contains Unified Native source; audit historical evidence rather than rerunning a decided bridge choice |
| J-8F46 (`01a129b9-c280-7233-a5a9-425defdc8f46`) | IN_PROGRESS / `9882ca57e3cb` | REUSE/VERIFY: R4.3 Phase0 read-only task reuse and gap audit; consume its available evidence, do not duplicate the full migration audit |
| J-2C75 (`01a129b7-bac3-7b59-bc87-4528cdb02c75`) | READY / `46c7bedeb0c4` | REUSE/VERIFY: prior migration-map planning/evidence; cross-check before implementing same work |
| J-2BBE (`01a116b8-a9b0-782a-8cd4-b83bdfb72bbe`) | DRAFT / `b1091beb6602` | VERIFY/DEFER: old P1B add-in design review, avoid duplicate or obsolete review gate |
| J-28D5 (`01a124f2-a90b-72d5-85c2-b9e1a2eb28d5`) | DRAFT / `8ab2f892a024` | DEFER P2: complete MCP tool catalogue review does not belong in P1 |
| J-428D (`01a12b7a-7c11-7542-a189-c6a801b6428d`) | DRAFT / `f7008d88dfff` | REUSE C0 diagnostics: distinguish observed SSE 429/ingress from local runtime; defer unrelated Scope Box capability to P2 |

**Gate A requirement:** produce a small SHA-bound job-overlap matrix: Job ID, lifecycle, Run/Verification/cursor proof or UNKNOWN, current owner, conflicting Phase Goal clause, REUSE/VERIFY/SUPERSEDE_CANDIDATE/DEFER, next action and evidence. Do not close or supersede any Job automatically; any future disposition follows authorized GSA state-change procedures and checks active Runs/dependents first. The old 15-minute logical browser lease may not silently override the present P1 Phase Goal.

### 1.7 CR-14 — Crash recovery for SYSTEM side effects

- Track every SYSTEM side-effect operation (managed/dev tools, registry, library, import/export, knowledge/run-record append) with unique work ID, target path(s), pre-state, expected post-state/hash, subprocess identity if any, and a durable stage recorded before mutation. Reconcile after Node crash against actual disk/registry state; a missing response does not mean failure or permission to retry.
- File create/edit: distinguish crash before staging, during temp write, after atomic rename and before response. Confirm final file contents/hash and matching operation provenance before terminal success. Unexpected content or concurrent external edits are outcome-unknown; do not overwrite them.
- Asset import/registration and development source edits: trace staging copy, destination replacement, registry updates, and expected manifest. A crash between phases may produce PARTIAL/NEEDS_RECONCILIATION. Compare actual files and registry entries; never blindly re-import, delete staging, roll back or label partially registered capabilities successful.
- Append operations (run_record_append, knowledge append): use an exact operation ID/marker/record evidence to detect already-appended content or partial records without duplicating a line. Keep pre-existing legacy records readable.
- Validation subprocesses: a parent HTTP/Node failure does not prove spawned Python exited. Track process/terminal evidence; reconcile or retain UNKNOWN rather than assuming child completion.
- During STOP_PENDING, SYSTEM work counts until verified terminal, including output/child-process state. Unresolved after crash means STOP_BLOCKED/NEEDS_RECONCILIATION with safe diagnostics. Do not declare STOPPED, force-retry or create a generic file rollback/Job Runtime in P1.

## 2. Source audit and exact brownfield disposition

| ID | Evidence / file | Action | Reviewer issue |
|---|---|---|---|
| A01 | revitgpt-tray.ps1 starts slim MCP and tunnel, has 5s self-heal and 2s health probe | KEEP/ADAPT; never restart healthy control plane from one brief failed probe | CR-04 |
| A02 | src/index.mjs admission currently reports REVIT_OFF and a 5s watcher only stops connected MCP | MODIFY to persist awake intent; start full MCP on later Revit arrival | CR-04 |
| A03 | src/revit-fake-cli.mjs supports discovery commands but not rg/stop | ADD global graceful stop with BUSY/status/drain semantics | CR-05 |
| A04 | src/revit-upstream.mjs callTool catch deactivates *all* upstream on any exception | FIX failure classification and bounded localized recovery | CR-01/07 |
| A05 | src/revit-upstream.mjs default 15s combined connect/listTools startup deadline | VERIFY justified startup handling; do not classify every deadline as dead runtime | CR-01 |
| A06 | src/mcp-session-manager.mjs SESSION_TTL_MS defaults 24h; includes DELETE grace and stale recovery | REMOVE idle eviction, KEEP legitimate per-transport lifecycle | CR-07 |
| A07 | src/model-authority.mjs binding probe aborts at 2500ms and requires active_id==bound_id | VERIFY/FIX operation-level guards; status probe timeout is not proof of revoked binding | CR-02 |
| A08 | NativeModelBindingState.cs ReadDenial blocks when active != bound, router forwards denial | VERIFY/FIX distinct document/UI operation classes and no wrong-model writes | CR-02 |
| A09 | BridgeHttpProtocol.cs read timeout 2500ms, write timeout 25s, 504 may mean execution continues | HIGH-PRIORITY FIX/TEST; bridge terminal-status tracking and stop drain | CR-01/05 |
| A10 | runtimes/Revit-mcp/config.py default bridge timeout 3s; connection/bridge.py WRITE_TIMEOUT=10x | AUDIT cross-layer deadline interaction and 504/error classification | CR-01 |
| A11 | BridgeDispatchQueue.cs distinguishes pending/executing and rejects non-Accepted Raise responses | KEEP/EXTEND observation; preserve running dispatcher on listener recovery; verify Pending/Denied isolation | CR-05 |
| A12 | BridgeHttpServer.cs fixed port 8765; Node process detection only checks any Revit.exe | ADAPT host identity and owner departure behavior; no silent takeover | CR-03 |
| A13 | RevitGptApplication.cs native listener Idling recovery and pane Bind Current | KEEP/VERIFY with real-host failure injection | CR-03/07 |
| A14 | src/index.mjs per-transport sessions share one upstream singleton | KEEP/VERIFY multi-chat faults and stop admission fence | CR-07 |
| A15 | docs/architecture/AUTHORITY_LIFECYCLE.md and old roadmap claim browser 15m model lease and per-chat ownership | DOCUMENT RECONCILIATION REQUIRED **before runtime code edits** | CR-06 |
| A16 | Existing scripts/test-revit-upstream-lifecycle.mjs, test-mcp-session.mjs, test-model-authority.mjs and native_http/NativeHttpTests.cs | REUSE/ADAPT; add only missing negative controls | CR-07 |
| A17 | RevitGptApplication.cs and RevitApiRouter.cs use Document.GetHashCode() for binding/document lookup and active-document equality | VERIFY identity stability, collision/wrapper/reopen behavior before any change; retain strong host+document identity | CR-02/03 |

| A18 | src/managed-tools.mjs and src/revit-mcp-dev.mjs directly register SYSTEM and development tools | ADD shared admission and in-flight accounting for every tool family, including subprocess lifetime | CR-08 |
| A19 | BridgeHttpProtocol.IsWrite excludes /ui/selection/set, /ui/view/activate, /ui/show, and conditional /ui/select-related(apply=true) | VERIFY/FIX route/payload effect map and native+Python timeout consistency | CR-09 |
| A20 | src/mcp-session-manager.mjs enqueue serializes non-GET calls per MCP session | ADD protocol-correct priority stop/status ingress, verify auth and same-session liveness | CR-10 |
| A21 | MCP sessions map stores transport/server; idle cleanup runs at 24h | REMOVE idle eviction only; add confirmed-dead/superseded transport reclamation that drains in-flight first | CR-11 |
| A22 | Node journal, Python-generated request ID and Native bridge receipt are separate handoff stages | ADD receipt-based crash-recovery contract and negative-control tests | CR-12 |

| A23 | GSA RevitGPT Project Memory includes older BROWSER_TTL, pyRevit selection and R4 Phase0 Jobs with READY/IN_PROGRESS/DRAFT states | READ-ONLY source-SHA/Run/cursor conflict mapping before P1 runtime edits | CR-13 |
| A24 | `src/managed-tools.mjs`: atomicWrite/file_edit, asset_import, registry and run_record_append; `src/revit-mcp-dev.mjs`: source mutations | Reconcile SYSTEM side effects by exact operation evidence and post-state; no blind replay or global rollback | CR-14 |

**Cross-layer timeout inventory required before changing durations:**
ChatGPT/tunnel client timeouts (inspect actual packaged/configured behavior; do not guess) → Node MCP request/SDK timeout and 15s handshake/list → Node native binding probe 2.5s → Python HTTP read 3s / write 30s by default → native bridge read 2.5s / write 25s → Revit ExternalEvent queue wait / actual API run / response. Record actual limits, cancellation semantics, error categories and request IDs for each layer. No blanket “remove all timeouts” policy.

**Canonical documentation prerequisite:** the existing AUTHORITY_LIFECYCLE.md currently declares itself the sole canonical authority and prescribes BROWSER_TTL/ADDIN_MANAGED. The new goal cannot be implemented safely while that remains authoritative. The first P1 implementation documentation change must update/replace that canonical contract and reconcile ROADMAP.md, DECISION_REGISTER.md and other active links. Preserve legacy evidence but label superseded rules. Until this prerequisite lands, this plan is the **proposed P1 contract**, not evidence that the repository is already coherent.

## 3. Implementation order, dependencies and gates

### P1-A — Baseline, architectural contract and conflict resolution

#### GOAL
Establish one canonical lifecycle/authority contract and verified source baseline, including existing GSA Job conflicts and all tool/timeout/recovery behaviors, before changing runtime code.


1. Pin current branch/HEAD and inspect actual tray/tunnel, Node (including all direct registrations in managed-tools and dev tools), Python bridge, native add-in, CI, tests and existing real-host logs. Inventory tool entrypoints and side effects. Produce KEEP/VERIFY/MODIFY/REMOVE/ADD checklist with file-to-evidence links. Do not rewrite installed add-in or tested features before targeted reproduction.
2. Deliver a single explicit lifecycle transition matrix and stop policy (including STOP_PENDING/STOP_BLOCKED, @rg during drain, boot/logon epoch, process/restart, Revit host owner, multi-chat, validated accepted-work continuations and bound model). Choose one awake-intent authority; show failure recovery and the atomic admission/stop boundary. Derive minimal work-unit registration, durable control journal and terminal signal from actual P1/MCP implementation; do not infer Job completion from chat messages.
3. **Before any runtime source edit**, converge AUTHORITY_LIFECYCLE.md and references: make the new state/authority contract canonical, mark browser 15m lease/ADDIN_MANAGED superseded, preserve historical artifacts as history, and make all active references point to one contract. No competing authority document.
4. Inventory every timer and timeout using the cross-layer table above and classify as idle expiry, startup protection, transport/health probe, queued wait, execution wait or response wait. Map UI side-effect routes, same-session command queue and orphan transport reclamation. Identify which layer can truly cancel work.
   - **A-CR13, within Gate A:** read latest GSA Job/Run/Verification/cursor SHAs, map seven still-relevant Job records to P1 contract and identify conflicts. Reuse existing R4.3 evidence instead of repeating it; do not mutate GSA Job state.
   - **A-CR14, within Gate A:** inventory SYSTEM mutation stages, file/registry/append post-state evidence and child process lifetimes. Classify existing tests vs missing negative controls, without building P3 Job Runtime.
**Gate A:** one canonical contract, no contradictory live policy, recorded baseline/timeout matrix, SHA-bound GSA Job conflict mapping and SYSTEM write-state evidence map; no Job lifecycle mutation or fabricated host PASS.

### P1-B — Awake lifecycle and recovery foundations (after Gate A)

#### GOAL
Enable explicit @rg wake, offline workspace availability and safe automatic Revit arrival/recovery without idle-based runtime termination or unjustified transport eviction.


5. Reuse tray/tunnel/slim MCP to receive @rg while STANDBY. Add global awake-intent owner with same-boot/logon recovery and rejection of stale next-boot intent. Explicit @rg with Revit OFF gives WORKSPACE_AWAKE, never REVIT_OFF with no workspace.
6. On transition to Revit available + healthy owner bridge, activate full Python MCP automatically, once, without an extra @rg. Revit exit only deactivates Revit layer. Closing chat/WebView leaves workspace/MCP awake.
7. Remove 24h idle eviction as a runtime authority mechanism; retain standards-compliant transport DELETE/stale recovery with confirmed-orphan cleanup only after every in-flight operation is terminal. Add connection churn and no-idle-disconnect tests. Prevent cold model-tool activation after rg/stop via global admission fence, including reconstructed connector sessions.
8. Review tray's 2s health probes and restarts: process-exit and repeated/evidenced unhealthy conditions must be distinguished from a briefly delayed response. Restart only the unhealthy owned component; maintain awake intent.
**Gate B:** deterministic lifecycle, clock jump, Windows reboot and crash-recovery tests green; no hidden auto-awake after explicit stop.

### P1-C — Native work visibility and fault isolation (prerequisite to graceful stop)

#### GOAL
Ensure Native and SYSTEM side-effect operations have observable, crash-recoverable outcomes; tool errors and timeouts cannot deactivate healthy runtime or silently replay work.


9. First verify actual Native route/payload side-effect classification including UI changes, then instrument existing native dispatch queue/protocol with correlation IDs and **minimal operation-state observation**: accepted, pending, executing, terminal success, terminal failure, canceled-before-start, outcome-unknown/interrupted. This is NOT a Job Runtime or capability registry. Expose a bounded safe status/quiescence probe without doing Revit API work on HTTP threads. Separate native host lifetime state from listener/HTTP request lifetime state.
10. Implement crash-consistent Node→Python→Native handoff stages and SYSTEM write post-state reconciliation, using authoritative native receipts, SYSTEM content/hash/registry evidence, HANDOFF_UNKNOWN and PARTIAL/NEEDS_RECONCILIATION. Preserve status of a write or UI side effect that timed out at HTTP **after** Revit API execution began. Ensure a Node-level call can retrieve the exact native operation by cross-layer ID despite Python generating a separate request ID today. Ensure native completion updates operation state even if Python/Node/client departed or bridge listener needs recovery. Guard against disposing an active ExternalEvent dispatcher during listener restart. Make status query robust to missed responses, duplicate IDs, stale host identity and bridge owner replacement. Never re-run a write solely to discover its status.
11. Separate application/validation errors, HTTP 4xx/5xx responses, read/write 504, SDK timeout, transport close, Python process exit, bridge listener death and Revit.exe exit in Node/Python/native. An ordinary tool exception (including native 504) must not call a global deactivate. Recovery may rebuild only a **confirmed failed** transport/process with bounded backoff.
12. Audit timeout order, UI side-effect categories and cancellation across all layers; preserve bounded detection where needed, but no healthy-layer reset on expiration. A pending queue operation may be canceled before execution when permitted; executing Revit write cannot be treated as canceled just because an HTTP waiter left.
**Gate C:** isolated failure tests, UI side-effect timeout tests, crash at Native and SYSTEM mutation boundaries, 504-after-start with continued execution, no blind replay, native/SYSTEM completion visible, next independent tool works.

### P1-D — Safe global stop and concurrency (depends on Gate C)

#### GOAL
Honor graceful stop: promptly report BUSY, reject unrelated work, preserve all accepted SYSTEM/Revit work and validated continuations, and stop only when post-crash outcomes are proven terminal.


13. Implement **atomic stop admission fence** and accepted-work accounting across every managed/dev/SYSTEM/Revit tool, multiple chats, Node/Python/native queue and minimal durable LocalAppData journal, including queued/in-flight operations. Fail closed on unclassified tools; subprocess lifetime counts until terminal. Assign IDs and persist admission *before* dispatch. Stop itself is not active work. Reject new unrelated tasks; permit validated continuation calls for an explicitly registered and nonterminal work ID; same-chat requests without the ID cannot bypass the fence.
14. **rg/stop on busy** promptly returns BUSY upon server receipt, including when a tool in the SAME session is running, through verified authenticated priority control ingress atomically coordinated with the regular MCP queue; keeps MCP/bridge alive; automatically transitions to STANDBY through an atomic quiescence check only after all admitted work units, their continuations and native operations have **known terminal outcomes**. A failed operation still counts as finished only once its terminal failure is known. @rg during drain is status-only; repeated stop requests are idempotent. No follow-up stop request is necessary.
15. **Unknown handoff/outcome, partial SYSTEM mutation, lost native host or stuck child process** must surface STOP_BLOCKED and retain diagnostics. SYSTEM terminal evidence requires matching file/hash/registry/record/process proof. Missing upstream acknowledgment cannot prove Native did not execute; reconcile exact operation/host before terminal. Do not force-stop, label graceful completion, auto-replay a write or wait forever without a visible state. Real host death is an external interruption, not successful drain. Administrative run.bat stop/restart remain clearly different commands.
16. Provide a narrow quiescence **and validated continuation-admission** integration seam for future P3 active Jobs; test with a two-step accepted-work fixture. Do not build full P3 Job Runtime in P1.
**Gate D:** offline concurrency tests with A running, B queued, stop from C or SAME session, concurrent managed SYSTEM tool and post-crash reconciliation, native 504 write still executing and an already accepted two-step work unit completing its second step during STOP_PENDING; atomic admission/stop race; @rg while draining; lost Node state reconstructed from journal+native; bridge listener restarts during execution without dispatch loss; unrelated new work denied; auto-stop exactly once after native/work terminal; external interruption visible.

### P1-E — Binding and host identity

#### GOAL
Maintain one intentional primary bound model and authoritative host, safe across tab changes, wrapper identity and multiple Revit processes, with no wrong-model work.


17. Split model operations into document-scoped vs UI-scoped according to router/API evidence; make document-scoped read/write use exact bound document independent of active tab wherever supported. Specifically audit whether Revit `Document.GetHashCode()` correctly identifies the same document across wrapper representations and reopens; if not, replace it with a verified runtime document identity scoped to a host generation before enabling inactive-document operations. Preserve strong host/document validation. UI actions may fail precisely without unbinding or acting on another model. No blanket model-operation rejection solely due to a tab switch.
18. Define and implement single bridge-host ownership using host_instance_id/process identity. Verify fixed-port conflict, second host opening, owner exit while another Revit.exe remains, bridge reconnect and explicit Bind Current. Never silently bind a model on another host.
19. Verify transport/session recreation and concurrent chats cannot steal binding; ensure independent operations survive another chat's tool error. Retain native UI-thread safety.
**Gate E:** automated authority and process-owner negative controls green; API details marked HOST_RETEST_REQUIRED until real Revit proof.

### P1-F — Acceptance and release

#### GOAL
Verify the Phase Goal through existing CI fixtures plus only missing fault-injection cases, then a single real-Revit host acceptance round; no false-green and no merge before human approval.


20. Reuse/extend test-revit-upstream-lifecycle.mjs, test-mcp-session.mjs, test-model-authority.mjs, test-bridge-health.mjs, NativeHttpTests.cs, NativeDispatchTests.cs and existing pane/route fixtures. Add targeted SYSTEM crash-reconciliation, UI side effect, same-session stop, orphan transport and handoff crash fixtures only where missing; use a read-only SHA-bound GSA Job conflict inventory. Do not duplicate equivalent tests; introduce new tests only for gaps.
21. Run available offline CI, fault-injection simulations and negative controls. Reviewer must compare goal→task→code→test→result and iterate Planner→Reviewer until PASS. Keep host tests separate; a fixture is not real Revit acceptance.
22. Perform **one consolidated real Revit round** on a safe reversible RVT, test real ExternalEvent/write execution, two open documents, two Revit processes (if available), WebView/browser multi-chat, interrupted bridge and sleep/wake. Capture actual error/timeout/binding/host evidence.
23. Only after human explicit release approval may implementation be merged/deployed. Record real host PASS/FAIL, unresolved environmental causes and rollback. Plan PASS never equals code or host PASS.

**Prerequisite graph:** A → B → C → D; A → E; B+C+D+E → F. P1 does not wait for full MCP tool-catalog verification or P2/P3 features.

## 4. Test matrix and measurable acceptance

| Test | Scenario | Expected result / proof |
|---|---|---|
| T01 | Windows boot or new logon with stale awake marker | STANDBY; no implicit @rg |
| T02 | @rg while Revit OFF; later Revit launches; closes; relaunches | WORKSPACE_AWAKE → FULLY_AWAKE → WORKSPACE_AWAKE → FULLY_AWAKE, no extra @rg |
| T03 | Idle beyond old 15m and 24h thresholds; simulated clock jump | Awake and binding unchanged; no TTL-based eviction |
| T04 | Ordinary Revit tool returns 4xx/5xx or throws while healthy transport remains | Exact tool error; MCP remains connected; next call succeeds |
| T05 | Native read exceeds 2.5s; Python read 3s timeout | Request error only; no global MCP shutdown |
| T06 | Native write exceeds 25s while Revit API has started; Python write 30s | Outcome unknown reported; no replay; native status eventually terminal |
| T07 | Chat A tool error, Chat B already running a tool | B unaffected; shared runtime stays awake |
| T08 | Chat A/B accepted work, Chat C calls rg/stop | BUSY immediately; new unrelated work denied; accepted queued/running work finishes; auto STANDBY only after completion |
| T09 | rg/stop during HTTP 504 with native write still executing | STOP_PENDING until native completion, no early stop and no duplicate write |
| T10 | One write remains unknowable due to host crash | STOP_BLOCKED/EXTERNAL_INTERRUPTION; never false STOPPED |
| T11 | Python MCP process actually exits unexpectedly | Targeted automatic recovery, awake intent/model safety preserved |
| T12 | Native bridge listener stops while Revit.exe stays live | Listener recovers; no manual @rg or forced model rebind |
| T13 | Tunnel/connector transport replaced, WebView reload or closed | No workspace/MCP deactivation or session takeover |
| T14 | Two Revit.exe processes; bridge owner exits, another remains | No inherited/stale binding; exact owner check; safe reconnect + explicit bind |
| T15 | Active tab != bound model; document-scoped operation | Targets bound model when supported; never silently targets active model |
| T16 | Active tab != bound model; UI-scoped operation | Revit-safe behavior or precise operation-only error; binding preserved |
| T17 | rg/stop with no active work; run.bat stop; run.bat restart | Stop immediate when idle; administrative semantics distinguished and tested |
| T18 | Simulated pending vs executing ExternalEvent, stopped client, timeout, duplicate request ID | No unsafe replay; no early stop; statuses accurate |
| T19 | Same-boot Node/tray crash or Windows sleep/wake | Awake-intent restores in valid session; no zombie or reconnection storm |
| T20 | Prolonged active work, then known terminal error | BUSY while active; error preserved; automatically stops only after terminal disposition |
| T21 | Accepted two-step work unit invokes next step during STOP_PENDING | Continuation allowed only for validated admitted work identity; unrelated calls (even in same chat) denied; auto-stop after work terminal |
| T22 | Admission races rg/stop or @rg arrives while draining | No accepted work is uncounted; stop cannot be canceled by @rg; no false STOPPED |
| T23 | Listener/Node restarts while a native write runs | Native dispatcher continues, journal reconciles, terminal state visible, no replay or early stop |
| T24 | Chat closes after receiving BUSY; another chat checks state | Work continues to terminal and auto-stop occurs without requiring another rg/stop |
| T25 | Journal write fails immediately before Native dispatch | No execution, request fails closed; stop work count remains accurate |
| T26 | Node tool ID differs from Python X-Request-ID; client disappears after timeout | End-to-end mapping resolves the single native write without replay |
| T27 | Boot identity unavailable but accepted native work has an unresolved journal marker | No stale auto-awake or premature teardown; recovery-safe blocked state until reconciliation |
| T28 | Revit Document wrapper changes, same-title models, close/reopen while previous binding exists | No identity collision/stale binding or cross-model reads/writes; exact host/document identity independently verified |
| T29 | Long-running managed/dev SYSTEM tool or subprocess and another chat calls rg/stop | BUSY, prior work finishes and writes preserved before STANDBY; every tool registered and tracked |
| T30 | UI select/show/activate and select_related apply=true vs false exceed original read timeout | Effect classification correct; no duplicate/replayed UI side effect; no early stop |
| T31 | Long-running tool and rg/stop sent in same MCP session | Prompt authenticated BUSY after server receipt; tool not canceled; fence orders admission |
| T32 | Forged/duplicate control and stop-vs-admission race | Security/JSON-RPC semantics intact, no unauthorized stop, no uncounted accepted work |
| T33 | Transport creation/replacement/DELETE and prolonged idle | Live idle transports remain; confirmed orphans reclaimed, diagnostic counts bounded under churn |
| T34 | MCP DELETE/recovery during active tool | No premature close of in-flight work; shared workspace/binding unchanged |
| T35 | Crash before/after Node dispatch, Python forward, Native accept, execute and response | Exact native receipt reconciles journal; no unsafe replay or false terminal |
| T36 | Crash after DISPATCH_ATTEMPTED with native receipt unprovable | HANDOFF_UNKNOWN remains unresolved/STOP_BLOCKED; no duplicate write or false STOPPED |
| H01–H06 | One real-host round: startup, long-session failure isolation, multi-chat, binding, recovery, graceful stop | Host PASS/FAIL recorded separately with evidence |

**P1 PASS** requires zero unexpected global deactivation from normal tool errors, timeouts, idle or chat churn on healthy host; no wrong-model writes; no silent replay; correct BUSY→STOP_PENDING→STANDBY semantics; no idle expiry; verified intentional stop and actual failure recovery. It does **not** require all Revit MCP tools fully implemented or all P2/P3 Jobs.

## 5. CR findings resolution ledger

| CR | Requirement adopted by Planner | Implementation/test owner |
|---|---|---|
| CR-01 | End-to-end timeout audit including native 2.5s read/25s write, Python 3s/30s, SDK/tunnel and actual ExternalEvent | P1-A4, C9–12; T05/T06/T18 |
| CR-02 | Document-scoped bound-model access separate from UI-scoped active context; not wholesale mismatch denial | P1-E17; T15/T16/T28 |
| CR-03 | One authoritative native bridge host at a time; fixed-port owner death/second process detected, no silent rebind | P1-E17/E18; T14/T28 |
| CR-04 | Awake intent survives recoverable restart in same boot/logon, not Windows restart; distinct manual commands | P1-A2, B5/B8; T01/T19 |
| CR-05 | **Human override: BUSY when work active, must finish admitted work before stop.** Native timeout is not completion | P1-C9/C10, D13–16; T08–T10/T20/T21 |
| CR-06 | Converge canonical lifecycle architecture documentation before source runtime changes | P1-A3; Gate A |
| CR-07 | Failure-injection, multiple chats, native timeout, prolonged idle and real-host acceptance with no false-green | P1-F20–23; T01–T41, H01–H06 |

| CR-08 | All SYSTEM/managed/dev/Revit tools participate in common in-flight accounting and graceful stop | P1-A1, D13, F20; T29 |
| CR-09 | Side-effect classes include Native UI changes and conditional apply flag; timeout and retry safety | P1-A4, C9–12; T30 |
| CR-10 | Same-session stop/status priority path is authenticated, nonblocking and atomically fenced | P1-A4, D14; T31/T32 |
| CR-11 | Resource reclamation for confirmed orphan transport without any runtime idle expiry | P1-B7, F20; T33/T34 |
| CR-12 | Durable Node→Python→Native receipts and safe crash-state reconciliation | P1-C10, D15; T35/T36 |

## 6. Review history and outstanding evidence

- 2026-10-13 R1–R5: initial self-review marked consistency PASS for prior plan, **not independent CR**.
- 2026-10-13 CR: **FAIL / CHANGES REQUIRED**, seven findings (two critical, five high), source-based assessment; CR verdict was communicated in chat, not verified as a persisted GSA CRITIC_REVIEW record.
- 2026-10-13 Planner rev2: addresses all CR-01…CR-07, incorporates the explicit human CR-05 stop semantics and does not extend P1 into P2/P3.
- Rev2 Reviewer finding: a STOP_PENDING fence that blocks every tool call would interrupt a previously accepted multi-step Job. Administrative restart policy and STOP_BLOCKED precedence also needed clarification.
- Rev3 Planner correction: reject unrelated new work while allowing validated continuations of accepted work; test T21; explicitly define run.bat restart as administrative return to STANDBY; STOP_BLOCKED overrides host-exit transition when stop unresolved.
- Rev3 internal check: fixed Phase Goal present, CR-01…CR-07 mapped to tasks/tests, Native completion tracked before stop, future Job continuation only a minimal interface, canonical contract conversion gated before runtime edits.
- Rev4 Reviewer findings: atomic accepted-work admission/journal, explicit terminal signal, native dispatcher lifetime separate from HTTP listener recovery and @rg behavior during drain. Corrected in rev4.
- Rev5 Reviewer follow-up: a journal write failure must fail closed before native dispatch; end-to-end correlation must bridge the Python-generated request ID; failed boot-identity verification must not drop unresolved in-flight operations; an accepted multi-step Job may await human input while STOP_PENDING. Corrected in rev5 with T25–T27; duplicate test listing removed.
- Rev6 Reviewer finding: `Document.GetHashCode()` is used as a model/document key in native code. This may work in a host process but must be validated under wrapper churn and close/reopen; add audit A17, explicit gate P1-E17 and T28. **No claim that this is a proven bug; acceptance requires evidence.**
- **Planning review PASS (2026-10-13, rev6 blob 96ee37696359fa7365874c2ca456c1ecfe6db90b):** reviewed exact persisted plan against seven CR findings and main source contract; 28 identified negative/host test cases; paths of existing test fixtures verified; ordering and scope checked; the only changed repository path is this plan. No pending planning blocker found. **This is a same-turn internal Reviewer assessment, not a persisted independent GSA CRITIC_REVIEW record or implementation/CI/host PASS.**
- Rev7 Planner: CR-08–CR-12 mapped to contract §1.5, audit A18–A22, tasks and targeted negative controls T29–T36. No phase expansion or extra human gates. New revision requires Reviewer check and independent CR re-review.
- Reviewer planning inspection of Rev7 (blob 8dce80d3f057967f900306f6565e76c25f5d7502): all twelve CR ledger entries and 36 test IDs present, all source paths verified, but six stage-local GOAL anchors were missing. Planner added concise stage goals to preserve the fixed Phase Goal in each work stage. Reviewer check still required for the amended revision.
- 2026-10-13 Rev7 internal Reviewer PASS against blob b367abce0139fab457ce4cb353a47e5f73df94c6: seven legacy CR and five new CR mapped to source and work items, 36 contiguous test IDs, six stage GOAL anchors, docs-only branch and human release gate independently re-read. **This is a planning evidence check, not a persisted GSA independent CRITIC_REVIEW or CI/real-host verification.**
- No runtime code, CI or actual Revit test changed/executed in this planning revision.
