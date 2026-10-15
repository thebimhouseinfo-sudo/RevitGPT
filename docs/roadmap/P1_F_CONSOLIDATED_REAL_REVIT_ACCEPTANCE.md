# P1-F — Consolidated Real Revit Acceptance (Human Test)

> **SUPERSEDED AS REQUIRED P1 ACCEPTANCE MATRIX — 15/10/2026.** P1 only needs to prove stable connection, binding, multi-chat, panel, idle/sleep-wake and Revit open/close behavior as scoped by [Product Goal & Phase Plan](PRODUCT_GOAL_AND_PHASE_PLAN.md). H03 real-write/tool correctness belongs to P2; H04 rg/stop draining and H06 unresolved crash-journal testing are **no longer P1 gates**. Previously completed human evidence remains valid; historical `NOT RUN` rows are not proof that P1 core is blocked. Refer to [Change Register](PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md).

**Status:** PREPARED / **NOT RUN**. **Goal:** Confirm the P1 Stable Runtime & Connection Phase Goal in one human-host test round, without mistaking CI fixtures for real Revit API execution.

**Branch under test:** `work/p1-stable-runtime-20261013`. Before installing, pin the actual Git SHA, PR #2 CI result, native add-in binary hash and current Revit host identity. The currently installed add-in has already been used; avoid reinstalling or overwriting it until the offline reviewer proves what changed and a reversible installation path is prepared.

**Safety:** Use a disposable RVT **copy**, not a live/production model. Save/close existing unsaved work before any restart, logout or crash injection. Do not perform irreversible model writes, machine-level process termination or Windows reboot without explicit user confirmation. Any destructive-operation test must be scoped to a new temporary element in the test RVT, with direct readback and rollback by closing the test model without saving if needed.

## Prerequisites (machine)

- Revit openable on the Windows workstation; record its version, PID, add-in version, bridge owner, and any other concurrent Revit.exe.
- Local P1 source checkout on the **exact reviewed SHA**. Check native add-in and tray status with the existing doctor/status commands and test scripts; ensure no conflicting prior RevitGPT instance owns HTTP ports 3300/8765.
- Two test RVT copies A and B (same-title versions if safe) and ability to open a second Revit process only when it will not endanger unsaved work.
- A Windows PowerShell terminal for local logs; a browser/ChatGPT connector or installed pane for two chats. Collect only relevant diagnostics, redact tokens and absolute private document paths before sharing.

## One consolidated round — six checkpoint groups

| Group | Human actions (in order, stay within the same round) | PASS evidence / stop-if-fail |
|---|---|---|
| **H01 — Cold, awake, late Revit** | Begin Revit closed. Start local tray/control and read health (must be STANDBY). Explicitly invoke `@rg`: must become WORKSPACE_AWAKE with SYSTEM capabilities even though no Revit.exe exists. Start Revit A and wait for Native listener. Re-read status; close Revit A safely and reopen it within the same Windows logon. | STANDBY → WORKSPACE_AWAKE → FULLY_AWAKE → WORKSPACE_AWAKE → FULLY_AWAKE, without a second `@rg`; record transitions with timestamps, process IDs and binding status. |
| **H02 — Bound model vs UI active tab** | Open A and B. Bind Current A intentionally, read from A. Activate B tab **without rebinding**, perform one document-scoped read targeted at A and one UI-scoped selection/show request. Check any denial, then explicitly Bind Current B. | Document-scoped operation uses A or safely rejects; UI action never mutates/selects B using A authority; explicit rebind shifts target to B only. Log exact IDs, host ID, selected elements and result. |
| **H03 — Real write, Native continuity and fault isolation** | On disposable A, create/tag or adjust a reversible test element through an already implemented MCP write. Verify direct model readback. Exercise one known safe tool-level error (invalid ID) and a different safe read afterward. In separate bounded tests, interrupt *only* listener or Python transport if host team permits; do not kill Revit while an unsaved write is running. | One intended write exactly once, no other-model write; subsequent read works after ordinary error; recovery of actually broken layer without losing global binding/awake. If a write times out after starting, observe Native operation status by ID; **do not retry**. |
| **H04 — Multiple chats, graceful stop and reconnect** | With model A or a deliberately long SYSTEM read/validation running in chat A, issue `rg/stop` from chat B (and same-session case where provider permits). Query status from separate chat and attempt unrelated business work. Let previously accepted work finish normally. After STOPPED, verify no new tool runs before explicit `@rg`. | Prompt BUSY/STOP_PENDING; accepted work completes; unrelated admission blocked; one automatic transition to STANDBY; no false STOPPED after ambiguous write. Capture accepted IDs, counts, stop receipt and terminal status. |
| **H05 — Host ownership, UI, idle and sleep/wake** | If available, open a second isolated Revit.exe safely. Verify fixed-port owner and no silent binding takeover; if owner exits, the surviving process must not inherit an old model binding. Check add-in pane/binding display, connector reconnection and sleep/wake only when safe. Existing 15m/24h TTL is verified by an accelerated offline test plus ordinary user idle observation, not by demanding 24h live waiting. | One authoritative host; clear mismatched/closed status; no UI-tab rebind; no unexpected global awake loss after harmless panel/browser churn or sleep/wake. |
| **H06 — Startup after Windows restart and unresolved journal** | Only after saving/closing RVTs and explicit user go-ahead: safely seed a **synthetic** unresolved SYSTEM journal operation using an approved isolated test fixture, confirm no real pending unsaved Revit mutation, then perform controlled Windows restart/logon. Read status before `@rg`, verify synthetic marker retained, no automatic work replay; use only approved safe recovery/cleanup test path. | Runtime **STANDBY**; operation safety still visible as RECOVERY_UNVERIFIED/STOP_BLOCKED or NEEDS_RECONCILIATION until exact evidence resolves it; no duplicated file write, hidden auto-awake or lost journal. |

## Result record (write only after executing)

| Field | Value |
|---|---|
| Tested Git commit SHA | **NOT RUN** |
| Native add-in version / Revit release | **NOT RUN** |
| CI run URL and exact commit | **NOT YET PINNED** |
| H01 / H02 / H03 / H04 / H05 / H06 | NOT RUN / NOT RUN / NOT RUN / NOT RUN / NOT RUN / NOT RUN |
| Faults and diagnostic references | NONE |
| Remaining safety blockers | HOST UNVERIFIED |
| Human release for merge/deploy | **NOT GIVEN** |

**Exit rule:** P1 cannot be marked host PASS merely because this document exists or offline CI is green. Any host finding is diagnosed against the exact tested SHA; code fixes go through offline CI/review again before retesting the specific affected group. There is no extra standalone human gate for P2/P3.
