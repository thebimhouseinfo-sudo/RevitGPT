# RevitGPT — P3 Core Function Detailed Implementation Plan · Draft R1

**Date:** 2026-10-16 · **Status:** PLANNING / REVIEW LOOP — NOT AN IMPLEMENTATION AUTHORIZATION
**Goal:** Let ChatGPT run concurrent user-defined Jobs against one bound Revit Model while RevitGPT remains a thin execution bridge. Enable reliable Dynamo authoring and user-owned working Knowledge with the minimum mechanism needed.
**Authoritative scope:** [P3 Core Function Theory V5](P3_CORE_FUNCTION_THEORY_V5.md); [Product Goal](PRODUCT_GOAL_AND_PHASE_PLAN.md); [P1 closure](P1_STABLE_CONNECTION_CURRENT.md); [P1/P2/P3 roadmap](ROADMAP.md). Archived documents in `docs/old` are evidence, not requirements.

## 0. Verified baseline, not assumptions
- **P1:** Existing globally shared `@rg` workspace, Native bound-model authority, Host Identity, startup and multi-chat transport are accepted. Preserve them; do not reintroduce per-chat binding or STOP/journal gates.
- **P2:** Python Revit MCP and Native Revit API bridge exist. Live evidence exists for Dynamo load/run (`ForceRun`) and model save; tool correctness continues to improve independently. Do not claim every registered tool has live PASS.
- **Source inventory:** `src/index.mjs` routes tool calls; `src/model-authority.mjs` enforces Native binding; `src/revit-upstream.mjs` calls Python MCP; `src/managed-tools.mjs` already offers file, library, registry, Job draft, Dynamo and Knowledge tools; `src/appdata.mjs` defines managed paths; `src/capability-registry.mjs` combines internal/user tools. `src/dynamo-draft.mjs` supplies optional static checks. These are implementation starting points, **not yet V5-conformant**.
- **Confirmed gaps against V5:** existing Job authoring and `knowledge/jobs/JOB_RULES.md` still distinguish `direct/reasoning`; `skills/jobcreate/SKILL.md` and tools imply separate draft/promote; Knowledge source-of-truth differs from AppData-based search/promotion. Capability borrow by Job Run ID, Model Anchor and fully shared Revit FIFO need source-level implementation/verification, not assertions.
- **Readiness rule:** never equate a tool's appearance in Registry with working behavior. Existing execution surface may be extended without deleting P1/P2 features.

## 1. Minimal architecture
`User Chat(s) -> ChatGPT (Operator for registered Job, Builder otherwise) -> RevitGPT bridge -> (file capabilities | one serialized Revit-entry queue -> Native ExternalEvent/Revit/Dynamo)`.

The bridge transports/serializes requests, enforces ownership and reports factual outcomes. ChatGPT chooses next Job step; no backend autonomous Job planner, long-running Job timeout, recovery engine or automatic resume.

### Cross-cutting identity
- `model_anchor_id`: stable persisted identifier of the currently bound RVT, **not** a replacement for Native binding identity.
- `job_id`: reusable Job identifier; `temp_job_id`: local temporary bundle identifier.
- `job_run_id`: distinct per execution; optional for a direct Builder Revit-tool request.
- `capability_id`: a sharable functional handle; never exclusive tool ownership.
- `operation_id`: one Revit command submitted to the queue; links caller, model binding snapshot and result.

## 2. Implementation order, each item independently testable

### P3-A — Model Anchor and owned file operations
**Goal:** Revit model is the workspace and each run has a safe result directory.
1. Inspect existing Native document metadata and `src/appdata.mjs`; reuse the bound RVT identity and existing AppData path helpers. Decide the stable anchor mapping from **actual available identity evidence**, not a fabricated document GUID; distinguish saved path, unsaved model and renamed/moved file in tests.
2. Introduce minimal `model_anchor_get` / result-path access backed by Local AppData, keyed from the verified bound model. A model anchor cannot bind/switch models.
3. Give each Job, Temp Job and Dynamo a distinct owned directory; results sit under model-anchor/job/run. Provide safe read/copy for foreign files and write/edit/create only for an owned bundle/result area, with canonical-path/symlink checks. Reuse or narrowly extend `file_create`, `file_edit`, `library_create`; avoid a second competing file-management subsystem.
**Tests:** Same model retains anchor; different models do not collide; rename/unsaved cases are reported deterministically; concurrent Job A/B write own JSON; cross-owner write denied but read/copy works. No real Revit mock claimed as live acceptance.

