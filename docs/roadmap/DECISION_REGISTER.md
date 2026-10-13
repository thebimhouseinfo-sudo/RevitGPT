# Decision and evidence register

**CURRENT P1 AUTHORITY:** [`docs/architecture/AUTHORITY_LIFECYCLE.md`](../architecture/AUTHORITY_LIFECYCLE.md) (P1 Rev9, 2026-10-13). Entries D-01–D-26 below are preserved as historical provenance for earlier GSA J-8A2C/E0/E4 decisions; any conflict with current entries D-27–D-38 is **superseded for P1**, not a reason to reinstate chat TTL, pairing gates or immediate `rg/stop` release. No GSA Job lifecycle has been changed.

**Current P1 decisions** are listed after the archival rows. The canonical contract governs behavior; this register records traceability. “Approved P1 target” means reviewed plan, **not current implemented/tested behavior**.

| ID | Statement | Status | Basis | Gate / follow-up |
|---|---|---|---|---|
| D-01 | One logical chat binds one primary RVT model at a time | HISTORICAL / superseded for P1 | Product decision | E4 |
| D-02 | Ordinary browser/plugin authority mode is `BROWSER_TTL` with 15-minute idle timeout | HISTORICAL / superseded for P1 | Product decision | E4 |
| D-03 | A valid same-chat user turn refreshes `BROWSER_TTL` | HISTORICAL / superseded for P1 | E0 proved stable logical conversation identity across transport replacement | E4 |
| D-04 | `BROWSER_TTL` expiry makes the model free for any chat | HISTORICAL / superseded for P1 | Product decision | E4 |
| D-05 | Historical browser owner has no post-expiry priority | HISTORICAL / superseded for P1 | Product decision | E4 |
| D-06 | `rg/stop` releases model authority immediately | HISTORICAL / superseded for P1 | Product decision | E4 |
| D-07 | Control-plane restart drops in-memory authority; add-in recovery uses fresh pair/rebind and never treats prior idle duration as managed-session expiry | HISTORICAL / superseded for P1 | Simplicity + managed add-in recovery decision | E4 |
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
| D-18 | Full Revit MCP activation requires Revit ON + explicit `@rg` admission | HISTORICAL / superseded for P1 | Product lifecycle decision | P1/E2 |
| D-19 | A WebView conversation successfully paired to the Revit add-in becomes `ADDIN_MANAGED` | HISTORICAL / superseded for P1 | Product decision + CadGPT host-neutral reference | P2A/E4A |
| D-20 | `ADDIN_MANAGED` has no RevitGPT idle timeout while the pair remains valid | HISTORICAL / superseded for P1 | Human decision; CadGPT proved paired add-in work survives long idle/sleep while browser work expires | E4A/E4 |
| D-21 | `ADDIN_MANAGED` must not use synthetic heartbeat activity to stay alive | HISTORICAL / superseded for P1 | Lifecycle-driven design decision | P2A/E4A |
| D-22 | Sleep, MCP transport replacement, WebView recreation and panel hide/show do not release `ADDIN_MANAGED` by themselves | HISTORICAL / superseded for P1 | CadGPT lifecycle hardening + Human decision | E4A/E4 |
| D-23 | Bound-model close releases model authority but does not automatically destroy a valid add-in pair/logical managed chat | HISTORICAL / superseded for P1 | Product lifecycle decision | E4 |
| D-24 | Persistent WebView profile/pair-id storage is recovery convenience only and never grants model authority | HISTORICAL / superseded for P1 | Security/authority boundary | P2A/E4A |
| D-25 | Successful Lease + Bind Current is atomic; failure preserves previous valid binding | HISTORICAL / superseded for P1 | RevitGPT UX/authority decision | P2B/E4 |
| D-26 | Canonical lifecycle/release semantics live in `docs/architecture/AUTHORITY_LIFECYCLE.md`; other docs must reference it rather than diverge | HUMAN/GOVERNANCE | J-8A2C P0 convergence | Reviewer + E4 |

## Current P1 override decisions (2026-10-13)

| ID | Statement | Status | Basis | Gate / follow-up |
|---|---|---|---|---|
| D-27 | Global `@rg` awake intent, not a chat lease; STANDBY → WORKSPACE_AWAKE → FULLY_AWAKE | APPROVED P1 TARGET | P1 Rev9 Phase Goal; new authority §1–2 | P1-A/B; T01–T03 |
| D-28 | Idle, chat close, WebView/reconnection and tool error must not globally deactivate an otherwise healthy FULLY_AWAKE runtime | APPROVED P1 TARGET | P1 Rev9 Phase Goal; authority §2/4 | P1-B/C/F; T03–T07/T13 |
| D-29 | `rg/stop` is GLOBAL and graceful: BUSY on active work; stop after all accepted SYSTEM/Native tasks and validated continuations complete | APPROVED HUMAN OVERRIDE | CR-05 user resolution; authority §3 | P1-D; T08–T10/T21/T29/T31/T41 |
| D-30 | A write/UI/SYSTEM side effect with unknown outcome is not safe to replay or count as finished | APPROVED P1 TARGET | CR-01/09/12/14; authority §3–4 | P1-C/D; T06/T30/T35–T41 |
| D-31 | MCP transport resources may be reclaimed when truly dead; healthy idle workspace and model binding never expire from TTL | APPROVED P1 TARGET | CR-06/11; authority §4–5 | P1-B; T03/T33/T34 |
| D-32 | Windows new boot/logon starts STANDBY but retains independent unresolved-operation recovery marker and journal; no implicit restart of work | APPROVED P1 TARGET | CR Rev8 follow-up; authority §2/3 | P1-B/C/F; T01/T27/T41 |
| D-33 | One shared intentional primary bound RVT, no automatic tab rebinding; document-scoped access targets bound doc when API allows | APPROVED P1 TARGET | CR-02 and user UX decision; authority §1 | P1-E; T15/T16/T28 |
| D-34 | One authoritative Native host/process on fixed port; no binding takeover or stale bridge owner reuse | APPROVED P1 TARGET | CR-03; authority §1 | P1-E; T14/T28 |
| D-35 | `run.bat stop/restart` are administrative operations, distinct from graceful `rg/stop`; explicit stop can interrupt work | APPROVED P1 TARGET | CR-04/05; authority §2 | P1-B/D; T17 |
| D-36 | P1 reuses current Revit/Node/Python code, verifies before modifying; no P2/P3 Job Runtime, full MCP catalog or Dynamo Writer | APPROVED P1 SCOPE | Rev9 Phase Goal & scope fence | P1-A/F |
| D-37 | GSA J-8A2C/J-A38C/J-8F46 and relevant READY/DRAFT artifacts require SHA-bound, read-only mapping before conflicting code edits | APPROVED P1 TARGET | CR-13; authority §5 | P1-A; T37 |
| D-38 | User approval required for merge/deployment after offline regression and one real Revit human acceptance round | APPROVED P1 RELEASE | Rev9 release gate; authority §6 | P1-F |
