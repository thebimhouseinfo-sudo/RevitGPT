import { classifyModelOperation } from "./model-authority.mjs";

const READ_ONLY = new Set([
  "file_roots", "file_list", "file_read", "file_search",
  "owned_bundle_path", "owned_file_read", "capability_borrow_status",
  "library_list", "registry_list", "registry_search", "registry_get",
  "job_list", "job_get", "skill_list", "skill_get", "knowledge_search",
  "revit_mcp_dev_root", "revit_mcp_dev_list", "revit_mcp_dev_read", "revit_mcp_dev_search",
  "revitgpt_command", "revitgpt_list_tools", "dynamo_draft_validate"
]);

const SYSTEM_SIDE_EFFECT = new Set([
  "file_create", "file_edit", "library_create", "asset_import",
  "owned_bundle_create", "owned_file_write",
  "capability_borrow", "capability_release",
  "asset_register_external", "asset_export", "python_checkout",
  "python_scaffold", "python_validate", "python_promote_draft",
  "dynamo_register", "dynamo_draft_stage", "job_draft_new", "job_draft_validate",
  "job_promote_draft", "run_record_append", "knowledge_failure_append",
  "knowledge_promote", "revit_mcp_dev_snapshot", "revit_mcp_dev_edit",
  "revit_mcp_dev_create", "revit_mcp_dev_delete", "revit_mcp_dev_rollback",
  "revit_mcp_dev_validate", "revit_mcp_dev_accept_local",
  "revit_mcp_dev_reload"
]);

const CONTROL = new Set([
  "revitgpt_admission", "revitgpt_status", "revitgpt_binding_status"
]);
const RETIRED_READ_ONLY = new Set(["revitgpt_pair_panel", "revitgpt_lease_bound_model"]);

export function effectForTool(name, args={}) {
  if(CONTROL.has(name))return "CONTROL";
  if(name==="revitgpt_command"){
    const command=String(args?.command??"").trim().toLowerCase();
    if(command==="rg/status")return "CONTROL";
    return "READ_ONLY";
  }
  if(READ_ONLY.has(name))return "READ_ONLY";
  if(SYSTEM_SIDE_EFFECT.has(name))return "SYSTEM_SIDE_EFFECT";
  if(name==="revitgpt_call"){
    const target=args?.name;
    if(typeof target!=="string" || !target)throw new Error("MODEL_TOOL_NAME_REQUIRED");
    const command=target.toLowerCase();
    if(command==="rg/status" || target==="revitgpt_binding_status")
      return "CONTROL";
    if(command.startsWith("rg/")||RETIRED_READ_ONLY.has(target))return "READ_ONLY";
    const result=classifyModelOperation(target,args?.arguments??{});
    if(result)return result;
  }
  throw new Error("WORK_EFFECT_UNCLASSIFIED: "+String(name));
}

// Refuse hidden unclassified callback paths. All source-managed/development
// registrations and RevitGPT public tools must go through this wrapper.
export function wrapToolRegistration(server,{tracker,isAwake,reservationIdProvider=()=>null}){
  if(!server || typeof server.registerTool!=="function")
    throw new Error("TOOL_REGISTER_INVALID");
  if(tracker && typeof tracker.run!=="function")
    throw new Error("TOOL_TRACKER_INVALID");
  const raw=server.registerTool.bind(server);
  server.registerTool=(name,config,callback)=>{
    if(typeof callback!=="function")throw new Error("TOOL_CALLBACK_MISSING");
    // Registration inventory is static; the dynamic revitgpt_call is evaluated
    // again with actual tool name/payload on each invocation.
    if(name!=="revitgpt_call")effectForTool(name);
    return raw(name,config,async(args,...rest)=>{
      const effect=effectForTool(name,args);
      if(effect==="CONTROL")return callback(args,...rest);
      const reservedId=reservationIdProvider();
      // Runtime gate is per execution; no application-wide Job resume.
      if(!isAwake() && !reservedId)
        throw new Error("WORKSPACE_STANDBY: invoke @rg before business tools");
      if(!tracker)return callback(args,...rest);
      const tool=name==="revitgpt_call"?String(args.name):name;
      const inputs=name==="revitgpt_call"?args.arguments??{}:args??{};
      if(reservedId)return tracker.runAdmitted(reservedId,tool,effect,
        ()=>callback(args,...rest));
      return tracker.run(tool,effect,inputs,()=>callback(args,...rest));
    });
  };
  return server;
}
