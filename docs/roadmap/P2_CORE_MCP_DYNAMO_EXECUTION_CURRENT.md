# P2 — Core Revit MCP + Dynamo Writer / Native Auto-run (15/10/2026)

**GOAL:** RevitGPT performs simple Revit tasks with a few accurate MCP calls.
For repeated/multi-step operations, it can author a Dynamo graph and dispatch
that graph to execute once **inside DynamoRevit**, without manual Run clicks.
Do not add Macro capability unless a real use case justifies it.

**Status:** IMPLEMENTATION IN PROGRESS on branch
`feat/p2-dynamo-native-autorun-writer-20261015`.
This is not proof that all native tools, Dynamo graph loading, or automation
are host-verified. No user model is changed by the branch.

## Phase 1 — Basic MCP audit
**GOAL:** Keep working tools, fix genuine gaps; do not rewrite the 64 tools
already exposed by the current Revit MCP.
- Group current tools into Read/Query, Selection/UI, Basic Writes, View,
  Annotation, MEP, Parameters, Sheets and Schedules.
- Verify schema parity and bound-document dispatch, Native transaction and
  readback/error behavior per group.
- Prioritize common actions: read elements/levels/views, selection/show,
  hide by category, view duplication, property reads/writes and parameters.
- Trace each failure to a concrete method/parameter/host fixture before code.
- VG Filters/Templates and Clash Detection remain approved P2 groups,
  but are after the foundational MCP + Dynamo path in this execution order.

## Phase 2 — Dynamo Writer
**GOAL:** Author editable, reusable `.dyn` assets from trusted node schemas,
not manually click together graphs for each Job.
- First reuse an exported Dynamo graph from the matching Revit/Dynamo version.
- Create/edit drafts under managed AppData `workspace/dynamo-draft/**`.
- Validate JSON, graph IDs, connectors, size and forbidden executable node
  types; include SHA-256 of the exact draft.
- Stage an immutable content-addressed `.dyn` under
  `%LOCALAPPDATA%/RevitGPT/dynamo/staging/` before dispatch.
- Validation is static; a valid JSON graph is **not** host-compatibility PASS.
- Current safe-node policy allows official DynamoCore ZeroTouch and CodeBlock
  nodes, but blocks Python scripts and unreviewed external executables.
  Host validation of exact node versions and package dependencies is still required. Do not silently
  downgrade to fake nodes or turn execution into hundreds of MCP calls.

## Phase 3 — Native Dynamo execution
**GOAL:** RevitGPT can request a graph run without the human pressing Run.
- Preserve `revit_load_dyn_file` for inspect-only/manual open.
- Add `revit_run_dyn_file` for explicit execution on active bound model.
- Reuse the staged path/hash/reparse/bounds checks.
- DynamoRevit `ExecuteCommand` journal: automation True, path execute True,
  force manual False. The native engine, not MCP, runs the graph.
- No implicit replay when a write reports timeout/outcome unknown.
- Native dispatch result is **not** proof that graph execution succeeded.

## Phase 4 — CI / real Revit verification
**GOAL:** Establish truthful PASS evidence with minimal human test rounds.
- Offline CI: Node Writer stages + negative controls; Python bridge tests;
  native route, UI-binding, Revit API compilation, per-group tool tests.
- Human Test on disposable RVT in Revit 2024: author from exported sample,
  stage, load-only with zero side effects, then explicitly autorun; verify
  element/parameter change exactly once with a fresh Revit read.
- Test invalid graph and bound vs active mismatch. Verify a failed tool
  does not drop connection.
- After PASS, expand Dynamo node support; then return to VG/Filters,
  Clash Detection and other outstanding tool correctness.
- Do not merge a Native autorun implementation solely on static CI PASS.

## Out of scope
Macro Writer / Macro Engine, workflow resume after Revit crash, background
Job management, auto-run at startup, and model edits without explicit request.

## Relevant source evidence
- Previous Native loader forced manual-only: `NativeDynamoLoad.cs`.
- `connection/bridge.py` preflight `validate_staged_dyn` and SHA check.
- DynamoRevit journal keys and internal execution:
  https://github.com/DynamoDS/DynamoRevit/blob/master/src/DynamoRevit/DynamoRevit.cs

**Human-approved execution priority:** basic MCP tools, Dynamo Writer,
loader/runner; choose simple tool calls for simple work and Dynamo for repeated
work. The author/runner API is a capability, not a requirement to use it always.
