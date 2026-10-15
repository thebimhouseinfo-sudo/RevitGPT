# P1 — Windows Logon Auto-start Recovery (14/10/2026)

> **SCOPE OVERRIDE — 15/10/2026:** Keep Windows auto-start, launcher diagnostics, error logging, owned-process isolation and real sign-in verification as useful P1 connectivity work. Historical instructions about unresolved SYSTEM/Native journals, cross-boot reconciliation or Job replay are **not required success conditions** and must not become additional code/CI gates. Current scope: [Product Goal & Phase Plan](PRODUCT_GOAL_AND_PHASE_PLAN.md); [Change Register](PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md). This does not replace the separately reviewed startup diagnostics PR.

## GOAL
Sau khi Windows restart **và người dùng Windows đã đăng nhập tương tác**, RevitGPT tự khởi chạy **một** Tray, Slim MCP và Secure Tunnel của đúng checkout/profile, không cần chạy thủ công `run.bat start`. Control plane ở **STANDBY** trước khi có `@rg`, Native/full Python MCP không tự awake, không tự mở Revit, không tự chạy lại thao tác hay Job còn dang dở. Lỗi khởi động phải có bằng chứng chẩn đoán rõ ràng, không được âm thầm mất kết nối. Giữ nguyên cơ chế một model bind và các journal an toàn.

**Status:** PLANNING REVIEW PASS (R2) — IMPLEMENTATION NOT STARTED; REAL BOOT NOT VERIFIED. **Working repo:** `thebimhouseinfo-sudo/RevitGPT`, base `main@4150466c357826f79a6c86f00ee9c361d0bbddc2`. **Implementation:** NOT STARTED. **Machine registry/log evidence:** NOT AVAILABLE. This document is a plan, not proof the fault is fixed.

### Scope boundary
- P1 only: installed Windows logon startup, launch observability, safe retry via existing tray loop, contract tests and one real Windows login acceptance.
- No changes to Native Read/Write, Revit API, model binding, Job/Dynamo, MCP tool catalog, tunnel service account, or per-chat leasing.
- Existing draft PR #3 (WebView chat continuity and Ribbon Open Panel) remains a separate change; Host Takeover/Bind Current mismatch is a separate finding. Coordinate test/release, do not silently merge scopes.
- Never reset/delete `%LOCALAPPDATA%\RevitGPT\state`, `work-journal.json`, `.env`, tunnel credentials, profile or user RVT; never use destructive `git clean` as recovery.

## 1. Code & contract inventory (source-grounded)

| ID | Evidence on `main` | Verdict |
|---|---|---|
| E01 | `run.bat:29–44` — only `run.bat install` calls `revitgpt-tray.ps1 -InstallStartup`; `run.bat start` launches VBS/runtime but registers nothing. | CONFIRMED code behavior |
| E02 | `revitgpt-tray.ps1:13–16,95–107,333–340` — per-user `HKCU ... Run` value `RevitGPT` invokes `wscript.exe` and launcher VBS; no task scheduler registered. Per Microsoft, this is an **at-logon**, potentially delayed action, and a Run value command line has a 260-character limit. | CONFIRMED implementation + Windows contract |
| E03 | `scripts/manage-native-revitgpt-install.ps1` installs Revit add-in manifest/DLL, does not configure HKCU autorun for Slim MCP/Tray. | CONFIRMED separation/gap in documented installation |
| E04 | `setup.bat:85–117` calls retired `scripts/install-revit-bridge-addin.ps1` before `run.bat install`; retired script throws `LEGACY_UNSAFE_NATIVE_BRIDGE_BLOCKED`. Consequently this legacy setup path cannot reach its promised autorun registration. | CONFIRMED blocked path |
| E05 | `revitgpt-tray.vbs` starts PowerShell hidden with `WshShell.Run(...,0,False)`; `revitgpt-tray.ps1:9–67,364–381` has early startup work and catches component start failures only later. Startup launch failures before tray logging are insufficiently visible. | CONFIRMED diagnostics gap |
| E06 | `revitgpt-tray.ps1:428–474` already has timer/self-heal every 5 seconds **if tray exists**. Do not implement a parallel watchdog without proof this one fails. | REUSE |
| E07 | `run.bat status`, `doctor.bat` and existing CI Windows bootstrap simulate Node/tunnel launch but do not prove HKCU Run registration, interactive logon launch or that Windows actually invokes VBS after login. | CONFIRMED test gap |
| E08 | `docs/architecture/AUTHORITY_LIFECYCLE.md:34–53` specifies startup must be STANDBY, new boot invalidates prior awake intent but preserves unresolved journal. | CANONICAL CONTRACT |
| E09 | Human reports RevitGPT does not auto-start after Windows restart; current HKCU key, Startup Apps enablement, tray log and login PID are not yet supplied. | OBSERVED SYMPTOM; ROOT CAUSE ON HOST UNCONFIRMED |

