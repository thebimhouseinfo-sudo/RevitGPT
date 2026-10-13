import "dotenv/config";
import express from "express";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { revitUpstream } from "./revit-upstream.mjs";
import { createAwakeIntent } from "./awake-intent.mjs";
import { createWorkTracker, createBlockedWorkTracker } from "./work-tracker.mjs";
import { wrapToolRegistration, effectForTool } from "./tool-effects.mjs";
import { ensureAppDataLayout, getAppDataRoot } from "./appdata.mjs";
import { registerManagedTools } from "./managed-tools.mjs";
import { registerRevitMcpDevTools, isDevMode } from "./revit-mcp-dev.mjs";
import { createSessionManager, extractRequestId, isInitializeRequest, isPriorityControlRequest } from "./mcp-session-manager.mjs";
import { buildLegacyDiscoverFallback } from "./mcp-discover-compat.mjs";
import { logControl, logError, logToolCall } from "./log-store.mjs";
import { probeBridgeHealth } from "./bridge-health.mjs";
import { fetchNativeBindingStatus, SessionModelAuthority } from "./model-authority.mjs";
import { callReadOnlyTool, ensureReadRuntime } from "./read-intent-gate.mjs";
import { handleRetiredPanelCommand } from "./retired-panel-commands.mjs";
import { executeRevitCommand } from "./revit-fake-cli.mjs";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3300);
const TOKEN = (process.env.MCP_TOKEN || "").trim();
const BRIDGE_URL = (process.env.REVIT_BRIDGE_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
const STARTED_AT = Date.now();
const execFileAsync = promisify(execFile);
await ensureAppDataLayout();
await logControl({event:"runtime_start",pid:process.pid,appdata_root:getAppDataRoot(),dev_mode:isDevMode()});

if (!TOKEN) {
  throw new Error("MCP_TOKEN is required. Copy .env.example to .env and set a private random value.");
}

let shuttingDown = false;
const awakeIntent = await createAwakeIntent({
  filePath: path.join(getAppDataRoot(), "state", "awake-intent.json")
});
// The accepted-work fence and Native/SYSTEM completion journal are shared by
// all MCP transports. A new Node process cannot silently discard unknown work.
let workTracker;
try {
  workTracker = await createWorkTracker({
    filePath: path.join(getAppDataRoot(), "state", "work-journal.json"),
    onDrained: async () => {
      await awakeIntent.clearAfterDrain();
      await revitUpstream.deactivate();
      await logControl({event:"graceful_stop_completed"});
    }
  });
} catch (error) {
  // A corrupt/missing-authority journal is a safety incident, not an excuse to
  // mark STOPPED or render the minimal status/control surface unreachable.
  await logError({source:"work-journal-init",error:String(error)}).catch(()=>undefined);
  workTracker = createBlockedWorkTracker(error);
}
// Work was accepted on HTTP ingress even if a Streamable MCP transport must
// serialize or recover before its actual tool callback becomes runnable.
const requestContext = new AsyncLocalStorage();

const ensureExplicitReadReady = () => ensureReadRuntime({
  upstream: revitUpstream,
  processState: revitProcessState,
  bridgeState: bridgeHealth,
  awakeIntent
});

async function revitProcessState() {
  if (process.platform !== "win32") {
    return { observable: false, running: null, processes: [], reason: "WINDOWS_ONLY" };
  }

  try {
    const { stdout } = await execFileAsync(
      "tasklist.exe",
      ["/FI", "IMAGENAME eq Revit.exe", "/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 3000 }
    );

    const lines = String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("INFO:"));

    const processes = lines.flatMap((line) => {
      const match = line.match(/^"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"$/);
      if (!match) return [];
      return [{
        image_name: match[1],
        pid: Number(match[2]) || null,
        session_name: match[3],
        session_number: Number(match[4]) || null,
        memory: match[5]
      }];
    });

    return {
      observable: true,
      running: processes.length > 0,
      processes
    };
  } catch (error) {
    return {
      observable: false,
      running: null,
      processes: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function bridgeHealth() {
  return probeBridgeHealth(BRIDGE_URL);
}

function createServer(sessionKey) {
  // Each tool request may be routed through a new/recovered MCP transport.
  // Model operation permission comes from native binding on THIS request, not a
  // previously executed revitgpt_admission call in another server instance.
  const authority = new SessionModelAuthority(() => fetchNativeBindingStatus(BRIDGE_URL));
  const server = new McpServer(
    { name: "revitgpt", version: "0.1.0" },
    {
      instructions: [
        "RevitGPT P1 bootstrap surface.",
        "Bare @rg may call revitgpt_admission for an explicit status/connection report.",
        "Only explicit @rg awakens the workspace; model tool calls verify global awake intent plus native binding.",
        "Opening Revit in STANDBY does not awaken MCP. After explicit @rg, later Revit arrival upgrades to FULLY_AWAKE automatically.",
        "With exactly one open project, Revit binds it automatically. On multiple projects, use Bind Current only to switch models.",
        "Each model operation, including writes, verifies native binding and requires the bound model to be active.",
        "P2E removed revitgpt_pair_panel and revitgpt_lease_bound_model. These old commands MUST NOT be used, even if an old connector description mentions them.",
        "To count Levels use revitgpt_call with name='revit_list_levels' and arguments={}. No manual pairing or lease.",
        "For the current Revit tab/view, call revitgpt_call(name='revit_get_active_view', arguments={}) first; do not infer current view from view names, old IDs or the last duplicated view.",
        "For temporary hide/isolate in the active view, use revit_temporary_visibility with category='duct' (includes fittings/accessories) or element_ids and optionally the freshly read view_id; reset restores temporary visibility.",
        "CadGPT-style fake CLI commands: rg/, rg/status, rg/tools, rg/job, rg/dynamo, rg/knowledge, rg/help. Route command text through revitgpt_command or revitgpt_call with name='rg/...'. CLI is discovery ONLY.",
        "Never assume active tab alone is model authority; writes require exact bound/current model identity."
      ].join("\n")
    }
  );

  // Intercept ALL registrations (SYSTEM, dev and Revit tool adapters).
  // No callback can escape work accounting by using a new MCP session.
  wrapToolRegistration(server,{
    tracker:workTracker,
    isAwake:()=>awakeIntent.isAwake(),
    reservationIdProvider:()=>requestContext.getStore()?.reservedId??null
  });
  registerManagedTools(server);
  registerRevitMcpDevTools(server);

  server.registerTool("revitgpt_command",{
    title:"RevitGPT Fake CLI",
    description:"Read-only command router rg/, rg/status, rg/tools, rg/job, rg/dynamo, rg/knowledge, rg/help. Uses effective registry; never executes scripts or edits RVT.",
    inputSchema:{command:z.string().min(3)}
  },async({command})=>{
    const text=String(command||"").trim().toLowerCase();
    if(text==="rg/stop"){
      const stopped=await workTracker.requestStop();
      return {content:[{type:"text",text:"RevitGPT "+stopped.status+
        " active="+stopped.active_count+" unresolved="+stopped.unresolved_count}],
        structuredContent:stopped};
    }
    if(text==="rg/status"){
      const state=workTracker.status();
      return {content:[{type:"text",text:"RevitGPT "+state.mode+
        " active="+state.active_count+" unresolved="+state.unresolved_count}],
        structuredContent:{...state,awake_intent:awakeIntent.status(),revit_mcp:revitUpstream.status()}};
    }
    const result=await executeRevitCommand(command,{
      bindingReader:()=>fetchNativeBindingStatus(BRIDGE_URL)
    });
    if(!result)throw new Error("RG_COMMAND_UNKNOWN");
    return result;
  });

  server.registerTool(
    "revitgpt_admission",
    {
      title: "RevitGPT Admission",
      description: "Explicitly awaken the globally shared RevitGPT workspace; Revit may be OFF and can arrive later without another @rg.",
      inputSchema: {},
      outputSchema: {
        status: z.string(),
        bridge_available: z.boolean(),
        revit_mcp_on: z.boolean(),
        tool_count: z.number(),
        tool_names: z.array(z.string()),
        text: z.string()
      }
    },
    async () => {
      const started = Date.now();
      const gate = workTracker.status();
      if(gate.mode==="STOP_PENDING" || gate.safety_state==="STOP_BLOCKED"){
        const text = "RevitGPT stop/recovery is not complete: " + gate.mode +
          ", active=" + gate.active_count + ", unresolved=" + gate.unresolved_count +
          ". New work is blocked until existing operations are reconciled.";
        return {
          content:[{type:"text",text}],
          structuredContent:{status:"STOP_PENDING",bridge_available:false,
            revit_mcp_on:revitUpstream.status().connected,tool_count:revitUpstream.cachedTools().length,
            tool_names:[],text}
        };
      }
      // @rg is the sole explicit global wake operation, not per-chat admission.
      await workTracker.reopen();
      await awakeIntent.wake();
      const [revitProcess, bridge] = await Promise.all([
        revitProcessState(), bridgeHealth()
      ]);

      if (!revitProcess.observable || revitProcess.running !== true) {
        if (revitUpstream.status().connected) await revitUpstream.deactivate();
        await logToolCall({tool:"revitgpt_admission",ok:true,status:"WORKSPACE_AWAKE",duration_ms:Date.now()-started});
        const message = "RevitGPT WORKSPACE AWAKE. Revit is OFF. SYSTEM tools remain available; opening Revit will automatically activate full MCP.";
        return {
          content:[{type:"text",text:message}],
          structuredContent:{status:"WORKSPACE_AWAKE",bridge_available:Boolean(bridge.available),
            revit_mcp_on:false,tool_count:0,tool_names:[],text:message}
        };
      }
      if (!bridge.available) {
        await logToolCall({tool:"revitgpt_admission",ok:true,status:"WORKSPACE_AWAKE_BRIDGE_OFF",duration_ms:Date.now()-started});
        const message = "RevitGPT WORKSPACE AWAKE; Revit is running but the Native Bridge is not healthy yet. No second @rg required.";
        return {
          content:[{type:"text",text:message}],
          structuredContent:{status:"WORKSPACE_AWAKE",bridge_available:false,
            revit_mcp_on:false,tool_count:0,tool_names:[],text:message}
        };
      }
      let tools;
      try {
        tools = await revitUpstream.activate();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await logError({source:"awake-activation",error:detail});
        await logToolCall({tool:"revitgpt_admission",ok:true,status:"WORKSPACE_AWAKE_RETRY",duration_ms:Date.now()-started});
        const message = "RevitGPT WORKSPACE AWAKE; full MCP startup failed. Retrying only this layer: " + detail;
        return {
          content:[{type:"text",text:message}],
          structuredContent:{status:"WORKSPACE_AWAKE",bridge_available:true,
            revit_mcp_on:false,tool_count:0,tool_names:[],text:message}
        };
      }
      const names = tools.map(tool=>tool.name);
      await logToolCall({tool:"revitgpt_admission",ok:true,status:"FULLY_AWAKE",tool_count:names.length,duration_ms:Date.now()-started});
      const message = "RevitGPT FULLY AWAKE. Revit MCP is ON with "+names.length+" tools. Binding remains controlled by Revit; no manual Pair/lease.";
      return {
        content:[{type:"text",text:message}],
        structuredContent:{status:"FULLY_AWAKE",bridge_available:true,
          revit_mcp_on:true,tool_count:names.length,tool_names:names,text:message}
      };
    }
  );

  server.registerTool(
    "revitgpt_status",
    {
      title: "RevitGPT Status",
      description: "Read bootstrap control-plane, bridge, and full Revit MCP status without activating the full Revit MCP.",
      inputSchema: {}
    },
    async () => {
      const [bridge, revitProcess] = await Promise.all([bridgeHealth(), revitProcessState()]);
      const upstream = revitUpstream.status();
      const runtimeState = workTracker.status().mode==="STOP_PENDING" ? "STOP_PENDING" :
        !awakeIntent.isAwake() ? "STANDBY" :
        upstream.connected && revitProcess.running === true ? "FULLY_AWAKE" : "WORKSPACE_AWAKE";
      return {
        content: [{
          type: "text",
          text: [
            "RevitGPT",
            `BRIDGE   ${bridge.available ? "ON" : "OFF"}`,
            `REVIT MCP ${upstream.connected ? "ON" : "OFF"}`,
            `TOOLS    ${upstream.tool_count}`
          ].join("\n")
        }],
        structuredContent: {
          bridge,
          revit_process: revitProcess,
          revit_mcp: upstream,
          runtime_state: runtimeState,
          awake_intent: awakeIntent.status(),
          work_status: workTracker.status(),
          admission_required_for_reads: true,
          authorization: "native_binding_verified_per_read"
        }
      };
    }
  );

  server.registerTool(
    "revitgpt_binding_status",
    {
      title: "RevitGPT Bound Project Status",
      description: "Inspect the current bound project for read and write operations; no pairing or manual lease needed.",
      inputSchema: {}
    },
    async () => {
      const native = await fetchNativeBindingStatus(BRIDGE_URL);
      return {
        content: [{ type: "text", text: "Native binding: " + String(native.status) }],
        structuredContent: { native_binding: native }
      };
    }
  );

  server.registerTool(
    "revitgpt_list_tools",
    {
      title: "List Revit MCP Tools",
      description: "List tools discovered from the full Revit MCP after RevitGPT admission.",
      inputSchema: {}
    },
    async () => {
      // Explicit list request may initialize the runtime, but never
      // changes the selected model binding.
      const tools = await ensureExplicitReadReady();
      return {
        content: [{ type: "text", text: tools.map((tool) => tool.name).join("\n") }],
        structuredContent: {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description || null,
            inputSchema: tool.inputSchema || null
          }))
        }
      };
    }
  );

  server.registerTool(
    "revitgpt_call",
    {
      title: "Call Revit MCP Tool",
      description: "Call Revit MCP READ, UI or WRITE tools on the explicitly bound active model. For Levels: name='revit_list_levels'; for supported writes select the relevant revit_* tool. No manual Pair/lease or per-write approval. Fake CLI discovery commands rg/, rg/status, rg/tools, rg/job, rg/dynamo, rg/knowledge and rg/help use arguments={}.",
      inputSchema: {
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).optional()
      }
    },
    async ({ name, arguments: args }) => {
      // Do not gate by a previous MCP admission boolean: ChatGPT's connector
      // can issue the next call on a different reconstructed MCP instance.
      // The CLI is a local discovery route: it NEVER goes to Python MCP.
      if (name.startsWith("rg/")) {
        if (args && (typeof args!=="object"||Array.isArray(args)||Object.keys(args).length))
          throw new Error("RG_COMMAND_ARGUMENTS_INVALID");
        if (name.toLowerCase()==="rg/stop") {
          const stop = await workTracker.requestStop();
          return {content:[{type:"text",text:"RevitGPT "+stop.status+" active="+stop.active_count+
            " unresolved="+stop.unresolved_count}],structuredContent:stop};
        }
        if (name.toLowerCase()==="rg/status") {
          const status=workTracker.status();
          return {content:[{type:"text",text:"RevitGPT "+status.mode+" active="+status.active_count+
            " unresolved="+status.unresolved_count}],structuredContent:{
            ...status,awake_intent:awakeIntent.status(),revit_mcp:revitUpstream.status()}};
        }
        const command=await executeRevitCommand(name,{
          bindingReader:()=>fetchNativeBindingStatus(BRIDGE_URL)
        });
        if(!command)throw new Error("RG_COMMAND_UNKNOWN");
        return command;
      }
      // Old connector catalogues may advertise retired P2D controls.
      // Only return migration instructions, NEVER mint a lease.
      const retired = await handleRetiredPanelCommand(name, args,
        () => fetchNativeBindingStatus(BRIDGE_URL));
      if (retired) {
        await logToolCall({tool:"revitgpt_call",upstream:name,ok:true,status:"RETIRED_CONTROL_NO_LEASE_REQUIRED"});
        return retired;
      }
      // Old connector catalogues may omit named status.
      if (name === "revitgpt_binding_status") {
        if (args && Object.keys(args).length)
          throw new Error("BINDING_STATUS_ARGUMENTS_INVALID");
        const native = await fetchNativeBindingStatus(BRIDGE_URL);
        return {
          content: [{ type: "text", text: "Native binding: " + String(native.status) }],
          structuredContent: { native_binding: native }
        };
      }
      const started=Date.now();
      let result;
      try {
        result = await callReadOnlyTool({
          name,
          args: args || {},
          authority,
          ensureReady: ensureExplicitReadReady,
          invoke: (tool, safeArgs) => revitUpstream.callTool(tool, safeArgs)
        });
        await logToolCall({tool:"revitgpt_call",upstream:name,ok:true,duration_ms:Date.now()-started});
      } catch (error) {
        const message=error instanceof Error?error.message:String(error);
        await logToolCall({tool:"revitgpt_call",upstream:name,ok:false,error:message,duration_ms:Date.now()-started});
        await logError({source:"revit-upstream",tool:name,error:message});
        throw error;
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { result }
      };
    }
  );

  return server;
}

