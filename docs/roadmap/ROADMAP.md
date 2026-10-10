# RevitGPT roadmap

## Direction reset — HUMAN 2026-10-11 (CadGPT-aligned)

The previous P1B implementation sequence and E-PY-as-a-global-development-blocker are **superseded as execution plans**. Preserve their evidence, open issues and safety constraints as historical input; do not treat old milestone order as authority for new work. GSA job/cursor records require separate reconciliation before their state is changed. This decision does not certify any Revit host capability.

**Architecture ownership:** RevitGPT Brain owns reasoning, admission, session/model authority, registry and Job orchestration. Revit MCP is a separate Revit API tool subsystem with native Revit UI-thread execution. Knowledge is curated source documentation (Revit / Dynamo / HVAC), not MCP code. Direct Jobs are fixed workflows; Reasoning Jobs own explicit ordered steps, tool borrowing and resumable state. Custom Jobs and Dynamo drafts live in managed AppData, with explicit read/write ownership. Dynamo Writer authors/validates dynamic graphs; the .dyn loader and execution authority are separate capabilities. The panel is a chat surface, not Revit authority.

**Offline work now:** audit existing code against CadGPT's control-plane, registry, Job Steps, workspace ownership, diagnostics and add-in patterns; implement only bounded host-independent gaps with regression/negative-control tests, diff review and real GitHub CI evidence. Prefer adapting existing RevitGPT modules over cloning CadGPT wholesale. No artificial E1/E-PY gate on purely offline implementation.

**Deferred to one human host-test round:** real RVT read/write/delete, ExternalEvent behavior, model identity under tab/view churn, multi-process binding, Dynamo execution, panel recovery and installer/host acceptance. Offline PASS is never host PASS. No real model mutations, installer, deployment, main merge or production changes without separate authorization.

**Next execution order:** (1) inventory and gap matrix CadGPT ↔ RevitGPT with code references; (2) one small offline Brain/Job/Registry/Knowledge integration slice at a time; (3) offline CI and review; (4) consolidated host acceptance when Human is available. Do not add commits solely to advance milestone counters.

## Planning rule

Every architectural claim must be tagged by provenance:

- **REF** — supported by existing source/reference implementation.
- **EVIDENCE** — observed in a real runtime test.
- **HUMAN** — explicit product decision from Human.
- **UNKNOWN** — not yet known. It must remain an evidence need.
- **TEMP-HYPOTHESIS** — allowed only after explicit Human approval and must name the test that will confirm/reject it.

No UNKNOWN may be silently promoted to implementation contract.

## Approved post-MCP-V1 priorities — HUMAN 2026-10-10

Revit MCP V1 implementation checkpoint is accepted as **PASS_RETEST_REQUIRED**. Host verification and per-tool status remain distinct. RevitGPT Brain owns orchestration; Revit MCP remains a separate Revit API subsystem.

### 1. Internal MCP coder — narrow scope, not a general dev agent
- One small source-coding capability, using predefined syntax/static test scripts.
- Write/edit permission is **strictly limited to the Revit MCP subsystem directory** (`runtimes/Revit-mcp/**`), with canonical-path and symlink/reparse defenses. Other source modules, Knowledge, Jobs and unrelated files are read-only or inaccessible for mutation.
- The sole exception is a **controlled Registry metadata updater**: change the existing registry entry only after the tool change and required tests succeed, with implementation evidence, exact identity and hash-based concurrency control. Do not set READY without applicable real-host verification.
- No unrestricted repository editing, generic shell access, production Revit mutation, or independent Job ownership.

### 2. Knowledge Writer — one-turn interruption
- Expose an explicit user-invoked `update knowledge` skill/tool. It temporarily suspends (never terminates) the current Direct or Reasoning Job, preserves its exact Job Steps/checkpoint/context/lease and resumes it after the single Knowledge turn.
- On that **one turn only**, collect the user-provided insight and context, check existing knowledge and conflicts, classify global vs project/model scope, format an evidence-grounded entry, and save it under the correct canonical `knowledge/revit/**`, `knowledge/dynamo/**`, `knowledge/hvac/**` or newly approved subject folder. SOURCE `knowledge/**` is authoritative; managed AppData can hold staging/observations only.
- For an unresolved conflict or unsafe promotion, report the conflict and retain a draft; **do not auto-reason a conflicting decision or silently overwrite**. After success, report path/hash/summary and release the interruption immediately. No multi-turn takeover of the current Job.
- Do not infer that knowledge from one RVT applies globally; do not convert an unverified model observation into a general engineering rule.

