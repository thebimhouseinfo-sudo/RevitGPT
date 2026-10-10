# Revit MCP V1 — Detailed Implementation Plan

Status: DETAILED IMPLEMENTATION PLAN / NOT IMPLEMENTED.
Date: 2026-10-10.
Canonical work branch: work/J-AFC4-p1-revit-mcp-bootstrap.
Reviewed source baseline for planning: 2e97e8d9892a0a58c178dc7e7b6e6337d00ce148.
Target: Autodesk Revit 2024, Windows, existing officially installed RevitGPT Native add-in.
Authority: docs/architecture/REVITGPT_BRAIN_MCP_KNOWLEDGE.md.
Parent: docs/superpowers/plans/2026-10-10-revit-mcp-v1-implementation-only.md.
Superseded historical source: docs/superpowers/plans/2026-10-10-full-bim-mcp-v1-implementation-plan.md.
This document adds executable tasks, dependencies, test design, file ownership, acceptance gates and release rules; it does not authorize runtime writes, installed-binary changes or production model mutations.

## 1. Goal, scope and delivery contract

Deliver a practical, production-oriented Revit API tool subsystem consumed by RevitGPT Brain. V1 must reliably answer placed-element queries, parameters, MEP topology, quantity summaries and everyday BIM information; safely perform selected changes on approved work/disposable RVT; and expose honest capability metadata and evidence.

IN: Python FastMCP schemas/services; Revit-specific Node admission, forwarding and per-operation authorization; native .NET API handlers, binding verification, ExternalEvent dispatch and Transactions; schema compatibility, offline/host tests, performance traces and release evidence.

OUT: RevitGPT model reasoning/classification, source Knowledge retrieval/promotion, unified Job runner, Dynamo graph engine, broad RevitGPT Registry ownership, UI redesign, arbitrary code execution. These are external integration boundaries, not tasks inside the MCP implementation.

Product invariants:
1. Keep the current installed WebView2 panel and single primary Revit model binding. Auto-bind only a first eligible sole model when unbound; later tab change or bound-model closure never silently rebinds.
2. Native API access is exclusively inside Revit UI ExternalEvent. Native verifies the actual active/bound identity and binding revision at execution, not merely at Node dispatch.
3. Linked RVT is read-only unless a future separately reviewed implementation explicitly authorizes a change.
4. No new tool is READY because a name, route, mocked fixture or build exists. READY requires applicable real Revit 2024 host evidence.
5. Do not run mutation tests against MAGS or any production/live user RVT. Use copies and disposable RVT fixtures only.
6. No unconditional write unlock, blanket catch-and-success, blind retry, arbitrary Python/Dynamo execution, guessed unit conversions, fake count or silent truncation.
7. Keep main stable. One canonical development branch; checkpoint commits go directly there after review; no unmerged feature branch stack.
8. Keep the installed version immutable. Native changes require a new version, explicit native reinstall/smoke and documented rollback; pure Node/Python changes should not force an unchanged native DLL reinstall.

## 2. Verified baseline and evidence gaps

Repository inspection on 2026-10-10 shows:
- Python main.py registers 23 tools: 12 reads/diagnostics and 11 mutations.
- src/model-authority.mjs has an explicit DIAGNOSTIC and MODEL_READS allowlist and rejects other tools with NATIVE_MUTATIONS_NOT_ENABLED.
- RevitApiRouter.cs rejects all recognized write routes with HTTP 501; /element/connectors is a 501 stub. Some reads (documents, levels, views, elements, families/types, system TYPES and annotations) have native code paths.
- /elements uses WhereElementIsNotElementType, a 5,000-item error threshold and localized category-name comparison. ElementInfo does not yet serialize requested dynamic parameters; /element with include_connectors also returns 501.
- BridgeRouteContract.cs contains registered paths, but route parity tests are not equivalent to functional native handlers.
- connection/bridge.py generates X-Request-ID per HTTP request, calls legacy paths and has an error/timeout mapping that must preserve UNKNOWN outcomes for writes. X-Request-ID and localhost Host validation are not write authentication.
- src/capability-registry.mjs loads the internal tool manifest and user discovery entries. Runtime status and capability READY need a separate evidence verification layer; do not create a second registry.
- scripts/run-revit-mcp-tests.ps1 explicitly classifies offline tests and test_real_connection.py as live-host TEST_BLOCKED; test_bridge.py includes fake successful write replies that MUST remain labelled mock-only evidence.
- Native official install reported PASS for version 2026.10.10-2e97e8d in the user's PowerShell log; this is installation evidence, NOT Revit runtime/mutation QA.

