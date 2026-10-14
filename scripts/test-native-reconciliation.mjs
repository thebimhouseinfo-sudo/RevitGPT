import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkTracker } from "../src/work-tracker.mjs";
import { inspectNativeOutcome, reconcileNativeOutcomes } from "../src/native-reconciliation.mjs";

const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"rg-native-reconcile-"));
const HOST_A="a".repeat(32),HOST_B="b".repeat(32);
const ids=["n1","n2","n3","n4","n5"];
let cursor=0,reads=0;
try{
  const tracker=await createWorkTracker({
    filePath:path.join(tmp,"journal.json"),idFactory:()=>ids[cursor++]
  });
  // Concurrency: all five were durably accepted before the first result
  // became unknown. New side effects must be rejected afterwards.
  const work=[];
  for(const opId of ids)
    work.push(await tracker.admit("revit_set_parameter","MODEL_MUTATION",{document_id:"BOUND"}));
  for(let i=0;i<work.length;i++){
    await tracker.begin(work[i]);
    await tracker.noteNativeHandoff(work[i],{
      host_instance_id:HOST_A,bound_id:"BOUND",revision:2
    });
    await tracker.settle(work[i],"OUTCOME_UNKNOWN","native_operation_id="+work[i]+"; HTTP 504");
  }
  const responseFor={n1:["TERMINAL_SUCCESS",HOST_A],n2:["FAILED_BEFORE_START",HOST_A],
    n3:["TERMINAL_SUCCESS",HOST_B],n4:["NOT_FOUND",HOST_A],n5:["EXECUTING",HOST_A]};
  const fetchImpl=async (_url,opts)=>{
    reads++;
    assert.equal(opts.method,"POST");
    assert.equal(opts.headers["Content-Type"],"application/json");
    assert.ok(opts.headers["X-Request-ID"]);
    const {operation_id}=JSON.parse(opts.body);
    const [phase,host_instance_id]=responseFor[operation_id];
    return {ok:true,json:async()=>({data:{operation_id,phase,host_instance_id}})};
  };
  const reopened=await createWorkTracker({filePath:path.join(tmp,"journal.json")});
  const reports=await reconcileNativeOutcomes(reopened,{fetchImpl,requestIdFactory:()=>"_query"});
  assert.equal(reads,5);
  assert.deepEqual(reports.filter(x=>x.verdict==="TERMINAL_PROVEN").map(x=>x.id),["n1","n2"]);
  assert.equal(reopened.status().unresolved_count,3,
    "new/different Native host or missing receipt must remain blocked");
  assert.equal((await reopened.requestStop()).status,"STOP_BLOCKED");
  assert.equal(reopened.unresolvedOperations().find(x=>x.id==="n3").native.host_instance_id,HOST_A);
  const phases=JSON.parse(await fs.readFile(path.join(tmp,"journal.json"),"utf8"))
    .operations.reduce((a,x)=>(a[x.id]=x.phase,a),{});
  assert.equal(phases.n1,"TERMINAL_COMPLETED",
    "a Native callback finished; lost result body is not proof of successful Revit mutation");
  assert.equal(phases.n2,"NOT_STARTED");
  assert.equal(phases.n3,"OUTCOME_UNKNOWN");
  assert.equal(phases.n4,"OUTCOME_UNKNOWN");
  assert.equal(phases.n5,"OUTCOME_UNKNOWN");

  const withoutReceipt={id:"never",tool:"revit_delete_elements",effect:"MODEL_MUTATION",
    phase:"OUTCOME_UNKNOWN",reason:"HTTP timeout",native:{host_instance_id:HOST_A}};
  const noId=await inspectNativeOutcome(withoutReceipt,{fetchImpl});
  assert.equal(noId.reason,"NATIVE_ID_OR_HOST_RECEIPT_MISSING");
  assert.equal(reads,5,"missing native ID never triggers a speculative probe");

  console.log("[PASS] Native crash reconciliation: same host+operation exact terminal, stale/missing/inflight remain STOP_BLOCKED, no replay or false success.");
}finally{await fs.rm(tmp,{recursive:true,force:true});}
