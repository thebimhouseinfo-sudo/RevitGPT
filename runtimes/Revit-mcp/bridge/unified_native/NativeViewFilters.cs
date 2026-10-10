using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Existing parameter view filters: inspect/apply/remove/toggle.
    // Creation/rule editing will be added separately; no unsafe inferred rules.
    internal static class NativeViewFilters
    {
        private static string Data(object value) => JsonConvert.SerializeObject(new { data = value });
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });
        private static long ParseId(JObject p, string key)
        {
            long value;
            if (p[key]?.Type != JTokenType.String ||
                !long.TryParse(p.Value<string>(key), NumberStyles.None,
                    CultureInfo.InvariantCulture, out value) || value <= 0)
                throw new ArgumentException("Invalid " + key + ".");
            return value;
        }
        private static View View(Document doc, JObject p)
        {
            var view = doc.GetElement(new ElementId(ParseId(p, "view_id"))) as View;
            if (view == null || view.IsTemplate || view is ViewSchedule || view is ViewSheet)
                throw new ArgumentException("Unsupported non-template view.");
            return view;
        }
        public static string List(Document doc, JObject p)
        {
            try
            {
                var view = View(doc, p);
                var entries = new List<object>();
                foreach (ElementId id in view.GetFilters())
                {
                    if (entries.Count >= 256) return Error(413, "Too many view filters.");
                    var filter = doc.GetElement(id);
                    entries.Add(new {
                        filter_id = id.Value.ToString(CultureInfo.InvariantCulture),
                        name = filter?.Name ?? "",
                        is_parameter_filter = filter is ParameterFilterElement,
                        visible = view.GetFilterVisibility(id)
                    });
                }
                return Data(new {
                    view_id = view.Id.Value.ToString(CultureInfo.InvariantCulture),
                    filters = entries, complete = true
                });
            }
            catch (ArgumentException ex) { return Error(400, ex.Message); }
        }
        public static string Write(Document doc, JObject p)
        {
            try
            {
                var view = View(doc, p);
                string action = p.Value<string>("action");
                if (action != "apply" && action != "remove" && action != "visibility")
                    return Error(400, "action must be apply/remove/visibility.");
                var filter = doc.GetElement(new ElementId(ParseId(p, "filter_id")))
                    as ParameterFilterElement;
                if (filter == null) return Error(404, "ParameterFilterElement not found.");
                bool already = view.GetFilters().Contains(filter.Id);
                if (action == "apply" && already)
                    return Error(409, "Filter already attached to view.");
                if (action != "apply" && !already)
                    return Error(409, "Filter is not attached to view.");
                if (action == "visibility" && p["visible"]?.Type != JTokenType.Boolean)
                    return Error(400, "visibility requires a boolean visible flag.");
                using (var tx = new Transaction(doc, "RevitGPT View Filter"))
                {
                    tx.Start();
                    try
                    {
                        if (action == "apply") view.AddFilter(filter.Id);
                        if (action == "remove") view.RemoveFilter(filter.Id);
                        if (action == "visibility")
                            view.SetFilterVisibility(filter.Id, p.Value<bool>("visible"));
                        if (tx.Commit() != TransactionStatus.Committed)
                            return Error(500, "Filter transaction not committed.");
                    }
                    catch
                    {
                        if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                        throw;
                    }
                }
                bool attached = view.GetFilters().Contains(filter.Id);
                return Data(new {
                    transaction = "committed", action,
                    view_id = view.Id.Value.ToString(CultureInfo.InvariantCulture),
                    filter_id = filter.Id.Value.ToString(CultureInfo.InvariantCulture),
                    attached, visible = attached ? (bool?)view.GetFilterVisibility(filter.Id) : null
                });
            }
            catch (ArgumentException ex) { return Error(400, ex.Message); }
            catch (InvalidOperationException ex) { return Error(409, ex.Message); }
        }
    }
}
