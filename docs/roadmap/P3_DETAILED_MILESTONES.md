> **M1 identity correction (2026-10-17):** Model Anchor is **created by RevitGPT** as a Shared Parameter bound to Project Information (not assumed preexisting and not a Revit Global Parameter). Its **value** is `<sanitized model name at creation>_<yyyyMMddTHHmmssfffZ>_<8 hex random>`; once assigned it remains unchanged when the model/project name or phase changes. The Shared Parameter definition GUID identifies the field, not the model. Native and Node validators now accept this generated value, not UUID-only model keys. Real Revit build/live tests still pending.

# RevitGPT P3 — Detailed Milestones and Tasks (M1–M8)

**Date:** 2026-10-16 · **Status:** PLANNED / INTERNAL RL REVIEWED; IMPLEMENTATION NOT ACCEPTED
**Authority:** [P3 Theory V5](P3_CORE_FUNCTION_THEORY_V5.md) → [P3 Implementation Plan](P3_CORE_FUNCTION_IMPLEMENTATION_PLAN.md). This breakdown is an execution checklist, **not a new contract or a sequence of approval gates**.
**Principle:** Preserve accepted P1 binding and usable P2 MCP/Dynamo/Save. Inspect or measure unknown behavior *before* choosing a code solution; implement only the missing difference. Operator does exactly approved Job Steps. Registry is discovery only.

### Automated-work continuation — 2026-10-17

- Added **`.github/workflows/p3-offline.yml`**: Node 22 syntax + P3 Node contracts; Python 3.11 compileall + P3 Python contracts; Windows .NET compilation against CI-only Revit API 2024 references. **CI result not yet observed**; workflow creation is not a PASS.
- M8 dev tool source write/create no longer forces an execution snapshot or local acceptance stage. Optional snapshot/rollback remains available. Scoped path checks and symlink denial kept; offline `tests/p3-mcp-dev-scope.test.mjs` written.
- M3 Registry JSON writes from concurrent chats serialized inside the Node process; Saved Job duplicate IDs rejected during the same critical file edit rather than relying on a prior non-atomic read. Test `tests/p3-registry-concurrency.test.mjs` added. This is **not a Job/Tool mutex**. Cross-process shared registry writes are not yet claimed safe.
- Bound Native Project Information model ID read/init, owner-result UUID path, Dynamo owner-local preflight and Jobs continue as **source implemented, build/live unverified**.
- Open non-human issues: collect actual CI workflow result, fix any failing Node/Python/.NET checks; review shared Native dispatcher for queue/completion evidence; improve source-only Job/MCP tests where evidence supports a fix. Do not invent Dynamo graph-complete callbacks or fabricated MCP use-case repair evidence.
- Human-only end-to-end batch: one Revit 2024 install/build/test round for bound Model Anchor initialize → Save/reopen/rename; real Dynamo terminal/queue observations; new/repaired MCP tool execution and Registry; Saved/Temp Job scenarios. Preserve existing accepted P1/P2 evidence when valid.

### Remaining offline work completed in this continuation (2026-10-17)

- Created `.github/workflows/p3-offline.yml` to run Node contract tests, Python source/tests and Windows Native Revit 2024 reference compilation on pushes. This is **automation definition, not observed CI PASS** (GitHub commit check queries returned no runs/statuses).
- M1: Added `model_run_result_begin` using the **live bound Revit Model ID**, never a caller-supplied project name/ID; tests `tests/p3-model-run-result.test.mjs`. Native `NativeModelAnchor` now reports duplicate IDs across concurrently open RVTs and refuses silent overwrite. Copy/detach when not simultaneously open still needs real host policy/evidence.
- M3: Registry JSON updates serialized inside one Node process, duplicate Job registration checked within serialized edit; regression `tests/p3-registry-concurrency.test.mjs`. This is not Job execution locking and does not claim cross-process file lock.
- M4: Temp Job terminal metadata, `temp_job_finish` and `temp_job_cleanup`, with explicitly supplied retention hours, preview default, and no deletion of active Jobs; regression `tests/p3-temp-cleanup.test.mjs`.
- M5: Owner-local Dynamo Python Node graphs recognized in Python preflight and Native, while legacy staging Python Node execution remains restricted. Updated Dynamo Writer knowledge and offline `test_p3_owner_dynamo.py`. Added `dynamo_save_register` to copy a successfully tested owner-local Dynamo graph plus chosen text/data dependencies to new library and register **Dynamo only** (never Temp Job), regression `tests/p3-dynamo-save-register.test.mjs`. Binary package dependencies remain unsupported by this operation; report this rather than implying full arbitrary-package promotion.
- M8: Existing DEV source edit/create paths no longer force snapshot/accept; optional snapshot remains. Symlink traversal rejected in DEV source operations; regression `tests/p3-mcp-dev-scope.test.mjs`.
- Offline source-body syntax parsing passed on changed Node modules. **Not a substitute for `node --test`, Python unittest, .NET build or Revit live test.**
- Remaining work is concentrated in actual CI output/error resolution, Native queue and Dynamo lifecycle measurement, Revit host tests, and a grounded real-use MCP repair demo; none are marked PASS by this checkpoint.

