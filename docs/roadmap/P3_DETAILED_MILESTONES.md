# RevitGPT P3 — Detailed Milestones and Tasks (M1–M7 + continuous M8)

**Date:** 2026-10-16 · **Status:** PLANNED / INTERNAL RL REVIEWED; IMPLEMENTATION NOT ACCEPTED
**Authority:** [P3 Theory V5](P3_CORE_FUNCTION_THEORY_V5.md) → [P3 Implementation Plan](P3_CORE_FUNCTION_IMPLEMENTATION_PLAN.md). This breakdown is an execution checklist, **not a new contract or a sequence of approval gates**.
**Principle:** Preserve accepted P1 binding and usable P2 MCP/Dynamo/Save. Inspect or measure unknown behavior *before* choosing a code solution; implement only the missing difference. Operator does exactly approved Job Steps. Registry is discovery only.

## Baseline and execution conventions

**Already exists (reuse first):** `src/index.mjs`, `src/model-authority.mjs`, `src/revit-upstream.mjs`, `src/managed-tools.mjs`, `src/appdata.mjs`, `src/capability-registry.mjs`, `src/dynamo-draft.mjs`, `skills/write-dynamo/SKILL.md`, `knowledge/dynamo/DYNAMO_WRITER_RULES.md`, `knowledge/jobs/JOB_RULES.md`, `skills/jobcreate/SKILL.md`, P2 Native Dynamo load/run and `revit_save_model`. Native actual queue/completion is **not yet established** by this document.

**Change accounting:** Source updates on GitHub; local user Revit is for install/live testing when needed. Record task status as `NOT_STARTED`, `IN_PROGRESS`, `SOURCE_READY`, `LIVE_VERIFIED`, `BLOCKED: <observed reason>`; never call a feature PASS from a plan or build alone. Only mark applicable states when evidenced. Existing P1/P2 evidence need not be repeated for unchanged components.

**Dependencies:** Tasks and milestones may overlap. Listed dependencies below are technical prerequisites **for a specific operation**, not phase gates. No central P3-A→G lock, fake simulator acceptance, new Job runtime/planner, Job timeout, automatic retries, approvals or registry-before-test checks.

## M1 — Model Anchor & File Ownership (P3-A)

**Outcome:** Correct per-model result folder and per-Job owned file operations; never bind the wrong model.

- **M1.1 [INVESTIGATE]** Read Native binding/document identity outputs and P1 host identity code. Observe a saved RVT, another RVT, unsaved document, Save As and reopen/restart where feasible. **Record** which identity fields persist/change and how model mismatches are reported. **Decide** anchor derivation only from this evidence; do not invent a Revit model GUID.
- **M1.2 [BUILD]** Extend `src/appdata.mjs` helpers for model anchor and Temp Job paths. Check whether paths already exist before editing. Create anchor metadata and run-specific result paths in AppData. Anchor cannot mutate model binding.
- **M1.3 [BUILD]** Refine `src/managed-tools.mjs` safe managed file access for owner-local reusable Job, Temp Job, standalone Dynamo and anchor result folders. Block path escapes/symlink traversal and cross-owner writes; allow read/copy from outside ownership where supported. Do not broadly grant write to all libraries.
- **M1.4 [VERIFY]** Same saved model maps consistently, two models do not collide, unsaved/Save As behavior matches chosen rule, Job A/B output folders do not collide, a foreign owned source is not edited in place.
- **Done evidence:** Actual identity observations, documented anchor rule, model/result paths and focused ownership tests. **Unknown identity behavior stays flagged, not guessed.**

## M2 — One Unified Revit Execution Queue (P3-B)

**Outcome:** Revit-facing calls FIFO-serialized on the bound host; same queue covers reads, writes, UI, Dynamo load/run and Save without locking whole Jobs.

