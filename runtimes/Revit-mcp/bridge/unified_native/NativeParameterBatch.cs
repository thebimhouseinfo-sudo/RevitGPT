using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Atomic instance-only bulk writes; preview is the default.
    internal static class NativeParameterBatch
    {
        private sealed class Edit
        {
            public Element Owner;
            public Parameter Parameter;
            public string Selector;
            public JToken Value;
        }
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });
        private static string Data(object value) => JsonConvert.SerializeObject(new { data = value });

        private static Parameter Resolve(Element owner, string selector)
        {
            if (String.IsNullOrWhiteSpace(selector) || selector.Length > 128)
                throw new ArgumentException("Invalid parameter selector.");
            IList<Parameter> list;
            if (selector.StartsWith("guid:", StringComparison.OrdinalIgnoreCase))
            {
                Guid guid;
                if (!Guid.TryParseExact(selector.Substring(5), "D", out guid))
                    throw new ArgumentException("Bad shared parameter GUID.");
                Parameter p = owner.get_Parameter(guid);
                list = p == null ? new List<Parameter>() : new List<Parameter> { p };
            }
            else if (selector.StartsWith("bip:", StringComparison.OrdinalIgnoreCase))
            {
                BuiltInParameter bip;
                if (!Enum.TryParse<BuiltInParameter>(selector.Substring(4), false, out bip)
                    || !Enum.IsDefined(typeof(BuiltInParameter), bip))
                    throw new ArgumentException("Bad BuiltInParameter selector.");
                Parameter p = owner.get_Parameter(bip);
                list = p == null ? new List<Parameter>() : new List<Parameter> { p };
            }
            else list = owner.GetParameters(selector);
            if (list.Count != 1)
                throw new ArgumentException(list.Count == 0 ?
                    "Instance parameter missing." : "Ambiguous parameter name.");
            if (list[0].IsReadOnly)
                throw new InvalidOperationException("Parameter is read-only.");
            return list[0];
        }

        private static JToken TypedValue(Parameter p, JToken value)
        {
            if (value == null || value.Type == JTokenType.Null)
                throw new ArgumentException("set requires an explicit non-null value.");
            int integer;
            double number;
            long elementId;
            switch (p.StorageType)
            {
                case StorageType.String:
                    if (value.Type != JTokenType.String || value.Value<string>().Length > 32768)
                        throw new ArgumentException("A string parameter requires a string.");
                    return value.DeepClone();
                case StorageType.Integer:
                    if (value.Type != JTokenType.Integer ||
                        !Int32.TryParse(value.ToString(), NumberStyles.Integer,
                            CultureInfo.InvariantCulture, out integer))
                        throw new ArgumentException("Integer parameter requires exact integer.");
                    return new JValue(integer);
                case StorageType.Double:
                    if ((value.Type != JTokenType.Integer && value.Type != JTokenType.Float)
                        || !Double.TryParse(value.ToString(), NumberStyles.Float,
                            CultureInfo.InvariantCulture, out number)
                        || Double.IsNaN(number) || Double.IsInfinity(number))
                        throw new ArgumentException("Double parameter requires finite internal value.");
                    return new JValue(number);
                case StorageType.ElementId:
                    if (value.Type != JTokenType.String ||
                        !Int64.TryParse(value.Value<string>(), NumberStyles.Integer,
                            CultureInfo.InvariantCulture, out elementId))
                        throw new ArgumentException("ElementId parameter requires string ID.");
                    return new JValue(elementId.ToString(CultureInfo.InvariantCulture));
                default: throw new ArgumentException("Unsupported StorageType.");
            }
        }

        private static Element Owner(Document doc, string text)
        {
            long id;
            if (!Int64.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out id)
                || id <= 0) throw new ArgumentException("Invalid element ID.");
            Element owner = doc.GetElement(new ElementId(id));
            if (owner == null) throw new ArgumentException("Target element missing.");
            return owner;
        }

        private static JToken Read(Parameter p)
        {
            if (!p.HasValue) return JValue.CreateNull();
            switch (p.StorageType)
            {
                case StorageType.String: return new JValue(p.AsString());
                case StorageType.Integer: return new JValue(p.AsInteger());
                case StorageType.Double: return new JValue(p.AsDouble());
                case StorageType.ElementId: return new JValue(p.AsElementId().Value.ToString(
                    CultureInfo.InvariantCulture));
                default: return JValue.CreateNull();
            }
        }

        private static List<Edit> Validate(Document doc, JObject payload, bool copy)
        {
            var edits = new List<Edit>();
            if (copy)
            {
                Element source = Owner(doc, payload.Value<string>("source_element_id"));
                var targets = payload["target_element_ids"] as JArray;
                var mappings = payload["mappings"] as JArray;
                if (targets == null || mappings == null ||
                    targets.Count == 0 || targets.Count > 50 ||
                    mappings.Count == 0 || mappings.Count > 16)
                    throw new ArgumentException("Copy requires 1..50 targets and 1..16 mappings.");
                foreach (var targetToken in targets)
                {
                    if (targetToken.Type != JTokenType.String)
                        throw new ArgumentException("Target IDs must be strings.");
                    Element target = Owner(doc, targetToken.Value<string>());
                    foreach (var mapping in mappings)
                    {
                        var map = mapping as JObject;
                        if (map == null) throw new ArgumentException("Mapping must be object.");
                        string from = map.Value<string>("source");
                        string to = map.Value<string>("target");
                        Parameter sourceParameter = Resolve(source, from);
                        Parameter targetParameter = Resolve(target, to);
                        if (!sourceParameter.HasValue ||
                            sourceParameter.StorageType != targetParameter.StorageType ||
                            sourceParameter.Definition.GetDataType()?.TypeId !=
                                targetParameter.Definition.GetDataType()?.TypeId)
                            throw new ArgumentException("Missing source value or storage/spec conflict.");
                        edits.Add(new Edit { Owner = target, Parameter = targetParameter,
                            Selector = to, Value = TypedValue(targetParameter, Read(sourceParameter)) });
                    }
                }
            }
            else
            {
                var items = payload["operations"] as JArray;
                if (items == null || items.Count == 0 || items.Count > 100)
                    throw new ArgumentException("Batch requires 1..100 operations.");
                foreach (var item in items)
                {
                    var op = item as JObject;
                    if (op == null) throw new ArgumentException("Operation must be object.");
                    string action = op.Value<string>("op") ?? "set";
                    if (action != "set" && action != "skip")
                        throw new ArgumentException("Only exact set/skip supported; clear not silently emulated.");
                    if (action == "skip") continue;
                    Element owner = Owner(doc, op.Value<string>("element_id"));
                    string selector = op.Value<string>("parameter");
                    Parameter parameter = Resolve(owner, selector);
                    edits.Add(new Edit { Owner = owner, Parameter = parameter,
                        Selector = selector, Value = TypedValue(parameter, op["value"]) });
                }
            }
            if (edits.Count > 100)
                throw new ArgumentException("Too many target assignments.");
            var unique = new HashSet<string>(StringComparer.Ordinal);
            foreach (var edit in edits)
                if (!unique.Add(edit.Owner.Id.Value.ToString(CultureInfo.InvariantCulture) +
                    ":" + edit.Parameter.Id.Value.ToString(CultureInfo.InvariantCulture)))
                    throw new ArgumentException("Duplicate assignment to the same parameter.");
            return edits;
        }

        public static string Execute(Document doc, JObject payload, bool copy)
        {
            try
            {
                List<Edit> edits = Validate(doc, payload, copy);
                var preview = edits.Select(e => new {
                    element_id = e.Owner.Id.Value.ToString(CultureInfo.InvariantCulture),
                    parameter = e.Selector, storage_type = e.Parameter.StorageType.ToString(),
                    proposed = e.Value
                }).ToList();
                if (payload.Value<bool?>("dry_run") != false)
                    return Data(new { status = "preview", dry_run = true,
                        atomic = true, edits = preview });
                using (var tx = new Transaction(doc, copy ?
                    "RevitGPT Copy Parameters" : "RevitGPT Batch Parameters"))
                {
                    tx.Start();
                    try
                    {
                        foreach (var edit in edits)
                        {
                            bool ok;
                            switch (edit.Parameter.StorageType)
                            {
                                case StorageType.String: ok = edit.Parameter.Set(edit.Value.Value<string>()); break;
                                case StorageType.Integer: ok = edit.Parameter.Set(edit.Value.Value<int>()); break;
                                case StorageType.Double: ok = edit.Parameter.Set(edit.Value.Value<double>()); break;
                                case StorageType.ElementId:
                                    ok = edit.Parameter.Set(new ElementId(edit.Value.Value<long>())); break;
                                default: throw new InvalidOperationException("Unsupported storage type.");
                            }
                            if (!ok) throw new InvalidOperationException("Revit refused parameter write.");
                        }
                        if (tx.Commit() != TransactionStatus.Committed)
                            return Error(500, "Transaction did not commit.");
                    }
                    catch
                    {
                        if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                        throw;
                    }
                }
                return Data(new { status = "committed", atomic = true,
                    count = edits.Count,
                    readback = edits.Select(e => new {
                        element_id = e.Owner.Id.Value.ToString(CultureInfo.InvariantCulture),
                        parameter = e.Selector, raw_value = Read(e.Parameter)
                    }).ToList() });
            }
            catch (ArgumentException e) { return Error(400, e.Message); }
            catch (InvalidOperationException e) { return Error(409, e.Message); }
            catch (Exception e) { return Error(500, "Parameter batch: " + e.GetType().Name); }
        }
    }
}
