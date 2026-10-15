# P2E hotfix — Cross-request MCP admission is not a model lease

> **HISTORICAL / SUPERSEDED AS A DEVELOPMENT GATE — 15/10/2026.** Retain evidence and any still-applicable Revit host details only. Current user-level scope is [Product Goal & P1/P2/P3](../../roadmap/PRODUCT_GOAL_AND_PHASE_PLAN.md); see [Change Register](../../roadmap/PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md). Old milestone dependencies, checkpoint/resume, stop/recovery and mandatory test gates below do not govern new implementation. Do not infer current code status from historical plan status.

## Real runtime failure reproduced
Live `revitgpt_status` returned native Revit ON, bridge ON, Python 23 tools,
but `admitted:false` immediately after `revitgpt_admission=READY`. A separate
`revitgpt_call(revit_get_active_document)` then threw
`REVITGPT_ADMISSION_REQUIRED`. Session-local boolean cannot be used as a gate
when ChatGPT MCP proxy/recovery reconstructs server instances between calls.

## New contract
- Only a user's **explicit tool request** activates the Python MCP.
- A model read first verifies native `BOUND_CURRENT` against the request's
  document ID and denies wrong/closed/other-active targets.
- Mutations and unknown tools are denied by the native readonly allowlist
  **before any upstream activation**, and still HTTP 501 in Revit.
- Cold runtime checks Revit process and bridge health, activates once; warm
  runtime reuses the existing 23-tool cache.
- An explicit `revitgpt_list_tools` also initializes runtime as needed.
- `revitgpt_admission` is retained as a diagnostics/explicit connection
  command for backwards compatible clients, not required by read calls.
- `revitgpt_status` reports `admission_required_for_reads:false` and a
  per-call binding check, not an unreliable session-local admitted boolean.
- No native add-in update, pairing, cookies, or per-chat lease.

## Acceptance
In actual WebView ChatGPT session, after a control-plane restart, request
`revit_list_levels` directly (without manual admission), on a disposable
currently-bound test RVT. It must read. Then test B active mismatch, B rebind,
closed B, and ensure any write is denied. Don't modify MAGS.
