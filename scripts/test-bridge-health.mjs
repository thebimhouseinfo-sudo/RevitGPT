import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { probeBridgeHealth } from "../src/bridge-health.mjs";

const source = readFileSync(fileURLToPath(new URL("../src/index.mjs", import.meta.url)), "utf8");
assert.match(source, /import \{ probeBridgeHealth \} from "\.\/bridge-health\.mjs"/);
assert.match(source, /return probeBridgeHealth\(BRIDGE_URL\)/);
assert.doesNotMatch(source, /fetch\(BRIDGE_URL \+ "\/health"/);

const observed = [];
const bridge = createServer((req, res) => {
  const id = req.headers["x-request-id"];
  observed.push(id ?? null);
  if (req.method !== "GET" || req.url !== "/health") {
    res.writeHead(404).end(); return;
  }
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: 400, message: "X-Request-ID header required." } }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: { status: "ok", host: "unified-native-preview", mutations_ready: false } }));
});
await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
const port = bridge.address().port;
const url = "http://127.0.0.1:" + port;
try {
  // Real HTTP negative control: old control-plane behavior results in 400.
  const missingHeader = await fetch(url + "/health");
  assert.equal(missingHeader.status, 400, "negative control must reject missing request ID");

  const first = await probeBridgeHealth(url);
  const second = await probeBridgeHealth(url);
  assert.equal(first.available, true, "native /health should be recognized as ready");
  assert.equal(first.body.data.status, "ok");
  assert.equal(first.body.data.mutations_ready, false);
  assert.equal(second.available, true);
  assert.ok(observed[1] && observed[2] && observed[1] !== observed[2],
    "every GET /health must carry a fresh request ID");

  const rejected = await probeBridgeHealth(url, { requestIdFactory: () => "" });
  assert.equal(rejected.available, false);
  assert.equal(rejected.status, 400, "health 400 must not be labeled as network outage");

  const legacy = await probeBridgeHealth(url, { fetchImpl: async (_url, options) => ({
    ok: Boolean(options?.headers?.["X-Request-ID"]),
    status: 200,
    json: async () => ({ status: "ok", version: "1.2.0" })
  }) });
  assert.equal(legacy.available, true, "legacy healthy response remains supported");

  const invalid = await probeBridgeHealth(url, { fetchImpl: async () => ({
    ok: true, status: 200, json: async () => ({ data: { status: "not-ready" } })
  }) });
  assert.equal(invalid.available, false, "HTTP 200 must not hide bad health payload");
  const timeout = await probeBridgeHealth(url, { fetchImpl: async () => {
    throw new Error("synthetic network failure");
  } });
  assert.equal(timeout.available, false);
  assert.match(timeout.error, /synthetic network failure/);

  console.log("[PASS] Native health probe: wire-level 400 negative control, unique X-Request-ID, readiness, legacy shape and failure handling.");
} finally {
  await new Promise((resolve, reject) => bridge.close((err) => err ? reject(err) : resolve()));
}