const sessions = createSessionManager(PORT, createServer);
sessions.startCleanup();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10mb" }));
const route = "/mcp/" + TOKEN;

app.get("/health", async (_req, res) => {
  const [bridge, revitProcess] = await Promise.all([bridgeHealth(), revitProcessState()]);
  res.json({
    status: "ok",
    name: "revitgpt",
    mode: isDevMode() ? "development" : "production",
    appdata_root: getAppDataRoot(),
    pid: process.pid,
    uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    bridge,
    revit_process: revitProcess,
    revit_mcp: revitUpstream.status(),
    runtime_state: workTracker.status().mode==="STOP_PENDING" ? "STOP_PENDING" :
      !awakeIntent.isAwake() ? "STANDBY" :
      revitUpstream.status().connected && revitProcess.running === true ? "FULLY_AWAKE" : "WORKSPACE_AWAKE",
    awake_intent: awakeIntent.status(),
    work_status: workTracker.status(),
    active_mcp_sessions: sessions.count()
  });
});

async function handleMcpPost(req, res) {
  let reservedId=null;
  try {
    const sessionId =
      typeof req.headers["mcp-session-id"] === "string"
        ? req.headers["mcp-session-id"]
        : undefined;
    const requestId = extractRequestId(req.body);
    const body=req.body;
    if(sessionId && body?.jsonrpc==="2.0" && body.method==="tools/call" &&
       !isPriorityControlRequest(body) && body.params?.name){
      const name=body.params.name;
      const inputs=body.params.arguments??{};
      const effect=effectForTool(name,inputs);
      if(effect!=="CONTROL"){
        if(!awakeIntent.isAwake())throw new Error("WORKSPACE_STANDBY: explicit @rg required");
        const toolName=name==="revitgpt_call"?inputs.name:name;
        const toolArgs=name==="revitgpt_call"?inputs.arguments??{}:inputs;
        reservedId=await workTracker.admit(toolName,effect,toolArgs);
      }
    }
    return await requestContext.run({reservedId},async()=>{
      try {

    const discoverFallback = buildLegacyDiscoverFallback(req.body);
    if (discoverFallback) {
      console.log("[MCP] server/discover -> legacy initialize fallback");
      res.status(200).json(discoverFallback);
      return;
    }

    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (existing) {
      await sessions.handleExisting(existing, req, res, req.body);
      return;
    }

    if (isInitializeRequest(req.body)) {
      await sessions.createNew(req, res, req.body);
      return;
    }

    if (sessionId) {
      const recovered = await sessions.tryRecover(sessionId, req, res, req.body);
      if (recovered) return;
      sessions.sendNotFound(res, requestId);
      return;
    }

    sessions.sendBadRequest(
      res,
      "Bad Request: Mcp-Session-Id header is required",
      requestId
    );
      } finally {
        // If the SDK rejected a message before tool callback admission,
        // its operation is proven NOT_STARTED; otherwise it is in progress
        // or terminal. Never erase an unknown/started operation.
        if(reservedId) await workTracker.cancelIfNotStarted(reservedId);
      }
    });
  } catch (error) {
    console.error("[MCP POST]", error);
    const message = error instanceof Error ? error.message : String(error);
    await logError({ source: "mcp-http", error: message }).catch(() => undefined);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: extractRequestId(req.body)
      });
    }
  }
}

