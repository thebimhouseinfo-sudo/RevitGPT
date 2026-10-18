# P1/P2 regression audit against pre-P3 baseline

Baseline: `4b10a8284fe7b044d7576ecf71dc2525d13c59af` (accepted P1/P2, icon-only Ribbon). Compared to `main` as of 2026-10-18.

## Established by Git blob comparison
- Unchanged: `iconaddin.png`, `OpenRevitGptPaneCommand.cs`, `scripts/manage-native-revitgpt-install.ps1`, `RevitGPT.Native.csproj`. The accepted Ribbon previously registered `RevitGPT_OpenPane` with text `" "`, a 16/32px `iconaddin.png` image and `OpenRevitGptPaneCommand`.
- The post-P3 edit changing Ribbon caption to `"RevitGPT"` was an unauthorized P1 behavior change and is now **reverted** to `" "`; the regression test is aligned to the accepted P1 UX. Additional diagnostic `ribbon_button_missing` is retained.
- No proof from source alone that Revit successfully registered the Ribbon at runtime. The application logs `ribbon_registered`, `ribbon_icon_missing`, `ribbon_icon_failed`, `ribbon_failed` to `%LOCALAPPDATA%\RevitGPT\logs\native-pane.ndjson`. Inspect these and the actual versioned installed DLL/icon whenever the user sees no Ribbon button.

## P1/P2 execution surfaces modified by P3 — must not be treated as automatically preserved
1. `src/revit-upstream.mjs`: new DEV reload and in-flight accounting around shared Python MCP lifecycle. Ordinary tool calls still connect/call/return, but there is a *race window* around tool admission/binding and reload not covered by an in-flight counter. Test two-chat active operations + reload; do not declare complete P1 stability until observed.
2. `src/model-authority.mjs` and `src/index.mjs`: added explicit Model Anchor tools and DEV-only dynamic tool admission. Existing read/write sets otherwise remain; conservative new tool mutating classification means the new MCP Tool contract must be tested with exact bound model. Avoid granting new P2 tool names implicitly outside DEV.
3. `runtimes/Revit-mcp/bridge/unified_native/NativeDynamoLoad.cs` + `services/dynamo_preflight.py`: extended accepted .dyn directories from legacy staging to owned Job/Dynamo/Temp bundles. Legacy `dynamo/staging` remains admitted; legacy staged Python Nodes remain denied. Validate both legacy stage/load/no-run and owner-local load/run independently. The change is not a blanket P2 PASS and requires live Dynamo 2024 verification.
4. `BridgeRouteContract.cs`, `BridgeHttpProtocol.cs` and `RevitApiRouter.cs`: added Model Anchor routes and write deadline classification. Existing route bodies were not deliberately replaced, and static route parity is tested; still verify Native registration and first P3 anchor initialization.
5. `doctor.bat` + `scripts/check-revit-bridge-host.ps1`: adapted host diagnostic to recognize official `RevitGPT.addin` before retired legacy bridges. This is a correction for deployed official Native host; only confirms registration, NOT Ribbon or WebView/pane visibility.
6. `src/managed-tools.mjs`, `src/capability-registry.mjs`, `src/tool-effects.mjs`: new P3 ownership/registry/dev calls share P2 local AppData state. Concurrent same-process writes got a guard; cross-process concurrency and legacy P2 discovery need a separate compatibility check.

## Acceptance boundaries / immediate next actions
- Do not revert the whole P1/P2 integration blindly: only restore a confirmed baseline deviation, then regression-test both new P3 and existing P1/P2 pathways in **one batch**.
- P1 acceptance: registered icon-only Ribbon on Add-Ins tab; after manually closing panel, click icon and show same pane (no rebind), listener remains healthy. Check `native-pane.ndjson` if failure.
- P2 compatibility acceptance: one legacy staged .dyn graph LOAD-only and one known existing read/write MCP workflow, with before/after evidence and no unwarranted promotion. P3 acceptance remains Job Builder/Operator, Dynamo Writer, MCP Dev & Repair; these P1/P2 cases are only minimal regression smoke tests.
- No code review, compile or offline test alone proves the rendered Ribbon is visible. Do not mark full P1/P2 compatibility PASS without evidence.


## P1/P2 behavior simulation expansion (2026-10-18)

Scope: only legacy P1/P2 execution behavior touched by P3. **Do not treat this as P3 feature acceptance.**

Added `tests/p1-p2-compat-upstream.test.mjs` scenarios: baseline tool read/write effects, Native binding injection and document mismatch rejection, two simultaneous legacy MCP calls while DEV reload is attempted, ordinary API error not tearing down Python transport, and new calls failing closed during reload. Added `runtimes/Revit-mcp/tests/test_p2_dynamo_backward_compat.py`: legacy draft → immutable staging → preflight roundtrip; staged Python Nodes still blocked; external graph rejected. These now run through CI and `scripts/p3-test-and-install.ps1`.

**Simulation limits:** tests are committed but Windows/CI execution for this new batch is not yet observed. They simulate Node RPC and Python preflight, not loaded Revit host, ribbon icon rendering, Revit ExternalEvent scheduling or Dynamo completion. Existing P1/P2 real-host verification cannot be replaced by mocked tests; use targeted runtime inspection only if a compatibility problem is observed.

Audit judgement by observed source changes:
- **Confirmed source regression restored:** post-P3 P1 icon-only ribbon label was changed, then restored exactly to accepted baseline.
- **Potential interruption mitigated, not a confirmed regression:** Python upstream reload refuses active in-flight calls. A call still in the upstream's pre-admission stage can race with reload, producing a bounded error rather than silently mutating the wrong model; needs host observation if seen.
- **Legacy P2 Dynamo preflight is preserved by design** with staging still allowed and normal code block load rules unchanged; path restrictions are intentionally extended, not replaced. New simulation covers this.
- **No evidence to claim complete P1/P2 breakage:** other modifications add routes and P3 tools, while core P1 Ribbon/panel command and official installer are unchanged relative to pre-P3 baseline. Physical user-observed missing Ribbon icon still requires installed DLL/icon and `native-pane.ndjson` inspection.


## Direct execution of old-path source simulations — 2026-10-18

A JavaScript V8 harness loaded the **actual current GitHub source bodies** from `src/revit-upstream.mjs` and `src/model-authority.mjs`. External MCP SDK/OS dependencies were mocked; no Revit instance was used. **8 PASS / 0 FAIL**:
1. Original read/write tool effect classification preserved (levels/view/documents/parameters; save/set/load/run).
2. New upstream starts with idle in-flight/reload counters.
3. In-flight accounting increments synchronously on a legacy call.
4. DEV reload rejects an active legacy call with `REVIT_MCP_RELOAD_BUSY`.
5. Counter resets after the call resolves.
6. Ordinary `Bridge HTTP 400` application error does **not** disconnect healthy upstream.
7. Existing P1 native bound document ID is passed through authorization.
8. Explicit document ID mismatch is rejected.

Additional concurrency probe: an old call waiting inside `connect()` still counts as in-flight and the attempted DEV reload yielded `REVIT_MCP_RELOAD_BUSY` with **zero disconnects**. The upstream segment of the previously suspected race was not reproduced.

**Not yet executed:** Python `test_p2_dynamo_backward_compat.py` against full repo because this execution environment cannot clone the repository or load its installed packages. Both regression suites are committed and wired into local `scripts/p3-test-and-install.ps1` / GitHub CI, but running them on the user's Windows checkout is still necessary for a whole-project PASS. The 8 V8 source-body simulations are not a real Native Revit ribbon, WebView, or Dynamo host test. Do not conflate them with host integration PASS.
