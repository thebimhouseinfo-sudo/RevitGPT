using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Bounded simple closed horizontal profiles; Revit validates curve loops.
    internal static class NativeSlabProfiles
    {
        private static string Data(object x) => JsonConvert.SerializeObject(new { data = x });
        private static string Error(int code, string msg) =>
            JsonConvert.SerializeObject(new { error = new { code, message = msg } });
        private static ElementId RequireId(Document doc, string source)
        {
            long n;
            if (!Int64.TryParse(source, NumberStyles.None, CultureInfo.InvariantCulture, out n)
                || n <= 0 || doc.GetElement(new ElementId(n)) == null)
                throw new ArgumentException("Required ID missing or invalid.");
            return new ElementId(n);
        }
        private static double Numeric(JToken t)
        {
            double d;
            if (t == null || (t.Type != JTokenType.Float && t.Type != JTokenType.Integer) ||
                !Double.TryParse(t.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out d)
                || double.IsNaN(d) || double.IsInfinity(d) || Math.Abs(d) > 100000)
                throw new ArgumentException("Invalid finite profile coordinate.");
            return d;
        }
        private static CurveLoop Loop(JArray points)
        {
            if (points == null || points.Count < 3 || points.Count > 24)
                throw new ArgumentException("Simple polygon requires 3..24 vertices.");
            var xyz = new List<XYZ>();
            foreach (var token in points)
            {
                var point = token as JObject;
                if (point == null) throw new ArgumentException("Each vertex must be an object.");
                xyz.Add(new XYZ(Numeric(point["x"]), Numeric(point["y"]), Numeric(point["z"])));
            }
            if (xyz.Any(p => Math.Abs(p.Z - xyz[0].Z) > 0.00001))
                throw new ArgumentException("Simple floor/ceiling profile must be horizontal.");
            var loop = new CurveLoop();
            for (int i = 0; i < xyz.Count; i++)
            {
                XYZ a = xyz[i], b = xyz[(i + 1) % xyz.Count];
                if (a.DistanceTo(b) < 0.0001)
                    throw new ArgumentException("Degenerate edge in profile.");
                loop.Append(Line.CreateBound(a, b));
            }
            if (Math.Abs(loop.GetExactLength()) < 0.001)
                throw new ArgumentException("Degenerate polygon.");
            return loop;
        }
        public static string Create(Document doc, JObject payload)
        {
            try
            {
                string kind = payload.Value<string>("kind");
                if (kind != "floor" && kind != "ceiling")
                    return Error(400, "kind must be floor or ceiling.");
                Level level = doc.GetElement(RequireId(doc,
                    payload.Value<string>("level_id"))) as Level;
                if (level == null) return Error(400, "Valid level required.");
                ElementId typeId = RequireId(doc, payload.Value<string>("type_id"));
                if (kind == "floor" && !(doc.GetElement(typeId) is FloorType))
                    return Error(400, "FloorType required.");
                if (kind == "ceiling" && !(doc.GetElement(typeId) is CeilingType))
                    return Error(400, "CeilingType required.");
                var points = payload["vertices"] as JArray;
                CurveLoop polygon = Loop(points);
                var loops = new List<CurveLoop> { polygon };
                if (!BoundaryValidation.IsValidHorizontalBoundary(loops))
                    return Error(400, "Revit rejected the closed horizontal profile.");
                using (var tx = new Transaction(doc, "RevitGPT Create " + kind))
                {
                    tx.Start();
                    try
                    {
                        Element created = kind == "floor"
                            ? (Element)Floor.Create(doc, loops, typeId, level.Id)
                            : (Element)Ceiling.Create(doc, loops, typeId, level.Id);
                        if (created == null) throw new InvalidOperationException("Creation returned null.");
                        string id = created.Id.Value.ToString(CultureInfo.InvariantCulture);
                        if (tx.Commit() != TransactionStatus.Committed)
                            return Error(500, "Creation transaction did not commit.");
                        return Data(new { transaction = "committed", kind, id,
                            profile_vertices = points.Count });
                    }
                    catch
                    {
                        if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                        throw;
                    }
                }
            }
            catch (ArgumentException ex) { return Error(400, ex.Message); }
            catch (InvalidOperationException ex) { return Error(409, ex.Message); }
            catch (Exception ex) { return Error(500, "Profile authoring: " + ex.GetType().Name); }
        }
    }
}