### Runtime hypotheses to disambiguate (do not guess)
- H-A: `RevitGPT` HKCU Run value is absent because only Native add-in install plus `run.bat start` was run (consistent with known installation path, not yet measured).
- H-B: Registry value exists but launcher path is stale, Windows Startup Apps disables it, WSH/PowerShell policy blocks launch, or launch fails before first log.
- H-C: Launcher starts, but dependencies/path/network are not yet usable at logon and tray/runtime/tunnel never recover correctly.
- H-D: All three components are actually running, but `@rg` or `FULLY_AWAKE` was mistaken for the expected automatic **STANDBY** state; check process/health before categorizing.

## Phase A — Reproduce & classify the boot gap
### GOAL
With no mutation of live configuration, determine which of H-A/B/C/D explains the failed logon, using evidence from the affected Windows user session. Do not call an offline fixture proof of real boot behavior.

1. Record exact checked-out commit, Windows user context, last boot/sign-in time; check HKCU Run `RevitGPT` existence, exact quoted value, target `.vbs`/`.ps1` file existence and enabled/disabled Windows Startup Apps state.
2. Before starting `run.bat` manually, read `run.bat status`, local health/readyz on configured ports, process ownership for Tray/Node/tunnel, and timestamps from `%LOCALAPPDATA%\RevitGPT\logs` (`tray.log`, `revitgpt.err.log`, `tunnel.err.log`). Redact private paths/tokens when sharing.
3. Compare first startup attempts against login timestamp. Missing key => H-A; stale/disabled launcher => H-B; launched-but-failed components => H-C; healthy control plane in STANDBY => H-D (not a defect). If evidence remains unknown, label UNKNOWN rather than inventing the cause.
4. Keep any existing healthy runtime intact; diagnostic commands are read-only. Do not restart Windows, reinstall, rebind models or delete state as part of triage.

**Exit A:** evidence-backed H-A/B/C/D classification or explicit HOST_UNVERIFIED; exact affected layer and no unsafe mutations.

## Phase B — Repair canonical installation / autorun
### GOAL
An explicit official runtime installation registers one valid, durable, per-user **logon** startup entry and confirms its exact executable/path, without silently changing meaning of `run.bat start` or installing obsolete Revit bridge code.

