import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerManagedTools } from "../src/managed-tools.mjs";
import { ensureAppDataLayout } from "../src/appdata.mjs";

test("P3 Saved Job registers directly from owner folder and retrieves exact steps",async()=>{
  const old=process.env.REVITGPT_APPDATA_ROOT;
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rg-job-owned-"));
  process.env.REVITGPT_APPDATA_ROOT=root;
  try{
    await ensureAppDataLayout();
    const folder=path.join(root,"libraries","jobs","example");
    await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(path.join(folder,"JOB.md"),"# Example Job\n\nGoal: verify catalog\n");
    await fs.writeFile(path.join(folder,"JOB_STEPS.md"),"# Steps\n\n1. Read\n2. Report\n");
    const handlers=new Map();
    registerManagedTools({registerTool(name,_meta,callback){handlers.set(name,callback);}});
    const registered=(await handlers.get("job_register_owned")({library_id:"example",id:"job.example",summary:"Example contract"})).structuredContent;
    assert.equal(registered.registered,true);
    const record=(await handlers.get("job_get")({id:"job.example"})).structuredContent;
    assert.match(record.steps,/1\. Read/);
    assert.equal(record.contract_changed,false);
    await fs.writeFile(path.join(folder,"JOB_STEPS.md"),"# Steps\n\nChanged externally\n");
    const changed=(await handlers.get("job_get")({id:"job.example"})).structuredContent;
    assert.equal(changed.contract_changed,true);
    await assert.rejects(
      ()=>handlers.get("job_register_owned")({library_id:"example",id:"job.example",summary:"Overwrite"}),
      /REGISTRY_ID_COLLISION/
    );
  }finally{
    if(old===undefined)delete process.env.REVITGPT_APPDATA_ROOT;
    else process.env.REVITGPT_APPDATA_ROOT=old;
    await fs.rm(root,{recursive:true,force:true});
  }
});
