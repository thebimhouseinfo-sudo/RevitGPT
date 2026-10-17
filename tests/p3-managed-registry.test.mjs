import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { noteManagedToolRegistration, effectiveRegistry, filterCapabilities } from "../src/capability-registry.mjs";
import { wrapToolRegistration } from "../src/tool-effects.mjs";

test("actual registered managed MCP tools are fast-discoverable without folder scans",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rg-p3-catalog-"));
  try {
    const manifest=path.join(root,"manifest.json"),users=path.join(root,"users.json");
    await fs.writeFile(manifest,JSON.stringify({version:1,entries:[]}));
    await fs.writeFile(users,JSON.stringify({version:1,entries:[]}));
    const server=wrapToolRegistration({registerTool(name){return {name};}},{isAwake:()=>true});
    server.registerTool("owned_bundle_path",{title:"Owned bundle path",description:"Locate an owned bundle"},async()=>({}));
    const entries=await effectiveRegistry({internalFile:manifest,userFile:users});
    const match=filterCapabilities(entries,{query:"owned bundle"});
    assert.ok(match.some(x=>x.name==="owned_bundle_path"&&x.execution==="owned_bundle_path"));
    assert.ok(match.some(x=>x.registry==="internal"));
    noteManagedToolRegistration("capability_borrow",{description:"Record nonexclusive use"});
    assert.ok((await effectiveRegistry({internalFile:manifest,userFile:users}))
      .some(x=>x.name==="capability_borrow"));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
