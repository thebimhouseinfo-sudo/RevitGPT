import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {test} from "node:test";
import {effectForTool,wrapToolRegistration} from "../src/tool-effects.mjs";

test("P1 executes a registered tool without application-level Job recovery",async()=>{
  const callbacks=new Map();
  const server={registerTool(name,_config,callback){callbacks.set(name,callback);}};
  let awake=false,calls=0;
  wrapToolRegistration(server,{isAwake:()=>awake});
  server.registerTool("file_read",{},async()=>{calls++;return "OK";});
  server.registerTool("revitgpt_status",{},async()=>({ready:true}));
  assert.equal((await callbacks.get("revitgpt_status")({})).ready,true);
  await assert.rejects(callbacks.get("file_read")({}),/WORKSPACE_STANDBY/);
  assert.equal(calls,0);
  awake=true;
  assert.equal(await callbacks.get("file_read")({}),"OK");
  assert.equal(calls,1);
  assert.equal(effectForTool("revitgpt_call",{name:"revit_set_parameter"}),"MODEL_MUTATION");
  assert.throws(()=>server.registerTool("unknown_capability",{},async()=>{}),/WORK_EFFECT_UNCLASSIFIED/);
});

test("P1 routing does not initialize recovery journals or stop-drain states",async()=>{
  const source=await fs.readFile(new URL("../src/index.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(source,/workTracker|work-journal|nativeRecoveryWatch|STOP_PENDING|STOP_BLOCKED|rg\/stop/);
  assert.match(source,/createAwakeIntent/);
  assert.match(source,/fetchNativeBindingStatus/);
  assert.match(source,/revitProcessWatch/);
  assert.match(source,/isAwake:\(\)=>awakeIntent\.isAwake\(\)/);
});