### Consolidated test/install handoff — 2026-10-17

- New `scripts/p3-test-and-install.ps1` runs Node/Python offline tests and builds Native against locally installed Revit 2024 API; `-InstallNative` deliberately installs a new Git-SHA-versioned Native build only when Revit is closed, then restarts the tray/runtime and invokes doctor. No forced replacement of existing immutable installed binaries; preserve user `.env`.
- New `docs/roadmap/P3_HUMAN_TEST_BATCH.md` consolidates final human tests of Model Anchor, shared queue/Dynamo lifecycle, Job/Temp, MCP Dev new/repair, Registry and Knowledge.
- GitHub Actions workflow was committed but **no runs/status were returned** by workflow-status lookup in this session. Native/API compilation or runtime verification must not be inferred from source presence.
- **Handoff is NOT P3 DONE**. Autonomous/offline source work has progressed; remaining source defects, if CI/build reveals any, must be fixed from actual failures before live acceptance. Live Revit evidence is required for M1/M2/M5/M7/M8. No fabricated terminal graph completion, tool-repair case or host test results.

### Batch-first verification policy and read-only sweep — 2026-10-17

**User instruction:** Do not stop and rebuild on the first test failure. Sweep applicable non-mutating features across groups, distinguish missing input/inapplicable view/model data from actual defects, group source changes by cause, then build/install Native in one batch. One command failing does not trigger immediate human reinstall.

**Observed this sweep on bound `test.rvt`:** levels, views, families, family types, sheets, categories, system types, active view, selection, document/runtime info and annotations (with valid view ID) returned live data. Schedules and MEP systems returned empty lists, **not failures**. Sheet viewports returned an empty list. View filters returned the actual filters when called with a valid floor-plan view ID `1851551`; a sheet-based view ID was rejected as unsupported view, which is expected context, not tool breakage. Calls omitting required `view_id` yielded schema validation errors, not native defects.

**Outstanding Native build batch:** `revit_get_model_anchor` still returned HTTP 404 on installed DLL version `p3-e0b886270b` because the running binary predates the route-contract patch. Source `BridgeRouteContract.cs` now contains the two routes and `BridgeHttpProtocol.cs` recognizes initialize as a write. A source parity sweep of Python `connection/bridge.py` against current `BridgeRouteContract.cs` found **zero unmatched literal Python routes**, but installed binary requires one rebuild/reinstall and new live evidence. Do not retry this missing route against the unchanged Native binary.

**Host identity recheck:** a subsequent `revitgpt_status` and `revitgpt_binding_status` both reported `5d298eff09ca4ebbaa4354424637d764` with `VERIFIED_SINGLE_HOST_AUTO_REBOUND`; the earlier mismatch is not currently reproducible. Keep host transitions observable, but no identity code change is justified from the stale snapshot alone.

**Next testing phase:** continue related read-only groups and independent offline checks, then perform a **single** Native upgrade for accumulated changes and consolidate mutating-model tests on the disposable RVT. Do not claim Model Anchor/Dynamo/queue live PASS before this batch.

### P3 live test findings — 2026-10-17

