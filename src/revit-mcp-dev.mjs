import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { appDataPath } from "./appdata.mjs";
import { logToolCall, logError } from "./log-store.mjs";

const execFileAsync=promisify(execFile);
const REPO_ROOT=path.resolve(process.cwd());
const RUNTIME_ROOT=path.join(REPO_ROOT,"runtimes","Revit-mcp");
const SNAPSHOT_ROOT=appDataPath("state","revit-mcp-dev");

const hash=(v)=>crypto.createHash("sha256").update(v).digest("hex");
const inside=(root,target)=>{
  const r=path.resolve(root),t=path.resolve(target),rel=path.relative(r,t);
  return t===r || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
};
function runtimePath(input){
  const p=path.isAbsolute(input)?path.resolve(input):path.resolve(RUNTIME_ROOT,input);
  if(!inside(RUNTIME_ROOT,p)) throw new Error("REVIT_MCP_DEV_PATH_OUTSIDE_RUNTIME");
  return p;
}
async function walk(root){
  const out=[]; async function go(d){let es=[];try{es=await fs.readdir(d,{withFileTypes:true});}catch{return;}
    for(const e of es){if([".venv","__pycache__","bin","obj"].includes(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())await go(p);else out.push(p);}
  } await go(root); return out;
}
async function snapshotFiles(){
  const files=await walk(RUNTIME_ROOT), manifest=[];
  for(const p of files){const b=await fs.readFile(p);manifest.push({relative:path.relative(RUNTIME_ROOT,p).replaceAll("\\","/"),sha256:hash(b),base64:b.toString("base64")});}
  return manifest;
}
async function guarded(name,args,fn){const started=Date.now();try{const v=await fn();await logToolCall({tool:name,ok:true,duration_ms:Date.now()-started});return v;}catch(e){const m=e instanceof Error?e.message:String(e);await logToolCall({tool:name,ok:false,duration_ms:Date.now()-started,error:m});await logError({source:"revit-mcp-dev",tool:name,error:m});throw e;}}
const result=(o)=>({content:[{type:"text",text:JSON.stringify(o,null,2)}],structuredContent:o});

export function isDevMode(){return String(process.env.REVITGPT_DEV_MODE||"").toLowerCase()==="1" || String(process.env.REVITGPT_DEV_MODE||"").toLowerCase()==="true";}

export function registerRevitMcpDevTools(server){
  if(!isDevMode()) return;

  server.registerTool("revit_mcp_dev_root",{description:"Show the development-only Revit MCP source boundary.",inputSchema:{}},async()=>result({root:RUNTIME_ROOT,snapshot_root:SNAPSHOT_ROOT}));

  server.registerTool("revit_mcp_dev_list",{description:"List Revit MCP source files excluding generated/runtime artifacts.",inputSchema:{}},async()=>guarded("revit_mcp_dev_list",{},async()=>result({files:(await walk(RUNTIME_ROOT)).map(p=>path.relative(RUNTIME_ROOT,p).replaceAll("\\","/"))})));

  server.registerTool("revit_mcp_dev_read",{description:"Read one Revit MCP source file and return hash.",inputSchema:{path:z.string()}},async(a=>guarded("revit_mcp_dev_read",a,async()=>{const p=runtimePath(a.path),c=await fs.readFile(p,"utf8");return result({path:p,sha256:hash(c),content:c});})));

  server.registerTool("revit_mcp_dev_search",{description:"Search Revit MCP source.",inputSchema:{query:z.string().min(1)}},async(a=>guarded("revit_mcp_dev_search",a,async()=>{const q=a.query.toLowerCase(),matches=[];for(const p of await walk(RUNTIME_ROOT)){try{const c=await fs.readFile(p,"utf8");if(c.toLowerCase().includes(q))matches.push(path.relative(RUNTIME_ROOT,p).replaceAll("\\","/"));}catch{}}return result({query:a.query,matches});})));

  server.registerTool("revit_mcp_dev_snapshot",{description:"Create an immutable rollback baseline before any Revit MCP source mutation.",inputSchema:{execution_id:z.string().regex(/^[A-Za-z0-9._-]+$/)}},async(a=>guarded("revit_mcp_dev_snapshot",a,async()=>{await fs.mkdir(SNAPSHOT_ROOT,{recursive:true});const p=path.join(SNAPSHOT_ROOT,a.execution_id+".json");try{await fs.access(p);throw new Error("SNAPSHOT_ALREADY_EXISTS");}catch(e){if(e.message==="SNAPSHOT_ALREADY_EXISTS")throw e;}const snap={version:1,execution_id:a.execution_id,created_at:new Date().toISOString(),runtime_root:RUNTIME_ROOT,files:await snapshotFiles(),accepted:false};await fs.writeFile(p,JSON.stringify(snap,null,2),"utf8");return result({snapshot_path:p,file_count:snap.files.length});})));

  server.registerTool("revit_mcp_dev_edit",{description:"Hash-guarded edit inside runtimes/Revit-mcp after snapshot.",inputSchema:{execution_id:z.string(),path:z.string(),expected_sha256:z.string(),content:z.string()}},async(a=>guarded("revit_mcp_dev_edit",a,async()=>{const sp=path.join(SNAPSHOT_ROOT,a.execution_id+".json");await fs.access(sp);const p=runtimePath(a.path),before=await fs.readFile(p,"utf8");if(hash(before)!==a.expected_sha256)throw new Error("SHA256_MISMATCH");await fs.writeFile(p,a.content,"utf8");return result({path:p,sha256:hash(a.content)});})));

  server.registerTool("revit_mcp_dev_create",{description:"Create a new source file inside runtimes/Revit-mcp after snapshot.",inputSchema:{execution_id:z.string(),path:z.string(),content:z.string()}},async(a=>guarded("revit_mcp_dev_create",a,async()=>{await fs.access(path.join(SNAPSHOT_ROOT,a.execution_id+".json"));const p=runtimePath(a.path);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,a.content,{encoding:"utf8",flag:"wx"});return result({path:p,sha256:hash(a.content)});})));

  server.registerTool("revit_mcp_dev_delete",{description:"Hash-guarded delete inside runtimes/Revit-mcp after snapshot.",inputSchema:{execution_id:z.string(),path:z.string(),expected_sha256:z.string()}},async(a=>guarded("revit_mcp_dev_delete",a,async()=>{await fs.access(path.join(SNAPSHOT_ROOT,a.execution_id+".json"));const p=runtimePath(a.path),b=await fs.readFile(p);if(hash(b)!==a.expected_sha256)throw new Error("SHA256_MISMATCH");await fs.unlink(p);return result({deleted:p});})));

  server.registerTool("revit_mcp_dev_rollback",{description:"Restore the exact Revit MCP source snapshot for one dev execution.",inputSchema:{execution_id:z.string()}},async(a=>guarded("revit_mcp_dev_rollback",a,async()=>{const sp=path.join(SNAPSHOT_ROOT,a.execution_id+".json"),snap=JSON.parse(await fs.readFile(sp,"utf8"));const current=await walk(RUNTIME_ROOT);const wanted=new Set(snap.files.map(x=>path.resolve(RUNTIME_ROOT,x.relative)));for(const p of current){if(!wanted.has(path.resolve(p)))await fs.unlink(p).catch(()=>{});}for(const file of snap.files){const p=runtimePath(file.relative);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,Buffer.from(file.base64,"base64"));}return result({restored:true,file_count:snap.files.length});})));

  server.registerTool("revit_mcp_dev_validate",{description:"Compile/import/test the Revit MCP source candidate.",inputSchema:{execution_id:z.string()}},async(a=>guarded("revit_mcp_dev_validate",a,async()=>{await fs.access(path.join(SNAPSHOT_ROOT,a.execution_id+".json"));const python=process.env.REVIT_MCP_PYTHON||path.join(RUNTIME_ROOT,".venv","Scripts","python.exe");const checks=[];for(const [label,args,cwd] of [["compile",["-m","compileall","-q","."],RUNTIME_ROOT],["unit",["-m","unittest","discover","-s","tests","-p","test_bridge.py"],RUNTIME_ROOT]]){try{const {stdout,stderr}=await execFileAsync(python,args,{cwd,timeout:120000});checks.push({label,ok:true,stdout:String(stdout||""),stderr:String(stderr||"")});}catch(e){checks.push({label,ok:false,error:e.message,stdout:String(e.stdout||""),stderr:String(e.stderr||"")});break;}}return result({valid:checks.every(x=>x.ok),checks});})));

  server.registerTool("revit_mcp_dev_accept_local",{description:"Accept a validated local Revit MCP candidate and close its rollback baseline.",inputSchema:{execution_id:z.string()}},async(a=>guarded("revit_mcp_dev_accept_local",a,async()=>{const sp=path.join(SNAPSHOT_ROOT,a.execution_id+".json"),snap=JSON.parse(await fs.readFile(sp,"utf8"));snap.accepted=true;snap.accepted_at=new Date().toISOString();await fs.writeFile(sp,JSON.stringify(snap,null,2),"utf8");return result({accepted:true,snapshot_path:sp});})));
}
