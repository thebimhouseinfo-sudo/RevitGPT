using System;
using System.Globalization;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // In-place text/tag edits only. Unsupported annotation types fail closed.
    internal static class NativeAnnotationEdit
    {
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });
        private static string Data(object data) => JsonConvert.SerializeObject(new { data });
        private static string Id(Element e) => e.Id.Value.ToString(CultureInfo.InvariantCulture);
        public static string Execute(Document doc, JObject p)
        {
            string idText = p.Value<string>("element_id");
            long raw;
            if (!long.TryParse(idText, NumberStyles.None, CultureInfo.InvariantCulture, out raw) || raw <= 0)
                return Error(400, "Valid element_id required.");
            Element element = doc.GetElement(new ElementId(raw));
            if (element == null) return Error(404, "Annotation not found.");
            string action = p.Value<string>("action");
            if (action != "text" && action != "tag")
                return Error(400, "Action must be text or tag.");
            var note = element as TextNote;
            var tag = element as IndependentTag;
            if (action == "text" && note == null) return Error(409, "Target is not a TextNote.");
            if (action == "tag" && tag == null) return Error(409, "Target is not an IndependentTag.");
            if (element.Pinned) return Error(409, "Pinned annotation cannot be updated.");
            string text = p.Value<string>("text");
            bool hasText = p["text"] != null;
            bool hasLeader = p["has_leader"] != null;
            bool hasPosition = p["x"] != null || p["y"] != null || p["z"] != null;
            if (action == "text" && (!hasText || hasLeader || hasPosition))
                return Error(400, "Text update requires text only.");
            if (action == "tag" && (hasText || (!hasLeader && !hasPosition)))
                return Error(400, "Tag update requires leader or XYZ, not text.");
            if (hasText && (String.IsNullOrWhiteSpace(text) || text.Length > 32768))
                return Error(400, "Text must contain 1..32768 characters.");
            XYZ head = null;
            if (hasPosition)
            {
                if (p["x"] == null || p["y"] == null || p["z"] == null)
                    return Error(400, "Tag head position requires all XYZ values.");
                double x, y, z;
                if (!Finite(p["x"], out x) || !Finite(p["y"], out y) || !Finite(p["z"], out z))
                    return Error(400, "Tag head XYZ must be finite numeric values.");
                head = new XYZ(x, y, z);
            }
            bool newLeader = false;
            if (hasLeader)
            {
                if (p["has_leader"].Type != JTokenType.Boolean)
                    return Error(400, "has_leader must be boolean.");
                newLeader = p.Value<bool>("has_leader");
            }
            using (var tx = new Transaction(doc, "RevitGPT Update Annotation"))
            {
                tx.Start();
                try
                {
                    if (note != null) note.Text = text;
                    if (tag != null)
                    {
                        if (hasLeader) tag.HasLeader = newLeader;
                        if (head != null) tag.TagHeadPosition = head;
                    }
                    if (tx.Commit() != TransactionStatus.Committed)
                        return Error(500, "Annotation transaction not committed.");
                }
                catch
                {
                    if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                    throw;
                }
            }
            return Data(new {
                transaction = "committed", element_id = Id(element),
                action, text = note?.Text, has_leader = tag?.HasLeader,
                tag_head = tag == null ? null : new {
                    x = tag.TagHeadPosition.X, y = tag.TagHeadPosition.Y,
                    z = tag.TagHeadPosition.Z, unit = "revit_internal_feet"
                }
            });
        }
        private static bool Finite(JToken token, out double v)
        {
            v = 0;
            if (token.Type != JTokenType.Integer && token.Type != JTokenType.Float)
                return false;
            return double.TryParse(token.ToString(), NumberStyles.Float,
                CultureInfo.InvariantCulture, out v) &&
                !double.IsInfinity(v) && !double.IsNaN(v) && Math.Abs(v) < 10000000;
        }
    }
}
