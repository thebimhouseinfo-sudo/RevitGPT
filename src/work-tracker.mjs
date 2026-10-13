import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * P1 control-plane operation journal. NOT a P3 Job Runtime.
 * Storage: one JSON snapshot, atomic replace; all transitions serialized.
 * No operation is dispatched until durable ADMITTED and EXECUTING records exist.
 */
const VERSION = 1;
const EFFECTS = new Set(["READ_ONLY", "UI_SIDE_EFFECT", "MODEL_MUTATION", "SYSTEM_SIDE_EFFECT"]);
const TERMINAL = new Set(["TERMINAL_SUCCESS", "TERMINAL_FAILURE", "TERMINAL_COMPLETED", "NOT_STARTED"]);
const RETAIN = 300;
const operationContext = new AsyncLocalStorage();
export function currentOperationId() { return operationContext.getStore()?.id ?? null; }

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex");
}
function compactArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const keys = ["path", "destination_path", "source_path", "relative_path", "library_id",
    "execution_id", "id", "name", "kind", "title", "document_id", "expected_sha256"];
  const out = {};
  for (const key of keys) {
    if (typeof args[key] === "string") out[key] = args[key].slice(0, 2048);
  }
  if (typeof args.content === "string") out.content_sha256 = createHash("sha256").update(args.content).digest("hex");
  return out;
}
function safeSnapshot(data) {
  if (!data || data.version !== VERSION || !Array.isArray(data.operations) ||
      !["OPEN", "STOP_PENDING", "STOPPED"].includes(data.mode)) {
    throw new Error("WORK_JOURNAL_INVALID: cannot assume a corrupted journal is empty");
  }
  const ids = new Set();
  for (const op of data.operations) {
    if (typeof op.id !== "string" || ids.has(op.id) || typeof op.tool !== "string" ||
        !EFFECTS.has(op.effect) || typeof op.phase !== "string") {
      throw new Error("WORK_JOURNAL_INVALID: invalid operation record");
    }
    ids.add(op.id);
  }
  return data;
}
function snapshotState(data) {
  const active = data.operations.filter(op=>op.phase==="ADMITTED"||op.phase==="EXECUTING");
  const unresolved = data.operations.filter(op=>op.phase==="OUTCOME_UNKNOWN"||op.phase==="PARTIAL");
  return {
    mode:data.mode,
    active_count:active.length,
    unresolved_count:unresolved.length,
    active_ids:active.map(x=>x.id),
    unresolved_ids:unresolved.map(x=>x.id),
    stop_pending:data.mode==="STOP_PENDING",
    safety_state:unresolved.length?"STOP_BLOCKED" : active.length?"BUSY" : "CLEAR"
  };
}
async function writeAtomic(fsApi,filePath,data){
  await fsApi.mkdir(path.dirname(filePath),{recursive:true});
  const tmp=filePath+".tmp-"+randomUUID();
  try{
    await fsApi.writeFile(tmp,JSON.stringify(data,null,2)+"\n","utf8");
    await fsApi.rename(tmp,filePath);
  }catch(error){
    await fsApi.unlink(tmp).catch(()=>undefined);
    throw error;
  }
}
const clone = x=>JSON.parse(JSON.stringify(x));