1. Keep `run.bat install` as the explicit runtime-autorun action; make its HKCU registration idempotent and read back value/path immediately after setting it, fail loud on incorrect/missing registration. Do not make `start`, `@rg` or Revit pane-opening implicitly persist autorun.
2. Add a safe read-only startup registration status under existing `run.bat status` and `doctor.bat`: `INSTALLED / MISSING / STALE / CONFLICT / UNVERIFIED`. Detect actual registry value/path versus expected; **a Run value being present is not proof Windows Startup Apps enables or executes it**. Only report `DISABLED` if independently measured using a supported OS mechanism; otherwise say `UNVERIFIED`. Missing autorun should be reported even if Tray/Slim/Tunnel are READY from a manual start. Doctor CI/developer environments must not fail merely because registration is intentionally absent.
3. Align the documented **official Native add-in install + runtime install** sequence: retain their separate explicit approvals. Update `README.md` and installed-host procedure to invoke `run.bat install` for runtime autorun; **do not add implicit registry writes to the add-in-only installer**. In `setup.bat`, replace the misleading deprecated bridge invocation/claim with a clear current native-install handoff or explicit fail-fast instruction. Do not refactor the entire old setup, call its retired installer, or reinstall a working native add-in without approval.
4. Preserve registered startup command on a repeated install if it already points at the correct checkout; distinguish **owned old checkout (needs explicit migration)** from **foreign collision (reject)** and **stale missing target (report; replace only by explicit runtime install)**. Read back and preserve the prior owned value for rollback on partial install; removal must delete only the owned value. Retain the existing single-tray mutex. Validate full HKCU Run command length ≤260 characters, report a bounded failure instead of recording a nonfunctional too-long path.
5. Keep the primary boot mechanism `HKCU Run` unless Phase A proves it unsuitable for this machine. If confirmed OS/enterprise restrictions block this entry after login, review a single user-scoped interactive-logon Scheduled Task replacement separately, not a second simultaneous autorun mechanism.

**Exit B:** explicit installer/register/query/remove contract correct and idempotent, path quoting survives checkout with spaces, no duplicate startup mechanism.

## Phase C — Make boot failure visible & recover only failed layer
### GOAL
A hidden login launch that fails is diagnosable; when the tray process succeeds, existing self-heal brings Slim MCP and Tunnel back once dependencies are available, without restarting healthy parts or old Jobs.

1. Instrument the earliest feasible launcher/Tray startup stage with timestamp, process ID and sanitized phase/error; never log `.env` values, tunnel API key, MCP token or conversation URL. Expose launched/ready/failure separately in status and logs. If Windows prevents WScript from starting at all, **no local script can log that non-invocation**: classify via missing startup event + OS/registry evidence, not a fabricated success/failure message.
2. Confirm WScript/PowerShell invocation, source working directory, Node discovery and tunnel executable/profile are evaluated as explicit preflight inputs. For a missing prerequisite, record deterministic failure; do not hide it behind an unbounded loop or create new secrets.
3. Exercise the existing 5-second self-heal with bounded test stubs for delayed Node/network/tunnel health. Reuse `Start-RevitGptRuntime` and `Start-RevitGptTunnel`; do not add a service, independent daemon, or automatic Python/Revit wake.
4. Ensure retry never kills a process not owned by this repo/profile, never mutates `awake-intent` to awake on boot and never replays unresolved side effects from `work-journal`.

**Exit C:** actionable startup diagnostics, no duplicate tray/runtime/tunnel, safe delayed readiness and preserved STANDBY/journal invariants.

## Phase D — Tests, review and rollout gate
### GOAL
Prove the exact corrected revision via repeatable isolated Windows CI and one genuine user-session reboot/logon test; do not infer host PASS from source assertions.

