# RevitGPT Authority Lifecycle Contract

Status: **CANONICAL P0 CONTRACT — J-8A2C rev2**  
Consumers: `ROADMAP.md`, `DECISION_REGISTER.md`, `RG-CG-ADDIN-PLAN.md`, P2A, E4A, P2B, E4.

This file is the single source of truth for RevitGPT chat/session/model-authority lifecycle semantics. Other documents should reference this contract instead of restating divergent timeout rules.

## 1. Principles

1. RevitGPT local runtime owns model authority. WebView2, ChatGPT UI state, MCP transport state, cookies, DOM state, and Revit active view/tab never grant authority.
2. One logical ChatGPT conversation may own one primary Revit model authority at a time.
3. Browser/plugin sessions and add-in-paired sessions use different lifetime modes.
4. A transient transport/UI failure must not be interpreted as a model-close or authority-loss event.
5. Model authority, add-in pair, logical conversation, full Revit MCP runtime, and host process are separate lifecycles.

## 2. Authority modes

### BROWSER_TTL

Applies to ordinary ChatGPT/browser/plugin usage that is not paired to the Revit add-in.

- Idle model-authority timeout: **15 minutes**.
- A valid user turn in the same bound logical conversation refreshes the 15-minute lease.
- On expiry the model becomes free; the historical owner has no priority.
- `rg/stop` releases model authority immediately.

### ADDIN_MANAGED

Applies only after the Revit add-in successfully pairs its WebView conversation to the logical ChatGPT conversation.

- RevitGPT idle timeout: **none while the pair is valid**.
- No synthetic heartbeat or fake activity is required.
- Wall-clock inactivity, Windows sleep, panel hide/show, MCP transport replacement, or WebView process recreation do not expire the managed session or model authority.
- A valid pair is an explicit runtime relationship, not an inference from WebView cookies, DOM, login state, or visual presence.

## 3. Pairing contract

The host-neutral reference is the proven CadGPT pattern:

1. Add-in calls local `pair/start` and receives a short-lived random `pair_id`.
2. The next normal user `@rg` admission completes that pending pair using the proven logical `x-openai-session`.
3. Runtime maps `pair_id -> logical_session_key`.
4. `isAddinManagedSession(logical_session_key)` is true while a valid pair exists.
5. Logical-session cleanup, Work/Job idle cleanup, and ADDIN_MANAGED model-authority cleanup must consult that predicate.
6. The add-in may persist `pair_id` locally for recovery convenience, but persisted pair data is never authority by itself.

## 4. Lifecycle state table

| Event | BROWSER_TTL | ADDIN_MANAGED | Release scope / rule |
|---|---|---|---|
| Valid user turn | Refresh 15m lease if bound | No timeout refresh required | No release |
| Idle <=15m | No change | No change | No release |
| Idle >15m | Release model authority | No change | Browser: model authority only |
| Panel hide/show | N/A | Preserve pair + authority | No release |
| MCP transport detach/replacement | Reconnect logical chat; lease still follows TTL | Preserve pair + authority | No release from transport event alone |
| Windows sleep/resume | Wall time may cause browser TTL expiry | Preserve pair + authority | Browser TTL only |
| WebView crash/recreate | N/A | Preserve pair if server still recognizes it; recreate WebView/profile | No release from WebView failure alone |
| Active Revit view/tab/model changes | Never auto-rebind | Never auto-rebind | No release; UI may show mismatch |
| `rg/stop` | Release model authority | Release model authority and foreground execution; keep pair managed | Model authority/work only |
| Successful Lease + Bind Current | Atomically move authority | Atomically move authority; pair unchanged | Old model authority released only after new bind commits |
| Failed Lease + Bind Current | Preserve old authority | Preserve old authority + pair | No release |
| Bound model closes | Release model authority | Release model authority; keep managed pair/chat | Model authority only |
| Explicit pair release | N/A | Session no longer ADDIN_MANAGED | Release add-in pair + any ADDIN_MANAGED model authority/foreground work that depends on that pair; preserve logical ChatGPT conversation + full Revit MCP runtime |
| Add-in unload | N/A | Release pair + model authority | Pair + model authority |
| Revit exits | Release Revit model authority | Release pair + model authority | Host/model authority; WebView profile may remain on disk |
| Control-plane restart | Drop in-memory browser authority | Old in-memory pair is stale; start a fresh pair/rebind flow | Never interpret elapsed idle as expiry |
| Missing/deleted/logged-out ChatGPT conversation | New browser admission | Release/abandon stale pair; create fresh conversation/pair | No inherited model authority from WebView state |
| New conversation after recovery | Normal 0/1/many admission | Normal 0/1/many admission after fresh pair | Strong model identity + current authority rules apply |

## 5. Control-plane restart recovery

Control-plane state is not required to survive process restart.

For an add-in that still has a locally saved old `pair_id`:

1. query the new control plane;
2. if `paired=false`, mark the old pair stale;
3. preserve the last confirmed model only as local UI/recovery context;
4. create a new pending pair;
5. the next valid `@rg` admission completes the new pair;
6. reacquire the previous model only if E3 strong identity confirms the same eligible open model and it is free;
7. if the model is owned, absent, or ambiguous, remain unbound/conflict; never force takeover.

## 6. Active-vs-bound model rule

- There is one primary bound model.
- Revit active view/tab/model is observation only.
- If viewing model != bound model, surface MISMATCH.
- The only normal intentional switch is explicit **Lease + Bind Current**.
- Bind is transactional: validate target -> reserve/acquire -> commit new binding -> release old binding.
- Any pre-commit failure preserves the previous valid binding.

## 7. Persistent WebView profile

Use a dedicated persistent WebView2 user-data/profile folder so login/conversation state may survive host restart.

This profile is **convenience state only**.

- Do not scrape auth tokens/cookies.
- Do not use DOM selectors as authority.
- A restored WebView does not imply a valid add-in pair.
- A missing/deleted/logged-out conversation requires a fresh conversation/pair and normal authority admission.

## 8. Required diagnostics

Expose these dimensions independently:

```text
Revit process
bridge
full Revit MCP
MCP transport
logical conversation
authority mode: BROWSER_TTL | ADDIN_MANAGED
add-in pair
candidate models
bound model
active/viewing model
mismatch
foreground Job
background Job
```

Do not collapse these dimensions into one connected/disconnected flag.

## 9. Required acceptance evidence

Before P2B/E4 can pass:

- `ADDIN_MANAGED` remains valid after idle >15m.
- In the same test, `BROWSER_TTL` expires after >15m idle.
- Sleep/resume does not expire `ADDIN_MANAGED`.
- MCP transport replacement does not expire `ADDIN_MANAGED`.
- WebView recreation does not expire `ADDIN_MANAGED`.
- Active view/model switching never auto-rebinds.
- Bind Current rollback preserves old authority on failure.
- Model close releases model authority but keeps the managed pair.
- Explicit pair release removes managed status and releases pair-dependent ADDIN_MANAGED model authority/foreground work without terminating the logical ChatGPT conversation or full Revit MCP runtime.
- Control-plane restart follows fresh-pair/rebind semantics without using prior idle duration.

Any deviation is a blocking lifecycle finding, not an accepted workaround.
