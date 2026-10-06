# RevitGPT Detailed Execution Plan — J-8A2C rev2

Status: **EXECUTION DETAIL / NO SCOPE CHANGE**  
Durable roadmap: **J-8A2C, planning_revision 2, Reviewer PASS**  
Working repository: `thebimhouseinfo-sudo/RevitGPT`  
Current implementation line: `work/J-AFC4-p1-revit-mcp-bootstrap`  
Final integration target: `main`

This document expands the reviewed J-8A2C roadmap into implementation-ready steps. It does not create a second roadmap and does not change J-8A2C topology, product scope, or gates.

## 0. Execution governance

### 0.1 Source-of-truth rule

Until E5 passes, keep one implementation source of truth:

```text
work/J-AFC4-p1-revit-mcp-bootstrap
```

Do not create another long-lived implementation branch only to rename the Job. The branch name is legacy; the content is the active J-8A2C implementation line.

If a short-lived repair branch is ever required, it must be merged back into the implementation line in the same phase and deleted immediately. No accepted commit may remain stranded on a side branch.

After E5 Human acceptance:

1. compare the implementation line against `main`;
2. merge the accepted implementation line into `main`;
3. run the final verification set on `main`;
4. only then delete the old work branch.

### 0.2 Commit discipline

Each implementation phase produces bounded commits with the Job/phase in the message, for example:

```text
J-8A2C P0: converge authority lifecycle contract
J-8A2C P1: finish Revit MCP bootstrap
J-8A2C P2A: add managed Revit WebView session shell
J-8A2C P2B: implement dual-mode model authority
J-8A2C P3A: harden Revit Job runtime contract
```

Tester evidence never shares a commit with speculative implementation changes. A failed test creates a finding; it does not silently patch the product inside the Tester stage.

### 0.3 Fixed causal chain

```text
P0
-> P1
-> E1
-> E2
-> E3
-> P2A
-> E4A
-> P2B
-> E4
-> P3A
-> E4J
-> P3B
-> E5
```

No downstream phase starts before its predecessor gate passes.

### 0.4 Authority modes

The migrated contract is fixed:

```text
BROWSER_TTL
  browser/plugin ChatGPT session
  model lease idle timeout = 15 minutes

ADDIN_MANAGED
  WebView chat successfully paired with the Revit add-in
  no RevitGPT idle timeout while the pair remains valid
```

Do not keep `ADDIN_MANAGED` alive by fake heartbeat activity. It is alive because the pair/host lifecycle is valid, not because a timer manufactures activity.

---

# P0 — Policy convergence and canonical lifecycle contract

## Goal

Eliminate the old global 15-minute lease statement and create one versioned lifecycle contract that every add-in/authority implementation and test consumes.

## Source inputs

- current P1 work branch;
- `main` commit `93d84b7fe628afbce3e5cfef5560a35429753715`;
- `docs/roadmap/ROADMAP.md`;
- `docs/roadmap/DECISION_REGISTER.md`;
- `docs/roadmap/RG-CG-ADDIN-PLAN.md` from `main`;
- CadGPT managed-session reference:
  - `src/cadgpt/lib/addin-control.ts`;
  - `src/cadgpt/lib/mcp-session-manager.ts`;
  - `src/cadgpt/lib/work-registration.ts`;
  - `tests/addin-control.test.mjs`.

## Exact execution

1. Fetch `main` and the implementation branch.
2. Bring the add-in architecture commit `93d84b7` into the implementation line without discarding any P1 commits.
3. Resolve documentation conflicts in favor of:
   - current Human RevitGPT product decisions;
   - real Revit evidence;
   - CadGPT only as host-neutral reference.
4. Create:
   ```text
   docs/architecture/AUTHORITY_LIFECYCLE.md
   ```
5. Update `ROADMAP.md`, `DECISION_REGISTER.md`, and `RG-CG-ADDIN-PLAN.md` to reference that file rather than restating timeout semantics independently.
6. Mark previous global “lease = 15 minutes” wording as legacy and replace it with authority-mode-qualified rules.

## Canonical state table to persist

The P0 artifact must explicitly encode at least these rows.