### P3-B — Unified queue at Revit-entry boundary
**Goal:** ALL requests entering Revit are registered and serialized, including read, write, view/selection, Dynamo load/run and save.
1. Trace the actual `src/index.mjs -> src/revit-upstream.mjs -> Python bridge -> Native ExternalEvent` paths. Identify the **single common bridge boundary**; ensure diagnostics that do not enter Revit remain outside this queue.
2. Add or verify one FIFO dispatcher for the one bound host/model; each operation captures identity and `operation_id`, its caller/`job_run_id`, and one settled result. Do not add a second queue upstream of an already authoritative Native queue unless actual code proves the existing queue cannot serialize all Revit entry paths.
3. All Revit-facing tools (including direct Builder calls, reads, Dynamo, Save) must take the same path. The queue holds **only an operation**, never the full Job or a global tool. Before execution, verify it still targets the bound model; closing/crashing Revit produces factual failure/unknown outcome, no replay.
4. FIFO arrival ordering and head-of-line behavior must be visible enough to diagnose but should not generate a new durable Journal. Explicit operation result attribution belongs to the caller.
**Tests:** Two concurrent chats enqueue read/Dynamo/write/Save without overlap; ordered execution; per-job error isolation; tab change cannot redirect; Revit disappearance cannot execute queued writes in a newly opened host; tests against real Revit for actual Revit serialization.

### P3-C — Shared Capability ID bookkeeping
**Goal:** Parallel Jobs can use the same file/dynamo/tool functionality concurrently.
1. Reuse `src/capability-registry.mjs` and existing registered tools. Add the **smallest** `capability_borrow`/`capability_release` (and optional status) interface keyed by `job_run_id`, not by Chat ID or a locked tool instance. A capability record identifies functionality; it is nonexclusive.
2. Capability borrowing never supersedes P1 bound-model authority, filesystem ownership or Revit FIFO. Different Jobs may borrow `file.write` and write their own JSON at once.
3. On normal Job terminal result, return borrowed capability records. No crash replay, timeout-based job termination or lease renewal policy.
**Tests:** A/B borrowing same ID succeeds, no blocking of independent work; release A does not affect B; an invalid capability has an explicit error; no authorization bypass from borrowed ID.

### P3-D — Single Job contract and ChatGPT execution rules
**Goal:** Operator runs reusable Jobs exactly; Builder creates/edits/tests Jobs and executes Temp/Disposal Jobs.
1. Replace `direct/reasoning` as a Job **type** in current Job authoring tools, `knowledge/jobs/JOB_RULES.md`, `skills/jobcreate/SKILL.md` and Registry contract. Do not lose existing user data: inspect/migrate legacy metadata only when actually present; avoid rewriting unrelated Python assets.
2. Define one small `JOB.md` + `JOB_STEPS` format: user-approved goal, exact ordered steps, only step-scoped optional reasoning, referenced capability and input/output paths, final expected results. Do not insert unapproved business steps.
3. **System exception approved by user:** if any step mutates the model, Builder includes `revit_save_model` immediately after the last model-changing step, before remaining file-only steps; it enters the common queue.
4. Reusable Job drafts are written in their **owned final library folder**, are callable for live testing before Registry entry, and register only after a successful relevant live test/verification. No arbitrary approval/promote gates or moving draft folders.
5. Temp/Disposal Jobs have the same Job Steps and own AppData temp bundle (with optional Dynamo engine/data/files); Builder executes them without Registry entry. A simple clean-up policy may remove **completed/inactive temporary bundles only** after a user-specified retention interval; do not assume a number or delete Model Anchor results.
6. Operator step interpreter lives in **ChatGPT instructions/skill**, not a complex local workflow engine: PASS->NEXT; ERROR->STOP & REPORT; no unrequested retries, workflow edits or Builder takeover. A Job can be active alongside other Jobs and can wait for its queued operation without stalling their file-side work.
**Tests:** Exact approved Job Steps emitted and executed; no hidden added steps; missing required information asks clearly; step error stops only the corresponding Job; Save placement and failure propagation; parallel Job A/B; Temp Job never silently registered. Real execution on bound Revit is the decisive test.

