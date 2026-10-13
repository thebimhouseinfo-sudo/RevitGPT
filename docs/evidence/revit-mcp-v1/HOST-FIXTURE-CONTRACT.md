# Revit MCP V1 — Revit 2024 real-host fixture contract

Status: PLANNED / NO LIVE FIXTURES CLAIMED. Applies to the canonical detailed plan (Planner R2), MCP-0 B00/B02 and E01–E09. The static source audit is scripts/audit-revit-mcp-coverage.mjs. Never store a production RVT, named customer model, secrets, cloud tokens or private user paths in this public repository.

## Non-negotiable fixture rules

1. Create each RVT only from a disposable blank/test project or a locally created artificial model. MAGS and other user project data are excluded from all mutation tests.
2. Record Revit 2024 build, RevitGPT commit + native installed version, Dynamo build if applicable, SHA-256 for every fixture and .dyn, setup procedure, expected facts observed in UI, exact test timestamp, tester, source file revisions and rollback instructions.
3. Keep public evidence sanitized. The RVT files and sensitive logs live only in an explicitly controlled local test directory, not in GitHub; public reports may contain fixture pseudonyms and hashes.
4. The default MCP-0/1 test is READ_ONLY. WRITE test execution is blocked until MCP-3 B10 authorization/security gate and disposable-model confirmation pass.
5. A generated fixture is not the same as an independently verified expected result. Record the Revit UI check independently of the MCP response.
6. For any blocked/unsupported result, log precise failed precondition and implementation status. Do not mark a fake bridge response or simulation as host PASS.

## Required fixture recipes

| ID | Setup recipe | Expected/negative coverage | Approval |
| --- | --- | --- | --- |
| R0 architecture | New test RVT with multiple levels, views, at least two placed wall instances, a loaded-but-unplaced family and a placed family instance | levels, filtered counts, instance vs type, geometry and no-model case | READ |
| R1 MEP | Synthetic FCU-like mechanical equipment family instances, ducts/pipes/terminals/fittings, one connected branch, one disconnected branch, real mechanical/piping system TYPES and INSTANCES | connectors AllRefs, system membership, graph loops/termination, schedule quantity comparison; never infer FCU from a family name without Brain Knowledge | READ then gated WRITE |
| R2 binding/link | Two simultaneously open disposable RVTs A and B, with a separate linked RVT and an optional workshared fixture | bound vs active mismatch, explicit manual rebind, close/reopen, link scope, stale revision and no writes to unbound/linked models | READ and UI |
| R3 volume | Disposable RVT with greater than 5,000 PLACED instances across at least two categories/types; include zero-match filter | count/group correctness, bounded list/pagination, no truncated success, changed-model cursor invalidation | READ |
| R4 parameters/write | Disposable RVT with String/Integer/Double/ElementId parameter types, writable and readonly instance/type/shared GUID parameters, plus a dependent-delete case | exact parameter metadata, set vs clear vs skip, batch atomicity, authorization, rollback, timeout UNKNOWN, duplicate request and cascade preview | MCP-3 only |
| R5 documentation/UI | Test views with view templates, crop/section box, taggable objects, tag/note/dimension/spot types, sheets, viewports and a schedule | select/clear/zoom/activate/temporary isolate/reset; view graphics/template limits; tag leader/editing, sheets and schedules | UI then gated WRITE |
| R6 Dynamo loader | Trusted, minimal compatible .dyn file with manual graph execution sentinel that can be inspected independently; separate corrupted/unsupported/package-dependent variants | file hash, allowed staging/paths, missing package rejection, correct current RVT, OPEN in MANUAL, no RUN and no Revit/file/network side effects | LOAD only, approved fixture |
| R7 model authoring | Disposable simple model with valid test levels/types/sketch planes and writable blank areas | straight wall, valid basic floor/ceiling profiles, grid/level/model-detail curves, copy/rotate/change-type, illegal-profile rollback | MCP-3 only |

## Mandatory combined real-host workflows

E01 query/filter/aggregate -> select/show/zoom/clear on R0/R3/R5.
E02 select -> inspect/read/batch edit/copy parameters -> verify/rollback on R4/R5.
E03 draw model/detail curves, wall/floor/ceiling/level/grid -> copy/rotate/change type -> verify on R7.
E04 real MEP systems -> connectors/graph -> quantity and UI comparison on R1.
E05 tag/note/leader/dimension/spot create and edit -> verify references and position on R5.
E06 activate view -> temporary isolate/reset -> properties/crop/template/graphics/filter -> screenshot and readback on R5.
E07 create sheet and viewport -> schedule definition fields/filter/sort -> UI/readback on R5.
E08 import a trusted local .dyn -> verify MANUAL/no-run/no side effect -> negative cases on R6.
E09 models A/B, manual rebinding, close/reopen, sleep/wake, stale auth, write timeout UNKNOWN/no blind retry on R2/R4.

Each E0x passes only with positive and negative real Revit 2024 observations; the 9-case list is not evidence that these tests have run.

## Per-test evidence envelope (template)

```json
{
  "schema_version": 1,
  "test_id": "E01",
  "status": "TEST_BLOCKED",
  "classification": "LIVE_READ",
  "source_commit": null,
  "native_install_version": null,
  "revit_version_build": null,
  "dynamo_version": null,
  "fixture_id": "R0",
  "fixture_sha256": null,
  "request_trace_ids": [],
  "expected_ui_observations": [],
  "observed_revit_api_results": [],
  "negative_controls": [],
  "transaction_and_readback": null,
  "visual_evidence_refs": [],
  "reviewer": null,
  "limitations": ["Not executed in real Revit host"]
}
```

Allowed classifications: OFFLINE_SOURCE, OFFLINE_SIMULATION, LIVE_READ, LIVE_UI, LIVE_WRITE, LIVE_DYN_LOAD. A test with no Revit/Dynamo host evidence is TEST_BLOCKED, not PASS. W/X and L require their own explicit gates; loading Dynamo is not permission to execute it.

## MCP-0 handoff

Run from repository root:
```powershell
node scripts/audit-revit-mcp-coverage.mjs --write
node scripts/test-revit-mcp-coverage.mjs
```

The command generates `docs/evidence/revit-mcp-v1/coverage-mcp0.json` and `coverage-mcp0.md` as source-only diagnostics. The artifact must not carry host-ready flags. Before collecting live host evidence, verify the installed native version, panel visibility and bound model; new native code requires a new immutable locally installed version after closing Revit.
