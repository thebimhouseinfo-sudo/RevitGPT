# RevitGPT — Canonical Runtime, Model Authority & Stop Lifecycle

> **SUPERSEDED AS CURRENT P1/STOP CONTRACT — 15/10/2026.** The model-based CAD/BIM Assistant goal and simplified phase scope in [Product Goal & Phase Plan](../roadmap/PRODUCT_GOAL_AND_PHASE_PLAN.md) prevail. Use binding/host identity and healthy-layer connection concepts below as technical background; **do not** treat STOP_PENDING, STOP_BLOCKED, durable journal, reboot reconciliation or future Job continuation admission as approved product requirements or release gates. If existing code implements these, do not delete it without a separately approved impact review. See [Supersession Register](../roadmap/PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md).

**Status:** **P1 CANONICAL TARGET CONTRACT** (approved Phase Goal, 2026-10-13 Rev9). **Implementation verification: IN PROGRESS; this document does not claim the current runtime already conforms.**

**Applies to:** RevitGPT Brain/control plane, Slim MCP, Native Revit Bridge, Python Revit MCP, transport sessions, dockable panel, SYSTEM tools and future Job Runtime integration.

**Supersedes for P1:** the per-conversation authority and \`BROWSER_TTL=15m\` / \`ADDIN_MANAGED\` expiry mechanism from historical GSA J-8A2C. Preserve prior decision evidence in [archived P0 contract](LEGACY_AUTHORITY_LIFECYCLE_P0.md); this update does **not** mutate or supersede its GSA Job record. The approved Phase Goal and supporting detailed plan are [P1 Stable Runtime & Connection](../roadmap/P1_STABLE_RUNTIME_CONNECTION_PLAN.md). All other living docs must reference this contract for P1 runtime behavior; obsolete sections are historical, not competing requirements.

## GOAL — fixed P1 authority

After explicit **@rg**, RevitGPT remains available and stable until explicit \`rg/stop\` or a genuine host/lifecycle transition. A tool error, timeout, chat inactivity, WebView reload, connector/tunnel replacement or another chat must **not** deactivate healthy shared runtime or discard intentional model binding. The system isolates real failures by layer, never silently replays a side-effect with uncertain outcome, and honors graceful stop by **reporting BUSY and waiting until all accepted work finishes**.

The control plane supports **STANDBY → WORKSPACE_AWAKE → FULLY_AWAKE**, one shared intentional primary bound model and multiple independent chats. Implement P1 connection/lifecycle safety now; full Job Runtime, Dynamo Writer, tool-catalog completeness and cross-process multi-host routing remain outside P1.

## 1. Authority and runtime dimensions

**Separate state variables, never one connected flag:**

- Global **awake intent**, owned by the local control plane/tray, not any chat, token, WebView, cookie or transport.
- Runtime activation state: \`STANDBY\`, \`WORKSPACE_AWAKE\`, \`FULLY_AWAKE\` (plus \`STOP_PENDING\` during graceful drain).
- Work safety/reconciliation state: \`CLEAR\`, \`STOP_BLOCKED\`, \`RECOVERY_UNVERIFIED\`, \`NEEDS_RECONCILIATION\`. This may remain unsafe when runtime activation is **STANDBY** after a Windows reboot.
- Native host identity and bridge availability; Python MCP availability; each MCP transport/session health.
- Primary bound model identity and Revit active document/view identity (different roles).
- Accepted work IDs, in-flight/queued operation stage, associated child processes, terminal vs unknown outcome.

There is **one global primary bound Revit model per RevitGPT session**, intentionally selected through Native \`Bind Current\`. Different ChatGPT/browser/pane conversations share the same binding but cannot claim individual model ownership, steal binding or force global stop by closing their UI. Switching model or view tabs is observation only, not rebinding. No auto-rebind from active-tab changes.

**Bound document versus active UI:** document-scoped reads/writes target the validated bound Document, independent of active tab when Revit API permits. UI-scoped operations must honor active-UIDocument restrictions and may report only an operation-level mismatch, without releasing global binding or acting on another model. Unknown/ambiguous document identity must fail closed. Verify legacy \`Document.GetHashCode()\` behavior before changing that guard.

**Host identity:** the existing Native Bridge uses a fixed \`127.0.0.1:8765\` listener. P1 supports one authoritative bridge-host process at a time, tracks its identity and rejects stale host/bound model evidence. Another Revit.exe does not inherit the binding. A new native owner after old process exit requires an explicit \`Bind Current\` for model operations. Do not infer bridge identity from “any Revit.exe is running.”

## 2. Lifecycle transition contract

| Starting state | Event | New activation state / mandatory behavior |
|---|---|---|
| STANDBY | Windows startup / Revit opens / WebView opens | **STANDBY**; lightweight tray + secure remote admission/control path reachable; do NOT activate workspace/Python MCP |
| STANDBY | Explicit \`@rg\` | **WORKSPACE_AWAKE** even with Revit absent; SYSTEM/workspace tools become available |
| WORKSPACE_AWAKE | Revit arrives and valid owned bridge is ready | **FULLY_AWAKE** automatically (once per valid runtime) without second \`@rg\` |
| FULLY_AWAKE | Revit exits | **WORKSPACE_AWAKE**; disable only Revit-dependent layer; preserve awake intent and SYSTEM workspace |
| FULLY_AWAKE | Model tab/view changes, chat closes, idle, WebView reload | Stay **FULLY_AWAKE** if host/bridge remain healthy; do not rebind, release binding or global shutdown |
| WORKSPACE_AWAKE/FULLY_AWAKE | Temporary tunnel/client, bridge, Python or transport fault | Maintain intended awake state; diagnose and repair **only** genuinely failed layer; never auto-replay uncertain writes |
| WORKSPACE_AWAKE/FULLY_AWAKE | \`rg/stop\` and no accepted active/unknown work | **STANDBY**; clear awake intent; preserve safety evidence |
| WORKSPACE_AWAKE/FULLY_AWAKE | \`rg/stop\` while accepted work remains | **STOP_PENDING**; promptly report \`BUSY\`, block unrelated new work but permit validated continuations and drain |
| STOP_PENDING | All pre-fence work + approved continuations known terminal; Native/SYSTEM queues drained | Automatically **STANDBY**; do not require another stop request |
| STOP_PENDING | Operation incomplete/unknown or external host interruption | **STOP_BLOCKED** safety state with diagnostics; do not claim \`STOPPED\` or cut dependencies required for reconciliation |
| STOP_PENDING/STOP_BLOCKED | Another \`@rg\` | Return stop/recovery status only; do **not** cancel drain or wake new business work |
| Same boot/logon | Node/tray crash, transport restart or sleep/wake | Reconstruct valid awake intent and accepted work; recover only failed layers |
| New boot/logon / Windows restart | Prior awake intent exists | Activation **STANDBY**, no automatic work restart; **retain unresolved Native/SYSTEM journal and separate recovery marker** |
| STANDBY with unresolved old work | Fresh \`@rg\` | Do not replay old operations or erase uncertainty; restrict conflicting mutations until verified reconciliation |

**Important:** Native add-in may initialize its local listener whenever Revit is open. That is not a full Python MCP wake. A local status/health probe does not activate the workspace. Startup requires minimal secure control connectivity so a remote \`@rg\` can wake it.

**Administrative scripts:** \`run.bat stop\` explicitly stops owned host processes and may interrupt work; it is **not** \`rg/stop\`. \`run.bat restart\` is deliberate administrative stop→start, returns activation to STANDBY. External OS shutdown/Revit crash cannot promise graceful completion; preserve incident evidence and show true outcome status instead.

## 3. Work admission and graceful stop

1. All registered tool families (Revit MCP + managed SYSTEM + dev tools when enabled) go through a shared stop-fenced work tracker. Classify effect by reality, including \`READ_ONLY\`, \`UI_SIDE_EFFECT\`, \`MODEL_MUTATION\`, \`SYSTEM_SIDE_EFFECT\`, and \`CONTROL\`. A tool not registered/classified fails closed.
2. Atomic admission precedes dispatch and durably tracks accepted work ID, work epoch, affected path/document/host, child/continuation identities and outcome evidence. Already accepted SYSTEM and Native queue work counts as busy even if client disconnects.
3. \`rg/stop\` receives priority **through authenticated MCP-compatible control** and promptly reports \`BUSY/STOP_PENDING\` when the request has reached the control plane. A queued business request in the same MCP transport must not postpone handling \`rg/stop\` indefinitely. Do not bypass session/auth validation.
4. During STOP_PENDING accept only status/reconciliation and **validated continuation steps belonging to already admitted work IDs**; reject unrelated work (even from the same chat). Future P3 Job owners explicitly register parent ID and terminal completion; P1 does not infer job completion from chat silence.
5. **Native/side-effect timeout is not cancellation.** A timed-out write/UI change may still execute in Revit. Preserve an operation ID through Node → Python → Native, consult the native dispatcher operation state, do not retry unless authoritative proof confirms nonexecution and the caller explicitly chooses retry.
6. SYSTEM mutations (file edit/create, library import/registry updates, record append, dev edits, subprocesses) require durable pre/post-state and operation identity. After crash, verify actual filesystem/registry/process state; unexpected or partial outcomes remain unresolved; never auto-replay, auto-rollback or claim graceful completion.
7. Stop only when all accepted work including continuations/children is known terminal (success, proven failure, or canceled **before execution**) and the relevant underlying queue is drained. \`STOP_BLOCKED\` remains visible on unknown outcomes; a client HTTP error alone is not terminal evidence. A crash-recovered journal must reconcile before stop can finish.

**Reboot safety:** activation state and unresolved-work marker are distinct. On Windows restart, start **STANDBY**, do not auto-resume old work; maintain journal and recovery diagnostics independent of fresh \`@rg\`. Do not interpret an old stop-pending intent as permission to silently execute work after reboot.

## 4. Failure and timeout contract

- Inventory actual client/SDK/tunnel, Node startup & request, Native binding probe, Python bridge read/write, Native HTTP read/write and \`ExternalEvent\` queue/execution timeouts. Do **not** globally remove or increase limits to conceal failures.
- Existing Native read 2.5s, write 25s, Python bridge read ~3s/write ~30s and Node startup 15s are **baseline values to audit**, not correctness guarantees.
- UI side effects (select/show/activate, conditional apply-related selection) are not read-only; current \`BridgeHttpProtocol.IsWrite(path)\` underclassifies some routes. Actual route/payload effects decide timeout and uncertainty handling.
- A normal tool error/timeout never invokes global \`deactivate()\` on an otherwise healthy upstream. Repair process/transport only with evidence of actual failure, bounded retry/backoff and diagnostic report. Never loop through all tools to “reconcile” a side effect.
- Bridge listener restart must not dispose an active ExternalEvent dispatcher. Revit UI-thread API safety is mandatory.
- Reclaim dead/superseded MCP transport resources only after terminal in-flight work and verified closure/replacement. Healthy but idle sessions and global workspace/model binding **never** expire because of wall-clock inactivity.

## 5. Documentation precedence and historical decisions

1. Approved [P1 plan](../roadmap/P1_STABLE_RUNTIME_CONNECTION_PLAN.md) fixes the Phase Goal/scope/tests. This file defines the **single current target authority/lifecycle contract**. The plan is a scheduled implementation, **not proof of code pass**.
2. [Decision Register](../roadmap/DECISION_REGISTER.md) records current P1 overrides while retaining historical decision provenance. [Roadmap](../roadmap/ROADMAP.md) retains the older J-8A2C/P1B/E4 wording **as superseded history**; its old TTL, per-chat model lease and immediate rg/stop release do not govern P1.
3. [Archived authority](LEGACY_AUTHORITY_LIFECYCLE_P0.md) is historical evidence only. Reconcile the old GSA J-8A2C, J-A38C, J-8F46 and related READY/DRAFT jobs by current SHAs/Run/cursor evidence. Do not mutate GSA Job lifecycle as a side-effect of documentation migration.
4. Fully separate future Job Runtime/Skills, Dynamo Writer authoring, complete MCP tool-catalog development and production licensing are **not** part of this P1 lifecycle implementation.

## 6. Verification and release meaning

- **P1-A:** test inventory, source/evidence dispositions and aligned canonical docs; only existing code verification, no false implementation claim.
- **P1-B:** deterministic awake intent/boot epoch, clean STANDBY and seeded unresolved marker contract; **does not require P1-C journal before B**.
- **P1-C:** actual request/side-effect journal, failure isolation, Native and SYSTEM crash/timeout tests, simulated Windows reboot with persisted unresolved marker.
- **P1-D:** authenticated same-session prompt BUSY, stop fence/continuation correctness and all-work drain.
- **P1-E:** bound model versus active tab, strong Native host identity and wrong-model negative controls.
- **P1-F:** reuse CI and add only missing negative controls, then **one consolidated human Revit test round** including safe controlled reboot; never claim offline CI establishes Revit API host safety.

No merge/deployment without explicit human release approval. A CI success means only the tested revision passed those actual checks.
