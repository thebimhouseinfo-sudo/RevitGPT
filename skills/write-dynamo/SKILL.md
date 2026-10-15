# Skill: write-dynamo
Status: internal / developer preview until real DynamoRevit host test

## GOAL
Author or repair a Dynamo graph as a managed `.dyn` draft. Prefer a few MCP
calls for a simple operation; use Dynamo when a native graph is simpler than
many tool calls. DynamoRevit — not the language model or MCP client — runs
the graph inside Revit.

## Phase 1 — Locate evidence and existing graph
**GOAL:** Reuse known working Dynamo graph/node contracts, not invent nodes.
1. Search the Dynamo library and the existing graph before drafting a new one.
2. Determine Revit and installed Dynamo version and needed packages.
3. Obtain graph/node signatures from trusted Autodesk Dynamo / DynamoRevit
   source or an exported sample graph of that host version.
4. If a node/port signature is not known, stop and report the missing contract;
   do not fabricate `ConcreteType`, `FunctionSignature` or ports.

## Phase 2 — Author managed draft
**GOAL:** Produce a real .dyn graph JSON with explicit dependencies and
correct node/connector IDs.
1. Use `file_create` or hash-guarded `file_edit` only under
   `%LOCALAPPDATA%\RevitGPT\workspace\dynamo-draft\**`.
2. Preserve existing .dyn graph headers, Dynamo model metadata, Port data
   and all untouched nodes when editing a proven source graph.
3. Until a separately reviewed executable-node contract is available,
   Python/CodeBlock/ZeroTouch/script evaluator nodes do not pass safe staging.
   Do not disguise them as innocuous nodes.
4. Use `dynamo_draft_validate` on the final path; this proves bounded JSON,
   node identity and connector references, NOT that Dynamo accepts the graph.
5. Save the SHA-256 returned by validation.

## Phase 3 — Stage, load and run
**GOAL:** Execute only the approved graph against the intentionally bound RVT.
1. Call `dynamo_draft_stage` with path and expected SHA-256. It creates an
   immutable managed copy under `%LOCALAPPDATA%\RevitGPT\dynamo\staging\`.
2. For inspection, call `revit_load_dyn_file` (manual open only).
3. For requested execution, call `revit_run_dyn_file` on the staged path.
   This uses `DynamoRevit.ExecuteCommand` journal flags
   `dynAutomation=True`, `dynPathExecute=True`,
   `dynForceManualRun=False` inside the Revit API UI context.
4. Treat `DYNAMO_AUTORUN_DISPATCHED_OUTCOME_UNVERIFIED` as **not yet PASS**:
   read the resulting model/data to check exact intended changes. If a call
   times out or the result is ambiguous, do NOT blindly retry a write.
5. Record real-host results; promote an accepted graph using the managed
   Dynamo library and registry, never overwrite an external original.

## Constraints
- Native active/bound model enforcement applies to Run; never infer authority
  from an active tab without checking.
- Static validation, file staging and DynamoRevit dispatch are separate gates.
- Source-authored nodes, package compatibility and real host execution are
  different kinds of evidence. No claims of success from static schema alone.
- This skill is a Builder capability, NOT permission to rewrite unrelated Job
  workflows or automatically run an unapproved draft.

## Sources
- DynamoRevit source journal keys and ExecuteCommand:
  https://github.com/DynamoDS/DynamoRevit/blob/master/src/DynamoRevit/DynamoRevit.cs
- Autodesk Dynamo documentation: https://dynamobim.org/
