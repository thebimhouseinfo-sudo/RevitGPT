# Revit MCP V1 — Implementation Plan (separate tool subsystem)

Status: IMPLEMENTATION PLAN ONLY. Revit MCP is one component used by RevitGPT, not the RevitGPT brain.
Architecture authority: docs/architecture/REVITGPT_BRAIN_MCP_KNOWLEDGE.md.
Target host: Revit 2024 with stable installed panel. No runtime change in this plan commit.

## Scope

IN: Python FastMCP schemas and services, the Revit-specific Node forwarding/authorization boundary, native Revit Bridge/Revit API read/write handlers, transaction coordinator, test fixtures, tool execution logs, and performance.

OUT: reasoning/planning done by RevitGPT; SOURCE Knowledge organization, retrieval and teaching; Job orchestrator; Dynamo graph authoring/execution; broad RevitGPT Capability Registry management. These components consume Revit MCP contracts but are not implemented INSIDE Revit MCP.

## Grounded starting point

Python declares 23 Revit tools: 12 read/diagnostic and 11 writing commands. Node refuses all writes; native bridge returns HTTP 501 for writing and Connector reads. Several Python descriptions advertise requested parameters and richer data native does not currently return. Route registration is not implementation. Earlier combined plan is superseded.

## Tool contract

Every tool must have a stable ID, exact purpose, when to use/not use, Revit category/class prerequisites, typed input/output, explicit units, native handler, capability/risk, mutation effects, host evidence and status DECLARED / IMPLEMENTED / HOST_TESTED / READY / BLOCKED. No source-only assertion of READY. RevitGPT Registry consumes tool metadata; knowledge is not an MCP contract.

Every model call carries model binding identity, request/op ID and structured outcomes. The native host validates binding at execution time. Unavailable linked data, large result sets, unsupported classes or 501 routes must never masquerade as success.

## Checkpoints

### MCP-0: comprehensive gap audit and truthful declarations
Match each Python tool against service, bridge.py HTTP route, native handler, response shape and live host evidence. Correct misleading parameter/annotation/connector/unit descriptions. Produce a machine-readable coverage matrix with REAL/PARTIAL/STUB/BLOCKED, baseline tests including negative controls and reproducible E2E host fixtures.
Gate: 23/23 accurately classified; no UNKNOWN hidden by CI green.

### MCP-1: usable model reading, parameter inspection and fast aggregation
Implement native category/element/instance/type lookup, parameter metadata and values (including correct storage and ForgeTypeId units), levels/worksets/phases/design options, links, geometry/location, limit/pagination and completeness markers. Expose one-call count and group-by queries executed inside Revit rather than shipping thousands of objects to the language model.
Gate: actual placed-instance counts and requested parameters agree with Revit UI on disposable RVT, including empty/high-volume and type-vs-instance cases.

### MCP-2: complete MEP read primitives
Implement real ConnectorManager readback for family equipment and MEPCurve, mechanical/piping SYSTEM INSTANCES (not merely system types), duct/pipe/terminal/fitting metadata, connected references and graph traversal, quantities and export-ready summaries.
Gate: connected and disconnected MEP host fixtures, linked-model constraints, exact IDs and unit values read correctly. RevitGPT (outside MCP) combines these facts with source knowledge/hvac/ for FCU reasoning.

### MCP-3: native write/edit/delete engine
Replace GLOBAL read-only refusal with per-tool write authorization once actual implementations are proven. Guard exact bound document/revision, user intent and operation identity; preflight/dry run, Revit UI-thread Transaction, atomic commit or rollback, readback, postcondition evidence, timeout outcome UNKNOWN and no blind retry. Do not assume localhost request IDs authenticate writes. Start with revit_set_parameter on a disposable RVT, then move/place, duct/pipe, annotations, then delete with dependency/cascade preview and explicit consent as risk warrants.
Gate: real host positive + negative + rollback + duplicate/replay tests; NEVER write to production MAGS.

### MCP-4: broad authoring and documentation primitives
Build views, sheets, schedules, templates, dimensions, annotations, rooms/spaces/grids, warnings, model data and bounded bulk edits. Separate read and write states per tool. No fake partial success or implicit unit assumptions.
Gate: reviewed E2E fixtures and Revit readback for each READY tool.

### MCP-5: performance, reliability and release
Correlated trace IDs across Node, Python, native HTTP and Revit UI queue; cold/warm session costs, payloads and tool-call counts; Revit Sleep/Wake and model A/B rebind regression. Simple count should use ONE principal native data call. Reviewer checks implementation AND tests; CI is not host QA.
Gate: validated results and observed latency distributions, no safety regressions, per-tool READY transitions with evidence.

## Integration boundaries / separate plans

RevitGPT Brain: interpret requests, choose queries, integrate model evidence with subject-matter Knowledge. RevitGPT Capability Registry: discover Revit MCP tools alongside Job/Dynamo/Python assets. RevitGPT Knowledge: reviewed source files knowledge/revit/, knowledge/dynamo/, knowledge/hvac/ etc. Job/Dynamo engines: orchestrate independently and may call MCP primitives.

Knowledge retrieval/source promotion work must be planned and implemented separately; DO NOT place it under a Revit MCP checkpoint.

## Execution and source control

Use existing canonical work branch without scattered branches. Each checkpoint: spec, implementation, positive + negative fixtures, readback, Reviewer inspection of test scripts, accepted commit. Update registry tool READY state only with real host evidence. Native DLL upgrades need deliberate host install/test; Node/Python source can evolve independently when compatible.

Near-term order: MCP-0 -> MCP-1 aggregated count/parameters -> MCP-2 Connectors -> MCP-3 first Parameter write. No installed runtime, write policy or MAGS model is changed by this plan.
