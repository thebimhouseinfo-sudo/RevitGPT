import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { revitUpstream } from "./revit-upstream.mjs";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3300);
const TOKEN = (process.env.MCP_TOKEN || "").trim();
const BRIDGE_URL = (process.env.REVIT_BRIDGE_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
const STARTED_AT = Date.now();

if (!TOKEN) {
  throw new Error("MCP_TOKEN is required. Copy .env.example to .env and set a private random value.");
}

const sessions = new Map();
const admitted = new Set();
let shuttingDown = false;

async function bridgeHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(BRIDGE_URL + "/health", { signal: controller.signal });
    if (!response.ok) return { available: false, status: response.status };
    const body = await response.json().catch(() => ({}));
    return { available: true, body };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function createServer(sessionKey) {
  const server = new McpServer(
    { name: "revitgpt", version: "0.1.0" },
    {
      instructions: [
        "RevitGPT P1 bootstrap surface.",
        "Bare RevitGPT/plugin invocation should call revitgpt_admission first.",
        "This phase proves real Revit connectivity before final model lease/binding hardening.",
        "Do not assume the active Revit view/tab is model authority."
      ].join("\n")
    }
  );

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
      const bridge = await bridgeHealth();
      if (!bridge.available) {
        const upstream = revitUpstream.status();
        return {
          content: [{ type: "text", text: `RevitGPT\nBRIDGE OFF\nREVIT MCP ${upstream.connected ? "ON" : "OFF"}` }],
          structuredContent: {
            status: "BRIDGE_OFF",
            bridge_available: false,
            revit_mcp_on: upstream.connected,
            tool_count: upstream.tool_count,
            tool_names: revitUpstream.cachedTools().map((tool) => tool.name),
            text: "Revit bridge is not reachable. P1 does not treat bridge loss as proof that Revit is OFF, so an already-running full Revit MCP is not stopped here."
          }
        };
      }

      const tools = await revitUpstream.activate();
      admitted.add(sessionKey);
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
      const bridge = await bridgeHealth();
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
          revit_mcp: upstream,
          admitted: admitted.has(sessionKey)
        }
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
      if (!admitted.has(sessionKey) || !revitUpstream.status().connected) {
        throw new Error("REVITGPT_ADMISSION_REQUIRED");
      }
      const tools = revitUpstream.cachedTools();
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
      description: "Bootstrap generic proxy for invoking one discovered Revit MCP tool. P1 only; named proxies come after real-runtime evidence.",
      inputSchema: {
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).optional()
      }
    },
    async ({ name, arguments: args }) => {
      if (!admitted.has(sessionKey) || !revitUpstream.status().connected) {
        throw new Error("REVITGPT_ADMISSION_REQUIRED");
      }
      const known = revitUpstream.cachedTools().some((tool) => tool.name === name);
      if (!known) throw new Error("REVIT_MCP_TOOL_NOT_DISCOVERED: " + name);
      const result = await revitUpstream.callTool(name, args || {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { result }
      };
    }
  );

  return server;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10mb" }));
const route = "/mcp/" + TOKEN;

app.get("/health", async (_req, res) => {
  const bridge = await bridgeHealth();
  res.json({
    status: "ok",
    name: "revitgpt",
    mode: "p1-bootstrap",
    pid: process.pid,
    uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    bridge,
    revit_mcp: revitUpstream.status(),
    active_mcp_sessions: sessions.size
  });
});

app.post(route, async (req, res) => {
  const transportId = req.headers["mcp-session-id"];
  try {
    if (typeof transportId === "string" && sessions.has(transportId)) {
      await sessions.get(transportId).transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "MCP session not found; reconnect RevitGPT and retry." },
        id: req.body?.id ?? null
      });
      return;
    }

    const sessionKey =
      (typeof req.headers["x-openai-session"] === "string" && req.headers["x-openai-session"]) ||
      crypto.randomUUID();
    const server = createServer(sessionKey);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => sessions.set(id, { server, transport, sessionKey }),
      onsessionclosed: (id) => {
        if (id) sessions.delete(id);
      }
    });
    transport.onerror = (error) => console.error("[MCP transport]", error.message);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP POST]", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        id: req.body?.id ?? null
      });
    }
  }
});

app.get(route, async (req, res) => {
  const id = req.headers["mcp-session-id"];
  const session = typeof id === "string" ? sessions.get(id) : undefined;
  if (!session) return res.status(404).json({ ok: false, error: "MCP session not found" });
  await session.transport.handleRequest(req, res);
});

app.delete(route, async (req, res) => {
  const id = req.headers["mcp-session-id"];
  const session = typeof id === "string" ? sessions.get(id) : undefined;
  if (!session) return res.status(404).json({ ok: false, error: "MCP session not found" });
  await session.transport.handleRequest(req, res);
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log("=== RevitGPT P1 Bootstrap Control Plane ===");
  console.log(`MCP:    http://${HOST}:${PORT}${route}`);
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log("Full Revit MCP remains sleeping until revitgpt_admission sees a live Revit bridge. After activation, bridge health loss alone does not shut it down.");
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[RevitGPT] " + signal + ": shutting down");
  await revitUpstream.deactivate().catch(() => undefined);
  for (const session of sessions.values()) {
    await session.transport.close().catch(() => undefined);
  }
  sessions.clear();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