async function handleMcpGet(req, res) {
  const sessionId =
    typeof req.headers["mcp-session-id"] === "string"
      ? req.headers["mcp-session-id"]
      : undefined;
  if (!sessionId) {
    sessions.sendBadRequest(res, "Bad Request: Mcp-Session-Id header is required");
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    sessions.sendNotFound(res);
    return;
  }
  await sessions.handleExisting(session, req, res);
}

async function handleMcpDelete(req, res) {
  const sessionId =
    typeof req.headers["mcp-session-id"] === "string"
      ? req.headers["mcp-session-id"]
      : undefined;
  if (!sessionId) {
    sessions.sendBadRequest(res, "Bad Request: Mcp-Session-Id header is required");
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    sessions.sendNotFound(res);
    return;
  }
  await sessions.handleExisting(session, req, res);
}

app.post(route, handleMcpPost);
app.get(route, handleMcpGet);
app.delete(route, handleMcpDelete);

let processWatchRunning = false;
let nextActivationAttempt = 0;
const revitProcessWatch = setInterval(async () => {
  if (processWatchRunning || shuttingDown) return;
  processWatchRunning = true;
  try {
    const revitProcess = await revitProcessState();
    if (revitProcess.observable && revitProcess.running === false) {
      if (revitUpstream.status().connected) {
        console.log("[RevitGPT] Revit exited; only Revit MCP layer deactivated.");
        await revitUpstream.deactivate();
      }
      return;
    }
    if (!awakeIntent.isAwake() || workTracker.status().mode!=="OPEN" ||
        !revitProcess.observable || revitProcess.running !== true) return;
    if (revitUpstream.status().connected || Date.now() < nextActivationAttempt) return;
    const bridge = await bridgeHealth();
    if (!bridge.available) return;
    try {
      await revitUpstream.activate();
      nextActivationAttempt = 0;
      await logControl({event:"revit_mcp_auto_activated",cause:"revit_arrived_after_global_awake"});
    } catch (error) {
      nextActivationAttempt = Date.now() + 15000;
      await logError({source:"revit-auto-activation",error:error instanceof Error ? error.message : String(error)});
    }
  } catch (error) {
    nextActivationAttempt = Date.now() + 15000;
    await logError({source:"revit-process-watcher",error:String(error)}).catch(()=>undefined);
  } finally {
    processWatchRunning = false;
  }
}, 5000);
revitProcessWatch.unref?.();

const httpServer = app.listen(PORT, HOST, () => {
  console.log("=== RevitGPT Control Plane ===");
  console.log(`MCP:    http://${HOST}:${PORT}${route}`);
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log("STANDBY until @rg. After explicit awake, Revit arrival automatically activates the full Revit MCP layer.");
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(revitProcessWatch);
  console.log("[RevitGPT] " + signal + ": shutting down");
  await revitUpstream.deactivate().catch(() => undefined);
  sessions.stopCleanup();
  await sessions.closeAll(signal).catch(() => undefined);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException",(error)=>{void logError({source:"process",kind:"uncaughtException",error:error?.stack||String(error)});});
process.on("unhandledRejection",(reason)=>{void logError({source:"process",kind:"unhandledRejection",error:String(reason)});});
