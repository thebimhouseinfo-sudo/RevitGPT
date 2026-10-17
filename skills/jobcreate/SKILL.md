# Skill: jobcreate

Status: P3 Builder authoring contract. Source authority: `docs/roadmap/P3_CORE_FUNCTION_THEORY_V5.md`.

## One Job format
All Jobs use an approved `JOB.md` plus explicit ordered `JOB_STEPS`. There is **no Direct/Reasoning Job type split**. A step may explicitly permit limited reasoning; otherwise execute it as written.

## Two lifecycles
- **Saved/reusable Job:** author directly in its own `%LOCALAPPDATA%/RevitGPT/libraries/jobs/<id>/` bundle. May load and test *before* it is listed in Registry; after real relevant verification, add to discovery Registry for Operator use.
- **Temp/Disposal Job:** author directly in `%LOCALAPPDATA%/RevitGPT/temp-jobs/<id>/`. Builder executes it using the same ordered steps. Never register the Temp Job as Saved Job. Clean only completed/inactive temporary bundles per a configured retention period; preserve Model Anchor results and independently registered Dynamo.
- Bundle files may be changed only within the owned directory. Foreign source may be read or copied into ownership, never edited in place.

## Builder — authoring and testing
1. Read the actual user workflow; capture goal, required inputs, explicit steps and expected observable outcomes.
2. Write `JOB.md` and `JOB_STEPS` into the owning bundle. Nominate additional business steps if helpful, **but do not insert them unless user approves**.
3. If the Job changes RVT, append the user-authorized **system Save step immediately after the final model mutation**, before any later file-only steps. Read-only Jobs do not Save.
4. Test directly on the deliberately bound real Revit model when requested. Registry, static schema validation and staging are **not prerequisites** to testing.
5. Only reusable verified Jobs are listed in Registry; Registry is discovery metadata, not execution authority. Do not re-ask approval already provided.

## Operator — existing reusable Job execution
Read exactly the registered Job's `JOB.md` and `JOB_STEPS`; execute them in order with low reasoning. **Step PASS** requires the stated observable outcome, not just an MCP response. PASS → next. ERROR/UNKNOWN → stop and report evidence. All steps PASS → Job Done. No invented/reordered/skipped steps; no autonomous retry, repair, added approval or role switch. Release any capability-use records on normal terminal result.

## Revit and file authority
Native bound-model identity is authoritative. Model Anchor stores per-model/per-Job/per-run results, and cannot override binding. Every Revit operation (read, write, UI, Dynamo and Save) uses the shared Revit queue as implemented. Two Jobs may use the same capability ID nonexclusively, but may not modify each other's owned bundle.
