# RevitGPT

RevitGPT is under active migration planning.

## Immediate evidence work

The first source artifact in this repository is an **independent ChatGPT logical-session stability test**. It reuses CadGPT's existing continuity diagnostics as the evidence source, so the test does **not** require Revit.

See:

- `docs/evidence/x-openai-session-stability.md`
- `scripts/session-stability-report.mjs`

The purpose is to establish whether `x-openai-session` remains stable in the same ChatGPT conversation over **1h / 4h / 8h** before RevitGPT uses it as a long-lived reconnect/lease-refresh identity.


## P1 local setup

Run:

```bat
setup.bat
```

This single installer prepares the RevitGPT control plane, Python Revit MCP
runtime, and pyRevit bridge. No separate runtime/bridge installer is required
for the normal P1 setup flow.
