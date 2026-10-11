# RevitGPT roadmap

## Direction reset — HUMAN 2026-10-11 (CadGPT-aligned)

The previous P1B implementation sequence and E-PY-as-a-global-development-blocker are **superseded as execution plans**. Preserve their evidence, open issues and safety constraints as historical input; do not treat old milestone order as authority for new work. GSA job/cursor records require separate reconciliation before their state is changed. This decision does not certify any Revit host capability.

**Architecture ownership:** RevitGPT Brain owns reasoning, admission, session/model authority, registry and Job orchestration. Revit MCP is a separate Revit API tool subsystem with native Revit UI-thread execution. Knowledge is curated source documentation (Revit / Dynamo / HVAC), not MCP code. Direct Jobs are fixed workflows; Reasoning Jobs own explicit ordered steps, tool borrowing and resumable state. Custom Jobs and Dynamo drafts live in managed AppData, with explicit read/write ownership. Dynamo Writer authors/validates dynamic graphs; the .dyn loader and execution authority are separate capabilities. The panel is a chat surface, not Revit authority.

**Offline work now:** audit existing code against CadGPT's control-plane, registry, Job Steps, workspace ownership, diagnostics and add-in patterns; implement only bounded host-independent gaps with regression/negative-control tests, diff review and real GitHub CI evidence. Prefer adapting existing RevitGPT modules over cloning CadGPT wholesale. No artificial E1/E-PY gate on purely offline implementation.

**Deferred to one human host-test round:** real RVT read/write/delete, ExternalEvent behavior, model identity under tab/view churn, multi-process binding, Dynamo execution, panel recovery and installer/host acceptance. Offline PASS is never host PASS. No real model mutations, installer, deployment, main merge or production changes without separate authorization.

**Next execution order:** (1) inventory and gap matrix CadGPT ↔ RevitGPT with code references; (2) one small offline Brain/Job/Registry/Knowledge integration slice at a time; (3) offline CI and review; (4) consolidated host acceptance when Human is available. Do not add commits solely to advance milestone counters.

## Delivery split — HUMAN 2026-10-11

Revit MCP is a **continuous capability-development stream**, not a one-time all-tools-complete milestone: implement tools, validate offline, test against a real Revit host when Human is available, fix defects and expand coverage over time. Do not block independent product framework work on MCP host acceptance. Per-tool readiness must distinguish static/offline checks from real Revit evidence.

Other subsystems must reach explicit bounded deliverables rather than remaining perpetually in planning:

- **FULL product runtime:** Brain/admission, session and primary-model authority, tool leasing, lifecycle and diagnostics.
- **FULL Job Runtime:** Direct/Reasoning Jobs, ordered steps, interruption/resume, borrowed capabilities and result/data ownership.
- **FULL Registry and Workspace:** internal/user capability registration, discovery, path and mutation guards, drafts, promotion and readback.
- **Knowledge split:** **Dynamo coder knowledge must be FULL before Dynamo Writer is accepted as FULL**: versioned Dynamo graph JSON/schema, nodes/ports/connectors, lacing/levels, Code Block/DesignScript, Revit integration/API, packages/dependencies, compatibility for supported Revit/Dynamo versions, examples and negative controls, with explicit provenance and coverage tests. Unknown/unsupported nodes or package versions must be flagged, not guessed. **Working/domain knowledge** (Revit practices, HVAC, model/project-specific lessons) uses a complete reader/writer, provenance, conflict and one-turn update framework but its content evolves continuously through real work. Keep coder knowledge separate from evolving working knowledge.
- **FULL Dynamo Writer coder skill (not a framework-only deliverable):** end-to-end authoring and editing of complete `.dyn` graphs from natural-language requirements; inspect and safely modify existing graphs; create parameterized/dynamic variants for reusable Jobs; select and wire nodes, inputs/outputs and dependencies using version-aware Dynamo/Revit knowledge; static graph/schema/connector/dependency validation with negative controls; draft -> review -> validate -> host test when available -> promote/reuse with rollback. Provide a working core node/package knowledge set sufficient for real authoring rather than postponing essential coding to a future catalog. The skill authors code; Job Runtime orchestrates it, while `.dyn` loading and execution are separate controlled capabilities. Real host execution evidence remains separately gated.
- **FULL native panel framework:** pairing, model-binding UX, state indicators, recovery and lifecycle behavior, subject to later real-host acceptance.
- **CONTINUOUS Revit MCP:** native bridge and Revit API tools remain independently test/fix/extend; no artificial completion gate for the entire tool catalog.

Delivery terminology: FULL means implementation and applicable offline tests are complete, **not** a claim of real-host PASS. Real Revit acceptance is recorded separately, by subsystem/tool, in a consolidated Human test round. Avoid empty commits and avoid modifying main, deploying or mutating real RVT models without explicit authorization.

## Dynamo knowledge sourcing — HUMAN 2026-10-11 (revised)

