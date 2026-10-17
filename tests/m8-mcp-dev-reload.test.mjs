import assert from "node:assert/strict";
import test from "node:test";
import { registerRevitMcpDevTools } from "../src/revit-mcp-dev.mjs";
import { effectForTool } from "../src/tool-effects.mjs";
import { RevitUpstream } from "../src/revit-upstream.mjs";

function captureDevTools() {
  const handlers = new Map();
  registerRevitMcpDevTools({
    registerTool(name, _configuration, callback) { handlers.set(name, callback); }
  }, {
    reloadUpstream: async () => ({
      tools: [{ name: "revit_list_levels" }, { name: "new_development_tool" }]
    })
  });
  return handlers;
}

test("M8 reload is an explicit system-side effect", () => {
  assert.equal(effectForTool("revit_mcp_dev_reload"), "SYSTEM_SIDE_EFFECT");
});

test("M8 reload reports actual upstream inventory, not live test success", async () => {
  const prior = process.env.REVITGPT_DEV_MODE;
  process.env.REVITGPT_DEV_MODE = "1";
  try {
    const tools = captureDevTools();
    const run = tools.get("revit_mcp_dev_reload");
    assert.equal(typeof run, "function");
    const result = (await run({ expected_tool: "new_development_tool" })).structuredContent;
    assert.equal(result.reloaded, true);
    assert.equal(result.expected_tool_visible, true);
    assert.equal(result.tool_count, 2);
    assert.equal(result.execution_verified, false);
    assert.equal(result.native_reinstalled, false);
    const missing = (await run({ expected_tool: "not_installed" })).structuredContent;
    assert.equal(missing.expected_tool_visible, false);
  } finally {
    if (prior === undefined) delete process.env.REVITGPT_DEV_MODE;
    else process.env.REVITGPT_DEV_MODE = prior;
  }
});

test("M8 dev tools remain hidden outside explicit DEV mode", () => {
  const prior = process.env.REVITGPT_DEV_MODE;
  process.env.REVITGPT_DEV_MODE = "0";
  try {
    assert.equal(captureDevTools().size, 0);
  } finally {
    if (prior === undefined) delete process.env.REVITGPT_DEV_MODE;
    else process.env.REVITGPT_DEV_MODE = prior;
  }
});

test("M8 reload refuses to interrupt in-flight upstream tool calls", async () => {
  const upstream = new RevitUpstream();
  let release;
  upstream.phase = "active";
  upstream.connect = async () => {};
  upstream.client = { callTool: async () => new Promise(resolve => { release = resolve; }) };
  const running = upstream.callTool("revit_list_levels", {});
  assert.equal(upstream.inFlightCalls, 1);
  await assert.rejects(() => upstream.reloadTools(), /REVIT_MCP_RELOAD_BUSY/);
  assert.equal(upstream.reloading, false);
  release({ ok: true });
  await running;
  assert.equal(upstream.inFlightCalls, 0);
});

test("M8 reload closes and reactivates an idle upstream only", async () => {
  const upstream = new RevitUpstream();
  let closeCount = 0, activateCount = 0;
  upstream.deactivate = async () => { closeCount++; };
  upstream.activate = async () => { activateCount++; return [{ name: "new_development_tool" }]; };
  const inventory = await upstream.reloadTools();
  assert.deepEqual(inventory.map(x => x.name), ["new_development_tool"]);
  assert.equal(closeCount, 1);
  assert.equal(activateCount, 1);
  assert.equal(upstream.reloading, false);
});
