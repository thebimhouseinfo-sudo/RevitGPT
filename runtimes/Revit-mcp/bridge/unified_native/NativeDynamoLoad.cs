using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Xml.Linq;
using System.Security.Cryptography;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // DynamoRevit bridge: explicit LOAD-only or native-engine AUTORUN via journal flags.
    // Still requires per-operation Native-pane consent on disposable RVT and
    // final host no-run evidence; source presence does NOT certify no side effects.
    internal static class NativeDynamoLoad
    {
        private static string Data(object x) => JsonConvert.SerializeObject(new { data = x });
        private static string Error(int c, string reason) =>
            JsonConvert.SerializeObject(new { error = new { code = c, message = reason } });
        // P3: already-owned graph bundles are live-testable without staging or Registry.
        // Still restricted to managed LocalAppData roots, never arbitrary external paths.
        private static string[] TrustedRoots()
        {
            string appData = Path.Combine(Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData), "RevitGPT");
            return new[] {
                Path.Combine(appData, "dynamo", "staging"), // P2 compatibility
                Path.Combine(appData, "libraries", "dynamo"),
                Path.Combine(appData, "libraries", "jobs"),
                Path.Combine(appData, "temp-jobs")
            }.Select(p => Path.GetFullPath(p).TrimEnd(Path.DirectorySeparatorChar) +
                Path.DirectorySeparatorChar).ToArray();
        }

        private static bool IsLocalTrustedFile(string path)
        {
            if (String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) ||
                !String.Equals(Path.GetExtension(path), ".dyn", StringComparison.OrdinalIgnoreCase))
                return false;
            string full;
            try { full = Path.GetFullPath(path); }
            catch { return false; }
            if (full.StartsWith("\\\\\\\\", StringComparison.Ordinal) || !File.Exists(full))
                return false;
            var root = TrustedRoots().FirstOrDefault(r =>
                full.StartsWith(r, StringComparison.OrdinalIgnoreCase));
            if (root == null) return false;
            try
            {
                string part = full;
                string rootDirectory = root.TrimEnd(Path.DirectorySeparatorChar);
                while (!String.IsNullOrWhiteSpace(part) &&
                    (part.StartsWith(root, StringComparison.OrdinalIgnoreCase) ||
                     String.Equals(part, rootDirectory, StringComparison.OrdinalIgnoreCase)))
                {
                    if ((File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0)
                        return false;
                    part = Path.GetDirectoryName(part);
                }
                return true;
            }
            catch { return false; }
        }

        private static string FindDynamoAdapter()
        {
            // Revit 2024 bundles Dynamo under its own installation, not under
            // per-user add-in manifests. Use the exact Autodesk installation path.
            var revitFolder = Path.GetDirectoryName(typeof(Autodesk.Revit.DB.Document).Assembly.Location);
            var path = Path.Combine(revitFolder, "AddIns", "DynamoForRevit", "Revit", "DynamoRevitDS.dll");
            return File.Exists(path) ? path : null;
        }

        public static string Execute(UIApplication app, JObject payload)
        {
            try
            {
                // Load and execute are distinct operations. Execution is only
                // requested by the explicit revit_run_dyn_file tool.
                if (payload["run"] != null && payload["run"].Type != JTokenType.Boolean)
                    return Error(400, "run must be a boolean.");
                bool autoRun = payload.Value<bool?>("run") ?? false;
                string path = payload.Value<string>("path");
                if (!IsLocalTrustedFile(path))
                    return Error(403, "Only trusted local managed .dyn owner/staging files are allowed.");
                path = Path.GetFullPath(path);
                var info = new FileInfo(path);
                if (info.Length == 0 || info.Length > 2 * 1024 * 1024)
                    return Error(413, "Graph exceeds 2 MB limit.");
                byte[] bytes = File.ReadAllBytes(path);
                string digest;
                using (var sha = SHA256.Create())
                    digest = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "")
                        .ToLowerInvariant();
                string expected = payload.Value<string>("sha256");
                if (String.IsNullOrWhiteSpace(expected) ||
                    !String.Equals(digest, expected, StringComparison.OrdinalIgnoreCase))
                    return Error(409, "Graph checksum mismatch; reread and verify the owner-local graph.");
                var graph = JObject.Parse(System.Text.Encoding.UTF8.GetString(bytes));
                var nodes = graph["Nodes"] as JArray;
                var edges = graph["Connectors"] as JArray;
                if (nodes == null || edges == null || nodes.Count > 1000 || edges.Count > 4000)
                    return Error(400, "Invalid/bounded Dynamo graph structure.");
                var banned = new[] { "scriptevaluator", "process.start",
                    "system.io", "file.write", "webrequest" };
                foreach (JToken item in nodes)
                {
                    var node = item as JObject;
                    if (node == null || String.IsNullOrWhiteSpace(node.Value<string>("Id")))
                        return Error(400, "Unrecognized Dynamo node structure.");
                    string identity = String.Join(" ", new[] {
                        "NodeType", "ConcreteType", "Name", "FunctionSignature", "Code"
                    }.Select(key => node[key]?.ToString() ?? "")).ToLowerInvariant();
                    if (banned.Any(identity.Contains))
                        return Error(403, "Dynamo graph has unsafe executable/custom nodes.");
                    // Python Nodes are permitted only in explicitly owned graphs.
                    // Legacy staging is retained for compatibility, not a way to
                    // bypass owner-local Python authoring semantics.
                    bool isLegacyStaging = path.StartsWith(TrustedRoots()[0],
                        StringComparison.OrdinalIgnoreCase);
                    if (isLegacyStaging &&
                        (identity.Contains("pythonscript") || identity.Contains("pythonnode")))
                        return Error(403, "Python Node requires an owned Job/Temp/Dynamo bundle.");
                    // Built-in DynamoCore ZeroTouch and DesignScript CodeBlocks
                    // are normal .dyn nodes. Unknown external executable
                    // assemblies must not pass the unattended runner.
                    string concrete = node.Value<string>("ConcreteType") ?? "";
                    if (identity.Contains("zerotouch") &&
                        (!concrete.Trim().EndsWith(", DynamoCore", StringComparison.Ordinal) ||
                         String.IsNullOrWhiteSpace(node.Value<string>("FunctionSignature"))))
                        return Error(403, "Unreviewed ZeroTouch function.");
                }

                // DynamoRevit executes in its own engine. Never perform graph
                // node evaluation here or convert nodes to MCP tool calls.
                // The ExecuteCommand "Succeeded" response only proves dispatch;
                // graph completion/element mutations must be tested in Revit.
                // DynamoRevit may not be loaded until its Ribbon command is first opened.
                // Resolve the Autodesk-shipped adapter from Revit's own install directory.
                var dynamoAssembly = AppDomain.CurrentDomain.GetAssemblies()
                    .FirstOrDefault(a => String.Equals(a.GetName().Name, "DynamoRevitDS",
                        StringComparison.OrdinalIgnoreCase));
                if (dynamoAssembly == null)
                {
                    var adapterPath = FindDynamoAdapter();
                    if (adapterPath == null)
                        return Error(503, "DynamoRevitDS.dll not found in Revit 2024 bundled Dynamo.");
                    dynamoAssembly = Assembly.LoadFrom(adapterPath);
                }
                Type commandType = dynamoAssembly.GetType("Dynamo.Applications.DynamoRevit");
                Type dataType = dynamoAssembly.GetType("Dynamo.Applications.DynamoRevitCommandData");
                if (commandType == null || dataType == null)
                    return Error(503, "DynamoRevit host adapter is not loaded/compatible.");
                object command = Activator.CreateInstance(commandType);
                object data = Activator.CreateInstance(dataType);
                dataType.GetProperty("Application")?.SetValue(data, app);
                // P2 compatibility: LOAD and RUN are headless by default.
                // Never open Dynamo Start/UI for either path; an interactive
                // open is a separately requested fallback, not silent recovery.
                var journal = new Dictionary<string, string>(StringComparer.Ordinal) {
                    { "dynShowUI", "False" },
                    { "dynAutomation", "True" },
                    { "dynPath", path },
                    { "dynPathExecute", autoRun ? "True" : "False" },
                    { "dynForceManualRun", autoRun ? "False" : "True" },
                    { "dynModelShutDown", "False" }
                };
                var property = dataType.GetProperty("JournalData");
                if (property == null)
                    return Error(503, "DynamoRevit journal API missing.");
                property.SetValue(data, journal);
                MethodInfo execute = commandType.GetMethod("ExecuteCommand",
                    BindingFlags.Instance | BindingFlags.Public, null,
                    new[] { dataType }, null);
                if (execute == null)
                    return Error(503, "Compatible DynamoRevit ExecuteCommand missing.");
                var result = execute.Invoke(command, new[] { data });
                if (!String.Equals(result?.ToString(), "Succeeded", StringComparison.Ordinal))
                    return Error(409, "Dynamo did not confirm workspace open.");
                // Inspect the live Dynamo host before reporting completion.
                // A successful ExecuteCommand return is not execution evidence.
                object model = commandType.GetProperty("RevitDynamoModel",
                    BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
                object workspace = model?.GetType().GetProperty("CurrentWorkspace")?.GetValue(model);
                string openedPath = workspace?.GetType().GetProperty("FileName")?.GetValue(workspace)?.ToString();
                object nodeCollection = workspace?.GetType().GetProperty("Nodes")?.GetValue(workspace);
                var nodeStates = new List<object>();
                if (nodeCollection is System.Collections.IEnumerable enumerable)
                {
                    foreach (object node in enumerable)
                    {
                        var t = node.GetType();
                        nodeStates.Add(new {
                            name = t.GetProperty("Name")?.GetValue(node)?.ToString(),
                            state = t.GetProperty("State")?.GetValue(node)?.ToString(),
                            is_in_error_state = t.GetProperty("IsInErrorState")?.GetValue(node)?.ToString(),
                            warning = t.GetProperty("Warning")?.GetValue(node)?.ToString()
                        });
                    }
                }
                bool workspaceMatched = !String.IsNullOrEmpty(openedPath) &&
                    String.Equals(Path.GetFullPath(openedPath), Path.GetFullPath(path),
                        StringComparison.OrdinalIgnoreCase);
                // Execute the opened home workspace explicitly. On some Revit
                // hosts ExecuteCommand opens the graph without evaluating it.
                // Only run a verified matching workspace; never run an older one.
                bool explicitRunInvoked = false;
                if (autoRun)
                {
                    if (!workspaceMatched)
                        return Error(409, "Dynamo workspace path mismatch; refusing execution.");
                    var forceRun = model.GetType().GetMethod("ForceRun",
                        BindingFlags.Instance | BindingFlags.Public,
                        null, Type.EmptyTypes, null);
                    if (forceRun == null)
                        return Error(503, "Dynamo Revit model ForceRun API unavailable.");
                    forceRun.Invoke(model, null);
                    explicitRunInvoked = true;
                }
                return Data(new {
                    status = autoRun
                        ? "DYNAMO_AUTORUN_DISPATCHED_OUTCOME_UNVERIFIED"
                        : "LOADED_MANUAL_HOST_UNVERIFIED",
                    explicit_run_invoked = explicitRunInvoked,
                    workspace_opened = workspaceMatched,
                    workspace_path = openedPath,
                    observed_node_states = nodeStates,
                    file_sha256 = digest,
                    node_count = nodes.Count,
                    graph_execution_requested = autoRun,
                    automation_mode = autoRun,
                    force_manual_run = !autoRun,
                    host_run_evidence_pending = autoRun,
                    host_no_run_evidence_pending = !autoRun
                });
            }
            catch (TargetInvocationException ex)
            {
                return Error(500, "Dynamo adapter rejected load: " +
                    (ex.InnerException?.GetType().Name ?? ex.GetType().Name));
            }
            catch (Exception ex)
            {
                return Error(400, "Dynamo graph load refused: " + ex.GetType().Name);
            }
        }
    }
}
