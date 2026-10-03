# RevitGPT Error Log

Append-only human-readable log for real RevitGPT/Revit failures, wrong routing, tool failures, latency regressions, workarounds, and defects.

Raw structured runtime errors also live in:
- `%LOCALAPPDATA%\RevitGPT\logs\errors.ndjson`
- `tool-calls.ndjson`
- `revit-mcp.ndjson`
- `bridge.ndjson`

Recommended entry:
```text
date
context / model / task
observed behavior
expected behavior
error / evidence
workaround
root cause (if known)
candidate improvement
status = OPEN | TRIAGED | FIXED | KNOWLEDGE_PROMOTED
```

An error entry does not automatically alter runtime policy. Stable lessons may later be promoted into Working Knowledge.