- **M2.1 [INVESTIGATE]** Trace `src/index.mjs` → `src/revit-upstream.mjs` → Python MCP → Native listener/ExternalEvent. List all Revit-entry routes (including Native diagnostics that use Revit API), current dispatch/queue boundaries and any bypass.
- **M2.2 [MEASURE]** Run controlled overlapping read/write calls on an intentionally bound test model. Capture arrival/start/terminal times and host/model identity. Determine whether an existing dispatcher already provides single-operation FIFO end-to-end.
- **M2.3 [MEASURE]** For Dynamo on Revit 2024, observe **dispatch, actual graph start, actual graph end/fail/cancel, host close**, and what remains active after an HTTP timeout/UNKNOWN. Do not assert an unobserved completion event. Record difference between dispatch acknowledgment and termination.
- **M2.4 [DECIDE & BUILD]** After M2.1–3 evidence: reuse existing proven Native queue if sufficient; otherwise patch only uncovered entry routes/terminal tracking. Attach `operation_id`, caller/`job_run_id` (if any), verified binding snapshot and settled result. The queued unit is a Revit **operation**, not a Job.
- **M2.5 [HANDLE UNKNOWN]** Dynamo UNKNOWN is **not** termination. Do not release its slot for another Revit operation until termination/session end has been established. No blind retry, replay, Job timeout or guessed fallback. If host lacks an observable terminal event, document observed gap and implement/verify the smallest correct completion mechanism; do not assert success merely because dispatch returned.
- **M2.6 [VERIFY]** Two chats submit interleaved read/Dynamo/write/Save. Confirm FIFO, no overlapping Revit execution, no dispatch-only premature release, failure isolated to owning Job, correct binding across tab changes, and no stale write execution after host restart.
- **Done evidence:** Measured Native route/queue behavior and real-host ordering/terminal outcomes. Offline tests only verify narrow code logic, not actual Dynamo completion.

## M3 — Registry Discovery & Shared Capability Borrowing (P3-C)

**Outcome:** ChatGPT gets a fast catalog of available MCP tools/reusable Dynamo/Saved Jobs; multiple Jobs use the same capability concurrently without tool locks.

- **M3.1 [INVESTIGATE]** Inspect `src/capability-registry.mjs`, `registry_list/search/get`, current registry record types and query path. Measure search behavior if choosing additional indexes; do not add a cache without demonstrated need.
- **M3.2 [BUILD]** Adapt/reuse Registry as a discovery index containing the minimal name, command ID, type, description and lookup location needed for ChatGPT selection. New reusable asset Save/Register updates catalog. **Registry cannot deny owner-local draft, Temp Job, standalone Dynamo live test or direct available tool calls.**
- **M3.3 [BUILD]** Minimal nonexclusive capability borrow/release scoped to `job_run_id`, using the same tool across different Jobs. Borrow records do not grant model authority, filesystem ownership or tool exclusivity.
- **M3.4 [VERIFY]** Registry lists existing tools/Dynamo/Saved Jobs; missing/stale entry reports discovery issue rather than an execution gate. Job A and B borrow identical capability and write distinct JSON concurrently. Releasing A does not affect B. Duplicate name/command-ID detection protects existing catalog entries only at requested registration.
- **Done evidence:** Registry discovery and concurrent borrowing verified without introducing permission/promotion approvals.

## M4 — One Job Contract; Operator + Builder/Temp Jobs (P3-D)

**Outcome:** One Job format and two lifecycles; Operator strictly executes Saved Jobs; Builder authors and runs Temp Jobs.

- **M4.1 [INVESTIGATE]** Inspect legacy Direct/Reasoning `job_*` tools, `knowledge/jobs/JOB_RULES.md`, `skills/jobcreate/SKILL.md`, managed Job metadata and actual user Jobs before changing formats. Migrate **only actual existing records**, preserving usable files.
- **M4.2 [BUILD]** Minimal `JOB.md` + `JOB_STEPS` convention: requested goal, ordered user-approved actions, optional step-scoped reasoning, inputs/results and observable success/error. No new business steps, complex schema, approval or second local planner.
- **M4.3 [BUILD]** Author/revise reusable Job **directly in its owned library bundle**; live load/run/test before catalog registration. Do not require separate draft location, validation or promotion workflow.
- **M4.4 [BUILD]** Implement Temp/Disposal bundle area: Job steps plus optional Dynamo engine/data/supporting assets. Builder can execute Temp Job without Registry. Results owned per run under model anchor, never auto-register Temp Job.
- **M4.5 [BUILD]** Codify in the existing ChatGPT-facing Job rules/skills: `Step PASS → Next`, `ERROR/UNKNOWN → Stop and Report`; no auto-retry, no spontaneous switch from Operator to Builder. If Job modifies RVT, Builder includes the **one user-authorized system Save step** immediately after final model mutation, even when file-only steps follow. No Save for read-only Job.
- **M4.6 [BUILD LATER, NO NEW ENGINE]** Choose only a simple configurable temporary-bundle retention policy; delete only inactive/completed Temp bundles, not separately promoted Dynamo nor model results. Retention interval **not user-specified yet**, so do not invent a number.
- **M4.7 [VERIFY]** Exact Saved Job step order, stop/report on failure, step-scoped reasoning only, Save timing, Temp Job run without Registry, no extra steps, no cross-owner edits and no lost files.
- **Done evidence:** One genuinely reusable Job and one Temp Job exercised on an intentionally bound real model; errors behave as specified.

