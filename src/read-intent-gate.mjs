/**
 * Bound model admission for RevitGPT read, UI and write operations.
 *
 * Streamable MCP recovery and connector proxies can use a different server
 * instance per tool call. Never require an in-memory "admitted" boolean from
 * a previous request, and never grant/model-bind on the Node side.
 *
 * authorize() reads native binding for EVERY model operation, fails closed on an
 * inactive/closed model, and rejects unknown tools before activation.
 * Writes execute against the bound/current model in Revit ExternalEvent context.
 */
export async function callReadOnlyTool({ name, args = {}, authority, ensureReady, invoke }) {
  if (!name || typeof name !== "string") throw new Error("REVIT_MCP_TOOL_NAME_INVALID");
  if (!authority || typeof authority.authorize !== "function" ||
      typeof ensureReady !== "function" || typeof invoke !== "function")
    throw new Error("REVIT_MCP_READ_GATE_INVALID");
  const safeArgs = await authority.authorize(name, args);
  const tools = await ensureReady();  // explicit user tool request; never startup polling
  if (!Array.isArray(tools) || !tools.some(t => t.name === name))
    throw new Error("REVIT_MCP_TOOL_NOT_DISCOVERED: " + name);
  return invoke(name, safeArgs);
}

export async function ensureReadRuntime({ upstream, processState, bridgeState }) {
  if (!upstream || typeof upstream.status !== "function" ||
      typeof upstream.activate !== "function")
    throw new Error("REVIT_MCP_READ_RUNTIME_INVALID");
  if (upstream.status().connected) return upstream.cachedTools();

  // Cold: run both live checks. Revit being ON alone never starts Python MCP.
  const [revit, bridge] = await Promise.all([processState(), bridgeState()]);
  if (revit.observable !== true || revit.running !== true)
    throw new Error("REVIT_OFF: open Revit before requesting model data");
  if (bridge.available !== true)
    throw new Error("BRIDGE_OFF: native Revit bridge is unavailable");
  return upstream.activate();
}
