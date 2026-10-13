# SUPERSEDED — historical combined plan

**Do not implement this combined plan as written.** The HUMAN corrected
architecture on 2026-10-10: RevitGPT is the brain; source Knowledge is
separate, grouped by revit/, dynamo/, hvac/; Revit MCP is a tool subsystem.

Canonical architecture:
docs/architecture/REVITGPT_BRAIN_MCP_KNOWLEDGE.md

Revised Revit MCP-only plan:
docs/superpowers/plans/2026-10-10-revit-mcp-v1-implementation-only.md

---

## Historical draft (retained only for traceability)

# RevitGPT — Full BIM MCP Production Implementation Plan (V1)

Status: IMPLEMENTATION PLAN ONLY. No runtime implementation or write permission change in this commit.
Branch: work/J-AFC4-p1-revit-mcp-bootstrap (canonical development source, no scattered feature branches).
Target host: Revit 2024; retain native installed panel and existing binding/sleep-wake behavior.
Date: 2026-10-10.

## 0. Audit baseline: what actually exists

Current chain: ChatGPT @rg / Secure MCP Tunnel -> Node Slim MCP ->
Python FastMCP stdio -> localhost native HTTP -> Revit ExternalEvent/UI API.

- Python declares 23 Revit tools: 12 read/diagnostics and 11 mutations.
- Node SessionModelAuthority currently allowlists model reads and refuses
  mutations; native RevitApiRouter returns HTTP 501 for all write paths.
- Native read implementations cover documents, levels, views, filtered element
  inventory, element by ID, family definitions/types, system type definitions
  and view annotations. Connectors currently return 501.
- Some Python tool descriptions/parameters overpromise native output:
  parameters are accepted by revit_list_elements but Native ElementInfo does
  not return those requested parameters; annotation descriptions likewise
  exceed current returned fields. Audit ALL schema/response mismatches.
- Native routing and Python bridge.py route parity are checked, but route
  registration is NOT proof that a handler exists or that a real Revit host
  has passed end-to-end validation.
- Unified Registry, rg/ discovery, user libraries and HVAC knowledge are
  already present. They must become the ONE capability source of truth,
  not duplicate registries.
- The native add-in has a source-based local official install path, but
  full MCP and mutation host QA are NOT yet complete.

## 1. Product definition and non-negotiable invariants

V1 means a usable BIM automation MCP, NOT "many tool names":
(a) query placed model objects, parameters, units, quantities, linked models,
    MEP connections/systems and views/sheets/schedules accurately;
(b) reliably perform a finite set of guarded create/edit/delete tasks on a
    disposable/work model with readback, rollback and structured evidence;
(c) select the correct tools via Registry/Knowledge without repeatedly
    guessing Family/Type or re-running multiple broad searches;
(d) run reviewed Jobs and Dynamo scripts in Revit context through clear
    capability contracts with interrupt-safe checkpoints;
(e) recover after transport interruption/sleep without model confusion.

Invariant: one primary bound model; exactly one model auto-binds only at
initial unbound state; no automatic rebinding on tab switches; native host
revalidates active/bound identity and revision at execution time. Linked
models are read-only unless separately implemented and explicitly requested.
Never test mutations on the user's MAGS or other production model.

Do not rewrite WPF/WebView2 UI or silently replace installed DLLs. Node/Python
tools can upgrade independently; native DLL changes require separate host
upgrade and smoke testing. Do not make CI green by relaxing tests.

## 2. One contract for every MCP capability

Every Registry entry must have:
- stable ID and name, domain, summary, when_to_use, when_NOT_to_use,
  input/output JSON schemas, units, category and Revit 2024 prerequisites;
- implementation path (Python service, native route, handler, model API);
- mode READ, WRITE, DESTRUCTIVE or DISCOVERY; risk, model scope, required
  approval, host version, write effect and data-side effects;
- state REGISTERED, IMPLEMENTED, HOST_TESTED, READY, DEPRECATED or BLOCKED;
- tests/fixtures and verification evidence references; implementation hash,
  semantic revision and compatibility requirements;
- model class/category/Family/Type filters and expected response examples.

Registry availability is generated/verified from actual MCP tool names and
native implementation, then enriched with reviewed descriptions. A REGISTERED
tool MUST NOT be shown as READY until live host test passes. Prevent collisions
with user Registry entries. Promote only reviewed capabilities; scanned
Python/Dynamo/Job files remain INDEXED/UNTRUSTED.

Standard request envelope: request_id, bound target document_id,
host_instance_id, binding_revision, operation_id, schema_version, units,
filters, limit/cursor, include_links and deadline. Responses report:
status, actual bound model, Revit version, snapshot/revision, quantity/unit,
completeness/truncation, records/count, warnings, duration and evidence IDs.
Use BuiltInCategory/BuiltInParameter or stable IDs for selectors; translate
displayed localized Revit names at the boundary. All numerics require
explicit internal-unit/SI conversion rules, never assumptions.

