# RevitGPT Unified Capability Registry — P3B foundation

Reuse CadGPT pattern: one **effective read-only discovery surface** combines
the immutable Internal Registry and managed User Registry; it cannot grant
model authority, run Dynamo scripts or override internal tool IDs.

## Sources and authority
- Internal: `runtimes/Revit-mcp/tool-manifest.json`, extracted from 23 Python
  MCP decorators with curated selection criteria and read/write risk.
- User: existing `%LOCALAPPDATA%/RevitGPT/registry/user/capabilities.json`
  linked to managed Python, Dynamo, Job libraries.
- Discovery: `registry_list`, `registry_search`, `registry_get`. Execution
  remains `revitgpt_call` plus native Revit binding gate; all model mutations
  remain disabled.
- `semantic_status=indexed` and `risk=unknown` remain untrusted until a
  human-reviewed contract and real host execution evidence exist.
- Curated HVAC knowledge is seeded ONCE to AppData; it is never silently
  overwritten. Search with `knowledge_search`.

## Next: full MCP tool kit
Add business-grade Revit reading and batch native aggregation before write
capabilities: filtered stats, parameter discovery, equipment/system graph,
MEP connectors, geometry / spatial analysis, views/sheets, warnings, schedules.
For FCU count, first build native read-only mechanical-equipment aggregation,
including evidence and ambiguous classification; no guess-by-name.
Then implement guarded write transactions with preview, consent, rollback
and host validation on disposable RVTs. Separate real execution privileges
from registry discovery. Failing CI or preview host gates blocks release.

## Fake CLI
Use CadGPT-style text control `rg/`, `rg/help`, `rg/status`,
`rg/tools`, `rg/job`, `rg/dynamo`, `rg/knowledge`. Fake CLI must be
routing/discovery only; natural language still executes normal Revit requests.
A follow-up delivers the narrow command router and live connector metadata.