export async function createWorkTracker({
  filePath, fsApi=fs, onDrained=async()=>{}, now=()=>new Date().toISOString(),
  idFactory=randomUUID
}={}){
  if(typeof filePath!=="string"||!filePath)throw new Error("WORK_JOURNAL_PATH_REQUIRED");
  let data={version:VERSION,mode:"OPEN",epoch:1,operations:[],updated_at:now()};
  try{
    const record=JSON.parse(await fsApi.readFile(filePath,"utf8"));
    data=safeSnapshot(record);
  }catch(error){
    if(error?.code!=="ENOENT")throw error;
  }
  // Previously EXECUTING mutations might have completed despite a Node crash.
  // Never guess non-execution, and never automatically replay after restart.
  let dirty=false;
  for(const op of data.operations){
    if(op.phase==="EXECUTING"){
      op.phase=op.effect==="READ_ONLY"?"TERMINAL_FAILURE":"OUTCOME_UNKNOWN";
      op.recovered_from_crash=true;
      dirty=true;
    }
    // ADMITTED is pre-dispatch: write barrier was not passed.
    if(op.phase==="ADMITTED"){
      op.phase="NOT_STARTED";
      op.recovered_from_crash=true;
      dirty=true;
    }
  }
  if(dirty){
    data.updated_at=now();
    await writeAtomic(fsApi,filePath,data);
  }

  let serialization=Promise.resolve();
  let drainRunning=false;
  function transition(fn){
    const current=serialization.catch(()=>undefined).then(async()=>{
      const updated=clone(data);
      const answer=await fn(updated);
      updated.updated_at=now();
      const completed=updated.operations.filter(op=>TERMINAL.has(op.phase));
      const retained=new Set(completed.slice(-RETAIN).map(op=>op.id));
      updated.operations=updated.operations.filter(op=>!TERMINAL.has(op.phase)||retained.has(op.id));
      await writeAtomic(fsApi,filePath,updated);
      data=updated;
      return answer;
    });
    serialization=current;
    return current;
  }
  async function drain(){
    if(drainRunning)return;
    const state=snapshotState(data);
    if(state.mode!=="STOP_PENDING"||state.active_count||state.unresolved_count)return;
    drainRunning=true;
    try{
      // Do not report stopped or mutate the persistent stop marker until
      // global awake intent was durably cleared.
      await onDrained();
      await transition(d=>{
        if(d.mode==="STOP_PENDING" && snapshotState(d).active_count===0 &&
            snapshotState(d).unresolved_count===0)d.mode="STOPPED";
      });
    }finally{drainRunning=false;}
  }
  function status(){return {...snapshotState(data),epoch:data.epoch};}
  function unresolvedOperations(){return clone(data.operations.filter(op=>op.phase==="OUTCOME_UNKNOWN"||op.phase==="PARTIAL"));}

  async function admit(tool,effect,args={}){
    if(!EFFECTS.has(effect))throw new Error("WORK_EFFECT_UNCLASSIFIED");
    if(!tool||typeof tool!=="string")throw new Error("WORK_TOOL_NAME_REQUIRED");
    const id=idFactory();
    await transition(d=>{
      if(d.mode!=="OPEN")throw new Error("STOP_PENDING: no unrelated new work accepted");
      const state=snapshotState(d);
      if(state.unresolved_count && effect!=="READ_ONLY")
        throw new Error("WORK_OUTCOME_UNRESOLVED: reconcile prior side effect");
      d.operations.push({
        id,tool,effect,phase:"ADMITTED",args_digest:digest(args),targets:compactArgs(args),
        accepted_at:now()
      });
    });
    return id;
  }
  async function begin(id){
    await transition(d=>{
      const op=d.operations.find(x=>x.id===id);
      if(!op||op.phase!=="ADMITTED")throw new Error("WORK_NOT_ADMITTED");
      // An already admitted operation may start while STOP_PENDING, but no
      // other work may start. This is a continuation of accepted work.
      op.phase="EXECUTING";
      op.executing_at=now();
    });
  }
  async function noteNativeHandoff(id, host) {
    if (!host || !/^[0-9a-f]{32}$/i.test(host.host_instance_id ?? "") ||
        typeof host.bound_id !== "string" || !host.bound_id)
      throw new Error("NATIVE_HANDOFF_IDENTITY_INVALID");
    await transition(d=>{
      const op=d.operations.find(x=>x.id===id);
      if(!op||op.phase!=="EXECUTING")
        throw new Error("NATIVE_HANDOFF_WORK_NOT_EXECUTING");
      op.native={
        host_instance_id:host.host_instance_id,
        bound_id:host.bound_id,
        revision:host.revision,
        dispatch_attempted_at:now()
      };
    });
  }
  async function settle(id,phase,reason){
    if(!TERMINAL.has(phase)&&phase!=="OUTCOME_UNKNOWN"&&phase!=="PARTIAL")
      throw new Error("WORK_INVALID_TERMINAL_STATE");
    await transition(d=>{
      const op=d.operations.find(x=>x.id===id);
      if(!op||(!["EXECUTING","ADMITTED","OUTCOME_UNKNOWN","PARTIAL"].includes(op.phase)))
        throw new Error("WORK_NOT_ACTIVE");
      op.phase=phase;
      op.finished_at=now();
      if(reason)op.reason=String(reason).slice(0,500);
    });
    try{await drain();}
    catch{ /* failure to clear awake is reflected by STOP_PENDING; caller's
              operation already reached its known terminal outcome */ }
  }
  async function execute(id,effect,callback){
    try{
      await begin(id);
    }catch(error){
      // Begin persisted BEFORE invoking callback; failed begin proves no
      // tool execution happened (unless an independent host already accepted
      // a previous correlated child operation, tracked separately in P1-C).
      await settle(id,"NOT_STARTED","EXECUTION_ADMISSION_FAILED").catch(()=>undefined);
      throw error;
    }
    try{
      const value=await operationContext.run({id,effect},callback);
      const isError=Boolean(value?.isError||value?.structuredContent?.result?.isError);
      if(isError){
        await settle(id,effect==="READ_ONLY"?"TERMINAL_FAILURE":"OUTCOME_UNKNOWN","MCP_TOOL_RESULT_IS_ERROR");
      }else{
        await settle(id,"TERMINAL_SUCCESS");
      }
      return value;
    }catch(error){
      // A side effect might have committed before its response disappeared.
      const phase=effect==="READ_ONLY"?"TERMINAL_FAILURE":"OUTCOME_UNKNOWN";
      await settle(id,phase,error instanceof Error?error.message:String(error)).catch(()=>undefined);
      throw error;
    }
  }
  async function run(tool,effect,args,callback){
    return execute(await admit(tool,effect,args),effect,callback);
  }
  async function runAdmitted(id,tool,effect,callback){
    const op=data.operations.find(x=>x.id===id);
    if(!op||op.tool!==tool||op.effect!==effect||op.phase!=="ADMITTED")
      throw new Error("WORK_RESERVATION_MISMATCH");
    // This was durably admitted at HTTP receive-time, before the stop fence.
    return execute(id,effect,callback);
  }
  async function cancelIfNotStarted(id){
    const canceled=await transition(d=>{
      const op=d.operations.find(x=>x.id===id);
      if(!op||op.phase!=="ADMITTED")return false;
      op.phase="NOT_STARTED";
      op.finished_at=now();
      op.reason="SDK_REJECTED_BEFORE_TOOL_CALLBACK";
      return true;
    });
    if(canceled)await drain().catch(()=>undefined);
    return canceled;
  }
  async function requestStop(){
    await transition(d=>{if(d.mode==="OPEN")d.mode="STOP_PENDING";});
    const state=status();
    if(state.active_count)return {status:"BUSY",...state};
    if(state.unresolved_count)return {status:"STOP_BLOCKED",...state};
    await drain();
    return {status:data.mode==="STOPPED"?"STOPPED":"STOP_PENDING",...status()};
  }
  async function reopen(){
    await transition(d=>{
      if(d.mode==="STOP_PENDING")throw new Error("STOP_PENDING: cannot cancel draining stop");
      if(snapshotState(d).unresolved_count)
        throw new Error("STOP_BLOCKED: reconcile unresolved operations before new work");
      if(d.mode==="STOPPED"){d.mode="OPEN";d.epoch++;}
    });
    return status();
  }
  return Object.freeze({status,unresolvedOperations,admit,begin,noteNativeHandoff,settle,run,runAdmitted,cancelIfNotStarted,requestStop,reopen});
}

/**
 * Control-plane emergency mode when the durable journal cannot be trusted.
 * Keep status/stop available, but do NOT clear evidence or admit business work.
 */
export function createBlockedWorkTracker(error) {
  const reason=error instanceof Error?error.message:String(error);
  const state=Object.freeze({
    mode:"STOP_PENDING",epoch:0,active_count:0,unresolved_count:1,
    active_ids:[],unresolved_ids:["JOURNAL_UNVERIFIED"],
    stop_pending:true,safety_state:"STOP_BLOCKED",recovery_error:reason
  });
  const deny=async()=>{throw new Error("WORK_JOURNAL_UNVERIFIED: "+reason);};
  return Object.freeze({
    status:()=>state,unresolvedOperations:()=>[],requestStop:async()=>({status:"STOP_BLOCKED",...state}),
    admit:deny,begin:deny,noteNativeHandoff:deny,settle:deny,run:deny,runAdmitted:deny,
    cancelIfNotStarted:async()=>false,reopen:deny
  });
}
