# RevitGPT Working Knowledge

Curated durable operating knowledge promoted from real use.

## Model authority
- RVT model is the binding authority.
- Revit views/tabs/windows are presentation state and never redirect a bound model.
- Current Revit facts must be read fresh when correctness depends on live state.

## MCP lifecycle
- Revit OFF -> full Revit MCP OFF.
- Revit ON without @rg -> full Revit MCP OFF.
- Revit ON + @rg -> full Revit MCP ON.
- Bridge connectivity is not Revit process lifecycle authority.
- Lease/model authority and MCP lifecycle are separate.

## Authoring
- User Python, Dynamo, and Jobs live in AppData libraries and are authored through workspace drafts.
- Production runtime never self-modifies Revit MCP source.
- MCP improvement uses development-only revit-mcp-dev with snapshot/validate/rollback.

## Knowledge maintenance
Raw failures belong in diagnostics/error logs or AppData knowledge/failures. Promote only stable lessons here.
