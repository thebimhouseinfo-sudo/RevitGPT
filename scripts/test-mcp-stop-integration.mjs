import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import {z} from "zod";
import {AsyncLocalStorage} from "node:async_hooks";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {createSessionManager,isInitializeRequest,isPriorityControlRequest} from "../src/mcp-session-manager.mjs";
import {createWorkTracker} from "../src/work-tracker.mjs";
import {effectForTool,wrapToolRegistration} from "../src/tool-effects.mjs";

const root=await mkdtemp(path.join(os.tmpdir(),"rg-stop-integration-"));
const ctx=new AsyncLocalStorage();
let firstStarted,releaseFirst,stopCalls=0;
const entered=new Promise(resolve=>firstStarted=resolve);
const held=new Promise(resolve=>releaseFirst=resolve);
const tracker=await createWorkTracker({
  filePath:path.join(root,"state","journal.json"),
  onDrained:async()=>{stopCalls++;}
});
function buildServer() {
  const server=new McpServer({name:"rg-stop-test",version:"0.1.0"});
  wrapToolRegistration(server,{
    tracker,isAwake:()=>true,
    reservationIdProvider:()=>ctx.getStore()?.reservedId??null
  });
  server.registerTool("file_search",{
    description:"Simulated long read",inputSchema:{root:z.string(),query:z.string()}
  },async()=>{
    firstStarted();
    await held;
    return {content:[{type:"text",text:"search complete"}]};
  });
  server.registerTool("file_read",{
    description:"Second accepted queued business tool",inputSchema:{path:z.string()}
  },async()=>{
    return {content:[{type:"text",text:"read complete"}]};
  });
  server.registerTool("revitgpt_command",{
    description:"Test stop control",inputSchema:{command:z.string()}
  },async({command})=>{
    if(command!=="rg/stop")throw new Error("UNKNOWN_TEST_COMMAND");
    const status=await tracker.requestStop();
    return {content:[{type:"text",text:status.status}],structuredContent:status};
  });
  return server;
}
const app=express();app.use(express.json());
const route="/mcp/isolated";
let sessions;
app.post(route,async(req,res)=>{
  let reservedId=null;
  try{
    const id=req.headers["mcp-session-id"];
    const body=req.body;
    if(id&&body?.jsonrpc==="2.0"&&body.method==="tools/call"&&
       !isPriorityControlRequest(body)&&body.params?.name){
      const name=body.params.name,inputs=body.params.arguments??{};
      const effect=effectForTool(name,inputs);
      if(effect!=="CONTROL")
        reservedId=await tracker.admit(name,effect,inputs);
    }
    await ctx.run({reservedId},async()=>{
      try{
        const existing=id?sessions.get(id):null;
        if(existing)await sessions.handleExisting(existing,req,res,body);
        else if(isInitializeRequest(body))await sessions.createNew(req,res,body);
        else sessions.sendNotFound(res);
      }finally{
        if(reservedId)await tracker.cancelIfNotStarted(reservedId);
      }
    });
  }catch(error){
    if(!res.headersSent)res.status(500).json({error:String(error)});
  }
});
const http=await new Promise(resolve=>{
  const server=app.listen(0,"127.0.0.1",()=>resolve(server));
});
const port=http.address().port;
sessions=createSessionManager(port,buildServer);
async function post(body,sid,version){
  const headers={"content-type":"application/json",
    accept:"application/json, text/event-stream"};
  if(sid)headers["mcp-session-id"]=sid;
  if(version)headers["mcp-protocol-version"]=version;
  const response=await fetch("http://127.0.0.1:"+port+route,{
    method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(24000)
  });
  const text=await response.text();
  let json;
  try{json=JSON.parse(text);}catch{json={raw:text};}
  return {status:response.status,sessionId:response.headers.get("mcp-session-id"),json};
}
const call=(id,name,args)=>({jsonrpc:"2.0",id,method:"tools/call",
  params:{name,arguments:args}});
async function until(predicate,label){
  for(let i=0;i<150;i++){
    if(predicate())return;
    await new Promise(r=>setTimeout(r,20));
  }
  throw new Error("TIMED_OUT_WAITING_FOR_"+label);
}
try{
  const init=await post({jsonrpc:"2.0",id:1,method:"initialize",params:{
    protocolVersion:"2025-11-25",capabilities:{},
    clientInfo:{name:"rg-stop-test",version:"0.1.0"}
  }});
  assert.equal(init.status,200,JSON.stringify(init.json));
  const sid=init.sessionId;
  assert.ok(sid,"MCP server must return session ID");
  const ready=await post({jsonrpc:"2.0",method:"notifications/initialized"},sid,"2025-11-25");
  assert.ok([200,202].includes(ready.status),JSON.stringify(ready.json));

  // A live idle MCP transport must not be evicted merely because an old
  // configured TTL has elapsed. Its process/session resource is distinct from
  // global awake/bound-model intent. Actual client DELETE is the cleanup proof.
  process.env.MCP_SESSION_TTL_MS = "1";
  sessions.startCleanup();
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.ok(sessions.get(sid),"live idle MCP transport must survive former TTL");

  const first=post(call(2,"file_search",{root:"workspace",query:"test"}),sid,"2025-11-25");
  await entered;
  const second=post(call(3,"file_read",{path:"workspace/a.md"}),sid,"2025-11-25");
  await until(()=>tracker.status().active_count===2,"TWO_DURABLY_ADMITTED_REQUESTS");

  const stopped=await post(call(4,"revitgpt_command",{command:"rg/stop"}),sid,"2025-11-25");
  assert.equal(stopped.status,200,JSON.stringify(stopped.json));
  assert.equal(stopped.json.result?.structuredContent?.status,"BUSY",
    "priority stop must report BUSY before long request completes");
  assert.equal(stopped.json.result?.structuredContent?.active_count,2,
    "even a queued HTTP request admitted before stop must be counted");
  assert.equal(stopCalls,0);

  const late=await post(call(5,"file_read",{path:"workspace/late.md"}),sid,"2025-11-25");
  assert.notEqual(late.status,200,"new request after stop must fail closed");
  assert.equal(tracker.status().active_count,2,"late request not admitted");

  releaseFirst();
  const [one,two]=await Promise.all([first,second]);
  assert.equal(one.status,200,JSON.stringify(one.json));
  assert.equal(two.status,200,JSON.stringify(two.json));
  await until(()=>tracker.status().mode==="STOPPED","AUTOMATIC_QUIESCENCE");
  assert.equal(stopCalls,1);
  assert.equal(tracker.status().active_count,0);
  assert.equal(tracker.status().unresolved_count,0);
  console.log("[PASS] Actual Streamable MCP same-session priority stop: BUSY 2 accepted, deny late request, drain and stop once.");
}finally{
  releaseFirst?.();
  await sessions.closeAll("test shutdown");
  await new Promise(resolve=>http.close(resolve));
  await rm(root,{recursive:true,force:true});
}
