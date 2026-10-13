// Older ChatGPT plugin catalogues may still advertise P2D pairing commands,
// even though P2E deliberately removed panel pairing and manual session lease.
// Translate ONLY these retired names into read-only migration guidance. Never
// issue a lease, change native binding, or reach the Python MCP through them.
export const RETIRED_PANEL_COMMANDS = Object.freeze([
  "revitgpt_pair_panel",
  "revitgpt_lease_bound_model"
]);

export async function handleRetiredPanelCommand(name, args, readBinding) {
  if (!RETIRED_PANEL_COMMANDS.includes(name)) return null;
  if (args == null) args = {};
  if (typeof args !== "object" || Array.isArray(args) ||
      Object.keys(args).length !== 0)
    throw new Error("RETIRED_PANEL_ARGUMENTS_INVALID");
  if (typeof readBinding !== "function")
    throw new Error("NATIVE_BINDING_READER_INVALID");

  const native = await readBinding();
  const valid = native?.status === "BOUND_CURRENT" &&
    typeof native.bound_id === "string" &&
    native.bound_id && native.active_id === native.bound_id;
  const text = valid
    ? "NO PAIRING OR SESSION LEASE REQUIRED. The bound Revit model is current. To read Levels call revitgpt_call with name='revit_list_levels' and arguments={}. Do not request revitgpt_pair_panel or revitgpt_lease_bound_model again."
    : "Pairing and session leases were removed in P2E. Native model binding is not currently readable (" +
      String(native?.status || "UNKNOWN") + "). Select the correct Revit project and use Bind Current if needed. Do not request pairing or a lease.";

  return {
    content:[{type:"text",text}],
    structuredContent:{
      status:"RETIRED_CONTROL_NO_LEASE_REQUIRED",
      old_tool:name,
      native_binding_status:typeof native?.status==="string"?native.status:"UNKNOWN",
      model_current:Boolean(valid),
      read_only:true,
      ...(valid?{ next_tool:"revit_list_levels", next_arguments:{} }:{})
    }
  };
}
