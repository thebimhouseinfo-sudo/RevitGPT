import assert from "node:assert/strict";
import { RevitUpstream } from "../src/revit-upstream.mjs";

function makeFixture({ hangConnect = false, hangList = false, breakConnect = false } = {}) {
  const calls = { connect: 0, list: 0, close: 0 };
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
    }
  };
  const manager = new RevitUpstream({
    createClient: () => client,
    createTransport: () => transport,
    initialDeadlineMs: 80
  });
  return { manager, calls, inventory };
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

console.log("[PASS] Revit MCP upstream cold/warm admission invokes tools/list once; startup hangs fail closed with transport cleanup.");