### P3-E — Dynamo Writer thin harness and reuse
**Goal:** Builder can author/read/edit/debug real Dynamo graphs instead of producing imaginary Python-shaped `.dyn` files.
1. Add lean Dynamo coding skill + minimal local invariants, verified graph fixtures, version context and permitted official Autodesk/Dynamo reference domains. Never invent node IDs, ports, dependencies, connectors, package APIs or assume Python is a Dynamo graph.
2. Support practical graph authoring/editing within **the owning Job/Dynamo folder**. Prefer stable `.dyn` Engine + variable JSON/CSV Data without requiring separation for every graph. Preserve graph identities and user-provided data.
3. Draft Dynamo **loads/runs on real Revit immediately when requested**, even before Registry promotion. Static/schema checks and graph reasoning are optional debugging aids, never prerequisites that block a requested live test.
4. Selective Temp Job Dynamo promotion: only on explicit user instruction. Check Registry name/command-ID collision; if clear, copy engine/template/required dependencies into own library directory, adjust paths, register, verify. Conflict -> ask which resolution; no extra approval or mandatory retest of unchanged live-tested graph.
**Tests:** Create/edit one real graph and run it via verified P2 loader/runner, inspect result; reproduce and fix a real bad node/API case; edit Data while keeping Engine stable; promote one Temp-produced Dynamo, then clean Temp bundle without breaking promoted Dynamo.

### P3-F — Working Knowledge (user-provided)
**Goal:** ChatGPT can retrieve the user's actual model-use rules and system/workflow practices to write correct Jobs and Temp Jobs.
1. Make repository `knowledge/` the authoritative reviewed content; AppData can hold observations/drafts/derived index only. Inspect existing `knowledge_search`/`knowledge_promote` and adapt them, not duplicate a knowledge subsystem.
2. Classify user-supplied knowledge into Revit/model practices, HVAC/system, project-specific and Dynamo coding knowledge. ChatGPT may reorganize, deduplicate and index the supplied content, but may not invent rules or silently generalize project-specific facts.
3. Retrieval returns source path, context and sufficient provenance to distinguish a user rule from a live model observation. Unknown practice -> ask user or inspect model rather than pretend Knowledge includes it.
**Tests:** Retrieval of a supplied model workflow improves a Job/Temp Job step; correct scope for project vs global; existing knowledge remains intact; no unsupported invented HVAC rule.

### P3-G — End-to-end integrated live acceptance
**Goal:** Prove the thin bridge actually supports normal use, not an imagined sandbox.
- **Scenario 1:** Two ChatGPT chats, same Revit model. Job A and Job B both borrow the same file-writing capability, prepare separate JSON outputs concurrently, then enqueue Revit operations and Save sequentially. Neither Job holds the other's tool or model lock.
- **Scenario 2:** Operator executes one registered Job strictly in order. A deliberate step failure stops only that Job and reports the actual error; no auto retry. A mutation followed by Save persists the model.
- **Scenario 3:** Builder authors a Temp Job with Dynamo Engine + Data, runs it against the real bound model, and on user request copies/registers that Dynamo independently. No duplicate-name conflicts and no second approval gate.
- **Scenario 4:** User-supplied Working Knowledge informs a temporary workflow and Dynamo Writer uses version-grounded technical Knowledge. Verify actual model/result data, not only static JSON.
- Reuse prior P1/P2 evidence for unchanged paths; test **only changed integration boundaries** and remaining genuinely unverified functionality.

## 3. Review rules / implementation constraints
- No Job-level timeout, auto repair/retry, cross-crash resume, STOP/JOURNAL gates, standalone local reasoning engine, fake Revit simulator acceptance, global tool mutex or entire-Job queue.
- An HTTP/MCP timeout is **unknown transport outcome**, not proof that a Revit mutation did not execute. Report it; never auto replay writes.
- Fail when an actual filesystem collision/path issue/model mismatch exists; that is normal error reporting, not an artificial promotion gate.
- For code changes, targeted syntax/build tests can find real defects; **never** transform them into new approval stages before Job/Dynamo live testing.
- No need for user to repeat approval for already explicitly requested actions. Do not promote a Temp Job automatically.
- Fix P3 modules only after checking how the existing module behaves. Do not silently alter accepted P1 binding or previously live-tested P2 Dynamo/Save.

## 4. Review loop (RL) requirements
1. Reviewer maps each implementation item to an explicit section of [Theory V5](P3_CORE_FUNCTION_THEORY_V5.md), separating inherited P1/P2 mechanisms from actual P3 work.
2. Reviewer finds contradictions against live source and removes speculative modules/gates.
3. Planner repairs source-backed findings and repeats the review **until no substantive conflicting item remains**; record review iterations in this plan.
4. **Human Revit tests happen during implementation when the relevant Job/Dynamo is ready**, not as a global gate that blocks creation or testing.
5. Publishing this plan does **not** implement code, register Jobs or modify user models.

## 5. RL log
- **R1 initial:** Source comparison performed; queued for targeted review.
