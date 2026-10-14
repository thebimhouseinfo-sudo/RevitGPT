import assert from "node:assert/strict";
import {test} from "node:test";
import {effectForTool,wrapToolRegistration} from "../src/tool-effects.mjs";
import {createSessionManager,isPriorityControlRequest} from "../src/mcp-session-manager.mjs";

const request=(tool,args={})=>({
  jsonrpc:"2.0",id:"req-control",method:"tools/call",
  params:{name:tool,arguments:args}
});

test("P1-D: classify all tool effects; reject unknown instead of pretending read-only",()=>{
  assert.equal(effectForTool("file_read"),"READ_ONLY");
  assert.equal(effectForTool("file_edit"),"SYSTEM_SIDE_EFFECT");
  assert.equal(effectForTool("asset_import"),"SYSTEM_SIDE_EFFECT");
  assert.equal(effectForTool("run_record_append"),"SYSTEM_SIDE_EFFECT");
  assert.equal(effectForTool("revit_mcp_dev_edit"),"SYSTEM_SIDE_EFFECT");
  assert.equal(effectForTool("revitgpt_admission"),"CONTROL");
  assert.equal(effectForTool("revitgpt_command",{command:"rg/stop"}),"CONTROL");
  assert.equal(effectForTool("revitgpt_call",{name:"rg/stop"}),"CONTROL");
  assert.equal(effectForTool("revitgpt_call",{name:"revit_list_levels"}),"READ_ONLY");
  assert.equal(effectForTool("revitgpt_call",{name:"revit_set_parameter"}),"MODEL_MUTATION");
  assert.equal(effectForTool("revitgpt_call",{name:"revit_select_related",arguments:{apply:true}}),"UI_SIDE_EFFECT");
  assert.equal(effectForTool("revitgpt_call",{name:"revit_select_related",arguments:{apply:false}}),"READ_ONLY");
  assert.throws(()=>effectForTool("invented_business"),/WORK_EFFECT_UNCLASSIFIED/);
  assert.throws(()=>effectForTool("revitgpt_call",{name:"fake_revit_write"}),/WORK_EFFECT_UNCLASSIFIED/);
});

test("P1-D: wrapper accounts for SYSTEM tools even from another MCP server instance",async()=>{
  const callbacks=new Map(),received=[];
  const fake={registerTool(name,config,fn){callbacks.set(name,fn);return {name};}};
  const tracker={
    async run(name,effect,args,fn){received.push({name,effect,args});return fn();}
  };
  let awake=false;
  wrapToolRegistration(fake,{tracker,isAwake:()=>awake});
  fake.registerTool("file_edit",{inputSchema:{}},async args=>({isError:false,value:args.path}));
  fake.registerTool("revitgpt_status",{inputSchema:{}},async()=>({status:"OK"}));
  assert.equal((await callbacks.get("revitgpt_status")({})).status,"OK",
    "control remains available in STANDBY");
  await assert.rejects(callbacks.get("file_edit")({path:"workspace/a"}),/WORKSPACE_STANDBY/);
  assert.equal(received.length,0);
  awake=true;
  const ok=await callbacks.get("file_edit")({path:"workspace/a"});
  assert.equal(ok.value,"workspace/a");
  assert.equal(received.length,1);
  assert.equal(received[0].effect,"SYSTEM_SIDE_EFFECT");
});

test("P1-D: only exact authenticated MCP control messages get FIFO priority",()=>{
  assert.equal(isPriorityControlRequest(request("revitgpt_status")),true);
  assert.equal(isPriorityControlRequest(request("revitgpt_command",{command:"rg/stop"})),true);
  assert.equal(isPriorityControlRequest(request("revitgpt_call",{name:"rg/stop"})),true);
  assert.equal(isPriorityControlRequest(request("revitgpt_call",{name:"rg/status"})),true);
  assert.equal(isPriorityControlRequest(request("file_edit",{path:"x"})),false);
  assert.equal(isPriorityControlRequest(request("revitgpt_call",{name:"revit_set_parameter"})),false);
  assert.equal(isPriorityControlRequest(request("revitgpt_call",{name:"rg/stop",arguments:{force:true}})),false);
  const malformed=request("revitgpt_status");
  delete malformed.id;
  assert.equal(isPriorityControlRequest(malformed),false);
  const batch=[request("revitgpt_status")];
  assert.equal(isPriorityControlRequest(batch),false);
  assert.equal(isPriorityControlRequest({method:"tools/call",params:{name:"revitgpt_status"}}),false);
});

test("P1-D: stop can enter same-session transport while a business POST is in flight",async()=>{
  const manager=createSessionManager(3300,()=>{throw new Error("No real session needed");});
  const sequence=[];
  let releaseWork,onEntered;
  const entered=new Promise(resolve=>onEntered=resolve);
  const blocked=new Promise(resolve=>releaseWork=resolve);
  const transport={sessionId:"test-session",async handleRequest(_req,_res,body){
    const name=body?.params?.name;
    sequence.push("start:"+name);
    if(name==="file_edit"){onEntered();await blocked;}
    sequence.push("end:"+name);
  }};
  const session={transport};
  const req={method:"POST",headers:{"mcp-session-id":"test-session"}};
  const first=manager.handleExisting(session,req,{},request("file_edit"));
  await entered;
  const second=manager.handleExisting(session,req,{},request("revitgpt_command",{command:"rg/stop"}));
  await second;
  assert.deepEqual(sequence,["start:file_edit","start:revitgpt_command","end:revitgpt_command"],
    "authenticated stop must not wait for in-flight business response");
  releaseWork();
  await first;
  assert.equal(sequence.at(-1),"end:file_edit");
});
