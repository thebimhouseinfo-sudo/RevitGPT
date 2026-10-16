import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { effectForTool } from "../src/tool-effects.mjs";
import { createNativeHostIdentity } from "../src/native-host-identity.mjs";

test("save model is classified as a model mutation", () => {
  assert.equal(effectForTool("revitgpt_call", {name:"revit_save_model",arguments:{}}), "MODEL_MUTATION");
  assert.equal(effectForTool("revitgpt_call", {name:"revit_save_model",arguments:{dry_run:true}}), "MODEL_MUTATION");
});

test("one verified Revit.exe with a single auto-bound project recovers host after restart", async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"rg-host-"));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,"host.json");
  const identity=await createNativeHostIdentity({
    filePath,
    sessionIdProvider:async()=> "a".repeat(64),
    processState:async()=>({observable:true,processes:[{pid:111}]})
  });
  const first={host_instance_id:"1".repeat(32),status:"BOUND_CURRENT",manual_binding:false,revision:1,bound_id:"A",active_id:"A",open_project_count:1,host_process_id:111};
  await identity.observe(first);
  const next={...first,host_instance_id:"2".repeat(32)};
  const result=await identity.observe(next);
  assert.equal(result.host_instance_id,next.host_instance_id);
  assert.equal(result.reason,"VERIFIED_SINGLE_HOST_AUTO_REBOUND");
  assert.equal(JSON.parse(await fs.readFile(filePath,"utf8")).host_instance_id,next.host_instance_id);
});

test("mismatched PID and multiple projects deny automatic takeover", async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"rg-host-"));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const identity=await createNativeHostIdentity({
    filePath:path.join(dir,"host.json"),
    sessionIdProvider:async()=> "b".repeat(64),
    processState:async()=>({observable:true,processes:[{pid:111}]})
  });
  const base={host_instance_id:"1".repeat(32),status:"BOUND_CURRENT",manual_binding:false,open_project_count:1,host_process_id:111};
  await identity.observe(base);
  await assert.rejects(identity.observe({...base,host_instance_id:"2".repeat(32),host_process_id:222}),/TAKEOVER_DENIED/);
  await assert.rejects(identity.observe({...base,host_instance_id:"3".repeat(32),open_project_count:2}),/TAKEOVER_DENIED/);
  assert.equal(identity.status().host_instance_id,base.host_instance_id);
});
