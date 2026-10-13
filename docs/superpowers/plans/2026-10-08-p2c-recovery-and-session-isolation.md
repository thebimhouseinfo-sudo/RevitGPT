# P2C — Lifecycle hardening before one-click leasing

P2B host tests: user reports 6/6 PASS for two disposable RVTs.

- MCP admission is now a boolean scoped to **one MCP server/transport instance**. Never authorize another session merely because both sessions advertise the same subject/session header. Session recovery requires fresh admission.
- Native HTTP listener marks IsRunning=false when its accept loop exits unexpectedly.
- Revit Idling attempts native listener recreation with bounded backoff (2→4→8→16→32→60s); manual Refresh bypasses waiting, never restarts a healthy listener.
- Startup/keepalive work remains within Revit Idling and never blocks with synchronous waits.
- P2B read-only binding and per-session manual lease stay unchanged; all writes remain disabled.

## Safety gate for a genuine one-click "Lease + Bind Current"
The dockable panel cannot identify an authenticated remote MCP session today.
Granting all admitted sessions a lease after one panel click would violate
per-session isolation. Therefore P2C **does not** falsely rename Bind Current
(preview) or silently auto-grant any lease. One-click requires an authenticated
and demonstrated panel↔ChatGPT session handshake; the manual explicit
revitgpt_lease_bound_model tool remains the safe, supported transition.

Real Revit host QA still needed: sleep/wake, listener restart, MCP session
reconnection, unchanged bound model and non-regression in multi-RVT usage.
Do not update main or any production model.