| Event | BROWSER_TTL | ADDIN_MANAGED |
|---|---|---|
| Normal user turn | refresh 15m lease if bound | no timeout refresh needed; pair remains managed |
| Idle <=15m | no change | no change |
| Idle >15m | release model authority | no change |
| Panel hide/show | n/a | preserve pair + authority |
| MCP transport detach/replacement | logical chat may reconnect; lease follows browser policy | preserve pair + authority |
| Windows sleep/resume | elapsed wall time may expire browser TTL | preserve pair + authority |
| WebView crash/recreate | n/a | preserve pair if pair still valid; recover profile |
| Active view/tab/model changes | never auto-rebind | never auto-rebind |
| `rg/stop` | release model authority | release model authority/foreground work; keep add-in pair managed |
| Successful Lease + Bind Current | atomically move authority | atomically move authority; pair unchanged |
| Failed Lease + Bind Current | preserve old authority | preserve old authority; pair unchanged |
| Bound model closes | release model authority | release model authority; keep managed pair/chat |
| Explicit pair release | n/a | release pair; session no longer ADDIN_MANAGED |
| Add-in unload | n/a | release pair + model authority |
| Revit exits | release any Revit authority | release pair + model authority; ChatGPT profile may persist |
| Control-plane restart | browser authority is dropped | old server pair becomes stale; add-in opens a fresh pair window; never treat elapsed idle as expiry |
| Missing/deleted/logged-out ChatGPT conversation | normal new browser admission | explicitly abandon/release stale pair; create fresh conversation/pair; do not inherit old authority |
| New conversation after recovery | normal 0/1/many admission | normal 0/1/many admission; if exactly one eligible model, fast-bind may select it under normal rules |

### Control-plane restart detail

The control plane is allowed to lose in-memory authority state. Recovery must not pretend the old server lease still exists.

Required behavior:

1. add-in notices old `pair_id` is no longer paired;
2. preserve last-confirmed model only as local display/recovery context;
3. create a new pending pair;
4. next valid `@rg` admission completes the new pair;
5. try to reacquire the previous model only if its E3 strong identity is still present and free;
6. if another authority owns it or identity is ambiguous, remain unbound/conflict rather than force takeover.

## P0 acceptance

- no source document still states a global 15-minute lease without mode qualification;
- canonical lifecycle artifact exists and is versioned;
- roadmap, decision register, and add-in plan point to it;
- implementation branch contains the accepted add-in architecture direction;
- Reviewer confirms no contradictory lifecycle rule remains.

## P0 rollback

If convergence causes non-document source conflicts, stop before changing runtime behavior. Restore only the P0 changeset, keep the existing P1 runtime intact, and resolve the source conflict in a new bounded P0 commit.

---

# P1 — Finish the proven Revit MCP bootstrap

## Goal

Make the existing RevitGPT runtime reliable enough for real-project E1/E2/E3 evidence. Do not implement final model authority here.

## Primary files

```text
src/index.mjs
src/revit-upstream.mjs
src/appdata.mjs
src/log-store.mjs
src/managed-tools.mjs
src/revit-mcp-dev.mjs
runtimes/Revit-mcp/**
setup.bat
doctor.bat
run.bat
openai-tunnel.ps1
revitgpt-tray.ps1
.env.example
.github/workflows/p1-revit-mcp-bootstrap.yml
```

## Execution steps

1. Re-read all P1 files changed since the last branch head.
2. Confirm `src/index.mjs` still implements only bootstrap admission/lifecycle and has not accidentally added final lease semantics.
3. Confirm:
   - Revit process detection;
   - bridge health;
   - lazy full-MCP activation;
   - structured logs;
   - managed AppData setup;
   - production vs `revit-mcp-dev` mutation boundary.
4. Add only instrumentation required by E1/E2/E3:
   - Revit PID/session;
   - bridge PID/version;
   - active/open document metadata;
   - candidate document list;
   - model-identity candidate fields.
5. Do not choose a final model key in P1.

## Static/CI verification

Use repository-defined checks, not guessed alternatives:

```powershell
npm install
node --check src/index.mjs
node --check src/revit-upstream.mjs
node --check src/appdata.mjs
node --check src/log-store.mjs
node --check src/managed-tools.mjs
node --check src/revit-mcp-dev.mjs
node --check scripts/verify-appdata.mjs
node scripts/verify-appdata.mjs

python -m pip install -r runtimes/Revit-mcp/requirements.txt
python -m compileall -q runtimes/Revit-mcp
cd runtimes/Revit-mcp
python -m unittest discover -s tests -p "test_bridge.py"
```

