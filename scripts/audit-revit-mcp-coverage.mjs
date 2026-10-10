// MCP-0 source-only audit. NEVER infer a live Revit PASS from registration or fake HTTP.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rt = "runtimes/Revit-mcp";
export const pythonToolFiles = [
  "runtime_tools.py", "document_tools.py", "view_tools.py", "element_tools.py",
  "family_tools.py", "mep_tools.py", "annotation_tools.py", "ui_tools.py"
];
export const routeMap = Object.freeze({
  revit_get_runtime_info: ["GET /health", "GET /document/active", "GET /documents"],
  revit_get_active_document: ["GET /document/active"],
  revit_list_documents: ["GET /documents"],
  revit_list_views: ["GET /views", "POST /views"],
  revit_get_view_properties: ["POST /view/properties"],
  revit_list_levels: ["GET /levels", "POST /levels"],
  revit_list_elements: ["POST /elements"],
  revit_count_elements: ["POST /elements/aggregate"],
  revit_group_elements: ["POST /elements/aggregate"],
  revit_get_selection: ["POST /ui/selection"],
  revit_set_selection: ["POST /ui/selection/set"],
  revit_show_elements: ["POST /ui/show"],
  revit_activate_view: ["POST /ui/view/activate"],
  revit_temporary_visibility: ["POST /ui/visibility/temporary"],
  revit_get_element: ["POST /element"],
  revit_get_parameters: ["POST /element/parameters"],
  revit_get_geometry_summary: ["POST /element/inspect"],
  revit_get_categories: ["POST /categories"],
  revit_inspect_family_instance: ["POST /element/inspect"],
  revit_get_element_relationships: ["POST /element/inspect"],
  revit_list_parameters: ["POST /element/parameters"],
  revit_list_families: ["POST /families"],
  revit_list_family_types: ["POST /family/types"],
  revit_list_system_types: ["POST /system/types"],
  revit_get_connectors: ["POST /element/connectors"],
  revit_list_mep_systems: ["POST /mep/systems"],
  revit_quantity_takeoff: ["POST /mep/quantities"],
  revit_summarize_equipment: ["POST /mep/quantities"],
  revit_query_spatial_and_warnings: ["POST /model/spatial-warnings"],
  revit_place_family_instance: ["POST /place"],
  revit_create_duct: ["POST /create/duct"],
  revit_create_pipe: ["POST /create/pipe"],
  revit_set_parameter: ["POST /parameter/set"],
  revit_delete_elements: ["POST /delete"],
  revit_move_element: ["POST /move"],
  revit_list_annotations: ["POST /annotations"],
  revit_create_text_note: ["POST /annotation/text"],
  revit_create_tag: ["POST /annotation/tag"],
  revit_create_dimension: ["POST /annotation/dimension"],
  revit_create_spot_elevation: ["POST /annotation/spot_elevation"],
  revit_create_detail_line: ["POST /annotation/detail_line"]
});
const expect = (ok, message) => { if (!ok) throw new Error("MCP0_AUDIT: " + message); };
const sorted = a => [...a].sort();
const unique = a => new Set(a).size === a.length;
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const quoted = s => JSON.stringify(s);
const pathFromRoute = route => route.split(" ")[1];

