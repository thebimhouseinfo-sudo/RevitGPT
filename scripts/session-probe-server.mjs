#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3200);
const TOKEN = (process.env.MCP_TOKEN || "session-probe").trim();

const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "RevitGPT", "session-probe");
const logPath = path.join(root, "probe.ndjson");
const secretPath = path.join(root, "fingerprint.key");
fs.mkdirSync(root, { recursive: true });

function loadSecret() {
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath);
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

const secret = loadSecret();

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

function fp(v) {
  if (!v) return null;
  return crypto.createHmac("sha256", secret).update(String(v), "utf8").digest("hex").slice(0, 24);
}

function snapshot(req, event, extra = {}) {
  const row = {
    timestamp: new Date().toISOString(),
    event,
    pid: process.pid,
    x_openai_session_fp: fp(first(req.headers["x-openai-session"])),
    x_openai_subject_fp: fp(first(req.headers["x-openai-subject"])),
    mcp_session_fp: fp(first(req.headers["mcp-session-id"])),
    ...extra
  };
  fs.appendFileSync(logPath, JSON.stringify(row) + "\n", "utf8");
  return row;
}

function createServer() {
  const server = new McpServer(
    { name: "revitgpt-session-probe", version: "0.1.0" },
    {
      instructions:
        "Session continuity probe only. Call session_probe_ping when the user asks to record a continuity checkpoint. It stores only persistent HMAC fingerprints of connector/session headers; raw identity headers are never written."
    }
  );

  server.registerTool(
    "session_probe_ping",
    {
      title: "Session Probe Ping",
      description: "Record one continuity checkpoint for the current ChatGPT conversation.",
      inputSchema: {
        label: z.string().min(1).optional()
      },
      outputSchema: {
        ok: z.boolean(),
        label: z.string(),
        timestamp: z.string()
      }
    },
    async ({ label }) => ({
      content: [{ type: "text", text: `Session probe recorded: ${label || "ping"}` }],
      structuredContent: {
        ok: true,
        label: label || "ping",
        timestamp: new Date().toISOString()
      }
    })
  );

  return server;
}

const sessions = new Map();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

const route = `/mcp/${TOKEN}`;

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    name: "revitgpt-session-probe",
    pid: process.pid,
    sessions: sessions.size,
    evidence: logPath,
    persistent_fingerprint_key: secretPath
  });
});

app.post(route, async (req, res) => {
  const transportId = first(req.headers["mcp-session-id"]);
  snapshot(req, "request_received", {
    rpc_method: req.body?.method || null,
    tool_name: req.body?.method === "tools/call" ? req.body?.params?.name || null : null
  });

  try {
    if (transportId && sessions.has(transportId)) {
      await sessions.get(transportId).transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "MCP session not found; reconnect the probe and retry." },
        id: req.body?.id ?? null
      });
      return;
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
      },
      onsessionclosed: (id) => {
        if (id) sessions.delete(id);
      }
    });
    transport.onerror = () => undefined;
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
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
  const id = first(req.headers["mcp-session-id"]);
  const session = id ? sessions.get(id) : null;
  if (!session) return res.status(404).json({ ok: false, error: "session not found" });
  snapshot(req, "stream_request");
  await session.transport.handleRequest(req, res);
});

app.delete(route, async (req, res) => {
  const id = first(req.headers["mcp-session-id"]);
  const session = id ? sessions.get(id) : null;
  if (!session) return res.status(404).json({ ok: false, error: "session not found" });
  snapshot(req, "session_delete");
  await session.transport.handleRequest(req, res);
});

app.listen(PORT, HOST, () => {
  console.log(`RevitGPT session probe: http://${HOST}:${PORT}${route}`);
  console.log(`Health: http://${HOST}:${PORT}/health`);
  console.log(`Evidence: ${logPath}`);
  console.log("Fingerprint key persists across process/machine restart.");
});
