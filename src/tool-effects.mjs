import { classifyModelOperation } from "./model-authority.mjs";

const READ_ONLY = new Set([
  "file_roots", "file_list", "file_read", "file_search",
  "library_list", "registry_list", "registry_search", "registry_get",
  "job_list", "job_get", "skill_list", "skill_get", "knowledge_search",
  "revit_mcp_dev_root", "revit_mcp_dev_list", "revit_mcp_dev_read", "revit_mcp_dev_search",
  "revitgpt_command", "revitgpt_list_tools"
]);

const SYSTEM_SIDE_EFFECT = new Set([
  "file_create", "file_edit", "library_create", "asset_import",
  "asset_register_external", "asset_export", "python_checkout",
  "python_scaffold", "python_validate", "python_promote_draft",
  "dynamo_register", "job_draft_new", "job_draft_validate",
  "job_promote_draft", "run_record_append", "knowledge_failure_append",
  "knowledge_promote", "revit_mcp_dev_snapshot", "revit_mcp_dev_edit",
  "revit_mcp_dev_create", "revit_mcp_dev_delete", "revit_mcp_dev_rollback",
  "revit_mcp_dev_validate", "revit_mcp_dev_accept_local"
]);

const CONTROL = new Set([
  "revitgpt_admission", "revitgpt_status", "revitgpt_binding_status"
]);
const RETIRED_READ_ONLY = new Set(["revitgpt_pair_panel", "revitgpt_lease_bound_model"]);

export function effectForTool(name, args={}) {
  if(CONTROL.has(name))return "CONTROL";
  if(name==="revitgpt_command"){
    const command=String(args?.command??"").trim().toLowerCase();
    if(command==="rg/stop"||command==="rg/status")return "CONTROL";
    return "READ_ONLY";
  }
  if(READ_ONLY.has(name))return "READ_ONLY";
  if(SYSTEM_SIDE_EFFECT.has(name))return "SYSTEM_SIDE_EFFECT";
  if(name==="revitgpt_call"){
    const target=args?.name;
    if(typeof target!=="string" || !target)throw new Error("MODEL_TOOL_NAME_REQUIRED");
    const command=target.toLowerCase();
    if(command==="rg/stop" || command==="rg/status" || target==="revitgpt_binding_status")
      return "CONTROL";
    if(command.startsWith("rg/")||RETIRED_READ_ONLY.has(target))return "READ_ONLY";
    const result=classifyModelOperation(target,args?.arguments??{});
    if(result)return result;
  }
  throw new Error("WORK_EFFECT_UNCLASSIFIED: "+String(name));
}

// Refuse hidden unclassified callback paths. All source-managed/development
// registrations and RevitGPT public tools must go through this wrapper.
export function wrapToolRegistration(server,{tracker,isAwake}){
  if(!server || typeof server.registerTool!=="function")
    throw new Error("TOOL_REGISTER_INVALID");
  if(!tracker || typeof tracker.run!=="function")
    throw new Error("TOOL_TRACKER_REQUIRED");
  const raw=server.registerTool.bind(server);
  server.registerTool=(name,config,callback)=>{
    if(typeof callback!=="function")throw new Error("TOOL_CALLBACK_MISSING");
    // Registration inventory is static; the dynamic revitgpt_call is evaluated
    // again with actual tool name/payload on each invocation.
    if(name!=="revitgpt_call")effectForTool(name);
    return raw(name,config,async(args,...rest)=>{
      const effect=effectForTool(name,args);
      if(effect==="CONTROL")return callback(args,...rest);
      if(!isAwake())throw new Error("WORKSPACE_STANDBY: invoke @rg before business tools");
      return tracker.run(name==="revitgpt_call"?String(args.name):name,
        effect,name==="revitgpt_call"?args.arguments??{}:args??{},
        ()=>callback(args,...rest));
    });
  };
  return server;
}
