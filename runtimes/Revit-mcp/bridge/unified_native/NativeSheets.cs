using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // V1 sheet inventory, creation and viewport management. No arbitrary API.
    internal static class NativeSheets
    {
        private static string Data(object value) => JsonConvert.SerializeObject(new { data = value });
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });
        private static string Token(JObject p, string key) => p[key]?.ToString();
        private static ElementId Id(JObject p, string key)
        {
            long value;
            if (!Int64.TryParse(Token(p, key), NumberStyles.None,
                CultureInfo.InvariantCulture, out value) || value <= 0)
                throw new ArgumentException("Positive " + key + " ID required.");
            return new ElementId(value);
        }
        private static double Number(JObject p, string key)
        {
            JToken t = p[key]; double value;
            if (t == null || (t.Type != JTokenType.Integer && t.Type != JTokenType.Float) ||
                !Double.TryParse(t.ToString(), NumberStyles.Float,
                    CultureInfo.InvariantCulture, out value) ||
                Double.IsInfinity(value) || Double.IsNaN(value) || Math.Abs(value) > 100000)
                throw new ArgumentException("Invalid coordinate " + key);
            return value;
        }
        public static string List(Document doc)
        {
            var sheets = new FilteredElementCollector(doc).OfClass(typeof(ViewSheet))
                .Cast<ViewSheet>().OrderBy(x => x.SheetNumber, StringComparer.Ordinal)
                .Select(x => new {
                    id = x.Id.Value.ToString(CultureInfo.InvariantCulture),
                    number = x.SheetNumber, name = x.Name,
                    placed_view_ids = x.GetAllPlacedViews().Select(id =>
                        id.Value.ToString(CultureInfo.InvariantCulture)).ToList(),
                    viewport_ids = x.GetAllViewports().Select(id =>
                        id.Value.ToString(CultureInfo.InvariantCulture)).ToList()
                }).ToList();
            if (sheets.Count > 2000) return Error(413, "Too many sheets.");
            return Data(sheets);
        }
        public static string Viewports(Document doc, JObject payload)
        {
            var sheet = doc.GetElement(Id(payload, "sheet_id")) as ViewSheet;
            if (sheet == null) return Error(404, "Sheet not found.");
            var result = sheet.GetAllViewports().Select(x => doc.GetElement(x) as Viewport)
                .Where(x => x != null)
                .Select(v => {
                    XYZ p = v.GetBoxCenter();
                    return new {
                        id = v.Id.Value.ToString(CultureInfo.InvariantCulture),
                        view_id = v.ViewId.Value.ToString(CultureInfo.InvariantCulture),
                        sheet_id = sheet.Id.Value.ToString(CultureInfo.InvariantCulture),
                        center = new { x = p.X, y = p.Y },
                        unit = "revit_internal_feet"
                    };
                }).ToList();
            return Data(result);
        }
        public static string Write(Document doc, JObject p)
        {
            string action = Token(p, "action");
            if (action != "create_sheet" && action != "place_viewport" &&
                action != "move_viewport" && action != "remove_viewport")
                return Error(400, "Invalid sheet action.");
            try
            {
                ElementId sheetId = null, viewId = null, viewportId = null, titleblockId = null;
                XYZ at = null;
                if (action == "create_sheet")
                {
                    string number = Token(p, "sheet_number");
                    if (String.IsNullOrWhiteSpace(number) || number.Length > 64)
                        return Error(400, "Sheet number required.");
                    if (new FilteredElementCollector(doc).OfClass(typeof(ViewSheet))
                        .Cast<ViewSheet>().Any(s => s.SheetNumber == number))
                        return Error(409, "Sheet number already exists.");
                    titleblockId = p["titleblock_type_id"] == null ?
                        ElementId.InvalidElementId : Id(p, "titleblock_type_id");
                    if (titleblockId != ElementId.InvalidElementId)
                    {
                        FamilySymbol symbol = doc.GetElement(titleblockId) as FamilySymbol;
                        if (symbol == null || symbol.Category?.Id?.Value !=
                            (long)BuiltInCategory.OST_TitleBlocks)
                            return Error(400, "Titleblock FamilySymbol required.");
                    }
                }
                else if (action == "remove_viewport" || action == "move_viewport")
                {
                    viewportId = Id(p, "viewport_id");
                    if (!(doc.GetElement(viewportId) is Viewport))
                        return Error(404, "Viewport missing.");
                }
                else
                {
                    sheetId = Id(p, "sheet_id");
                    viewId = Id(p, "view_id");
                    if (!(doc.GetElement(sheetId) is ViewSheet))
                        return Error(404, "Sheet missing.");
                    if (!(doc.GetElement(viewId) is View) ||
                        !Viewport.CanAddViewToSheet(doc, sheetId, viewId))
                        return Error(409, "Cannot place view on this sheet.");
                }
                if (action == "place_viewport" || action == "move_viewport")
                    at = new XYZ(Number(p, "x"), Number(p, "y"), 0);
                ElementId created = null;
                using (var tx = new Transaction(doc, "RevitGPT Sheet " + action))
                {
                    tx.Start();
                    try
                    {
                        if (action == "create_sheet")
                        {
                            var sheet = ViewSheet.Create(doc, titleblockId);
                            sheet.SheetNumber = Token(p, "sheet_number");
                            string name = Token(p, "sheet_name");
                            if (!String.IsNullOrWhiteSpace(name)) sheet.Name = name;
                            created = sheet.Id;
                        }
                        if (action == "place_viewport")
                            created = Viewport.Create(doc, sheetId, viewId, at).Id;
                        if (action == "move_viewport")
                        {
                            ((Viewport)doc.GetElement(viewportId)).SetBoxCenter(at);
                            created = viewportId;
                        }
                        if (action == "remove_viewport")
                        {
                            var removed = doc.Delete(viewportId);
                            if (!removed.Contains(viewportId))
                                throw new InvalidOperationException("Viewport deletion failed.");
                            created = viewportId;
                        }
                        if (tx.Commit() != TransactionStatus.Committed)
                            return Error(500, "Sheet transaction did not commit.");
                    }
                    catch
                    {
                        if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                        throw;
                    }
                }
                return Data(new { transaction = "committed", action,
                    id = created.Value.ToString(CultureInfo.InvariantCulture) });
            }
            catch (ArgumentException e) { return Error(400, e.Message); }
            catch (InvalidOperationException e) { return Error(409, e.Message); }
            catch (Exception e) { return Error(500, "Sheet write failed: " + e.GetType().Name); }
        }
    }
}
