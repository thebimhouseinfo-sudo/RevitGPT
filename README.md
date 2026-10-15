# RevitGPT

> **Planning authority (15/10/2026):** [Product Goal & P1/P2/P3](docs/roadmap/PRODUCT_GOAL_AND_PHASE_PLAN.md) defines user-approved scope and work lifecycle. Historical stop-drain, checkpoint and cross-crash Job-resume plans are **not** product requirements. See [Supersession Register](docs/roadmap/PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md). This note changes documentation priority only, not runtime code or current installation.

RevitGPT is the ChatGPT-to-Revit runtime currently under active development.

## Setup and Windows logon startup

RevitGPT has **two separate installations**: (1) the official Native Revit 2024
add-in, using `scripts/manage-native-revitgpt-install.ps1` with explicit approval
while Revit is closed, and (2) the Windows **per-user interactive-logon**
Tray/Slim MCP/Secure Tunnel runtime.

On a machine with the official Native add-in already installed and `.env`,
the verified tunnel profile, Node/Python dependencies and tunnel client ready,
register startup **once**:

```bat
run.bat install
```

This installs/re-reads the `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`
value for RevitGPT, then starts the current Tray/runtime/tunnel. Use
`run.bat start` for a **one-time, non-persistent start** only; it does not
register Windows Startup. `run.bat status` and `run.bat doctor` report whether
the Run registration is missing, stale or conflicting **even if a manual start
currently works**. `run.bat uninstall` explicitly removes this checkout's
owned Run value and stops its host processes.

`setup.bat` sets up dependencies and logon startup **after** it finds an existing
official RevitGPT Native add-in; it will not call the retired unsafe Native
installer or overwrite installed Revit host DLLs. Do not run `setup.bat`
just to repair an already configured Windows startup entry.

Windows starts this per-user Run entry **after interactive sign-in**, not before
a user logs on. Windows may delay startup. After restart/login, Tray, Slim MCP
and Secure Tunnel should be healthy; runtime remains **STANDBY** until explicit
`@rg`. A new boot never auto-replays old jobs, writes or prior awake intent.
Revit/full Python MCP only activate when the canonical lifecycle allows it.

Startup diagnostics are in:
- `%LOCALAPPDATA%\\RevitGPT\\logs\\startup-launch.log` (early WScript dispatch)
- `%LOCALAPPDATA%\\RevitGPT\\logs\\tray.log` (actual tray/component start)
- the configured AppData logs for Node and tunnel errors

These logs must not include tokens, API keys or conversation contents. An absent
launcher log can mean Windows never invoked it; check the Run entry and Startup
Apps state separately. Do not delete `.env`, tunnel profiles or AppData state
when troubleshooting a missing Windows Startup registration.

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
