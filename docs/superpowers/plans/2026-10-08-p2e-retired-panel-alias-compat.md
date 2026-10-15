# P2E compatibility: ChatGPT connector still advertises retired pairing tools

> **HISTORICAL / SUPERSEDED AS A DEVELOPMENT GATE — 15/10/2026.** Retain evidence and any still-applicable Revit host details only. Current user-level scope is [Product Goal & P1/P2/P3](../../roadmap/PRODUCT_GOAL_AND_PHASE_PLAN.md); see [Change Register](../../roadmap/PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md). Old milestone dependencies, checkpoint/resume, stop/recovery and mandatory test gates below do not govern new implementation. Do not infer current code status from historical plan status.

## Live evidence (2026-10-08)
In WebView2, ChatGPT displayed `NATIVE_MUTATIONS_NOT_ENABLED` and concluded
model reads were blocked. The local tool-calls log shows the *actual* failed
request was `revitgpt_call(name="revitgpt_pair_panel")`, **not** a Levels read.
A direct `revitgpt_call(name="revit_list_levels", arguments={})` from the same
live RevitGPT runtime succeeded and returned Level GF (element 1303717).
A separate read of `revit_get_active_document` confirmed MAGS was active.

Root cause: stale ChatGPT plugin tool description advertises P2D pairing/lease.
This description may remain cached independently of the updated MCP server
registration. Updating source metadata alone cannot guarantee live connector
metadata refresh.

## Compatibility
- Catch *only* deprecated `revitgpt_pair_panel` and
  `revitgpt_lease_bound_model` in the existing generic call entrypoint.
- Read native binding status; return `RETIRED_CONTROL_NO_LEASE_REQUIRED` and
  explicit `revit_list_levels` next tool when BOUND_CURRENT.
- Never grant a lease, issue a Pair code, or call Python from an alias.
- Reject arguments to retired names; inactive/closed model never suggests
  an immediate read.
- Explicit admission READY text points to the current P2E read workflow.
- Other unknown mutation tool names remain denied.

## Host validation
After `git pull` and `run.bat restart`, ask `@rg` to read Levels in
current MAGS. The direct read must succeed without Pair/Lease.
If the connector still chooses an old tool, it should receive migration
guidance and proceed to the real read. Persistent old tool descriptions
require a separate plugin metadata refresh; do not infer connector UI updates
from GitHub source.
