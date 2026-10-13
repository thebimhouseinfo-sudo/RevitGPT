import assert from "node:assert/strict";
import { SessionModelAuthority } from "../src/model-authority.mjs";
import { callReadOnlyTool, ensureReadRuntime } from "../src/read-intent-gate.mjs";
import { readFileSync } from "node:fs";

let native={status:"BOUND_CURRENT",revision:1,bound_id:"M",active_id:"M",
  bound_title:"RG Test",host_instance_id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"};
const counts={activations:0,preflight:0,call:0,read:0};
const upstream={
  connected:false,
  status(){return {connected:this.connected};},
  cachedTools(){return this.connected?[
    {name:"revit_list_levels"},{name:"revit_get_active_document"},
    {name:"revit_delete_elements"}
  ]:[];},
  async activate(){counts.activations++;this.connected=true;return this.cachedTools();}
};
const processState=async()=>{counts.preflight++;return {observable:true,running:true};};
const bridgeState=async()=>({available:true});
const ensureReady=()=>ensureReadRuntime({upstream,processState,bridgeState});
const invoke=async(name,args)=>{counts.call++;return {name,args};};
const session=()=>new SessionModelAuthority(async()=>{counts.read++;return native;});
const fail=async(fn,match)=>assert.rejects(fn,new RegExp(match));

// No native model access and no Python startup until a genuine request.
assert.equal(counts.activations,0);
const s1=session(),s2=session(); // two unrelated MCP transport instances
const first=await callReadOnlyTool({name:"revit_list_levels",authority:s1,ensureReady,invoke});
assert.equal(first.args.document_id,"M");
assert.equal(counts.activations,1,"first explicit read wakes Python exactly once");
assert.equal(counts.preflight,1);
const second=await callReadOnlyTool({name:"revit_list_levels",authority:s2,ensureReady,invoke});
assert.equal(second.args.document_id,"M");
assert.equal(counts.activations,1,"new MCP transport requires NO prior admission and reuses live Python");
assert.equal(counts.call,2);
const diagnostic=await callReadOnlyTool({name:"revit_get_active_document",
  authority:session(),ensureReady,invoke});
assert.equal(diagnostic.name,"revit_get_active_document");

const writeIntent=await callReadOnlyTool({
  name:"revit_delete_elements",args:{element_ids:["42"]},
  authority:session(),ensureReady,invoke
});
assert.deepEqual(writeIntent.args,{element_ids:["42"],document_id:"M"},
  "Node forwards writes only for the bound and current model");
await fail(()=>callReadOnlyTool({name:"revit_create_duct",authority:session(),ensureReady,invoke}),
  "REVIT_MCP_TOOL_NOT_DISCOVERED");
await fail(()=>callReadOnlyTool({name:"revit_unknown_write",authority:session(),ensureReady,invoke}),
  "MODEL_TOOL_NOT_ALLOWED");
await fail(()=>callReadOnlyTool({name:"revit_list_levels",args:{document_id:"OTHER"},
  authority:session(),ensureReady,invoke}),"DOCUMENT_ID_MISMATCH");
const performed=counts.call;
native={...native,status:"BOUND_OTHER_ACTIVE",active_id:"B"};
await fail(()=>callReadOnlyTool({name:"revit_list_levels",authority:session(),ensureReady,invoke}),
  "MODEL_BINDING_NOT_CURRENT");
native={...native,status:"BOUND_CLOSED",active_id:"B"};
await fail(()=>callReadOnlyTool({name:"revit_list_levels",authority:session(),ensureReady,invoke}),
  "MODEL_BINDING_NOT_CURRENT");
assert.equal(counts.call,performed,"denied reads MUST NOT reach Python");
upstream.connected=false;
const wakeBefore=counts.activations;
await fail(()=>callReadOnlyTool({name:"revit_list_levels",authority:session(),ensureReady,invoke}),
  "MODEL_BINDING_NOT_CURRENT");
assert.equal(counts.activations,wakeBefore,"invalid bound model MUST NOT wake Python MCP");

native={...native,status:"BOUND_CURRENT",bound_id:"M",active_id:"M"};
const bridgeDown=()=>ensureReadRuntime({upstream,processState,
  bridgeState:async()=>({available:false})});
await fail(()=>callReadOnlyTool({name:"revit_list_levels",authority:session(),
  ensureReady:bridgeDown,invoke}),"BRIDGE_OFF");
assert.equal(counts.activations,wakeBefore,"unavailable bridge blocks Python wake");

const revitOff=()=>ensureReadRuntime({upstream,
  processState:async()=>({observable:true,running:false}),
  bridgeState:async()=>({available:true})});
await fail(()=>callReadOnlyTool({name:"revit_list_levels",authority:session(),
  ensureReady:revitOff,invoke}),"REVIT_OFF");
assert.equal(counts.activations,wakeBefore,"Revit off blocks Python wake");

await callReadOnlyTool({name:"revit_list_levels",authority:session(),ensureReady,invoke});
assert.equal(counts.activations,wakeBefore+1,"valid next read recovers safely");

// Structural regression gate: no hidden 'admitted' boolean gating a read call.
// This is an important negative control for connector tools whose individual
// requests create different MCP transport instances.
const source=readFileSync(new URL("../src/index.mjs",import.meta.url),"utf8");
assert.ok(source.includes("await callReadOnlyTool({"),"proxy must use gate");
assert.ok(!source.includes('if (!admitted || !revitUpstream.status().connected)'),
  "old session-local admission guard must never be restored");
const legacy=source.replace("await callReadOnlyTool({",
  'if (!admitted || !revitUpstream.status().connected) throw new Error("REVITGPT_ADMISSION_REQUIRED"); await callReadOnlyTool({');
assert.notEqual(legacy,source);
assert.ok(legacy.includes("REVITGPT_ADMISSION_REQUIRED"),"negative control identifies regression");
console.log("[PASS] Fresh MCP sessions can call read and write tools on the bound model without a lease; mismatches/unknown tools/closed/bridge-off fail closed.");
