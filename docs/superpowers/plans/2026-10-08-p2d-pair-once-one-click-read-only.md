# P2D — Pair once, one-click read-only lease

P2A (6/6), P2B (6/6) and P2C sleep/wake (5/5): user-reported host PASS.

## Protocol and security
1. From an admitted ChatGPT MCP session call `revitgpt_pair_panel`: obtain one-time 128-bit 32-hex code (5-minute TTL).
2. Enter it in the native panel and click Pair. The local control plane returns a 256-bit in-memory bearer held **only** in the native process (not WebView2).
3. The panel action changes to Lease + Bind Current. After Revit Idling confirms the **specific** user-selected model and increments revision, the panel calls local /panel/lease.
4. Node checks the bearer against **one MCP server instance**, queries native binding, requires exact host instance/revision/bound ID and grants only that server instance read-only authority.
5. Other MCP sessions do not inherit this lease even when their untrusted ChatGPT subject/session headers match.
6. Native bridge still denies all writes (501). Switching/closing models remains fail-closed.

Security boundary: no WebView2 cookie/DOM inspection, no cross-origin browser calls, no global leases. Pairing must be redone after process restart or invalid token. An ordinary localhost-only app holding a valid bearer can request a lease; the bearer is never exposed by status APIs.

## Test gate
CI must compile Revit 2024 native host, run Node model authorization/pairing negative controls and pane structural tests. Host acceptance must include pairing two competing ChatGPT sessions, code expiry/replay, model switch before Idling, model A/B and sleep/wake. No production model writes.
