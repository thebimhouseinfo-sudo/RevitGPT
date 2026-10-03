# Decision and evidence register

| ID | Statement | Status | Basis | Gate / follow-up |
|---|---|---|---|---|
| D-01 | One chat binds one RVT model | HUMAN | Product decision | Acceptance |
| D-02 | Lease idle timeout = 15 min | HUMAN | Product decision | E4 |
| D-03 | Any message in same bound chat refreshes lease | HUMAN + EVIDENCE_REQUIRED | Requires stable chat identity | E0 |
| D-04 | Lease expiry makes model free for any chat | HUMAN | Product decision | E4 |
| D-05 | Historical owner has no post-expiry priority | HUMAN | Product decision | E4 |
| D-06 | rg/stop may release still-valid lease | HUMAN | Product decision | E4 |
| D-07 | Control-plane restart/crash drops leases | HUMAN | Simplicity decision; no WIP recovery need | E4 |
| D-08 | 1 candidate model fast-binds; 0/>1 shows Welcome | HUMAN | Product decision | E3 + E4 |
| D-09 | View/tab/window is not model authority | HUMAN + EVIDENCE_REQUIRED | Real Revit workflow observation | E3 |
| D-10 | x-openai-session is sufficient as chat_identity for the 15-minute lease | EVIDENCE | Chat A kept one x-openai-session fingerprint for ~14h14m across 5 MCP transports; Chat B had a distinct session fingerprint while sharing the same subject fingerprint | E0 complete; retain restart=>fresh-bind fallback |
| D-11 | One runtime can enumerate models across multiple Revit processes | UNKNOWN | No solid ref | E3 |
| D-12 | Exact RVT model authority key | UNKNOWN | Must be measured | E3 |
| D-13 | Exact observable GPT/plugin liveness signal | UNKNOWN | Chat UI open/closed is not observable contract | E2 |
| D-14 | MCP ON is independent from model lease and bridge connectivity | HUMAN | Product lifecycle decision: bridge loss alone is not Revit OFF and must not stop full MCP | E2 |
| D-15 | CAD-Agent Revit MCP is migration baseline | REF/HUMAN-EVIDENCE | Previously used for real read/write/delete | E1 regression |
| D-16 | Dynamo .dyn is user-owned, not bundled toolkit | HUMAN | Product decision | P3 |

| D-17 | Revit OFF lifecycle authority is Windows process absence, not bridge health | HUMAN + EVIDENCE_REQUIRED | Human states Windows process can be read; P1 uses Revit.exe process absence as the current candidate | E2 confirms actual process naming/PID/session behavior |

| D-18 | Full Revit MCP activation requires both Revit ON and explicit @rg/admission invocation | HUMAN | Product lifecycle decision | P1 implementation |
