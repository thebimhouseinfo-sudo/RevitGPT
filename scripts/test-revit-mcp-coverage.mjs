import assert from "node:assert/strict";
import { auditSources, loadSources } from "./audit-revit-mcp-coverage.mjs";

const baseline = await loadSources();
const audit = auditSources(baseline);
assert.equal(audit.summary.declared_tools, 42);
assert.deepEqual(audit.summary.classification_counts, { BLOCKED:11, PARTIAL:31 });
assert.equal(audit.summary.required_core_groups,39);
assert.equal(audit.summary.required_advanced_groups,6);
assert.equal(audit.summary.host_ready,0);
assert.ok(audit.existing_tools.every(x=>x.ready === false && x.host_evidence === null));
const mutation = mutate => ({...baseline,...mutate});
assert.throws(()=>auditSources(mutation({manifest:{...baseline.manifest,
  entries: baseline.manifest.entries.slice(1)}})), /declared tools drift/);
assert.throws(()=>auditSources(mutation({capabilities:{...baseline.capabilities,
  tools:[...baseline.capabilities.tools, baseline.capabilities.tools[0]]}})), /duplicate MCP tool name/);
assert.throws(()=>auditSources(mutation({routesSource:baseline.routesSource.replace(
  '"POST \/element\/connectors"', '"POST \/element\/connector-removed"')})), /missing native route contract/);
assert.throws(()=>auditSources(mutation({nativeSource:baseline.nativeSource.replace(
  "Native write route not yet validated;", "Write enabled somehow;")})), /native write guard removed/);
const connectorControl = baseline.nativeSource.replaceAll(
  "foreach (Connector connector in manager.Connectors)", "/* connector collector disabled */");
assert.notEqual(connectorControl, baseline.nativeSource, "negative control did not change connector reader");
assert.throws(()=>auditSources(mutation({nativeSource:connectorControl})),
  /connector source handler missing/);
const reducedPlan = baseline.planSource.replace(/^\| ADVANCED\* \|[^\r\n]*(?:\r?\n|$)/m, "");
assert.notEqual(reducedPlan, baseline.planSource, "negative control did not change the plan");
assert.equal((reducedPlan.match(/^\| ADVANCED\* \|/gm) || []).length, 5);
assert.throws(()=>auditSources(mutation({planSource:reducedPlan})),
  /selected ADVANCED capability target matrix changed/);
console.log("[PASS] MCP-0 source-only tool audit and negative drift/stub/write controls.");
