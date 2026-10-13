import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registryCapabilitiesPath } from "./appdata.mjs";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const INTERNAL_FILE=path.join(ROOT,"runtimes","Revit-mcp","tool-manifest.json");
const ALLOWED_USER_KINDS=new Set(["job","python","dynamo"]);
const CAP=500;
const cleanText=v=>typeof v==="string"?v.trim():"";

export function mergeCapabilities(internal,user){
  if(!Array.isArray(internal)||!Array.isArray(user))throw new Error("REGISTRY_MALFORMED");
  const ids=new Set(), entries=[];
  for(const item of internal){
    if(!item||!cleanText(item.id)||ids.has(item.id))throw new Error("INTERNAL_REGISTRY_INVALID");
    ids.add(item.id);entries.push({...item,registry:"internal"});
  }
  for(const item of user){
    if(!item||!ALLOWED_USER_KINDS.has(item.kind)||!cleanText(item.id))continue;
    if(ids.has(item.id))throw new Error("USER_REGISTRY_INTERNAL_COLLISION: "+item.id);
    ids.add(item.id);
    entries.push({...item,registry:"user",
      semantic_status:item.semantic_status||"indexed",
      risk:item.risk||"unknown"});
    if(entries.length>CAP)throw new Error("REGISTRY_TOO_MANY_ENTRIES");
  }
  return entries;
}
export function filterCapabilities(entries,{kind,registry,query="",limit=25}={}){
  const term=cleanText(query).toLowerCase();
  const terms=term.split(/\s+/).filter(Boolean);
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error("REGISTRY_LIMIT_INVALID");
  return entries.filter(e=>(!kind||e.kind===kind) &&
    (!registry||e.registry===registry) &&
    terms.every(word=>{
      const hay=[e.id,e.title,e.summary,e.when_to_use,(e.tags||[]).join(" "),e.kind,e.class].join(" ").toLowerCase();
      return hay.includes(word);
    })).sort((a,b)=>{
      // Reviewed internal semantic entries before indexed user entries.
      const ra=a.semantic_status==="curated"?0:1,rb=b.semantic_status==="curated"?0:1;
      return ra-rb||a.id.localeCompare(b.id);
    }).slice(0,limit);
}
export async function effectiveRegistry({internalFile=INTERNAL_FILE,userFile=registryCapabilitiesPath()}={}){
  const internal=JSON.parse(await fs.readFile(internalFile,"utf8"));
  if(internal.version!==1||!Array.isArray(internal.entries))throw new Error("INTERNAL_REGISTRY_INVALID");
  let user={version:1,entries:[]};
  try{user=JSON.parse(await fs.readFile(userFile,"utf8"));}
  catch(e){if(e?.code!=="ENOENT")throw e;}
  if(user.version!==1||!Array.isArray(user.entries))throw new Error("USER_REGISTRY_MALFORMED");
  return mergeCapabilities(internal.entries,user.entries);
}
export async function lookupRegistry({kind,registry,query,limit=25,id}={}){
  const entries=await effectiveRegistry();
  if(id){
    const entry=entries.find(x=>x.id===id);
    if(!entry)throw new Error("REGISTRY_ENTRY_NOT_FOUND");
    return {version:1,entry};
  }
  const match=filterCapabilities(entries,{kind,registry,query,limit});
  return {version:1,total:entries.length,returned:match.length,entries:match,
    note:"Registry is discovery metadata only; availability and execution still require live MCP/native validation."};
}