### 3. Job Runtime — borrow proven CadGPT patterns
- Reuse the conceptual patterns in CadGPT `knowledge/jobs/JOB_RULES.md`, `src/cadgpt/runtime/job-runtime.ts` and Job Steps tests: Direct versus Reasoning Jobs; simple `JOB.md` plus `JOB_STEPS`, ordered checkmarks and bounded postconditions, reset on completion/failure/new Job, resumable interruption, tool scopes and logs.
- Keep user custom jobs and their steps in managed `%LOCALAPPDATA%\\RevitGPT\\libraries\\jobs/**` (drafts under workspace); no deep coupling of each custom Job into global runtime logic. A one-turn Knowledge Writer uses a bounded interruption frame, not a new Job or a rewritten plan.
- Port behavior, not AutoCAD/DWG/LISP/TBH-specific implementation.

### 4. Dynamo Writer — specialized small coder, distinct from .dyn loader
- Add `skills/write-dynamo/` patterned on CadGPT `skills/write-lisp/`: registry-first discovery, AppData checkout/draft/promotion, minimal edits, structured authoring templates, bounded API/host-version knowledge and dependency manifests.
- Ship local reference material for Dynamo graph JSON format, Dynamo Core/Revit integration/API contracts, relevant Revit 2024 constraints, nodes/packages and compatibility matrix. Validate references against the installed Dynamo version; never guess unsupported nodes or package availability.
- Provide existing-script and generated-script **static JSON/schema/graph/node/dependency validators and negative controls** before promotion. Passing static validation is not a live execution PASS.
- Separate the authoring skill from `revit_load_dyn_file` (LOAD-only/MANUAL/no-run) and from the separately authorized Dynamo runner. The authoring skill cannot silently execute graphs or perform unrestricted filesystem writes.
- Keep Dynamo drafts and libraries in managed AppData. User external files are imported as copies, never edited in place.

### 5. Integration and release
- Preserve one-primary-model binding and native Revit UI-thread authority, recoverability, instrumentation and latency work.
- Integrate Knowledge Writer, internal MCP coder, Job Steps and Dynamo Writer through RevitGPT Brain and existing Capability Registry without a competing registry.
- Deliver host/integration acceptance, regression, independent review, rollback and explicit user release approval before promotion to main.

Status: **OWNER DECISION / ROADMAP**, not a claim that these runtime capabilities are already implemented.

## Current approved facts and decisions

### Chat/session ownership

Canonical lifecycle contract: [`docs/architecture/AUTHORITY_LIFECYCLE.md`](../architecture/AUTHORITY_LIFECYCLE.md).

- **HUMAN:** one logical ChatGPT conversation binds one primary RVT model at a time.
- **HUMAN:** ordinary browser/plugin sessions use **BROWSER_TTL** with a 15-minute model-authority idle timeout.
- **HUMAN:** a WebView conversation successfully paired to the Revit add-in uses **ADDIN_MANAGED** with **no RevitGPT idle timeout while the pair remains valid**.
- **HUMAN:** `ADDIN_MANAGED` is lifecycle-driven, not kept alive by a synthetic heartbeat.
- **EVIDENCE:** CadGPT proved the host-neutral pattern: a paired add-in logical session survives wall-clock idle/sleep while an ordinary browser session still expires.
- **EVIDENCE:** `x-openai-session` remained stable for ~14h14m across replacement MCP transports in E0 and distinguishes conversations under the tested conditions.
- **HUMAN:** valid same-chat turns refresh only `BROWSER_TTL`; `ADDIN_MANAGED` does not need activity refresh.
- **HUMAN:** after `BROWSER_TTL` expiry the model is free for any chat; historical owner has no priority.
- **HUMAN:** `rg/stop` releases model authority immediately. For `ADDIN_MANAGED`, the add-in pair may remain managed for a later bind as defined by the canonical lifecycle contract.
- **HUMAN:** control-plane restart drops in-memory authority. An add-in may fresh-pair/rebind after restart, but prior idle duration is never interpreted as managed-session expiry.

