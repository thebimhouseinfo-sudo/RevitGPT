using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Atomic batch tags for a single view. One exact native approval per batch.
    internal static class NativeBatchTags
    {
        private static string Data(object value) => JsonConvert.SerializeObject(new { data = value });
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });

        public static string Execute(Document doc, JObject input)
        {
            long viewRaw;
            if (!Int64.TryParse(input.Value<string>("view_id"), NumberStyles.None,
                CultureInfo.InvariantCulture, out viewRaw) || viewRaw <= 0)
                return Error(400, "Valid view_id required.");
            var view = doc.GetElement(new ElementId(viewRaw)) as View;
            if (view == null || view.IsTemplate || view is View3D || view is ViewSchedule)
                return Error(422, "A supported non-template annotation view is required.");
            var targets = input["element_ids"] as JArray;
            if (targets == null || targets.Count == 0 || targets.Count > 50)
                return Error(400, "element_ids requires 1..50 elements.");
            if (input["has_leader"] != null && input["has_leader"].Type != JTokenType.Boolean)
                return Error(400, "has_leader must be boolean.");
            bool leader = input.Value<bool?>("has_leader") == true;
            var unique = new HashSet<long>();
            var elements = new List<Element>();
            foreach (JToken item in targets)
            {
                long value;
                if (item.Type != JTokenType.String ||
                    !Int64.TryParse(item.Value<string>(), NumberStyles.None,
                        CultureInfo.InvariantCulture, out value) || value <= 0 || !unique.Add(value))
                    return Error(400, "Duplicate or invalid target ID.");
                var element = doc.GetElement(new ElementId(value));
                if (element == null) return Error(404, "Missing tag target.");
                if (element.ViewSpecific && element.OwnerViewId != view.Id)
                    return Error(409, "Target annotation belongs to another view.");
                elements.Add(element);
            }
            // Existing-tag check is conservative: a tagged element is refused
            // rather than duplicating labels or silently overwriting metadata.
            var previouslyTagged = new HashSet<long>();
            foreach (IndependentTag tag in new FilteredElementCollector(doc, view.Id)
                .OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
            {
                foreach (ElementId id in tag.GetTaggedLocalElementIds())
                    previouslyTagged.Add(id.Value);
            }
            if (elements.Any(e => previouslyTagged.Contains(e.Id.Value)))
                return Error(409, "At least one target already has a tag in the view.");
            var created = new List<string>();
            using (var tx = new Transaction(doc, "RevitGPT Batch Tag"))
            {
                tx.Start();
                try
                {
                    foreach (var element in elements)
                    {
                        var box = element.get_BoundingBox(view);
                        if (box == null)
                            throw new InvalidOperationException("Target has no visible view bounding box.");
                        XYZ center = (box.Min + box.Max) / 2.0;
                        var tag = IndependentTag.Create(doc, view.Id, new Reference(element),
                            leader, TagMode.TM_ADDBY_CATEGORY, TagOrientation.Horizontal, center);
                        if (tag == null)
                            throw new InvalidOperationException("Category tag creation failed.");
                        created.Add(tag.Id.Value.ToString(CultureInfo.InvariantCulture));
                    }
                    if (tx.Commit() != TransactionStatus.Committed)
                        return Error(500, "Batch tag transaction did not commit.");
                }
                catch
                {
                    if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                    throw;
                }
            }
            return Data(new { transaction = "committed", view_id = viewRaw.ToString(
                CultureInfo.InvariantCulture), created_tag_ids = created,
                tagged_count = created.Count, complete = true });
        }
    }
}
