import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerManagedTools } from "../src/managed-tools.mjs";
import { ensureAppDataLayout } from "../src/appdata.mjs";
import { createOwnedBundle,writeOwnedFile } from "../src/owned-bundles.mjs";
import { effectForTool } from "../src/tool-effects.mjs";

test("explicit Dynamo Save/Register copies graph/data, never registers Temp Job",async()=>{
  const old=process.env.REVITGPT_APPDATA_ROOT;
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rg-dyn-promote-"));
  process.env.REVITGPT_APPDATA_ROOT=root;
  try{
    await ensureAppDataLayout();
    await createOwnedBundle("temp","temp-1");
    const graph=JSON.stringify({Nodes:[{Id:"1"}],Connectors:[]});
    await writeOwnedFile("temp","temp-1","graph.dyn",graph);
    await writeOwnedFile("temp","temp-1","input/data.json",'{"data":1}');
    const tools=new Map();
    registerManagedTools({registerTool(name,_schema,callback){tools.set(name,callback);}});
    const promote=tools.get("dynamo_save_register");
    const output=(await promote({source_kind:"temp",source_id:"temp-1",graph_file:"graph.dyn",
      dependency_files:["input/data.json"],library_id:"my-dyn",id:"dynamo.my",summary:"tested graph"})).structuredContent;
    assert.equal(output.registered,true);
    assert.equal(output.temp_job_registered,false);
    assert.equal(output.source_preserved,true);
    assert.equal(await fs.readFile(path.join(root,"libraries","dynamo","my-dyn","graph.dyn"),"utf8"),graph);
    assert.equal(await fs.readFile(path.join(root,"temp-jobs","temp-1","graph.dyn"),"utf8"),graph);
    const registry=JSON.parse(await fs.readFile(path.join(root,"registry","user","capabilities.json"),"utf8"));
    assert.ok(registry.entries.some(x=>x.id==="dynamo.my"&&x.kind==="dynamo"));
    assert.ok(!registry.entries.some(x=>x.kind==="job"));
    assert.equal(effectForTool("dynamo_save_register"),"SYSTEM_SIDE_EFFECT");
  }finally{
    if(old===undefined)delete process.env.REVITGPT_APPDATA_ROOT;
    else process.env.REVITGPT_APPDATA_ROOT=old;
    await fs.rm(root,{recursive:true,force:true});
  }
});
