// Existing remote plugin catalogues can lag new named MCP tools.
// These three control-plane operations are also routable via the already
// published revitgpt_call(name,args) tool. They are NOT upstream Python tools.
export const PANEL_COMPAT_NAMES = Object.freeze([
  "revitgpt_pair_panel",
  "revitgpt_binding_status",
  "revitgpt_lease_bound_model"
]);

export const PANEL_COMPAT_CATALOG = Object.freeze(PANEL_COMPAT_NAMES.map(name => ({
  name,
  description: name === "revitgpt_pair_panel"
    ? "Pair the current ChatGPT session to the native panel (one-time code)"
    : name === "revitgpt_binding_status"
    ? "Inspect native binding and this session's read-only lease"
    : "Explicitly lease the bound model for this ChatGPT session (read-only)",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  source: "slim_control_plane",
  invocation: { tool: "revitgpt_call", name, arguments: {} }
})));

/**
 * Reuse ONE implementation for named tools and the legacy generic proxy.
 * An unknown name returns null, allowing normal upstream forwarding.
 */
export async function runPanelCompatTool(name, {
  admitted, upstreamConnected, authority, panelPairing, nativeBindingStatus
} = {}, args = {}) {
  if (!PANEL_COMPAT_NAMES.includes(name)) return null;
  if (args === null || typeof args !== "object" || Array.isArray(args) ||
      Object.keys(args).length !== 0) throw new Error("PANEL_CONTROL_ARGUMENTS_INVALID");
  if (name === "revitgpt_binding_status") {
    const native = await nativeBindingStatus();
    return {
      content: [{type:"text",text:"Native binding: "+String(native.status)}],
      structuredContent: {native_binding:native,session_lease:authority.summary()}
    };
  }
  if (!admitted || !upstreamConnected) throw new Error("REVITGPT_ADMISSION_REQUIRED");
  if (name === "revitgpt_pair_panel") {
    const challenge = panelPairing.begin(authority);
    return {
      content: [{type:"text",
        text:"Enter this one-time pairing code in RevitGPT panel: "+challenge.code}],
      structuredContent: {status:"PAIRING_PENDING",...challenge}
    };
  }
  const lease = await authority.leaseCurrent();
  return {
    content: [{type:"text",text:"Read-only lease: "+lease.bound_title}],
    structuredContent: {status:"LEASED_READ_ONLY",lease}
  };
}
