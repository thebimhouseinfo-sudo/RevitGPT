# Dynamo Writer — Essential Source-backed Contracts

## GOAL
Generate and revise valid Dynamo `.dyn` JSON for the installed DynamoRevit
version. Do not invent assemblies, node types, method signatures or ports.

## Phase 1 — Ground graph schema
**GOAL:** Read a same-version exported .dyn, or official DynamoDS examples,
before creating any nodes.

- A saved Dynamo JSON graph has `Nodes` and `Connectors` arrays.
- Each node has unique `Id`, its actual `ConcreteType`, `NodeType`,
  `Inputs`, `Outputs`; built-in FunctionNode may need a
  version-specific `FunctionSignature`.
- Each *port* in `Inputs`/`Outputs` has its **own GUID**.
- A connector's `Start` references the **source output port GUID** and
  `End` references the **destination input port GUID**, NOT node IDs.
- A connector has its own `Id`. Its port relationships must exist and be
  directionally correct.
- Keep graph `Uuid`, metadata, dependencies, model/view information and
  package signatures from a known compatible sample where applicable.
- DynamoCore CodeBlock nodes use
  `Dynamo.Graph.Nodes.CodeBlockNodeModel, DynamoCore` with DesignScript
  `Code`. Built-in function nodes may use
  `Dynamo.Graph.Nodes.ZeroTouch.DSFunction, DynamoCore`; their
  `FunctionSignature` must come from evidence, not a guess.
- PythonScript and external ZeroTouch/package execution remain blocked in
  the current automated runner; never relabel a node to evade validation.

## Phase 2 — Validate against host version
**GOAL:** Prevent a structurally plausible but non-working graph from being
claimed as correct.

- Match exact Revit/Dynamo versions and installed packages.
- Static JSON/schema validation does NOT prove a package or node exists in
  that DynamoRevit host.
- `dynamo_draft_validate` and `dynamo_draft_stage` are optional diagnostics/helpers,
  **not prerequisites** to load or run a draft owned by a Job, Temp Job or
  standalone Dynamo. An installed loader that rejects such owner-local paths
  needs a focused P3 execution-path fix; do not reintroduce validation/staging gates.
- A DynamoRevit dispatch acknowledgment is NOT graph completion; inspect the
  intended RVT elements/parameters after run.
- Never auto-retry an unknown-outcome graph that may have mutated the model.

## Sources (known and permitted lookup roots)
- Dynamo official source: https://github.com/DynamoDS/Dynamo
- DynamoRevit integration source: https://github.com/DynamoDS/DynamoRevit
- Dynamo official docs: https://primer2.dynamobim.org/
- Sample .dyn graph:
  https://github.com/DynamoDS/Dynamo/blob/master/doc/distrib/Samples/en-US/Basics/Basics_Basic01.dyn
- Sample complex graph:
  https://github.com/DynamoDS/Dynamo/blob/master/doc/distrib/Samples/en-US/Core/Core_Python.dyn

Do not infer that `master` signatures work in Dynamo 2024 without a version
check or exported graph proof.
