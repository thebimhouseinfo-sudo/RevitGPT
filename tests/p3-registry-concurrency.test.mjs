import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerManagedTools } from "../src/managed-tools.mjs";
import { ensureAppDataLayout } from "../src/appdata.mjs";

test("P3 Registry serialized writes keep distinct concurrent Saved Job registrations",async()=>{
  const old=process.env.REVITGPT_APPDATA_ROOT;
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rg-registry-concurrent-"));
  process.env.REVITGPT_APPDATA_ROOT=root;
  try{
    await ensureAppDataLayout();
    for(const id of ["a","b"]){
      const dir=path.join(root,"libraries","jobs",id);
      await fs.mkdir(dir,{recursive:true});
      await fs.writeFile(path.join(dir,"JOB.md"),"# "+id+"\n");
      await fs.writeFile(path.join(dir,"JOB_STEPS.md"),"# Steps\n1. Report\n");
    }
    const tools=new Map();
    registerManagedTools({registerTool(name,_schema,callback){tools.set(name,callback);}});
    const register=tools.get("job_register_owned");
    await Promise.all(["a","b"].map(id=>register({library_id:id,id:"job."+id,summary:id})));
    const file=JSON.parse(await fs.readFile(path.join(root,"registry","user","capabilities.json"),"utf8"));
    assert.ok(file.entries.some(x=>x.id==="job.a"));
    assert.ok(file.entries.some(x=>x.id==="job.b"));
    const results=await Promise.allSettled([register({library_id:"a",id:"job.duplicate",summary:"a"}),
                                           register({library_id:"b",id:"job.duplicate",summary:"b"})]);
    assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
    assert.equal(results.filter(x=>x.status==="rejected").length,1);
  }finally{
    if(old===undefined)delete process.env.REVITGPT_APPDATA_ROOT;
    else process.env.REVITGPT_APPDATA_ROOT=old;
    await fs.rm(root,{recursive:true,force:true});
  }
});
