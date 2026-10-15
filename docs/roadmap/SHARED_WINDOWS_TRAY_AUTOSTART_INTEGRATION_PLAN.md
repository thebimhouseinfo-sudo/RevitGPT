# Shared Windows Tray Auto-start Integration Plan

## GOAL
CadGPT, RevitGPT and GPTWorker must start independently at Windows interactive logon, without visible terminal windows, and without changing the other applications' registrations, processes, ports, or tray state. If a launch fails, a stage-specific log must identify the last completed step.

## Scope and explicit implementation boundary
This document covers **integration expectations for all three applications**. **Only RevitGPT changes are authorized in this implementation.** Do not modify CadGPT, GPTWorker, Windows startup registration, local host state, or user data as part of this PR. Do not merge/deploy before review and host validation.

## Baseline (user evidence, 2026-10-15)
- CadGPT: HKCU Run value `CadGPT` was absent and was restored manually to its own VBS launcher. Registration recovery is confirmed; successful reboot startup remains unverified.
- RevitGPT: HKCU Run value `RevitGPT` points to its own VBS launcher. User reports P1 T06–T09 PASS. Preserve its running startup strategy and Native add-in.
- GPTWorker: the `GPTWorker Startup` Scheduled Task exists, the matching HKCU Run value was absent during investigation, and a nonzero last task result was observed. Do not change its Task Scheduler configuration in this PR.
- All three apps use separate tray mutex names and their own local runtime/tunnel ports. No code-backed evidence of a common registry value being overwritten was found.

## Phase A — Shared diagnosis contract
**Phase GOAL:** Determine whether a failed app launch stopped at registration, Windows dispatch, PowerShell entry, preflight, duplicate tray, runtime, tunnel, UI notification, or event loop, without relying on guesswork.
- Keep one app-owned startup name, launcher, state directory and port set per app.
- Log stages without tokens, API keys, full command lines, or model/file contents.
- Logging must be best-effort; an unwritable diagnostic file must not itself block startup.
- Never stop or alter unrelated app processes.
- RevitGPT uses the existing `%LOCALAPPDATA%\RevitGPT\logs\startup-launch.log` across the VBScript and PowerShell stages, and `tray.log` for detailed (existing) runtime errors.
- The absence of `wscript_invoked` after a real sign-in does **not** by itself prove registration missing; corroborate with current HKCU Run, StartupApproved and Windows sign-in evidence.

## Phase B — RevitGPT implementation (authorized)
**Phase GOAL:** Expose the exact startup boundary crossed by RevitGPT while preserving current functioning behavior.
- Keep `HKCU Run\RevitGPT`, the VBS launcher, per-app mutex, runtime and tunnel logic unchanged.
- Append safe PowerShell stage codes to the existing VBS startup launch log.
- Capture unhandled startup errors by stage, while preserving existing recoverable Slim MCP and tunnel error handling.
- Never include secrets or dynamic values beyond PID and timestamp.
- Cover logs and recoverable failure paths with isolated Windows PowerShell 5.1/7 tests and normal PR CI.

## Phase C — CadGPT / GPTWorker (not authorized)
**Phase GOAL:** Later converge on the same reliability contract without cross-app regressions.
- CadGPT: investigate missing startup registration and missing early launcher trace, then design its own change in its own repo **only when separately authorized**.
- GPTWorker: investigate simultaneous startup registration mechanisms, process-console exit and marker/mutex order **only when separately authorized**.
- Do not infer that one app deleted another app's registry entry without evidence.

## Phase D — Integrated acceptance (human test, no automatic deployment)
**Phase GOAL:** Prove coexistence after the approved changes, using one Windows logon with all three configured.
1. Read all three registration entries and any scheduled startup tasks before reboot.
2. Reboot/sign in once: confirm three trays, no terminal windows, each runtime/tunnel ready.
3. Check each per-app log and verify RevitGPT trace reaches `message_loop_enter`.
4. Exit/restart one app at a time: confirm the other apps remain available.
5. For failures, compare the last recorded startup stage with app-owned runtime logs. Record PASS/FAIL separately for CadGPT, RevitGPT and GPTWorker.

## Status
- Phase A: SOURCE REVIEW DONE, HOST REGISTRATION EVIDENCE PARTIAL.
- Phase B: IMPLEMENTED ON ISOLATED BRANCH; CI/HOST ACCEPTANCE PENDING.
- Phase C: NOT AUTHORIZED / NOT CHANGED.
- Phase D: HUMAN TEST PENDING.