## M5 — Existing Dynamo Writer Harness, Draft Execution & Promotion (P3-E)

**Outcome:** Builder writes/repairs real Dynamo graphs using grounded signatures; owner-local drafts run on Revit without any registry/validation/staging gate; user can save/register a useful Temp Dynamo.

- **M5.1 [REUSE/ADAPT]** Refine existing `skills/write-dynamo/SKILL.md`, `knowledge/dynamo/DYNAMO_WRITER_RULES.md`, `src/dynamo-draft.mjs`. Ground graph node/port/connector signatures in same-version graph or official Dynamo/Autodesk sources; distinguish DesignScript, Dynamo graph JSON, Python Nodes and Revit API. No second harness and no invented APIs.
- **M5.2 [BUILD]** Support `.dyn` authoring/editing inside its owner Job/Temp/Dynamo folder. Engine + data file preferred where practical; preserve working graph metadata and dependencies.
- **M5.3 [BUILD]** Adapt current P2 load/run path as needed to accept owner-local `.dyn` for live test **before Registry**, without mandatory validate-stage-approve workflow. Optional diagnostics remain callable.
- **M5.4 [VERIFY]** Live load/run/readback on Revit 2024, distinguishing accepted dispatch from real execution completion (M2 evidence). Bad node/API case should produce grounded error evidence; no invented success.
- **M5.5 [BUILD]** On user instruction “Save/Register this Dynamo”: check name and command-ID collision; copy engine/template/actual needed dependencies from Temp bundle into independent Dynamo library folder; fix paths; register catalog entry; verify copied files/entry. Do **not** copy the entire Temp Job or demand another approval. Previously live-tested unchanged Dynamo does not automatically require retest.
- **M5.6 [VERIFY]** Promoted Dynamo remains usable independently after Temp bundle cleanup. Collision produces a clear choice instead of unapproved overwrite.
- **Done evidence:** One verified owner-local graph and one explicitly requested standalone catalog registration.

## M6 — Working Knowledge (P3-F)

**Outcome:** User-supplied Revit/HVAC/system/workflow rules are organized and retrievable reliably; no hallucinated domain rules or stale AppData shadow copies.

- **M6.1 [INVESTIGATE]** Read `src/appdata.mjs` `seedFile`, `knowledge_search`, `knowledge_promote` and actual `knowledge/` tree. Observe how new/changed knowledge source becomes visible when running and after restart. Do not assume automatic source→AppData synchronization.
- **M6.2 [BUILD]** Retain repository `knowledge/` as the source-controlled authoritative content of user-provided rules. Let ChatGPT classify/reorganize user knowledge by Revit, HVAC, project scope and Dynamo technical coding. When the user supplies a rule, ensure the runtime lookup sees that authoritative change via the simplest verified means; derived cache only if beneficial.
- **M6.3 [BUILD]** Keep official reference-domain guidance for Dynamo; store only core coding invariants and verified examples locally. Do not crawl entire docs or substitute general Python know-how for Dynamo.
- **M6.4 [VERIFY]** A new user rule and a changed rule become retrievable; project-specific rule stays scoped; source and cached/observed notes are distinguishable; a real Temp Job/Job uses supplied workflow rather than invented HVAC assumptions.
- **Done evidence:** Traceable retrieval of user-authored source Knowledge with no stale shadowing.

## M7 — Focused Revit integration acceptance (P3-G)

**Outcome:** Demonstrable daily workflows, using only changed P3 boundaries and known-good P1/P2 paths.