### Fast connect

- **HUMAN:** 0 candidate models -> Welcome/idle.
- **HUMAN:** exactly 1 candidate model -> fast bind with no Welcome.
- **HUMAN:** more than 1 candidate model -> Welcome/model selection.
- **HUMAN + observed workflow:** view/tab/window churn must not itself change model authority.
- **UNKNOWN:** exact model identity/candidate enumeration contract in Revit, especially across multiple Revit processes.

### Revit MCP lifecycle

- **HUMAN:** GPT live + Revit OFF + plugin called -> full Revit MCP OFF.
- **HUMAN:** GPT live + Revit live + plugin not called -> full Revit MCP OFF.
- **HUMAN:** GPT live + Revit live + plugin called -> full Revit MCP ON until GPT/plugin runtime ends or Revit turns OFF.
- **HUMAN:** full MCP remains ON even when no model lease exists.
- **UNKNOWN:** exact observable implementation signal for GPT/plugin runtime end. Do not infer ChatGPT UI open/closed state.

### Revit capability baseline

- **REF/HUMAN evidence:** CAD-Agent's Revit MCP previously performed real read/write/delete on RVT models.
- **HUMAN:** make GPT actually work with Revit before hardening connection/binding.
- **REF:** CadGPT provides reusable host-neutral control-plane/session/path/tooling patterns.
- **HUMAN:** RevitGPT has no LISP/TBH; Dynamo `.dyn` is user-owned script capability.

## Evidence gates and implementation phases

### E0 — x-openai-session duration gate (COMPLETE)

Independent of Revit.

Use CadGPT continuity diagnostics and the RevitGPT analyzer:

```text
t0 -> 1h -> 4h -> 8h
+ different-chat control
```

Result: Chat A retained one `x-openai-session` fingerprint for ~14h14m across five MCP transport identities; Chat B had a distinct `x-openai-session` while sharing the same `x-openai-subject`. This is sufficient for logical-conversation identity in the current two-mode contract. Browser sessions use the 15-minute TTL; add-in pairing supplies the separate managed-session lifetime.

### P0 — Authority/add-in policy convergence

Create and maintain the canonical contract in `docs/architecture/AUTHORITY_LIFECYCLE.md`.

Deliver:
- one explicit `BROWSER_TTL` vs `ADDIN_MANAGED` contract;
- lifecycle/release state table for idle, sleep, transport replacement, WebView recovery, stop, rebind, model close, host close, restart and stale conversation recovery;
- add-in architecture migrated into the active implementation line;
- ROADMAP and DECISION_REGISTER references to the canonical contract instead of duplicated timeout semantics.

P0 must complete before the rest of the migrated J-8A2C execution chain proceeds.

### P1 — Bootstrap proven Revit MCP

Migrate the working CAD-Agent Revit MCP baseline first.

Deliver:
- proven Revit MCP read/write/delete baseline;
- pyRevit bridge with extension startup;
- slim control plane + Secure Tunnel + Windows tray;
- managed AppData skeleton for Python, Dynamo, Jobs, registry, workspace, knowledge, logs and run evidence;
- internal `write-python`, `dynamo`, `jobcreate` skills;
- development-only `revit-mcp-dev` snapshot/edit/validate/rollback lifecycle;
- structured control-plane, tool-call, bridge, MCP and error logs;
- runtime instrumentation for Revit process/model enumeration and MCP state.

Do not implement final lease/model binding here.

### E1 — Real Revit capability checkpoint

On a real project:
- ChatGPT invokes real Revit tools;
- read succeeds;
- controlled write succeeds;
- controlled delete succeeds;
- transaction/thread/context limitations are recorded.

This gate exists so later topology tests use working tools rather than assumptions.

### E2 — MCP lifecycle evidence

Measure the Human-approved truth table:
- Revit OFF / plugin invoked;
- Revit ON / plugin not invoked;
- Revit ON / plugin invoked;
- MCP ON + no lease;
- Revit closes while MCP ON;
- actual observable GPT/plugin runtime termination behavior.

