import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createNativeHostIdentity } from "../src/native-host-identity.mjs";
import { SessionModelAuthority } from "../src/model-authority.mjs";

const temp=await fs.mkdtemp(path.join(os.tmpdir(),"rg-host-identity-"));
const file=path.join(temp,"state","native-host-identity.json");
const BOOT_A="a".repeat(64),BOOT_B="b".repeat(64);
const HOST_A="a".repeat(32),HOST_B="b".repeat(32);
const host=(session=BOOT_A)=>createNativeHostIdentity({
  filePath:file,sessionIdProvider:async()=>session
});
const binding=(host_instance_id,manual_binding=false)=>({
  status:"BOUND_CURRENT",host_instance_id,revision:manual_binding?2:1,
  bound_id:"100",active_id:"100",bound_title:"Model A",manual_binding
});
try {
  const first=await host();
  await first.observe(binding(HOST_A));
  assert.equal(first.status().host_instance_id,HOST_A);
  const newNode=await host(); // same Windows generation, recovered after crash
  assert.equal(newNode.status().host_instance_id,HOST_A);
  const authority=new SessionModelAuthority(async()=>binding(HOST_B),newNode);
  await assert.rejects(authority.authorize("revit_list_levels"),
    /NATIVE_HOST_TAKEOVER_DENIED/,
    "new process auto-binding its sole model must not seize global host");
  assert.equal(newNode.status().host_instance_id,HOST_A);
  const deliberate=new SessionModelAuthority(async()=>binding(HOST_B,true),newNode);
  assert.equal((await deliberate.authorize("revit_list_levels")).document_id,"100");
  assert.equal(newNode.status().host_instance_id,HOST_B);
  const persisted=await host();
  assert.equal(persisted.status().host_instance_id,HOST_B);
  await assert.rejects(persisted.observe(binding(HOST_A)),/NATIVE_HOST_TAKEOVER_DENIED/,
    "an earlier host cannot silently reclaim ownership");

  const nextBoot=await host(BOOT_B);
  assert.equal(nextBoot.status().host_instance_id,null,
    "Windows restart starts unpinned; old host generation is not restored");
  await nextBoot.observe(binding(HOST_A));
  assert.equal(nextBoot.status().host_instance_id,HOST_A);
  const unknown=await createNativeHostIdentity({
    filePath:file,sessionIdProvider:async()=>null
  });
  assert.equal(unknown.status().host_instance_id,null);
  await unknown.observe(binding(HOST_B));
  const stillPersisted=JSON.parse(await fs.readFile(file,"utf8"));
  assert.equal(stillPersisted.host_instance_id,HOST_A,
    "unverified-boot in-memory host may not overwrite persisted evidence");

  const red=await host(BOOT_B);
  const invalid=async()=>red.observe({host_instance_id:"BAD"});
  await assert.rejects(invalid(),/NATIVE_HOST_IDENTITY_INVALID/);
  console.log("[PASS] Native host authority: same-boot persistence, manual rebinding only, no silent multi-process takeover, reboot reset.");
}finally{await fs.rm(temp,{recursive:true,force:true});}
