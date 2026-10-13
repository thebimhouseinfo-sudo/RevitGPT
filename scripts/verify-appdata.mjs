import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root=path.join(os.tmpdir(),"revitgpt-appdata-contract-"+process.pid);
process.env.REVITGPT_APPDATA_ROOT=root;
process.env.REVITGPT_DEV_MODE="0";

const app=await import("../src/appdata.mjs");
const dev=await import("../src/revit-mcp-dev.mjs");

await app.ensureAppDataLayout();

const expected=[
  "libraries/python","libraries/dynamo","libraries/jobs",
  "registry/user",
  "workspace/python-draft","workspace/dynamo-draft","workspace/job-draft",
  "runtime/dynamic-python","data/runs",
  "knowledge/revit","knowledge/api","knowledge/failures","knowledge/learned",
  "logs","state"
];
for(const rel of expected){
  const st=await fs.stat(path.join(root,rel));
  if(!st.isDirectory()) throw new Error("Missing AppData directory: "+rel);
}
for(const rel of ["registry/user/capabilities.json","registry/user/libraries.json"]){
  const st=await fs.stat(path.join(root,rel));
  if(!st.isFile()) throw new Error("Missing AppData file: "+rel);
}
if(dev.isDevMode()) throw new Error("revit-mcp-dev must be disabled by default");
console.log("RevitGPT AppData contract PASS");
await fs.rm(root,{recursive:true,force:true});