Output: concrete liveness signals available to implementation.

### E3 — RVT topology and model identity evidence

Real Revit tests:
- one model with aggressive view churn;
- multiple models in one Revit process;
- multiple Revit processes/sessions;
- close/reopen;
- Save As;
- same filename where possible;
- workshared/local/central/cloud when available.

Output:
- candidate model enumeration contract;
- stable identity fields;
- process/session relationship;
- explicit unresolved cases if any.

### P2A — Revit add-in managed-session shell

Only after E1 + E2 + E3 evidence.

Implement:
- Revit DockablePane + WPF + persistent WebView2 profile;
- local pair-window handshake completed by normal `@rg` admission;
- `ADDIN_MANAGED` logical-session/work pinning outside ordinary idle cleanup;
- sleep, panel hide/show, MCP transport replacement and WebView recreation recovery;
- one primary bound model with active-vs-bound mismatch observation only;
- explicit **Lease + Bind Current** with rollback;
- no authority from WebView cookies/DOM/login state or active Revit tab/view.

### E4A — Add-in managed-session recovery acceptance

Differentially prove:
- `ADDIN_MANAGED` idle >15m remains managed;
- ordinary `BROWSER_TTL` idle >15m still expires;
- sleep/resume, MCP transport replacement and WebView recreation do not expire managed state;
- stale/deleted/logged-out WebView conversation establishes a fresh pair and does not inherit authority implicitly.

### P2B — Shared model authority

Implement one authority service with:
- `BROWSER_TTL`: 15-minute idle lease + same-chat user-turn refresh;
- `ADDIN_MANAGED`: no idle expiry while pair is valid;
- 0/1/many model admission using E3 strong identity;
- atomic Lease + Bind Current;
- model close releasing model authority without automatically destroying an add-in pair;
- explicit pair/host lifecycle release rules from the canonical contract.

### E4 — Authority lifecycle acceptance

Execute `AUTHORITY_LIFECYCLE.md` row-by-row, including:
- browser TTL refresh/expiry/takeover;
- managed idle >15m;
- sleep/resume;
- transport replacement;
- WebView recreation;
- `rg/stop`;
- successful/failed rebind;
- bound-model close;
- pair release;
- Revit/add-in shutdown;
- control-plane restart/fresh-pair recovery.

### P3 — Bound-model execution integration

The user registry/AppData/authoring skeleton is established in P1. After binding exists, complete:
- Dynamo execution under bound-model authority;
- Python capability execution under bound-model authority;
- Reasoning Jobs and supported Direct Jobs;
- all operations verify current lease + bound model;
- MCP ON alone never grants model authority.

### P4 — Diagnostics, tray, packaging

Expose separate state dimensions:

```text
Revit process state
Full Revit MCP state
Candidate model count
Bound model
Lease state
```

Do not collapse MCP state and lease state into one status.

### E5 — Real-project beta

Replay real read/write/delete/Dynamo/Job workflows while deliberately:
- switching Revit views;
- switching active models;
- expiring/rebinding leases;
- exercising multiple Revit sessions if supported by E3 evidence.

Human acceptance is the final gate.

## Current immediate action

J-8A2C is the active migrated roadmap. The immediate phase is **P0 policy convergence**, then P1/E1.

P0:
- canonicalize `BROWSER_TTL` vs `ADDIN_MANAGED`;
- persist `docs/architecture/AUTHORITY_LIFECYCLE.md`;
- migrate the current add-in architecture into the implementation line;
- remove contradictory global timeout wording.

After P0:
- finish P1 setup/doctor instrumentation;
- run E1 real RVT read -> controlled write/readback -> controlled delete/readback;
- continue only through the reviewed dependency chain.


### Revit MCP activation truth table

```text
Revit OFF
-> full Revit MCP OFF

Revit ON + @rg not invoked
-> full Revit MCP OFF

Revit ON + @rg invoked
-> activate full Revit MCP

Revit turns OFF after activation
-> full Revit MCP OFF
```

Revit process state is lifecycle authority. @rg / admission is the activation trigger.