## 3. Architecture responsibilities (reuse, do not fork)

Native Revit .NET: source of truth for Element collectors, geometry,
connectivity and Transactions. Only Revit UI ExternalEvent may call Revit API.
Split the current monolithic RevitApiRouter into testable route handlers:
Core/Binding, Read/Elements, Read/MEP, Read/ViewsSchedules,
Write/Parameters, Write/Geometry, Write/Annotations and a single
transaction coordinator; preserve existing external routes where possible.

Python FastMCP: typed tool schema, validation, normalized outputs and
Revit domain wrappers. No fake object counts or invented transactions.
Node Slim: admission/transport, capability lookup, read routing,
per-operation write authorization, logging, timeouts and recovery.
Registry/Knowledge: semantic discovery, not authorization or proof of model
facts. Job runtime: manages task artifacts and checkpoints, not direct
background Revit API calls.

A future tool is introduced vertically across schema -> Node policy ->
Python service -> native handler -> readback/tests -> registry READY.
No layer may advertise an unsupported downstream feature.

## 4. Delivery checkpoints

### CP0 — Baseline and hardening before feature work

Inventory each of 23 tools at route/handler/schema level. Create a machine
readable coverage report distinguishing 200-real, 501-stub, blocked and
partially implemented responses. Correct misleading docstrings (parameters,
annotation fields, connectors, unit defaults). Golden fixtures for all
current reads. Audit local host access and current Host/X-Request-ID controls:
neither alone authenticates a native write caller. Establish canonical source
branch, checkpoint state, reproducible build, deterministic review rules.
Exit: complete matrix, no unknown current behavior, prior P2C/P2E tests pass.

### CP1 — Core native read platform

Tools (candidate names, freeze only after schema review):
revit_get_categories, revit_query_elements, revit_count_elements,
revit_group_elements, revit_get_parameters, revit_list_parameters,
revit_get_geometry_summary, revit_get_element_relationships.
Add stable category IDs, family/symbol and instance distinction, type vs
instance parameters, levels, phases, design options, worksets, linked-model
scope, view-dependent visibility and pagination. Dynamic parameter selection
must really return parameter value/storage type/unit/read-only status.
A summary/count must run inside a single native collector, not send thousands
of instances through ChatGPT. Bound model checked in native host per request.
Exit: one call counts actual placed elements; correct count after changes,
large models never silently truncate, host fixture readback matches Revit UI.

### CP2 — BIM/MEP intelligence and fast query

Implement real connector readback (ConnectorManager including family MEP
models and curve MEP elements) with domain, shape, size, orientation and
references, then build actual system instances/network traversal, sections
of ducts/pipes/fittings, equipment relationships and grille schedules.
Candidate read tools: revit_summarize_equipment,
revit_get_mep_connectors, revit_trace_mep_system,
revit_summarize_ducts, revit_summarize_pipes, revit_quantity_takeoff,
revit_inspect_family_instance.

FCU sample vertical slice: ONE filtered Mechanical Equipment inventory,
aggregate by Family/Type and selected parameters, report confirmed FCUs,
probable VRF/ducted indoor units, ambiguous items and evidence. Never count
all PEFY or all Mechanical Equipment as FCU by default. Add project-specific
approved classifications to Knowledge, not hidden global assumptions.
Exit: answer "how many FCUs?" with reproducible numeric/evidence breakdown,
one principal Revit data call, plus a reason when classification incomplete.

### CP3 — Guarded write engine (remove GLOBAL deny, not ALL safeguards)

No blanket read-only product mode once per-tool write contracts exist.
Implement a structured write coordinator BEFORE enabling the first mutation:
- Write capability allowlist separate from reads; correct one model, host
  instance, binding_revision, target element IDs and current active document.
- Authenticated, one-time, short-lived operation authorization tied to
  operation hash and exact model/action. Localhost plus X-Request-ID is NOT
  sufficient. Prevent replay and cross-session/cross-model use.
- Preflight/dry-run => proposed diff, constraints, selected elements and
  linked/workshared/readonly checks; approval proportional to risk.
- Execute on Revit UI thread in Transaction (TransactionGroup for multi-step);
  fail atomic by default; roll back on validation/exception, read back results
  before reporting success; include IDs, before/after and warnings.
- Request operation_id + durable outcome journal; bridge HTTP 504 means
  UNKNOWN outcome and MUST NEVER trigger blind automatic retry.
- For delete, inspect dependent element cascade count and require specific
  confirmation; never bulk-delete ambiguous selection.

First certified mutation: revit_set_parameter on a copied RVT, resolving
storage types, ElementId references, ForgeTypeId units, type/instance scope,
read-only/workshared constraints, and lossless round-trip. Then move_element,
place_family_instance and bounded bulk parameter updates. Graduated later:
create_duct, create_pipe, annotations, tag, dimension, spot elevation,
delete_elements. A candidate remains BLOCKED until live transaction/readback
negative-control tests pass; some may remain unsupported after V1.

### CP4 — Full everyday BIM domains

