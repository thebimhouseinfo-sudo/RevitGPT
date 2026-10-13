import fs from "node:fs/promises";
import path from "node:path";
import { logsRoot } from "./appdata.mjs";

async function append(name,event){
  const target=path.join(logsRoot(),name);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.appendFile(target,JSON.stringify({timestamp:new Date().toISOString(),...event})+"\n","utf8");
}

export const logControl=(event)=>append("control-plane.ndjson",event);
export const logToolCall=(event)=>append("tool-calls.ndjson",event);
export const logError=(event)=>append("errors.ndjson",event);
export const logBridge=(event)=>append("bridge.ndjson",event);
export const logRevitMcp=(event)=>append("revit-mcp.ndjson",event);
