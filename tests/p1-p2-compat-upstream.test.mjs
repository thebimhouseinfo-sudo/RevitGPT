import assert from "node:assert/strict";
import test from "node:test";
import { RevitUpstream } from "../src/revit-upstream.mjs";
import { SessionModelAuthority, classifyModelOperation } from "../src/model-authority.mjs";
import { callReadOnlyTool } from "../src/read-intent-gate.mjs";

const BINDING={status:"BOUND_CURRENT",host_instance_id:"a".repeat(32),revision:1,bound_id:"old-model",active_id:"old-model",bound_title:"Baseline"};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}

test("P1/P2 old known reads and writes retain their original classification",()=>{
  for(const n of ["revit_list_levels","revit_get_active_view","revit_list_documents","revit_get_parameters"])
    assert.equal(classifyModelOperation(n),"READ_ONLY",n);
  for(const n of ["revit_save_model","revit_set_parameter","revit_load_dyn_file","revit_run_dyn_file"])
    assert.equal(classifyModelOperation(n),"MODEL_MUTATION",n);
  assert.equal(classifyModelOperation("revit_set_selection"),"UI_SIDE_EFFECT");
  assert.equal(classifyModelOperation("unknown_tool"),null);
});

test("P1/P2 existing tool call still uses native bound document_id and does not infer from title",async()=>{
  const authority=new SessionModelAuthority(async()=>BINDING);
  let called;
  const result=await callReadOnlyTool({
    name:"revit_get_parameters",args:{element_id:"24"},authority,
    ensureReady:async()=>[{name:"revit_get_parameters"}],
    invoke:async(name,args)=>{called={name,args};return {ok:true};}
  });
  assert.deepEqual(result,{ok:true});
  assert.equal(called.args.document_id,BINDING.bound_id);
  assert.equal(called.args.element_id,"24");
  await assert.rejects(()=>authority.authorize("revit_set_parameter",{document_id:"other-model"}),/DOCUMENT_ID_MISMATCH/);
});

test("P1/P2 calls already executing cannot be interrupted by DEV reload",async()=>{
  const up=new RevitUpstream();
  up.phase="active";
  const gates=[deferred(),deferred()];
  let called=0,closed=0;
  up.connect=async()=>{};
  up.client={callTool:()=>gates[called++].promise};
  up.deactivate=async()=>{closed++};
  const a=up.callTool("revit_list_levels");
  const b=up.callTool("revit_get_active_view");
  assert.equal(up.inFlightCalls,2);
  await assert.rejects(()=>up.reloadTools(),/REVIT_MCP_RELOAD_BUSY/);
  assert.equal(closed,0);
  gates[0].resolve({first:true}); gates[1].resolve({second:true});
  assert.deepEqual(await a,{first:true});
  assert.deepEqual(await b,{second:true});
  assert.equal(up.inFlightCalls,0);
});

test("P1/P2 ordinary Revit tool error does not disconnect shared Python transport",async()=>{
  const up=new RevitUpstream();
  up.phase="active";
  up.connect=async()=>{};
  up.client={callTool:async()=>{throw new Error("Bridge HTTP 400: invalid parameter")}};
  let deactivations=0;
  up.deactivate=async()=>{deactivations++};
  await assert.rejects(()=>up.callTool("revit_set_parameter",{}),/Bridge HTTP 400/);
  assert.equal(deactivations,0);
  assert.equal(up.inFlightCalls,0);
});

test("P1/P2 calls begun during reload fail closed and can recover afterwards",async()=>{
  const up=new RevitUpstream();
  const gate=deferred();
  up.deactivate=async()=>gate.promise;
  up.activate=async()=>[{name:"revit_list_levels"}];
  const reload=up.reloadTools();
  await assert.rejects(()=>up.callTool("revit_list_levels"),/REVIT_MCP_RELOAD_IN_PROGRESS/);
  gate.resolve();
  await reload;
  assert.equal(up.reloading,false);
});
