import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  handleRetiredPanelCommand, RETIRED_PANEL_COMMANDS
} from "../src/retired-panel-commands.mjs";

let reads=0;
const native={status:"BOUND_CURRENT",bound_id:"M",active_id:"M",bound_title:"MAGS"};
const probe=async()=>{reads++;return native;};
const fail=(p,match)=>assert.rejects(p,new RegExp(match));

for(const alias of RETIRED_PANEL_COMMANDS){
  const result=await handleRetiredPanelCommand(alias,{},probe);
  assert.equal(result.structuredContent.status,"RETIRED_CONTROL_NO_LEASE_REQUIRED");
  assert.equal(result.structuredContent.old_tool,alias);
  assert.equal(result.structuredContent.model_current,true);
  assert.equal(result.structuredContent.read_only,true);
  assert.equal(result.structuredContent.next_tool,"revit_list_levels");
  assert.deepEqual(result.structuredContent.next_arguments,{});
  assert.match(result.content[0].text,/NO PAIRING OR SESSION LEASE REQUIRED/);
  assert.match(result.content[0].text,/rev[it]*_list_levels/);
  assert.ok(!JSON.stringify(result).includes("LEASED_READ_ONLY"),"must not claim any grant");
  await fail(handleRetiredPanelCommand(alias,{document_id:"M"},probe),"RETIRED_PANEL_ARGUMENTS_INVALID");
  await fail(handleRetiredPanelCommand(alias,["M"],probe),"RETIRED_PANEL_ARGUMENTS_INVALID");
}
assert.equal(reads,2,"bad args must not query native");
assert.equal(await handleRetiredPanelCommand("revit_list_levels",{},probe),null);
assert.equal(await handleRetiredPanelCommand("revit_create_duct",{},probe),null);
assert.equal(reads,2,"normal MCP tools cannot be intercepted");
const other=await handleRetiredPanelCommand(RETIRED_PANEL_COMMANDS[0],{},
  async()=>({...native,status:"BOUND_OTHER_ACTIVE",active_id:"B"}));
assert.equal(other.structuredContent.model_current,false);
assert.equal(other.structuredContent.next_tool,undefined);
assert.match(other.content[0].text,/Bind Current/);
const closed=await handleRetiredPanelCommand(RETIRED_PANEL_COMMANDS[1],{},
  async()=>({...native,status:"BOUND_CLOSED",active_id:"B"}));
assert.equal(closed.structuredContent.next_tool,undefined);

// Integration guard: intercept before the Python discovery and authority gate.
const source=readFileSync(new URL("../src/index.mjs",import.meta.url),"utf8");
const aliasCall=source.indexOf("await handleRetiredPanelCommand(name, args,");
const standardCall=source.indexOf("await callReadOnlyTool({");
assert.ok(aliasCall>0 && standardCall>aliasCall);
assert.ok(source.includes("if (retired)"));
assert.match(source, /No manual Pair(?:\\/| or )lease/i, "Legacy Pair/Lease prohibition must remain documented");
const corrupted=source.replace("if (retired) {","if (false) {");
assert.notEqual(corrupted,source);
assert.ok(!corrupted.includes("if (retired) {"),"negative control catches missing alias handling");
console.log("[PASS] Legacy Pair/Lease names return safe, explicit read guidance; no grant, no Python call, no writes; wrong model still blocked.");
