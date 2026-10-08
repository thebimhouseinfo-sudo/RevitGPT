import { randomUUID } from "node:crypto";

const DIAGNOSTIC = new Set([
  "revit_get_runtime_info", "revit_get_active_document", "revit_list_documents"
]);
const MODEL_READS = new Set([
  "revit_list_views", "revit_list_levels", "revit_list_elements",
  "revit_get_element", "revit_list_families", "revit_list_family_types",
  "revit_list_system_types", "revit_get_connectors", "revit_list_annotations"
]);

// The control plane, never WebView, reads native model selection.
// Every model read checks current binding. Native write routes remain 501.
export async function fetchNativeBindingStatus(baseUrl, {
  fetchImpl = fetch, idFactory = randomUUID, timeoutMs = 2500
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(baseUrl.replace(/\/$/, "") + "/binding/status", {
      headers: { "X-Request-ID": idFactory() }, signal: controller.signal
    });
    if (!response.ok) throw new Error("NATIVE_BINDING_UNAVAILABLE: HTTP " + response.status);
    const body = await response.json();
    if (!body?.data || typeof body.data !== "object")
      throw new Error("NATIVE_BINDING_INVALID_RESPONSE");
    return body.data;
  } finally { clearTimeout(timer); }
}

function currentBinding(snapshot) {
  if (!snapshot || typeof snapshot !== "object" ||
      typeof snapshot.host_instance_id !== "string" ||
      !/^[0-9a-f]{32}$/i.test(snapshot.host_instance_id) ||
      !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
      typeof snapshot.bound_id !== "string" || !snapshot.bound_id.trim() ||
      typeof snapshot.active_id !== "string" || !snapshot.active_id.trim()) {
    throw new Error("NATIVE_BINDING_INVALID_RESPONSE");
  }
  if (snapshot.status !== "BOUND_CURRENT" || snapshot.active_id !== snapshot.bound_id)
    throw new Error("MODEL_BINDING_NOT_CURRENT: " + String(snapshot.status ?? "UNKNOWN"));
  return {
    host_instance_id: snapshot.host_instance_id,
    revision: snapshot.revision,
    bound_id: snapshot.bound_id,
    bound_title: typeof snapshot.bound_title === "string" ? snapshot.bound_title : ""
  };
}

export class SessionModelAuthority {
  constructor(readStatus) {
    if (typeof readStatus !== "function") throw new Error("Missing native status probe");
    this.readStatus = readStatus;
    this.lease = null;
  }
  summary() {
    return this.lease ? { ...this.lease, permission: "read_only" } : null;
  }
  async leaseCurrent() {
    this.lease = null; // If re-lease fails, old authority cannot survive.
    this.lease = currentBinding(await this.readStatus());
    return this.summary();
  }
  async authorize(name, input = {}) {
    if (DIAGNOSTIC.has(name)) return { ...input };
    if (!MODEL_READS.has(name)) throw new Error("NATIVE_MUTATIONS_NOT_ENABLED");
    if (input === null || typeof input !== "object" || Array.isArray(input))
      throw new Error("MODEL_TOOL_ARGUMENTS_INVALID");
    // All admitted MCP sessions have read-only access to the ONE native
    // bound model. No silent auto-binding here and no write privileges.
    // Switching to another tab or closing the bound model fails closed.
    let snapshot;
    try {
      snapshot = currentBinding(await this.readStatus());
    } catch(error) {
      this.lease = null;
      throw error;
    }
    if (input.document_id !== undefined && input.document_id !== snapshot.bound_id)
      throw new Error("DOCUMENT_ID_MISMATCH");
    this.lease = { ...snapshot }; // status snapshot, not a grant/token
    return { ...input, document_id: snapshot.bound_id };
  }
  clear() { this.lease = null; }
}
