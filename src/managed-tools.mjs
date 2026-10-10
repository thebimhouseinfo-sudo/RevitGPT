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
import { lookupRegistry } from "./capability-registry.mjs";

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


function acceptedAsset(kind,file){
  const ext=path.extname(file).toLowerCase();
  if(kind==="python") return ext===".py";
  if(kind==="dynamo") return ext===".dyn";
  return ext===".md" || ext===".py";
}
async function safeWalkAssets(root,kind,out=[]){
  const entries=await fs.readdir(root,{withFileTypes:true});
  for(const entry of entries){
    if(entry.name===".git"||entry.name===".svn"||entry.name.startsWith(".")) continue;
    const full=path.join(root,entry.name), stat=await fs.lstat(full);
    if(stat.isSymbolicLink()) throw new Error("ASSET_SOURCE_SYMLINK_REJECTED: "+full);
    if(stat.isDirectory()) await safeWalkAssets(full,kind,out);
    else if(stat.isFile()&&acceptedAsset(kind,full)) out.push(full);
    if(out.length>10000) throw new Error("ASSET_IMPORT_TOO_MANY_FILES");
  }
  return out;
}
function assetSlug(v){return v.toLowerCase().replaceAll("\\","/").replace(/\.[^.]+$/,"").replace(/[^a-z0-9]+/g,".").replace(/^\.+|\.+$/g,"")||"asset";}
async function discoverAssets(kind,libraryId,root){
  const files=(await safeWalkAssets(root,kind)).sort(), result=[]; let bytes=0;
  for(const file of files){
    const content=await fs.readFile(file); bytes+=content.length;
    if(bytes>256*1024*1024) throw new Error("ASSET_IMPORT_TOO_LARGE");
    const relative=path.relative(root,file).replaceAll("\\","/");
    let title=path.basename(file,path.extname(file));
    if(kind==="jobs"&&path.extname(file).toLowerCase()===".md"){
      try{const text=content.toString("utf8");title=text.match(/^#\s+(?:Job:\s*)?(.+)$/mi)?.[1]?.trim()||title;}catch{}
    }
    result.push({
      id:libraryId+"."+kind+"."+assetSlug(relative),
      kind:kind==="jobs"?"job":kind,
      registry:"user",
      library_id:libraryId,
      relative_path:relative,
      title,
      summary:"Imported user capability; semantic/runtime behavior requires review before trusted use.",
      semantic_status:"indexed",
      risk:"unknown",
      implementation_sha256:sha256(content)
    });
  }
  return result;
}
async function replaceLibraryRegistry(kind,libraryId,entries){
  const p=registryCapabilitiesPath(), reg=await readJson(p,{version:1,entries:[]});
  const normalizedKind=kind==="jobs"?"job":kind;
  reg.entries=(reg.entries||[]).filter(x=>!(x.kind===normalizedKind&&x.library_id===libraryId));
  reg.entries.push(...entries);
  reg.entries.sort((a,b)=>String(a.id||"").localeCompare(String(b.id||"")));
  await atomicWrite(p,JSON.stringify(reg,null,2)+"\n");
}

export function registerManagedTools(server){
  server.registerTool("file_roots",{description:"Show RevitGPT managed AppData roots.",inputSchema:{}},async()=>guarded("file_roots",{},async()=>textResult({appdata_root:getAppDataRoot(),roots:allowedManagedRoots()})));

  server.registerTool("file_list",{description:"List files under one managed AppData root.",inputSchema:{root:z.string()}},async({root})=>guarded("file_list",{root},async()=>{
    const base=managedPath(root,false); const files=await walk(base);
    return textResult({root:base,files:files.map(p=>path.relative(base,p).replaceAll("\\","/"))});
  }));

  server.registerTool("file_read",{description:"Read a managed AppData text file with SHA-256.",inputSchema:{path:z.string()}},async (a)=>guarded("file_read",a,async()=>{
    const p=managedPath(a.path,false), content=await fs.readFile(p,"utf8");
    return textResult({path:p,sha256:sha256(content),content});
  }));

  server.registerTool("file_search",{description:"Search managed AppData text files.",inputSchema:{root:z.string(),query:z.string().min(1)}},async (a)=>guarded("file_search",a,async()=>{
    const base=managedPath(a.root,false), q=a.query.toLowerCase(), files=await walk(base), matches=[];
    for(const p of files){try{const c=await fs.readFile(p,"utf8"); if(c.toLowerCase().includes(q)) matches.push(path.relative(base,p).replaceAll("\\","/"));}catch{}}
    return textResult({root:base,query:a.query,matches});
  }));

  server.registerTool("file_create",{description:"Create a text file under workspace/data/knowledge/runtime.",inputSchema:{path:z.string(),content:z.string()}},async (a)=>guarded("file_create",a,async()=>{
    const p=managedPath(a.path,true); try{await fs.access(p);throw new Error("FILE_ALREADY_EXISTS");}catch(e){if(e.message==="FILE_ALREADY_EXISTS")throw e;}
    await atomicWrite(p,a.content); return textResult({path:p,sha256:sha256(a.content)});
  }));

  server.registerTool("file_edit",{description:"Hash-guarded edit under workspace/data/knowledge/runtime.",inputSchema:{path:z.string(),expected_sha256:z.string(),content:z.string()}},async (a)=>guarded("file_edit",a,async()=>{
    const p=managedPath(a.path,true), before=await fs.readFile(p,"utf8");
    if(sha256(before)!==a.expected_sha256) throw new Error("SHA256_MISMATCH");
    await atomicWrite(p,a.content); return textResult({path:p,sha256:sha256(a.content)});
  }));

  server.registerTool("library_list",{description:"List Python, Dynamo and Job libraries in RevitGPT AppData.",inputSchema:{}},async()=>guarded("library_list",{},async()=>{
    const reg=await readJson(registryLibrariesPath(),{version:1,libraries:[]});
    return textResult({roots:{python:pythonLibrariesRoot(),dynamo:dynamoLibrariesRoot(),jobs:jobLibrariesRoot()},libraries:reg.libraries||[]});
  }));

  server.registerTool("library_create",{description:"Create a user-owned Python, Dynamo or Job library.",inputSchema:{kind:z.enum(["python","dynamo","jobs"]),id:z.string().regex(/^[A-Za-z0-9._-]+$/)}},async (a)=>guarded("library_create",a,async()=>{
    const roots={python:pythonLibrariesRoot(),dynamo:dynamoLibrariesRoot(),jobs:jobLibrariesRoot()};
    const root=roots[a.kind], target=path.join(root,a.id); await fs.mkdir(target,{recursive:true});
    const lib={id:a.id,kind:a.kind,path:target,created_at:new Date().toISOString()}; await registerLibrary(lib); return textResult(lib);
  }));


  server.registerTool("asset_import",{description:"Copy an explicitly user-approved Python, Dynamo or Job folder into managed RevitGPT AppData and index User Registry.",inputSchema:{kind:z.enum(["python","dynamo","jobs"]),library_id:z.string().regex(/^[A-Za-z0-9._-]+$/),name:z.string(),source_path:z.string(),user_approved_source:z.literal(true),replace_existing:z.boolean().optional().default(false)}},async (a)=>guarded("asset_import",a,async()=>{
    if(!path.isAbsolute(a.source_path)) throw new Error("ABSOLUTE_SOURCE_PATH_REQUIRED");
    const source=await fs.realpath(a.source_path), stat=await fs.stat(source); if(!stat.isDirectory())throw new Error("SOURCE_DIRECTORY_REQUIRED");
    const roots={python:pythonLibrariesRoot(),dynamo:dynamoLibrariesRoot(),jobs:jobLibrariesRoot()}, target=path.join(roots[a.kind],a.library_id);
    await safeWalkAssets(source,a.kind);
    let exists=true;try{await fs.stat(target);}catch{exists=false;}
    if(exists&&!a.replace_existing)throw new Error("MANAGED_LIBRARY_EXISTS");
    const staging=target+".importing-"+process.pid; await fs.rm(staging,{recursive:true,force:true});
    await fs.cp(source,staging,{recursive:true,filter:(item)=>![".git",".svn"].includes(path.basename(item))});
    if(exists)await fs.rm(target,{recursive:true,force:true}); await fs.rename(staging,target);
    const entries=await discoverAssets(a.kind,a.library_id,target);
    await registerLibrary({id:a.library_id,kind:a.kind,name:a.name,mode:"managed",managed_path:target,enabled:true,origin:"imported",imported_from:source,imported_at:new Date().toISOString()});
    await replaceLibraryRegistry(a.kind,a.library_id,entries);
    return textResult({library_id:a.library_id,kind:a.kind,managed_path:target,registered:entries.length});
  }));

  server.registerTool("asset_register_external",{description:"Register/index an explicitly approved EXTERNAL Python or Dynamo folder. Custom Jobs must be imported/copied into Local AppData with asset_import.",inputSchema:{kind:z.enum(["python","dynamo","jobs"]),library_id:z.string().regex(/^[A-Za-z0-9._-]+$/),name:z.string(),source_path:z.string(),user_approved_source:z.literal(true)}},async (a)=>guarded("asset_register_external",a,async()=>{
    if(a.kind==="jobs")throw new Error("CUSTOM_JOBS_MUST_USE_LOCAL_APPDATA: use asset_import instead");
    if(!path.isAbsolute(a.source_path))throw new Error("ABSOLUTE_SOURCE_PATH_REQUIRED");
    const source=await fs.realpath(a.source_path),stat=await fs.stat(source);if(!stat.isDirectory())throw new Error("SOURCE_DIRECTORY_REQUIRED");
    const entries=await discoverAssets(a.kind,a.library_id,source);
    await registerLibrary({id:a.library_id,kind:a.kind,name:a.name,mode:"external",root_path:source,enabled:true,source_access:"read-only"});
    await replaceLibraryRegistry(a.kind,a.library_id,entries);
    return textResult({library_id:a.library_id,kind:a.kind,root_path:source,registered:entries.length});
  }));

  server.registerTool("asset_export",{description:"Export one managed AppData Python, Dynamo or Job library to a user-selected absolute folder.",inputSchema:{kind:z.enum(["python","dynamo","jobs"]),library_id:z.string(),destination_path:z.string(),overwrite:z.boolean().optional().default(false)}},async (a)=>guarded("asset_export",a,async()=>{
    if(!path.isAbsolute(a.destination_path))throw new Error("ABSOLUTE_DESTINATION_PATH_REQUIRED");
    const manifest=await readJson(registryLibrariesPath(),{version:1,libraries:[]});
    const rec=(manifest.libraries||[]).find(x=>x.id===a.library_id&&x.kind===a.kind&&x.enabled!==false);if(!rec)throw new Error("LIBRARY_NOT_FOUND");
    if(rec.mode==="external")throw new Error("EXTERNAL_LIBRARY_EXPORT_NOT_REQUIRED");
    const roots={python:pythonLibrariesRoot(),dynamo:dynamoLibrariesRoot(),jobs:jobLibrariesRoot()},source=await fs.realpath(path.join(roots[a.kind],a.library_id)),dest=path.resolve(a.destination_path);
    if(inside(source,dest)||inside(dest,source))throw new Error("EXPORT_PATH_OVERLAPS_SOURCE");
    await fs.mkdir(dest,{recursive:true});await fs.cp(source,dest,{recursive:true,force:a.overwrite,errorOnExist:!a.overwrite});
    return textResult({exported:true,library_id:a.library_id,destination_path:dest});
  }));

  server.registerTool("python_checkout",{description:"Copy a registered managed Python capability into workspace/python-draft for controlled refinement.",inputSchema:{id:z.string(),overwrite_existing:z.boolean().optional().default(false)}},async (a)=>guarded("python_checkout",a,async()=>{
    const reg=await readJson(registryCapabilitiesPath(),{version:1,entries:[]}),entry=(reg.entries||[]).find(x=>x.id===a.id&&x.kind==="python");if(!entry)throw new Error("PYTHON_CAPABILITY_NOT_FOUND");
    const source=entry.path || (entry.library_id&&entry.relative_path?path.join(pythonLibrariesRoot(),entry.library_id,entry.relative_path):null);if(!source)throw new Error("PYTHON_SOURCE_UNRESOLVED");
    const target=path.join(pythonDraftRoot(),entry.library_id||"imported",entry.relative_path||path.basename(source));await fs.mkdir(path.dirname(target),{recursive:true});
    let exists=true;try{await fs.stat(target);}catch{exists=false;}if(exists&&!a.overwrite_existing)throw new Error("DRAFT_ALREADY_EXISTS");
    await fs.copyFile(source,target);const content=await fs.readFile(target);return textResult({draft_path:target,sha256:sha256(content),source_id:a.id});
  }));

  // Effective Internal + User Registry is discovery-only; no execution is
  // ever authorized by metadata. User entries cannot override internal IDs.
  server.registerTool("registry_list",{
    description:"List tool/Job/Python/Dynamo capabilities from Internal + User Registry. Discovery only.",
    inputSchema:{kind:z.enum(["tool","job","python","dynamo"]).optional(),registry:z.enum(["internal","user"]).optional(),limit:z.number().int().min(1).max(100).optional()}
  },async(a)=>guarded("registry_list",a,async()=>textResult(await lookupRegistry(a))));
  server.registerTool("registry_search",{
    description:"Search semantic registry summaries and when_to_use to select the appropriate read, UI or write tool on the bound model, or a registered Job/Dynamo script. Does NOT execute.",
    inputSchema:{query:z.string().min(1),kind:z.enum(["tool","job","python","dynamo"]).optional(),limit:z.number().int().min(1).max(100).optional()}
  },async(a)=>guarded("registry_search",a,async()=>textResult(await lookupRegistry(a))));
  server.registerTool("registry_get",{
    description:"Get one effective registry entry, including when_to_use/risk/status. Discovery only.",
    inputSchema:{id:z.string().min(1)}
  },async(a)=>guarded("registry_get",a,async()=>textResult(await lookupRegistry(a))));

  server.registerTool("python_scaffold",{description:"Create a user Python/pyRevit draft in AppData workspace.",inputSchema:{library_id:z.string(),name:z.string().regex(/^[A-Za-z0-9._-]+$/),summary:z.string().optional()}},async (a)=>guarded("python_scaffold",a,async()=>{
    const dir=path.join(pythonDraftRoot(),a.library_id); await fs.mkdir(dir,{recursive:true}); const p=path.join(dir,a.name.endsWith(".py")?a.name:a.name+".py");
    const content=`"""RevitGPT user Python capability: ${a.summary||a.name}.
Draft only. Promote after validation and real Revit test.
"""

`;
    try{await fs.writeFile(p,content,{encoding:"utf8",flag:"wx"});}catch(e){if(e.code==="EEXIST")throw new Error("DRAFT_ALREADY_EXISTS");throw e;}
    return textResult({draft_path:p,sha256:sha256(content),skill:"write-python"});
  }));

  server.registerTool("python_validate",{description:"Validate Python draft syntax using the RevitGPT Python runtime.",inputSchema:{path:z.string()}},async (a)=>guarded("python_validate",a,async()=>{
    const p=path.resolve(a.path); if(!inside(pythonDraftRoot(),p)) throw new Error("PYTHON_DRAFT_PATH_REQUIRED");
    const python=process.env.REVIT_MCP_PYTHON||path.join(REPO_ROOT,"runtimes","Revit-mcp",".venv","Scripts","python.exe");
    const {stdout,stderr}=await execFileAsync(python,["-m","py_compile",p],{timeout:10000});
    return textResult({valid:true,path:p,stdout:String(stdout||""),stderr:String(stderr||""),sha256:sha256(await fs.readFile(p))});
  }));

  server.registerTool("python_promote_draft",{description:"Promote a validated Python draft into a managed library and User Registry.",inputSchema:{draft_path:z.string(),library_id:z.string(),relative_path:z.string(),id:z.string(),summary:z.string()}},async (a)=>guarded("python_promote_draft",a,async()=>{
    const draft=path.resolve(a.draft_path); if(!inside(pythonDraftRoot(),draft)) throw new Error("PYTHON_DRAFT_PATH_REQUIRED");
    const target=path.resolve(pythonLibrariesRoot(),a.library_id,a.relative_path); if(!inside(path.join(pythonLibrariesRoot(),a.library_id),target))throw new Error("INVALID_LIBRARY_TARGET");
    const content=await fs.readFile(draft); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,content);
    const entry={id:a.id,kind:"python",library_id:a.library_id,relative_path:a.relative_path,path:target,summary:a.summary,sha256:sha256(content),status:"active",updated_at:new Date().toISOString()};
    await registerEntry(entry); return textResult(entry);
  }));

  server.registerTool("dynamo_register",{description:"Register a user-owned Dynamo .dyn already copied into a managed Dynamo library.",inputSchema:{library_id:z.string(),relative_path:z.string(),id:z.string(),summary:z.string()}},async (a)=>guarded("dynamo_register",a,async()=>{
    const p=path.resolve(dynamoLibrariesRoot(),a.library_id,a.relative_path); if(!inside(path.join(dynamoLibrariesRoot(),a.library_id),p)||path.extname(p).toLowerCase()!==".dyn")throw new Error("MANAGED_DYN_PATH_REQUIRED");
    const bytes=await fs.readFile(p); const entry={id:a.id,kind:"dynamo",library_id:a.library_id,relative_path:a.relative_path,path:p,summary:a.summary,sha256:sha256(bytes),status:"active",updated_at:new Date().toISOString()};
    await registerEntry(entry); return textResult(entry);
  }));

  server.registerTool("job_list",{description:"List managed user Jobs.",inputSchema:{}},async()=>guarded("job_list",{},async()=>{
    const reg=await readJson(registryCapabilitiesPath(),{version:1,entries:[]}); return textResult({jobs:(reg.entries||[]).filter(x=>x.kind==="job")});
  }));
  server.registerTool("job_draft_new",{description:"Create a new reasoning (.md) or direct (.py) Job draft.",inputSchema:{library_id:z.string(),name:z.string().regex(/^[A-Za-z0-9._-]+$/),mode:z.enum(["reasoning","direct"]),goal:z.string()}},async (a)=>guarded("job_draft_new",a,async()=>{
    const dir=path.join(jobDraftRoot(),a.library_id,a.name); await fs.mkdir(dir,{recursive:true});
    const p=path.join(dir,a.mode==="direct"?a.name+".py":"JOB.md");
    const content=a.mode==="direct"?`"""Direct RevitGPT Job: ${a.goal}"""
`:`# Job: ${a.name}\n\n## Goal\n${a.goal}\n\n## Preconditions\n\n## Steps\n\n## Final validation\n`;
    await fs.writeFile(p,content,{encoding:"utf8",flag:"wx"}); return textResult({draft_path:p,mode:a.mode,sha256:sha256(content),skill:"jobcreate"});
  }));
  server.registerTool("job_promote_draft",{description:"Promote a tested Job draft into managed Job Library and User Registry.",inputSchema:{draft_path:z.string(),library_id:z.string(),relative_path:z.string(),id:z.string(),title:z.string(),summary:z.string(),mode:z.enum(["reasoning","direct"])}},async (a)=>guarded("job_promote_draft",a,async()=>{
    const draft=path.resolve(a.draft_path); if(!inside(jobDraftRoot(),draft))throw new Error("JOB_DRAFT_PATH_REQUIRED");
    const target=path.resolve(jobLibrariesRoot(),a.library_id,a.relative_path); if(!inside(path.join(jobLibrariesRoot(),a.library_id),target))throw new Error("INVALID_LIBRARY_TARGET");
    const content=await fs.readFile(draft); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,content);
    const entry={id:a.id,kind:"job",mode:a.mode,title:a.title,summary:a.summary,library_id:a.library_id,relative_path:a.relative_path,path:target,sha256:sha256(content),status:"active",updated_at:new Date().toISOString()};
    await registerEntry(entry); return textResult(entry);
  }));

  server.registerTool("skill_list",{description:"List internal RevitGPT skills.",inputSchema:{}},async()=>guarded("skill_list",{},async()=>{
    let ds=[];try{ds=await fs.readdir(SKILLS_ROOT,{withFileTypes:true});}catch{}
    return textResult({skills:ds.filter(d=>d.isDirectory()).map(d=>d.name)});
  }));
  server.registerTool("skill_get",{description:"Load one internal RevitGPT skill.",inputSchema:{name:z.string()}},async (a)=>guarded("skill_get",a,async()=>{
    const p=path.resolve(SKILLS_ROOT,a.name,"SKILL.md"); if(!inside(SKILLS_ROOT,p))throw new Error("INVALID_SKILL");
    return textResult({name:a.name,content:await fs.readFile(p,"utf8")});
  }));

  server.registerTool("run_record_append",{description:"Append structured evidence for a user Job/script/MCP run.",inputSchema:{kind:z.string(),id:z.string(),record:z.record(z.string(),z.unknown())}},async (a)=>guarded("run_record_append",a,async()=>{
    const p=path.join(runDataRoot(),a.kind,a.id+".ndjson"); await fs.mkdir(path.dirname(p),{recursive:true});
    await fs.appendFile(p,JSON.stringify({timestamp:new Date().toISOString(),...a.record})+"\n","utf8"); return textResult({path:p});
  }));


  server.registerTool("knowledge_search",{
    description:"Read-only keyword search over curated local RevitGPT knowledge (HVAC, Revit API, learned lessons). Results are evidence, not model facts.",
    inputSchema:{query:z.string().min(2),limit:z.number().int().min(1).max(20).optional()}
  },async(a)=>guarded("knowledge_search",a,async()=>{
    const root=path.join(getAppDataRoot(),"knowledge");
    const files=await walk(root,250), term=a.query.toLowerCase(),hits=[];
    for(const file of files){
      if(!file.endsWith(".md"))continue;
      try{
        const stat=await fs.lstat(file); if(!stat.isFile() || stat.isSymbolicLink() || stat.size>128*1024)continue;
        const content=await fs.readFile(file,"utf8"),at=content.toLowerCase().indexOf(term);
        if(at<0)continue;
        hits.push({source:path.relative(root,file).replaceAll("\\","/"),
          sha256:sha256(content),
          excerpt:content.slice(Math.max(0,at-100),Math.min(content.length,at+280))});
        if(hits.length>=(a.limit||8))break;
      }catch{}
    }
    return textResult({query:a.query,matches:hits,rule:"Knowledge is advisory; verify element counts/classification against live bound Revit model."});
  }));

  server.registerTool("knowledge_failure_append",{description:"Append one real failure/workaround as raw improvement evidence in AppData knowledge/failures.",inputSchema:{title:z.string(),context:z.string(),observed:z.string(),expected:z.string(),evidence:z.string(),workaround:z.string().optional(),candidate_improvement:z.string().optional()}},async (a)=>guarded("knowledge_failure_append",a,async()=>{
    const p=path.join(getAppDataRoot(),"knowledge","failures","ERROR_LOG.md");
    const block=`\n---\n\n## ${new Date().toISOString()} — ${a.title}\n\n**Context:** ${a.context}\n\n**Observed:** ${a.observed}\n\n**Expected:** ${a.expected}\n\n**Evidence:** ${a.evidence}\n\n**Workaround:** ${a.workaround||"None"}\n\n**Candidate improvement:** ${a.candidate_improvement||"Unclassified"}\n\n**Status:** OPEN\n`;
    await fs.mkdir(path.dirname(p),{recursive:true}); await fs.appendFile(p,block,"utf8"); return textResult({path:p});
  }));

  server.registerTool("knowledge_promote",{description:"Promote a stable lesson from failure evidence into AppData Working Knowledge. This does not mutate MCP source.",inputSchema:{title:z.string(),lesson:z.string(),evidence_ref:z.string()}},async (a)=>guarded("knowledge_promote",a,async()=>{
    const p=path.join(getAppDataRoot(),"knowledge","revit","WORKING_KNOWLEDGE.md");
    const block=`\n## ${a.title}\n\n${a.lesson}\n\nEvidence: ${a.evidence_ref}\n`;
    await fs.mkdir(path.dirname(p),{recursive:true}); await fs.appendFile(p,block,"utf8"); return textResult({path:p});
  }));

  server.registerTool("job_get",{description:"Read one registered Job record and source.",inputSchema:{id:z.string()}},async (a)=>guarded("job_get",a,async()=>{
    const reg=await readJson(registryCapabilitiesPath(),{version:1,entries:[]}); const entry=(reg.entries||[]).find(x=>x.id===a.id&&x.kind==="job");
    if(!entry)throw new Error("JOB_NOT_FOUND");
    const p=entry.path || (entry.library_id&&entry.relative_path?path.resolve(jobLibrariesRoot(),entry.library_id,entry.relative_path):null);
    if(!p||!inside(jobLibrariesRoot(),p))throw new Error("CUSTOM_JOB_OUTSIDE_LOCAL_APPDATA");
    const stat=await fs.lstat(p);if(!stat.isFile()||stat.isSymbolicLink())throw new Error("CUSTOM_JOB_INVALID_FILE");
    // Windows temp/AppData paths may contain junctions, 8.3 aliases or case
    // normalization. Compare two canonical paths, not realpath versus raw.
    const [rootReal,real]=await Promise.all([fs.realpath(jobLibrariesRoot()),fs.realpath(p)]);
    if(!inside(rootReal,real))throw new Error("CUSTOM_JOB_OUTSIDE_LOCAL_APPDATA");
    const source=await fs.readFile(real,"utf8"); return textResult({entry,source,sha256:sha256(source)});
  }));

  server.registerTool("job_draft_validate",{description:"Validate a direct Python or reasoning Markdown Job draft structurally.",inputSchema:{path:z.string(),mode:z.enum(["reasoning","direct"])}},async (a)=>guarded("job_draft_validate",a,async()=>{
    const p=path.resolve(a.path); if(!inside(jobDraftRoot(),p))throw new Error("JOB_DRAFT_PATH_REQUIRED");
    const source=await fs.readFile(p,"utf8");
    if(a.mode==="direct"){
      const python=process.env.REVIT_MCP_PYTHON||path.join(REPO_ROOT,"runtimes","Revit-mcp",".venv","Scripts","python.exe");
      await execFileAsync(python,["-m","py_compile",p],{timeout:10000});
    } else {
      for(const heading of ["## Goal","## Preconditions","## Steps","## Final validation"]) if(!source.includes(heading)) throw new Error("JOB_STRUCTURE_MISSING: "+heading);
    }
    return textResult({valid:true,path:p,mode:a.mode,sha256:sha256(source)});
  }));
}