**Do not crawl, bulk-download, mirror or build a local Dynamo documentation corpus.** Dynamo Writer is a FULL coder skill whose technical lookups use **on-demand web search restricted to an allowlist of trustworthy domains**: `primer.dynamobim.org`, `developer.dynamobim.org`, `dynamobim.org`, and relevant official Autodesk documentation under `autodesk.com` / `help.autodesk.com`. Do not treat community sites as official evidence. Keep local coder knowledge minimal: allowed sources, search/verification procedure, supported host-version context, and internal tested examples/contracts.

For each unfamiliar node, port, graph serialization detail, DesignScript/API behavior or package dependency, search the allowlisted documentation as needed, check compatibility with the actual Revit/Dynamo version and cite the source in development evidence. If authoritative evidence is unavailable, explicitly mark it UNKNOWN, request a tested sample or a host check, and **never fabricate** a node, package, port, signature or API contract. Static/fixture validation and negative controls are still required; web evidence is not proof of live Revit execution. FULL means the authoring/editing/validation workflow works end to end, not that every page has been indexed offline.

Working/domain knowledge remains an independently evolving long-term capability.

**Two-layer Dynamo Writer knowledge contract:**
- **Core Coding Knowledge (local, mandatory):** concise, version-aware invariants the coder must load before writing/editing any graph: a `.dyn` is a Dynamo graph (not arbitrary JSON or a Python script); preserve valid graph/node/port/connector identities and existing graph structure; DesignScript, Python nodes and Revit API run in different contexts and must not be mixed; distinguish built-in nodes from external packages; never invent nodes, ports, packages or API signatures; offline-valid graph does not imply successful Revit execution. Add further invariants only when verified by official documentation or tested fixtures, with source/version evidence and regression tests. This is analogous to CadGPT's AutoLISP/Visual LISP dialect rules, not a Dynamo-specific ban on Common Lisp.
- **Reference Knowledge (web on demand):** search only the approved domains for detailed node/API/package/version specifics; cite evidence and mark unsupported or unknown behavior explicitly.



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


## R4.3 — Audit-first implementation plan (PROPOSED, 2026-10-11)

**Authority and precedence.** This section is the latest proposed implementation sequence and supersedes the historical "Current immediate action", P1B milestone ordering, E1/E-PY global gate, and any earlier R3/R4 execution ordering in this document. It does **not** supersede the canonical `docs/architecture/AUTHORITY_LIFECYCLE.md`, explicit Human architecture decisions, safety restrictions, or existing evidence. This is a source roadmap proposal, **not** a durable GSA Job planning revision, Reviewer PASS, or permission to execute real-host tests. Project GSA handle: `P-7B89`. Working repository: `thebimhouseinfo-sudo/RevitGPT`; working branch: `work/J-AFC4-p1-revit-mcp-bootstrap`. Do not change main, merge, deploy, install, run destructive tests, or mutate real RVT models without separate authorization.

### Goal and acceptance terminology

Build bounded, complete offline-verifiable RevitGPT Brain, Job Runtime, Registry/Workspace, Knowledge Manager, Dynamo Writer and native Panel foundations; keep Revit MCP a separate continuous tool-development stream. For every bounded deliverable track `IMPLEMENTED`, `OFFLINE_VERIFIED`, `HOST_VERIFIED` and `RELEASE_READY` separately, with exact source revision and evidence. No offline check implies Revit host acceptance. No status can be inferred from a prior commit's CI.

### Phase 0 — mandatory evidence and GSA reconciliation (read-only)

**R4-A0: reconcile P1B and authority.** Resolve the *current* work-branch HEAD SHA, relevant GitHub Actions run/job/step conclusions and tests actually executed. Read the GSA Project manifest, repository registry, every affected P1B/R4 Job's exact record, planning revision, Run, Verification and pending execution cursor. Build a row per Job: current state, source SHA, retained evidence, `KEEP / REVALIDATE / REPLACE / HUMAN_DECISION`, rationale, dependent Jobs and cursor disposition. A superseded roadmap sequence does not automatically transition any durable Job. Unknown or unavailable records stay UNKNOWN. No Job transitions, cursor settlement or replacement creation until GSA's reviewed plan-change protocol authorizes it.

**R4-A1: L0/L1 brownfield gap matrix.** Inventory the actual work-branch tree, CI workflow(s), build/test commands, docs, source and test entry points; then inspect the relevant callers/consumers for Brain, Registry, Jobs, Knowledge, Dynamo, Panel and Revit MCP. Compare the canonical RevitGPT contracts with CadGPT *patterns* (read-only reference, not wholesale cloning). For each candidate capability record `CANONICAL / LEGACY / ACCIDENTAL / INCORRECT / UNKNOWN`, `KEEP / ADAPT / REPLACE / MISSING`, exact file/function/test references, ownership, dependency, negative control, host requirement and evidence gap. Inspect Project repository registry and cross-repo impact; require Human confirmation if a missing dependent repo materially changes scope. Do not invent file paths or assume `npm test` exists: derive commands from checked-in workflows/config.

**Phase 0 completion gate:** a revision-bound A0 disposition matrix and A1 gap matrix with current source evidence, bounded Job packs, declared working repo, explicit non-goals, dependency graph, test checkpoints, rollback and Human gates. Planner revises the proposed topology; independent Reviewer examines the exact durable GSA planning revision. Only a recorded, read-back `PASS` permits READY/dispatch, following GSA governance. If records cannot be accessed, report the specific evidence blocker; never fabricate PASS or commit a meaningless milestone.

