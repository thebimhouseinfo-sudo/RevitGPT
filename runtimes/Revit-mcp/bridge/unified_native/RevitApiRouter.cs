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
    // Write handlers may execute only after one-shot Native-pane approval
    // on an explicitly disposable fixture model. Production writes remain denied.
    public static class RevitApiRouter
    {
        public static string Execute(UIApplication app, string method, string path, string body,
            NativeModelBindingState binding = null,
            NativeWriteAuthority writeAuthority = null)
        {
            if (app == null) return Error(503, "No Revit UI API context.");
            try
            {
                if (path == "/health")
                    return Data(new { status = "ok", host = "unified-native-preview",
                        revit_available = true, version = "0.1.0-preview",
                        mutations_ready = false, write_fixture_approval_supported = true });
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
                if (BridgeHttpProtocol.IsWrite(path))
                {
                    if (writeAuthority == null)
                        return Error(503, "Native write authorization subsystem unavailable.");
                    string writeDenial = writeAuthority.DenialOrConsume(
                        path, payload, binding.Current, doc);
                    if (writeDenial != null)
                        return Error(writeDenial.StartsWith("WRITE_APPROVAL_PENDING:",
                            StringComparison.Ordinal) ? 428 : 403, writeDenial);
                }
                if (path == "/ui/selection") return Selection(app, doc);
                if (path == "/ui/selection/set") return SetSelection(app, doc, payload);
                if (path == "/ui/show") return ShowElements(app, doc, payload);
                if (path == "/ui/view/activate") return ActivateView(app, doc, payload);
                if (path == "/ui/visibility/temporary") return TemporaryVisibility(app, doc, payload);
                if (path == "/ui/select-related") return SelectRelated(app, doc, payload);
                if (path == "/view/properties") return GetViewProperties(doc, payload);
                if (path == "/view/filters") return NativeViewFilters.List(doc, payload);
                if (path == "/view/create") return NativeViewCreate.Execute(doc, payload);
                if (path == "/dynamo/load") return NativeDynamoLoad.Execute(app, payload);
                if (path == "/view/filter/write") return NativeViewFilters.Write(doc, payload);
                if (path == "/sheets") return NativeSheets.List(doc);
                if (path == "/sheet/viewports") return NativeSheets.Viewports(doc, payload);
                if (path == "/sheet/write") return NativeSheets.Write(doc, payload);
                if (path == "/view/format") return NativeViewFormatting.Execute(doc, payload);
                if (path == "/slab/create") return NativeSlabProfiles.Create(doc, payload);
                if (path == "/schedules") return NativeSchedules.List(doc);
                if (path == "/schedule/get") return NativeSchedules.GetSchedule(doc, payload);
                if (path == "/schedule/update") return NativeSchedules.Update(doc, payload);
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
                if (path == "/elements/query") return NativeElementQuery.Execute(doc, payload);
                if (path == "/elements/aggregate") return AggregateElements(doc, payload);
                if (path == "/element") return Element(doc, payload);
                if (path == "/element/parameters") return AllParameters(doc, payload);
                if (path == "/element/inspect") return InspectElement(doc, payload);
                if (path == "/categories") return Categories(doc, payload);
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
                if (path == "/annotation/batch-tag") return NativeBatchTags.Execute(doc, payload);
                if (path == "/annotation/get") return GetAnnotation(doc, payload);
                if (path == "/annotation/update") return NativeAnnotationEdit.Execute(doc, payload);
                if (path == "/mep/systems") return MepSystems(doc, payload);
                if (path == "/mep/trace") return TraceMep(doc, payload);
                if (path == "/mep/quantities") return MepQuantities(doc, payload);
                if (path == "/model/spatial-warnings") return SpatialWarnings(doc, payload);
                if (path == "/element/connectors") return Connectors(doc, payload);
                if (path == "/parameter/set") return SetParameter(doc, payload);
                if (path == "/parameter/batch") return NativeParameterBatch.Execute(doc, payload, false);
                if (path == "/parameter/copy") return NativeParameterBatch.Execute(doc, payload, true);
                if (path == "/move") return MoveElement(doc, payload);
                if (path == "/delete") return DeleteElements(doc, payload);
                if (path == "/transform") return NativeTransforms.Execute(doc, payload);
                if (path == "/architecture/create") return NativeArchitecture.Execute(doc, payload);
                if (path == "/place" || path == "/create/duct" || path == "/create/pipe" ||
                    path == "/annotation/text" || path == "/annotation/detail_line" ||
                    path == "/annotation/tag" || path == "/annotation/dimension" ||
                    path == "/annotation/spot_elevation")
                    return NativeWriteOperations.Execute(doc, path, payload);
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
            string mode = Token(payload, "mode") ?? "replace";
            if (mode != "replace" && mode != "add" && mode != "remove" && mode != "clear")
                return Error(400, "mode must be replace, add, remove or clear.");
            if (mode == "clear" && ids.Count != 0)
                return Error(400, "clear selection requires empty element_ids.");
            var selected = new HashSet<ElementId>(uidoc.Selection.GetElementIds());
            if (mode == "replace") selected = new HashSet<ElementId>(ids);
            if (mode == "add") selected.UnionWith(ids);
            if (mode == "remove") selected.ExceptWith(ids);
            if (mode == "clear") selected.Clear();
            if (selected.Count > 500)
                return Error(413, "Resulting selection exceeds 500 IDs.");
            uidoc.Selection.SetElementIds(selected.ToList());
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

        // Temporary visibility changes are Revit view UI state. They still
        // require a Revit Transaction and must never be marketed as READ.
        private static string SelectRelated(UIApplication app, Document doc, JObject payload)
        {
            var uidoc = app.ActiveUIDocument;
            if (uidoc == null || !Object.ReferenceEquals(uidoc.Document, doc))
                return Error(409, "Bound document must be active to select related elements.");
            long? rawId = LongNumber(payload, "element_id");
            if (!rawId.HasValue || rawId.Value <= 0)
                return Error(400, "element_id required.");
            Element source = doc.GetElement(new ElementId(rawId.Value));
            if (source == null) return Error(404, "Source element not found.");
            string relation = Token(payload, "relation");
            if (relation != "host" && relation != "hosted" && relation != "connected")
                return Error(400, "relation must be host, hosted or connected.");
            bool apply = payload.Value<bool?>("apply") ?? false;
            var targetIds = new HashSet<ElementId>();
            var sourceFamily = source as FamilyInstance;
            if (relation == "host" && sourceFamily?.Host != null)
                targetIds.Add(sourceFamily.Host.Id);
            if (relation == "hosted")
                foreach (FamilyInstance other in new FilteredElementCollector(doc)
                    .OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
                {
                    if (other.Host?.Id == source.Id)
                    {
                        if (targetIds.Count >= 500)
                            return Error(413, "More than 500 hosted elements.");
                        targetIds.Add(other.Id);
                    }
                }
            if (relation == "connected")
            {
                ConnectorManager manager = sourceFamily?.MEPModel?.ConnectorManager ??
                    (source as MEPCurve)?.ConnectorManager;
                if (manager == null)
                    return Error(400, "Element has no supported connector manager.");
                foreach (Connector connector in manager.Connectors)
                    foreach (Connector adjacent in connector.AllRefs)
                    {
                        Element owner = adjacent.Owner;
                        if (owner == null || owner.Id == source.Id) continue;
                        if (targetIds.Count >= 500)
                            return Error(413, "More than 500 adjacent elements.");
                        targetIds.Add(owner.Id);
                    }
            }
            if (apply) uidoc.Selection.SetElementIds(targetIds.ToList());
            return Data(new {
                source_element_id = rawId.Value.ToString(CultureInfo.InvariantCulture),
                relation, applied = apply,
                element_ids = targetIds.Select(id => id.Value.ToString(CultureInfo.InvariantCulture)).ToList(),
                complete = true
            });
        }

        private static string TemporaryVisibility(UIApplication app, Document doc, JObject payload)
        {
            var uidoc = app.ActiveUIDocument;
            if (uidoc == null || !Object.ReferenceEquals(uidoc.Document, doc))
                return Error(409, "Bound document must be active for temporary visibility.");
            var view = uidoc.ActiveView;
            string mode = Token(payload, "mode");
            if (mode != "hide" && mode != "isolate" && mode != "reset")
                return Error(400, "mode must be hide, isolate or reset.");
            var ids = UiElementIds(doc, view, payload);
            if (mode == "reset" && ids.Count != 0)
                return Error(400, "reset requires an empty element_ids list.");
            if (mode != "reset" && ids.Count == 0)
                return Error(400, "hide/isolate require element_ids.");
            using (var t = new Transaction(doc, "RevitGPT Temporary Visibility"))
            {
                t.Start();
                try
                {
                    if (mode == "hide") view.HideElementsTemporary(ids);
                    if (mode == "isolate") view.IsolateElementsTemporary(ids);
                    if (mode == "reset" &&
                        view.IsTemporaryHideIsolateActive())
                        view.DisableTemporaryViewMode(TemporaryViewMode.TemporaryHideIsolate);
                    t.Commit();
                }
                catch
                {
                    if (t.GetStatus() == TransactionStatus.Started) t.RollBack();
                    throw;
                }
            }
            return Data(new {
                mode,
                count = ids.Count,
                view_id = view.Id.Value.ToString(CultureInfo.InvariantCulture),
                temporary_hide_isolate_active = view.IsTemporaryHideIsolateActive()
            });
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

        private static string Categories(Document doc, JObject payload)
        {
            string filter = Token(payload, "name_contains");
            var result = new List<object>();
            foreach (Category category in doc.Settings.Categories)
            {
                if (filter != null && category.Name.IndexOf(filter,
                    StringComparison.OrdinalIgnoreCase) < 0) continue;
                if (result.Count >= 2048)
                    return Error(413, "More than 2048 categories; no truncated result.");
                result.Add(new {
                    id = category.Id.Value.ToString(CultureInfo.InvariantCulture),
                    name = category.Name,
                    category_type = category.CategoryType.ToString(),
                    allows_bound_parameters = category.AllowsBoundParameters
                });
            }
            return Data(result);
        }

        private static string InspectElement(Document doc, JObject payload)
        {
            long? rawId = LongNumber(payload, "element_id");
            if (!rawId.HasValue || rawId.Value <= 0)
                return Error(400, "element_id required.");
            string aspect = Token(payload, "aspect");
            if (aspect != "geometry" && aspect != "relationships" && aspect != "family")
                return Error(400, "aspect must be geometry, relationships or family.");
            Element e = doc.GetElement(new ElementId(rawId.Value));
            if (e == null) return Error(404, "Element not found.");
            if (aspect == "geometry")
            {
                BoundingBoxXYZ box = e.get_BoundingBox(null);
                return Data(new {
                    element_id = rawId.Value.ToString(CultureInfo.InvariantCulture),
                    category = e.Category?.Name ?? "",
                    bounding_box = box == null ? null : new {
                        min = new { x = box.Min.X, y = box.Min.Y, z = box.Min.Z },
                        max = new { x = box.Max.X, y = box.Max.Y, z = box.Max.Z },
                        transform_origin = new {
                            x = box.Transform.Origin.X,
                            y = box.Transform.Origin.Y,
                            z = box.Transform.Origin.Z
                        },
                        coordinate_unit = "revit_internal_feet",
                        coordinate_space = "bounding_box_local"
                    },
                    location = ElementInfo(e), complete = true
                });
            }
            if (aspect == "family")
            {
                var instance = e as FamilyInstance;
                if (instance == null) return Error(400, "Element is not a FamilyInstance.");
                var manager = instance.MEPModel?.ConnectorManager;
                return Data(new {
                    id = instance.Id.Value.ToString(CultureInfo.InvariantCulture),
                    family_name = instance.Symbol?.Family?.Name,
                    type_name = instance.Symbol?.Name,
                    type_id = instance.GetTypeId().Value.ToString(CultureInfo.InvariantCulture),
                    host_id = instance.Host?.Id.Value.ToString(CultureInfo.InvariantCulture),
                    super_component_id = instance.SuperComponent?.Id.Value.ToString(CultureInfo.InvariantCulture),
                    level_id = instance.LevelId == ElementId.InvalidElementId ? null :
                        instance.LevelId.Value.ToString(CultureInfo.InvariantCulture),
                    connector_count = manager == null ? (int?)null : manager.Connectors.Size,
                    has_mep_model = instance.MEPModel != null, complete = true
                });
            }
            var familyInstance = e as FamilyInstance;
            var link = e as RevitLinkInstance;
            var relation = new {
                element_id = rawId.Value.ToString(CultureInfo.InvariantCulture),
                type_id = e.GetTypeId() == ElementId.InvalidElementId ? null :
                    e.GetTypeId().Value.ToString(CultureInfo.InvariantCulture),
                level_id = e.LevelId == ElementId.InvalidElementId ? null :
                    e.LevelId.Value.ToString(CultureInfo.InvariantCulture),
                group_id = e.GroupId == ElementId.InvalidElementId ? null :
                    e.GroupId.Value.ToString(CultureInfo.InvariantCulture),
                host_id = familyInstance?.Host?.Id.Value.ToString(CultureInfo.InvariantCulture),
                super_component_id = familyInstance?.SuperComponent?.Id.Value.ToString(CultureInfo.InvariantCulture),
                linked_document_title = link?.GetLinkDocument()?.Title,
                is_link_instance = link != null
            };
            return Data(relation);
        }

        private static string AllParameters(Document doc, JObject payload)
        {
            long? rawId = LongNumber(payload, "element_id");
            if (!rawId.HasValue || rawId.Value <= 0) return Error(400, "element_id required.");
            Element element = doc.GetElement(new ElementId(rawId.Value));
            if (element == null) return Error(404, "Element not found.");
            bool includeType = payload.Value<bool?>("include_type") ?? true;
            var output = new List<object>();
            Element typeOwner = null;
            if (includeType)
            {
                ElementId typeId = element.GetTypeId();
                if (typeId != null && typeId != ElementId.InvalidElementId)
                    typeOwner = doc.GetElement(typeId);
            }
            var owners = new List<Tuple<Element, string>> {
                Tuple.Create(element, "instance") };
            if (typeOwner != null && typeOwner.Id != element.Id)
                owners.Add(Tuple.Create(typeOwner, "type"));
            foreach (var ownerScope in owners)
                foreach (Parameter parameter in ownerScope.Item1.Parameters)
                {
                    if (output.Count >= 256)
                        return Error(413, "More than 256 parameters; no truncated result.");
                    output.Add(new {
                        name = parameter.Definition?.Name ?? "",
                        scope = ownerScope.Item2,
                        metadata = ParameterInfo(parameter, ownerScope.Item2, ownerScope.Item1)
                    });
                }
            return Data(new {
                element_id = rawId.Value.ToString(CultureInfo.InvariantCulture),
                parameters = output, complete = true
            });
        }

        private static string Element(Document doc, JObject payload)
        {
            long? id = LongNumber(payload, "element_id");
            if (!id.HasValue) return Error(400, "element_id required.");
            Element item = doc.GetElement(new ElementId(id.Value));
            if (item == null) return Error(404, "Element does not exist.");
            var info = ElementInfo(item, RequestedParameters(payload));
            if (payload.Value<bool?>("include_connectors") != true)
                return Data(info);
            // Reuse the same bounded native connector collector as /element/connectors.
            // Preserve its 4xx/5xx error envelope; never report partial success.
            JObject connectorEnvelope = JObject.Parse(Connectors(doc, payload));
            if (connectorEnvelope["error"] != null)
                return connectorEnvelope.ToString(Formatting.None);
            return Data(new {
                element = info,
                connectors = connectorEnvelope["data"],
                complete = true
            });
        }

        // Actual system INSTANCE inventory, not MechanicalSystemType/PipingSystemType.
        private static string GetViewProperties(Document doc, JObject payload)
        {
            long? id = LongNumber(payload, "view_id");
            if (!id.HasValue) return Error(400, "view_id required.");
            View view = doc.GetElement(new ElementId(id.Value)) as View;
            if (view == null) return Error(404, "View not found.");
            var box = view.CropBox;
            return Data(new {
                id = view.Id.Value.ToString(CultureInfo.InvariantCulture),
                name = view.Name,
                view_type = view.ViewType.ToString(),
                is_template = view.IsTemplate,
                view_template_id = view.ViewTemplateId?.Value.ToString(CultureInfo.InvariantCulture),
                scale = view.Scale,
                detail_level = view.DetailLevel.ToString(),
                discipline = view.Discipline.ToString(),
                display_style = view.DisplayStyle.ToString(),
                crop_box_active = view.CropBoxActive,
                crop_box_visible = view.CropBoxVisible,
                crop_box = box == null ? null : new {
                    min = new { x = box.Min.X, y = box.Min.Y, z = box.Min.Z },
                    max = new { x = box.Max.X, y = box.Max.Y, z = box.Max.Z },
                    coordinate_unit = "revit_internal_feet"
                }
            });
        }

        // Bounded read-only MEP quantities with explicit measurement coverage.
        // Never silently equate instance count with measured duct/pipe length.
        private sealed class QuantityBucket
        {
            public string Category;
            public string Family;
            public string Type;
            public long Count;
            public long MeasuredCount;
            public double LengthFeet;
        }
        private static string SpatialWarnings(Document doc, JObject payload)
        {
            var elements = new List<object>();
            var categories = new HashSet<long> {
                (long)BuiltInCategory.OST_Rooms,
                (long)BuiltInCategory.OST_MEPSpaces,
                (long)BuiltInCategory.OST_Grids
            };
            foreach (Element element in new FilteredElementCollector(doc).WhereElementIsNotElementType())
            {
                if (element.Category == null || !categories.Contains(element.Category.Id.Value))
                    continue;
                if (elements.Count >= 1000)
                    return Error(413, "Spatial result exceeds 1000; no truncated success.");
                elements.Add(new {
                    id = element.Id.Value.ToString(CultureInfo.InvariantCulture),
                    name = element.Name,
                    category = element.Category.Name,
                    level_id = element.LevelId == ElementId.InvalidElementId
                        ? null : element.LevelId.Value.ToString(CultureInfo.InvariantCulture)
                });
            }
            var warnings = new List<object>();
            bool includeWarnings = payload.Value<bool?>("include_warnings") ?? true;
            if (includeWarnings)
                foreach (var warning in doc.GetWarnings())
                {
                    if (warnings.Count >= 1000)
                        return Error(413, "Warning result exceeds 1000; no truncated success.");
                    warnings.Add(new {
                        failure_id = warning.GetFailureDefinitionId().Guid.ToString("D"),
                        description = warning.GetDescriptionText(),
                        element_ids = warning.GetFailingElements().Take(30)
                            .Select(x => x.Value.ToString(CultureInfo.InvariantCulture)).ToList(),
                        failed_element_count = warning.GetFailingElements().Count
                    });
                }
            return Data(new { spatial = elements, warnings, complete = true });
        }

        private static string MepQuantities(Document doc, JObject payload)
        {
            string mode = Token(payload, "mode") ?? "all";
            if (mode != "all" && mode != "equipment")
                return Error(400, "mode must be all or equipment.");
            string categoryFilter = Token(payload, "category");
            var buckets = new SortedDictionary<string, QuantityBucket>(StringComparer.Ordinal);
            long scanned = 0;
            foreach (Element element in new FilteredElementCollector(doc).WhereElementIsNotElementType())
            {
                string category = element.Category?.Name ?? "";
                bool isEquipment = element.Category?.Id?.Value ==
                    (long)BuiltInCategory.OST_MechanicalEquipment;
                bool isDuct = element is Duct;
                bool isPipe = element is Pipe;
                bool isFitting = element.Category?.Id?.Value ==
                    (long)BuiltInCategory.OST_DuctFitting ||
                    element.Category?.Id?.Value == (long)BuiltInCategory.OST_PipeFitting;
                bool isTerminal = element.Category?.Id?.Value ==
                    (long)BuiltInCategory.OST_DuctTerminal;
                if (mode == "equipment" ? !isEquipment :
                    !(isEquipment || isDuct || isPipe || isFitting || isTerminal))
                    continue;
                if (categoryFilter != null && !EqualsIgnoreCase(category, categoryFilter)) continue;
                scanned++;
                string family = (element as FamilyInstance)?.Symbol?.Family?.Name ?? "";
                string typeName = (element as FamilyInstance)?.Symbol?.Name ??
                    doc.GetElement(element.GetTypeId())?.Name ?? element.Name ?? "";
                string key = category + "\u001f" + family + "\u001f" + typeName;
                if (!buckets.TryGetValue(key, out QuantityBucket bucket))
                {
                    if (buckets.Count >= 500)
                        return Error(413, "More than 500 distinct MEP groups; add category filter.");
                    bucket = new QuantityBucket {
                        Category = category, Family = family, Type = typeName };
                    buckets.Add(key, bucket);
                }
                bucket.Count++;
                if ((isDuct || isPipe) && element.Location is LocationCurve location)
                {
                    bucket.MeasuredCount++;
                    bucket.LengthFeet += location.Curve.Length;
                }
            }
            return Data(new {
                scope = mode, total_instances = scanned,
                length_unit = "revit_internal_feet",
                complete = true,
                groups = buckets.Values.Select(x => new {
                    category = x.Category, family = x.Family, type = x.Type,
                    count = x.Count, length_measured_count = x.MeasuredCount,
                    total_length_internal_feet = x.LengthFeet
                }).ToList()
            });
        }

        // WRITE-DEV: Native handler is implemented but not reachable from
        // external MCP until the operation-scoped, native-verified grant exists.
        // The unconditional write guard above remains in force meanwhile.
        // WRITE-DEV: transaction-backed movement. Activation must wait for
        // the same Native operation-specific authorization as other writes.
        // WRITE-DEV: deletion previews actual cascading dependencies by
        // rolling back a trial transaction. Commit requires the precise
        // affected-ID list acknowledged by the caller, and a separate Native grant.
        private static string DeleteElements(Document doc, JObject payload)
        {
            var list = payload["element_ids"] as JArray;
            if (list == null || list.Count == 0 || list.Count > 50)
                return Error(400, "element_ids must contain 1 to 50 IDs.");
            var requested = new List<ElementId>();
            var seen = new HashSet<long>();
            foreach (JToken item in list)
            {
                long id;
                if (item.Type != JTokenType.String ||
                    !Int64.TryParse(item.Value<string>(), NumberStyles.None,
                        CultureInfo.InvariantCulture, out id) || id <= 0 || !seen.Add(id))
                    return Error(400, "Invalid or duplicate deletion target.");
                Element element = doc.GetElement(new ElementId(id));
                if (element == null) return Error(404, "Deletion target missing: " + id);
                requested.Add(element.Id);
            }
            bool commitRequested = payload.Value<bool?>("confirm") == true;
            List<string> acknowledged = null;
            if (commitRequested)
            {
                var proof = payload["acknowledged_affected_ids"] as JArray;
                if (proof == null || proof.Count == 0 || proof.Count > 2000)
                    return Error(400, "Confirm requires exact acknowledged_affected_ids.");
                acknowledged = new List<string>();
                var seenAffected = new HashSet<string>(StringComparer.Ordinal);
                foreach (JToken item in proof)
                {
                    long parsed;
                    if (item.Type != JTokenType.String ||
                        !Int64.TryParse(item.Value<string>(), NumberStyles.None,
                            CultureInfo.InvariantCulture, out parsed) ||
                        parsed <= 0 || !seenAffected.Add(parsed.ToString(CultureInfo.InvariantCulture)))
                        return Error(400, "Invalid or duplicate acknowledged dependency ID.");
                    acknowledged.Add(parsed.ToString(CultureInfo.InvariantCulture));
                }
                acknowledged.Sort(StringComparer.Ordinal);
            }
            List<string> affected = null;
            using (var tx = new Transaction(doc, commitRequested ?
                "RevitGPT Confirmed Delete" : "RevitGPT Delete Dependency Preview"))
            {
                tx.Start();
                try
                {
                    var impacted = doc.Delete(requested);
                    if (impacted.Count > 2000)
                        throw new InvalidOperationException("Cascade exceeds 2,000 elements.");
                    affected = impacted.Select(id => id.Value.ToString(CultureInfo.InvariantCulture))
                        .OrderBy(id => id, StringComparer.Ordinal).ToList();
                    if (affected.Count == 0)
                        throw new InvalidOperationException("No elements deleted.");
                    if (commitRequested && !affected.SequenceEqual(acknowledged))
                    {
                        tx.RollBack();
                        return Error(409, "Dependent-element set differs from acknowledged preview; no deletion committed.");
                    }
                    if (commitRequested)
                    {
                        if (tx.Commit() != TransactionStatus.Committed)
                            return Error(500, "Delete transaction not committed.");
                    }
                    else tx.RollBack();
                }
                catch
                {
                    if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                    throw;
                }
            }
            return Data(new {
                requested_ids = requested.Select(id => id.Value.ToString(CultureInfo.InvariantCulture)).ToList(),
                affected_ids = affected,
                dependency_count = affected.Count - requested.Count,
                transaction = commitRequested ? "committed" : "rolled_back",
                requires_exact_acknowledgement = !commitRequested
            });
        }

        private static string MoveElement(Document doc, JObject payload)
        {
            long? rawId = LongNumber(payload, "element_id");
            if (!rawId.HasValue || rawId.Value <= 0) return Error(400, "element_id required.");
            Element element = doc.GetElement(new ElementId(rawId.Value));
            if (element == null) return Error(404, "Element not found.");
            if (element.Pinned) return Error(409, "Pinned elements cannot be moved.");
            if (element.Location == null) return Error(409, "Element has no editable location.");
            bool absolute = payload["x"] != null || payload["y"] != null || payload["z"] != null;
            double dx, dy, dz;
            if (absolute)
            {
                var point = element.Location as LocationPoint;
                if (point == null) return Error(400, "Absolute move requires LocationPoint; use offsets for curves.");
                if (payload["x"] == null || payload["y"] == null || payload["z"] == null)
                    return Error(400, "Absolute move requires all x/y/z coordinates.");
                double x = FiniteCoordinate(payload, "x");
                double y = FiniteCoordinate(payload, "y");
                double z = FiniteCoordinate(payload, "z");
                dx = x - point.Point.X;
                dy = y - point.Point.Y;
                dz = z - point.Point.Z;
            }
            else
            {
                dx = FiniteCoordinate(payload, "dx");
                dy = FiniteCoordinate(payload, "dy");
                dz = FiniteCoordinate(payload, "dz");
            }
            if (Math.Sqrt(dx * dx + dy * dy + dz * dz) > 100000.0)
                return Error(413, "Movement exceeds 100,000 internal feet.");
            using (var tx = new Transaction(doc, "RevitGPT Move Element"))
            {
                tx.Start();
                try
                {
                    ElementTransformUtils.MoveElement(doc, element.Id, new XYZ(dx, dy, dz));
                    if (tx.Commit() != TransactionStatus.Committed)
                        return Error(500, "Movement transaction did not commit.");
                }
                catch
                {
                    if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                    throw;
                }
            }
            return Data(new { transaction = "committed", element = ElementInfo(element),
                offset = new { dx, dy, dz, coordinate_unit = "revit_internal_feet" } });
        }

        private static double FiniteCoordinate(JObject payload, string key)
        {
            JToken token = payload[key];
            if (token == null) return 0;
            if (token.Type != JTokenType.Float && token.Type != JTokenType.Integer)
                throw new ArgumentException("Coordinates must be numeric.");
            double value;
            if (!Double.TryParse(token.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out value)
                || Double.IsNaN(value) || Double.IsInfinity(value))
                throw new ArgumentException("Coordinates must be finite.");
            return value;
        }

        private static string SetParameter(Document doc, JObject payload)
        {
            long? id = LongNumber(payload, "element_id");
            if (!id.HasValue || id.Value <= 0) return Error(400, "element_id required.");
            Element owner = doc.GetElement(new ElementId(id.Value));
            if (owner == null) return Error(404, "Target element not found.");
            string selector = Token(payload, "parameter");
            if (String.IsNullOrWhiteSpace(selector) || selector.Length > 128)
                return Error(400, "Exact parameter selector required.");
            IList<Parameter> matches = ResolveParameters(owner, selector);
            if (matches.Count != 1)
                return Error(409, matches.Count == 0 ? "Parameter not found on instance." :
                    "Ambiguous parameter display name: use guid: or bip:.");
            Parameter p = matches[0];
            if (p.IsReadOnly) return Error(409, "Parameter is read-only.");
            JToken value = payload["value"];
            if (value == null || value.Type == JTokenType.Null)
                return Error(400, "Explicit non-null value required.");
            // Type validation before opening the transaction. Doubles are in
            // Revit INTERNAL units; formatted values are never guessed.
            string text = null;
            int integer = 0;
            double number = 0;
            long refId = 0;
            if (p.StorageType == StorageType.String)
            {
                if (value.Type != JTokenType.String) return Error(400, "String parameter requires string value.");
                text = value.Value<string>();
                if (text.Length > 32768) return Error(413, "Parameter string exceeds limit.");
            }
            else if (p.StorageType == StorageType.Integer)
            {
                if (value.Type != JTokenType.Integer ||
                    !Int32.TryParse(value.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out integer))
                    return Error(400, "Integer parameter requires an exact integer.");
            }
            else if (p.StorageType == StorageType.Double)
            {
                if ((value.Type != JTokenType.Float && value.Type != JTokenType.Integer) ||
                    !Double.TryParse(value.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number) ||
                    Double.IsNaN(number) || Double.IsInfinity(number))
                    return Error(400, "Double parameter requires a finite numeric Revit-internal value.");
            }
            else if (p.StorageType == StorageType.ElementId)
            {
                if (value.Type != JTokenType.String ||
                    !Int64.TryParse(value.Value<string>(), NumberStyles.Integer, CultureInfo.InvariantCulture, out refId))
                    return Error(400, "ElementId parameter requires an exact string identifier.");
                if (refId > 0 && doc.GetElement(new ElementId(refId)) == null)
                    return Error(404, "Referenced element does not exist.");
            }
            else return Error(400, "Unsupported parameter storage type.");

            using (var tx = new Transaction(doc, "RevitGPT Set Parameter"))
            {
                tx.Start();
                try
                {
                    bool applied;
                    switch (p.StorageType)
                    {
                        case StorageType.String: applied = p.Set(text); break;
                        case StorageType.Integer: applied = p.Set(integer); break;
                        case StorageType.Double: applied = p.Set(number); break;
                        case StorageType.ElementId: applied = p.Set(new ElementId(refId)); break;
                        default: throw new InvalidOperationException("Unsupported storage type.");
                    }
                    if (!applied) throw new InvalidOperationException("Revit rejected parameter assignment.");
                    if (tx.Commit() != TransactionStatus.Committed)
                        return Error(500, "Transaction did not commit.");
                }
                catch
                {
                    if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                    throw;
                }
            }
            return Data(new {
                element_id = id.Value.ToString(CultureInfo.InvariantCulture),
                selector,
                parameter = ParameterInfo(p, "instance", owner),
                transaction = "committed"
            });
        }

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

        private static ConnectorManager ConnectorManagerFor(Element owner)
        {
            var family = owner as FamilyInstance;
            if (family != null) return family.MEPModel?.ConnectorManager;
            var curve = owner as MEPCurve;
            if (curve != null) return curve.ConnectorManager;
            return null;
        }
        private static string TraceMep(Document doc, JObject payload)
        {
            long? startId = LongNumber(payload, "element_id");
            if (!startId.HasValue || startId.Value <= 0)
                return Error(400, "Starting element_id required.");
            Element first = doc.GetElement(new ElementId(startId.Value));
            if (first == null) return Error(404, "Starting MEP element missing.");
            if (ConnectorManagerFor(first) == null)
                return Error(400, "Element has no MEP connector manager.");
            int maxNodes = payload.Value<int?>("max_nodes") ?? 100;
            int maxDepth = payload.Value<int?>("max_depth") ?? 6;
            if (maxNodes < 1 || maxNodes > 250 || maxDepth < 0 || maxDepth > 12)
                return Error(400, "max_nodes 1..250, max_depth 0..12 required.");
            var queue = new Queue<Tuple<ElementId, int>>();
            var visited = new HashSet<long>();
            var nodes = new List<object>();
            var edges = new HashSet<string>(StringComparer.Ordinal);
            bool truncated = false;
            queue.Enqueue(Tuple.Create(first.Id, 0));
            while (queue.Count != 0)
            {
                var current = queue.Dequeue();
                if (!visited.Add(current.Item1.Value)) continue;
                if (visited.Count > maxNodes)
                {
                    truncated = true;
                    break;
                }
                Element owner = doc.GetElement(current.Item1);
                if (owner == null) continue;
                nodes.Add(new {
                    id = owner.Id.Value.ToString(CultureInfo.InvariantCulture),
                    category = owner.Category?.Name ?? "",
                    name = owner.Name, depth = current.Item2
                });
                var manager = ConnectorManagerFor(owner);
                if (manager == null) continue;
                foreach (Connector connector in manager.Connectors)
                foreach (Connector reference in connector.AllRefs)
                {
                    Element other = reference.Owner;
                    if (other == null || other.Id == owner.Id || other.Document != doc)
                        continue;
                    long a = Math.Min(owner.Id.Value, other.Id.Value);
                    long b = Math.Max(owner.Id.Value, other.Id.Value);
                    edges.Add(a.ToString(CultureInfo.InvariantCulture) + ":" +
                        b.ToString(CultureInfo.InvariantCulture));
                    if (current.Item2 >= maxDepth)
                    {
                        truncated = true;
                        continue;
                    }
                    if (!visited.Contains(other.Id.Value))
                        queue.Enqueue(Tuple.Create(other.Id, current.Item2 + 1));
                    if (queue.Count > 5000)
                        return Error(413, "MEP connector graph expansion exceeded limit.");
                }
            }
            return Data(new {
                root_id = startId.Value.ToString(CultureInfo.InvariantCulture),
                nodes,
                edges = edges.OrderBy(x => x, StringComparer.Ordinal).ToList(),
                cycle_safe = true,
                complete = !truncated && queue.Count == 0,
                truncated
            });
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

        private static string GetAnnotation(Document doc, JObject payload)
        {
            long? id = LongNumber(payload, "element_id");
            if (!id.HasValue || id.Value <= 0) return Error(400, "element_id required.");
            var element = doc.GetElement(new ElementId(id.Value));
            if (element == null) return Error(404, "Annotation not found.");
            var note = element as TextNote;
            var tag = element as IndependentTag;
            var dimension = element as Dimension;
            if (note == null && tag == null && dimension == null)
                return Error(422, "Unsupported annotation type.");
            return Data(new {
                element_id = element.Id.Value.ToString(CultureInfo.InvariantCulture),
                kind = note != null ? "text" : tag != null ? "tag" : "dimension",
                view_id = element.OwnerViewId.Value.ToString(CultureInfo.InvariantCulture),
                type_id = element.GetTypeId().Value.ToString(CultureInfo.InvariantCulture),
                text = note?.Text, has_leader = tag == null ? (bool?)null : tag.HasLeader,
                tag_head = tag == null ? null : new {
                    x = tag.TagHeadPosition.X, y = tag.TagHeadPosition.Y,
                    z = tag.TagHeadPosition.Z, unit = "revit_internal_feet"
                },
                dimension_value_internal_feet = dimension == null ? (double?)null : dimension.Value,
                pinned = element.Pinned, complete = true
            });
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
