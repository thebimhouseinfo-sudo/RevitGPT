import path from "node:path";
import { modelAnchorsRoot } from "./appdata.mjs";

// The value must have been read from a bound RVT Project Information parameter.
// Titles, active-tab IDs and paths are never accepted as a storage key.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export function modelAnchorRoot(modelId){
  if(typeof modelId!=="string"||!UUID.test(modelId))
    throw new Error("MODEL_ANCHOR_PERSISTENT_UUID_REQUIRED");
  return path.join(modelAnchorsRoot(),modelId.toLowerCase());
}
export function modelRunResultRoot(modelId,jobId,runId){
  if(typeof jobId!=="string"||!TOKEN.test(jobId)||jobId==="."||jobId===".." ||
     typeof runId!=="string"||!TOKEN.test(runId)||runId==="."||runId==="..")
    throw new Error("MODEL_RUN_INVALID_ID");
  return path.join(modelAnchorRoot(modelId),"jobs",jobId,"runs",runId,"results");
}