1. Automated: isolate registry access behind a testable registry path/provider to verify fresh register, exact existing value, stale target, owned migration, foreign collision, owned-only removal, long-command rejection, path with spaces/Unicode and absence of source mutation. Do not write to the CI user’s real `HKCU ... Run\RevitGPT` value. A disabled Startup Apps item is tested only if a reliable detection API is available; otherwise assert `UNVERIFIED` and require host evidence.
2. Automated: simulate WScript/VBS→PowerShell→Tray launch in a disposable directory using isolated stubs, not Revit/tunnel credentials or a real interactive logon; validate early failure log; deliberately remove a required path and assert FAIL; inject one delayed dependency and verify it heals; assert only one process owner. **CI simulation is not evidence Explorer actually launches an HKCU Run item at user login.**
3. Automated: reuse `scripts/test-awake-intent.mjs`, `scripts/test-native-host-identity.mjs`, tray ownership and tunnel tests; assert fresh boot/logon = STANDBY, unresolved journal remains visible, no implicit @rg/Native Write/Python activation.
4. CI: run actual Windows PowerShell 5.1 and PowerShell 7 parsing/execution tests, the focused new tests and existing workflow on exact branch SHA. A source-assertion PASS alone is not a boot or Native host PASS.
5. Human host acceptance after explicit consent: save work, restart Windows and sign in as the same user. Allow a **bounded, recorded logon readiness window** because HKCU Run execution may be delayed by Windows; do not demand instant zero-second startup. **Before any manual `run.bat` or `@rg`**, verify one tray, owned Slim MCP/secure tunnel READY, runtime STANDBY, Full Revit MCP OFF; invoke @rg and verify wake to WORKSPACE_AWAKE; open one test RVT and verify FULLY_AWAKE. Check the persisted journal has not been silently cleared/replayed. If Startup Apps disables registration, log that prerequisite as HOST_BLOCKED rather than quietly toggling OS policy.
6. Regression after the startup check: ensure `run.bat start` is nonpersistent, `run.bat stop` is administrative only, unrelated app/process unaffected; preserve PR #3 and the Host Takeover finding as separate reviews/tests before their release.
7. Only after review, CI and real-host PASS, prepare release candidate with **source-version rollback plus exact previous owned registration restoration/removal**. Roll back the specific changed install state; leave unrelated Windows startup entries, Native host installs, `.env`, profiles and journals untouched. Merge/deploy/native reinstallation requires subsequent explicit Human approval.

**Exit D:** an exact-head PASS report for CI, a real-login PASS with timestamps and process ownership, plus a reversible rollout; otherwise REMAINS OPEN with named failed condition.

## Traceability & acceptance
| User requirement | Owner | Evidence needed |
|---|---|---|
| Autostart after Windows restart/sign-in | Phase B installer/Tray | HKCU value readback + real logon tray, Node and tunnel |
| Remote @rg works after boot | Phase C and D | owned health READY in STANDBY then WORKSPACE_AWAKE via @rg |
| No unsolicited Revit/Python/Job activation | Phase C and D | fresh-boot awake/journal tests plus actual status |
| Diagnostic if startup does not run | Phase A and C | missing/stale/disabled preflight and sanitized launch failure evidence |
| Never launch two runtimes or overwrite foreign startup | Phase B/C | ownership/mutex/registry red controls |

## Planning review log
- R1 (blob `4d5307027e9ff4aa680db1da3af9439622d87846`): **CHANGES_REQUIRED** in source-grounded plan review. Findings: (R1-F1 IMPORTANT) differentiate registry-present from Startup Apps actually running; (R1-F2 IMPORTANT) avoid widening `setup.bat` into a new Native installer/implicit registry install; (R1-F3 IMPORTANT) cap HKCU Run command length, owned-collision rollback and realistic OS delay; (R1-F4 MINOR) CI WScript simulation is not real Explorer logon. R2 addresses all four.
- R2 (reviewed blob `7649782cb6bedc7b71c848f7c5839586bb57771c`): **PLANNING REVIEW PASS** — all four R1 findings resolved, top-level + Phase A–D GOAL anchors present, source/unknown distinctions preserved, no false CI/real-host claims, one bounded startup objective with separate PR #3/Host Takeover backlog. PASS applies only to plan consistency and readiness for explicit implementation approval; not proof of Windows boot behavior.
- Code implementation/merge/deploy: NOT AUTHORIZED by this plan review alone.

## External Windows semantics reference
- Microsoft Learn: https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys — HKCU Run starts **at user logon**, launch order/timing is not guaranteed, 260-character command line limit. No claim of pre-login service availability.
