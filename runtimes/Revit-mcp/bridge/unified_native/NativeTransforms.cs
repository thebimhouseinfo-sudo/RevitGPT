using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Bounded transform: copy, rotate, and type change are distinct actions,
    // all handled in one exact all-or-nothing transaction.
    internal static class NativeTransforms
    {
        private static string Data(object value) => JsonConvert.SerializeObject(new { data = value });
        private static string Error(int status, string message) =>
            JsonConvert.SerializeObject(new { error = new { code = status, message } });
        private static string Get(JObject data, string key) => data[key]?.ToString();
        private static double Number(JObject data, string key, double missing = 0)
        {
            if (data[key] == null) return missing;
            JToken t = data[key]; double v;
            if ((t.Type != JTokenType.Float && t.Type != JTokenType.Integer) ||
                !Double.TryParse(t.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out v)
                || Double.IsNaN(v) || Double.IsInfinity(v) || Math.Abs(v) > 1000000)
                throw new ArgumentException("Invalid transform coordinate: " + key);
            return v;
        }
        private static XYZ Point(JObject p, string prefix) => new XYZ(
            Number(p, prefix + "x"), Number(p, prefix + "y"), Number(p, prefix + "z"));
        private static IList<ElementId> Elements(Document doc, JObject p)
        {
            var list = p["element_ids"] as JArray;
            if (list == null || list.Count < 1 || list.Count > 50)
                throw new ArgumentException("Transform requires 1..50 IDs.");
            var seen = new HashSet<long>();
            var ids = new List<ElementId>();
            foreach (var item in list)
            {
                long raw;
                if (item.Type != JTokenType.String ||
                    !Int64.TryParse(item.Value<string>(), NumberStyles.None,
                        CultureInfo.InvariantCulture, out raw) || raw <= 0 || !seen.Add(raw))
                    throw new ArgumentException("Invalid or duplicate transform target.");
                Element element = doc.GetElement(new ElementId(raw));
                if (element == null) throw new ArgumentException("Transform target not found.");
                if (element.Pinned) throw new InvalidOperationException("Pinned transform target.");
                ids.Add(element.Id);
            }
            return ids;
        }
        public static string Execute(Document doc, JObject p)
        {
            try
            {
                string action = Get(p, "action");
                if (action != "copy" && action != "rotate" && action != "change_type")
                    return Error(400, "action must be copy, rotate or change_type.");
                IList<ElementId> ids = Elements(doc, p);
                XYZ translation = null;
                Line axis = null;
                double angle = 0;
                ElementId nextTypeId = null;
                if (action == "copy")
                {
                    translation = Point(p, "d");
                    if (translation.GetLength() < 0.000001)
                        return Error(400, "Copy translation cannot be zero.");
                }
                if (action == "rotate")
                {
                    var start = Point(p, "axis_start_");
                    var end = Point(p, "axis_end_");
                    angle = Number(p, "angle");
                    if (start.DistanceTo(end) < 0.00001 || Math.Abs(angle) < 0.00000001)
                        return Error(400, "Rotation axis/angle invalid.");
                    axis = Line.CreateBound(start, end);
                }
                if (action == "change_type")
                {
                    long rawType;
                    if (!Int64.TryParse(Get(p, "new_type_id"), NumberStyles.None,
                        CultureInfo.InvariantCulture, out rawType) || rawType <= 0)
                        return Error(400, "new_type_id required.");
                    nextTypeId = new ElementId(rawType);
                    if (!(doc.GetElement(nextTypeId) is ElementType))
                        return Error(404, "Target ElementType missing.");
                    foreach (ElementId id in ids)
                        if (!doc.GetElement(id).GetValidTypes().Contains(nextTypeId))
                            return Error(409, "A target rejects the requested ElementType.");
                }
                var resultIds = new List<string>();
                using (var tx = new Transaction(doc, "RevitGPT Transform " + action))
                {
                    tx.Start();
                    try
                    {
                        if (action == "copy")
                            resultIds.AddRange(ElementTransformUtils.CopyElements(doc, ids, translation)
                                .Select(x => x.Value.ToString(CultureInfo.InvariantCulture)));
                        if (action == "rotate")
                        {
                            ElementTransformUtils.RotateElements(doc, ids, axis, angle);
                            resultIds.AddRange(ids.Select(x => x.Value.ToString(CultureInfo.InvariantCulture)));
                        }
                        if (action == "change_type")
                        {
                            foreach (ElementId id in ids)
                            {
                                Element element = doc.GetElement(id);
                                ElementId replacement = element.ChangeTypeId(nextTypeId);
                                resultIds.Add((replacement == ElementId.InvalidElementId
                                    ? id : replacement).Value.ToString(CultureInfo.InvariantCulture));
                            }
                        }
                        if (tx.Commit() != TransactionStatus.Committed)
                            return Error(500, "Transform transaction not committed.");
                    }
                    catch
                    {
                        if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                        throw;
                    }
                }
                return Data(new { transaction = "committed", action,
                    input_count = ids.Count, resulting_ids = resultIds, complete = true });
            }
            catch (ArgumentException ex) { return Error(400, ex.Message); }
            catch (InvalidOperationException ex) { return Error(409, ex.Message); }
            catch (Exception ex) { return Error(500, "Transform failed: " + ex.GetType().Name); }
        }
    }
}
