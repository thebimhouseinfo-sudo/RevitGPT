import path from "node:path";
import { modelAnchorsRoot } from "./appdata.mjs";

// The value must have been read from a bound RVT Project Information parameter.
// ID is generated once by RevitGPT: model-name snapshot + UTC timestamp + random hex.
// Caller-supplied titles, paths, and active-tab IDs are never accepted as identity.
const MODEL_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}_\d{8}T\d{9}Z_[0-9a-f]{8}$/;
const TOKEN=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export function modelAnchorRoot(modelId){
  if(typeof modelId!=="string"||!MODEL_ID.test(modelId))
    throw new Error("MODEL_ANCHOR_PERSISTENT_ID_REQUIRED");
  return path.join(modelAnchorsRoot(),modelId);
}
export function modelRunResultRoot(modelId,jobId,runId){
  if(typeof jobId!=="string"||!TOKEN.test(jobId)||jobId==="."||jobId===".." ||
     typeof runId!=="string"||!TOKEN.test(runId)||runId==="."||runId==="..")
    throw new Error("MODEL_RUN_INVALID_ID");
  return path.join(modelAnchorRoot(modelId),"jobs",jobId,"runs",runId,"results");
}
