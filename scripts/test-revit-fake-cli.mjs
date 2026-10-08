import assert from "node:assert/strict";
import { parseRevitCommand, executeRevitCommand } from "../src/revit-fake-cli.mjs";
assert.deepEqual(parseRevitCommand("RG/TOOLS fcu"),{kind:"tools",query:"fcu"});
assert.deepEqual(parseRevitCommand("rg/"),{kind:"help",query:""});
assert.equal(parseRevitCommand("revit_list_elements"),null);
assert.equal(parseRevitCommand("rg/delete"),null);
assert.equal(parseRevitCommand("rg/knowledge ../../etc"),null);
assert.throws(()=>parseRevitCommand("rg/status extra"),/RG_COMMAND_ARGUMENTS_INVALID/);
let registryCalls=0, knowledgeCalls=0, nativeCalls=0;
const injected={
 bindingReader:async()=>{nativeCalls++;return {status:"BOUND_CURRENT",bound_title:"Test-A",bound_id:"A",active_id:"A"};},
 registryReader:async(q)=>{registryCalls++;return {entries:[{kind:q.kind,id:"sample",risk:"blocked"}],returned:1};},
 knowledgeReader:async(q)=>{knowledgeCalls++;return [{source:"revit/FAMILY.md",excerpt:"FCU "+q}];}
};
const menu=await executeRevitCommand("rg/",injected);
assert.match(menu.content[0].text,/rg\/status/);
assert.match(menu.content[0].text,/rg\/knowledge/);
const status=await executeRevitCommand("rg/status",injected);
assert.equal(status.structuredContent.read_ready,true);
const tools=await executeRevitCommand("rg/tools fcu",injected);
assert.equal(tools.structuredContent.entries[0].kind,"tool");
const jobs=await executeRevitCommand("rg/job",injected);
assert.equal(jobs.structuredContent.entries[0].kind,"job");
const dyn=await executeRevitCommand("rg/dynamo",injected);
assert.equal(dyn.structuredContent.entries[0].kind,"dynamo");
const know=await executeRevitCommand("rg/knowledge fan coil",injected);
assert.match(know.content[0].text,/FCU fan coil/);
assert.equal(nativeCalls,1,"only explicit rg/status reads native binding");
assert.equal(knowledgeCalls,1);
assert.equal(registryCalls,3);
assert.equal(await executeRevitCommand("rg/delete",injected),null);
assert.equal(await executeRevitCommand("revit_delete_elements",injected),null);
assert.equal(nativeCalls,1,"unknown commands never touch native");
console.log("[PASS] Fake CLI rg/ status/tools/job/dynamo/knowledge/help are read-only metadata routes with negative controls.");
