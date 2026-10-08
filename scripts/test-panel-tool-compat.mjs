import assert from "node:assert/strict";
import { runPanelCompatTool, PANEL_COMPAT_CATALOG, PANEL_COMPAT_NAMES }
  from "../src/panel-tool-compat.mjs";

const binding={status:"BOUND_CURRENT",host_instance_id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  revision:1,bound_id:"A",active_id:"A",bound_title:"RG-Test-A"};
const seen={challenge:0,lease:0,native:0};
const authority={
  summary:()=>null,
  leaseCurrent:async()=>{seen.lease++;return {...binding,permission:"read_only"};}
};
const panelPairing={
  begin:(target)=>{assert.equal(target,authority);seen.challenge++;
    return {code:"ABCDEF0123456789ABCDEF0123456789",expires_in_seconds:300};}
};
const context=()=>({
  admitted:true,upstreamConnected:true,authority,panelPairing,
  nativeBindingStatus:async()=>{seen.native++;return binding;}
});
const fails=async(fn,re)=>assert.rejects(fn,re);
assert.deepEqual(PANEL_COMPAT_NAMES.map(x=>x),PANEL_COMPAT_CATALOG.map(x=>x.name));
assert.ok(PANEL_COMPAT_CATALOG.every(t=>t.invocation.tool==="revitgpt_call" &&
  t.invocation.name===t.name && Object.keys(t.invocation.arguments).length===0));
assert.equal(await runPanelCompatTool("revit_list_levels",context()),null,
  "ordinary upstream tools remain normal");
let paired=await runPanelCompatTool("revitgpt_pair_panel",context());
assert.equal(paired.structuredContent.status,"PAIRING_PENDING");
assert.equal(paired.structuredContent.code.length,32);
assert.equal(seen.challenge,1);
const native=await runPanelCompatTool("revitgpt_binding_status",context());
assert.deepEqual(native.structuredContent.native_binding,binding);
assert.equal(seen.native,1);
const leased=await runPanelCompatTool("revitgpt_lease_bound_model",context());
assert.equal(leased.structuredContent.status,"LEASED_READ_ONLY");
assert.equal(seen.lease,1);

for(const name of ["revitgpt_pair_panel","revitgpt_lease_bound_model"]){
 await fails(()=>runPanelCompatTool(name,{...context(),admitted:false}),/REVITGPT_ADMISSION_REQUIRED/);
 await fails(()=>runPanelCompatTool(name,{...context(),upstreamConnected:false}),/REVITGPT_ADMISSION_REQUIRED/);
}
for(const name of PANEL_COMPAT_NAMES){
 await fails(()=>runPanelCompatTool(name,context(),{document_id:"A"}),/PANEL_CONTROL_ARGUMENTS_INVALID/);
 await fails(()=>runPanelCompatTool(name,context(),["malformed"]),/PANEL_CONTROL_ARGUMENTS_INVALID/);
 await fails(()=>runPanelCompatTool(name,context(),null),/PANEL_CONTROL_ARGUMENTS_INVALID/);
}
assert.equal(seen.challenge,1,"bad request must not mint pairing challenge");
assert.equal(seen.lease,1,"bad request must not mint lease");
await fails(()=>runPanelCompatTool("revitgpt_lease_bound_model",{
  ...context(),authority:{...authority,leaseCurrent:async()=>{throw new Error("MODEL_BINDING_NOT_CURRENT");}}
}),/MODEL_BINDING_NOT_CURRENT/);
console.log("[PASS] Named/legacy generic control routes share implementation; admission, arguments and read-only lease fail closed.");
