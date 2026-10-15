# P2A — Native model binding preview

> **HISTORICAL / SUPERSEDED AS A DEVELOPMENT GATE — 15/10/2026.** Retain evidence and any still-applicable Revit host details only. Current user-level scope is [Product Goal & P1/P2/P3](../../roadmap/PRODUCT_GOAL_AND_PHASE_PLAN.md); see [Change Register](../../roadmap/PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md). Old milestone dependencies, checkpoint/resume, stop/recovery and mandatory test gates below do not govern new implementation. Do not infer current code status from historical plan status.

**Scope: SOURCE ONLY. No host installation, production deployment or main merge.**

- Single in-process binding persists through pane/WebView recreation; cleared on Revit shutdown.
- Revit Idling observes active and open documents, and consumes queued explicit requests.
- WPF has **Bind Current (preview)** plus neutral/green/orange/yellow indicators. It reads only snapshots; no Revit API calls.
- Tab/view switches do not change bound model; close/reopen invalidates binding until explicitly rebound.
- A request targets the last observed active ID. Switching before Idling rejects it rather than silently binding another model.
- This is NOT a ChatGPT/MCP capability lease. The native bridge still refuses writes (501).

**Remaining gates:** explicit authenticated MCP lease and binding status protocol; enforce bound authority on MCP calls; two-disposable-RVT host QA including WebView recreation and sleep/resume; then rename to **Lease + Bind Current**. Never imply that UI binding itself authorizes mutation.
