import assert from "node:assert/strict";
import { RevitUpstream, isUpstreamTransportFailure } from "../src/revit-upstream.mjs";

function makeFixture({ hangConnect = false, hangList = false, breakConnect = false } = {}) {
  const calls = { connect: 0, list: 0, close: 0, tool: 0 };
  let toolFailure = null;
  const inventory = [{ name: "revit_get_active_document" }, { name: "revit_list_levels" }];
  const transport = {
    stderr: null,
    close: async () => { calls.close++; }
  };
  const client = {
    connect: async () => {
      calls.connect++;
      if (breakConnect) throw new Error("Mock Python startup failed");
      if (hangConnect) await new Promise(() => {});
    },
    listTools: async () => {
      calls.list++;
      if (hangList) await new Promise(() => {});
      return { tools: inventory };
    },
    callTool: async ({name}) => {
      calls.tool++;
      if (toolFailure) throw toolFailure;
      return {content:[{type:"text",text:name}]};
    }
  };
  const manager = new RevitUpstream({
    createClient: () => client,
    createTransport: () => transport,
    initialDeadlineMs: 80
  });
  return { manager, calls, inventory,
    failTool: (error) => { toolFailure = error; }
  };
}

const ok = makeFixture();
const first = await ok.manager.activate();
assert.deepEqual(first, ok.inventory);
assert.equal(ok.calls.connect, 1, "one initial transport connect");
assert.equal(ok.calls.list, 1, "one initial listTools on cold admission");
assert.equal(ok.manager.status().connected, true);
const cached = await ok.manager.activate();
assert.deepEqual(cached, ok.inventory);
assert.equal(ok.calls.connect, 1, "warm admission reuses connected MCP");
assert.equal(ok.calls.list, 1, "warm admission MUST NOT repeat tools/list");
assert.equal(typeof ok.manager.status().last_activation_ms, "number");
cached.push({ name: "mutate-cache" });
assert.equal(ok.manager.cachedTools().length, 2, "admission returns a copy of the cached inventory");
await ok.manager.deactivate();
assert.equal(ok.manager.status().phase, "sleeping");
assert.equal(ok.calls.close, 1);
assert.equal(ok.manager.status().tool_count, 0);

const noList = makeFixture({ hangList: true });
await assert.rejects(noList.manager.activate(), /initial tools\/list timed out/);
assert.equal(noList.calls.close, 1, "frozen listTools must close transport");
assert.equal(noList.manager.status().phase, "sleeping");
assert.match(noList.manager.status().last_error, /tools\/list timed out/);
assert.equal(noList.manager.status().connected, false);

const noConnect = makeFixture({ hangConnect: true });
await assert.rejects(noConnect.manager.activate(), /connection timed out/);
assert.equal(noConnect.calls.list, 0, "connection timeout must not start listTools");
assert.equal(noConnect.calls.close, 1);
assert.equal(noConnect.manager.status().connected, false);

const badConnect = makeFixture({ breakConnect: true });
await assert.rejects(badConnect.manager.activate(), /Mock Python startup failed/);
assert.equal(badConnect.calls.close, 1);
assert.equal(badConnect.manager.status().phase, "sleeping");

// Regression: a failed Revit API request or Native HTTP timeout must not
// deactivate the shared Python process while other chats still use it.
const shared = makeFixture();
await shared.manager.activate();
shared.failTool(new Error("Bridge HTTP 504: request timed out; outcome unknown; do not retry automatically."));
await assert.rejects(shared.manager.callTool("revit_set_parameter", {}), /outcome unknown/);
assert.equal(shared.manager.status().connected, true, "Native 504 is NOT MCP process death");
assert.equal(shared.calls.close, 0);
assert.equal(shared.manager.status().phase, "active");
shared.failTool(new Error("MODEL_BINDING_NOT_CURRENT"));
await assert.rejects(shared.manager.callTool("revit_list_levels", {}), /MODEL_BINDING_NOT_CURRENT/);
assert.equal(shared.calls.close, 0, "native model error must leave other chats connected");
shared.failTool(new Error("Python tool raised ValueError"));
await assert.rejects(shared.manager.callTool("revit_list_levels", {}), /ValueError/);
assert.equal(shared.calls.close, 0, "ordinary tool errors must not reset MCP");
shared.failTool(null);
const later = await shared.manager.callTool("revit_list_levels", {});
assert.equal(later.content[0].text, "revit_list_levels");
assert.equal(shared.calls.connect, 1, "healthy transport reused after error");
assert.equal(shared.calls.list, 1, "no duplicate tools/list on tool errors");

assert.equal(isUpstreamTransportFailure(new Error("Bridge HTTP 504: outcome unknown")), false);
assert.equal(isUpstreamTransportFailure(new Error("Socket timeout")), false);
assert.equal(isUpstreamTransportFailure(new Error("MCP error -32000: Connection closed")), true);
assert.equal(isUpstreamTransportFailure(Object.assign(new Error("broken"),{code:"EPIPE"})), true);
shared.failTool(Object.assign(new Error("broken pipe"), {code:"EPIPE"}));
await assert.rejects(shared.manager.callTool("revit_list_levels", {}), /broken pipe/);
assert.equal(shared.calls.close, 1, "only actual transport failure invalidates Python MCP");
assert.equal(shared.manager.status().connected, false);
assert.equal(shared.manager.status().phase, "sleeping");
shared.failTool(null);
await shared.manager.activate();
assert.equal(shared.calls.connect, 2, "next explicit activation recovers dead layer");
assert.equal(shared.manager.status().connected, true);

console.log("[PASS] Revit MCP upstream cold/warm admission and tool-failure isolation invokes tools/list once; startup hangs fail closed with transport cleanup.");