### Phase 1 — finite implementation Job packs (created only for confirmed gaps)

Each Job is a separate finite change set; split further if its source/test ownership is too broad. **Shared template:** one named owner and one working repository, bounded source paths discovered in A1, objective and non-goals, source revision, prerequisites, acceptance checklist, regression and negative-control fixtures, diff review, exact GitHub CI evidence, rollback plan, and `OFFLINE_VERIFIED` vs `HOST_VERIFIED` status. Do not pre-mark an unimplemented capability as missing.

| Pack | Bounded outcome | Offline acceptance / negative control | Dependencies |
| --- | --- | --- | --- |
| A2 Brain + authority | Admission, logical session, one-primary-model binding, leases and diagnostics across browser/add-in modes | Lifecycle table fixture coverage; expired browser lease, invalid pairing, mismatched active model, failed atomic rebind must not transfer authority | A0/A1, canonical lifecycle |
| A3 Registry + managed Workspace | Internal/user capability discovery, AppData draft/checkout/promotion, canonical-path mutation guard and hash readback | Invalid paths, symlink/reparse escapes, stale hash and cross-owner writes rejected; existing entries preserved | A0/A1; Brain interface |
| A4 Direct/Reasoning Job Runtime | Ordered steps, interruption/resume, bounded retries, borrowed tools and per-Job raw/result ownership | Restart/checkpoint and stale-cursor fixtures; borrowed tool output remains owned by lending Job; no cross-Job write | A3 and Brain authority interface |
| A5 Knowledge Manager + one-turn Writer | Provenance-aware reader/writer; global vs model/project scope; single-turn interrupt/resume | Conflict remains draft; model observation not silently globalized; interrupted Job resumes unchanged | A4 and A3 |
| B1 Dynamo Core Coding Knowledge | Minimal mandatory version-aware local invariants and tested fixtures; approved-domain on-demand references, no bulk corpus | Unknown node/port/package/version flagged; official-source provenance; no fabricated signature | A0/A1 |
| B2 Dynamo author/edit | Create and minimally edit complete .dyn graphs, preserve IDs/connectors, explicit dependencies and version context | New/edit graph fixtures, malformed JSON, missing port/node, identity regression and dependency negative controls | B1 and A3 draft interface |
| B3 Dynamo dynamic Job reuse | Parameterized graphs, static validators, review/promotion/rollback and Job integration | Dynamic graph fixtures, package-missing and rollback controls; no implicit graph execution | B2 and A4 |
| C1 Panel state/UX contract | Pairing, mismatch indicator, intentional Lease + Bind Current, lifecycle/recovery UI contract | Host-independent state machine and failure/recovery tests; panel never becomes authority | A0/A1, Brain authority interface |
| C2 Native Panel integration | Implement bounded pairing/rebind/recovery gaps in existing add-in without installer or real Revit mutation | Mock bridge/panel regression, transport failure and tab-switch negative controls; host behavior marked UNVERIFIED | C1; bridge interface |
| D1 Internal MCP Coder | Limited coding surface `runtimes/Revit-mcp/**`, controlled registry metadata only after evidence | Canonical-path/reparse escape, out-of-scope write, stale registry hash denied | A3 registry interface |
| D2 Revit MCP tool groups (continuous) | Implement/test bounded read, selection, parameters, draw, views, annotations, tags and .dyn LOAD-only capabilities by group | Per-tool offline fixtures and status; host acceptance tracked individually, no global all-tools gate | Existing native bridge, per-tool contracts |

### Dependencies, topology and Human gates

After Phase 0, B1, C1 and appropriate D2 offline tool slices may run independently; A2/A3 interface contracts should be stable before A4/A5/D1; B2/B3 follow their stated inputs. Never serialize independent work solely to match a milestone order. Brain owns authority, Registry and Job orchestration; native Revit MCP alone never grants model authority; Panel is UI only. Dynamo authoring is separate from LOAD-only and from authorized execution. Borrowing another Job's tool does not transfer ownership of files it produces.

**Host gate:** group Revit UI-thread/ExternalEvent, model identity across tab/view churn, pairing/rebind, live parameters and element mutations, Dynamo execution, add-in recovery and installer acceptance into a later Human-controlled host round. Never label these PASS on mock/static tests. **Release gate:** independent review, regression, rollback, real-host evidence where applicable and explicit Human approval before main/production. No automatic deploy or merge.

### Review-loop policy

Planner → independent Reviewer → Planner fixes actionable findings → Reviewer rechecks the new exact revision, repeating within bounded progress limits. `CHANGES_REQUIRED` is an internal loop outcome, not a request that Human fix the plan. CR is a separate Human-invoked independent review after the planning review has actually PASSed. If the required GSA durable records, authority or source evidence are missing, mark BLOCKED with the exact missing input rather than claiming Reviewer PASS. Do not claim that opening an ephemeral role session constitutes a persisted Verification.
