# P2A — Native model binding preview

**Scope: SOURCE ONLY. No host installation, production deployment or main merge.**

- Single in-process binding persists through pane/WebView recreation; cleared on Revit shutdown.
- Revit Idling observes active and open documents, and consumes queued explicit requests.
- WPF has **Bind Current (preview)** plus neutral/green/orange/yellow indicators. It reads only snapshots; no Revit API calls.
- Tab/view switches do not change bound model; close/reopen invalidates binding until explicitly rebound.
- A request targets the last observed active ID. Switching before Idling rejects it rather than silently binding another model.
- This is NOT a ChatGPT/MCP capability lease. The native bridge still refuses writes (501).

**Remaining gates:** explicit authenticated MCP lease and binding status protocol; enforce bound authority on MCP calls; two-disposable-RVT host QA including WebView recreation and sleep/resume; then rename to **Lease + Bind Current**. Never imply that UI binding itself authorizes mutation.
