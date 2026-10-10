using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // DynamoRevit bridge: LOAD .dyn into MANUAL workspace ONLY. Never RUN.
    // Still requires per-operation Native-pane consent on disposable RVT and
    // final host no-run evidence; source presence does NOT certify no side effects.
    internal static class NativeDynamoLoad
    {
        private static string Data(object x) => JsonConvert.SerializeObject(new { data = x });
        private static string Error(int c, string reason) =>
            JsonConvert.SerializeObject(new { error = new { code = c, message = reason } });
        private static string ManagedRoot() =>
            Path.GetFullPath(Path.Combine(Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData),
                "RevitGPT", "dynamo", "staging")) + Path.DirectorySeparatorChar;

        private static bool IsLocalTrustedFile(string path)
        {
            if (String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) ||
                !String.Equals(Path.GetExtension(path), ".dyn", StringComparison.OrdinalIgnoreCase))
                return false;
            string full;
            try { full = Path.GetFullPath(path); }
            catch { return false; }
            if (!full.StartsWith(ManagedRoot(), StringComparison.OrdinalIgnoreCase) ||
                full.StartsWith("\\\\", StringComparison.Ordinal) || !File.Exists(full))
                return false;
            string part = full;
            while (part.StartsWith(ManagedRoot(), StringComparison.OrdinalIgnoreCase))
            {
                if ((File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0)
                    return false;
                part = Path.GetDirectoryName(part);
            }
            return true;
        }

        public static string Execute(UIApplication app, JObject payload)
        {
            try
            {
                string path = payload.Value<string>("path");
                if (!IsLocalTrustedFile(path))
                    return Error(403, "Only trusted local managed .dyn staging files are allowed.");
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
                    return Error(409, "Graph checksum mismatch; stage and preflight again.");
                var graph = JObject.Parse(System.Text.Encoding.UTF8.GetString(bytes));
                var nodes = graph["Nodes"] as JArray;
                var edges = graph["Connectors"] as JArray;
                if (nodes == null || edges == null || nodes.Count > 1000 || edges.Count > 4000)
                    return Error(400, "Invalid/bounded Dynamo graph structure.");
                var banned = new[] { "pythonscript", "pythonnode", "codeblocknode",
                    "scriptevaluator", "zerotouch", "process.start",
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
                }

                // Source-code verified journal flags:
                // dynAutomation=false (true executes REGARDLESS of dynPathExecute);
                // dynForceManualRun=true and dynPathExecute=false.
                // Nothing in this adapter calls Run, RunExpression or evaluates nodes.
                Type commandType = Type.GetType(
                    "Dynamo.Applications.DynamoRevit, DynamoRevit", throwOnError: false);
                Type dataType = Type.GetType(
                    "Dynamo.Applications.DynamoRevitCommandData, DynamoRevit", throwOnError: false);
                if (commandType == null || dataType == null)
                    return Error(503, "DynamoRevit host adapter is not loaded/compatible.");
                object command = Activator.CreateInstance(commandType);
                object data = Activator.CreateInstance(dataType);
                dataType.GetProperty("Application")?.SetValue(data, app);
                var journal = new Dictionary<string, string>(StringComparer.Ordinal) {
                    { "dynShowUI", "True" },
                    { "dynAutomation", "False" },
                    { "dynPath", path },
                    { "dynPathExecute", "False" },
                    { "dynForceManualRun", "True" },
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
                return Data(new {
                    status = "LOADED_MANUAL_HOST_UNVERIFIED",
                    file_sha256 = digest,
                    node_count = nodes.Count,
                    graph_execution_requested = false,
                    automation_mode = false,
                    force_manual_run = true,
                    host_no_run_evidence_pending = true
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