- User initiated explicit `@rg`: FULLY_AWAKE; 72 Python tools; active/bound RVT `test` with one open project; read `revit_list_levels` returned `GF` ID `1303717`; `revit_get_active_view`, `revit_list_documents`, `revit_get_runtime_info` and `revit_get_categories` returned host data. **These read paths PASS in this observed context.**
- **M1 FAIL / root cause identified:** `revit_get_model_anchor` returned `Bridge HTTP 404: Unsupported route or method` (native operation ID `fceb0e94-a124-47f5-ad7d-2d217547cc73`). Python advertised the tool and RevitApiRouter handled it, but `BridgeRouteContract.Allowed` omitted `POST /model-anchor/read` and `POST /model-anchor/initialize`. Patched exact two allowlisted routes and classified initialize as a write in `BridgeHttpProtocol.IsWrite`; added regression checks. **Native build/reinstall/Revit restart required to retest; no claim of live PASS yet.**
- **Native host identity discrepancy:** `revitgpt_status.native_host_identity.host_instance_id` = `3295bbb431c644f6b0fe1dae6c281195` while `revitgpt_binding_status.native_binding.host_instance_id` = `5d298eff09ca4ebbaa4354424637d764` within the same check session. Investigate runtime cached host pin versus current binding identity; do not claim M1/P1 identity settled or auto-rebind.
- No model write, graph run, rename, Save or human-visible RVT mutation performed in this live session.

## Implementation checkpoint — 2026-10-17 (source, not live acceptance)

Source on GitHub `main` has progressed beyond the initial M8 prototype:

- **M1 / M4 owner bundles:** `src/owned-bundles.mjs`; `owned_bundle_create/path` and `owned_file_read/write` in `src/managed-tools.mjs`; scoped paths and no Registry prerequisite. Offline tests authored at `tests/p3-owned-bundles.test.mjs`. **Not yet verified:** authorization against a Job pretending to own another Job's ID, Windows path/junction behavior or Model Anchor identity. Do not mark M1 complete.
- **M3 capability borrowing:** `src/capability-borrow.mjs` and borrow/release/status MCP tools, plus `tests/p3-capability-borrow.test.mjs`. This is nonexclusive, in-process bookkeeping only; no claim that a Job's identity/permissions are authenticated. Registry discovery still serves catalog only.
- **M4 Job Builder/Operator:** revised `skills/jobcreate/SKILL.md` and `knowledge/jobs/JOB_RULES.md`; added `job_register_owned` for direct owner-local reusable Job registration without draft promotion. Actual Operator live execution and existing legacy tool migration remain pending.
- **M5 Dynamo:** existing Writer skill updated; Python preflight, bridge and Native `NativeDynamoLoad.cs` now accept checksum-verified graphs under owner-local Job/Temp/Dynamo bundles alongside legacy staging. Authored `tests/test_p3_owner_dynamo.py`. **Native rebuild, offline test execution and real Dynamo run/completion are still unverified.** Native currently reports dispatch, not graph termination.
- **M6 Knowledge:** `knowledge_search` prioritizes repo `knowledge/` and labels provenance when falling back to AppData observations. Authoritative knowledge write/update workflow not yet fully verified.
- **M8 MCP development:** DEV tool registration located in `src/revit-mcp-dev.mjs`; explicit Python reload and busy-call protection are committed with offline tests. Real new/repaired tool demonstrations and Registry updates remain pending.

**Additional source-level findings, 2026-10-17:** `RevitApiRouter.cs` routes `/dynamo/load` into `NativeDynamoLoad.Execute`, and `ForceRun()` yields the explicit `DYNAMO_AUTORUN_DISPATCHED_OUTCOME_UNVERIFIED` response. The code does **not** establish graph terminal completion. M2 cannot be called live PASS until the actual native dispatcher and Dynamo completion lifecycle are observed. Python `connection/bridge.py` had retained a staging-only preflight route; source patches now align Python and Native trusted owner-local paths, with P2 staging retained for compatibility. Review of model authority also confirms unknown newly introduced Python tools need their effect/binding classification updated as part of M8 registration, rather than assuming a Python reload alone exposes runnable new commands.\n\n**Further source updates (same turn):** M3 Registry now captures actual Node MCP tool registrations in `src/tool-effects.mjs` and merges them into `src/capability-registry.mjs` alongside the Python Revit manifest; tests at `tests/p3-managed-registry.test.mjs`. M4 `job_register_owned` indexes a contract directly in its library folder, `job_get` includes `JOB_STEPS` and detects a change to explicitly registered combined contract content; test at `tests/p3-owned-job-registry.test.mjs`. M6 `knowledge_user_rule_add` writes supplied rules directly into local repo `knowledge/<scope>/user-rules/`; changes still require git commit/push to reach other installs. M5 includes the narrow owner-root change in Native, Python preflight and bridge, plus offline path tests. Syntax parsing of updated Node modules succeeded when checked as stripped module bodies; **this is not a real Node test run**. The final local source C# compile and Dynamo graph run remain unverified.

