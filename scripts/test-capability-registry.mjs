import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { effectiveRegistry, filterCapabilities, lookupRegistry, mergeCapabilities } from "../src/capability-registry.mjs";
const manifest=JSON.parse(await fs.readFile("runtimes/Revit-mcp/tool-manifest.json","utf8"));
assert.equal(manifest.entries.length,41);
assert.equal(manifest.entries.filter(x=>x.mode==="read_only").length,26);
assert.ok(manifest.entries.filter(x=>x.mutates_model).every(x=>x.mode==="disabled_mutation"&&x.status==="not_enabled"));
assert.equal(new Set(manifest.entries.map(x=>x.id)).size,41);
const sample=[
{id:"my-job",kind:"job",summary:"Run HVAC checking",library_id:"a",relative_path:"JOB.md"},
{id:"dyn.1",kind:"dynamo",summary:"Size ducts",semantic_status:"indexed"}
];
const merged=mergeCapabilities(manifest.entries,sample);
assert.equal(merged.length,43);
assert.ok(merged.find(x=>x.id==="dyn.1").risk==="unknown");
assert.equal(filterCapabilities(merged,{query:"equipment",kind:"tool"}).some(x=>x.name==="revit_list_elements"),true);
assert.deepEqual(filterCapabilities(merged,{query:"never-matches"}),[]);
assert.equal(filterCapabilities(merged,{kind:"dynamo"}).length,1);
assert.throws(()=>mergeCapabilities(manifest.entries,[{...sample[0],id:manifest.entries[0].id}]),/USER_REGISTRY_INTERNAL_COLLISION/);
// User-supplied entries cannot pretend to be executable tools.
assert.equal(mergeCapabilities(manifest.entries,[{...sample[0],kind:"tool"}]).length,41);
assert.throws(()=>filterCapabilities(merged,{limit:10000}),/REGISTRY_LIMIT_INVALID/);
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"rg-catalog-test-"));
try {
 const int=path.join(dir,"i.json"),usr=path.join(dir,"u.json");
 await fs.writeFile(int,JSON.stringify(manifest));await fs.writeFile(usr,JSON.stringify({version:1,entries:sample}));
 const result=await effectiveRegistry({internalFile:int,userFile:usr});
 assert.equal(result.length,43);
 const entry=await lookupRegistry({id:"mcp.revit_list_elements"});
 assert.equal(entry.entry.mode,"read_only");
 const result2=await lookupRegistry({query:"mechanical equipment",kind:"tool"});
 assert.ok(result2.entries.some(x=>x.name==="revit_list_elements"));
} finally { await fs.rm(dir,{recursive:true,force:true});}
console.log("[PASS] Registry internal/user merging, 41 tool inventory, semantic discovery, source priority, unknown user risk, no execution.");
