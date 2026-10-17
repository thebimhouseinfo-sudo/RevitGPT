import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createOwnedBundle, readOwnedFile, writeOwnedFile } from "../src/owned-bundles.mjs";
import { effectForTool } from "../src/tool-effects.mjs";

test("owner-local write is isolated and does not need registry", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rg-p3-owned-"));
  const old=process.env.REVITGPT_APPDATA_ROOT;
  process.env.REVITGPT_APPDATA_ROOT=root;
  try {
    await createOwnedBundle("job","owner-a");
    await createOwnedBundle("temp","owner-b");
    const a=await writeOwnedFile("job","owner-a","data/run.json",'{"job":"a"}');
    assert.equal(await readOwnedFile("job","owner-a","data/run.json"),'{"job":"a"}');
    assert.equal(path.dirname(path.dirname(a)),path.join(root,"libraries","jobs","owner-a"));
    await assert.rejects(()=>readOwnedFile("temp","owner-b","data/run.json"),{code:"ENOENT"});
    await assert.rejects(()=>writeOwnedFile("job","owner-a","data/run.json","overwrite"),/OWNED_FILE_ALREADY_EXISTS/);
    await writeOwnedFile("job","owner-a","data/run.json","edited",{expectedContent:'{"job":"a"}'});
    await assert.rejects(()=>writeOwnedFile("job","owner-a","data/run.json","bad",{expectedContent:'{"job":"a"}'}),/OWNED_FILE_CONTENT_CHANGED/);
    for(const bad of ["../owner-b/secret","/absolute","sub/../../escape","C:/windows","sub//blank"])
      await assert.rejects(()=>writeOwnedFile("job","owner-a",bad,"x"),/OWNED_FILE_/);
    assert.equal(effectForTool("owned_file_read"),"READ_ONLY");
    assert.equal(effectForTool("owned_file_write"),"SYSTEM_SIDE_EFFECT");
    assert.equal(effectForTool("owned_bundle_create"),"SYSTEM_SIDE_EFFECT");
  }finally {
    if(old===undefined)delete process.env.REVITGPT_APPDATA_ROOT;
    else process.env.REVITGPT_APPDATA_ROOT=old;
    await fs.rm(root,{recursive:true,force:true});
  }
});

test("owned bundle denies symlink escapes", async t => {
  if(process.platform==="win32"){t.skip("Symlink creation requires permissions on some Windows hosts");return;}
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rg-p3-link-"));
  const old=process.env.REVITGPT_APPDATA_ROOT;
  process.env.REVITGPT_APPDATA_ROOT=root;
  try{
    const bundle=await createOwnedBundle("temp","link-test");
    await fs.symlink(path.dirname(bundle),path.join(bundle,"escape"));
    await assert.rejects(()=>writeOwnedFile("temp","link-test","escape/anything","x"),/OWNED_FILE_SYMLINK_DENIED/);
  }finally{
    if(old===undefined)delete process.env.REVITGPT_APPDATA_ROOT;
    else process.env.REVITGPT_APPDATA_ROOT=old;
    await fs.rm(root,{recursive:true,force:true});
  }
});