**Verification boundary:** Static source review only in this checkpoint; no Node/Python/Native CI or Windows Revit live PASS observed in this implementation turn. The Windows test package should be run together when the relevant code is ready, without repeatedly reinstalling Native for each tiny edit. P3 as a whole remains IN PROGRESS. Unobserved Native queue lifecycle and Model Anchor identity remain measurements, not guessed solutions.

## Baseline and execution conventions

**Already exists (reuse first):** `src/index.mjs`, `src/model-authority.mjs`, `src/revit-upstream.mjs`, `src/managed-tools.mjs`, `src/appdata.mjs`, `src/capability-registry.mjs`, `src/dynamo-draft.mjs`, `skills/write-dynamo/SKILL.md`, `knowledge/dynamo/DYNAMO_WRITER_RULES.md`, `knowledge/jobs/JOB_RULES.md`, `skills/jobcreate/SKILL.md`, P2 Native Dynamo load/run and `revit_save_model`. Native actual queue/completion is **not yet established** by this document.

**Change accounting:** Source updates on GitHub; local user Revit is for install/live testing when needed. Record task status as `NOT_STARTED`, `IN_PROGRESS`, `SOURCE_READY`, `LIVE_VERIFIED`, `BLOCKED: <observed reason>`; never call a feature PASS from a plan or build alone. Only mark applicable states when evidenced. Existing P1/P2 evidence need not be repeated for unchanged components.

**Dependencies:** Tasks and milestones may overlap. Listed dependencies below are technical prerequisites **for a specific operation**, not phase gates. No central P3-A→G lock, fake simulator acceptance, new Job runtime/planner, Job timeout, automatic retries, approvals or registry-before-test checks.

## M1 — Model Anchor & File Ownership (P3-A)

### M1 source implementation checkpoint — 2026-10-17
- Added `NativeModelAnchor.cs` with fixed Shared Parameter GUID `60c02344-d967-4540-939d-19b5c4d774fb` and displayed name `RevitGPT_Model_ID`. The read route never writes; explicit initialize creates an Instance Shared Parameter on Project Information, assigns UUID only if missing and returns `requires_save`. The installed Revit API and compilation have **not** been verified.
- Wired routes `/model-anchor/read`, `/model-anchor/initialize` into `RevitApiRouter.cs`; Python MCP `revit_get_model_anchor` and `revit_initialize_model_anchor`, bound-model authority effects and discovery Manifest. Source tests added for generated-ID-only AppData result path derivation (`src/model-anchor-paths.mjs`).
- **Remaining:** .NET/Revit 2024 compile/install and live read/initialize/save/reopen, rename/phase tests, copied/detached-model duplicate ID handling, plus actual Native host identity lifecycle/queue measurements. Do not mark M1 DONE from these source commits alone.



**Outcome:** Correct per-model result folder and per-Job owned file operations; never bind the wrong model.

