import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateDynamoDraft, validateDynamoDraftFile, stageDynamoDraft } from "../src/dynamo-draft.mjs";
import { effectForTool } from "../src/tool-effects.mjs";
import { classifyModelOperation, requiresActiveBoundModel } from "../src/model-authority.mjs";

const graph=JSON.stringify({Nodes:[
  {Id:"node-a",NodeType:"NumberInput",Inputs:[],Outputs:[{Id:"port-a"}]},
  {Id:"node-b",NodeType:"NumberInput",Inputs:[{Id:"port-b"}],Outputs:[]}],
  Connectors:[{Id:"link-ab",Start:"port-a",End:"port-b"}]});
const valid=validateDynamoDraft(graph);
assert.equal(valid.nodes,2);
assert.equal(valid.connectors,1);
assert.equal(valid.execution_requested,false);
assert.equal(valid.host_compatibility_verified,false);
const official=JSON.stringify({Nodes:[
  {Id:"code",NodeType:"CodeBlockNode",
   ConcreteType:"Dynamo.Graph.Nodes.CodeBlockNodeModel, DynamoCore",
   Inputs:[],Outputs:[{Id:"code-out"}],Code:"1+1;"},
  {Id:"func",NodeType:"FunctionNode",
   ConcreteType:"Dynamo.Graph.Nodes.ZeroTouch.DSFunction, DynamoCore",
   Inputs:[{Id:"func-in"}],Outputs:[{Id:"func-out"}],
   FunctionSignature:"DSCore.List.Count@var[]..[]"}
],Connectors:[{Id:"link-f",Start:"code-out",End:"func-in"}]});
assert.equal(validateDynamoDraft(official).nodes,2);
const unknown=JSON.parse(official);
unknown.Nodes[1].ConcreteType="Bad.ZeroTouch, ExternalPackage";
assert.throws(()=>validateDynamoDraft(JSON.stringify(unknown)), /UNREVIEWED/);

for(const change of [
  {Nodes:[{Id:"a",NodeType:"PythonScriptNode",Inputs:[],Outputs:[]}],Connectors:[]},
  {Nodes:[{Id:"a",Inputs:[],Outputs:[]},{Id:"a",Inputs:[],Outputs:[]}],Connectors:[]},
  {Nodes:[{Id:"a",Inputs:[],Outputs:[{Id:"out"}]},
          {Id:"b",Inputs:[{Id:"in"}],Outputs:[]}],
   Connectors:[{Id:"bad",Start:"a",End:"in"}]},
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
  await assert.rejects(stageDynamoDraft(draft,staging,file,"0".repeat(64)),/SHA_MISMATCH/);
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
