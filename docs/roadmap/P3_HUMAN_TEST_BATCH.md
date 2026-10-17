# P3 — One consolidated Revit 2024 human test batch

**Preconditions:** source `main` updated, P3 offline checks and Native Release build PASS, installation script completed, Revit restarted. Use a **disposable saved RVT** with known elements, and record the active/bound model. Do **not** use a production RVT. Keep a separate copy for destructive-write cases.

Run all relevant cases in one session rather than repeated rebuild/reinstall cycles. Each step reports actual `PASS / FAIL / UNKNOWN` plus returned tool payload, RVT readback and model ID. A transport success or Dynamo dispatch is not a model-effect PASS. After an uncertain write, **inspect Revit before considering retry**.

## A. Connection / native binding
1. `@rg`; then `revitgpt_status`, `revitgpt_binding_status`, `revitgpt_list_tools`.
2. Verify the correct bound project; switch active view/tab only and verify read vs UI action routing. Do not create per-chat binding.
3. Confirm new tools `revit_get_model_anchor`, `revit_initialize_model_anchor` appear in the Python tool inventory.

## B. Persistent Model Anchor
1. On disposable saved RVT, call `revit_get_model_anchor` (missing is expected on a fresh RVT). Confirm **read did not change RVT**.
2. Explicitly call `revit_initialize_model_anchor`; expect UUID and `requires_save`. Run `revit_save_model`; reopen RVT.
3. Read again. Check same UUID and `Project Information → RevitGPT_Model_ID`. Repeat initialization; verify it does not replace ID.
4. Change Project Name, Project Number and/or project phase designation; Save/reopen; verify UUID stays fixed. Rename RVT file/Save As; verify ID persists for this logical model.
5. Open an independent RVT: initialize and verify different UUID. Open a copied RVT carrying the same parameter **alongside** the original; expect duplicate-open-ID diagnostics, no silent rekey. Detached/copied RVTs that are *not* concurrently open require a separate explicit identity decision; do not claim automatic distinction.
6. Use `model_run_result_begin` for two distinct run IDs of one Saved/Temp Job. Check paths under `%LOCALAPPDATA%\RevitGPT\models\<UUID>\jobs\<job>\runs\<run>\results`; no Project Name-based directories.

## C. Shared Revit queue / Dynamo execution lifecycle
1. From two chats submit quick read calls concurrently (e.g. `revit_list_levels`, `revit_get_active_view`) then a controlled write and UI action. Inspect Native queue/host evidence, execution order and binding. Do not infer FIFO from call return ordering alone.
2. Use an owned, version-correct test `.dyn` on the disposable model. Verify `revit_load_dyn_file` loads without executing; `revit_run_dyn_file` requests execution without requiring Registry/staging.
3. Observe actual Dynamo graph terminal state (completed/failed/cancelled) and resulting element/parameter readback. `DYNAMO_AUTORUN_DISPATCHED_OUTCOME_UNVERIFIED` is **UNKNOWN**, not PASS and not graph completion. Test whether a second Revit command could overlap while the graph is still running; record exact finding. Never run destructive ambiguous commands repeatedly.

## D. Job Builder / Operator
1. Builder creates a Saved Job directly under its final `libraries\jobs\<id>` folder with `JOB.md` and `JOB_STEPS.md`, no Draft→Promote gate. Use `job_register_owned` only after its real test. `job_get` returns both files.
2. Operator follows `JOB_STEPS` exactly: declared step PASS → next; error/unknown → stop, report. No inserted step, hidden retry, or role switching.
3. For a controlled mutation Job, check exactly one `revit_save_model` after last model-mutating step (before later file-only steps).
4. Create a Temp Job. Test it without Registry; finish, dry-run cleanup, cleanup only after configured retention. Verify Model Anchor result and separately registered Dynamo survive Temp cleanup.

## E. Dynamo Save & Register
1. Builder writes/loads/tests an owned Dynamo graph and its data `JSON/CSV`.
2. After explicit instruction to save/register, call `dynamo_save_register`. Inspect new Dynamo library graph/dependencies, discoverable Registry entry, original Temp Job untouched, Temp Job **not registered**.
3. Confirm Registry indexing is discovery only and no unchanged second live-run is forced.

## F. MCP Dev & Repair (M8 required to complete in P3)
1. In DEV mode, inspect current `revit_mcp_dev_*` inventory. Add a small, real new Python MCP read tool suitable for the bound disposable model; invoke `revit_mcp_dev_reload`, verify updated inventory and `revitgpt_call` results.
2. Choose one **observed** existing tool whose real Revit use case is incorrect despite any prior technical PASS; repair only its relevant source module. Reload/rebuild affected layer as measured, live-test actual target behavior and readback. Do not fabricate an issue.
3. Register/update each verified tool's discovery metadata/manifest; verify descriptions and behavior correspond. An untested new tool is not a PASS.
4. While another chat is executing a call, try explicit dev reload; expect BUSY rather than cutting the call.

## G. Knowledge
1. Add a user-provided scoped work rule using `knowledge_user_rule_add`; check `knowledge_search` returns the source with correct provenance.
2. Modify the source-controlled rule in a controlled checkout test; confirm source rules win over stale AppData seed. Do not infer HVAC conventions not supplied.

## Evidence recording
For each failing case, note tool name, arguments (omit secrets), exact returned error/status, Revit version/build, Native add-in version, relevant RVT element IDs and before/after state. Separate **offline PASS**, **Native build PASS**, **live host PASS**, and **UNKNOWN**.

**P3 DONE** only after the relevant source and host-observable behaviors work. No blanket P2 all-tools PASS requirement; M8 Dev & Repair capability itself must be demonstrated live, while P2 tool coverage remains long-term.