Also parse the PowerShell/tray scripts exactly as CI does.

## Windows host verification

On the Human Windows/Revit machine:

```powershell
setup.bat
doctor.bat
run.bat status
```

Expected: local control plane healthy, Revit process detectable when running, bridge reachable only when available, full Revit MCP not activated merely because Revit is open.

## P1 acceptance

- CI/static checks PASS;
- doctor/status PASS on Human machine;
- no final authority logic added;
- E1 can start without a bootstrap workaround.

---

# E1 — Real Revit capability checkpoint

## Goal

Prove the GPT -> local runtime -> real Revit path before topology/authority work.

## Test model policy

Use a real RVT project or a copy of a real RVT project approved for controlled mutation. Do not rely only on mock/unit fixtures.

## Test sequence

1. Start Revit and open the approved model.
2. Confirm bridge health and document metadata.
3. Invoke `@rg`.
4. Read:
   - active/open document;
   - levels/views;
   - one known element/category.
5. Controlled write:
   - create one clearly disposable test object, preferably a test TextNote or another low-risk element;
   - include a unique `REVITGPT_E1_<timestamp>` marker where possible.
6. Read back the exact created element by ID.
7. Controlled delete that exact element.
8. Read back and prove the element is absent.
9. Record transaction/thread/context constraints and latency.

The existing `test_real_connection.py` may be used as supporting evidence, but E1 completion requires the ChatGPT connector path, not only direct Python invocation.

## E1 evidence

Persist:

- Revit version;
- PID/session;
- model title/path/type;
- tool names used;
- created element ID;
- readback result;
- delete result;
- post-delete verification;
- any bridge/transaction limitation.

## Stop condition

Any read/write/delete failure blocks E2. Fix the P1 capability path first; do not continue to model identity reasoning with a broken execution path.

---

# E2 — Lifecycle evidence

## Goal

Identify real lifecycle signals without inferring ChatGPT UI state.

## Matrix

Execute and record:

1. Revit OFF + `@rg` invoked -> full Revit MCP OFF.
2. Revit ON + `@rg` not invoked -> full Revit MCP OFF.
3. Revit ON + `@rg` invoked -> full Revit MCP ON.
4. Full MCP ON + no model authority -> MCP remains ON.
5. Bridge temporarily unavailable while Revit remains ON -> record actual behavior; bridge loss alone is not automatically Revit OFF.
6. Revit exits while MCP active -> full Revit MCP OFF.
7. MCP transport replaced -> logical conversation identity remains independently measurable.
8. Record Windows process/PID/session behavior across Revit restart.

## E2 acceptance

A concrete signal table exists for:

```text
Revit process
bridge
full MCP runtime
MCP transport
logical conversation
```

No implementation may use “ChatGPT window is open/closed” as a liveness contract.

---

# E3 — RVT topology and strong model identity

## Goal

Measure identity before implementing binding.

## Instrument candidate fields

Record, when available:

- Revit process PID/session;
- Revit version;
- document title;
- `Document.PathName`;
- current document/runtime token;
- saved vs unsaved state;
- workshared flag;
- central/worksharing GUID information;
- cloud project/model GUID information;
- linked/family/project-document classification;
- any bridge-assigned runtime document token.

Do not declare any one field authoritative before the matrix is complete.

## Test matrix

A. one model + aggressive view/tab churn;  
B. two project models in one Revit process;  
C. two Revit processes;  
D. close/reopen same file;  
E. Save As;  
F. same filename in different folders;  
G. local vs central/workshared where available;  
H. cloud model where available;  
I. family/temporary/reference documents mixed with project models.

For each case record which candidate fields remain stable, which change, and which collide.

## Required result

Define two concepts if evidence requires them:

1. **open-instance identity** — uniquely identifies the currently open document instance for authority;
2. **persistent model identity** — helps recognize the same underlying model across reopen/recovery.

Display name alone can never grant authority. Any fallback must refuse ambiguity.

## E3 acceptance

- 0/1/many eligible model enumeration contract is explicit;
- strong identity contract is explicit;
- ambiguous cases are blocked, not guessed;
- P2A may now observe active-vs-bound model safely.

---

