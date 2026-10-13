import { randomUUID } from "node:crypto";

const NATIVE_ID=/native_operation_id=([A-Za-z0-9_.-]{1,128})/;
const HOST_ID=/^[a-f0-9]{32}$/i;
const TERMINAL={
  TERMINAL_SUCCESS:"TERMINAL_COMPLETED",
  TERMINAL_FAILURE:"TERMINAL_FAILURE",
  CANCELED_BEFORE_START:"NOT_STARTED",
  FAILED_BEFORE_START:"NOT_STARTED"
};

export async function inspectNativeOutcome(op,{
  bridgeUrl="http://127.0.0.1:8765",fetchImpl=fetch,
  requestIdFactory=randomUUID,timeoutMs=2500
}={}) {
  if(!op || !["MODEL_MUTATION","UI_SIDE_EFFECT"].includes(op.effect) ||
     !["OUTCOME_UNKNOWN","PARTIAL"].includes(op.phase))
    return {verdict:"NOT_APPLICABLE"};
  const expectedHost=op.native?.host_instance_id;
  const actualOpId=String(op.reason ?? "").match(NATIVE_ID)?.[1];
  if(!HOST_ID.test(expectedHost ?? "") || !actualOpId)
    return {verdict:"UNRESOLVED",reason:"NATIVE_ID_OR_HOST_RECEIPT_MISSING"};

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchImpl(bridgeUrl.replace(/\/$/,"")+"/operation/status",{
      method:"POST",
      headers:{"X-Request-ID":requestIdFactory(),"Content-Type":"application/json"},
      body:JSON.stringify({operation_id:actualOpId}),
      signal:controller.signal
    });
    if(!response.ok)return {verdict:"UNRESOLVED",reason:"NATIVE_STATUS_HTTP_"+response.status};
    const body=await response.json();
    const data=body?.data;
    if(!data || data.operation_id!==actualOpId)
      return {verdict:"UNRESOLVED",reason:"NATIVE_STATUS_RECEIPT_MISMATCH"};
    if(data.host_instance_id!==expectedHost)
      return {verdict:"UNRESOLVED",reason:"NATIVE_HOST_GENERATION_CHANGED"};
    if(data.phase==="NOT_FOUND")
      return {verdict:"UNRESOLVED",reason:"NATIVE_STATUS_NOT_FOUND_NOT_PROOF_OF_NONEXECUTION"};
    const phase=TERMINAL[data.phase];
    if(phase)
      return {verdict:"TERMINAL_PROVEN",phase,reason:"NATIVE_HOST_SCOPED_"+data.phase};
    if(data.phase==="PENDING"||data.phase==="EXECUTING")
      return {verdict:"UNRESOLVED",reason:"NATIVE_STILL_"+data.phase};
    return {verdict:"UNRESOLVED",reason:"NATIVE_PHASE_UNKNOWN"};
  }catch(error){
    return {verdict:"UNRESOLVED",reason:"NATIVE_STATUS_UNREACHABLE",
      detail:error instanceof Error?error.message:String(error)};
  }finally{clearTimeout(timer);}
}

/**
 * Read-only Native reconciliation. No tool execution, no Python startup, no
 * replay and no automatic rebind. A Native completed callback is terminal
 * even if the original API error/result payload is lost: COMPLETED does not
 * falsely claim the RVT transaction succeeded.
 */
export async function reconcileNativeOutcomes(tracker,options={}) {
  if(typeof tracker?.unresolvedOperations!=="function")return [];
  const reports=[];
  const maxOperations=Math.max(1,Math.min(32,Number(options.maxOperations)||8));
  for(const op of tracker.unresolvedOperations().filter(op=>
    ["UI_SIDE_EFFECT","MODEL_MUTATION"].includes(op.effect)).slice(0,maxOperations)) {
    let decision=await inspectNativeOutcome(op,options);
    if(decision.verdict==="TERMINAL_PROVEN"){
      try{await tracker.settle(op.id,decision.phase,decision.reason);}
      catch(error){decision={verdict:"UNRESOLVED",reason:"NATIVE_JOURNAL_SETTLE_FAILED",
        detail:error instanceof Error?error.message:String(error)};}
    }
    reports.push({id:op.id,tool:op.tool,...decision});
  }
  return reports;
}
