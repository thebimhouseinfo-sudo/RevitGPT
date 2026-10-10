import assert from "node:assert/strict";
import { auditSources, loadSources } from "./audit-revit-mcp-coverage.mjs";

const baseline = await loadSources();
const audit = auditSources(baseline);
assert.equal(audit.summary.declared_tools, 23);
assert.deepEqual(audit.summary.classification_counts, { BLOCKED:11, PARTIAL:11, STUB:1 });
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
assert.throws(()=>auditSources(mutation({nativeSource:baseline.nativeSource.replace(
  "Connectors require an explicit Revit API readback fixture.", "Connectors ready already.")})), /connector handler changed/);
assert.throws(()=>auditSources(mutation({planSource:baseline.planSource.replace(
  /^\| ADVANCED\* \|.*\n/m,"")})), /selected ADVANCED capability target matrix changed/);
console.log("[PASS] MCP-0 23-tool static audit and negative drift/stub/write controls.");
