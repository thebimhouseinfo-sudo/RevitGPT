# Skill: revit-mcp-dev
Status: development-only

Safely improve the Revit MCP implementation from real runtime evidence.

## Boundary
Writable source is restricted to `runtimes/Revit-mcp/**`. This skill is registered only when `REVITGPT_DEV_MODE=1`.

## Mandatory mutation lifecycle
1. Read/search source and runtime evidence.
2. Create an immutable `revit_mcp_dev_snapshot(execution_id)`.
3. Make the smallest hash-guarded create/edit/delete needed.
4. Run `revit_mcp_dev_validate`.
5. If validation fails, patch narrowly or `revit_mcp_dev_rollback`.
6. If live Revit behavior is involved, test on real Revit before acceptance.
7. Only after successful evidence call `revit_mcp_dev_accept_local`.

## Self-improvement rule
Runtime/tool failures may produce diagnostics and candidate improvements, but production RevitGPT must never mutate its own MCP source automatically. Source mutation requires explicit development mode and this controlled lifecycle.

## Evidence sources
- `appdata/logs/errors.ndjson`
- `appdata/logs/tool-calls.ndjson`
- `appdata/logs/revit-mcp.ndjson`
- `appdata/knowledge/failures/**`
- real Revit read/write/readback evidence
