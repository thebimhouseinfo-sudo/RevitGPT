using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Bounded keyset pagination and exact typed parameter predicate.
    // Not a model snapshot: callers MUST restart pagination if the RVT changes.
    internal static class NativeElementQuery
    {
        private static string Data(object o) => JsonConvert.SerializeObject(new { data = o });
        private static string Error(int c, string reason) =>
            JsonConvert.SerializeObject(new { error = new { code = c, message = reason } });
        private static string Token(JObject p, string key) => p[key]?.ToString();
        private static bool Same(string a, string b) =>
            String.Equals(a, b, StringComparison.OrdinalIgnoreCase);

        private static Parameter ExactParameter(Element e, string selector)
        {
            if (String.IsNullOrWhiteSpace(selector) || selector.Length > 128)
                throw new ArgumentException("Exact parameter selector required.");
            if (selector.StartsWith("guid:", StringComparison.OrdinalIgnoreCase))
            {
                Guid guid;
                if (!Guid.TryParseExact(selector.Substring(5), "D", out guid))
                    throw new ArgumentException("Invalid GUID selector.");
                return e.get_Parameter(guid);
            }
            if (selector.StartsWith("bip:", StringComparison.OrdinalIgnoreCase))
            {
                BuiltInParameter bip;
                if (!Enum.TryParse<BuiltInParameter>(selector.Substring(4), false, out bip) ||
                    !Enum.IsDefined(typeof(BuiltInParameter), bip))
                    throw new ArgumentException("Invalid BIP selector.");
                return e.get_Parameter(bip);
            }
            var matches = e.GetParameters(selector);
            if (matches.Count > 1)
                throw new ArgumentException("Ambiguous parameter display name.");
            return matches.Count == 0 ? null : matches[0];
        }

        private static bool MatchesPredicate(Element element, JObject predicate)
        {
            if (predicate == null) return true;
            string selector = Token(predicate, "parameter");
            string operation = Token(predicate, "operator");
            if (operation != "equals" && operation != "contains")
                throw new ArgumentException("Predicate must be equals or contains.");
            var p = ExactParameter(element, selector);
            if (p == null)
            {
                var typeId = element.GetTypeId();
                if (typeId != null && typeId != ElementId.InvalidElementId)
                    p = ExactParameter(element.Document.GetElement(typeId), selector);
            }
            if (p == null || !p.HasValue) return false;
            JToken value = predicate["value"];
            if (value == null || value.Type == JTokenType.Null)
                throw new ArgumentException("Typed parameter predicate value required.");
            if (operation == "contains")
            {
                if (p.StorageType != StorageType.String || value.Type != JTokenType.String)
                    throw new ArgumentException("contains supports text only.");
                return (p.AsString() ?? "").IndexOf(value.Value<string>(),
                    StringComparison.OrdinalIgnoreCase) >= 0;
            }
            switch (p.StorageType)
            {
                case StorageType.String:
                    if (value.Type != JTokenType.String) throw new ArgumentException("String value required.");
                    return String.Equals(p.AsString(), value.Value<string>(), StringComparison.Ordinal);
                case StorageType.Integer:
                    if (value.Type != JTokenType.Integer) throw new ArgumentException("Integer value required.");
                    return p.AsInteger() == value.Value<int>();
                case StorageType.Double:
                    if (value.Type != JTokenType.Float && value.Type != JTokenType.Integer)
                        throw new ArgumentException("Numeric internal value required.");
                    double needle = value.Value<double>();
                    if (Double.IsNaN(needle) || Double.IsInfinity(needle))
                        throw new ArgumentException("Finite numeric value required.");
                    return Math.Abs(p.AsDouble() - needle) <= 0.0000001;
                case StorageType.ElementId:
                    long id;
                    if (value.Type != JTokenType.String ||
                        !Int64.TryParse(value.Value<string>(), NumberStyles.Integer,
                            CultureInfo.InvariantCulture, out id))
                        throw new ArgumentException("ElementId selector requires string ID.");
                    return p.AsElementId().Value == id;
                default: return false;
            }
        }

        public static string Execute(Document doc, JObject input)
        {
            try
            {
                int limit = input.Value<int?>("page_size") ?? 100;
                if (limit <= 0 || limit > 200)
                    return Error(400, "page_size must be 1..200.");
                long after = 0;
                if (input["after_id"] != null)
                {
                    if (input["after_id"].Type != JTokenType.String ||
                        !long.TryParse(Token(input, "after_id"), NumberStyles.None,
                            CultureInfo.InvariantCulture, out after) || after <= 0)
                        return Error(400, "after_id must be a positive decimal ID.");
                }
                string category = Token(input, "category"), family = Token(input, "family"),
                    typeName = Token(input, "type"), className = Token(input, "class");
                JObject predicate = input["predicate"] as JObject;
                if (input["predicate"] != null && predicate == null)
                    return Error(400, "predicate must be object.");
                var output = new List<object>();
                long? nextId = null;
                int scanned = 0, matched = 0;
                foreach (Element e in new FilteredElementCollector(doc)
                    .WhereElementIsNotElementType().OrderBy(x => x.Id.Value))
                {
                    if (++scanned > 200000)
                        return Error(413, "Query scan exceeds 200,000 elements; add filters.");
                    if (e.Id.Value <= after) continue;
                    if (category != null && !Same(e.Category?.Name, category)) continue;
                    if (className != null && !Same(e.GetType().Name, className)) continue;
                    if (family != null && !(e is FamilyInstance fi &&
                        Same(fi.Symbol?.Family?.Name, family))) continue;
                    if (typeName != null && !Same(e.Name, typeName)) continue;
                    if (!MatchesPredicate(e, predicate)) continue;
                    matched++;
                    if (matched > limit) break;
                    nextId = e.Id.Value;
                    output.Add(new {
                        element_id = e.Id.Value.ToString(CultureInfo.InvariantCulture),
                        category = e.Category?.Name ?? "",
                        class_name = e.GetType().Name,
                        name = e.Name ?? "",
                        type_id = e.GetTypeId().Value.ToString(CultureInfo.InvariantCulture)
                    });
                }
                bool hasMore = matched > limit;
                return Data(new {
                    elements = output, page_size = limit, returned = output.Count,
                    has_more = hasMore,
                    next_after_id = hasMore ? nextId?.ToString(CultureInfo.InvariantCulture) : null,
                    complete = !hasMore,
                    snapshot_consistency = "none",
                    warning = "Pagination is not a model snapshot; restart if model changes.",
                    coordinate_unit = "revit_internal_feet"
                });
            }
            catch (ArgumentException ex) { return Error(400, ex.Message); }
            catch (Exception ex) { return Error(500, "Element query failed: " + ex.GetType().Name); }
        }
    }
}