- **M1.1 [INVESTIGATE / USER DECISION 2026-10-17]** Model Anchor must identify the **RVT model using its own persistent RevitGPT ID**, never Project Name, Project Number, title, file name, phase name or path as the authoritative identifier. Revit terminology: a Global Parameter does **not** bind to Project Information; use a **dedicated Shared Parameter (instance, text) bound to the Project Information category** if the Revit 2024 API confirms creation/read/write there. Tentative name `RevitGPT_Model_ID` (confirm name and shared-definition GUID against installed code to avoid duplicates). Inspect Native binding/document identity and check existing Project Information parameters before deciding creation behavior. Observe saved RVT, rename, project phase name changes, Save As, copy/Detach and reopen; record which IDs persist and when a copied model must receive a distinct ID. Do not invent stable identity from the document title.
- **M1.2 [BUILD]** Implement the measured Project Information Shared Parameter lookup/create-once/write-once path through the existing Native Revit API and Revit queue, with RevitGPT-generated generated Model ID stored as the parameter **value**. Read by known parameter GUID, not matching the display name alone. Never overwrite an existing valid ID during normal operation. Creating the parameter is a real RVT write and must be explicit/controlled for the bound model; avoid silent mutation during read-only status or model discovery. Extend `src/appdata.mjs` model-anchor helpers and per-run result paths keyed by that ID. AppData anchor does not bind/switch models.
- **M1.3 [BUILD]** Refine `src/managed-tools.mjs` safe managed file access for owner-local reusable Job, Temp Job, standalone Dynamo and anchor result folders. Block path escapes/symlink traversal and cross-owner writes; allow read/copy from outside ownership where supported. Do not broadly grant write to all libraries.
- **M1.4 [VERIFY]** Same saved model ID survives project name/phase rename, Revit restart, and ordinary Save As. Two genuinely different models cannot collide; copied/detached-model identity policy is measured and documented (do not silently assume copy implies new or same model). Missing/duplicate/invalid parameter values fail with factual diagnostics and do not auto-overwrite. Job A/B results do not collide; foreign owned files are not edited in place.
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

## M8 — MCP Dev & Repair Capability (must complete in P3)

### M8 implementation checkpoint — 2026-10-17
- **SOURCE IMPLEMENTED (partial):** confirmed actual DEV tool registrations in `src/revit-mcp-dev.mjs` guarded by `REVITGPT_DEV_MODE`; confirmed Python MCP uses a cached stdio tool inventory via `src/revit-upstream.mjs`. Added `revit_mcp_dev_reload` to explicitly reconnect Python upstream, fetch post-reload tool names and check an optional expected tool; wired through `src/index.mjs`, classified in `src/tool-effects.mjs` and wrote `tests/m8-mcp-dev-reload.test.mjs`.
- **NOT YET VERIFIED:** Node test execution/CI result, actual Windows Python MCP reload, real new-tool/repair use cases, Revit model readback, Registry updates and Native-change reload behavior. No M8 DONE claim.
- **2026-10-17 follow-up:** reviewed shared upstream lifecycle; explicit reload could interrupt concurrent chats. Added `RevitUpstream.reloadTools()` with in-flight-call rejection, `in_flight_calls` status and targeted tests for busy rejection + idle reload. Updated `src/index.mjs` to use this safe entry point. Source committed; **Node test execution, Windows reload and Revit live verification still pending**.
- **NEXT ACTION:** run focused Node test + relevant regression, confirm DEV mode activation on intended environment, test an actual Python-tool change/reload and tool inventory; then choose a grounded new-tool and existing-tool-repair case and live test on Revit. Do not treat reload inventory as tool execution proof.



**Outcome within P3:** A **working, live-verified MCP Dev & Repair capability** exists: Builder can create a new tool, repair an existing tool (including one previously PASS but wrong for real use), load/reload the changed implementation, run a relevant live test and publish the successful capability to the discovery Registry. **M8 must reach DONE during P3.** The later expansion and improvement of the full P2 MCP toolset remains continuous and is not required for M8 DONE.

