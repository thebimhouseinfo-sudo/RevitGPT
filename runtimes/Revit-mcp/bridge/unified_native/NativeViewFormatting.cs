using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Persistent view presentation changes; never classify as UI_ACTION.
    internal static class NativeViewFormatting
    {
        private static string Data(object x) => JsonConvert.SerializeObject(new { data = x });
        private static string Error(int c, string s) =>
            JsonConvert.SerializeObject(new { error = new { code = c, message = s } });
        private static string Token(JObject p, string k) => p[k]?.ToString();
        private static long Id(JObject p, string k)
        {
            long id;
            if (!Int64.TryParse(Token(p, k), NumberStyles.None,
                CultureInfo.InvariantCulture, out id) || id <= 0)
                throw new ArgumentException("Invalid " + k + ".");
            return id;
        }
        private static double Number(JObject p, string k)
        {
            double n;
            var t = p[k];
            if (t == null || (t.Type != JTokenType.Float && t.Type != JTokenType.Integer) ||
                !Double.TryParse(t.ToString(), NumberStyles.Float,
                CultureInfo.InvariantCulture, out n) || Double.IsNaN(n) ||
                Double.IsInfinity(n) || Math.Abs(n) > 100000)
                throw new ArgumentException("Invalid finite coordinate " + k + ".");
            return n;
        }
        public static string Execute(Document doc, JObject p)
        {
            try
            {
                var view = doc.GetElement(new ElementId(Id(p, "view_id"))) as View;
                if (view == null || view.IsTemplate)
                    return Error(404, "Editable non-template view required.");
                string action = Token(p, "action");
                if (action != "properties" && action != "crop" &&
                    action != "template" && action != "visibility" &&
                    action != "graphics")
                    return Error(400, "Unsupported view formatting action.");
                Element target = null;
                if (action == "visibility" || action == "graphics")
                {
                    target = doc.GetElement(new ElementId(Id(p, "element_id")));
                    if (target == null) return Error(404, "View override target missing.");
                    if (target.ViewSpecific && target.OwnerViewId != view.Id)
                        return Error(409, "Target belongs to another view.");
                }
                BoundingBoxXYZ crop = null;
                if (action == "crop")
                {
                    if (!view.CanHaveCropBox())
                        return Error(409, "View does not support crop box.");
                    double x0 = Number(p, "min_x"), y0 = Number(p, "min_y"),
                        z0 = Number(p, "min_z"), x1 = Number(p, "max_x"),
                        y1 = Number(p, "max_y"), z1 = Number(p, "max_z");
                    if (x1 <= x0 || y1 <= y0 || z1 <= z0)
                        return Error(400, "Crop extent must have positive dimensions.");
                    crop = new BoundingBoxXYZ { Min = new XYZ(x0, y0, z0),
                        Max = new XYZ(x1, y1, z1) };
                }
                var templateId = action == "template" ?
                    (Token(p, "template_id") == "none" ? ElementId.InvalidElementId
                    : new ElementId(Id(p, "template_id"))) : null;
                if (action == "template" && templateId != ElementId.InvalidElementId)
                {
                    var template = doc.GetElement(templateId) as View;
                    if (template == null || !template.IsTemplate)
                        return Error(400, "template_id must reference a View Template.");
                }
                using (var tx = new Transaction(doc, "RevitGPT View Formatting"))
                {
                    tx.Start();
                    try
                    {
                        if (action == "properties")
                        {
                            if (p["scale"] != null)
                            {
                                int scale;
                                if (!Int32.TryParse(Token(p, "scale"), out scale) ||
                                    scale < 1 || scale > 100000)
                                    throw new ArgumentException("Invalid view scale.");
                                view.Scale = scale;
                            }
                            if (p["detail_level"] != null)
                            {
                                ViewDetailLevel detail;
                                if (!Enum.TryParse<ViewDetailLevel>(Token(p, "detail_level"), false, out detail) ||
                                    !Enum.IsDefined(typeof(ViewDetailLevel), detail))
                                    throw new ArgumentException("Invalid detail level.");
                                view.DetailLevel = detail;
                            }
                            if (p["display_style"] != null)
                            {
                                DisplayStyle style;
                                if (!Enum.TryParse<DisplayStyle>(Token(p, "display_style"), false, out style) ||
                                    !Enum.IsDefined(typeof(DisplayStyle), style))
                                    throw new ArgumentException("Invalid display style.");
                                view.DisplayStyle = style;
                            }
                        }
                        if (action == "crop")
                        {
                            view.CropBoxActive = true;
                            view.CropBox = crop;
                            view.CropBoxVisible = p.Value<bool?>("crop_visible") == true;
                        }
                        if (action == "template") view.ViewTemplateId = templateId;
                        if (action == "visibility")
                        {
                            if (p["hide"]?.Type != JTokenType.Boolean)
                                throw new ArgumentException("hide boolean required.");
                            if (p.Value<bool>("hide")) view.HideElements(new[] { target.Id });
                            else view.UnhideElements(new[] { target.Id });
                        }
                        if (action == "graphics")
                        {
                            int r = (int)Number(p, "red"), g = (int)Number(p, "green"),
                                b = (int)Number(p, "blue");
                            if (r > 255 || g > 255 || b > 255 || r < 0 || g < 0 || b < 0)
                                throw new ArgumentException("Color must be RGB 0..255.");
                            var previous = view.GetElementOverrides(target.Id);
                            previous.SetProjectionLineColor(new Color((byte)r, (byte)g, (byte)b));
                            view.SetElementOverrides(target.Id, previous);
                        }
                        if (tx.Commit() != TransactionStatus.Committed)
                            return Error(500, "View transaction not committed.");
                    }
                    catch
                    {
                        if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                        throw;
                    }
                }
                return Data(new {
                    transaction = "committed", action,
                    view_id = view.Id.Value.ToString(CultureInfo.InvariantCulture),
                    scale = view.Scale,
                    detail_level = view.DetailLevel.ToString(),
                    display_style = view.DisplayStyle.ToString(),
                    template_id = view.ViewTemplateId.Value.ToString(CultureInfo.InvariantCulture),
                    crop_active = view.CropBoxActive
                });
            }
            catch (ArgumentException e) { return Error(400, e.Message); }
            catch (InvalidOperationException e) { return Error(409, e.Message); }
            catch (Exception e) { return Error(500, "View formatting: " + e.GetType().Name); }
        }
    }
}
