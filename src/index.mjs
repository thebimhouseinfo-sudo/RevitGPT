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
import { callReadOnlyTool, ensureReadRuntime } from "./read-intent-gate.mjs";

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

const ensureExplicitReadReady = () => ensureReadRuntime({
  upstream: revitUpstream,
  processState: revitProcessState,
  bridgeState: bridgeHealth
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
  // Read permission comes from native binding on THIS request, not a
  // previously executed revitgpt_admission call in another server instance.
  const authority = new SessionModelAuthority(() => fetchNativeBindingStatus(BRIDGE_URL));
  const server = new McpServer(
    { name: "revitgpt", version: "0.1.0" },
    {
      instructions: [
        "RevitGPT P1 bootstrap surface.",
        "Bare @rg may call revitgpt_admission for an explicit status/connection report.",
        "An explicit read tool call also initializes the full Revit MCP if Revit and the native bridge are ready.",
        "Revit being ON by itself must not auto-start the full Revit MCP.",
        "With exactly one open project, Revit binds it automatically. On multiple projects, use Bind Current only to switch models.",
        "After admission, read calls automatically check current native binding and require the bound model to be active.",
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
          admission_required_for_reads: false,
          authorization: "native_binding_verified_per_read"
        }
      };
    }
  );

  server.registerTool(
    "revitgpt_binding_status",
    {
      title: "RevitGPT Bound Project Status",
      description: "Inspect read-only bound project; no pairing or manual lease needed.",
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
      // binds a model or allows a write.
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
      description: "Read Revit via the current native-bound model. No manual pairing, admission or session lease required. Only read/diagnostic tools are allowed; writes are blocked.",
      inputSchema: {
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).optional()
      }
    },
    async ({ name, arguments: args }) => {
      // Do not gate by a previous MCP admission boolean: ChatGPT's connector
      // can issue the next call on a different reconstructed MCP instance.
      // Old connector catalogues may omit named status; no pairing aliases.
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
