# RevitGPT — P3 Core Function: Theoretical Contract V5

**Status:** HUMAN DESIGN DECISIONS CONSOLIDATED · 2026-10-16 · **NOT an implementation plan**.
**Purpose:** A concise, authoritative theoretical description of how RevitGPT is meant to work before technical planning. Decisions below supersede conflicting older drafts. Implementation and live acceptance are separate.

## 1. Product identity
- **ChatGPT is the brain.** Reasoning, interpretation, execution of Job steps, authoring and debugging belong to ChatGPT.
- **RevitGPT is an execution bridge.** It exposes Revit MCP, Native Revit API execution, file operations, capability metadata, model anchors and a unified Revit operation queue. It is not a second planner.
- **Workspace for Main Work is the bound Revit Model.** Main Work: run Jobs, run Dynamo, call Revit tools. Side Work: author/edit Jobs and Dynamo, maintain MCP, and read/write/edit JSON, Excel and other files.
- Ask a clarifying question before deep reasoning **only when an essential ambiguity affects the result**. Otherwise execute directly. Minimize hallucinations, excessive reasoning, unsolicited advice and invented workflow steps.

## 2. Two execution roles
**Operator:** Dedicated low-reasoning executor of registered/reusable Jobs. Read the exact approved `JOB.md` and `JOB_STEPS`; perform steps in order. Reason *only* if an individual step explicitly requires it. `STEP PASS -> NEXT`; `STEP ERROR -> STOP and REPORT`; all steps pass -> Job Done. Never insert, reorder, skip, retry or repair steps autonomously; never silently switch roles.

**Builder (working name):** Handles everything else, including writing/editing/testing Jobs or Dynamo, repairing MCP when requested, file work, and executing **Temp/Disposal Jobs**. Reason only as much as necessary; inspect evidence, ask only when essential, and address root causes rather than adding infrastructure. A Temp Job is still an explicit workflow, not ad-hoc unstructured commands. Builder may *nominate* new workflow steps, but may not adopt them into `JOB.md`/`JOB_STEPS` without user approval.

## 3. Job forms and file ownership
There is **one Job format**, not separate Direct/Reasoning Job types. Two lifecycles:
- **Reusable Job:** Own folder with `JOB.md`, `JOB_STEPS` and its own bundle (Dynamo, engine, data, scripts, assets as needed). Create/edit/draft **in that owned folder**. Live test on a real Revit Model; upon verification, register for Operator use. Registry is discovery, not a gate to live testing.
- **Temp/Disposal Job:** Same clear step workflow, executed by Builder; own temporary folder and bundle. Do not register/promote the Job. Retain temporarily then clean **completed, inactive** temporary bundles after a configured retention period (duration not yet specified). Never delete model results or a separately promoted Dynamo when clearing the temp bundle.
- Job/Dynamo ownership permits creating/editing files **inside its owned folder** and appropriate result location under Model Anchor. Files it does not own may only be read or copied; to edit external content, copy it into an owned area first. Enforce actual canonical paths rather than trusting textual filenames.
- Distinct Job runs/results must not silently overwrite each other.

## 4. Model Anchor
Each Revit Model gets a persistent **Model Anchor** identifier and dedicated Local AppData directory, analogous to CadGPT's Drawing Anchor. Anchor records model identity and offers per-Job/per-run result locations. Binding authority remains with the already established Native binding mechanism; anchors do not silently choose or rebind models. Exact folder naming and stable identity derivation belong to implementation design, not this theory.

## 5. Dynamo authoring, execution and reuse
- Favor **Dynamo for batch Revit changes** over hundreds of individual MCP calls.
- Prefer a stable Dynamo **Engine** (`.dyn`) and separately changing **Data** (e.g., `.json`, `.csv`, or another supported input) where practical; separation is a preference, not a rejection gate.
- A thin **Dynamo Writer harness** supports Builder with targeted skills, core coding rules, technical Knowledge, verified examples and reference lookup. Distinguish Dynamo graph JSON, DesignScript, Dynamo Python Nodes and Revit API contexts. **Never invent nodes, ports, connectors, package names or API contracts; do not substitute arbitrary Python logic for valid Dynamo graph semantics.**
- Keep essential version-aware Dynamo invariants in source Knowledge and research details on demand in official Dynamo/Autodesk documentation (e.g., primer.dynamobim.org, developer.dynamobim.org, dynamobim.org, help.autodesk.com). No mass crawl/mirror required.
- **Real Revit live load/run/verify is the only decisive proof** that a Job/Dynamo works on a model. Drafts **must be loadable and runnable before registration**. Static checks can help debug, but may not become synthetic test/promote/CI gates obstructing live tests. No fake Revit sandbox is claimed to establish correctness.

## 6. Selective Dynamo promotion
A Temp Job may produce a useful `.dyn`. On an explicit user instruction such as **"Save and register this Dynamo"**, Builder:
1. Checks the Registry for conflicting Dynamo name or command ID; if conflicting, asks how to resolve it rather than silently replacing a resource.
2. Copies the Engine, needed data template and dependencies from the Temp Job into a **new independently owned Dynamo library folder**; adjusts paths as needed.
3. Registers the reusable Dynamo capability and verifies the copied files and registry record.

