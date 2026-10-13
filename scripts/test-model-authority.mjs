import assert from "node:assert/strict";
import { createServer } from "node:http";
import { SessionModelAuthority, fetchNativeBindingStatus } from "../src/model-authority.mjs";

let state={status:"NOT_BOUND",host_instance_id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  revision:0,active_id:"A",bound_id:null,bound_title:""};
const calls=[];
const server=createServer((req,res)=>{
  calls.push({path:req.url,id:req.headers["x-request-id"]});
  if(!req.headers["x-request-id"]){res.writeHead(400).end();return;}
  res.writeHead(200,{"content-type":"application/json"});
  res.end(JSON.stringify({data:state}));
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const url="http://127.0.0.1:"+server.address().port;
const read=()=>fetchNativeBindingStatus(url);
const first=new SessionModelAuthority(read),second=new SessionModelAuthority(read);
async function fails(fn,match){await assert.rejects(fn,new RegExp(match));}
try {
  await fails(()=>first.authorize("revit_list_levels"),"NATIVE_BINDING_INVALID_RESPONSE");
  assert.deepEqual(await first.authorize("revit_list_documents"),{});
  await fails(()=>first.authorize("revit_delete_elements"),"NATIVE_BINDING_INVALID_RESPONSE");
  await fails(()=>first.authorize("revit_unknown_mutation"),"MODEL_TOOL_NOT_ALLOWED");
  state={...state,status:"BOUND_CURRENT",revision:1,bound_id:"A",bound_title:"Test A"};
  assert.deepEqual(await first.authorize("revit_list_levels",{category:"Ducts"}),
    {category:"Ducts",document_id:"A"});
  assert.equal((await second.authorize("revit_list_levels")).document_id,"A",
    "independent admitted session reads same native binding without pairing");
  assert.deepEqual(await first.authorize("revit_set_parameter",{
    element_id:"42",parameter:"Mark",value:"0012"
  }),{element_id:"42",parameter:"Mark",value:"0012",document_id:"A"},
  "Node forwards exact WRITE to the current native-bound model only");
  await fails(()=>first.authorize("revit_delete_elements",{document_id:"B",element_ids:["42"]}),
    "DOCUMENT_ID_MISMATCH");
  await fails(()=>first.authorize("revit_list_levels",{document_id:"B"}),"DOCUMENT_ID_MISMATCH");
  await fails(()=>first.authorize("revit_list_levels",{document_id:null}),"DOCUMENT_ID_MISMATCH");
  await fails(()=>first.authorize("revit_list_levels",null),"MODEL_TOOL_ARGUMENTS_INVALID");
  state={...state,status:"BOUND_OTHER_ACTIVE",active_id:"B"};
  await fails(()=>first.authorize("revit_list_levels"),"MODEL_BINDING_NOT_CURRENT");
  state={...state,status:"BOUND_CURRENT",active_id:"A"};
  assert.equal((await first.authorize("revit_list_levels")).document_id,"A");
  state={...state,status:"BOUND_CLOSED",active_id:"B"};
  await fails(()=>first.authorize("revit_list_levels"),"MODEL_BINDING_NOT_CURRENT");
  state={...state,status:"BOUND_CURRENT",revision:2,active_id:"B",
    bound_id:"B",bound_title:"Test B"};
  assert.equal((await first.authorize("revit_list_levels")).document_id,"B",
    "explicitly rebound project immediately follows on next read");
  state={...state,host_instance_id:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",revision:1};
  assert.equal((await first.authorize("revit_list_levels")).document_id,"B",
    "new native host may be read only after fresh binding");
  state={...state,status:"NOT_BOUND",revision:0,bound_id:null};
  await fails(()=>first.authorize("revit_list_levels"),"NATIVE_BINDING_INVALID_RESPONSE");
  await fails(()=>fetchNativeBindingStatus(url,{fetchImpl:async()=>({
    ok:false,status:503
  })}),"NATIVE_BINDING_UNAVAILABLE");
  assert.ok(calls.every(c=>c.path==="/binding/status"&&c.id));
  assert.equal(new Set(calls.map(c=>c.id)).size,calls.length);
  console.log("[PASS] Bound-model read/write admission; mismatch, closed model and restart fail closed.");
} finally {
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
}
