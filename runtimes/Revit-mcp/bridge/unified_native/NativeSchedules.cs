using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Deterministic bounded ViewSchedule readback and supported field edits.
    internal static class NativeSchedules
    {
        private static string Data(object x) => JsonConvert.SerializeObject(new { data = x });
        private static string Error(int c, string m) => JsonConvert.SerializeObject(
            new { error = new { code = c, message = m } });
        private static ViewSchedule Get(Document d, JObject p)
        {
            long id;
            if (!Int64.TryParse(p.Value<string>("schedule_id"),
                NumberStyles.None, CultureInfo.InvariantCulture, out id) || id <= 0)
                throw new ArgumentException("schedule_id is a positive string ID.");
            var schedule = d.GetElement(new ElementId(id)) as ViewSchedule;
            if (schedule == null || schedule.IsTemplate)
                throw new ArgumentException("Non-template ViewSchedule not found.");
            return schedule;
        }
        public static string List(Document d)
        {
            var schedules = new FilteredElementCollector(d)
                .OfClass(typeof(ViewSchedule)).Cast<ViewSchedule>()
                .Where(x => !x.IsTemplate).Take(2001)
                .Select(x => new {
                    id = x.Id.Value.ToString(CultureInfo.InvariantCulture),
                    name = x.Name,
                    type = x.ViewType.ToString()
                }).ToList();
            if (schedules.Count > 2000) return Error(413, "Too many schedules.");
            return Data(schedules);
        }
        public static string GetSchedule(Document d, JObject p)
        {
            try
            {
                ViewSchedule schedule = Get(d, p);
                var definition = schedule.Definition;
                var fields = definition.GetFieldOrder().Select(id => definition.GetField(id))
                    .Select(f => new {
                        field_id = f.FieldId.IntegerValue.ToString(CultureInfo.InvariantCulture),
                        name = f.GetName(), hidden = f.IsHidden,
                        type = f.FieldType.ToString()
                    }).ToList();
                var table = schedule.GetTableData();
                var body = table.GetSectionData(SectionType.Body);
                int rowCount = body.NumberOfRows, columnCount = body.NumberOfColumns;
                if (rowCount > 500 || columnCount > 64)
                    return Error(413, "Schedule exceeds row/column read cap.");
                var rows = new List<List<string>>();
                for (int row = 0; row < rowCount; row++)
                {
                    var cells = new List<string>();
                    for (int col = 0; col < columnCount; col++)
                        cells.Add(schedule.GetCellText(SectionType.Body, row, col));
                    rows.Add(cells);
                }
                return Data(new {
                    id = schedule.Id.Value.ToString(CultureInfo.InvariantCulture),
                    name = schedule.Name, fields, rows,
                    complete = true, row_count = rowCount,
                    column_count = columnCount,
                    filter_count = definition.GetFilterCount(),
                    sort_count = definition.GetSortGroupFieldCount()
                });
            }
            catch (ArgumentException e) { return Error(400, e.Message); }
        }
        public static string Update(Document d, JObject p)
        {
            try
            {
                ViewSchedule schedule = Get(d, p);
                string action = p.Value<string>("action");
                if (action != "hide_field" && action != "show_field" &&
                    action != "add_filter_equals" && action != "clear_filters" &&
                    action != "add_sort" && action != "clear_sorts")
                    return Error(400, "Unsupported schedule update action.");
                var def = schedule.Definition;
                bool usesField = action == "hide_field" || action == "show_field" ||
                    action == "add_filter_equals" || action == "add_sort";
                ScheduleField field = null;
                if (usesField)
                {
                    int id;
                    if (!Int32.TryParse(p.Value<string>("field_id"), NumberStyles.None,
                        CultureInfo.InvariantCulture, out id) || id < 0)
                        return Error(400, "field_id required.");
                    field = def.GetField(new ScheduleFieldId(id));
                    if (field == null) return Error(404, "Schedule field missing.");
                }
                string filterValue = null;
                if (action == "add_filter_equals")
                {
                    if (p["value"]?.Type != JTokenType.String)
                        return Error(400, "String equality filter requires text value.");
                    filterValue = p.Value<string>("value");
                    if (filterValue.Length > 256)
                        return Error(413, "Filter string exceeds limit.");
                }
                using (var tx = new Transaction(d, "RevitGPT Schedule Field"))
                {
                    tx.Start();
                    try
                    {
                        if (action == "hide_field") field.IsHidden = true;
                        if (action == "show_field") field.IsHidden = false;
                        if (action == "add_filter_equals")
                        {
                            if (def.GetFilterCount() >= 32)
                                throw new InvalidOperationException("Schedule has too many filters.");
                            def.AddFilter(new ScheduleFilter(
                                field.FieldId, ScheduleFilterType.Equal, filterValue));
                        }
                        if (action == "clear_filters") def.ClearFilters();
                        if (action == "add_sort")
                        {
                            if (def.GetSortGroupFieldCount() >= 16)
                                throw new InvalidOperationException("Schedule has too many sorts.");
                            def.AddSortGroupField(new ScheduleSortGroupField(field.FieldId));
                        }
                        if (action == "clear_sorts") def.ClearSortGroupFields();
                        if (tx.Commit() != TransactionStatus.Committed)
                            return Error(500, "Schedule transaction did not commit.");
                    }
                    catch
                    {
                        if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                        throw;
                    }
                }
                return Data(new {
                    transaction = "committed", action,
                    schedule_id = schedule.Id.Value.ToString(CultureInfo.InvariantCulture),
                    field_id = field == null ? null :
                        field.FieldId.IntegerValue.ToString(CultureInfo.InvariantCulture),
                    hidden = field == null ? (bool?)null : field.IsHidden,
                    filter_count = def.GetFilterCount(),
                    sort_count = def.GetSortGroupFieldCount()
                });
            }
            catch (ArgumentException e) { return Error(400, e.Message); }
            catch (Exception e) { return Error(500, "Schedule update failed: " + e.GetType().Name); }
        }
    }
}