**The user's instruction is the authorization.** No additional approval, synthetic promotion procedure or mandatory retest if the copied artifact and relevant environment remain equivalent to the already live-tested version. Copy, do not move or register the Temp Job. A genuinely missing file, invalid path, or name/ID conflict is an actual error to resolve, not a gate to invent.

## 7. Registry discovery and shared capability borrowing
**Registry is a lightweight discovery catalog** listing the MCP tools, reusable Dynamo and saved Jobs available to ChatGPT, with names/command IDs and brief functional metadata. ChatGPT consults this index to choose the appropriate action **without scanning every tool, Dynamo or Job folder**. Registry is **not an execution-permission gate**: an unregistered owner-local draft/Temp Job or Dynamo can be built, loaded and live-tested on the bound Revit model. An explicit user instruction to Save/Register a Dynamo authorizes the normal copy and index update, subject only to real name/command-ID collisions and file errors. A missing/stale entry is a discovery problem, not authority to invent mandatory promotion, approval, validation or staging steps.

### Shared capability borrowing
Multiple chats may run multiple Jobs at the same time against one bound model. A Job borrows a **capability ID**, **never an exclusive MCP tool instance**. Many Job runs can concurrently register use of a capability such as writing a JSON file, while each edits only its own files. Record capability use by Job Run ID and release borrowed capability records when the Job ends. Borrowing does not grant extra file permissions or Revit model authority. It is **not a global lock** and must not block unrelated Job file/analysis work.

## 8. Unified Revit Execution Queue
**Every command entering Revit, without exception among Revit-facing tool calls, must be registered and serialized through one queue for the shared model/host**, including reads, writes, selection/UI commands, Dynamo load, Dynamo run and Save. Queue operations in arrival order (FIFO) and return the outcome to the requesting Job/Builder. Revit's API context remains controlled by the Native bridge. A Job continues independently with its own file/analysis work while waiting for its Revit operation; do **not** lock or queue whole Jobs.

A failed operation reports failure to its caller, not all other Jobs. No implicit retry of ambiguous Revit writes. Revit/model crash ends that model session; do not automatically replay pending/unknown work after restart. Tab/view changes must never redirect an operation to another model. Queue is execution plumbing, not a local reasoning/orchestration engine.

## 9. Job Save rule
For **every Job that changes the model**, Builder includes a **system-authorized `revit_save_model` step immediately after the Job's last model-mutating step**, even if later steps only analyze or write external files. Operator calls it exactly as specified; Save itself joins the unified Revit queue. For a read-only Job, no Save is required. Failed Save means the Job does not report success. This is a specifically user-approved system step, not permission for Builder to add other business steps.

## 10. Working Knowledge
Source-controlled **`knowledge/`** holds working guidance for model use and user-supplied system/domain practices (Revit model conventions, visibility, families/categories, parameters, HVAC systems, actual workflows, project-specific rules). ChatGPT may organize, categorize, index, consolidate duplicates and improve retrieval of knowledge **provided by the user**, but must not invent domain rules or silently generalize a project-specific convention. Model observations must be read from the actual bound model, not treated as immutable Knowledge.

**Working Knowledge** and **Dynamo Coding Knowledge** are different:
- Working Knowledge makes Job building and Temp Job execution conform to real practice; it evolves as the user supplies rules.
- Dynamo Coding Knowledge supports precise `.dyn` authoring/debugging via thin harness, source invariants, official references and live evidence.

## 11. Deliberate simplicity
- No Job-level timeout: if a step reports an error, stop and report; Builder investigates root cause only on user request. Existing transport timeouts may report *unknown transport result*, not proof of nonexecution or permission to retry.
- No auto-retry, recovery engine, background Job replay, Revit simulator required for acceptance, extra approval/promote gates, exclusive tool leases, whole-Job locks, or local autonomous Job planner.
- Source MCP coding may still need ordinary code compilation where it materially applies; do not transplant software-development gates onto Job/Dynamo live authoring and testing.
- RevitGPT only provides a bridge and physical execution. The ChatGPT model owns the reasoning; the operator follows the user's workflow rather than advising or enriching it.

## 12. Relationship to previous phase documents
- **P1:** Stable connectivity and Native binding were HUMAN ACCEPTED; retain its closure evidence.
- **P2:** Revit MCP foundation (including live-proven Dynamo load/run and model save) is sufficient for P3 work; tool-by-tool MCP improvement remains a continuous stream, not a P3 prerequisite.
- **P3:** This document defines the theoretical Core Function contract **before** any implementation plan; no assertion that these features are already built.
- Superseded pre-2026-10-15 documents may be kept in `docs/old/` as historical evidence. They must not override this document or current phase authority. Never revive old STOP_PENDING, journal/replay, per-chat TTL, Direct/Reasoning split, mandatory separate draft/promote workflows or fake gates.
