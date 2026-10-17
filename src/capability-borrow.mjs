// In-process, nonexclusive capability-use bookkeeping; NOT a tool lock or permission.
const useByRun=new Map();
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
function checked(value){if(typeof value!=="string"||!ID.test(value))throw new Error("CAPABILITY_INVALID_ID");return value;}
export function capabilityBorrow(jobRunId,capabilityId){
  const run=checked(jobRunId),cap=checked(capabilityId);
  let used=useByRun.get(run);
  if(!used){used=new Set();useByRun.set(run,used);}
  used.add(cap);
  return {job_run_id:run,capability_id:cap,borrowed:true,exclusive:false};
}
export function capabilityRelease(jobRunId,capabilityId){
  const run=checked(jobRunId);
  const used=useByRun.get(run);
  if(!used)return {job_run_id:run,released:0};
  if(capabilityId!==undefined){const cap=checked(capabilityId);const had=used.delete(cap);if(!used.size)useByRun.delete(run);return {job_run_id:run,released:had?1:0};}
  const count=used.size;useByRun.delete(run);return {job_run_id:run,released:count};
}
export function capabilityBorrowStatus(jobRunId){
  const run=checked(jobRunId);
  return {job_run_id:run,capability_ids:[...(useByRun.get(run)||[])].sort(),exclusive:false};
}
