import fs from "node:fs/promises";
import path from "node:path";
import { lookupRegistry } from "./capability-registry.mjs";
import { knowledgeRoot } from "./appdata.mjs";

const MENU=[
"RG / RevitGPT commands (discovery only; Revit work uses natural language)",
"rg/          — command menu",
"rg/status    — show current native binding",
"rg/tools X   — search MCP tools and when_to_use",
"rg/job X     — search registered Jobs",
"rg/dynamo X  — search registered Dynamo scripts",
"rg/knowledge X — search BIM/Revit knowledge",
"rg/help      — help"
].join("\n");

export function parseRevitCommand(command) {
  if(typeof command!=="string")return null;
  const input=command.trim();
  const match=/^rg\/(help|status|tools|job|dynamo|knowledge)?(?:\s+([^\r\n]{1,120}))?$/i.exec(input);
  if(!match)return null;
  const kind=(match[1]||"").toLowerCase();
  const query=(match[2]||"").trim();
  // CLI arguments are search terms only, never local paths or shell syntax.
  if(query.includes("..") || /[\\/;|`]/.test(query)) return null;
  if((kind===""||kind==="help"||kind==="status")&&query)
    throw new Error("RG_COMMAND_ARGUMENTS_INVALID");
  return {kind:kind||"help",query};
}
const output=data=>({
  content:[{type:"text",text:typeof data==="string"?data:JSON.stringify(data)}],
  structuredContent:typeof data==="string"?{text:data}:data
});
async function searchKnowledge(query){
  const root=knowledgeRoot();
  const groups=["revit","api","learned"];
  const found=[];const term=query.toLowerCase();
  for(const group of groups){
    let names=[];
    try{names=await fs.readdir(path.join(root,group));}
    catch(e){if(e?.code!=="ENOENT")throw e;}
    for(const name of names.slice(0,100)){
      if(!/^[A-Za-z0-9_.-]+\.md$/.test(name))continue;
      const file=path.join(root,group,name);
      let stat;try{stat=await fs.lstat(file);}catch{continue;}
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)continue;
      const body=await fs.readFile(file,"utf8");
      const pos=term?body.toLowerCase().indexOf(term):0;
      if(pos<0)continue;
      found.push({source:group+"/"+name,
        excerpt:body.slice(Math.max(0,pos-80),Math.min(body.length,pos+260))});
      if(found.length>=10)return found;
    }
  }
  return found;
}
export async function executeRevitCommand(command,{
  bindingReader,registryReader=lookupRegistry,knowledgeReader=searchKnowledge
}={}) {
  const parsed=parseRevitCommand(command);
  if(!parsed)return null; // normal upstream MCP tool dispatch must remain independent
  if(parsed.kind==="help")return output(MENU);
  if(parsed.kind==="status"){
    if(typeof bindingReader!=="function")throw new Error("RG_BINDING_READER_REQUIRED");
    const native=await bindingReader();
    return output({command:"rg/status",model:native?.bound_title||null,
      binding:native?.status||"UNAVAILABLE",
      read_ready:native?.status==="BOUND_CURRENT"&&native?.bound_id===native?.active_id,
      note:"Binding is controlled by Revit; status does not grant or change model authority."});
  }
  if(parsed.kind==="knowledge"){
    return output({command:"rg/knowledge",query:parsed.query,
      items:await knowledgeReader(parsed.query),
      note:"Knowledge is advisory; confirm factual answers against the current Revit model."});
  }
  const kind={tools:"tool",job:"job",dynamo:"dynamo"}[parsed.kind];
  if(!kind)throw new Error("RG_COMMAND_NOT_SUPPORTED");
  const data=await registryReader({kind,query:parsed.query,limit:12});
  return output({command:"rg/"+parsed.kind,query:parsed.query,...data});
}
