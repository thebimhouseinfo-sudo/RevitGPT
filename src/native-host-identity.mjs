import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getWindowsBootSessionId } from "./awake-intent.mjs";

const HOST=/^[a-f0-9]{32}$/i;
const BOOT=/^[a-f0-9]{64}$/i;

export async function createNativeHostIdentity({
  filePath,fsApi=fs,sessionIdProvider=getWindowsBootSessionId,processState=async()=>({observable:false,processes:[]})
}={}) {
  if(typeof filePath!=="string"||!filePath)throw new Error("NATIVE_HOST_IDENTITY_PATH_REQUIRED");
  const bootId=await sessionIdProvider();
  let pinned=null,reason="UNPINNED";
  if(BOOT.test(bootId ?? "")){
    try {
      const d=JSON.parse(await fsApi.readFile(filePath,"utf8"));
      if(d.version===1&&d.boot_session_id===bootId&&HOST.test(d.host_instance_id)){
        pinned=d.host_instance_id;
        reason="SAME_BOOT_HOST_RESTORED";
      }else if(d.version===1 && d.boot_session_id!==bootId){
        reason="NEW_BOOT_REQUIRES_NEW_HOST";
      }
    }catch(error){
      if(error?.code!=="ENOENT")reason="HOST_RECORD_UNVERIFIED";
    }
  }else{reason="BOOT_IDENTITY_UNVERIFIED";}
  let chain=Promise.resolve();

  async function observe(snapshot) {
    const incoming=snapshot?.host_instance_id;
    if(!HOST.test(incoming ?? ""))
      throw new Error("NATIVE_HOST_IDENTITY_INVALID");
    const action=chain.catch(()=>undefined).then(async()=>{
      if(pinned===incoming)return {host_instance_id:pinned,reason:"SAME_AUTHORITATIVE_HOST"};
      if(pinned && snapshot.manual_binding!==true){
        // Recover after a Revit restart only when the OS confirms the new
        // native host is the single running Revit.exe, and Native has exactly
        // one open project already bound automatically.
        const state=await processState();
        const pids=state?.processes;
        const autoRecovery=snapshot.status==="BOUND_CURRENT" &&
          snapshot.manual_binding===false &&
          snapshot.open_project_count===1 &&
          Number.isSafeInteger(snapshot.host_process_id) &&
          state?.observable===true && Array.isArray(pids) &&
          pids.length===1 && pids[0]?.pid===snapshot.host_process_id;
        if(!autoRecovery)
          throw new Error("NATIVE_HOST_TAKEOVER_DENIED: use explicit Bind Current on the new Revit host");
      }
      // A new host's automatic one-model bootstrap is insufficient to take
      // control away from an already pinned, different Revit.exe process.
      // The first observed host is allowed to adopt its initial single
      // project; host replacement requires manual binding evidence.
      if(BOOT.test(bootId ?? "")){
        const record={
          version:1,boot_session_id:bootId,host_instance_id:incoming,
          updated_at:new Date().toISOString(),manual_takeover:Boolean(pinned)
        };
        const tmp=filePath+".tmp-"+randomUUID();
        await fsApi.mkdir(path.dirname(filePath),{recursive:true});
        try{
          await fsApi.writeFile(tmp,JSON.stringify(record)+"\n","utf8");
          await fsApi.rename(tmp,filePath);
        }catch(error){
          await fsApi.unlink(tmp).catch(()=>undefined);
          throw error; // fail closed; never accept a transient identity
        }
      }
      reason=pinned?(snapshot.manual_binding===true?"EXPLICIT_HOST_REBOUND":"VERIFIED_SINGLE_HOST_AUTO_REBOUND"):"FIRST_BOUND_HOST_PINNED";
      pinned=incoming;
      return {host_instance_id:pinned,reason};
    });
    chain=action;
    return action;
  }
  return Object.freeze({
    observe,
    status:()=>({host_instance_id:pinned,reason,persistence_verified:BOOT.test(bootId ?? "")})
  });
}
