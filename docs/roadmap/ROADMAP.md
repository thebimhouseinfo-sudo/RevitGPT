# RevitGPT roadmap

## Planning rule

Every architectural claim must be tagged by provenance:

- **REF** — supported by existing source/reference implementation.
- **EVIDENCE** — observed in a real runtime test.
- **HUMAN** — explicit product decision from Human.
- **UNKNOWN** — not yet known. It must remain an evidence need.
- **TEMP-HYPOTHESIS** — allowed only after explicit Human approval and must name the test that will confirm/reject it.

No UNKNOWN may be silently promoted to implementation contract.

## Current approved facts and decisions

### Chat/session ownership

- **HUMAN:** one ChatGPT conversation binds one RVT model.
- **HUMAN:** model lease idle timeout is 15 minutes.
- **HUMAN:** every message in the same bound conversation should refresh the 15-minute lease, **provided a stable same-conversation identity is proven**.
- **REF:** CadGPT already observed `x-openai-session` stable across replacement MCP transports in a short test and different across another conversation.
- **UNKNOWN:** stability duration beyond the short CadGPT test. Evidence gate E0 tests 1h/4h/8h.
- **HUMAN:** after lease expiry the model is free for any chat; historical owner has no priority.
- **HUMAN:** `rg/stop` may explicitly release a still-valid lease so another chat can bind immediately.
- **HUMAN:** control-plane restart/crash drops leases immediately; lease persistence/recovery is not required.

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

Result: Chat A retained one `x-openai-session` fingerprint for ~14h14m across five MCP transport identities; Chat B had a distinct `x-openai-session` while sharing the same `x-openai-subject`. This is sufficient evidence for the Human-approved 15-minute lease. Control-plane restart/crash still drops leases and uses fresh bind.

### P1 — Bootstrap proven Revit MCP

Migrate the working CAD-Agent Revit MCP baseline first.

Deliver:
- compatible Revit bridge/add-in for actual host version;
- known read/write/delete tools;
- development-only `revit-mcp-dev`;
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

### P2 — Admission + lease implementation

Only after E0 + E2 + E3 provide required evidence.

Implement:
- 0/1/many fast-connect behavior;
- one chat / one model lease;
- 15-minute TTL;
- same-chat message refresh using the proven logical chat identity;
- model free immediately on expiry;
- no historical-owner priority;
- `rg/stop` early release;
- control-plane restart/crash drops leases;
- no dependency on chat UI open/closed state.

### E4 — Lease/reconnect acceptance

Test:
- same chat messages refresh TTL;
- >15m idle frees model;
- another chat binds freed model;
- old chat returns and conflicts if model was taken;
- `rg/stop` releases a still-valid lease;
- control-plane restart makes model free;
- full MCP can remain ON with no lease.

### P3 — User registry + Dynamo + Jobs

Add:
- user `.dyn` registry/lifecycle;
- Dynamo Player execution under bound-model authority;
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

Complete E0 first. The test code is already committed in this repository:

- `session-test.bat`
- `scripts/session-stability-report.mjs`
- `docs/evidence/x-openai-session-stability.md`


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
