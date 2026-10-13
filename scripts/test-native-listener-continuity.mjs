import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = new URL("../runtimes/Revit-mcp/bridge/unified_native/RevitGptApplication.cs", import.meta.url);
const source = readFileSync(path,"utf8");

function assertListenerRecoveryInvariant(code) {
  const idle = code.slice(code.indexOf("private void OnFirstIdle("),code.indexOf("private void TryShowInitialPane("));
  assert.ok(idle.includes("DisposeListener();"),"failed HTTP listener must close only listener");
  assert.ok(!idle.includes("DisposeBridge();"),"listener retry must NEVER dispose running ExternalEvent queue");
  assert.match(idle,/if\s*\(_dispatcher\s*==\s*null\)/,
    "ExternalEvent is only created if absent, not on every listener retry");
  assert.ok(idle.includes("var dispatcher = _dispatcher;"),
    "each listener captures existing dispatcher rather than mutable field");
  assert.ok(idle.includes("operationStatusProbe: id =>"),
    "operation status route must have a provider backed by dispatcher");
  assert.ok(idle.includes("dispatcher.OperationPhase(id)"),
    "HTTP status provider must read same Native queue as accepted writes");
  assert.ok(idle.includes("host_instance_id = _binding.Current.HostInstanceId"),
    "operation status must include exact native host generation");
  assert.ok(idle.includes('"NOT_FOUND"'),
    "lost native receipt must not claim operation never executed");
  const shutdown = code.slice(code.indexOf("public Result OnShutdown("));
  assert.ok(shutdown.includes("DisposeBridge();"),
    "explicit Revit host shutdown must still dispose listener and dispatcher");
}
assertListenerRecoveryInvariant(source);
// Red control: reproducing old coupling must trip the test.
const unsafe = source.replace("DisposeListener();\n            try", "DisposeBridge();\n            try");
assert.notEqual(unsafe,source,"red control mutation should apply");
assert.throws(()=>assertListenerRecoveryInvariant(unsafe),
  /listener retry must NEVER dispose running ExternalEvent queue/);
console.log("[PASS] Revit Native listener recovery preserves the in-flight ExternalEvent dispatcher and host-scoped status history.");
