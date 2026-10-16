using System;
using System.Linq;
using System.Globalization;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    internal static class NativeSharedParameterBinding
    {
        static string Data(object value) => JsonConvert.SerializeObject(new { data = value });
        static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });

        public static string Execute(Document doc, JObject request)
        {
            var guidText = request.Value<string>("shared_guid");
            Guid guid;
            if (!Guid.TryParse(guidText, out guid))
                return Error(400, "Exact Shared Parameter GUID required.");
            var requestedCategories = request["categories"] as JArray;
            if (requestedCategories == null || requestedCategories.Count == 0 ||
                requestedCategories.Count > 16 || requestedCategories.Any(t => t.Type != JTokenType.String))
                return Error(400, "Provide 1..16 exact category names.");
            bool instance = request.Value<bool?>("is_instance") ?? true;
            bool confirm = request.Value<bool?>("confirm") ?? false;
            var definitionFile = doc.Application.OpenSharedParameterFile();
            if (definitionFile == null)
                return Error(422, "Active Shared Parameters file is not configured.");
            ExternalDefinition definition = null;
            foreach (DefinitionGroup group in definitionFile.Groups)
                foreach (Definition candidate in group.Definitions)
                {
                    var external = candidate as ExternalDefinition;
                    if (external != null && external.GUID == guid)
                    {
                        definition = external;
                        break;
                    }
                }
            if (definition == null)
                return Error(404, "Shared Parameter GUID not found in configured definitions.");
            CategorySet categorySet = doc.Application.Create.NewCategorySet();
            foreach (JToken token in requestedCategories)
            {
                string name = token.Value<string>();
                var matches = doc.Settings.Categories.Cast<Category>()
                    .Where(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                if (matches.Count != 1 || !matches[0].AllowsBoundParameters)
                    return Error(422, "Category unavailable or does not support binding: " + name);
                if (!categorySet.Contains(matches[0])) categorySet.Insert(matches[0]);
            }
            if (!confirm)
                return Data(new { dry_run = true, shared_guid = guid.ToString(),
                    name = definition.Name, is_instance = instance,
                    categories = requestedCategories.Select(v => v.Value<string>()).ToArray(),
                    requires_confirmation = true });
            using (var transaction = new Transaction(doc, "RevitGPT Bind Shared Parameter"))
            {
                transaction.Start();
                try
                {
                    Binding binding = instance
                        ? (Binding)doc.Application.Create.NewInstanceBinding(categorySet)
                        : (Binding)doc.Application.Create.NewTypeBinding(categorySet);
                    bool inserted = doc.ParameterBindings.Insert(definition, binding,
                        GroupTypeId.Data);
                    if (!inserted)
                    {
                        transaction.RollBack();
                        return Error(409, "Parameter already bound or has conflicting binding; existing binding unchanged.");
                    }
                    if (transaction.Commit() != TransactionStatus.Committed)
                        return Error(500, "Binding transaction did not commit.");
                    return Data(new { transaction = "committed", shared_guid = guid.ToString(),
                        name = definition.Name, is_instance = instance,
                        categories = requestedCategories.Select(v => v.Value<string>()).ToArray() });
                }
                catch
                {
                    if (transaction.GetStatus() == TransactionStatus.Started)
                        transaction.RollBack();
                    throw;
                }
            }
        }
    }
}