- **M7.1** Two separate chats on same Revit 2024 model: concurrently prepare owned JSON files; borrow same capability, enqueue model operations FIFO; correct per-run output/return routing.
- **M7.2** Saved Job: run user-approved steps in order; introduce controlled single-step error; Operator stops and reports only that Job. For a successful write Job, Save runs after final mutation and persists RVT.
- **M7.3** Temp Job: Builder drafts real Dynamo Engine + Data, live runs it, checks actual outcome, then upon user's explicit instruction copies/registers standalone Dynamo. Temp cleanup does not affect registered Dynamo/results.
- **M7.4** Working Knowledge: user-supplied Revit/HVAC convention reflected accurately in Job/Temp Job and actual model result. No invented rules.
- **M7.5** Record exact P3 changes tested, host/model identities, relevant `operation_id`/results, observed PASS/FAIL/UNKNOWN. Do not re-run all P1/P2 merely for milestone paperwork.
- **Done evidence:** Human-visible live Revit readback for changed core behavior; a compile/CI PASS alone is not a real-host PASS.

## M8 — P2 MCP Tool Development & Live Repair (continuous side work)

**Outcome:** RevitGPT can incrementally add, adjust, load and test Revit MCP tools during ordinary operation. P2 tool coverage remains a **long-term, independent workstream**, never a prerequisite to completing P3.

- **M8.1 [INSPECT / CR-08]** Trace all existing MCP tool registrations through repository modules, including Python MCP, upstream/native bridge and any separately exposed development surface. Check the **actual tool inventory at runtime** rather than assuming the `revit_mcp_dev_*` family is implemented: `revit_mcp_dev_root/list/read/search/snapshot/edit/create/delete/rollback/validate/accept_local` are **candidate names to verify, not confirmed available tools**. Record each actual name, entrypoint, permission boundary and capability; reuse working functions and add only the narrow missing operation. Source absence in `src/index.mjs`/`src/managed-tools.mjs` alone is not proof of absence elsewhere.
- **M8.2 [AUTHOR/REPAIR / CR-10]** Builder **either creates a new MCP tool or revises an existing tool**, including one that previously passed technical/live tests but proves semantically wrong or impractical in an actual user workflow. A prior PASS is evidence for the tested case, **not a freeze on functionality**. Diagnose the real use case, expected behavior and observed mismatch first; then change **only the source module(s) actually responsible for that tool**, preserving compatible names/signatures and working behavior. Distinguish Python-side bug, missing Native API operation and bridge routing using observed evidence; do not rewrite an untested tool speculatively. If a shared dispatcher, registration module or Native bridge really must change, inspect call sites and run focused regression checks for impacted existing tools. Keep the change narrow; this is code quality, not an approval gate.
- **M8.3 [BUILD/LOAD / CR-09]** First trace tool declaration → Python MCP registration → upstream exposure → ChatGPT tool discovery, and Native dispatch where relevant. **Measure** a controlled Python-only change: whether process reload/restart is needed, whether the name/schema becomes visible to ChatGPT, and whether a test call reaches the updated handler. Separately inspect a Native-changing tool: whether rebuilding/reinstalling the Add-in is actually required. Choose the **smallest verified reload/restart/build/install** for the changed layer. Do not claim hot reload without evidence; don't rebuild Native merely from assumption. No artificial validation/promotion approval before developer load/test.
- **M8.4 [LIVE TEST]** After verified tool visibility and routing, run the specific new/repaired MCP tool against an intentionally bound real Revit test model; check tool return and model readback where relevant. If the tool errors, report observed failure and fix root cause when requested; don't mark it PASS from registration/build/dispatch alone. Avoid blind retries of ambiguous writes.
- **M8.5 [CATALOG UPDATE]** **After a new or revised tool succeeds in its applicable actual-use test, add or update its entry in the existing Registry** (name/command ID, description, supported behavior and implementation reference). Existing entries must be refreshed after a successful repair, not left describing old behavior. Keep previous technical PASS evidence scoped to the case it covered; record the new real-use verification separately. Registry is an **index only**; it must neither authorize execution nor prevent load/test of an unregistered development tool. Detect real duplicate command names/IDs to avoid collisions, not as an approval gate.
- **M8.6 [ONGOING]** Maintain a simple factual per-tool `UNTESTED / PASS / FAILED` status **with tested use-case scope**, known defect evidence and current implementation version. A tool that passed a smoke test but fails an actual workflow must be marked as a **newly observed use-case failure/limitation**, then repaired and retested for that workflow; do not erase earlier evidence or silently retain a blanket PASS. gradually test/fix tools when relevant work reveals an issue. Do not impose a complete 70-tool test campaign or hold P3 milestones until all tools pass.

