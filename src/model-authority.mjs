import { randomUUID } from "node:crypto";

const DIAGNOSTIC = new Set([
  "revit_get_runtime_info", "revit_get_active_document", "revit_list_documents"
]);
const MODEL_READS = new Set([
  "revit_list_view_filters", "revit_get_annotation", "revit_list_sheets", "revit_list_sheet_viewports",
  "revit_list_schedules", "revit_get_schedule",
  "revit_get_active_view", "revit_get_selection",
  "revit_query_elements", "revit_get_view_properties", "revit_list_views", "revit_list_levels", "revit_list_elements",
  "revit_count_elements", "revit_group_elements",
  "revit_inspect_family_instance", "revit_get_categories", "revit_get_geometry_summary", "revit_get_element_relationships", "revit_get_parameters", "revit_list_parameters", "revit_query_spatial_and_warnings", "revit_get_element", "revit_list_families", "revit_list_family_types",
  "revit_trace_mep_system", "revit_list_system_types", "revit_list_mep_systems", "revit_quantity_takeoff", "revit_summarize_equipment", "revit_get_connectors", "revit_list_annotations"
]);

const UI_ACTIONS = new Set(["revit_set_selection", "revit_show_elements", "revit_activate_view", "revit_temporary_visibility", "revit_select_related"]);
const MODEL_WRITES = new Set([
  "revit_load_dyn_file", "revit_create_or_duplicate_view", "revit_manage_view_filters", "revit_batch_tag", "revit_update_annotation", "revit_update_schedule", "revit_create_slab", "revit_format_view", "revit_manage_sheet", "revit_batch_set_parameters", "revit_copy_parameters", "revit_create_architecture", "revit_transform_elements", "revit_place_family_instance", "revit_create_duct", "revit_create_pipe",
  "revit_set_parameter", "revit_delete_elements", "revit_move_element",
  "revit_create_text_note", "revit_create_tag", "revit_create_dimension",
  "revit_create_spot_elevation", "revit_create_detail_line"
]);

// The control plane, never WebView, reads native model selection.
// Every model operation checks binding, including writes.
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
    return this.lease ? { ...this.lease, permission: "read_write_bound_model" } : null;
  }
  async leaseCurrent() {
    this.lease = null; // If re-lease fails, old authority cannot survive.
    this.lease = currentBinding(await this.readStatus());
    return this.summary();
  }
  async authorize(name, input = {}) {
    if (DIAGNOSTIC.has(name)) return { ...input };
    if (!MODEL_READS.has(name) && !UI_ACTIONS.has(name) && !MODEL_WRITES.has(name))
      throw new Error("MODEL_TOOL_NOT_ALLOWED");
    if (input === null || typeof input !== "object" || Array.isArray(input))
      throw new Error("MODEL_TOOL_ARGUMENTS_INVALID");
    // Every session is restricted to the ONE bound model. The Node layer may
    // dispatch model writes only with the current binding snapshot.
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
