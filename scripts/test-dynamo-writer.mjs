import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateDynamoDraft, validateDynamoDraftFile, stageDynamoDraft } from "../src/dynamo-draft.mjs";
import { effectForTool } from "../src/tool-effects.mjs";
import { classifyModelOperation, requiresActiveBoundModel } from "../src/model-authority.mjs";

const graph=JSON.stringify({Nodes:[
  {Id:"node-a",NodeType:"NumberInput"},{Id:"node-b",NodeType:"NumberInput"}],
  Connectors:[{Start:"node-a",End:"node-b",StartIndex:0,EndIndex:0}]});
const valid=validateDynamoDraft(graph);
assert.equal(valid.nodes,2);
assert.equal(valid.connectors,1);
assert.equal(valid.execution_requested,false);
assert.equal(valid.host_compatibility_verified,false);
for(const change of [
  {Nodes:[{Id:"a",NodeType:"PythonScriptNode"}],Connectors:[]},
  {Nodes:[{Id:"a"},{Id:"a"}],Connectors:[]},
  {Nodes:[{Id:"a"}],Connectors:[{Start:"a",End:"missing"}]},
  {Nodes:[],Connectors:[]}
]) assert.throws(()=>validateDynamoDraft(JSON.stringify(change)));
assert.equal(effectForTool("dynamo_draft_validate"),"READ_ONLY");
assert.equal(effectForTool("dynamo_draft_stage"),"SYSTEM_SIDE_EFFECT");
assert.equal(classifyModelOperation("revit_run_dyn_file"),"MODEL_MUTATION");
assert.equal(requiresActiveBoundModel("revit_run_dyn_file"),true);

const temp=await fs.mkdtemp(path.join(os.tmpdir(),"rg-dyn-writer-"));
try{
  const draft=path.join(temp,"workspace"),staging=path.join(temp,"staging");
  await fs.mkdir(draft);
  const file=path.join(draft,"graph.dyn");
  await fs.writeFile(file,graph,"utf8");
  const check=await validateDynamoDraftFile(draft,file);
  const staged=await stageDynamoDraft(draft,staging,file,check.sha256);
  assert.equal(staged.status,"STAGED_NOT_EXECUTED");
  assert.equal(staged.stage_path,path.join(staging,check.sha256+".dyn"));
  assert.equal(await fs.readFile(staged.stage_path,"utf8"),graph);
  await stageDynamoDraft(draft,staging,file,check.sha256);
  assert.rejects(stageDynamoDraft(draft,staging,file,"0".repeat(64)),/SHA_MISMATCH/);
  const rogue=path.join(temp,"outside.dyn");
  await fs.writeFile(rogue,graph);
  await assert.rejects(validateDynamoDraftFile(draft,rogue),/OUTSIDE_WORKSPACE/);
  const sym=path.join(draft,"link.dyn");
  try{await fs.symlink(rogue,sym);}
  catch(e){if(!["EPERM","EACCES"].includes(e.code))throw e;}
  try{await fs.lstat(sym); await assert.rejects(validateDynamoDraftFile(draft,sym),/LINK_REJECTED/);}
  catch(e){if(e.code!=="ENOENT")throw e;}
}finally{await fs.rm(temp,{recursive:true,force:true});}
console.log("[PASS] Dynamo Writer static validation, staging, negative controls, bound-tool classification");