- **M8.1 [INSPECT / CR-08]** Trace all existing MCP tool registrations through repository modules, including Python MCP, upstream/native bridge and any separately exposed development surface. Check the **actual tool inventory at runtime** rather than assuming the `revit_mcp_dev_*` family is implemented: `revit_mcp_dev_root/list/read/search/snapshot/edit/create/delete/rollback/validate/accept_local` are **candidate names to verify, not confirmed available tools**. Record each actual name, entrypoint, permission boundary and capability; reuse working functions and add only the narrow missing operation. Source absence in `src/index.mjs`/`src/managed-tools.mjs` alone is not proof of absence elsewhere.
- **M8.2 [AUTHOR/REPAIR / CR-10]** Builder **either creates a new MCP tool or revises an existing tool**, including one that previously passed technical/live tests but proves semantically wrong or impractical in an actual user workflow. A prior PASS is evidence for the tested case, **not a freeze on functionality**. Diagnose the real use case, expected behavior and observed mismatch first; then change **only the source module(s) actually responsible for that tool**, preserving compatible names/signatures and working behavior. Distinguish Python-side bug, missing Native API operation and bridge routing using observed evidence; do not rewrite an untested tool speculatively. If a shared dispatcher, registration module or Native bridge really must change, inspect call sites and run focused regression checks for impacted existing tools. Keep the change narrow; this is code quality, not an approval gate.
- **M8.3 [BUILD/LOAD / CR-09]** First trace tool declaration → Python MCP registration → upstream exposure → ChatGPT tool discovery, and Native dispatch where relevant. **Measure** a controlled Python-only change: whether process reload/restart is needed, whether the name/schema becomes visible to ChatGPT, and whether a test call reaches the updated handler. Separately inspect a Native-changing tool: whether rebuilding/reinstalling the Add-in is actually required. Choose the **smallest verified reload/restart/build/install** for the changed layer. Do not claim hot reload without evidence; don't rebuild Native merely from assumption. No artificial validation/promotion approval before developer load/test.
- **M8.4 [LIVE TEST]** After verified tool visibility and routing, run the specific new/repaired MCP tool against an intentionally bound real Revit test model; check tool return and model readback where relevant. If the tool errors, report observed failure and fix root cause when requested; don't mark it PASS from registration/build/dispatch alone. Avoid blind retries of ambiguous writes.
- **M8.5 [CATALOG UPDATE]** **After a new or revised tool succeeds in its applicable actual-use test, add or update its entry in the existing Registry** (name/command ID, description, supported behavior and implementation reference). Existing entries must be refreshed after a successful repair, not left describing old behavior. Keep previous technical PASS evidence scoped to the case it covered; record the new real-use verification separately. Registry is an **index only**; it must neither authorize execution nor prevent load/test of an unregistered development tool. Detect real duplicate command names/IDs to avoid collisions, not as an approval gate.
- **M8.6 [BUILD/VERIFY]** Provide a simple per-tool status/evidence record and keep it current. Maintain a simple factual per-tool `UNTESTED / PASS / FAILED` status **with tested use-case scope**, known defect evidence and current implementation version. A tool that passed a smoke test but fails an actual workflow must be marked as a **newly observed use-case failure/limitation**, then repaired and retested for that workflow; do not erase earlier evidence or silently retain a blanket PASS. Continue testing/fixing tools when relevant work reveals an issue. Do not impose a complete 70-tool test campaign or hold P3 milestones until all tools pass.

**Done evidence per individual new/repaired tool:** source change; load/availability; successful applicable real workflow (with model readback where Revit-facing); and **Registry entry added/updated to match the successfully verified behavior**. A purely technical smoke test does not by itself prove the user workflow correct. **M8 DONE criteria within P3:** (1) existing dev tool inventory verified; (2) source edit/create + minimal load/reload callable from Builder; (3) **one newly written MCP tool** live-tested in an applicable use case; (4) **one existing MCP tool revised** to address a real-use workflow mismatch and live-tested; (5) both successful new/revised implementations added/updated in Registry and discoverable by ChatGPT; (6) clear per-tool evidence/status. If a suitable real-use mismatch has not yet been observed, explicitly report that evidence gap instead of fabricating a defect or claiming complete. **Ongoing work after M8 DONE:** iteratively expand/fix the P2 tool collection; this is not a reason to keep M8 open forever.

**Dependencies:** Uses accepted P1 binding and relevant current P2 interfaces. Join unified Revit queue for all Revit-entry test calls as that P3 behavior becomes available. M8 capability implementation proceeds alongside M1–M7 and is **required for P3 completion**, not a gate blocking unrelated authoring/live tests; a specific P3 Job that needs a missing tool may request that single M8 fix, not global MCP completion.

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
| RL-M11 | Model ID survives project renaming | Model Anchor uses a dedicated Project Information shared text parameter, subject to Revit 2024 API verification; no Project Name/path identity or silent read-time write; copied-model behavior requires evidence. |
| RL-M10 | M8 completion boundary | M8 implementation and proof of new-tool plus existing-tool repair capability are P3 deliverables. Ongoing P2 tool breadth remains independent; Registry remains post-success discovery, never a load/test gate. |

**RL verdict (M8 amendment):** **PASS — consistency of milestone design only**. CR-08/09/10 are addressed as inspect/measure/repair tasks, not claimed as already implemented. No runtime tests have been performed by this document, and no M1–M7 implementation milestone may be marked complete from planning alone.
