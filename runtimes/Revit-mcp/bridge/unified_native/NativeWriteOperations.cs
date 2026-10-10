using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.DB.Structure;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Native write handlers are reached only after one-shot pane approval and
    // disposable-fixture validation in RevitApiRouter. Source is not host proof.
    internal static class NativeWriteOperations
    {
        private static string Data(object obj) => JsonConvert.SerializeObject(new { data = obj });
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });
        private static string Token(JObject payload, string key) =>
            payload[key] == null || payload[key].Type == JTokenType.Null
            ? null : payload[key].ToString();
        private static double Number(JObject payload, string key, double? fallback = null)
        {
            JToken tok = payload[key];
            if (tok == null)
            {
                if (fallback.HasValue) return fallback.Value;
                throw new ArgumentException("Missing numeric property: " + key);
            }
            double result;
            if ((tok.Type != JTokenType.Float && tok.Type != JTokenType.Integer) ||
                !Double.TryParse(tok.ToString(), NumberStyles.Float,
                    CultureInfo.InvariantCulture, out result) ||
                Double.IsNaN(result) || Double.IsInfinity(result))
                throw new ArgumentException("Invalid finite numeric property: " + key);
            if (Math.Abs(result) > 10000000)
                throw new ArgumentException("Coordinate/dimension exceeds bounded range.");
            return result;
        }
        private static XYZ Point(JObject p, string prefix)
        {
            return new XYZ(Number(p, prefix + "x"), Number(p, prefix + "y"),
                Number(p, prefix + "z", 0));
        }
        private static string ElementIdString(Element element) =>
            element.Id.Value.ToString(CultureInfo.InvariantCulture);
        private static T FindType<T>(Document doc, string requested) where T : Element
        {
            var choices = new FilteredElementCollector(doc).OfClass(typeof(T)).Cast<T>();
            var matches = String.IsNullOrWhiteSpace(requested)
                ? choices.Take(2).ToList()
                : choices.Where(x => String.Equals(x.Name, requested,
                    StringComparison.OrdinalIgnoreCase)).Take(2).ToList();
            if (matches.Count > 1)
                throw new ArgumentException("Type selection is ambiguous; provide an exact unique type name.");
            return matches.SingleOrDefault();
        }
        private static Level ResolveLevel(Document doc, JObject payload)
        {
            string levelId = Token(payload, "level_id");
            if (levelId != null)
            {
                long id;
                if (!Int64.TryParse(levelId, out id) || id <= 0)
                    throw new ArgumentException("Invalid level_id.");
                var byId = doc.GetElement(new ElementId(id)) as Level;
                if (byId == null) throw new ArgumentException("Level not found.");
                return byId;
            }
            var levels = new FilteredElementCollector(doc).OfClass(typeof(Level))
                .Cast<Level>().Take(2).ToList();
            if (levels.Count != 1)
                throw new ArgumentException("level_id required unless the model has exactly one level.");
            return levels[0];
        }
        private static string WithTransaction(Document doc, string name, Func<object> work)
        {
            using (var tx = new Transaction(doc, name))
            {
                tx.Start();
                try
                {
                    object result = work();
                    if (tx.Commit() != TransactionStatus.Committed)
                        return Error(500, "Native write did not commit.");
                    return Data(new { transaction = "committed", element = result });
                }
                catch
                {
                    if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                    throw;
                }
            }
        }
        public static string Execute(Document doc, string path, JObject p)
        {
            try
            {
                if (path == "/place") return Place(doc, p);
                if (path == "/create/duct") return DuctRun(doc, p);
                if (path == "/create/pipe") return PipeRun(doc, p);
                if (path == "/annotation/text") return Text(doc, p);
                if (path == "/annotation/detail_line") return DetailLine(doc, p);
                if (path == "/annotation/tag") return Tag(doc, p);
                if (path == "/annotation/dimension") return Dimension(doc, p);
                if (path == "/annotation/spot_elevation") return SpotElevation(doc, p);
                return Error(501, "Write handler is not implemented for: " + path);
            }
            catch (ArgumentException ex) { return Error(400, ex.Message); }
            catch (InvalidOperationException ex) { return Error(409, ex.Message); }
            catch (Exception ex) { return Error(500, "Native write failed: " + ex.GetType().Name); }
        }
        private static string Place(Document doc, JObject p)
        {
            string family = Token(p, "family"), type = Token(p, "type");
            if (String.IsNullOrWhiteSpace(family) || String.IsNullOrWhiteSpace(type))
                return Error(400, "Family and type are required.");
            FamilySymbol symbol = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
                .FirstOrDefault(x => String.Equals(x.Family?.Name, family, StringComparison.OrdinalIgnoreCase)
                    && String.Equals(x.Name, type, StringComparison.OrdinalIgnoreCase));
            if (symbol == null) return Error(404, "Family symbol not found.");
            if (symbol.Family.FamilyPlacementType != FamilyPlacementType.OneLevelBased)
                return Error(422, "Only OneLevelBased nonhosted families are supported.");
            Level level = ResolveLevel(doc, p);
            XYZ at = Point(p, "");
            double rotation = Number(p, "rotation", 0);
            return WithTransaction(doc, "RevitGPT Place Family", () => {
                if (!symbol.IsActive) symbol.Activate();
                FamilyInstance instance = doc.Create.NewFamilyInstance(at, symbol, level,
                    StructuralType.NonStructural);
                if (Math.Abs(rotation) > 0.0000001)
                    ElementTransformUtils.RotateElement(doc, instance.Id,
                        Line.CreateBound(at, at + XYZ.BasisZ), rotation);
                return new { id = ElementIdString(instance), family, type, level_id =
                    ElementIdString(level), position_unit = "revit_internal_feet" };
            });
        }
        private static string DuctRun(Document doc, JObject p)
        {
            XYZ start = Point(p, "start_"), end = Point(p, "end_");
            if (start.DistanceTo(end) < 0.0001)
                return Error(400, "Duct endpoints must differ.");
            double width = Number(p, "width", 0.3), height = Number(p, "height", 0.15);
            if (width <= 0 || height <= 0 || width > 1000 || height > 1000)
                return Error(400, "Duct dimensions invalid (internal feet).");
            var ductType = FindType<DuctType>(doc, Token(p, "duct_type"));
            var systemType = FindType<MechanicalSystemType>(doc, Token(p, "system_type"));
            if (ductType == null || systemType == null)
                return Error(404, "Duct type or duct system type missing.");
            Level level = ResolveLevel(doc, p);
            return WithTransaction(doc, "RevitGPT Create Duct", () => {
                Duct duct = Duct.Create(doc, systemType.Id, ductType.Id, level.Id, start, end);
                Parameter w = duct.get_Parameter(BuiltInParameter.RBS_CURVE_WIDTH_PARAM);
                Parameter h = duct.get_Parameter(BuiltInParameter.RBS_CURVE_HEIGHT_PARAM);
                if (w == null || h == null || w.IsReadOnly || h.IsReadOnly ||
                    !w.Set(width) || !h.Set(height))
                    throw new InvalidOperationException("Duct type is not an editable rectangular duct.");
                return new { id = ElementIdString(duct),
                    width, height, unit = "revit_internal_feet" };
            });
        }
        private static string PipeRun(Document doc, JObject p)
        {
            XYZ start = Point(p, "start_"), end = Point(p, "end_");
            if (start.DistanceTo(end) < 0.0001)
                return Error(400, "Pipe endpoints must differ.");
            double diameter = Number(p, "diameter", 0.05);
            if (diameter <= 0 || diameter > 1000)
                return Error(400, "Pipe diameter invalid (internal feet).");
            var pipeType = FindType<PipeType>(doc, Token(p, "pipe_type"));
            var systemType = FindType<PipingSystemType>(doc, Token(p, "system_type"));
            if (pipeType == null || systemType == null)
                return Error(404, "Pipe type or pipe system type missing.");
            Level level = ResolveLevel(doc, p);
            return WithTransaction(doc, "RevitGPT Create Pipe", () => {
                Pipe pipe = Pipe.Create(doc, systemType.Id, pipeType.Id, level.Id, start, end);
                Parameter d = pipe.get_Parameter(BuiltInParameter.RBS_PIPE_DIAMETER_PARAM);
                if (d == null || d.IsReadOnly || !d.Set(diameter))
                    throw new InvalidOperationException("Pipe diameter cannot be set.");
                return new { id = ElementIdString(pipe),
                    diameter, unit = "revit_internal_feet" };
            });
        }
        private static View ResolveDetailView(Document doc, JObject p)
        {
            long id;
            if (!Int64.TryParse(Token(p, "view_id"), out id) || id <= 0)
                throw new ArgumentException("Valid view_id required.");
            View view = doc.GetElement(new ElementId(id)) as View;
            if (view == null || view.IsTemplate || view is View3D ||
                view.ViewType == ViewType.Schedule)
                throw new ArgumentException("Unsupported target annotation view.");
            return view;
        }
        private static string Text(Document doc, JObject p)
        {
            View view = ResolveDetailView(doc, p);
            string text = Token(p, "text");
            if (String.IsNullOrWhiteSpace(text) || text.Length > 32768)
                return Error(400, "Text must contain 1..32768 characters.");
            TextNoteType type = FindType<TextNoteType>(doc, Token(p, "text_type"));
            if (type == null) return Error(404, "TextNoteType not found.");
            XYZ at = Point(p, "");
            return WithTransaction(doc, "RevitGPT Text Note", () => {
                TextNote note = TextNote.Create(doc, view.Id, at, text, type.Id);
                return new { id = ElementIdString(note), view_id = ElementIdString(view) };
            });
        }
        private static Reference StableReference(Document doc, string stable)
        {
            if (String.IsNullOrWhiteSpace(stable) || stable.Length > 4096)
                throw new ArgumentException("Exact stable geometry reference is required.");
            Reference reference;
            try { reference = Reference.ParseFromStableRepresentation(doc, stable); }
            catch { throw new ArgumentException("Invalid Revit stable geometry reference."); }
            if (reference == null || doc.GetElement(reference.ElementId) == null)
                throw new ArgumentException("Geometry reference target is not present.");
            return reference;
        }
        private static string Tag(Document doc, JObject p)
        {
            View view = ResolveDetailView(doc, p);
            string elementId = Token(p, "element_id");
            long id;
            if (!Int64.TryParse(elementId, out id) || id <= 0)
                return Error(400, "element_id required.");
            Element target = doc.GetElement(new ElementId(id));
            if (target == null) return Error(404, "Tag target not found.");
            XYZ point = Point(p, "");
            bool leader = p.Value<bool?>("has_leader") == true;
            return WithTransaction(doc, "RevitGPT Tag Element", () => {
                IndependentTag tag = IndependentTag.Create(doc, view.Id, new Reference(target),
                    leader, TagMode.TM_ADDBY_CATEGORY, TagOrientation.Horizontal, point);
                if (tag == null) throw new InvalidOperationException("Tag creation failed.");
                string requestedType = Token(p, "tag_type");
                if (!String.IsNullOrWhiteSpace(requestedType))
                {
                    var candidates = tag.GetValidTypes()
                        .Select(x => doc.GetElement(x))
                        .Where(x => String.Equals(x.Name, requestedType, StringComparison.OrdinalIgnoreCase))
                        .ToList();
                    if (candidates.Count != 1)
                        throw new ArgumentException("Tag type missing or ambiguous.");
                    tag.ChangeTypeId(candidates[0].Id);
                }
                return new { id = ElementIdString(tag), tagged_id = ElementIdString(target),
                    view_id = ElementIdString(view) };
            });
        }
        private static string Dimension(Document doc, JObject p)
        {
            View view = ResolveDetailView(doc, p);
            var values = p["references"] as JArray;
            if (values == null || values.Count < 2 || values.Count > 16)
                return Error(400, "Dimension requires 2..16 stable references.");
            var references = new ReferenceArray();
            foreach (JToken entry in values)
            {
                var obj = entry as JObject;
                if (obj == null) return Error(400, "Each dimension reference must be an object.");
                references.Append(StableReference(doc, Token(obj, "stable_reference")));
            }
            XYZ start = Point(p, "line_start_");
            XYZ end = Point(p, "line_end_");
            if (start.DistanceTo(end) < 0.0001)
                return Error(400, "Dimension line is too short.");
            return WithTransaction(doc, "RevitGPT Dimension", () => {
                Dimension dimension = doc.Create.NewDimension(view,
                    Line.CreateBound(start, end), references);
                if (dimension == null)
                    throw new InvalidOperationException("Dimension creation failed.");
                string name = Token(p, "dimension_type");
                if (!String.IsNullOrWhiteSpace(name))
                {
                    var matches = dimension.GetValidTypes().Select(x => doc.GetElement(x))
                        .Where(x => String.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase))
                        .ToList();
                    if (matches.Count != 1)
                        throw new ArgumentException("Dimension type missing or ambiguous.");
                    dimension.ChangeTypeId(matches[0].Id);
                }
                return new { id = ElementIdString(dimension),
                    reference_count = values.Count, view_id = ElementIdString(view) };
            });
        }
        private static string SpotElevation(Document doc, JObject p)
        {
            View view = ResolveDetailView(doc, p);
            // A generic Element reference is insufficient for a reliable spot.
            // Require an exact stable geometry reference obtained from Revit.
            Reference reference = StableReference(doc, Token(p, "stable_reference"));
            XYZ origin = Point(p, "point_");
            XYZ bend = Point(p, "bend_");
            XYZ end = Point(p, "end_");
            return WithTransaction(doc, "RevitGPT Spot Elevation", () => {
                SpotDimension spot = doc.Create.NewSpotElevation(view, reference,
                    origin, bend, end, origin, true);
                if (spot == null)
                    throw new InvalidOperationException("SpotElevation creation failed.");
                string requestedType = Token(p, "spot_type");
                if (!String.IsNullOrWhiteSpace(requestedType))
                {
                    var types = spot.GetValidTypes().Select(x => doc.GetElement(x))
                        .Where(x => String.Equals(x.Name, requestedType, StringComparison.OrdinalIgnoreCase))
                        .ToList();
                    if (types.Count != 1)
                        throw new ArgumentException("Spot elevation type missing or ambiguous.");
                    spot.ChangeTypeId(types[0].Id);
                }
                return new { id = ElementIdString(spot), view_id = ElementIdString(view) };
            });
        }
        private static string DetailLine(Document doc, JObject p)
        {
            View view = ResolveDetailView(doc, p);
            XYZ start = Point(p, "start_"), end = Point(p, "end_");
            if (start.DistanceTo(end) < 0.0001)
                return Error(400, "Detail line is too short.");
            // A model XYZ line must lie in the view sketch plane; Revit validates.
            return WithTransaction(doc, "RevitGPT Detail Line", () => {
                DetailCurve detail = doc.Create.NewDetailCurve(view, Line.CreateBound(start, end))
                    as DetailCurve;
                if (detail == null) throw new InvalidOperationException("DetailCurve creation failed.");
                string style = Token(p, "line_style");
                if (!String.IsNullOrWhiteSpace(style))
                {
                    var styles = new FilteredElementCollector(doc).OfClass(typeof(GraphicsStyle))
                        .Cast<GraphicsStyle>().Where(x => x.GraphicsStyleType ==
                            GraphicsStyleType.Projection && x.Name == style).ToList();
                    if (styles.Count != 1)
                        throw new ArgumentException("Line style not found or ambiguous.");
                    detail.LineStyle = styles[0];
                }
                return new { id = ElementIdString(detail), view_id = ElementIdString(view) };
            });
        }
    }
}