Unknown until run: actual Revit UI boot/panel, live 23-tool behavior, Revit MEP fixture consistency, actual write security design, measured latency, host recovery and cross-session behavior. None can be marked PASS from source review.

Existing relevant modules:
- Node: src/index.mjs, src/model-authority.mjs, src/revit-upstream.mjs, src/mcp-session-manager.mjs, src/capability-registry.mjs, src/log-store.mjs.
- Python: runtimes/Revit-mcp/main.py; tools/*.py; services/*.py; connection/bridge.py; capabilities.json; tool-manifest.json.
- Native: runtimes/Revit-mcp/bridge/unified_native/{RevitApiRouter,BridgeRouteContract,BridgeHttpProtocol,BridgeDispatchQueue,RevitExternalEventAdapter,NativeModelBindingState,BridgeHttpServer}.cs.
- Tests: runtimes/Revit-mcp/tests/, scripts/test-model-authority.mjs, scripts/test-mcp-session.mjs, scripts/test-capability-registry.mjs, scripts/run-revit-mcp-tests.ps1 and .github/workflows/p1-revit-mcp-bootstrap.yml.

## 3. 23-tool baseline inventory for MCP-0

The following names are declared, not proof of READY. MCP-0 must independently classify every entry as REAL / PARTIAL / STUB / BLOCKED, with implementation route and live host evidence.

Read/diagnostic (12):
1. revit_get_runtime_info — diagnostics.
2. revit_get_active_document — active document metadata.
3. revit_list_documents — open documents.
4. revit_list_views — views.
5. revit_list_levels — levels.
6. revit_list_elements — elements/filtering; requested parameters gap.
7. revit_get_element — ID lookup; parameters and include-connectors gap.
8. revit_list_families — family definitions.
9. revit_list_family_types — symbols/types, not placed-instance counts.
10. revit_list_system_types — MEP system TYPES, not system instances.
11. revit_get_connectors — registered but native 501.
12. revit_list_annotations — partial annotation kinds and fields.

Mutation (11, currently globally blocked / native 501):
13. revit_place_family_instance.
14. revit_create_duct.
15. revit_create_pipe.
16. revit_set_parameter.
17. revit_delete_elements.
18. revit_move_element.
19. revit_create_text_note.
20. revit_create_tag.
21. revit_create_dimension.
22. revit_create_spot_elevation.
23. revit_create_detail_line.

Coverage artifact: docs/evidence/revit-mcp-v1/tool-coverage.json and human-readable tool-coverage.md. Machine-readable per-tool columns: stable_id, name, kind, Python registration/function/service, HTTP method/path, native dispatcher/handler, implemented response fields, declared schema fields, feature limitations, Node permission, native route policy, tests, fixture ID, host evidence ID, status, source commit and reviewer. Do NOT equate Node diagnostic access with unrestricted model access.

## 4. Contracts to freeze before new capabilities

### 4.1 Schema version and compatibility

Define one versioned envelope for all NEW routes/tools:
- request_id and trace_id propagated from Node through Python, HTTP and native logs;
- schema_version and stable operation_id for mutation; authenticated session context where applicable;
- exact bound_document_id, host_instance_id and binding_revision;
- selector: stable BuiltInCategory/BuiltInParameter/parameter GUID or Revit API class; localized label is supplemental only;
- explicit coordinates/unit_system/unit identifiers, filter/visibility scope, page_size, cursor, snapshot marker, include_links;
- deadline and user-approved operation intent for writes.

Response reports status (OK/EMPTY/PARTIAL/UNSUPPORTED/BLOCKED/UNKNOWN/ERROR), actual document/host/revision, Revit version, snapshot basis, records/count/group buckets, units, completeness, next_cursor, warnings, duration per hop, request_id/trace_id/evidence_id. Error codes distinguish invalid input, wrong model, unavailable API, incomplete data, conflict, failed transaction, authorization and unknown outcome.

Compatibility rule: retain existing 23 public names and established argument semantics where possible. Add optional fields or new versioned tools rather than silently changing arrays into incompatible objects. For a new explicit paged/aggregate tool, use the versioned result envelope. Deprecations require compatibility tests and registry notes. No shadow capability with the same name.

### 4.2 Data and units

- BuiltInCategory and stable API identifiers are authoritative selectors. Displayed strings may vary by Revit locale.
- Distinguish Family, FamilySymbol, placed FamilyInstance, SystemType, actual MEP System instance; never count loaded-but-unplaced symbols.
- Instance vs type parameters: expose element_id/owner/type_id, storage_type, read_only, has_value, raw internal value, display value and ForgeTypeId/unit when supported. ElementId references are not numeric measurements.
- Revit internal units may be feet, but every numeric geometry/length/area/flow quantity must state its unit; convert with Revit 2024 UnitUtils and SpecTypeId/UnitTypeId where applicable.
- Reject ambiguous name collisions or invalid category/class/parameter combinations; never substitute an arbitrary matching parameter.
- Stable element ID is a scoped reference for the current document/host. Do not claim it is globally unique or survives all changes.

### 4.3 Security and mutations

Write architecture decision MUST be reviewed before code: native-enforced, one-use short-lived operation authorization bound to host_instance_id + binding_revision + bound RVT + tool + exact target IDs + canonical request hash + expiration + user approval state. Create a documented local threat model; localhost/Host/X-Request-ID are not authentication. Select and test an authenticated local handoff (e.g., per-user ACL-protected broker secret and HMAC nonce or an equivalent secured IPC design), with anti-replay cache and rotation on host restart. Never surface credentials in WebView/logs/tunnel responses. Node policy is defense-in-depth, not a substitute for native enforcement.

Write phases: PREVIEW (read-only effect estimate, target identity, before state, dependencies) -> APPROVE (risk-specific one-time authorization for exact hash) -> EXECUTE (only Revit UI ExternalEvent/Transaction, revalidate model/revision/preconditions) -> VERIFY (postcondition/readback) -> JOURNAL (durable outcome). A preflight/approval mismatch invalidates the request. On timeout-after-start, return UNKNOWN; query outcome by operation_id, never automatically replay. Atomic failure/rollback by default; batch behavior and partial effects must be explicit. For delete, preview dependent/cascaded removals and require a fresh explicit confirmation.

## 5. Execution DAG and scoped delivery batches

Tasks are sequential only where safety/data dependencies require it. Read-only feature work can proceed in bounded slices after MCP-0, but no write implementation can be activated before the secure coordinator gate.

### MCP-0 — Audit and truthful baseline (B00–B02)

B00 — Baseline freeze and test harness:
- Pin canonical branch/commit, native installed version, Revit 2024 API references, Node/Python environment, CI and release scripts.
- Create disposable host fixtures: R0 tiny architectural (levels/views/rooms/grids), R1 MEP (FCU/other mechanical families, ducts/pipes, connected/disconnected connectors, actual systems), R2 linked/workshared/read-only scenarios, R3 high-volume (>5,000 placed instances), R4 mutation-only copy (typed parameters and dependent deletes). Explicitly document generator/manual creation, SHA/checksum, Revit version and expected snapshots. Never commit confidential RVT or user paths to public Git.
- Establish host test runner/manifest, artifact naming, test classifications OFFLINE / LIVE_READ / LIVE_WRITE and failure recording. Existing tests must be reclassified when files are added to scripts/run-revit-mcp-tests.ps1.
Files: runtimes/Revit-mcp/tests/README.md, new tests/fixtures metadata, scripts/run-revit-mcp-tests.ps1, docs/evidence/revit-mcp-v1/README.md.
Acceptance: reproducible fixture recipe and zero unknown test files; clear distinction between build/CI and live evidence.

B01 — 23-tool vertical audit:
- Generate coverage from FastMCP registration, Python service calls, connection/bridge.py route, BridgeRouteContract, native handler branch and Node allowlist; manually verify schema field-by-field and classify 23/23.
- Add negative control: route present, no native handler must NOT be marked implemented; fake write success must NOT mark host pass; 501 connector must stay blocked.
- Correct descriptions for requested parameters, annotation fields, connectors, unit defaults, 5,000-item cap and system type vs instance. Keep the implementation honest without claiming missing fields.
- Add machine-checkable manifest drift test: 23 tool names vs actual FastMCP and internal manifest, no missing/duplicate; registry status derives from reviewed evidence, not auto READY.
Files: runtimes/Revit-mcp/tools/*.py, tool-manifest.json, capabilities.json, tests/test_native_route_contract.py, new tests/test_tool_coverage.py, scripts/test-capability-registry.mjs.
Acceptance: 23/23 classified, 0 UNKNOWN, schema/handler gaps recorded and no unsupported field advertised as available.

B02 — Live read-only baseline and boot regression:
- Verify Revit 2024 boot and panel, binding/status, 1-model initial bind, tabs A/B no auto rebind, manual bind, close/reopen, Sleep/Wake and malformed model IDs; collect sanitized real request/response snippets.
- Record latency baseline separately for cold Node/Python start, native request queue and warm simple level/element query. Do not use artificial mock numbers as host data.
Files: new docs/evidence/revit-mcp-v1/MCP-0-host-report.md; existing bridge/native tests.
Acceptance: meaningful host evidence OR mark HOST_TEST_BLOCKED with the precise unmet condition; never misreport host pass.

MCP-0 GATE: Reviewer independently inspects audit generator AND tests; 23/23 truthfully classified; existing P2C/P2E/binding/install regressions pass offline; live-host gaps explicitly tracked. No write permissions change.

### MCP-1 — Model reads, parameters, fast aggregate (B03–B06)

B03 — Native read handler separation and validated queries:
- Split monolithic RevitApiRouter into internal cohesive native read handlers (CoreBinding, Elements, Parameters, Views, MEP) behind same HTTP paths; keep ExternalEvent dispatcher, NativeModelBindingState and one native entrypoint. Refactor in small behavior-preserving commits, never rewrite WPF/WebView2.
- Introduce category catalog/query with BuiltInCategory IDs; support include_types, element class, family/type instance filters, level, view, phase, workset, design option, ownership/visibility where supported; reject unsupported combinations deterministically.
- Add stable response/version/identity validation, non-null statuses, empty-result semantics and strict time/payload limits.
Suggested files: unified_native/RevitApiRouter.cs plus new unified_native/handlers/*.cs or equivalent; connection/bridge.py; services/element_service.py; tools/element_tools.py; tests/native_dispatch and native_http.
Acceptance: regression parity for current read routes; no API access outside ExternalEvent; wrong binding fails closed in host.

B04 — Parameter catalog and exact parameter lookup:
- Implement get/list parameters for one/bounded set of element IDs; resolve BuiltInParameter, GUID and names with ambiguity policy; return instance/type origin, storage type, value, internal/display unit, parameter spec, readonly status.
- Correct revit_list_elements parameters promise: either implement bounded selected parameters or change deprecated behavior with explicit compatibility strategy.
- Test numeric double, int, string, ElementId, null/unset, shared parameter, duplicate names, type-only, readonly, locale and unsupported storage.
Suggested files: unified_native/handlers/ParameterReadHandler.cs, services/element_service.py, tools/element_tools.py, tests/test_parameters_contract.py.
Acceptance: same requested value and scope as Revit UI on R0/R1; no fabricated fields.

B05 — Count, group-by, pagination and completeness:
- Introduce native collector aggregation for placed instances. Count/group-by (Category, Family, Symbol/Type, Level or supported parameter) in ONE native API call, with classification-neutral records.
- Server-side filters before materializing output; use bounded page_size/cursor and deterministic sort for list queries. A cursor must be invalidated on binding/snapshot change and must never imply consistent results across model mutation without a valid snapshot policy.
- For >5,000 records: aggregate produces accurate total; list returns honest pagination or explicit INCOMPLETE/limit. Never send entire model or silently truncate.
- Test zero, one, thousands, 5,001+, family loaded-but-unplaced, renamed category, duplicate family/type names, mid-page model change.
Suggested names to review/freeze: revit_query_elements, revit_count_elements, revit_group_elements, revit_get_parameters, revit_list_parameters.
Acceptance: accurate placed-instance count and grouped breakdown against Revit UI using one principal native read; complete/next_cursor honest.

B06 — Links, relationship and geometry read summaries:
- Query linked document instances with host/link identity and transforms. Default host-only; include linked must be explicit, read-only and distinct from host counts.
- Geometry/location summary (point/curve/bounding box, length/area/volume when measurable), level/host/owner relationships; unsupported geometry distinctly marked.
- Confirm localized identifiers and unit conversion; bound host cannot silently return data from wrong open document.
Suggested names: revit_get_geometry_summary, revit_get_element_relationships and read-only linked-model query.
Acceptance: R0/R2 unit, origin and links reconcile; cross-document refusal and unsupported values are testable.

MCP-1 GATE: Stable count/parameter/aggregate host evidence, high-volume regression, type-vs-instance proof and snapshot/units contract. Reviewer validates both implementation and test quality before READY transitions.

### MCP-2 — Deterministic MEP reads (B07–B09)

B07 — Connector primitives:
- Implement ConnectorManager access for family MEPModel and MEPCurve (duct/pipe/flex/fitting/equipment/terminals as supported) in Revit UI context.
- Serialize connector owner/element, domain, type, direction, profile/shape, origin/basis, dimensions/units, system references and AllRefs with stable identity; avoid assuming connector index is durable globally.
- Handle unconnected, physical vs logical, connectors to same owner, insulation, invalid element, unsupported family and cyclic graph; separate connector owner ID from connector key.
Suggested files: unified_native/handlers/MepConnectorReadHandler.cs, services/mep_service.py, tools/mep_tools.py; tests R1 host comparison.
Acceptance: 501 replaced only after R1 positive/negative/readback evidence. Not connected is valid empty topology, not an error.

B08 — Actual system instances and network traversal:
- Query DuctSystem/PipingSystem actual instances versus system types, member IDs, base equipment and connector topology where supported.
- Implement bounded BFS/DFS with max_nodes, max_depth, visited-key set, filtered domain and stable graph edges; report disconnected islands and completeness reasons.
- Test branching, loops, cross-system references, mixed connected/disconnected, missing equipment, linked-system read-only boundary.
Suggested candidate tools: revit_get_mep_connectors, revit_trace_mep_system, revit_inspect_family_instance.
Acceptance: R1 network membership and edges reconcile to Revit UI inspection; cycles terminate.

B09 — MEP inventories and quantities:
- Read actual duct/pipe sections, fittings, terminals and equipment grouped by category/family/type/system/level, dimensions, flow, measured length, area and explicit quantity units.
- Group/count placed FCU candidate instances neutrally. RevitGPT Brain separately applies knowledge/hvac rules and produces confirmed/probable/ambiguous FCU classifications; MCP must not encode vendor-specific FCU assumptions.
- Add export-friendly bounded JSON; evidence IDs for source object references, completeness and ambiguity.
Suggested candidate tools: revit_summarize_equipment, revit_summarize_ducts, revit_summarize_pipes, revit_quantity_takeoff.
Acceptance: one principal native query yields reliable mechanical inventory; R1 equipment and quantities validated and no manufactured FCU count.

MCP-2 GATE: Host-tested connected and disconnected connector/system fixtures, unit proofs, bounded traversal and exact instance-vs-type accounting; Brain/Knowledge reasoning remains external.

### MCP-3 — Write coordinator and graduated operations (B10–B13)

B10 — Security coordinator FIRST, write gate remains locked:
- Review threat model and design authenticated per-operation native authorization; add typed write contract separate from read access; mandatory exact binding document/host/revision/targets/operation digest.
- Create preview/approve/execute/status workflow with expiry, replay defense, precondition hash and durable operation journal; protect local security artifacts with Windows per-user ACL or equivalent.
- Implement Revit UI-thread Transaction/TransactionGroup coordinator; preflight worksharing/readonly/pinned/design option/linked checks, rollback, exception mapping, postcondition readback.
- Handle pending vs started cancellation and HTTP 504 UNKNOWN; fix Python exception mapping so structured 504 never loses UNKNOWN; resolve operation_id before any human-directed repeat.
- Keep existing mutations disabled until independent security/transaction negative controls pass.
Suggested files: src/model-authority.mjs, src/index.mjs, new src/write-authorization.mjs, connection/bridge.py, BridgeHttpProtocol.cs, BridgeDispatchQueue.cs, new native WriteCoordinator/OperationJournal/WriteAuthorization modules, tests native_http/native_dispatch and JS/Python tests.
Acceptance: cross-model, stale revision, forged/replayed/expired authorization and canceled/timeout writes denied without false success; journal resolves committed vs rejected vs unknown.

B11 — First certified operation: set_parameter:
- Implement EXACT target + parameter identifier, typed values, expected old value, instance/type scope and SpecTypeId/ForgeTypeId unit handling. Preview must explain resolved target and effect.
- Test valid string/int/double/ElementId, shared parameter, type vs instance, duplicate names, readonly, formula, worksharing conflict, pinned/linked restrictions, mixed invalid batch, concurrency and rollback.
- Native readback must equal requested postcondition; operation journal idempotency applies across transport loss.
Suggested files: ParameterWriteHandler.cs, services/mep_service.py or dedicated parameter service, tools/mep_tools.py and tests.
Acceptance: R4 positive + negative + rollback + duplicate/replay + restart/timeout evidence. Only revit_set_parameter can become READY when all gates pass.

B12 — Non-destructive placement and movement:
- Graduate revit_move_element and revit_place_family_instance individually, then bounded bulk parameter updates; resolve family/type/level/place mode, host/face requirements and coordinate units before mutation.
- Validate Move with dependent elements, constraints, pinned, group membership and postcondition geometry. Validate placement with hosted/nonhosted symbols, symbol activation, level, orientation and requested offsets.
- Extend to revit_create_duct and revit_create_pipe only after validated MEP systems/type IDs, connectors, sizes and regeneration; fail safely for incompatible systems.
Acceptance: separate host evidence, readback and rollback for EACH newly READY action; no all-write blanket transition.

B13 — Annotations and destructive delete:
- Graduate text note, detail line, tag, dimension and spot elevation with valid view plane, reference/leader/style/type requirements and host readback. Specialized cases can remain BLOCKED when not reliably supported.
- Implement delete dependency/cascade preview in a rolled-back transaction or other safe validated mechanism; show expected removals and require fresh explicit specific approval. Verify dependent set after commit.
- Ensure cross-model, linked and ambiguous bulk selections refuse safely. No broad "delete all matching" without bounded reviewed target IDs.
Acceptance: each READY tool has real-host positive/negative/rollback/readback evidence. Delete requires cascade preview + approval + no unaccounted removal.

MCP-3 GATE: independently reviewed auth mechanism, replay/unknown-outcome tests and host Transaction evidence. No shortcut from Python fake-success tests to native READY. Do not run on production RVT.

### MCP-4 — Everyday BIM documentation and authorship (B14–B16)

B14 — Documentation read inventory:
- Views/templates/filters and visibility; sheets/titleblocks/viewports; schedules/fields and safely extracted displayed rows where API supports; levels/grids/rooms/spaces; warnings/constraints; element dependencies/selection.
- Treat template vs instance, schedule definition vs formatted display, hidden view elements and linked categories as distinct. Explicit unsupported rows/fields.
- Avoid overly broad one-shot output; use aggregation and pagination.
Acceptance: UI schedule/room/sheet data matches host fixture with units and scope.

B15 — Curated read/write authoring:
- Prioritize view/filter/template edits, view/sheet creation and placement, tags/dimensions where validated, bounded bulk edits; do NOT enable all because CP3 write core exists.
- Reuse B10 coordinator, no independent transaction implementations. Verify browser/UI panel and model binding unchanged.
Acceptance: each implemented new mutation independently approved with host transaction and readback tests.

B16 — Workflow integration boundary:
- Publish typed capability metadata to the existing RevitGPT Registry for discovery by Brain, Jobs and Dynamo runner; no separate MCP-owned Knowledge, Job or Dynamo store.
- Document safe query/output contracts for future Jobs. Any Custom Job remains Direct (reviewed deterministic executable) or Reasoning (JOB.md orchestrated by Brain), stored canonically in managed Local AppData.
- Do not add run-any-Python or run-any-Dynamo endpoint.
Acceptance: safe discovery does not bypass actual authorization; jobs/knowledge remain separate, existing registry tests pass.

MCP-4 GATE: prioritized everyday BIM capabilities have real-host evidence; unsupported items remain listed BLOCKED/PENDING with explicit reasons, not silently deferred as READY.

### MCP-5 — Reliability, latency, hardening and release (B17–B19)

B17 — Correlated performance and bounded calls:
- Instrument trace_id across ChatGPT-facing Node, Python stdio, native HTTP, dispatch queue and Revit API; include cold/warm state, payload bytes, API duration, queue wait, number of tool invocations and cache provenance.
- Use native group-by for simple counts: objective is ONE principal Revit model call. Avoid broad results shipped to model and stale cached live counts.
- Measure p50/p95 cold/warm on tiny, MEP and large fixtures; distinguish inference time from MCP transport. Historic targets (not observed facts): warm underlying MCP p50 <=2 seconds, p95 <=5 seconds; user-facing simple warm query p50 <=10–15 seconds. Rebaseline if constraints differ rather than relaxing silently.
Acceptance: observed and reproducible latency distributions and attribution, no accuracy regression.

B18 — Recovery and safety regression:
- Revit start/stop, close/reopen bound model, tab A/B manual rebind, sleep/wake, native restart/host_instance change, stale tool inventory, disconnected Python stdio, failed/slow native queue, invalid parameter ID/units, >5k queries, connector loops.
- Write-specific: timeout after start, duplicate operation ID, forged auth, expired token, stale approval hash, denial due to model/worksharing/linked context, partial failure and Transaction rollback.
- Cancel queued requests safely; once started, report UNKNOWN until journal reconciliation. Run read and write regression separately.
Acceptance: no cross-model disclosure/mutation, no unsafe retry, correct recovery states and no hidden duplicate operation.

B19 — Evidence-driven release:
- Produce release manifest with commit, 23-tool gap closure, added tool contracts, per-tool READY/HOST_TESTED/BLOCKED, tests, mock vs live distinctions, durations, installation version, installed host check, release change diff and rollback plan.
- Independent Tester reviews live screenshots/logs/model readback and Reviewer reviews BOTH source and tests. Native DLL updates require new immutable install version and reopen Revit for host smoke.
- Run two-tier gates: offline CI then Windows Revit 2024 live host. A disconnected host is TEST_BLOCKED, never PASS.
- Release to main ONLY after all V1 exit criteria, review approval and user-directed release choice. Retain official installed product rollback support.
Acceptance: V1 is demonstrably useful and safe, not merely 23 tools visible.

MCP-5 GATE: CI PASS + independently confirmed host gates + signed-off release evidence + no critical security/accuracy regression. Missing host evidence blocks READY and release.

## 6. Shared quality matrix and regression requirements

Mandatory positive/negative scenarios by class:
- Diagnostics: host running/offline, no active document, duplicate Revit host/port owner.
- Binding: first sole model auto-bind; A/B mismatch; explicit bind; closed/reopened document; host_instance change; stale revision; linked/family document.
- Elements: empty/large sets, family loaded vs placed, instance/type parameter collisions, localized categories, room/view visibility, >5k and pagination invalidation.
- MEP: connector-free family, equipment and curve connectors, real system types vs instances, graph cycles, disconnected islands, unit tolerance and quantity provenance.
- Mutations: preview and exact approval, validity of targets and old value, success readback, Transaction rollback, replay, timeout UNKNOWN, invalid/missing auth, worksharing, linked-element refusal and delete cascade.
- Infrastructure: Revit ExternalEvent UI thread enforcement; no API calls from HTTP worker; source-built native .NET net48 warning-free; PowerShell path-with-spaces and install rollback; Windows sleep/wake.
- Regression: all P1/P2 session/read-only tests and current WebView2 behavior must continue to pass.

Deliver evidence for EACH checkpoint:
1. SPEC/contract changes (source commit and compatibility decision).
2. Test matrix plus genuine negative control and expected failures.
3. CI/offline results with commands and environment.
4. Host version/fixture checksums, sanitized request/response and Revit UI readback where required.
5. Risk/security review, diff and rollback method.
6. Reviewer verdict; registry status changes only after evidence.

Do not use optimistic "mock transaction committed" assertions to prove a native write. A negative control must fail when production handler is intentionally replaced with a 501/stub, when authorization is bypassed, or when expected Revit readback differs.

## 7. Batch-to-file implementation ownership

| Batch | Primary code paths | Primary verification |
| --- | --- | --- |
| B00–B02 | tools, services, BridgeRouteContract.cs, manifests, tests, CI evidence | 23/23 coverage; model binding and host baseline |
| B03 | RevitApiRouter.cs, new native read handlers, bridge.py | preserve current public route parity |
| B04 | native ParameterReadHandler, element_service.py, element_tools.py | typed parameter UI readback |
| B05 | native ElementQuery/AggregateHandler, element_service.py | aggregate equals Revit counts; >5k |
| B06 | native relationship/link/geometry reads | R2 linked constraints and units |
| B07 | native ConnectorReadHandler, mep_service.py, mep_tools.py | connector positive/negative host fixtures |
| B08 | native MEP graph/system handlers | real systems and bounded traversal |
| B09 | MEP summaries, quantity service | equipment/duct/pipe reconciled |
| B10 | model-authority.mjs, index.mjs, native WriteCoordinator, BridgeHttpProtocol.cs, bridge.py | security/replay/UNKNOWN/rollback |
| B11 | native ParameterWriteHandler, Python service and tool | first safely enabled write |
| B12 | native movement/placement/duct/pipe handlers | each action separately certified |
| B13 | native annotation/delete handlers | view correctness, cascade preview |
| B14–B16 | new ViewsSchedules/Docs handlers and registry metadata | schedule/room/sheet truth and read/write separation |
| B17–B19 | Node/Python/native traces, CI and release scripts | latency, recovery and real host release gate |

Naming of NEW files and NEW tool names is proposed, not frozen until MCP-0 schema review. Maintain compatibility with the existing public 23-tool surface.

## 8. Development, test, review and commit cadence

Development workflow for each batch:
1. Planner checks current branch HEAD, prior gate evidence and module ownership; updates batch spec and risk assumptions. STOP on unexpected changes, do not overwrite concurrent modifications.
2. Implementer creates a bounded code change with test red-control, implementation, compatibility evidence and no unrelated UI change.
3. Tester runs unit/native simulation and applicable real Revit 2024 host fixture. Host unavailable => explicit TEST_BLOCKED and READY unchanged.
4. Reviewer checks code AND tests, binding/security, public contracts, data shape/units and claims vs actual evidence. Findings return to Implementer.
5. On PASS, checkpoint commit directly to canonical work branch and update coverage evidence; no floating work branches, no repeated speculative install/deploy.
6. Native change: build Release with warnings as errors, install new immutable commit-based version only after Revit is closed, then real host smoke and rollback documentation.
7. Gate transition occurs on independently meaningful milestone, not every minor commit.

Examples of existing checks to preserve and extend:
- dotnet build runtimes/Revit-mcp/bridge/unified_native/RevitGPT.Native.csproj -c Release -warnaserror
- powershell -File scripts/run-revit-mcp-tests.ps1
- node scripts/test-model-authority.mjs
- node scripts/test-mcp-session.mjs
- node scripts/test-capability-registry.mjs
- dotnet run --project runtimes/Revit-mcp/tests/native_http/NativeHttpTests.csproj -c Release
- dotnet run --project runtimes/Revit-mcp/tests/native_dispatch/NativeDispatchTests.csproj -c Release
- .github/workflows/p1-revit-mcp-bootstrap.yml (offline gate)
The specific shell and Revit API locations must be selected by the current local environment. Do not assert these tests were run in this planning-only commit.

Review triggers: breaking schema changes, new native HTTP route, mutation auth changes, new write capability, non-idempotent recovery, linked-model support, Revit API version assumptions and host installation changes. When one occurs, require independent review before next gate.

## 9. V1 exit conditions and explicit hold points

Necessary V1 outcomes:
- 23 baseline tools fully and honestly classified, with no declared-but-untracked capabilities;
- fast placed-instance count/group-by and parameter reads cross-checked against live Revit 2024;
- proven connectors/actual MEP systems and export-ready MEP quantities with explicit units and completeness;
- at least one host-certified parameter mutation plus additional individually certified common writes; unsupported advanced/deletion operations may remain BLOCKED with named owner/reason;
- secure per-operation write authorization, no cross-model writes, verified rollback and no blind retry after ambiguous timeout;
- enough documentation primitives for common architectural/MEP tasks; Registry does not claim unsupported tools READY;
- correlated performance/recovery evidence and working installed UI/binding with no regression;
- independent Tester and Reviewer verification including live Revit readback; release rollback ready.

HOLD before enabling first mutation: B10 review and host security proof.
HOLD before declaring MCP-1 or MCP-2 READY: real host fixtures, not mocked output.
HOLD before merging main: MCP-5 full release gate + user release approval.
HOLD on Revit disconnected: code/test may proceed offline, host-tested status remains blocked.

## 10. Immediate next action (implementation handoff)

Start B00/B01 under MCP-0, in that order:
1. Pin current source and test inventory, create tool coverage schema and test-classified fixture catalog.
2. Build an automated 23-tool source-to-native matrix; hand-audit actual handlers and response shape.
3. Fix inaccurate existing tool descriptions; write negative controls distinguishing fake-bridge responses and native implementation.
4. Run full offline regression; request real Revit 2024 host access only for B02, with no write operations.
5. Record Reviewer verdict on the MCP-0 evidence before MCP-1 feature work.

This plan is a planning document only. No source runtime functionality, installation, binding or production RVT is modified by its creation.
