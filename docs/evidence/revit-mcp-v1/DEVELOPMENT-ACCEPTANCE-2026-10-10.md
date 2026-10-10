# Revit MCP V1 — Development acceptance and in-project retest policy

Decision date: 2026-10-10
Owner verdict: **PASS_RETEST_REQUIRED**
Development reference commit: `10846a2f1448b925244a14ad90658eb068adc8df`
CI reference: https://github.com/thebimhouseinfo-sudo/RevitGPT/actions/runs/38057431821 (SUCCESS)
Canonical branch: `work/J-AFC4-p1-revit-mcp-bootstrap`

## Meaning of verdict
- Accept the current offline development checkpoint, compiled native code and CI evidence as **PASS_RETEST_REQUIRED**; do not reopen the whole initial implementation as FAILED merely because an individual tool subsequently fails in the Revit host.
- **PASS_RETEST_REQUIRED is NOT a per-tool READY/HOST_TESTED verdict.** Live Revit 2024 functional testing, especially model mutation, rollback, Dynamo no-run, model binding and E01–E09, remains required before production release.
- Preserve truthful source/runtime labels such as `implemented_unverified`, `pending_native_fixture`, and `read_only_available`; do not bulk promote the 63 manifest entries to READY.
- Maintain safe fixture-only write approval and current one-model binding rules.

## Owner decision: fix failing MCP tools within RevitGPT
RevitGPT is the main workspace and coordinating brain. Revit MCP is its independent Revit API tool subsystem. If a tool fails while testing or operating:
1. Capture exact tool name, parameters (sanitized), model binding identity, expected/observed response, trace/operation ID, environment versions, and safe repro steps.
2. Classify as contract/schema, routing/authorization, native Revit API, UI, environment, or host evidence gap; record a bounded repair task **within RevitGPT**.
3. Prefer dedicated **internal development MCP capabilities** accessible to RevitGPT for source inspection, writing/editing MCP implementation and tests, building, linting, targeted regression, and Git operations. These are developer/system capabilities and must be separate from user-facing Revit model-authoring commands; a model editing tool must not silently become arbitrary source-file or shell authority.
4. Patch the existing canonical development branch, run relevant offline negative controls and complete CI; keep failure evidence and mark affected tool RETEST_REQUIRED.
5. Re-run failed host workflow on a disposable RVT, then affected neighbor workflows and E01–E09 regression as required. Transition an individual tool to READY only after genuine applicable live-host evidence and review.
6. If repair changes the installed Native DLL, stage a new immutable version and follow explicit host upgrade/rollback. No silent hot replacement; no production RVT test writes.

## Backlog for internal developer MCP (separate from Revit API tools)
- Repository read/search and exact-SHA bounded file patch;
- Safe code/test generation limited to the RevitGPT workspace;
- Offline `.NET`/Python/Node test and build commands with allowlisted execution roots;
- Git diff/status/branch/commit and CI evidence reading;
- Failure-to-repair handoff containing reproduction, root cause, changed files, tests, retest checklist;
- No direct unreviewed deployment, automatic production model writes, bypass of native approval or arbitrary local filesystem access.

## Gates
- DEVELOPMENT CHECKPOINT: **PASS_RETEST_REQUIRED** (owner accepted).
- LIVE HOST E01–E09: **PENDING**.
- MCP V1 RELEASE / MAIN MERGE: **NOT AUTHORIZED BY THIS DECISION**.
