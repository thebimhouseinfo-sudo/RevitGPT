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
