# Skill: write-dynamo

Status: Builder capability; actual graph correctness requires real DynamoRevit execution evidence.

## Purpose
Author, edit, inspect and debug Dynamo `.dyn` graphs with a **thin harness**. Use the existing Dynamo technical Knowledge and source-backed graph examples; do not substitute general Python scripts for Dynamo graph semantics. ChatGPT is the author; Revit/Dynamo runs the graph.

## 1. Ground the graph
1. Read the requested workflow, current Revit/Dynamo version where available, and any existing working graph.
2. Use `knowledge/dynamo/DYNAMO_WRITER_RULES.md`, official Dynamo/Autodesk references and trusted compatible `.dyn` examples to ground node types, signatures, port IDs and connectors.
3. When a node contract is unknown, look up the actual contract. Do not invent node names, package APIs, `ConcreteType`, `FunctionSignature` or ports.
4. Distinguish graph JSON, DesignScript, Python Node execution and Revit API context. A Python Node may be valid only in a graph/host that supports it; no blanket Python-to-Dynamo conversion.

## 2. Author within the actual owner folder
- Write the `.dyn` and any needed data/templates directly into the **owning reusable Job, Temp Job or standalone Dynamo folder**. Do not require a separate workspace draft directory or file promotion just to author.
- Prefer engine `.dyn` plus changeable data JSON/CSV when practical, without imposing this split on a graph that does not need it.
- Preserve existing graph IDs, unaffected nodes/metadata and package dependencies when editing.
- Use managed file operations respecting canonical ownership boundaries; foreign files are read/copied, not modified in place.

## 3. Inspect and live-test
- `dynamo_draft_validate` and `dynamo_draft_stage` currently exist as **optional diagnostic/compatibility helpers**, not prerequisites for an owner-local graph to be loaded/run.
- When user requests a live test, the implementation must allow the owned draft `.dyn` to be loaded/run without Registry registration, mandatory validation or staging. If current tool paths reject that, report the implementation gap and fix the narrow execution path; do not invent an approval gate.
- Native bound-model authority still applies. A dispatch acknowledgment is not proof that the graph completed. Verify actual graph result or model readback, and report uncertainty; never blindly retry ambiguous model writes.
- If testing fails, stop and report the real failure. Debug and revise only when requested; do not silently add Job steps.

## 4. Reuse when requested
- An explicit user instruction to save/register a useful Dynamo authorizes copying the graph, data template and dependencies to a separate owned Dynamo library directory and cataloging it in Registry.
- Check for duplicate Dynamo names and command IDs first; ask how to resolve real conflicts. Do not ask for another approval or require rerunning an unchanged already live-verified graph.
- Registry is **only a fast discovery index** of reusable tools, Jobs and Dynamo. It never grants or denies execution of an owner-local draft.

## Sources
- `knowledge/dynamo/DYNAMO_WRITER_RULES.md`
- https://primer.dynamobim.org/
- https://developer.dynamobim.org/
- https://github.com/DynamoDS/DynamoRevit
