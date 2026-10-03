# RevitGPT

RevitGPT is the ChatGPT-to-Revit runtime currently under active development.

## Setup

Run once from a Windows source checkout:

```bat
setup.bat
```

The installer prepares:

- Node slim control plane;
- Python Revit MCP runtime;
- managed RevitGPT AppData;
- pyRevit bridge with automatic extension startup;
- OpenAI Secure MCP Tunnel;
- Windows tray auto-start;
- source-development `revit-mcp-dev` capability.

Normal daily use does not require `run.bat`.

## Runtime lifecycle

```text
Revit OFF
-> Full Revit MCP OFF

Revit ON, @rg not invoked
-> Full Revit MCP OFF

Revit ON + @rg invoked
-> Full Revit MCP ON

All Revit processes close
-> Full Revit MCP OFF
```

The tray, slim MCP, and Secure Tunnel stay available independently of the full
Revit MCP. Bridge health is connectivity evidence, not Revit process authority.

## Managed AppData

Default root:

```text
%LOCALAPPDATA%\RevitGPT
```

It contains managed Python, Dynamo, Jobs, User Registry, workspace drafts,
knowledge, structured logs, run evidence, state, and dynamic Python runtime
artifacts.

## Internal skills

- `write-python`
- `dynamo`
- `jobcreate`
- `revit-mcp-dev` (development-only)

Production runtime must never mutate Revit MCP source automatically.
Development source changes use snapshot -> hash-guarded mutation -> validate ->
real Revit evidence when required -> accept/rollback.

## Diagnostics

```bat
run.bat status
run.bat doctor
```

## Current gate

E0 chat identity evidence is complete. The next gate is E1 real Revit testing:

```text
ChatGPT @rg
-> full Revit MCP ON
-> enumerate real RVT
-> read
-> controlled write
-> readback
-> controlled delete
-> readback
```

See `docs/evidence/E0-chat-identity-result.md` and
`docs/roadmap/ROADMAP.md`.
