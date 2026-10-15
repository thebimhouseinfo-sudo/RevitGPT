import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS
} from "@modelcontextprotocol/sdk/types.js";

// Awake intent and live MCP transport sessions have no wall-clock idle TTL.
// Only confirmed protocol closure/supersession may reclaim a transport.
const SESSION_DELETE_GRACE_MS = Number(process.env.MCP_SESSION_DELETE_GRACE_MS || 45_000);

function extractHeader(req, name) {
  const value = req.headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return undefined;
}

/**
 * Authenticated MCP status calls can bypass the *per-session* business FIFO.
 * All traffic still goes through the existing StreamableHTTP
 * session transport, JSON-RPC validation and tokenized MCP URL.
 * No general-purpose elevated endpoint is created.
 */
export function isPriorityControlRequest(body) {
  if(!body||typeof body!=="object"||Array.isArray(body)||
      body.jsonrpc!=="2.0"||body.method!=="tools/call"||
      !(typeof body.id==="string"||typeof body.id==="number"))return false;
  const params=body.params;
  if(!params||typeof params!=="object"||Array.isArray(params))return false;
  if(params.name==="revitgpt_status")return true;
  if(params.name==="revitgpt_call"){
    const c=params.arguments;
    return !!c&&typeof c==="object"&&!Array.isArray(c)&&
      typeof c.name==="string"&&["rg/status"].includes(c.name.toLowerCase()) &&
      (c.arguments===undefined || (c.arguments&&
        typeof c.arguments==="object"&&!Array.isArray(c.arguments)&&
        Object.keys(c.arguments).length===0));
  }
  if(params.name==="revitgpt_command"){
    const cmd=params.arguments?.command;
    return typeof cmd==="string" && ["rg/status"].includes(cmd.trim().toLowerCase());
  }
  return false;
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
  const inflight = new Map();
  const closed = new Set();

  function clearGrace(id) {
    const timer = graceTimers.get(id);
    if (timer) clearTimeout(timer);
    graceTimers.delete(id);
  }

  function touch(id) {
    // A valid new request proves the transport should no longer be considered
    // an abandoned DELETE candidate. Do not close it when older work settles.
    clearGrace(id);
    closed.delete(id);
    const session = sessions.get(id) || pendingRecoveries.get(id);
    if (session) session.lastAccessedAt = Date.now();
  }

  function removeSession(id, reason) {
    if ((inflight.get(id) || 0) > 0) {
      closed.add(id);
      console.log(`[MCP] Cleanup deferred until accepted request terminal: ${id}`);
      return;
    }
    clearGrace(id);
    closed.delete(id);
    const session = sessions.get(id) || pendingRecoveries.get(id);
    sessions.delete(id);
    pendingRecoveries.delete(id);
    opChains.delete(id);
    inflight.delete(id);
    if (session) void session.transport.close().catch(() => undefined);
    console.log(`[MCP] Session removed (${reason}): ${id}`);
  }

  async function trackRequest(id, callback) {
    if (!id) return callback();
    inflight.set(id, (inflight.get(id) || 0) + 1);
    try { return await callback(); }
    finally {
      const next = (inflight.get(id) || 1) - 1;
      if (next > 0) inflight.set(id, next);
      else {
        inflight.delete(id);
        if (closed.has(id)) removeSession(id, "confirmed closed, in-flight terminal");
      }
    }
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
      const headerSessionId = extractHeader(req, "mcp-session-id");
      let session;

      if (headerSessionId && pendingRecoveries.has(headerSessionId)) {
        session = pendingRecoveries.get(headerSessionId);
        pendingRecoveries.delete(headerSessionId);
        console.log(`[MCP] Using pending recovery transport for ${headerSessionId}`);
      } else {
        const requestedLogicalKey =
          extractHeader(req, "x-openai-session") ||
          extractHeader(req, "x-openai-subject") ||
          randomUUID();
        session = await buildSession(requestedLogicalKey);
      }

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
      await trackRequest(id, async () => {
        if (id && req.method !== "GET" && !isPriorityControlRequest(body)) await enqueue(id, run);
        else await run();
      });
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
      const handle = async () => recovered.transport.handleRequest(patched, res, body);
      await trackRequest(staleId, async () => {
        if(isPriorityControlRequest(body))await handle();
        else await enqueue(staleId,handle);
      });
      return true;
    },

    // Kept as compatible lifecycle hooks for older tests/callers.
    // No idle-time eviction is permitted, even after many hours/days.
    startCleanup() {},
    stopCleanup() {},

    async closeAll(reason = "shutdown") {
      this.stopCleanup();
      // Administrative shutdown closes owned transport sessions.
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
