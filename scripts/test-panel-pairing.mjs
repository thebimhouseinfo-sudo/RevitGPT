import assert from "node:assert/strict";
import { PanelPairingRegistry } from "../src/panel-pairing.mjs";
import { SessionModelAuthority } from "../src/model-authority.mjs";

let now=1000;
let native={
 status:"BOUND_CURRENT",host_instance_id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
 revision:1,active_id:"A",bound_id:"A",bound_title:"Test A"
};
const owner=new SessionModelAuthority(async()=>native);
const other=new SessionModelAuthority(async()=>native);
const registry=new PanelPairingRegistry({now:()=>now});
async function fails(p,msg){await assert.rejects(p,new RegExp(msg));}
const first=registry.begin(owner),second=registry.begin(other);
assert.equal(first.code.length,32);assert.notEqual(first.code,second.code);
const pairing=registry.claim(first.code.toLowerCase());
assert.equal(pairing.token.length,64);
assert.ok(!JSON.stringify(registry.paired).includes(first.code));
assert.throws(()=>registry.claim(first.code),/PANEL_PAIR_CODE_INVALID_OR_EXPIRED/);
await fails(()=>other.authorize("revit_list_levels"),"MODEL_LEASE_REQUIRED");
const confirmation={revision:1,host_instance_id:native.host_instance_id,bound_id:"A"};
const granted=await registry.lease(pairing.token,confirmation);
assert.equal(granted.status,"LEASED_READ_ONLY");
assert.equal((await owner.authorize("revit_list_levels")).document_id,"A");
await fails(()=>other.authorize("revit_list_levels"),"MODEL_LEASE_REQUIRED");
await fails(()=>registry.lease("wrong",confirmation),"PANEL_SESSION_NOT_PAIRED");

native={...native,revision:2,bound_id:"B",active_id:"B",bound_title:"Test B"};
await fails(()=>registry.lease(pairing.token,confirmation),"PANEL_BIND_CONFIRMATION_STALE");
await fails(()=>owner.authorize("revit_list_levels"),"MODEL_LEASE_REQUIRED");
assert.equal((await registry.lease(pairing.token,{...confirmation,revision:2,bound_id:"B"})).bound_title,"Test B");

const replacement=registry.begin(owner);
const rep=registry.claim(replacement.code);
await fails(()=>registry.lease(pairing.token,{...confirmation,revision:2,bound_id:"B"}),"PANEL_SESSION_NOT_PAIRED");
await registry.lease(rep.token,{...confirmation,revision:2,bound_id:"B"});
const expired=registry.begin(other);
now+=300001;
assert.throws(()=>registry.claim(expired.code),/PANEL_PAIR_CODE_INVALID_OR_EXPIRED/);
now+=8*3600000;
await fails(()=>registry.lease(rep.token,{...confirmation,revision:2,bound_id:"B"}),"PANEL_SESSION_NOT_PAIRED");

const bounded=new PanelPairingRegistry({maxEntries:1});
bounded.begin(owner);
assert.throws(()=>bounded.begin(other),/PAIRING_CAPACITY_EXCEEDED/);
console.log("[PASS] One-time out-of-band panel pairing, per-MCP owner, token rotation, revision checks, expiry and negative controls.");