# P2A — Revit DockablePane + managed WebView session shell

## Goal

Build the embedded shell and managed-session plumbing before final model authority.

## Proposed source layout

```text
addins/revitgpt-revit/
  RevitGPT.Addin.csproj
  App.cs
  DockablePaneProvider.cs
  ChatPane.xaml
  ChatPane.xaml.cs
  Services/
    AddinControlClient.cs
    WebViewSessionHost.cs
    RevitContextObserver.cs
    PaneRecoveryCoordinator.cs
  Models/
    AddinStatus.cs
    ModelSummary.cs
```

Exact filenames may adapt to the chosen .NET/Revit version, but responsibilities must remain separated.

## Local control-plane additions

Port the CadGPT invariant, not its AutoCAD API:

1. control descriptor under RevitGPT AppData, containing local port/process/ephemeral secret;
2. `pair/start` creates a short-lived pending `pair_id`;
3. normal user `@rg` admission consumes the pending pair and maps it to the logical `x-openai-session`;
4. `isAddinManagedSession(sessionKey)` becomes true while the pair exists;
5. logical-session/work cleanup consults the managed-session predicate;
6. add-in polls read-only status by `pair_id`;
7. pair persistence on disk is convenience only.

Suggested AppData paths:

```text
%LOCALAPPDATA%\RevitGPT\state\addin-control.json
%LOCALAPPDATA%\RevitGPT\runtime\revit-addin\pair-id.txt
%LOCALAPPDATA%\RevitGPT\webview-profile\
```

## Important pairing rule

The add-in starts the pending pair window. The **normal `@rg` admission** completes it. Do not scrape cookies or authentication tokens and do not make DOM automation the authority path.

## Managed-session cleanup rule

At minimum, the following cleanup systems must consult `isAddinManagedSession`:

- logical MCP session TTL;
- foreground Work/Job idle cleanup;
- model-authority idle cleanup once P2B exists.

Browser sessions that are not paired must keep their normal timeout behavior.

## WebView behavior

- dedicated persistent WebView2 user-data folder;
- top-level `https://chatgpt.com`;
- no auth token scraping;
- process failure triggers WebView recreation;
- pair id is preserved across recovery disposal;
- a long dispatcher gap triggers repoll/recovery, not timeout inference.

## Header/status model

Expose separate dimensions:

```text
Revit process
full MCP
pair state
logical session mode
bound model
active/viewing model
model-open state
mismatch state
authority mode
foreground/background Job state
```

Header color/visual presentation may change later; these semantic dimensions may not be collapsed into one “connected/disconnected” flag.

## P2A tests before E4A

Unit-test at least:

- pending pair consumed by normal `@rg` admission;
- explicit pair release stops managed pinning;
- transport disposal does not remove managed logical state;
- paired managed work survives artificial wall-clock timeout;
- ordinary browser work expires under the same sweep;
- WebView recovery path preserves saved pair id when appropriate;
- stale pair starts a fresh pairing window without clearing last-confirmed model display state.

---

# E4A — Managed-session differential recovery gate

## Required paired test

Run a real paired Revit add-in chat and an ordinary browser chat in parallel.

### Case 1 — timeout differential

Advance/wait beyond 15 minutes:

```text
ADDIN_MANAGED -> still managed/alive
BROWSER_TTL   -> model authority/work lease expires according to browser policy
```

### Case 2 — sleep/resume

Sleep or emulate a long wall-clock/dispatcher gap exceeding browser TTL.

Expected:

- add-in pair/session survives;
- no false “model closed” state;
- browser lease may expire normally.

### Case 3 — MCP transport replacement

Detach/replace the MCP transport.

Expected:

- `ADDIN_MANAGED` logical state remains;
- no implicit rebind;
- header preserves last confirmed local model context.

### Case 4 — WebView process failure

Force WebView2 process recreation.

Expected:

- persistent profile recovers ChatGPT;
- pair persists if still valid;
- model authority is unchanged solely because WebView failed.

### Case 5 — stale/deleted/logged-out conversation

Expected:

1. old pair is released/abandoned;
2. fresh conversation/pair is created;
3. old model authority is not inherited merely from WebView state;
4. normal 0/1/many admission decides the new authority.

E4A must PASS before P2B.

---

# P2B — Dual-mode model authority

## Goal

