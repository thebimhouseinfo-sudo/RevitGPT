# P1-A — Source Baseline, Legacy Dispositions and Verification Matrix

> **HISTORICAL EVIDENCE ONLY — 15/10/2026.** This prior P1-A audit and its CR/Journaling/stop-drain gate dispositions are **not new prerequisite gates** for implementation. Current product scope: [Product Goal & Phase Plan](PRODUCT_GOAL_AND_PHASE_PLAN.md); [Change Register](PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md). Preserve evidence, but do not require a repeat of historical GSA reconciliation before ordinary RevitGPT development.

**Scope:** P1-A only. **Owner:** RevitGPT. **Date:** 2026-10-13. **Status:** RECONCILED SOURCE & DOCS; OFFLINE CI FOR THIS IMPLEMENTATION REVISION NOT YET VERIFIED; REAL REVIT HOST NOT TESTED.

**Phase Goal:** Preserve the accepted [Rev9 P1 Phase Goal](P1_STABLE_RUNTIME_CONNECTION_PLAN.md): explicit @rg wakes a globally shared workspace, one intentional model binding across chats, no idle/ordinary-error shutdown, and rg/stop finishes all accepted work before STANDBY.

**Source pinned at audit start:** \`main@1803660b853ad9d376c065baa63b356dddd6083a\`; plan \`plan/p1-stable-runtime-20261013@97fd776ae9d2e76a7ed839ebac51d0d308cfe429\`; work branch \`work/p1-stable-runtime-20261013\` branched from the plan. Audit refers to *main source as observed*, not a claim that the new branch has passed runtime tests.

## A0. Reuse proven evidence, do not re-run old Jobs

Read-only existing GSA Phase0 outputs from \`thebimhouseinfo-sudo/GSA-Projects\`:
- \`WORK/R4-PHASE0/20261011-CONSOLIDATED/A0_JOB_DISPOSITIONS.json\`, blob \`a70f038c39a0c0455e3f03c352618999c25ce87c\` (older work-source HEAD \`4d45d4ede4768c81b16920db0a3502bff6edced4\`; 14 historical Jobs).
- \`WORK/R4-PHASE0/20261011-CONSOLIDATED/A1_GAP_AND_REUSE_MATRIX.json\`, blob \`839fe335ccb008880c1611debc085d56b934baa7\` (existing 64-tool inventory; 7 ADAPT, 4 BUILD_ON_EXISTING broader R4 workpacks).
- Prior GitHub Actions run [38107623874](https://github.com/thebimhouseinfo-sudo/RevitGPT/actions/runs/38107623874): **Node 20 and Node 24 jobs SUCCESS** on the older source revision. Verified from the run-job results; **does NOT verify current main or P1 work branch** and does not prove real Revit host compatibility.

Current GSA Job records checked at their stored blob SHAs on 2026-10-13:

| Job | Status | Blob prefix | P1 disposition (proposed only) |
|---|---|---|---|
| J-8A2C | IN_PROGRESS | \`6d39df6e2d54\` | VERIFY_CONFLICT: old browser 15m / ADDIN_MANAGED authority; no P1 reimplementation of that ownership |
| J-A38C | IN_PROGRESS | \`9bd19f29bf3c\` | VERIFY/SUPERSEDE_CANDIDATE: old pyRevit vs unified-native choice; current main has unified-native code |
| J-8F46 | IN_PROGRESS | \`9882ca57e3cb\` | REUSE earlier A0/A1 read-only evidence; no duplicate full migration audit |
| J-2C75 | READY | \`46c7bedeb0c4\` | REUSE/VERIFY previous migration map |
| J-2BBE | DRAFT | \`b1091beb6602\` | VERIFY/DEFER old P1B add-in review |
| J-28D5 | DRAFT | \`8ab2f892a024\` | DEFER complete tool catalog to P2 |
| J-428D | DRAFT | \`f7008d88dfff\` | REUSE connector 429 C0 diagnostic method; DEFER Scope Box feature to P2 |

All Jobs remain unchanged. \`IN_PROGRESS\` is a *stored lifecycle status*, not proof that a Run is currently executing. Before code tasks that would supersede a Job, re-read Run/Verification/cursor and reverse dependencies at latest SHA; evidence unavailable must remain **UNKNOWN**, never falsely ABSENT. P1-A may proceed without changing GSA Job state.

## A1. Brownfield source audit — KEEP before MODIFY

| Component | Evidence on main | Disposition | P1-specific test / negative control |
|---|---|---|---|
| \`src/index.mjs\` | Slim control plane, explicit admission, shared \`revitUpstream\`; 5s watcher only deactivates when Revit exits; no global awake-intent owner | **MODIFY carefully in B**: explicit global awake intent; Revit arrival FULLY_AWAKE without second @rg; separate workspace; preserve current tool handlers | T01/T02/T13/T19, multiple chats |
| \`src/read-intent-gate.mjs\` | Per-request native binding checks; cold Revit tool call can activate Python when process+bridge are ready | **VERIFY then ADAPT** to global Awake and STOP admission fence, never bypass known model authority | T02/T22; denied cold call after stop |
| \`src/revit-upstream.mjs\` | 15s startup/list deadline; \`callTool\` catch invokes \`deactivate()\` even on ordinary tool error (lines 121–129) | **MODIFY in C** failure classification; KEEP startup deadline until measured; do not blindly remove it | T04/T05/T06/T11, negative control that ordinary failure does not shut down all tools |
| \`src/mcp-session-manager.mjs\` | Per-transport \`sessions\` Map, \`opChains\` serialization (lines 95–104), stale recovery and DELETE grace, default 24h idle TTL (lines 9, 276–285) | **ADAPT**: runtime lifetime decoupled from transport; prompt authenticated same-session stop; validated cleanup only after in-flight terminal | T03/T31–T34 |
| \`src/revit-fake-cli.mjs\` | Read-only discovery \`rg/\`, \`rg/status\`, etc.; no \`rg/stop\` | **ADD in B/D** safe global stop/status; preserve current read-only discovery behavior | T08/T17/T31 |
| \`src/managed-tools.mjs\`, \`src/revit-mcp-dev.mjs\` | Existing file, library, registry, source-edit, append and subprocess tools registered directly; existing \`guarded\` logs do not track work drain | **ADAPT in C/D** to shared accepted work accounting and exact SYSTEM post-state reconciliation; do not rewrite working file operations | T29/T38–T41 |
| \`src/model-authority.mjs\` | Native status probe 2500ms; \`BOUND_CURRENT\` requires \`active_id===bound_id\` for every non-diagnostic tool | **VERIFY before modifying in E**; split bound-document operations vs UI operations, fail closed on uncertain document identity | T15/T16/T28, wrong-model denial |
| \`src/bridge-health.mjs\` | Native GET /health expects X-Request-ID, 2s diagnostic timeout | **KEEP** evidence-based health, distinguish transient timeout from host death | T05/T12 |
| \`revitgpt-tray.ps1\` + \`openai-tunnel.ps1\` | Tray starts Slim MCP/tunnel, 5s self-heal and 2s probes; tracks Revit processes | **KEEP/ADAPT in B** only after demonstrating a real failure; preserve secure remote admission while STANDBY | T01/T02/T11/T19, no false shutdown on one timeout |
| \`run.bat\` | \`run.bat stop\` force-stops administrative processes; \`restart\` stop→start | **KEEP** semantics distinct from graceful \`rg/stop\`; **VERIFY** cold STANDBY | T17 |
| Native \`BridgeHttpProtocol.cs\` | 2500ms read and 25s write deadlines; \`IsWrite(path)\` omits some UI effects | **ADAPT in C**, classify actual effect by path + body; no write replay | T05/T06/T18/T30 |
| Native \`BridgeDispatchQueue.cs\` | Queue and ExternalEvent run on Revit UI thread; pending cancellation differs from executing | **KEEP core dispatch**, add minimal operation status without prematurely disposing active dispatcher | T09/T18/T23/T35 |
| Native \`BridgeHttpServer.cs\` | Fixed port \`127.0.0.1:8765\`, listener can restart; no multi-host routing | **VERIFY single host owner in E**; preserve UI thread and listener rules | T12/T14 |
| Native \`NativeModelBindingState.cs\`, \`RevitGptApplication.cs\`, \`RevitApiRouter.cs\` | Native binding, explicit Bind Current and installed bridge; multiple uses of \`Document.GetHashCode()\` | **KEEP/VERIFY before MODIFY**; avoid silent rebinding or changing already tested panel | T14–T16/T28 |
| \`runtimes/Revit-mcp/connection/bridge.py\`, \`config.py\` | Python generates its own \`X-Request-ID\`; HTTP 504 may be unknown outcome | **ADAPT in C**, cross-layer ID + authoritative native status; keep true transport errors distinguished | T06/T26/T35/T36 |
| Knowledge, Job Runtime, Dynamo Writer, complete MCP tool catalog | Separate P2/P3 plan streams with existing prior A0/A1 source evidence | **DEFER** out of P1 except minimal accepted-work interface | No duplicate full Job Runtime or Dynamo tests |

**Non-goals:** do not reinstall add-in, use pyRevit, change CadGPT, re-code full MCP tools, build full P3 Job Runtime, or merge/deploy before explicit acceptance.

## A2. Timeout and operation-state matrix

| Layer | Existing observation | Risk / P1 action | Existing evidence |
|---|---|---|---|
| ChatGPT client & Secure MCP Tunnel | Remote scheduling and timeout behavior must be measured, not guessed | Keep secured control ingress; never infer local work canceled by client disconnect | Tunnel/tray tests; C0 connector 429 diagnosis remains separate |
| Node full Python MCP startup | \`initialDeadlineMs=15000\` for connect+list | Detect actual process death vs startup deadline; don't blanket disable timeout | \`test-revit-upstream-lifecycle.mjs\` |
| Node Native binding status | \`timeoutMs=2500\` | A probe timeout must not destroy previously bound model identity or global awake intent | \`test-model-authority.mjs\` |
| Node Bridge health | \`timeoutMs=2000\` | Probe timeout is not global process death | \`test-bridge-health.mjs\` |
| Python Native HTTP | read default \`3s\`; write \`BRIDGE_TIMEOUT_SECONDS*10\` (default \`30s\`) | Preserve response vs transport exceptions; retain stable correlation ID | \`test_bridge.py\` |
| Native \`BridgeHttpProtocol\` | read \`2500ms\`; write \`25s\` | UI side effect misclassified as read; 504 after execution starts may be uncertain | \`NativeHttpTests.cs\` |
| Revit \`ExternalEvent\` | Pending queue wait + Revit UI-thread execution | Pending can be canceled; executing write cannot be rolled back by HTTP cancel | \`NativeDispatchTests.cs\` |
| SYSTEM tool/child process | No shared durable completion tracker | Crash during atomic rename, import or append may leave partial/unknown changes | existing managed/dev tool code; T38–T41 missing |

**Lifecycle invariants:** after same-boot Node crash, preserve global awake intent and accepted work. After Windows reboot/new logon, **STANDBY** (no auto-resume), preserve journal and separate unresolved-work safety marker. During \`STOP_PENDING\`, allow only validated continuations of accepted work; all other business operations rejected. A process kill is not guaranteed graceful completion.

## A3. Documentation authority convergence

| Document | Action | Status in this branch |
|---|---|---|
| \`docs/architecture/LEGACY_AUTHORITY_LIFECYCLE_P0.md\` | Snapshot old source contract for evidence without changing GSA Job lifecycle | WRITTEN |
| \`docs/architecture/AUTHORITY_LIFECYCLE.md\` | Canonical P1 awake/bind/stop contract; clearly target vs implemented | WRITTEN |
| \`docs/roadmap/DECISION_REGISTER.md\` | Retain old decisions as historical and record D-27–D-38 current P1 overrides | WRITTEN |
| \`docs/roadmap/ROADMAP.md\` | Mark old TTL/per-chat/old gate sections archival for P1 | WRITTEN |
| \`docs/roadmap/DETAIL_EXECUTION_PLAN.md\` | Mark prior J-8A2C source/branch instructions archival for P1 | WRITTEN |
| \`docs/roadmap/RG-CG-ADDIN-PLAN.md\` | Preserve CadGPT, archive obsolete **RevitGPT P1** pairing/TTL semantics | WRITTEN |

**Authority hierarchy:** explicit Human-approved P1 Rev9 Phase Goal → this implementation's canonical P1 lifecycle contract → current Decision Register P1 rows → implementation evidence/tests; old sections are historical. This does **not** retroactively change a GSA Job's lifecycle.

## A4. Baseline test mapping and current gate status

Existing Windows CI workflow \`.github/workflows/p1-revit-mcp-bootstrap.yml\` runs Node 20/24, \`test-revit-upstream-lifecycle.mjs\`, \`test-mcp-session.mjs\` (local test not currently enumerated in workflow), \`test-model-authority.mjs\`, \`test-read-intent-gate.mjs\`, Native 2024 compile, Native HTTP and ExternalEvent fake dispatch, Python \`test_bridge.py\` among the broader offline suite.

**Do not duplicate these tests.** Extend only for the Rev9 test matrix T01–T41. Existing workflow push filter only selects the legacy \`work/J-AFC4-p1-revit-mcp-bootstrap\` branch and workflow_dispatch, so the new work branch needs an explicit CI trigger change before CI can validate its commits.

| Gate A requirement | Evidence | Result |
|---|---|---|
| Pin baseline and reuse source/GSA audit | main HEAD, paths/line evidence above, A0/A1 blobs | **DONE** (source-static) |
| One current canonical P1 lifecycle authority | Current authority + 5 aligned documents | **DONE** (documentation); implementation not yet verified |
| Resolve old Job status ownership without mutation | Snapshot 7 Jobs + A0/A1 evidence; SHA-pinned statuses | **DONE** for mapping; runtime supersession needs independent authorized GSA process |
| Complete timeout/tool inventory | Source matrix above; remote timeout needs real evidence | **PARTIAL** (remote/host facts UNKNOWN) |
| Current-branch offline CI and regressions | Prior older-source run success; no P1-work-branch run yet | **NOT YET VERIFIED** |
| Actual Revit host acceptance | User's installed add-in exists; no P1 host tests this turn | **NOT RUN** |

**Reviewer rule before entering B implementation:** inspect this document and the actual work branch CI, ensure no live contradicting source authority was introduced, and resolve concrete A failures (do not invent more gates). **Never claim A/B/C PASS solely because plan or docs exist.**

## Execution pointer

Approved P1 work order remains **A → B → C → D; A → E; B+C+D+E → F**. Existing tool implementations are verified first; keep all host-dependent acceptance in one human test round. Implementation/test failures remain recorded at their actual revision.
