import fs from "node:fs/promises";
import path from "node:path";
import { modelRunResultRoot } from "./model-anchor-paths.mjs";

export function modelIdFromMcpResult(response){
  if(response?.isError)throw new Error("MODEL_ANCHOR_UPSTREAM_ERROR");
  let body=response?.structuredContent;
  if(!body){
    const text=response?.content?.find(item=>item?.type==="text")?.text;
    if(typeof text!=="string")throw new Error("MODEL_ANCHOR_RESPONSE_MISSING");
    try{body=JSON.parse(text);}catch{throw new Error("MODEL_ANCHOR_RESPONSE_INVALID_JSON");}
  }
  const data=body?.result?.data??body?.result??body?.data??body;
  if(!data?.valid || typeof data.model_id!=="string")
    throw new Error("MODEL_ANCHOR_MISSING_OR_INVALID");
  return data.model_id;
}

// Used only with the live, natively-bound revit_get_model_anchor result;
// no caller-provided title, file path, fake document GUID, or inferred model identity.
export async function beginModelRun({jobId,runId,readBoundModelAnchor}){
  if(typeof readBoundModelAnchor!=="function")throw new Error("BOUND_MODEL_ANCHOR_READER_REQUIRED");
  const response=await readBoundModelAnchor();
  const modelId=modelIdFromMcpResult(response);
  const results=modelRunResultRoot(modelId,jobId,runId);
  await fs.mkdir(path.dirname(results),{recursive:true});
  try{await fs.mkdir(results);}
  catch(e){if(e.code==="EEXIST")throw new Error("MODEL_RUN_RESULTS_ALREADY_EXIST");throw e;}
  return {model_id:modelId,job_id:jobId,run_id:runId,results_path:results};
}