**Done evidence per individual new/repaired tool:** source change; load/availability; successful applicable real workflow (with model readback where Revit-facing); and **Registry entry added/updated to match the successfully verified behavior**. A purely technical smoke test does not by itself prove the user workflow correct. **M8 as a whole remains OPEN/CONTINUOUS**; never define a finish line requiring all MCP tools to be implemented.

**Dependencies:** Uses accepted P1 binding and relevant current P2 interfaces. Join unified Revit queue for all Revit-entry test calls as that P3 behavior becomes available. M8 development proceeds independently of M1–M7; a specific P3 Job that needs a missing tool may request that single M8 fix, not global MCP completion.

## Practical parallelization / actual dependencies

- M1 path ownership can proceed alongside M3 Registry, M5 skill/Knowledge authoring, M6 Knowledge and continuous M8 MCP authoring/repair, without waiting for Native queue investigation.
- M2.1–3 must precede **selection of a queue implementation**, not general P3 file/Job/Dynamo authoring.
- M1 ownership is needed for true owner-local M4/M5 authoring; reuse existing capabilities where they already suffice.
- M2 observed Dynamo completion is needed before claiming M5/M7 **real-host synchronized run** PASS, but is not a gate to drafting a graph.
- M3 discovery is **not** a prerequisite to running/temp-testing an unregistered asset; Borrow IDs may be used whenever the minimal bookkeeping is ready.
- M7 integrated tests run when their corresponding functions exist; they are not bureaucratic approval for unrelated implementation.

## Forbidden scope and common failure modes

Do not add a Job runner/reasoning daemon, project-wide mutex, exclusive tool lease, durable replay journal, Job timeout, auto retry, separate Dynamo draft-to-library promotion path, fake Revit sandbox, obligatory Validate/Stage, approval after user Save/Register, Registry authorization or test every MCP tool to consider a P3 feature live-ready.

Actual Revit binding mismatch, cross-owner write, filesystem missing path, Dynamo still running, and duplicate Registry name/command ID are **real operational errors**; report them rather than inventing workflow approval gates.

## Self-review loop (milestone plan only)

| Cycle | Review question | Finding / resolution |
|---|---|---|
| RL-M1 | Theory V5 completeness | All 12 theory sections mapped; P1/P2 evidence kept distinct from P3 unimplemented work. |
| RL-M2 | Previous CR findings 01–07 | Existing Dynamo harness reused; pre-run gates removed; Knowledge authority fixed in plan; Dynamo UNKNOWN not treated as completion; no forced phase chain. |
| RL-M3 | Unknowns and measurement | Native queue routes, graph completion, anchor identity, Registry behavior and Knowledge sync are explicit INVESTIGATE/MEASURE tasks; solutions chosen only from evidence. |
| RL-M4 | Gate and workflow audit | No new Job approval gate, second Dynamo harness, mandatory validation/staging, global tool locking, recovery/retry or fake CI acceptance. |
| RL-M5 | Overlap / achievable delivery | Workstream dependencies narrowly specified; P1/P2 functions reused; results from one focused scenario reused across overlapping M1–M7 tests rather than duplicating live work. |
| RL-M6 | P2 ongoing MCP development | M8 audits actual dev-tool availability before reuse; per-tool write/load/live-test/repair; no all-tools PASS gate or Registry authorization. |
| RL-M7 | CR-08 through CR-10 | Added source + runtime discovery inventory, observed reload/visibility test, and narrow shared-code regression checks. No unverified `revit_mcp_dev_*` availability claim remains. |
| RL-M8 | Gate and evidence regression | Observations precede decisions; no hot-reload assumption, no second promotion/approval path, no full-MCP completion dependency or fake live PASS. |
| RL-M9 | User real-use requirement | Previously tested tools remain editable when actual usage reveals semantic mismatch; post-fix real-use verification updates Registry and scoped tool evidence, without Registry-before-test gate. |

**RL verdict (M8 amendment):** **PASS — consistency of milestone design only**. CR-08/09/10 are addressed as inspect/measure/repair tasks, not claimed as already implemented. No runtime tests have been performed by this document, and no M1–M7 implementation milestone may be marked complete from planning alone.
