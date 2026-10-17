import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createOwnedBundle,finishTempBundle,cleanupTempBundles } from "../src/owned-bundles.mjs";
import { effectForTool } from "../src/tool-effects.mjs";

test("Temp cleanup deletes only terminal bundles after explicit retention",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rg-temp-clean-"));
  const before=process.env.REVITGPT_APPDATA_ROOT;
  process.env.REVITGPT_APPDATA_ROOT=root;
  try{
    await fs.mkdir(path.join(root,"temp-jobs"),{recursive:true});
    const active=await createOwnedBundle("temp","still-active");
    const done=await createOwnedBundle("temp","finished");
    await finishTempBundle("finished","completed");
    const preview=await cleanupTempBundles({retentionHours:0,dryRun:true});
    assert.deepEqual(preview.eligible,["finished"]);
    assert.ok(preview.skipped.some(x=>x.id==="still-active"));
    assert.equal((await fs.stat(done)).isDirectory(),true);
    await cleanupTempBundles({retentionHours:0,dryRun:false});
    await assert.rejects(()=>fs.stat(done),{code:"ENOENT"});
    assert.equal((await fs.stat(active)).isDirectory(),true);
    assert.equal(effectForTool("temp_job_cleanup"),"SYSTEM_SIDE_EFFECT");
    await assert.rejects(()=>cleanupTempBundles({}),/TEMP_JOB_RETENTION_HOURS_REQUIRED/);
  }finally{
    if(before===undefined)delete process.env.REVITGPT_APPDATA_ROOT;
    else process.env.REVITGPT_APPDATA_ROOT=before;
    await fs.rm(root,{recursive:true,force:true});
  }
});
