import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  getAppDataRoot, allowedManagedRoots,
  pythonLibrariesRoot,dynamoLibrariesRoot,jobLibrariesRoot,
  registryCapabilitiesPath,registryLibrariesPath,
  pythonDraftRoot,dynamoDraftRoot,jobDraftRoot,runDataRoot
} from "./appdata.mjs";
import { logToolCall, logError } from "./log-store.mjs";

const execFileAsync=promisify(execFile);
const REPO_ROOT=path.resolve(process.cwd());
const SKILLS_ROOT=path.join(REPO_ROOT,"skills");

function sha256(v){return crypto.createHash("sha256").update(v).digest("hex");}
function inside(root,target){
  const r=path.resolve(root), t=path.resolve(target), rel=path.relative(r,t);
  return t===r || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}
function managedPath(input,write=false){
  const target=path.resolve(input);
  const roots=allowedManagedRoots();
  const candidates=write ? [roots.workspace,roots.data,roots.knowledge,roots.runtime] : Object.values(roots);
  if(!candidates.some(root=>inside(root,target))) throw new Error("PATH_OUTSIDE_MANAGED_ROOTS");
  return target;
}
async function readJson(file,fallback){
  try{return JSON.parse(await fs.readFile(file,"utf8"));}catch{return fallback;}
}
async function atomicWrite(file,content){
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temp=file+".tmp-"+process.pid+"-"+Date.now();
  await fs.writeFile(temp,content,"utf8");
  await fs.rename(temp,file);
}
async function registerEntry(entry){
  const p=registryCapabilitiesPath();
  const reg=await readJson(p,{version:1,entries:[]});
  reg.entries=(reg.entries||[]).filter(x=>x.id!==entry.id);
  reg.entries.push(entry);
  await atomicWrite(p,JSON.stringify(reg,null,2)+"\n");
}
async function registerLibrary(lib){
  const p=registryLibrariesPath();
  const reg=await readJson(p,{version:1,libraries:[]});
  reg.libraries=(reg.libraries||[]).filter(x=>x.id!==lib.id);
  reg.libraries.push(lib);
  await atomicWrite(p,JSON.stringify(reg,null,2)+"\n");
}
async function walk(root,limit=1000){
  const out=[];
  async function go(dir){
    if(out.length>=limit)return;
    let entries=[]; try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
    for(const e of entries){
      const p=path.join(dir,e.name);
      if(e.isDirectory()) await go(p); else out.push(p);
      if(out.length>=limit)return;
    }
  }
  await go(root); return out;
}
function textResult(obj){return {content:[{type:"text",text:typeof obj==="string"?obj:JSON.stringify(obj,null,2)}],structuredContent:typeof obj==="object"?obj:{text:obj}};}
async function guarded(name,args,fn){
  const started=Date.now();
  try{
    const value=await fn();
    await logToolCall({tool:name,ok:true,duration_ms:Date.now()-started,args_summary:Object.keys(args||{})});
    return value;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await logToolCall({tool:name,ok:false,duration_ms:Date.now()-started,error:message,args_summary:Object.keys(args||{})});
    await logError({source:"managed-tools",tool:name,error:message});
    throw error;
  }
}

