using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // All methods in this class must execute ONLY inside ExternalEvent.Execute.
    // Mutations are deliberately disabled until their per-route contract and
    // real disposable-model transaction/rollback tests are accepted.
    public static class RevitApiRouter
    {
        public static string Execute(UIApplication app, string method, string path, string body)
        {
            if (app == null) return Error(503, "No Revit UI API context.");
            try
            {
                if (path == "/health")
                    return Data(new { status = "ok", host = "unified-native-preview",
                        revit_available = true, version = "0.1.0-preview",
                        mutations_ready = false });
                if (BridgeHttpProtocol.IsWrite(path))
                    return Error(501, "Native write route not yet validated; no model change was performed.");
                var payload = String.IsNullOrWhiteSpace(body) ? new JObject() : JObject.Parse(body);
                if (path == "/documents")
                    return Data(app.Application.Documents.Cast<Document>().Select(DocumentInfo).ToList());

                var doc = FindDocument(app, payload);
                if (doc == null) return Error(404, "Target Revit document is not open.");
                if (path == "/document/active")
                {
                    var active = app.ActiveUIDocument?.Document;
                    if (active == null) return Error(404, "No active model.");
                    return Data(DocumentInfo(active));
                }
                if (path == "/views")
                    return Data(new FilteredElementCollector(doc).OfClass(typeof(View))
                        .Cast<View>().Where(x => !x.IsTemplate)
                        .Select(x => new { id = x.Id.IntegerValue.ToString(CultureInfo.InvariantCulture),
                            name = x.Name, view_type = x.ViewType.ToString() }).ToList());
                if (path == "/levels")
                    return Data(new FilteredElementCollector(doc).OfClass(typeof(Level))
                        .Cast<Level>().Select(x => new { id = x.Id.IntegerValue.ToString(CultureInfo.InvariantCulture),
                            name = x.Name, elevation = x.Elevation }).ToList());
                if (path == "/elements") return Elements(doc, payload);
                if (path == "/element") return Element(doc, payload);
                if (path == "/families")
                {
                    var category = Token(payload, "category");
                    return Data(new FilteredElementCollector(doc).OfClass(typeof(Family))
                        .Cast<Family>().Where(x => category == null ||
                            (x.FamilyCategory != null && EqualsIgnoreCase(x.FamilyCategory.Name, category)))
                        .Select(x => new { id = x.Id.IntegerValue.ToString(CultureInfo.InvariantCulture),
                            name = x.Name, category = x.FamilyCategory?.Name ?? "" }).ToList());
                }
                if (path == "/family/types")
                {
                    var family = Token(payload, "family");
                    var category = Token(payload, "category");
                    return Data(new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol))
                        .Cast<FamilySymbol>().Where(x => (family == null || EqualsIgnoreCase(x.Family.Name, family)) &&
                            (category == null || (x.Category != null && EqualsIgnoreCase(x.Category.Name, category))))
                        .Select(x => new { id = x.Id.IntegerValue.ToString(CultureInfo.InvariantCulture),
                            family = x.Family.Name, name = x.Name, category = x.Category?.Name ?? "" }).ToList());
                }
                if (path == "/system/types")
                {
                    var filter = Token(payload, "classification");
                    var types = new List<object>();
                    foreach (MechanicalSystemType type in new FilteredElementCollector(doc).OfClass(typeof(MechanicalSystemType)))
                    {
                        string classification = type.SystemClassification.ToString();
                        if (filter == null || EqualsIgnoreCase(classification, filter))
                            types.Add(new { id = type.Id.IntegerValue.ToString(CultureInfo.InvariantCulture),
                                name = type.Name, classification = classification, kind = "duct" });
                    }
                    foreach (PipingSystemType type in new FilteredElementCollector(doc).OfClass(typeof(PipingSystemType)))
                    {
                        string classification = type.SystemClassification.ToString();
                        if (filter == null || EqualsIgnoreCase(classification, filter))
                            types.Add(new { id = type.Id.IntegerValue.ToString(CultureInfo.InvariantCulture),
                                name = type.Name, classification = classification, kind = "pipe" });
                    }
                    return Data(types);
                }
                if (path == "/annotations") return Annotations(doc, payload);
                if (path == "/element/connectors")
                    return Error(501, "Connectors require an explicit Revit API readback fixture.");
                return Error(501, "Native route is not implemented: " + path);
            }
            catch (JsonException) { return Error(400, "Invalid JSON payload."); }
            catch (FormatException) { return Error(400, "Malformed element or view ID."); }
            catch (ArgumentException) { return Error(400, "Invalid Revit API request arguments."); }
            catch (Exception e) { return Error(500, "Revit API read failed: " + e.GetType().Name); }
        }

        private static object DocumentInfo(Document doc)
        {
            return new {
                id = doc.GetHashCode().ToString(CultureInfo.InvariantCulture),
                title = doc.Title, path = doc.PathName ?? "",
                is_workshared = doc.IsWorkshared,
                revit_version = doc.Application.VersionNumber
            };
        }

        private static Document FindDocument(UIApplication app, JObject payload)
        {
            string id = Token(payload, "document_id");
            if (String.IsNullOrEmpty(id)) return app.ActiveUIDocument?.Document;
            foreach (Document doc in app.Application.Documents)
                if (doc.GetHashCode().ToString(CultureInfo.InvariantCulture) == id)
                    return doc;
            return null; // Never silently rebind to a different active model.
        }

        private static string Elements(Document doc, JObject payload)
        {
            int? viewId = Integer(payload, "view_id");
            var source = viewId.HasValue
                ? new FilteredElementCollector(doc, new ElementId(viewId.Value))
                : new FilteredElementCollector(doc);
            var collector = source.WhereElementIsNotElementType();
            string category = Token(payload, "category");
            string className = Token(payload, "class");
            string family = Token(payload, "family");
            string type = Token(payload, "type");
            var output = new List<object>();
            foreach (Element el in collector)
            {
                if (category != null && !EqualsIgnoreCase(el.Category?.Name, category)) continue;
                if (className != null && !EqualsIgnoreCase(el.GetType().Name, className)) continue;
                if (family != null && !(el is FamilyInstance instance &&
                      EqualsIgnoreCase(instance.Symbol?.Family?.Name, family))) continue;
                if (type != null && !EqualsIgnoreCase(el.Name, type)) continue;
                if (output.Count >= 5000)
                    return Error(413, "Too many elements; add filters. No truncated result returned.");
                output.Add(ElementInfo(el));
            }
            return Data(output);
        }

        private static string Element(Document doc, JObject payload)
        {
            int? id = Integer(payload, "element_id");
            if (!id.HasValue) return Error(400, "element_id required.");
            Element item = doc.GetElement(new ElementId(id.Value));
            if (item == null) return Error(404, "Element does not exist.");
            if (payload.Value<bool?>("include_connectors") == true)
                return Error(501, "Connector readback has not passed host verification.");
            return Data(ElementInfo(item));
        }

        private static string Annotations(Document doc, JObject payload)
        {
            int? viewId = Integer(payload, "view_id");
            if (!viewId.HasValue) return Error(400, "view_id required.");
            var view = doc.GetElement(new ElementId(viewId.Value)) as View;
            if (view == null) return Error(404, "View not found.");
            string filter = Token(payload, "type");
            var output = new List<object>();
            foreach (Element el in new FilteredElementCollector(doc, view.Id).WhereElementIsNotElementType())
            {
                if (!(el is IndependentTag) && !(el is TextNote) && !(el is Dimension)) continue;
                string kind = el is IndependentTag ? "tag" : el is TextNote ? "text" : "dimension";
                if (filter != null && !EqualsIgnoreCase(kind, filter)) continue;
                if (output.Count >= 5000)
                    return Error(413, "Too many annotations; add filters.");
                output.Add(ElementInfo(el));
            }
            return Data(output);
        }

        private static object ElementInfo(Element element)
        {
            var result = new Dictionary<string, object>
            {
                { "id", element.Id.IntegerValue.ToString(CultureInfo.InvariantCulture) },
                { "category", element.Category?.Name ?? "" },
                { "class", element.GetType().Name },
                { "name", element.Name ?? "" }
            };
            if (element is FamilyInstance fi)
            {
                result["family"] = fi.Symbol?.Family?.Name ?? "";
                result["type"] = fi.Symbol?.Name ?? "";
            }
            else { result["family"] = ""; result["type"] = element.Name ?? ""; }
            if (element.Location is LocationPoint point)
            {
                result["location"] = new { type = "point",
                    x = point.Point.X, y = point.Point.Y, z = point.Point.Z,
                    rotation = point.Rotation };
            }
            else if (element.Location is LocationCurve curve)
            {
                var a = curve.Curve.GetEndPoint(0);
                var b = curve.Curve.GetEndPoint(1);
                result["location"] = new { type = "curve",
                    start = new { x = a.X, y = a.Y, z = a.Z },
                    end = new { x = b.X, y = b.Y, z = b.Z },
                    length = curve.Curve.Length };
            }
            return result;
        }

        private static string Token(JObject payload, string key) =>
            payload[key]?.Type == JTokenType.Null ? null : payload[key]?.ToString();
        private static int? Integer(JObject payload, string key) =>
            String.IsNullOrEmpty(Token(payload, key))
                ? (int?)null
                : Int32.Parse(Token(payload, key), CultureInfo.InvariantCulture);
        private static bool EqualsIgnoreCase(string a, string b) =>
            String.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        private static string Data(object result) =>
            JsonConvert.SerializeObject(new { data = result });
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });
    }
}
