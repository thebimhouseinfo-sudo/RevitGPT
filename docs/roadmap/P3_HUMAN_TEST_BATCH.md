# P3 — Capability acceptance batch (Builder / Operator / Dynamo Writer / MCP Dev & Repair)

**Scope correction 2026-10-17:** P3 is NOT a retest of the P1 connection layer or the P2 tool inventory. Previously accepted P1/P2 functions are prerequisites and may be probed **only when needed** to support a P3 workflow or diagnose a failure. Do not run a broad list-level/view/family/sheet read sweep as P3 acceptance. "Lisp Writer" belongs to CadGPT; RevitGPT P3 uses **Dynamo Writer**.

**Setup:** one bound disposable Revit 2024 RVT, source/runtime versions recorded, and a predefined user workflow. Run P3 acceptance end-to-end, not individual commands in isolation. Batch all findings, diagnose shared root causes, then do **one** grouped fix/rebuild/install, followed by regression. PASS is judged against the requested outcome, not a tool's HTTP success.

## P3-01 — Job Builder: author a Saved Job from the user's exact workflow
1. User provides a concrete multi-step task with inputs and a declared expected result. Builder creates `JOB.md` + `JOB_STEPS` in the final owner-local Saved Job folder (no draft/promote gate).
2. Show the complete new contract **before execution**. Compare each step against the original user workflow. Test adversarial input where Builder could plausibly add an "improvement": it may *suggest* an extra step, but may **not insert** it without approval.
3. Execute Job on the bound disposable RVT. Observe per-step declared output, step PASS/NEXT, and ERROR/UNKNOWN → STOP. No skipped, reordered, invented or silently retried steps.
4. On a model-writing Job, verify a single user-authorized system Save immediately after the last RVT mutation. Read-only Jobs do not Save.
5. After actual success, add reusable Saved Job to Registry, then confirm Operator can discover and read exact `JOB.md` + `JOB_STEPS`. Registration is not a test prerequisite.
**PASS:** Builder creates and runs exactly the approved contract, outcomes are observable, Operator can reuse it. A folder existing or a tool being callable is insufficient.

## P3-02 — Temp/Disposal Job: Builder runs without promotion
1. User requests a one-off task. Builder creates a Temp Job directly in its owned bundle, applies the same Job Steps discipline and executes it without registering it.
2. Check that Job execution produces run-scoped results under the **bound model's persistent Project Information ID** (not project name, file name or active-tab ID).
3. After completion, apply explicitly configured retention cleanup. Ensure active Job not deleted, Model Anchor results intact, no phantom Saved Job registry entry.
**PASS:** One-off workflow completes accurately and remains temporary.

## P3-03 — Operator: low-reasoning exact execution
1. Invoke an already registered Saved Job from another chat/session. Operator reads exactly its stored `JOB.md` and `JOB_STEPS`.
2. Inject one deterministic step failure and one unknown-outcome scenario. Verify immediate STOP/REPORT, no autonomous recovery, extra steps, restart or role escalation.
3. Concurrently execute two independent Job runs that borrow one tool ID; borrowing is nonexclusive, while individual Revit commands still respect the shared Native queue.
**PASS:** Exact order and outcomes, no inferred workflow additions, capability reuse safe.

## P3-04 — Dynamo Writer: create/test/save a functional .dyn
1. Supply a real Dynamo task with Revit 2024-compatible node/schema evidence. Builder writes valid owner-local `.dyn`, including actual port GUIDs, connectors and dependencies. Where appropriate test a version-supported Python Node without requiring legacy stage/Registry.
2. Call owner-local load and run on the bound disposable RVT. Inspect **real graph terminal outcome**, Revit element/parameter effect and readback. Dispatch ACK is UNKNOWN, never PASS.
3. Revise a deliberately faulty graph, test corrected result, and preserve original source/results correctly. Do not fabricate a graph-complete event.
4. Only on explicit Save/Register request, copy successfully tested graph and appropriate dependency files into Dynamo library, register Dynamo (not the Temp Job), and confirm Operator can discover it.
**PASS:** Dynamo graph works in the actual Revit model, not merely JSON validation or a successful loader response.

## P3-05 — MCP Dev & Repair capability (M8 must finish in P3)
1. Builder investigates source and actual registered Python/Node/Native tool layers, creates a **new meaningful MCP tool**, reloads/rebuilds only its affected layer, and confirms the tool is callable and performs the intended action on bound Revit.
2. Select an **observed real-use defect** in an existing MCP tool, including a tool previously technically marked PASS. Builder diagnoses source, makes a scoped repair, runs applicable offline regression and then the actual Revit use case. Never manufacture a defect to tick a gate.
3. After each successful new/repaired tool, update Registry discovery metadata, verify tool name, schema and instructions. No Registry preapproval or mandatory snapshot.
4. When another Revit call is active, ensure reload does not interrupt it. When a mutation outcome is unknown, do not blindly replay.
**PASS:** Demonstrable new-tool delivery **and** repaired real-use case with confirmed observable result and discoverable registry entries. This is tooling for ongoing P2 development, but **M8 itself must be DONE within P3**.

## P3-06 — Working Knowledge and Model Anchor integration
1. Give an explicit user Revit/HVAC convention. Builder records it in authoritative `knowledge/`, searches it and uses it in a subsequent Job. No invented standards or stale AppData copy overriding source.
2. Verify the Project Information shared parameter `RevitGPT_Model_ID` initializes once on an intentionally bound disposable RVT, survives Save/reopen and project rename; copied model conflict is diagnosed, never silently rekeyed.
3. Verify separate Job runs isolate results by persisted model UUID and run ID.
**PASS:** Knowledge changes actual workflow behavior and Model Anchor persists across project name/phase changes.

## P3-07 — Integrated scenario / two chats
Use Builder in one chat to create a Saved Job that invokes an actual Dynamo graph and a needed MCP tool. Use Operator in another chat to run it, verify step outcomes, Native FIFO commands, Save, result isolation and Registry discovery. Include one controlled failure and confirm STOP/REPORT. Avoid a generic 70-tool inventory verification.

## Minimal environment probes (NOT P3 acceptance)
`@rg`, Native binding, ready status and one context-relevant read can be used to establish that Revit and the bound disposable model are available. P1/P2 tool regressions discovered during a P3 workflow should be logged as supporting defects and repaired if blocking, **not** turned into standalone P3 test suites.

## Reporting / batch repair
Use one evidence table with columns: P3 scenario, intended behavior, actual behavior, outcome PASS/FAIL/UNKNOWN, affected layer, precise source/root cause, whether blocked by Native build and proposed grouped fix. Run all independent P3 tests that remain safe before fixing failures; only then batch code/rebuild and retest. No hidden model writes or destructive repeat after timeout.

**P3 DONE requires P3 workflow capabilities above, not a count of P1/P2 commands returning data.**