Complete Revit views/sheets/schedules: query/edit view templates and view
filters, create views/sheets where host-tested, list schedules and fields,
extract schedule rows, inspect warnings and element dependencies; add
selection/visibility, levels/grids/rooms/spaces, MEP equipment and linked
model inventory. Separate features by READ/WRITE certification. Support
batch-select/update with size limits and transaction grouping; no general
unrestricted Python/Dynamo execution as a shortcut.

### CP5 — Job + Dynamo + Python Capability Runtime

Use existing managed AppData roots, not a competing registry.
Job package: JOB.md with ID/version, purpose, when_to_use, inputs/outputs,
dependencies, reversible/non-reversible actions, execution mode, resource
limits, preview/approve policy, capability list and verification.
Dynamo: index .dyn including version/sha, engine compatibility, package
dependencies, allowed inputs and outputs; run ONLY through a Revit-owned
host adapter, never arbitrary shell injection. Python user scripts require
review, pinned interpreter/runtime and trust level.
Background SYSTEM preparation may inspect snapshots and files, never invoke
Revit API outside ExternalEvent. Job checkpoint state enables resume without
blindly re-executing committed writes. Promote from draft to library only
after tests, user approval and hash validation.

### CP6 — Knowledge engine and self-improvement

Organize knowledge into (1) Revit API behavior/host version, (2) discipline
knowledge HVAC/MEP/architecture/structure, (3) project-specific verified
rules, (4) user-reviewed lessons learned and tool failures. Each entry must
record source, scope, author/reviewer, date, confidence, conflicts, update
conditions, and allowed uses. Model read evidence outranks generic examples.
Knowledge can suggest queries but never fabricate quantity or authorize
mutations. Failed tool invocations generate PROPOSED lessons/tests; never
silently change a production capability or executable script. Support
semantic search over reviewed entries without calling dozens of tools.

### CP7 — Performance, release, ongoing host QA

Measure cold/warm timings at each hop: ChatGPT tool selection, tunnel,
Node, Python stdio, native HTTP wait, Revit ExternalEvent and API execution.
Write structured trace IDs across hops and count tool invocations, payload
bytes, error reasons. Target (initial, not guaranteed): one data call for
simple count queries; warm underlying MCP p50 <=2s, p95 <=5s; end-to-end
simple warm response p50 <=10-15s. Determine empirical baselines/host model
size first; if ChatGPT inference dominates, improve tool semantics and
summary contracts rather than caching stale model data.

Regression suite: Revit Home -> 1 open RVT auto bind; A/B tab switches and
manual rebind; closed model; link vs host; locale/category changes; empty
and >5000 element sets; type vs instance; connector/system cycles; unknown
units; read-only parameters; failed transaction; linked element write refusal;
write timeout outcome unknown + replay; sleep/wake; invalid/stale token;
Job interruption; Dynamo missing package; knowledge conflict.
Use reusable disposable RVT fixtures (including MEP connections, loaded
but unplaced symbols, group instances, dependent deletes), and real Revit
2024 UI host evidence. Never test writes on MAGS.

Review loop at meaningful checkpoints only: Implementer -> Tester ->
Reviewer. Reviewer must inspect BOTH implementation and test scripts.
A green static/CI test is not a substitute for native real-host validation.
Run positive, negative, mutation/negative-control and recovery tests at
checkpoint gates, not every trivial commit. Evidence includes feature
matrix, real Revit readback, diff, time profile, regression and rollback.

## 5. Release workflow, branch discipline and exit criteria

- Keep ONE canonical development branch while P3 is evolving; small scoped
  commits merged immediately into that source of truth. No abandoned branch
  stack. Keep main stable/untouched until approved release.
- Each checkpoint must include a SPEC, source changes, tests, evidence,
  registry status changes and one final reviewed merge/commit.
- If model/runtime is disconnected, do not fabricate host PASS. Stage only.
- MCP core may be updated without reinstalling the unchanged native UI.
  Native API additions require deliberate native DLL upgrade/host QA.
- V1 release requires: common BIM read tasks correct, proven MEP network
  and counting, several graduated write operations with rollback/readback,
  reliable tool selection, traceable logs, Jobs/Dynamo package discovery
  and at least one safe host-tested Job/Dynamo execution path.
- Publish READY ONLY for host-tested tools; BLOCKED/PENDING remain visible
  in Registry. "MCP complete V1" means this capability matrix and tasks are
  met, not that every Revit API class is wrapped.

## 6. First execution batch (priority)

Order for the NEXT implementation iteration:
1. CP0 route/schema/handler/evidence audit; fix misleading contracts.
2. CP1 read-only parameter query and native aggregate counts.
3. CP2 FCU/grouped Mechanical Equipment/MEP connector host fixtures.
4. CP3 write coordinator + first revit_set_parameter disposable-model test.
Only after those gates: broader write, Jobs and Dynamo execution.

No runtime changes, tool activation or model mutation are approved by this
planning document alone.