Implement one authority service shared by browser and add-in, with mode-specific expiry only.

## Core records

Authority state should expose at least:

```text
authority_id
authority_mode: BROWSER_TTL | ADDIN_MANAGED
logical_session_key
pair_id?                 # ADDIN_MANAGED only
model_identity
acquired_at
last_user_turn_at?       # relevant to BROWSER_TTL
state
```

Do not use active Revit tab/view as authority.

## BROWSER_TTL algorithm

1. acquire model if free;
2. bind chat identity + strong model identity;
3. every valid same-chat user turn refreshes expiry;
4. after 15 minutes idle, release model;
5. no historical-owner priority;
6. `rg/stop` releases immediately.

## ADDIN_MANAGED algorithm

1. require valid paired logical session;
2. acquire one primary model;
3. no idle-expiry timer;
4. sleep/transport/WebView/panel events do not release it;
5. explicit rebind moves authority atomically;
6. model close releases only model authority;
7. pair remains managed until explicit pair/host lifecycle end.

## Lease + Bind Current transaction

```text
observe active model
-> resolve strong E3 identity
-> validate eligibility
-> reserve/acquire new target
-> commit primary binding
-> release old target
-> publish status
```

If any step before commit fails, old authority remains unchanged.

## No-auto-rebind rule

Changing active model/view only changes mismatch observation. It never calls the bind transaction.

## 0/1/many admission

- 0 eligible models -> Welcome/idle;
- exactly 1 -> fast-bind if free/allowed;
- >1 -> selection/mismatch flow;
- duplicate/ambiguous identities -> refuse automatic authority.

---

# E4 — Authority lifecycle acceptance

Execute `AUTHORITY_LIFECYCLE.md` row-by-row.

## Browser cases

- same-chat turn refreshes TTL;
- >15m idle releases;
- another chat may acquire;
- old chat then conflicts if target was taken;
- `rg/stop` releases;
- restart behavior matches browser contract.

## Add-in cases

- >15m idle remains bound;
- 8h-equivalent wall-clock jump remains bound;
- sleep/resume remains bound;
- MCP transport replacement remains bound;
- WebView recreation remains bound;
- panel hide/show remains bound;
- active-model mismatch does not rebind;
- successful bind-current moves authority;
- failed bind-current preserves old authority;
- bound model close releases model but keeps managed chat/pair;
- explicit pair release removes managed status;
- add-in unload/Revit exit releases pair and model authority;
- control-plane restart opens a fresh pair and does not interpret prior idle duration as expiry.

Any deviation blocks P3A.

---

# P3A — Harden the Revit Job platform

## Goal

Replace the current Job skeleton with a mature Revit-native contract before real reusable Jobs are authored.

## Primary files

```text
knowledge/jobs/JOB_RULES.md
skills/jobcreate/SKILL.md
src/managed-tools.mjs
src/appdata.mjs
new Job runtime modules under src/ as required
```

## Storage contract

Keep three domains separate:

```text
Permanent reusable bundle
  appdata/libraries/jobs/<library-id>/**

Draft/checkout authoring
  appdata/workspace/job-draft/**

Runtime/recovery/result data
  managed model-scoped runtime/result namespaces
```

Runtime bytes must never change the permanent bundle hash.

## New Job authoring

```text
plan/approve
-> job_draft_new
-> author
-> validate source
-> real run
-> final result validation
-> Human acceptance
-> hash-guarded promote
```

Generic file-write tools may not directly mutate permanent Job libraries.

## Existing Job refinement

```text
managed checkout
-> narrow edit
-> validate
-> real affected-path test
-> final validation
-> Human acceptance
-> expected-hash promote
```

Concurrent/stale overwrite must fail closed.

## Job-private assets

Private helpers remain in the owning Job bundle. Do not move a helper to the global Registry merely because the package/runtime currently lacks a path for it.

For Revit, allowed private assets may include reviewed Python and Job-owned Dynamo assets where the final contract permits them. Do not port AutoLISP/TBH/dynamic-lisp.

## Reasoning vs Direct runtime

### Reasoning Job

- preserve pending runtime/recovery bytes across relaunch;
- resume unresolved work;
- do not wipe raw input merely because the user invoked the Job again.

### Direct Job

- deterministic clean scratch on each dispatch;
- no stale reasoning state inherited.

## Sequential Job transition

