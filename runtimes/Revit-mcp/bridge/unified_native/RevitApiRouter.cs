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
        public static string Execute(UIApplication app, string method, string path, string body,
            NativeModelBindingState binding = null)
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
                if (path == "/document/active")
                {
                    var active = app.ActiveUIDocument?.Document;
                    if (active == null) return Error(404, "No active model.");
                    return Data(DocumentInfo(active));
                }
                if (binding != null)
                {
                    // Request-side refresh inside ExternalEvent: tab switches or
                    // close/reopen must not rely on the next Idling tick.
                    var active = app.ActiveUIDocument?.Document;
                    binding.Observe(
                        active?.GetHashCode().ToString(CultureInfo.InvariantCulture),
                        active?.Title,
                        app.Application.Documents.Cast<Document>()
                            .Where(d => !d.IsLinked && !d.IsFamilyDocument)
                            .Select(d => d.GetHashCode().ToString(CultureInfo.InvariantCulture)));
                }
                if (path == "/binding/status")
                {
                    if (binding == null) return Error(503, "Native binding state unavailable.");
                    var snap = binding.Current;
                    return Data(new {
                        status = snap.Status,
                        host_instance_id = snap.HostInstanceId,
                        revision = snap.Revision,
                        active_id = snap.ActiveId,
                        active_title = snap.ActiveTitle,
                        bound_id = snap.BoundId,
                        bound_title = snap.BoundTitle
                    });
                }
                if (binding == null) return Error(503, "Native binding enforcement unavailable.");
                string denial = binding.ReadDenial(Token(payload, "document_id"));
                if (denial != null) return Error(409, denial);
                var doc = FindDocument(app, payload);
                if (doc == null) return Error(404, "Target Revit document is not open.");
                if (path == "/ui/selection") return Selection(app, doc);
                if (path == "/ui/selection/set") return SetSelection(app, doc, payload);
                if (path == "/ui/show") return ShowElements(app, doc, payload);
                if (path == "/ui/view/activate") return ActivateView(app, doc, payload);
                if (path == "/views")
                    return Data(new FilteredElementCollector(doc).OfClass(typeof(View))
                        .Cast<View>().Where(x => !x.IsTemplate)
                        .Select(x => new { id = x.Id.Value.ToString(CultureInfo.InvariantCulture),
                            name = x.Name, view_type = x.ViewType.ToString() }).ToList());
                if (path == "/levels")
                    return Data(new FilteredElementCollector(doc).OfClass(typeof(Level))
                        .Cast<Level>().Select(x => new { id = x.Id.Value.ToString(CultureInfo.InvariantCulture),
                            name = x.Name, elevation = x.Elevation }).ToList());
                if (path == "/elements") return Elements(doc, payload);
                if (path == "/elements/aggregate") return AggregateElements(doc, payload);
                if (path == "/element") return Element(doc, payload);
                if (path == "/families")
                {
                    var category = Token(payload, "category");
                    return Data(new FilteredElementCollector(doc).OfClass(typeof(Family))
                        .Cast<Family>().Where(x => category == null ||
                            (x.FamilyCategory != null && EqualsIgnoreCase(x.FamilyCategory.Name, category)))
                        .Select(x => new { id = x.Id.Value.ToString(CultureInfo.InvariantCulture),
                            name = x.Name, category = x.FamilyCategory?.Name ?? "" }).ToList());
                }
                if (path == "/family/types")
                {
                    var family = Token(payload, "family");
                    var category = Token(payload, "category");
                    return Data(new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol))
                        .Cast<FamilySymbol>().Where(x => (family == null || EqualsIgnoreCase(x.Family.Name, family)) &&
                            (category == null || (x.Category != null && EqualsIgnoreCase(x.Category.Name, category))))
                        .Select(x => new { id = x.Id.Value.ToString(CultureInfo.InvariantCulture),
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
                            types.Add(new { id = type.Id.Value.ToString(CultureInfo.InvariantCulture),
                                name = type.Name, classification = classification, kind = "duct" });
                    }
                    foreach (PipingSystemType type in new FilteredElementCollector(doc).OfClass(typeof(PipingSystemType)))
                    {
                        string classification = type.SystemClassification.ToString();
                        if (filter == null || EqualsIgnoreCase(classification, filter))
                            types.Add(new { id = type.Id.Value.ToString(CultureInfo.InvariantCulture),
                                name = type.Name, classification = classification, kind = "pipe" });
                    }
                    return Data(types);
                }
                if (path == "/annotations") return Annotations(doc, payload);
                if (path == "/mep/systems") return MepSystems(doc, payload);
                if (path == "/element/connectors") return Connectors(doc, payload);
                return Error(501, "Native route is not implemented: " + path);
            }
            catch (JsonException) { return Error(400, "Invalid JSON payload."); }
            catch (FormatException) { return Error(400, "Malformed element or view ID."); }
            catch (ArgumentException) { return Error(400, "Invalid Revit API request arguments."); }
            catch (Exception e) { return Error(500, "Revit API read failed: " + e.GetType().Name); }
        }

        // Selection and zoom only: no persistent document edit. All run in ExternalEvent.
        private static string Selection(UIApplication app, Document doc)
        {
            var uidoc = app.ActiveUIDocument;
            if (uidoc == null || !Object.ReferenceEquals(uidoc.Document, doc))
                return Error(409, "Bound Revit document must be the active UI document.");
            return Data(new {
                element_ids = uidoc.Selection.GetElementIds()
                    .Select(id => id.Value.ToString(CultureInfo.InvariantCulture)).ToList(),
                active_view_id = uidoc.ActiveView.Id.Value.ToString(CultureInfo.InvariantCulture)
            });
        }

        private static List<ElementId> UiElementIds(Document doc, View activeView, JObject payload)
        {
            var input = payload["element_ids"] as JArray;
            if (input == null || input.Count > 500)
                throw new ArgumentException("element_ids must be an array of at most 500 IDs.");
            var result = new List<ElementId>();
            var seen = new HashSet<long>();
            foreach (var item in input)
            {
                long raw;
                if (item.Type != JTokenType.String ||
                    !Int64.TryParse(item.ToString(), NumberStyles.Integer,
                        CultureInfo.InvariantCulture, out raw) ||
                    !seen.Add(raw) || raw <= 0)
                    throw new ArgumentException("Invalid or duplicate element ID.");
                var id = new ElementId(raw);
                var element = doc.GetElement(id);
                if (element == null || (element.ViewSpecific &&
                    element.OwnerViewId != ElementId.InvalidElementId &&
                    element.OwnerViewId != activeView.Id))
                    throw new ArgumentException("Unknown or view-incompatible element ID.");
                result.Add(id);
            }
            return result;
        }

        private static string SetSelection(UIApplication app, Document doc, JObject payload)
        {
            var uidoc = app.ActiveUIDocument;
            if (uidoc == null || !Object.ReferenceEquals(uidoc.Document, doc))
                return Error(409, "Bound Revit document must be active for selection.");
            var ids = UiElementIds(doc, uidoc.ActiveView, payload);
            uidoc.Selection.SetElementIds(ids);
            return Selection(app, doc);
        }

        private static string ShowElements(UIApplication app, Document doc, JObject payload)
        {
            var uidoc = app.ActiveUIDocument;
            if (uidoc == null || !Object.ReferenceEquals(uidoc.Document, doc))
                return Error(409, "Bound Revit document must be active for zoom/show.");
            var ids = UiElementIds(doc, uidoc.ActiveView, payload);
            if (ids.Count == 0) return Error(400, "show requires at least one element.");
            uidoc.ShowElements(ids);
            return Data(new { shown = ids.Count, active_view_id =
                uidoc.ActiveView.Id.Value.ToString(CultureInfo.InvariantCulture) });
        }

        private static string ActivateView(UIApplication app, Document doc, JObject payload)
        {
            var uidoc = app.ActiveUIDocument;
            if (uidoc == null || !Object.ReferenceEquals(uidoc.Document, doc))
                return Error(409, "Bound document must be active before switching views.");
            long? viewId = LongNumber(payload, "view_id");
            if (!viewId.HasValue || viewId.Value <= 0)
                return Error(400, "Valid view_id required.");
            View view = doc.GetElement(new ElementId(viewId.Value)) as View;
            if (view == null || view.IsTemplate || view.ViewType == ViewType.Schedule)
                return Error(400, "View does not support UI activation.");
            uidoc.ActiveView = view;
            return Data(new { active_view_id = uidoc.ActiveView.Id.Value.ToString(CultureInfo.InvariantCulture),
                view_name = uidoc.ActiveView.Name });
        }

        private static object DocumentInfo(Document doc)
        {
            return NativeDocumentContract.Create(
                doc.GetHashCode().ToString(CultureInfo.InvariantCulture),
                doc.Title, doc.PathName, doc.IsWorkshared,
                doc.Application.VersionNumber);
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
            long? viewId = LongNumber(payload, "view_id");
            var source = viewId.HasValue
                ? new FilteredElementCollector(doc, new ElementId(viewId.Value))
                : new FilteredElementCollector(doc);
            var collector = source.WhereElementIsNotElementType();
            var requestedParameters = RequestedParameters(payload);
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
                if (output.Count >= (requestedParameters.Count > 0 ? 1000 : 5000))
                    return Error(413, requestedParameters.Count > 0
                        ? "Too many parameter-bearing elements; add filters (maximum 1000). No truncated result returned."
                        : "Too many elements; add filters. No truncated result returned.");
                output.Add(ElementInfo(el, requestedParameters));
            }
            return Data(output);
        }

        // Aggregate in Revit UI context; no 5,000-element response limit.
        // Server-side count and bounded group keys avoid materializing every element.
        private static string AggregateElements(Document doc, JObject payload)
        {
            string category = Token(payload, "category");
            string className = Token(payload, "class");
            string family = Token(payload, "family");
            string type = Token(payload, "type");
            string groupBy = Token(payload, "group_by");
            if (groupBy != null && groupBy != "category" && groupBy != "family" &&
                groupBy != "type" && groupBy != "level")
                return Error(400, "Unsupported group_by. Use category/family/type/level.");
            long? viewId = LongNumber(payload, "view_id");
            var view = viewId.HasValue ? doc.GetElement(new ElementId(viewId.Value)) as View : null;
            if (viewId.HasValue && view == null) return Error(404, "View not found.");
            var source = viewId.HasValue
                ? new FilteredElementCollector(doc, view.Id)
                : new FilteredElementCollector(doc);
            var counts = new SortedDictionary<string, long>(StringComparer.Ordinal);
            long total = 0;
            foreach (Element element in source.WhereElementIsNotElementType())
            {
                if (category != null && !EqualsIgnoreCase(element.Category?.Name, category)) continue;
                if (className != null && !EqualsIgnoreCase(element.GetType().Name, className)) continue;
                if (family != null && !(element is FamilyInstance inst &&
                    EqualsIgnoreCase(inst.Symbol?.Family?.Name, family))) continue;
                if (type != null && !EqualsIgnoreCase(element.Name, type)) continue;
                total++;
                if (groupBy == null) continue;
                string key = "(none)";
                if (groupBy == "category") key = element.Category?.Name ?? "(none)";
                if (groupBy == "family") key = (element as FamilyInstance)?.Symbol?.Family?.Name ?? "(none)";
                if (groupBy == "type") key = element.Name ?? "(none)";
                if (groupBy == "level")
                {
                    ElementId levelId = element.LevelId;
                    key = levelId == null || levelId == ElementId.InvalidElementId
                        ? "(none)" : levelId.Value.ToString(CultureInfo.InvariantCulture);
                }
                if (!counts.ContainsKey(key))
                {
                    if (counts.Count >= 500)
                        return Error(413, "Too many group keys; add filters. No incomplete count returned.");
                    counts[key] = 0;
                }
                counts[key]++;
            }
            return Data(new {
                count = total,
                group_by = groupBy,
                groups = counts.Select(kv => new { key = kv.Key, count = kv.Value }).ToList(),
                complete = true,
                scope = viewId.HasValue ? "view_visible" : "document_placed_instances",
                view_id = viewId?.ToString(CultureInfo.InvariantCulture)
            });
        }

        private static string Element(Document doc, JObject payload)
        {
            long? id = LongNumber(payload, "element_id");
            if (!id.HasValue) return Error(400, "element_id required.");
            Element item = doc.GetElement(new ElementId(id.Value));
            if (item == null) return Error(404, "Element does not exist.");
            if (payload.Value<bool?>("include_connectors") == true)
                return Error(501, "Connector readback has not passed host verification.");
            return Data(ElementInfo(item, RequestedParameters(payload)));
        }

        // Actual system INSTANCE inventory, not MechanicalSystemType/PipingSystemType.
        private static string MepSystems(Document doc, JObject payload)
        {
            string kind = Token(payload, "kind");
            if (kind != null && kind != "duct" && kind != "pipe")
                return Error(400, "kind must be duct or pipe.");
            var systems = new List<object>();
            if (kind == null || kind == "duct")
                foreach (MechanicalSystem sys in new FilteredElementCollector(doc)
                    .OfClass(typeof(MechanicalSystem)).Cast<MechanicalSystem>())
                {
                    if (systems.Count >= 1000)
                        return Error(413, "Too many MEP systems; select kind.");
                    systems.Add(new { id = sys.Id.Value.ToString(CultureInfo.InvariantCulture),
                        name = sys.Name, kind = "duct",
                        type_id = sys.GetTypeId().Value.ToString(CultureInfo.InvariantCulture),
                        member_count = sys.Elements.Size });
                }
            if (kind == null || kind == "pipe")
                foreach (PipingSystem sys in new FilteredElementCollector(doc)
                    .OfClass(typeof(PipingSystem)).Cast<PipingSystem>())
                {
                    if (systems.Count >= 1000)
                        return Error(413, "Too many MEP systems; select kind.");
                    systems.Add(new { id = sys.Id.Value.ToString(CultureInfo.InvariantCulture),
                        name = sys.Name, kind = "pipe",
                        type_id = sys.GetTypeId().Value.ToString(CultureInfo.InvariantCulture),
                        member_count = sys.Elements.Size });
                }
            return Data(systems);
        }

        private static string Connectors(Document doc, JObject payload)
        {
            long? rawId = LongNumber(payload, "element_id");
            if (!rawId.HasValue || rawId.Value <= 0)
                return Error(400, "element_id required.");
            var owner = doc.GetElement(new ElementId(rawId.Value));
            if (owner == null) return Error(404, "Connector owner not found.");

            ConnectorManager manager = null;
            var instance = owner as FamilyInstance;
            if (instance != null) manager = instance.MEPModel?.ConnectorManager;
            var curve = owner as MEPCurve;
            if (curve != null) manager = curve.ConnectorManager;
            if (manager == null) return Data(new object[0]);

            var connectors = new List<object>();
            foreach (Connector connector in manager.Connectors)
            {
                if (connectors.Count >= 256)
                    return Error(413, "More than 256 connectors; result refused without truncation.");
                var references = new List<object>();
                foreach (Connector reference in connector.AllRefs)
                {
                    if (references.Count >= 256)
                        return Error(413, "More than 256 connector references; result refused.");
                    // AllRefs includes logical and self-references; preserve owner IDs
                    // for deterministic downstream interpretation instead of guessing.
                    references.Add(new {
                        owner_element_id = reference.Owner?.Id.Value.ToString(CultureInfo.InvariantCulture),
                        connector_id = reference.Id,
                        connector_type = reference.ConnectorType.ToString(),
                        domain = reference.Domain.ToString()
                    });
                }
                var xyz = connector.Origin;
                connectors.Add(new {
                    id = connector.Id,
                    connector_type = connector.ConnectorType.ToString(),
                    domain = connector.Domain.ToString(),
                    is_connected = connector.IsConnected,
                    coordinate = new { x = xyz.X, y = xyz.Y, z = xyz.Z },
                    coordinate_unit = "revit_internal_feet",
                    references
                });
            }
            return Data(connectors);
        }

        private static string Annotations(Document doc, JObject payload)
        {
            long? viewId = LongNumber(payload, "view_id");
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

        // Exact, bounded parameter-name selection. Never silently choose among
        // duplicate display names or reinterpret an ElementId as a measurement.
        private static List<string> RequestedParameters(JObject payload)
        {
            var token = payload["parameters"];
            if (token == null || token.Type == JTokenType.Null) return new List<string>();
            if (!(token is JArray array) || array.Count > 16)
                throw new ArgumentException("parameters must be an array of 0..16 names.");
            var names = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (JToken item in array)
            {
                if (item.Type != JTokenType.String) throw new ArgumentException("parameter name must be a string.");
                string name = item.Value<string>();
                if (String.IsNullOrWhiteSpace(name) || name.Length > 128 ||
                    !String.Equals(name, name.Trim(), StringComparison.Ordinal) || !seen.Add(name))
                    throw new ArgumentException("Invalid or duplicate parameter name.");
                names.Add(name);
            }
            return names;
        }

        private static object ParameterInfo(Parameter parameter, string scope, Element owner)
        {
            object raw = null;
            if (parameter.HasValue)
            {
                switch (parameter.StorageType)
                {
                    case StorageType.String: raw = parameter.AsString(); break;
                    case StorageType.Integer: raw = parameter.AsInteger(); break;
                    case StorageType.Double: raw = parameter.AsDouble(); break;
                    case StorageType.ElementId:
                        var refId = parameter.AsElementId();
                        raw = refId == null ? null : refId.Value.ToString(CultureInfo.InvariantCulture);
                        break;
                }
            }
            string spec = parameter.Definition.GetDataType()?.TypeId;
            string display = parameter.HasValue ? parameter.AsValueString() : null;
            string unit = parameter.StorageType == StorageType.Double
                ? parameter.GetUnitTypeId()?.TypeId : null;
            return new
            {
                status = "OK",
                scope,
                owner_element_id = owner.Id.Value.ToString(CultureInfo.InvariantCulture),
                parameter_id = parameter.Id.Value.ToString(CultureInfo.InvariantCulture),
                storage_type = parameter.StorageType.ToString(),
                spec_type_id = spec,
                unit_type_id = unit,
                raw_unit = parameter.StorageType == StorageType.Double ? "revit_internal" : null,
                raw_value = raw,
                display_value = display,
                has_value = parameter.HasValue,
                read_only = parameter.IsReadOnly,
                shared_guid = parameter.IsShared ? parameter.GUID.ToString("D") : null
            };
        }

        // Stable selectors: guid:<D-format GUID>, bip:<BuiltInParameter enum>.
        // Unprefixed selectors preserve legacy exact display-name lookup.
        private static IList<Parameter> ResolveParameters(Element owner, string selector)
        {
            if (selector.StartsWith("guid:", StringComparison.OrdinalIgnoreCase))
            {
                Guid guid;
                if (!Guid.TryParseExact(selector.Substring(5), "D", out guid))
                    throw new ArgumentException("Invalid shared parameter GUID selector.");
                Parameter match = owner.get_Parameter(guid);
                return match == null ? new List<Parameter>() : new List<Parameter> { match };
            }
            if (selector.StartsWith("bip:", StringComparison.OrdinalIgnoreCase))
            {
                string enumName = selector.Substring(4);
                BuiltInParameter bip;
                if (!Enum.TryParse<BuiltInParameter>(enumName, false, out bip) ||
                    !Enum.IsDefined(typeof(BuiltInParameter), bip))
                    throw new ArgumentException("Invalid BuiltInParameter selector.");
                Parameter match = owner.get_Parameter(bip);
                return match == null ? new List<Parameter>() : new List<Parameter> { match };
            }
            return owner.GetParameters(selector);
        }

        private static Dictionary<string, object> RequestedParameterValues(Element element, IList<string> names)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            if (names.Count == 0) return result;
            Element typeElement = null;
            foreach (string name in names)
            {
                var instanceMatches = ResolveParameters(element, name);
                if (instanceMatches.Count > 1)
                {
                    result[name] = new { status = "AMBIGUOUS", scope = "instance",
                        matches = instanceMatches.Count };
                    continue;
                }
                if (instanceMatches.Count == 1)
                {
                    result[name] = ParameterInfo(instanceMatches[0], "instance", element);
                    continue;
                }
                if (typeElement == null)
                {
                    ElementId typeId = element.GetTypeId();
                    if (typeId != null && typeId != ElementId.InvalidElementId)
                        typeElement = element.Document.GetElement(typeId);
                }
                if (typeElement != null)
                {
                    var typeMatches = ResolveParameters(typeElement, name);
                    if (typeMatches.Count > 1)
                    {
                        result[name] = new { status = "AMBIGUOUS", scope = "type",
                            matches = typeMatches.Count };
                        continue;
                    }
                    if (typeMatches.Count == 1)
                    {
                        result[name] = ParameterInfo(typeMatches[0], "type", typeElement);
                        continue;
                    }
                }
                result[name] = new { status = "MISSING" };
            }
            return result;
        }

        private static object ElementInfo(Element element, IList<string> requestedParameters = null)
        {
            var result = new Dictionary<string, object>
            {
                { "id", element.Id.Value.ToString(CultureInfo.InvariantCulture) },
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
            if (requestedParameters != null && requestedParameters.Count > 0)
                result["parameters"] = RequestedParameterValues(element, requestedParameters);
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
        private static long? LongNumber(JObject payload, string key) =>
            String.IsNullOrEmpty(Token(payload, key))
                ? (long?)null
                : Int64.Parse(Token(payload, key), CultureInfo.InvariantCulture);
        private static bool EqualsIgnoreCase(string a, string b) =>
            String.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        private static string Data(object result) =>
            JsonConvert.SerializeObject(new { data = result });
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });
    }
}
