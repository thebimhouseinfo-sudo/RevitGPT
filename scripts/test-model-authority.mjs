import assert from "node:assert/strict";
import { createServer } from "node:http";
import { SessionModelAuthority, fetchNativeBindingStatus } from "../src/model-authority.mjs";

let state = {
  status:"NOT_BOUND",host_instance_id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  revision:0,active_id:"A",bound_id:null,bound_title:""
};
const calls=[];
const server=createServer((req,res)=>{
  calls.push({path:req.url,id:req.headers["x-request-id"]});
  if (!req.headers["x-request-id"]) {res.writeHead(400).end();return;}
  res.writeHead(200,{"content-type":"application/json"});
  res.end(JSON.stringify({data:state}));
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const url="http://127.0.0.1:"+server.address().port;
const read=()=>fetchNativeBindingStatus(url);
const first=new SessionModelAuthority(read),second=new SessionModelAuthority(read);
async function fails(fn,msg){await assert.rejects(fn,new RegExp(msg));}
try {
  assert.equal((await read()).status,"NOT_BOUND");
  await fails(()=>first.leaseCurrent(),"NATIVE_BINDING_INVALID_RESPONSE");
  await fails(()=>first.authorize("revit_list_levels"),"MODEL_LEASE_REQUIRED");
  assert.deepEqual(await first.authorize("revit_list_documents"),{});
  await fails(()=>first.authorize("revit_delete_elements"),"NATIVE_MUTATIONS_NOT_ENABLED");

  state={status:"BOUND_CURRENT",host_instance_id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    revision:1,active_id:"A",bound_id:"A",bound_title:"Test A"};
  assert.equal((await first.leaseCurrent()).bound_id,"A");
  assert.equal(first.summary().permission,"read_only");
  await fails(()=>second.authorize("revit_list_levels"),"MODEL_LEASE_REQUIRED");
  assert.deepEqual(await first.authorize("revit_list_levels",{category:"Ducts"}),
    {category:"Ducts",document_id:"A"});
  await fails(()=>first.authorize("revit_list_levels",{document_id:"B"}),"DOCUMENT_ID_MISMATCH");

  state={...state,active_id:"B",status:"BOUND_OTHER_ACTIVE"};
  await fails(()=>first.authorize("revit_list_levels"),"MODEL_BINDING_NOT_CURRENT");
  state={...state,active_id:"A",status:"BOUND_CURRENT"};
  assert.equal((await first.authorize("revit_list_levels")).document_id,"A");

  state={...state,status:"BOUND_CLOSED",active_id:"B"};
  await fails(()=>first.authorize("revit_list_levels"),"MODEL_BINDING_NOT_CURRENT");
  state={...state,status:"BOUND_CURRENT",active_id:"A",revision:2};
  await fails(()=>first.authorize("revit_list_levels"),"MODEL_LEASE_STALE");
  await fails(()=>first.authorize("revit_list_levels"),"MODEL_LEASE_REQUIRED");
  await first.leaseCurrent();

  state={...state,host_instance_id:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"};
  await fails(()=>first.authorize("revit_list_levels"),"MODEL_LEASE_STALE");
  state={...state,status:"NOT_BOUND",bound_id:null,revision:0};
  await fails(()=>first.leaseCurrent(),"NATIVE_BINDING_INVALID_RESPONSE");

  await fails(()=>fetchNativeBindingStatus(url,{fetchImpl:async()=>({
    ok:true,status:200,json:async()=>({data:null})
  })}),"NATIVE_BINDING_INVALID_RESPONSE");
  await fails(()=>fetchNativeBindingStatus(url,{fetchImpl:async()=>({
    ok:false,status:404
  })}),"NATIVE_BINDING_UNAVAILABLE");
  assert.ok(calls.every(c=>c.path==="/binding/status"&&c.id));
  assert.equal(new Set(calls.map(c=>c.id)).size,calls.length);
  console.log("[PASS] Session-bound read-only lease, model mismatch, close/reopen, stale revision, restart and denied writes.");
} finally {
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
}
