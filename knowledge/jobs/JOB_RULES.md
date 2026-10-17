# RevitGPT Job Rules — P3

**Source of design decisions:** `docs/roadmap/P3_CORE_FUNCTION_THEORY_V5.md`. ChatGPT is the brain; RevitGPT executes model and file operations. Do not create a second local Job planner.

## Job / Skill / Tool
- **Job:** user-approved workflow with ordered `JOB_STEPS` and `JOB.md`.
- **Skill:** guidance for ChatGPT to author or run a Job.
- **Tool/Capability:** action handle, often shared by multiple Job runs. Borrowed capability IDs do not lock tool instances.

There is **one Job format**, not separate Direct/Reasoning types. Reasoning is allowed only where an individual step explicitly requests it.

## Job ownership and storage
- Saved Job: `%LOCALAPPDATA%/RevitGPT/libraries/jobs/<id>/`.
- Temp/Disposal Job: `%LOCALAPPDATA%/RevitGPT/temp-jobs/<id>/`.
- Revit Model-specific results: owned directory under its persistent Model Anchor and individual Job Run ID.
- Each Job owns its bundle and own results; other files are read-only or copied into its own folder.
- Registry lists available reusable tools, Jobs and Dynamo **for fast discovery**. It is not a gate for authoring, loading or live-testing an unregistered Job/graph.
- No mandatory draft/promote folder move, separate validation gate or second user approval.

## Contract and execution
A Job specifies user-authorized goal and ordered steps, inputs, required tool/capability, optional step-local reasoning, verifiable step outcome and outputs. Builder may suggest an extra step but cannot silently put it in the contract.

**Operator:** read and execute Saved Job steps exactly. Step PASS if actual declared outcome holds; otherwise ERROR/UNKNOWN → STOP and REPORT. No implicit retries, fixes, rearrangement, skipping, recovery, or unauthorized reasoning. When all steps PASS, Job Done. Return borrowed capability records.

**Builder:** authors/edits/tests Saved Jobs and executes Temp Jobs. Does not secretly register Temp Jobs.

## Revit authority and Save
Native binding identifies the model; an active view alone is not sufficient. Model Anchor stores results but cannot bind or switch models. Revit read/write/UI/Dynamo/save operations belong to a single shared execution queue, without queueing or locking whole Jobs.

If any step changes the model, Builder adds **one system-authorized `revit_save_model` step immediately after the last model mutation**, even if file-only steps follow. A failed or unknown Save is not Job success. Read-only Jobs do not require Save.

## Proof
A successful tool dispatch alone is not evidence that a Dynamo graph or requested model change completed. Verify against actual model/result. If outcome is unknown, stop and report; never replay an ambiguous mutation automatically.