Starting Job B in the same logical session must:

1. release stale foreground authority from Job A;
2. release any obsolete SYSTEM/background lease from A when its contract says it is finished;
3. preserve A pending recovery/result bytes;
4. activate B without forcing the Human to manually stop A merely to continue sequential work.

## Transactional cleanup

For each processed raw item:

```text
compute result
-> persist durable result
-> read back / verify
-> hash raw item
-> scoped file_delete(expected_hash)
```

Never delete all raw input before corresponding results are verified.

## Compatibility epoch

Normal invocation:

```text
read local compatibility epoch
-> epoch matches runtime -> O(1), continue
```

Only on mismatch:

```text
scan installed User Jobs
-> controlled checkout
-> narrow compatibility patch
-> validate
-> real affected-path test
-> promote/report
```

---

# E4J — Job platform evidence gate

Before P3B, prove:

1. Job A -> Job B works without manual stop;
2. A recovery bytes remain available;
3. Reasoning relaunch resumes pending runtime;
4. Direct rerun starts clean;
5. runtime-only file changes do not alter permanent bundle hash;
6. permanent helper changes do alter bundle hash;
7. stale promotion/overwrite is rejected;
8. transactional raw cleanup deletes only verified processed files;
9. scoped delete cannot delete directories/source/library;
10. compatibility fast path is O(1);
11. epoch mismatch triggers bounded repair;
12. Job behavior is the same under BROWSER_TTL and ADDIN_MANAGED except for authority lifetime.

Any workaround needed because the normal Job path is blocked becomes a workflow finding.

---

# P3B — Dynamo and real Revit Jobs

## Goal

Run user scripts and reusable Jobs only through explicit bound-model authority.

## Dynamo

- user-owned `.dyn` registry;
- target is the bound model identity, never ambient ActiveView;
- validate model authority immediately before execution;
- if authority changed or model disappeared, fail before mutation.

## Real Jobs

Exercise at least:

- one Reasoning Job;
- one Direct Job;
- one Job with persisted final model-scoped result;
- one sequential Job A -> B transition.

Each final report records:

- authority mode;
- bound model identity;
- Job version/hash;
- input/runtime/result paths;
- final validation result.

---

# E5 — Packaging + real-project beta

## Packaging

Verify:

```text
setup.bat
doctor.bat
run.bat
tray
Secure MCP tunnel
pyRevit/Revit bridge install
Revit DockablePane add-in install
WebView2 persistent profile
managed AppData
```

## Diagnostic dimensions

Status must expose separately:

```text
Revit process
bridge
full MCP
logical session
authority mode
add-in pair
candidate models
bound model
active/viewing model
mismatch
foreground Job
background Job
```

Never collapse these into a single red/green “connected” bit.

## Real-project regression matrix

Replay real read/write/delete/Dynamo/Job flows while deliberately:

- switching views;
- switching active models;
- opening multiple models;
- opening multiple Revit processes if E3 supports it;
- waiting beyond browser TTL;
- leaving add-in idle beyond browser TTL;
- sleeping/resuming Windows;
- recreating WebView;
- replacing MCP transport;
- closing bound model;
- rebinding current model;
- restarting control plane;
- running Job A then Job B.

## E5 final acceptance

Human confirms:

- no authority drift;
- no false add-in timeout/disconnect;
- browser TTL still expires correctly;
- add-in chat stays managed without artificial heartbeat;
- no restart of Revit is required merely to recover WebView/transport;
- Job lifecycle needs no workaround path;
- no source-of-truth branch/commit drift remains.

---

# Final integration to main

Only after E5 PASS:

1. fetch `main` and implementation line;
2. compare complete diff;
3. ensure every accepted J-8A2C commit is reachable from the implementation line;
4. ensure no accepted code remains only on temporary branches;
5. merge implementation line into `main`;
6. run static checks + selected real-host smoke tests again;
7. mark `main` as RevitGPT source of truth;
8. delete obsolete work/temporary branches after verification.

# Failure policy

At every phase:

- a failed check blocks the next dependent phase;
- fix the causal defect in the owning implementation phase;
- do not use a workaround as acceptance evidence;
- ambiguous model/domain rules go to Human rather than being guessed;
- preserve unrelated user-owned changes;
- rollback only the bounded failing phase changes, not unrelated source history.
