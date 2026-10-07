const PORT = Number(process.env.PORT || 3300);
const TOKEN = process.env.MCP_TOKEN || "ci-smoke-token";
const BASE = `http://127.0.0.1:${PORT}`;
const PATH = `/mcp/${TOKEN}`;

async function post(body, sessionId, protocolVersion, extraHeaders = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extraHeaders
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
  const response = await fetch(BASE + PATH, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch {}
  }
  return {
    status: response.status,
    sessionId: response.headers.get("mcp-session-id"),
    text,
    json
  };
}

const discover = await post(
  {
    jsonrpc: "2.0",
    id: "server/discover",
    method: "server/discover",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          name: "tunnel-client",
          version: "0.0.15"
        },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  },
  null,
  "2026-07-28",
  { "mcp-method": "server/discover" }
);
if (discover.status !== 200 || discover.json?.error?.code !== -32601) {
  throw new Error(`server/discover fallback failed: HTTP ${discover.status} ${discover.text}`);
}

const init = await post({
  jsonrpc: "2.0",
  id: "initialize",
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "tunnel-client", version: "0.0.15" }
  }
});
if (init.status !== 200) {
  throw new Error(`initialize HTTP ${init.status}: ${init.text}`);
}
if (!init.sessionId) {
  throw new Error("initialize missing mcp-session-id");
}

const initialized = await post(
  { jsonrpc: "2.0", method: "notifications/initialized" },
  init.sessionId,
  "2025-11-25"
);
if (initialized.status !== 200 && initialized.status !== 202) {
  throw new Error(`notifications/initialized HTTP ${initialized.status}: ${initialized.text}`);
}

const tools = await post(
  { jsonrpc: "2.0", id: "tools/list", method: "tools/list", params: {} },
  init.sessionId,
  "2025-11-25"
);
if (tools.status !== 200) {
  throw new Error(`tools/list HTTP ${tools.status}: ${tools.text}`);
}
if (!tools.json?.result?.tools?.some((tool) => tool.name === "revitgpt_admission")) {
  throw new Error("revitgpt_admission missing from tools/list");
}
const devMode = ["1", "true"].includes(String(process.env.REVITGPT_DEV_MODE || "").toLowerCase());
if (devMode && !tools.json?.result?.tools?.some((tool) => tool.name === "revit_mcp_dev_root")) {
  throw new Error("REVITGPT_DEV_MODE=1 but revit_mcp_dev_root missing from tools/list");
}

const staleId = "00000000-0000-4000-8000-000000000099";
const recovered = await post(
  { jsonrpc: "2.0", id: "stale-tools/list", method: "tools/list", params: {} },
  staleId,
  "2025-11-25"
);
if (recovered.status !== 200) {
  throw new Error(`stale-session recovery HTTP ${recovered.status}: ${recovered.text}`);
}
if (!recovered.json?.result?.tools?.some((tool) => tool.name === "revitgpt_admission")) {
  throw new Error("stale-session recovery missing revitgpt_admission");
}

console.log("[PASS] RevitGPT exact tunnel-client 0.0.15 fallback wire shape + stale-session recovery");
