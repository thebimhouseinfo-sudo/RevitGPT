# Decision and evidence register

Canonical lifecycle contract: [`docs/architecture/AUTHORITY_LIFECYCLE.md`](../architecture/AUTHORITY_LIFECYCLE.md).

| ID | Statement | Status | Basis | Gate / follow-up |
|---|---|---|---|---|
| D-01 | One logical chat binds one primary RVT model at a time | HUMAN | Product decision | E4 |
| D-02 | Ordinary browser/plugin authority mode is `BROWSER_TTL` with 15-minute idle timeout | HUMAN | Product decision | E4 |
| D-03 | A valid same-chat user turn refreshes `BROWSER_TTL` | HUMAN + EVIDENCE | E0 proved stable logical conversation identity across transport replacement | E4 |
| D-04 | `BROWSER_TTL` expiry makes the model free for any chat | HUMAN | Product decision | E4 |
| D-05 | Historical browser owner has no post-expiry priority | HUMAN | Product decision | E4 |
| D-06 | `rg/stop` releases model authority immediately | HUMAN | Product decision | E4 |
| D-07 | Control-plane restart drops in-memory authority; add-in recovery uses fresh pair/rebind and never treats prior idle duration as managed-session expiry | HUMAN | Simplicity + managed add-in recovery decision | E4 |
| D-08 | 1 candidate model fast-binds when allowed; 0/>1 uses Welcome/selection | HUMAN | Product decision | E3 + E4 |
| D-09 | Active Revit view/tab/window is observation only and never model authority | HUMAN + EVIDENCE_REQUIRED | Real Revit workflow observation | E3 |
| D-10 | `x-openai-session` is sufficient as logical chat identity for current authority design | EVIDENCE | Chat A kept one fingerprint for ~14h14m across 5 MCP transports; Chat B had a distinct session fingerprint while sharing subject | E0 complete |
| D-11 | One runtime can enumerate models across multiple Revit processes | UNKNOWN | No solid Revit evidence yet | E3 |
| D-12 | Exact strong RVT model authority key | UNKNOWN | Must be measured | E3 |
| D-13 | Exact observable GPT/plugin runtime-end signal | UNKNOWN | Chat UI open/closed is not an observable contract | E2 |
| D-14 | Full Revit MCP state is independent from model authority and temporary bridge connectivity | HUMAN | Product lifecycle decision | E2 |
| D-15 | CAD-Agent Revit MCP is migration baseline | REF/HUMAN-EVIDENCE | Previously used for real read/write/delete | E1 regression |
| D-16 | Dynamo `.dyn` is user-owned, not bundled toolkit | HUMAN | Product decision | P3B |
| D-17 | Revit OFF lifecycle authority is Windows process absence, not bridge health | HUMAN + EVIDENCE_REQUIRED | P1 uses Revit.exe process absence as current candidate | E2 confirms PID/session behavior |
| D-18 | Full Revit MCP activation requires Revit ON + explicit `@rg` admission | HUMAN | Product lifecycle decision | P1/E2 |
| D-19 | A WebView conversation successfully paired to the Revit add-in becomes `ADDIN_MANAGED` | HUMAN | Product decision + CadGPT host-neutral reference | P2A/E4A |
| D-20 | `ADDIN_MANAGED` has no RevitGPT idle timeout while the pair remains valid | HUMAN + REF/EVIDENCE | Human decision; CadGPT proved paired add-in work survives long idle/sleep while browser work expires | E4A/E4 |
| D-21 | `ADDIN_MANAGED` must not use synthetic heartbeat activity to stay alive | HUMAN | Lifecycle-driven design decision | P2A/E4A |
| D-22 | Sleep, MCP transport replacement, WebView recreation and panel hide/show do not release `ADDIN_MANAGED` by themselves | HUMAN + REF/EVIDENCE | CadGPT lifecycle hardening + Human decision | E4A/E4 |
| D-23 | Bound-model close releases model authority but does not automatically destroy a valid add-in pair/logical managed chat | HUMAN | Product lifecycle decision | E4 |
| D-24 | Persistent WebView profile/pair-id storage is recovery convenience only and never grants model authority | HUMAN | Security/authority boundary | P2A/E4A |
| D-25 | Successful Lease + Bind Current is atomic; failure preserves previous valid binding | HUMAN | RevitGPT UX/authority decision | P2B/E4 |
| D-26 | Canonical lifecycle/release semantics live in `docs/architecture/AUTHORITY_LIFECYCLE.md`; other docs must reference it rather than diverge | HUMAN/GOVERNANCE | J-8A2C P0 convergence | Reviewer + E4 |
| D-27 | Revit add-in startup uses a blocking Bridge Gate: user must press Start Bridge; WebView/chat stays covered until bridge READY, then @rg may run; pyRevit remains an implementation detail | HUMAN | Product UX decision | A1/A2 + E4A |
