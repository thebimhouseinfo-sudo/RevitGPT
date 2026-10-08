import "dotenv/config";
import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { revitUpstream } from "./revit-upstream.mjs";
import { ensureAppDataLayout, getAppDataRoot } from "./appdata.mjs";
import { registerManagedTools } from "./managed-tools.mjs";
import { registerRevitMcpDevTools, isDevMode } from "./revit-mcp-dev.mjs";
import { createSessionManager, extractRequestId, isInitializeRequest } from "./mcp-session-manager.mjs";
import { buildLegacyDiscoverFallback } from "./mcp-discover-compat.mjs";
import { logControl, logError, logToolCall } from "./log-store.mjs";
import { probeBridgeHealth } from "./bridge-health.mjs";
import { fetchNativeBindingStatus, SessionModelAuthority } from "./model-authority.mjs";
import { PanelPairingRegistry } from "./panel-pairing.mjs";
import { isLocalPanelRequest } from "./panel-local-guard.mjs";
import { PANEL_COMPAT_CATALOG, runPanelCompatTool } from "./panel-tool-compat.mjs";

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
const panelPairing = new PanelPairingRegistry();

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
  // Admission belongs to this MCP server instance, never to the untrusted
  // x-openai-subject / x-openai-session string shared across connections.
  let admitted = false;
  const authority = new SessionModelAuthority(() => fetchNativeBindingStatus(BRIDGE_URL));
  const panelContext = () => ({
    admitted, upstreamConnected:revitUpstream.status().connected,
    authority, panelPairing,
    nativeBindingStatus:() => fetchNativeBindingStatus(BRIDGE_URL)
  });
  const panelCall = (name,args={}) => runPanelCompatTool(name,panelContext(),args);
  const server = new McpServer(
    { name: "revitgpt", version: "0.1.0" },
    {
      instructions: [
        "RevitGPT P1 bootstrap surface.",
        "Bare @rg / RevitGPT invocation must call revitgpt_admission first.",
        "Only @rg / revitgpt_admission may activate the full Revit MCP when Revit is running.",
        "Revit being ON by itself must not auto-start the full Revit MCP.",
        "Model reads require an explicit bound model and read-only session lease.",
        "For panel pairing when revitgpt_pair_panel is not exposed by the plugin catalogue, call revitgpt_call with name='revitgpt_pair_panel' and arguments={}. This is a Slim control-plane alias, NOT a Python MCP tool.",
        "Never assume active tab is model authority; native writes remain disabled."
      ].join("\n")
    }
  );

  registerManagedTools(server);
  registerRevitMcpDevTools(server);

  server.registerTool(
    "revitgpt_admission",
    {
      title: "RevitGPT Admission",
      description: "Connect this ChatGPT session to the live Revit bridge and lazily activate the full Revit MCP only when the bridge is available.",
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
      const started=Date.now();
      const [revitProcess, bridge] = await Promise.all([
        revitProcessState(),
        bridgeHealth()
      ]);

      if (!revitProcess.observable || revitProcess.running !== true) {
        await logToolCall({tool:"revitgpt_admission",ok:true,status:"REVIT_OFF",duration_ms:Date.now()-started});
        await revitUpstream.deactivate();
        return {
          content: [{ type: "text", text: "RevitGPT\nREVIT OFF\nREVIT MCP OFF" }],
          structuredContent: {
            status: "REVIT_OFF",
            bridge_available: bridge.available,
            revit_mcp_on: false,
            tool_count: 0,
            tool_names: [],
            text: "Revit is not running. Start Revit, then invoke RevitGPT again."
          }
        };
      }

      if (!bridge.available) {
        await logToolCall({tool:"revitgpt_admission",ok:true,status:"BRIDGE_OFF",duration_ms:Date.now()-started});
        return {
          content: [{ type: "text", text: "RevitGPT\nREVIT ON\nBRIDGE OFF\nREVIT MCP OFF" }],
          structuredContent: {
            status: "BRIDGE_OFF",
            bridge_available: false,
            revit_mcp_on: false,
            tool_count: 0,
            tool_names: [],
            text: bridge.status
              ? `Revit bridge answered HTTP ${bridge.status} to /health. Check protocol compatibility; do not start a second bridge.`
              : "Revit is running, but the Revit bridge is not reachable yet. Check its listener/port before invoking RevitGPT again."
          }
        };
      }

      const tools = await revitUpstream.activate();
      admitted = true;
      await logToolCall({tool:"revitgpt_admission",ok:true,status:"READY",tool_count:tools.length,duration_ms:Date.now()-started});
      const names = tools.map((tool) => tool.name);
      return {
        content: [{ type: "text", text: `RevitGPT READY\nREVIT MCP ON\nTOOLS ${names.length}` }],
        structuredContent: {
          status: "READY",
          bridge_available: true,
          revit_mcp_on: true,
          tool_count: names.length,
          tool_names: names,
          text: "RevitGPT is connected to the live Revit bridge."
        }
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
          admitted: admitted
        }
      };
    }
  );

  // Named controls for refreshed clients; the generic proxy below provides
  // identical session-scoped behavior when the published catalogue is stale.
  server.registerTool("revitgpt_pair_panel",{
    title:"Pair RevitGPT Panel",
    description:"Issue a one-time pairing code for THIS admitted ChatGPT session. Enter the code in the native panel.",
    inputSchema:{}
  },async()=>panelCall("revitgpt_pair_panel"));

  server.registerTool("revitgpt_binding_status",{
    title:"RevitGPT Model Binding Status",
    description:"Inspect native model binding and this logical MCP session's read-only lease.",
    inputSchema:{}
  },async()=>panelCall("revitgpt_binding_status"));

  server.registerTool("revitgpt_lease_bound_model",{
    title:"Lease Bound Model (Read-Only)",
    description:"Lease native-bound Revit model for THIS admitted session only; never grants writes.",
    inputSchema:{}
  },async()=>panelCall("revitgpt_lease_bound_model"));

  server.registerTool(
    "revitgpt_list_tools",
    {
      title: "List Revit MCP Tools",
      description: "List tools discovered from the full Revit MCP after RevitGPT admission.",
      inputSchema: {}
    },
    async () => {
      if (!admitted || !revitUpstream.status().connected) {
        throw new Error("REVITGPT_ADMISSION_REQUIRED");
      }
      const tools = revitUpstream.cachedTools();
      return {
        content: [{ type: "text", text: tools.map((tool) => tool.name).join("\n") +
          "\nSlim panel controls (call through revitgpt_call):\n" +
          PANEL_COMPAT_CATALOG.map(tool => tool.name).join("\n") }],
        structuredContent: {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description || null,
            inputSchema: tool.inputSchema || null
          })),
          slim_control_plane_tools: PANEL_COMPAT_CATALOG
        }
      };
    }
  );

  server.registerTool(
    "revitgpt_call",
    {
      title: "Call Revit MCP Tool",
      description: "Invoke a discovered Python Revit MCP tool, or Slim control-plane aliases revitgpt_pair_panel, revitgpt_binding_status, revitgpt_lease_bound_model when named tools are not exposed. Call admission first.",
      inputSchema: {
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).optional()
      }
    },
    async ({ name, arguments: args }) => {
      if (!admitted || !revitUpstream.status().connected) {
        throw new Error("REVITGPT_ADMISSION_REQUIRED");
      }
      // Compatibility with plugin catalogues that predate P2D controls.
      // This must run BEFORE Python tool discovery (the control is not in 23).
      const panelResult = await panelCall(name, args || {});
      if (panelResult) return panelResult;
      const known = revitUpstream.cachedTools().some((tool) => tool.name === name);
      if (!known) throw new Error("REVIT_MCP_TOOL_NOT_DISCOVERED: " + name);
      const started=Date.now();
      let result;
      try {
        const safeArgs = await authority.authorize(name, args || {});
        result = await revitUpstream.callTool(name, safeArgs);
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

// Panel-only local commands: no browser Origin, no remote Host, no network
// exposure. Possession of a single-use challenge / 256-bit bearer is required.
function requireLocalPanel(req,res,next) {
  if (!isLocalPanelRequest({
    remoteAddress:req.socket.remoteAddress,
    host:req.headers.host,
    origin:req.headers.origin,
    referer:req.headers.referer,
    contentType:req.headers["content-type"]
  },PORT)) {
    res.status(403).json({ error:"PANEL_LOCAL_ONLY" });
    return;
  }
  next();
}
app.post("/panel/pair",requireLocalPanel,(req,res)=>{
  try {
    const token = panelPairing.claim(req.body?.code);
    res.set("Cache-Control","no-store").json(token);
  } catch {
    res.status(403).json({ error:"PANEL_PAIR_CODE_INVALID_OR_EXPIRED" });
  }
});
app.post("/panel/lease",requireLocalPanel,async(req,res)=>{
  try {
    const result=await panelPairing.lease(req.body?.token,req.body?.binding);
    res.set("Cache-Control","no-store").json(result);
  } catch(error) {
    const message=error instanceof Error?error.message:"PANEL_LEASE_DENIED";
    res.status(409).json({error:message});
  }
});

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
    active_mcp_sessions: sessions.count()
  });
});

async function handleMcpPost(req, res) {
  try {
    const sessionId =
      typeof req.headers["mcp-session-id"] === "string"
        ? req.headers["mcp-session-id"]
        : undefined;
    const requestId = extractRequestId(req.body);

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

const revitProcessWatch = setInterval(async () => {
  if (!revitUpstream.status().connected) return;
  const revitProcess = await revitProcessState();
  if (revitProcess.observable && revitProcess.running === false) {
    console.log("[RevitGPT] Revit.exe is no longer running; stopping full Revit MCP.");
    await revitUpstream.deactivate();
  }
}, 5000);
revitProcessWatch.unref?.();

const httpServer = app.listen(PORT, HOST, () => {
  console.log("=== RevitGPT P1 Bootstrap Control Plane ===");
  console.log(`MCP:    http://${HOST}:${PORT}${route}`);
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log("Full Revit MCP stays OFF until @rg/revitgpt_admission is invoked while Revit is running. Revit process absence shuts it down; Revit being ON alone never auto-starts it.");
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