export function auditSources({ manifest, capabilities, toolSources, mainSource, nativeSource, routesSource, bridgeSource, nodeSource, planSource }) {
  expect(Array.isArray(manifest.entries) && Array.isArray(capabilities.tools), "bad tool manifest/capabilities");
  const registered = toolSources.flatMap(({ file, content }) => [...content.matchAll(/@mcp\.tool\(\)\s*def\s+(revit_[A-Za-z0-9_]+)\s*\(/g)]
    .map(x => ({ name: x[1], file })));
  const names = registered.map(x => x.name);
  const manifestNames = manifest.entries.map(x => x.name);
  const capsNames = capabilities.tools.map(x => x.id);
  expect(unique(names) && unique(manifestNames) && unique(capsNames), "duplicate MCP tool name");
  expect(same(names, manifestNames) && same(names, capsNames), "declared tools drift from one or more manifests");
  expect(manifest.entry_count === names.length, "manifest entry_count differs from registered tools");
  expect(names.length >= 41, "expected 23 baseline plus 2 aggregate tools");
  expect(Object.keys(routeMap).every(x => names.includes(x)), "original 23 tools unexpectedly missing");
  expect(names.every(x => routeMap[x]), "new tool needs an explicit audited routeMap contract");
  for (const file of pythonToolFiles) {
    expect(mainSource.includes(file.replace("_tools.py", "_tools")) ||
      mainSource.includes(file.replace(".py", "")), "main.py registration drift: " + file);
  }
  const routeDeclarations = [...routesSource.matchAll(/"(GET|POST)\s+(\/[^"]*)"/g)].map(x => x[1] + " " + x[2]);
  expect(unique(routeDeclarations), "duplicate native HTTP routes");
  for (const listed of Object.values(routeMap).flat()) {
    expect(routeDeclarations.includes(listed), "missing native route contract: " + listed);
    expect(bridgeSource.includes(quoted(pathFromRoute(listed))), "missing Python bridge consumer: " + listed);
  }
  const hasWriteGuard = nativeSource.includes("if (BridgeHttpProtocol.IsWrite(path))") &&
    nativeSource.includes("Native write route not yet validated;");
  expect(hasWriteGuard, "native write guard removed: require a separately reviewed write audit");
  const hasConnectors = nativeSource.includes('if (path == "/element/connectors") return Connectors(doc, payload);') &&
    nativeSource.includes("private static string Connectors(Document doc, JObject payload)") &&
    nativeSource.includes("foreach (Connector connector in manager.Connectors)");
  expect(hasConnectors, "connector source handler missing or changed; require new audit proof");
  const planRows = [...planSource.matchAll(/^\| (CORE|ADVANCED\*) \| ([^\n]+)\| (READ|UI_ACTION|READ\/UI_ACTION|WRITE|DESTRUCTIVE|READ\/WRITE|WRITE\/DESTRUCTIVE|DYN_LOAD) \| ([^\n]+)\|$/gm)]
    .map(m => ({ tier: m[1], contract: m[2].trim(), mode: m[3], implementation: m[4].trim(), release_gate: "HOST_TEST_BLOCKED", ready: false }));
  expect(planRows.filter(x => x.tier === "CORE").length === 39, "CORE capability target matrix changed: revise review gate");
  expect(planRows.filter(x => x.tier === "ADVANCED*").length === 6, "selected ADVANCED capability target matrix changed");
  const toolRows = manifest.entries.map(entry => {
    const route = routeMap[entry.name];
    const isWrite = Boolean(entry.mutates_model);
    const isConnector = entry.name === "revit_get_connectors";
    const nativePresent = route.some(r => nativeSource.includes('if (path == ' + quoted(pathFromRoute(r)) + ')'));
    expect(isWrite || isConnector || nativePresent, "read tool has no native handler: " + entry.name);
    expect(isWrite ? entry.mode === "disabled_mutation" && entry.status === "not_enabled"
      : (entry.mode === "read_only" || entry.mode === "ui_action"), "registry access status mismatch: " + entry.name);
    expect(isWrite || nodeSource.includes(quoted(entry.name)), "read/UI tool absent in Node admission: " + entry.name);
    return {
      name: entry.name, python_source: registered.find(r => r.name === entry.name)?.file,
      declared_mode: entry.mode, registry_status: entry.status,
      http_routes: route, native_route_registered: true,
      native_handler_observed: nativePresent,
      native_write_guard_active: isWrite && hasWriteGuard,
      classification: isWrite ? "BLOCKED" : "PARTIAL",
      reason: isWrite ? "Native HTTP 501 for all write routes; Node mutation gate active."
         : isConnector ? "Native connector reader added; still requires live Revit host evidence."
        : entry.name === "revit_get_element" || entry.name === "revit_list_elements"
          ? "Native read exists; promised parameters are not fully serialized. No live-host proof."
          : "Static read handler exists; not verified against real Revit 2024.",
      host_evidence: null, ready: false
    };
  });
  const counts = toolRows.reduce((acc,x) => { acc[x.classification] = (acc[x.classification] || 0) + 1; return acc; }, {});
  expect(counts.BLOCKED === 11 && counts.PARTIAL === 30, "baseline classifications changed; require reviewed update");
  return { schema_version: 1, audit_type: "SOURCE_STATIC_ONLY", host_verified: false,
    warning: "Neither mock HTTP, declared tool, route nor built DLL proves real Revit functionality.",
    summary: { declared_tools: names.length, classification_counts: counts,
      required_core_groups: 39, required_advanced_groups: 6, host_ready: 0 },
    existing_tools: toolRows, target_groups: planRows
  };
}

export async function loadSources(base = root) {
  const read = p => fs.readFile(path.join(base, p), "utf8");
  const [manifest, capabilities, nativeSource, routesSource, bridgeSource, nodeSource, mainSource, planSource, ...sources] = await Promise.all([
    read(rt + "/tool-manifest.json"), read(rt + "/capabilities.json"),
    read(rt + "/bridge/unified_native/RevitApiRouter.cs"),
    read(rt + "/bridge/unified_native/BridgeRouteContract.cs"),
    read(rt + "/connection/bridge.py"), read("src/model-authority.mjs"),
    read(rt + "/main.py"),
    read("docs/superpowers/plans/2026-10-10-revit-mcp-v1-detailed-implementation-plan.md"),
    ...pythonToolFiles.map(x => read(rt + "/tools/" + x))
  ]);
  return { manifest: JSON.parse(manifest), capabilities: JSON.parse(capabilities),
    nativeSource, routesSource, bridgeSource, nodeSource, mainSource, planSource,
    toolSources: pythonToolFiles.map((file, i) => ({file, content: sources[i]})) };
}

function asMarkdown(audit) {
  const lines = ["# MCP-0 static coverage audit", "",
    "**SOURCE ONLY — live Revit 2024 QA has not been run. No READY tools certified.**", "",
    "| Class | Count |", "| --- | ---: |",
    ...Object.entries(audit.summary.classification_counts).map(([k,v]) => '| ' + k + ' | ' + v + ' |'), "",
    "## 23-tool baseline", "",
    "| Name | Current status | Native route(s) | Reason |",
    "| --- | --- | --- | --- |",
    ...audit.existing_tools.map(x => '| ' + x.name + ' | ' + x.classification + ' | ' + x.http_routes.join(", ") + ' | ' + x.reason + ' |'),
    "", "## V1 target coverage (not implemented by this audit)", "",
    "Required CORE groups: " + audit.summary.required_core_groups + "; selected advanced groups: " + audit.summary.required_advanced_groups + ".",
    ...audit.target_groups.map(x => '- [' + x.tier + '] ' + x.contract + ' — ' + x.mode + ' — ' + x.release_gate), ""
  ];
  return lines.join("\n");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const audit = auditSources(await loadSources());
    if (process.argv.includes("--write")) {
      const dir = path.join(root, "docs/evidence/revit-mcp-v1");
      await fs.mkdir(dir, { recursive:true });
      await fs.writeFile(path.join(dir, "coverage-mcp0.json"), JSON.stringify(audit, null, 2) + "\n");
      await fs.writeFile(path.join(dir, "coverage-mcp0.md"), asMarkdown(audit));
    }
    console.log("[PASS] MCP-0 source-only audit: " + JSON.stringify(audit.summary));
    console.log("[BLOCKED] Real Revit 2024 host validation not performed.");
  } catch (error) { console.error(error); process.exitCode = 1; }
}
