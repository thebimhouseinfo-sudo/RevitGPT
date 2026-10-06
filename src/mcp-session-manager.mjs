import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS
} from "@modelcontextprotocol/sdk/types.js";

const SESSION_TTL_MS = Number(process.env.MCP_SESSION_TTL_MS || 86_400_000);
const SESSION_CLEANUP_MS = Number(process.env.MCP_SESSION_CLEANUP_MS || 300_000);
const SESSION_DELETE_GRACE_MS = Number(process.env.MCP_SESSION_DELETE_GRACE_MS || 45_000);

function extractHeader(req, name) {
  const value = req.headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return undefined;
}

export function extractRequestId(body) {
  if (!body || typeof body !== "object" || !("id" in body)) return null;
  const id = body.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function negotiateProtocolVersion(requested) {
  if (requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
  return LATEST_PROTOCOL_VERSION;
}

function withSessionHeaders(req, sessionId, protocolVersion) {
  const headers = {
    ...req.headers,
    "mcp-session-id": sessionId,
    "mcp-protocol-version": protocolVersion
  };
  const drop = new Set(["mcp-session-id", "mcp-protocol-version"]);
  const raw = [];
  const existing = req.rawHeaders || [];
  for (let i = 0; i < existing.length; i += 2) {
    if (drop.has(existing[i]?.toLowerCase())) continue;
    raw.push(existing[i], existing[i + 1]);
  }
  raw.push("mcp-session-id", sessionId, "mcp-protocol-version", protocolVersion);
  return Object.assign(req, { headers, rawHeaders: raw });
}

async function loopbackPost(port, route, body, sessionId, protocolVersion, connectorHeaders = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-session-id": sessionId,
    ...connectorHeaders
  };
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return response.ok || response.status === 202;
}

export function createSessionManager(port, createServer) {
  const sessions = new Map();
  const pendingRecoveries = new Map();
  const graceTimers = new Map();
  const opChains = new Map();
  let cleanupTimer = null;

  function clearGrace(id) {
    const timer = graceTimers.get(id);
    if (timer) clearTimeout(timer);
    graceTimers.delete(id);
  }

  function touch(id) {
    clearGrace(id);
    const session = sessions.get(id) || pendingRecoveries.get(id);
    if (session) session.lastAccessedAt = Date.now();
  }

  function removeSession(id, reason) {
    clearGrace(id);
    const session = sessions.get(id) || pendingRecoveries.get(id);
    sessions.delete(id);
    pendingRecoveries.delete(id);
    opChains.delete(id);
    if (session) {
      void session.transport.close().catch(() => undefined);
    }
    console.log(`[MCP] Session removed (${reason}): ${id}`);
  }

  async function enqueue(id, fn) {
    const previous = opChains.get(id) || Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    opChains.set(id, current);
    try {
      await current;
    } finally {
      if (opChains.get(id) === current) opChains.delete(id);
    }
  }

  async function buildSession(logicalSessionKey, preferredTransportId) {
    const transportId = preferredTransportId || randomUUID();
    const server = createServer(logicalSessionKey);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => transportId,
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, {
          server,
          transport,
          logicalSessionKey,
          lastAccessedAt: Date.now()
        });
        pendingRecoveries.delete(id);
        clearGrace(id);
        console.log(`[MCP] Session initialized: ${id}`);
      },
      onsessionclosed: (id) => {
        if (!id) return;
        const active = sessions.get(id);
        if (!active || active.transport !== transport) return;
        const timer = setTimeout(() => {
          if (sessions.get(id)?.transport === transport) removeSession(id, "client DELETE grace expired");
        }, SESSION_DELETE_GRACE_MS);
        timer.unref?.();
        graceTimers.set(id, timer);
      }
    });

    transport.onerror = (error) => {
      console.warn("[MCP] transport error:", error?.message || String(error));
    };

    await server.connect(transport);
    return {
      server,
      transport,
      logicalSessionKey,
      lastAccessedAt: Date.now()
    };
  }

  async function warmup(staleId, route, protocolVersion, sourceReq) {
    const connectorHeaders = {};
    const subject = extractHeader(sourceReq, "x-openai-subject");
    const openaiSession = extractHeader(sourceReq, "x-openai-session");
    if (subject) connectorHeaders["x-openai-subject"] = subject;
    if (openaiSession) connectorHeaders["x-openai-session"] = openaiSession;

    const initialized = await loopbackPost(
      port,
      route,
      {
        jsonrpc: "2.0",
        id: "__revitgpt_recovery__",
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "revitgpt-session-recovery", version: "0.1.0" }
        }
      },
      staleId,
      undefined,
      connectorHeaders
    );
    if (!initialized) return false;

    return loopbackPost(
      port,
      route,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      staleId,
      protocolVersion,
      connectorHeaders
    );
  }

  return {
    get(id) {
      return sessions.get(id);
    },

    count() {
      return sessions.size;
    },

    sendNotFound(res, requestId = null) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "MCP session not found; reconnect RevitGPT and retry."
        },
        id: requestId
      });
    },

    sendBadRequest(res, message, requestId = null) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message },
        id: requestId
      });
    },

    async createNew(req, res, body) {
      const requestedLogicalKey =
        extractHeader(req, "x-openai-session") ||
        extractHeader(req, "x-openai-subject") ||
        randomUUID();
      const session = await buildSession(requestedLogicalKey);
      await session.transport.handleRequest(req, res, body);
      const activeId = session.transport.sessionId;
      if (activeId) {
        if (!sessions.has(activeId)) {
          sessions.set(activeId, {
            ...session,
            lastAccessedAt: Date.now()
          });
          console.log(`[MCP] Session adopted after initialize: ${activeId}`);
        }
        touch(activeId);
      }
    },

    async handleExisting(session, req, res, body) {
      const id = session.transport.sessionId || extractHeader(req, "mcp-session-id");
      if (id) touch(id);
      const run = async () => {
        await session.transport.handleRequest(req, res, body);
      };
      if (id && req.method !== "GET") await enqueue(id, run);
      else await run();
    },

    async tryRecover(staleId, req, res, body) {
      if (isInitializeRequest(body)) return false;
      const logicalKey =
        extractHeader(req, "x-openai-session") ||
        extractHeader(req, "x-openai-subject") ||
        staleId;
      const replacement = await buildSession(logicalKey, staleId);
      pendingRecoveries.set(staleId, replacement);
      const protocolVersion = negotiateProtocolVersion(extractHeader(req, "mcp-protocol-version"));
      const route = req.path || "/mcp";
      const warmed = await warmup(staleId, route, protocolVersion, req);
      if (!warmed) {
        removeSession(staleId, "recovery warmup failed");
        return false;
      }
      const recovered = sessions.get(staleId);
      if (!recovered) return false;
      const patched = withSessionHeaders(req, staleId, protocolVersion);
      await enqueue(staleId, async () => {
        await recovered.transport.handleRequest(patched, res, body);
      });
      return true;
    },

    startCleanup() {
      if (cleanupTimer) return;
      cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [id, session] of sessions) {
          if (now - session.lastAccessedAt > SESSION_TTL_MS) {
            removeSession(id, "TTL expired");
          }
        }
      }, SESSION_CLEANUP_MS);
      cleanupTimer.unref?.();
    },

    stopCleanup() {
      if (!cleanupTimer) return;
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    },

    async closeAll(reason = "shutdown") {
      this.stopCleanup();
      const all = [...sessions.entries()];
      sessions.clear();
      pendingRecoveries.clear();
      for (const [id, session] of all) {
        clearGrace(id);
        await session.transport.close().catch(() => undefined);
      }
      console.log(`[MCP] Closed ${all.length} session(s): ${reason}`);
    }
  };
}

export { isInitializeRequest };
