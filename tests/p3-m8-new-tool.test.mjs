import assert from "node:assert/strict";
import test from "node:test";
import { SessionModelAuthority, classifyModelOperation, registerDeveloperModelTool } from "../src/model-authority.mjs";

const status=()=>({status:"BOUND_CURRENT",host_instance_id:"a".repeat(32),
 revision:1,bound_id:"101",active_id:"101",bound_title:"test"});

test("M8 new inventoried tool is conservatively bound as mutation, never implicitly read",async()=>{
  const name="revit_dev_p3_probe";
  assert.equal(classifyModelOperation(name),null);
  const authority=new SessionModelAuthority(status);
  await assert.rejects(()=>authority.authorize(name,{}),/MODEL_TOOL_NOT_ALLOWED/);
  assert.equal(registerDeveloperModelTool(name),true);
  assert.equal(classifyModelOperation(name),"MODEL_MUTATION");
  const safe=await authority.authorize(name,{});
  assert.equal(safe.document_id,"101");
  await assert.rejects(()=>authority.authorize(name,{document_id:"999"}),/DOCUMENT_ID_MISMATCH/);
});
test("M8 rejects unsupported dev tool names",()=>{
  for(const name of ["system.admin","revit_save_model;exit","../dev","revit_X"])
    assert.throws(()=>registerDeveloperModelTool(name),/DEV_MODEL_TOOL_INVALID_NAME/);
});