export function registerManagedTools(server){
  server.registerTool("file_roots",{description:"Show RevitGPT managed AppData roots.",inputSchema:{}},async()=>guarded("file_roots",{},async()=>textResult({appdata_root:getAppDataRoot(),roots:allowedManagedRoots()})));

  server.registerTool("file_list",{description:"List files under one managed AppData root.",inputSchema:{root:z.string()}},async({root})=>guarded("file_list",{root},async()=>{
    const base=managedPath(root,false); const files=await walk(base);
    return textResult({root:base,files:files.map(p=>path.relative(base,p).replaceAll("\\","/"))});
  }));

  server.registerTool("file_read",{description:"Read a managed AppData text file with SHA-256.",inputSchema:{path:z.string()}},async(a=>guarded("file_read",a,async()=>{
    const p=managedPath(a.path,false), content=await fs.readFile(p,"utf8");
    return textResult({path:p,sha256:sha256(content),content});
  })));

  server.registerTool("file_search",{description:"Search managed AppData text files.",inputSchema:{root:z.string(),query:z.string().min(1)}},async(a=>guarded("file_search",a,async()=>{
    const base=managedPath(a.root,false), q=a.query.toLowerCase(), files=await walk(base), matches=[];
    for(const p of files){try{const c=await fs.readFile(p,"utf8"); if(c.toLowerCase().includes(q)) matches.push(path.relative(base,p).replaceAll("\\","/"));}catch{}}
    return textResult({root:base,query:a.query,matches});
  })));

  server.registerTool("file_create",{description:"Create a text file under workspace/data/knowledge/runtime.",inputSchema:{path:z.string(),content:z.string()}},async(a=>guarded("file_create",a,async()=>{
    const p=managedPath(a.path,true); try{await fs.access(p);throw new Error("FILE_ALREADY_EXISTS");}catch(e){if(e.message==="FILE_ALREADY_EXISTS")throw e;}
    await atomicWrite(p,a.content); return textResult({path:p,sha256:sha256(a.content)});
  })));

  server.registerTool("file_edit",{description:"Hash-guarded edit under workspace/data/knowledge/runtime.",inputSchema:{path:z.string(),expected_sha256:z.string(),content:z.string()}},async(a=>guarded("file_edit",a,async()=>{
    const p=managedPath(a.path,true), before=await fs.readFile(p,"utf8");
    if(sha256(before)!==a.expected_sha256) throw new Error("SHA256_MISMATCH");
    await atomicWrite(p,a.content); return textResult({path:p,sha256:sha256(a.content)});
  })));

  server.registerTool("library_list",{description:"List Python, Dynamo and Job libraries in RevitGPT AppData.",inputSchema:{}},async()=>guarded("library_list",{},async()=>{
    const reg=await readJson(registryLibrariesPath(),{version:1,libraries:[]});
    return textResult({roots:{python:pythonLibrariesRoot(),dynamo:dynamoLibrariesRoot(),jobs:jobLibrariesRoot()},libraries:reg.libraries||[]});
  }));

  server.registerTool("library_create",{description:"Create a user-owned Python, Dynamo or Job library.",inputSchema:{kind:z.enum(["python","dynamo","jobs"]),id:z.string().regex(/^[A-Za-z0-9._-]+$/)}},async(a=>guarded("library_create",a,async()=>{
    const roots={python:pythonLibrariesRoot(),dynamo:dynamoLibrariesRoot(),jobs:jobLibrariesRoot()};
    const root=roots[a.kind], target=path.join(root,a.id); await fs.mkdir(target,{recursive:true});
    const lib={id:a.id,kind:a.kind,path:target,created_at:new Date().toISOString()}; await registerLibrary(lib); return textResult(lib);
  })));

  server.registerTool("registry_list",{description:"List effective user capabilities registered in AppData.",inputSchema:{}},async()=>guarded("registry_list",{},async()=>textResult(await readJson(registryCapabilitiesPath(),{version:1,entries:[]}))));
  server.registerTool("registry_get",{description:"Get one user capability record.",inputSchema:{id:z.string()}},async(a=>guarded("registry_get",a,async()=>{
    const reg=await readJson(registryCapabilitiesPath(),{version:1,entries:[]}); const entry=(reg.entries||[]).find(x=>x.id===a.id);
    if(!entry)throw new Error("REGISTRY_ENTRY_NOT_FOUND"); return textResult(entry);
  })));

  server.registerTool("python_scaffold",{description:"Create a user Python/pyRevit draft in AppData workspace.",inputSchema:{library_id:z.string(),name:z.string().regex(/^[A-Za-z0-9._-]+$/),summary:z.string().optional()}},async(a=>guarded("python_scaffold",a,async()=>{
    const dir=path.join(pythonDraftRoot(),a.library_id); await fs.mkdir(dir,{recursive:true}); const p=path.join(dir,a.name.endsWith(".py")?a.name:a.name+".py");
    const content=`"""RevitGPT user Python capability: ${a.summary||a.name}.
Draft only. Promote after validation and real Revit test.
"""

`;
    try{await fs.writeFile(p,content,{encoding:"utf8",flag:"wx"});}catch(e){if(e.code==="EEXIST")throw new Error("DRAFT_ALREADY_EXISTS");throw e;}
    return textResult({draft_path:p,sha256:sha256(content),skill:"write-python"});
  })));

  server.registerTool("python_validate",{description:"Validate Python draft syntax using the RevitGPT Python runtime.",inputSchema:{path:z.string()}},async(a=>guarded("python_validate",a,async()=>{
    const p=path.resolve(a.path); if(!inside(pythonDraftRoot(),p)) throw new Error("PYTHON_DRAFT_PATH_REQUIRED");
    const python=process.env.REVIT_MCP_PYTHON||path.join(REPO_ROOT,"runtimes","Revit-mcp",".venv","Scripts","python.exe");
    const {stdout,stderr}=await execFileAsync(python,["-m","py_compile",p],{timeout:10000});
    return textResult({valid:true,path:p,stdout:String(stdout||""),stderr:String(stderr||""),sha256:sha256(await fs.readFile(p))});
  })));

  server.registerTool("python_promote_draft",{description:"Promote a validated Python draft into a managed library and User Registry.",inputSchema:{draft_path:z.string(),library_id:z.string(),relative_path:z.string(),id:z.string(),summary:z.string()}},async(a=>guarded("python_promote_draft",a,async()=>{
    const draft=path.resolve(a.draft_path); if(!inside(pythonDraftRoot(),draft)) throw new Error("PYTHON_DRAFT_PATH_REQUIRED");
    const target=path.resolve(pythonLibrariesRoot(),a.library_id,a.relative_path); if(!inside(path.join(pythonLibrariesRoot(),a.library_id),target))throw new Error("INVALID_LIBRARY_TARGET");
    const content=await fs.readFile(draft); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,content);
    const entry={id:a.id,kind:"python",library_id:a.library_id,relative_path:a.relative_path,path:target,summary:a.summary,sha256:sha256(content),status:"active",updated_at:new Date().toISOString()};
    await registerEntry(entry); return textResult(entry);
  })));

  server.registerTool("dynamo_register",{description:"Register a user-owned Dynamo .dyn already copied into a managed Dynamo library.",inputSchema:{library_id:z.string(),relative_path:z.string(),id:z.string(),summary:z.string()}},async(a=>guarded("dynamo_register",a,async()=>{
    const p=path.resolve(dynamoLibrariesRoot(),a.library_id,a.relative_path); if(!inside(path.join(dynamoLibrariesRoot(),a.library_id),p)||path.extname(p).toLowerCase()!==".dyn")throw new Error("MANAGED_DYN_PATH_REQUIRED");
    const bytes=await fs.readFile(p); const entry={id:a.id,kind:"dynamo",library_id:a.library_id,relative_path:a.relative_path,path:p,summary:a.summary,sha256:sha256(bytes),status:"active",updated_at:new Date().toISOString()};
    await registerEntry(entry); return textResult(entry);
  })));

  server.registerTool("job_list",{description:"List managed user Jobs.",inputSchema:{}},async()=>guarded("job_list",{},async()=>{
    const reg=await readJson(registryCapabilitiesPath(),{version:1,entries:[]}); return textResult({jobs:(reg.entries||[]).filter(x=>x.kind==="job")});
  })));
  server.registerTool("job_draft_new",{description:"Create a new reasoning (.md) or direct (.py) Job draft.",inputSchema:{library_id:z.string(),name:z.string().regex(/^[A-Za-z0-9._-]+$/),mode:z.enum(["reasoning","direct"]),goal:z.string()}},async(a=>guarded("job_draft_new",a,async()=>{
    const dir=path.join(jobDraftRoot(),a.library_id,a.name); await fs.mkdir(dir,{recursive:true});
    const p=path.join(dir,a.mode==="direct"?a.name+".py":"JOB.md");
    const content=a.mode==="direct"?`"""Direct RevitGPT Job: ${a.goal}"""
`:`# Job: ${a.name}\n\n## Goal\n${a.goal}\n\n## Preconditions\n\n## Steps\n\n## Final validation\n`;
    await fs.writeFile(p,content,{encoding:"utf8",flag:"wx"}); return textResult({draft_path:p,mode:a.mode,sha256:sha256(content),skill:"jobcreate"});
  })));
  server.registerTool("job_promote_draft",{description:"Promote a tested Job draft into managed Job Library and User Registry.",inputSchema:{draft_path:z.string(),library_id:z.string(),relative_path:z.string(),id:z.string(),title:z.string(),summary:z.string(),mode:z.enum(["reasoning","direct"])}},async(a=>guarded("job_promote_draft",a,async()=>{
    const draft=path.resolve(a.draft_path); if(!inside(jobDraftRoot(),draft))throw new Error("JOB_DRAFT_PATH_REQUIRED");
    const target=path.resolve(jobLibrariesRoot(),a.library_id,a.relative_path); if(!inside(path.join(jobLibrariesRoot(),a.library_id),target))throw new Error("INVALID_LIBRARY_TARGET");
    const content=await fs.readFile(draft); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,content);
    const entry={id:a.id,kind:"job",mode:a.mode,title:a.title,summary:a.summary,library_id:a.library_id,relative_path:a.relative_path,path:target,sha256:sha256(content),status:"active",updated_at:new Date().toISOString()};
    await registerEntry(entry); return textResult(entry);
  })));

  server.registerTool("skill_list",{description:"List internal RevitGPT skills.",inputSchema:{}},async()=>guarded("skill_list",{},async()=>{
    let ds=[];try{ds=await fs.readdir(SKILLS_ROOT,{withFileTypes:true});}catch{}
    return textResult({skills:ds.filter(d=>d.isDirectory()).map(d=>d.name)});
  })));
  server.registerTool("skill_get",{description:"Load one internal RevitGPT skill.",inputSchema:{name:z.string()}},async(a=>guarded("skill_get",a,async()=>{
    const p=path.resolve(SKILLS_ROOT,a.name,"SKILL.md"); if(!inside(SKILLS_ROOT,p))throw new Error("INVALID_SKILL");
    return textResult({name:a.name,content:await fs.readFile(p,"utf8")});
  })));

  server.registerTool("run_record_append",{description:"Append structured evidence for a user Job/script/MCP run.",inputSchema:{kind:z.string(),id:z.string(),record:z.record(z.string(),z.unknown())}},async(a=>guarded("run_record_append",a,async()=>{
    const p=path.join(runDataRoot(),a.kind,a.id+".ndjson"); await fs.mkdir(path.dirname(p),{recursive:true});
    await fs.appendFile(p,JSON.stringify({timestamp:new Date().toISOString(),...a.record})+"\n","utf8"); return textResult({path:p});
  })));

  server.registerTool("knowledge_failure_append",{description:"Append one real failure/workaround as raw improvement evidence in AppData knowledge/failures.",inputSchema:{title:z.string(),context:z.string(),observed:z.string(),expected:z.string(),evidence:z.string(),workaround:z.string().optional(),candidate_improvement:z.string().optional()}},async(a=>guarded("knowledge_failure_append",a,async()=>{
    const p=path.join(getAppDataRoot(),"knowledge","failures","ERROR_LOG.md");
    const block=`\n---\n\n## ${new Date().toISOString()} — ${a.title}\n\n**Context:** ${a.context}\n\n**Observed:** ${a.observed}\n\n**Expected:** ${a.expected}\n\n**Evidence:** ${a.evidence}\n\n**Workaround:** ${a.workaround||"None"}\n\n**Candidate improvement:** ${a.candidate_improvement||"Unclassified"}\n\n**Status:** OPEN\n`;
    await fs.mkdir(path.dirname(p),{recursive:true}); await fs.appendFile(p,block,"utf8"); return textResult({path:p});
  })));

  server.registerTool("knowledge_promote",{description:"Promote a stable lesson from failure evidence into AppData Working Knowledge. This does not mutate MCP source.",inputSchema:{title:z.string(),lesson:z.string(),evidence_ref:z.string()}},async(a=>guarded("knowledge_promote",a,async()=>{
    const p=path.join(getAppDataRoot(),"knowledge","revit","WORKING_KNOWLEDGE.md");
    const block=`\n## ${a.title}\n\n${a.lesson}\n\nEvidence: ${a.evidence_ref}\n`;
    await fs.mkdir(path.dirname(p),{recursive:true}); await fs.appendFile(p,block,"utf8"); return textResult({path:p});
  })));

  server.registerTool("job_get",{description:"Read one registered Job record and source.",inputSchema:{id:z.string()}},async(a=>guarded("job_get",a,async()=>{
    const reg=await readJson(registryCapabilitiesPath(),{version:1,entries:[]}); const entry=(reg.entries||[]).find(x=>x.id===a.id&&x.kind==="job");
    if(!entry)throw new Error("JOB_NOT_FOUND"); const source=await fs.readFile(entry.path,"utf8"); return textResult({entry,source,sha256:sha256(source)});
  })));

  server.registerTool("job_draft_validate",{description:"Validate a direct Python or reasoning Markdown Job draft structurally.",inputSchema:{path:z.string(),mode:z.enum(["reasoning","direct"])}},async(a=>guarded("job_draft_validate",a,async()=>{
    const p=path.resolve(a.path); if(!inside(jobDraftRoot(),p))throw new Error("JOB_DRAFT_PATH_REQUIRED");
    const source=await fs.readFile(p,"utf8");
    if(a.mode==="direct"){
      const python=process.env.REVIT_MCP_PYTHON||path.join(REPO_ROOT,"runtimes","Revit-mcp",".venv","Scripts","python.exe");
      await execFileAsync(python,["-m","py_compile",p],{timeout:10000});
    } else {
      for(const heading of ["## Goal","## Preconditions","## Steps","## Final validation"]) if(!source.includes(heading)) throw new Error("JOB_STRUCTURE_MISSING: "+heading);
    }
    return textResult({valid:true,path:p,mode:a.mode,sha256:sha256(source)});
  })));
}
