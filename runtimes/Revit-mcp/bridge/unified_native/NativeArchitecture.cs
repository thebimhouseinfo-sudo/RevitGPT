using System;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Only simple Revit 2024 architectural primitives. No arbitrary API execution.
    // Invoked exclusively through NativeWriteAuthority on disposable fixtures.
    internal static class NativeArchitecture
    {
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });
        private static string Data(object result) =>
            JsonConvert.SerializeObject(new { data = result });
        private static string String(JObject obj, string key) => obj[key]?.ToString();
        private static double Number(JObject obj, string key)
        {
            var t = obj[key];
            double v;
            if (t == null || (t.Type != JTokenType.Integer && t.Type != JTokenType.Float) ||
                !double.TryParse(t.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out v) ||
                double.IsInfinity(v) || double.IsNaN(v) || Math.Abs(v) > 1000000)
                throw new ArgumentException("Invalid finite number: " + key);
            return v;
        }
        private static ElementId ExactId(Document doc, JObject obj, string key)
        {
            long value;
            if (!long.TryParse(String(obj, key), NumberStyles.None, CultureInfo.InvariantCulture, out value)
                || value <= 0 || doc.GetElement(new ElementId(value)) == null)
                throw new ArgumentException("Invalid existing ID: " + key);
            return new ElementId(value);
        }
        private static XYZ Point(JObject obj, string prefix) =>
            new XYZ(Number(obj, prefix + "x"), Number(obj, prefix + "y"),
                    Number(obj, prefix + "z"));
        private static Line Segment(JObject obj)
        {
            var start = Point(obj, "start_");
            var end = Point(obj, "end_");
            if (start.DistanceTo(end) < 0.0001)
                throw new ArgumentException("Line endpoints are too close.");
            return Line.CreateBound(start, end);
        }
        public static string Execute(Document doc, JObject obj)
        {
            string action = String(obj, "action");
            if (action != "wall" && action != "level" && action != "grid" && action != "model_line")
                return Error(400, "action must be wall, level, grid, model_line.");
            try
            {
                if (action == "wall")
                {
                    var level = doc.GetElement(ExactId(doc, obj, "level_id")) as Level;
                    var type = doc.GetElement(ExactId(doc, obj, "type_id")) as WallType;
                    if (level == null || type == null)
                        return Error(400, "Wall requires matching Level and WallType IDs.");
                    double height = Number(obj, "height");
                    if (height <= 0 || height > 10000)
                        return Error(400, "Wall height outside valid range.");
                    Line line = Segment(obj);
                    return Transact(doc, "RevitGPT Create Wall", () =>
                    {
                        Wall wall = Wall.Create(doc, line, type.Id, level.Id,
                            height, 0, false, false);
                        return wall.Id;
                    });
                }
                if (action == "level")
                {
                    double elevation = Number(obj, "elevation");
                    string name = String(obj, "name");
                    if (string.IsNullOrWhiteSpace(name) || name.Length > 128)
                        return Error(400, "Level name is required.");
                    if (new FilteredElementCollector(doc).OfClass(typeof(Level))
                        .Cast<Level>().Any(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)))
                        return Error(409, "Level with this name exists.");
                    return Transact(doc, "RevitGPT Create Level", () =>
                    {
                        Level level = Level.Create(doc, elevation);
                        level.Name = name;
                        return level.Id;
                    });
                }
                if (action == "grid")
                {
                    Line line = Segment(obj);
                    if (Math.Abs(line.Direction.Z) > 0.000001)
                        return Error(400, "Grid must be horizontal in model XY plane.");
                    return Transact(doc, "RevitGPT Create Grid", () => Grid.Create(doc, line).Id);
                }
                Line curve = Segment(obj);
                var normal = Point(obj, "normal_");
                if (normal.GetLength() < 0.001 ||
                    Math.Abs(curve.Direction.DotProduct(normal.Normalize())) > 0.00001)
                    return Error(400, "Normal must be nonzero and perpendicular to line.");
                return Transact(doc, "RevitGPT Model Line", () =>
                {
                    SketchPlane plane = SketchPlane.Create(doc,
                        Plane.CreateByNormalAndOrigin(normal.Normalize(), curve.GetEndPoint(0)));
                    return doc.Create.NewModelCurve(curve, plane).Id;
                });
            }
            catch (ArgumentException ex) { return Error(400, ex.Message); }
            catch (InvalidOperationException ex) { return Error(409, ex.Message); }
            catch (Exception ex) { return Error(500, "Architecture write failed: " + ex.GetType().Name); }
        }
        private static string Transact(Document doc, string label, Func<ElementId> work)
        {
            using (var transaction = new Transaction(doc, label))
            {
                transaction.Start();
                try
                {
                    ElementId created = work();
                    if (transaction.Commit() != TransactionStatus.Committed)
                        return Error(500, "Architecture transaction did not commit.");
                    return Data(new { transaction = "committed",
                        id = created.Value.ToString(CultureInfo.InvariantCulture) });
                }
                catch
                {
                    if (transaction.GetStatus() == TransactionStatus.Started) transaction.RollBack();
                    throw;
                }
            }
        }
    }
}
