using System;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Native simple view creation, no implicit project switching.
    internal static class NativeViewCreate
    {
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });
        private static string Data(object result) => JsonConvert.SerializeObject(new { data = result });
        private static string Token(JObject p, string key) => p[key]?.ToString();
        private static long Id(JObject p, string key)
        {
            long id;
            if (p[key]?.Type != JTokenType.String ||
                !long.TryParse(Token(p, key), NumberStyles.None, CultureInfo.InvariantCulture, out id)
                || id <= 0) throw new ArgumentException("Valid " + key + " required.");
            return id;
        }
        private static ViewFamilyType FamilyType(Document doc, ViewFamily family, JObject p)
        {
            string requested = Token(p, "view_family_type_id");
            if (requested != null)
            {
                var type = doc.GetElement(new ElementId(Id(p, "view_family_type_id")))
                    as ViewFamilyType;
                if (type == null || type.ViewFamily != family)
                    throw new ArgumentException("View family type does not match action.");
                return type;
            }
            var found = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                .Cast<ViewFamilyType>().FirstOrDefault(x => x.ViewFamily == family);
            if (found == null) throw new ArgumentException("Required ViewFamilyType not found.");
            return found;
        }
        private static XYZ ExactPoint(JObject p, string prefix)
        {
            var value = p[prefix] as JObject;
            if (value == null) throw new ArgumentException(prefix + " XYZ required.");
            var xyz = new double[3];
            int index = 0;
            foreach (string k in new[] { "x", "y", "z" })
            {
                if (value[k] == null || (value[k].Type != JTokenType.Integer &&
                    value[k].Type != JTokenType.Float) ||
                    !Double.TryParse(value[k].ToString(), NumberStyles.Float,
                        CultureInfo.InvariantCulture, out xyz[index]) ||
                    Double.IsNaN(xyz[index]) || Double.IsInfinity(xyz[index]) ||
                    Math.Abs(xyz[index]) > 1000000)
                    throw new ArgumentException("Invalid section XYZ: " + prefix);
                index++;
            }
            return new XYZ(xyz[0], xyz[1], xyz[2]);
        }

        private static BoundingBoxXYZ SectionBox(JObject p)
        {
            var box = p["section_box"] as JObject;
            if (box == null) throw new ArgumentException("section_box required.");
            XYZ origin = ExactPoint(box, "origin");
            XYZ bx = ExactPoint(box, "basis_x");
            XYZ by = ExactPoint(box, "basis_y");
            XYZ bz = ExactPoint(box, "basis_z");
            XYZ min = ExactPoint(box, "min"), max = ExactPoint(box, "max");
            if (Math.Abs(bx.GetLength() - 1) > 0.0001 ||
                Math.Abs(by.GetLength() - 1) > 0.0001 ||
                Math.Abs(bz.GetLength() - 1) > 0.0001 ||
                Math.Abs(bx.DotProduct(by)) > 0.0001 ||
                Math.Abs(bx.DotProduct(bz)) > 0.0001 ||
                Math.Abs(by.DotProduct(bz)) > 0.0001 ||
                bx.CrossProduct(by).DistanceTo(bz) > 0.0001 ||
                max.X - min.X < 0.01 || max.Y - min.Y < 0.01 ||
                max.Z - min.Z < 0.01)
                throw new ArgumentException("Section transform must be right-handed orthonormal with valid box.");
            var transform = Transform.Identity;
            transform.Origin = origin;
            transform.BasisX = bx;
            transform.BasisY = by;
            transform.BasisZ = bz;
            return new BoundingBoxXYZ { Transform = transform, Min = min, Max = max };
        }

        public static string Execute(Document doc, JObject p)
        {
            try
            {
                string action = Token(p, "action");
                if (action != "floor_plan" && action != "ceiling_plan" &&
                    action != "isometric_3d" && action != "section" && action != "duplicate")
                    return Error(400, "Only floor_plan, ceiling_plan, isometric_3d, section and duplicate supported.");
                View source = null;
                Level level = null;
                ViewFamilyType familyType = null;
                if (action == "duplicate")
                {
                    source = doc.GetElement(new ElementId(Id(p, "source_view_id"))) as View;
                    if (source == null || source.IsTemplate ||
                        !source.CanViewBeDuplicated(ViewDuplicateOption.Duplicate))
                        return Error(422, "View cannot be duplicated.");
                }
                else
                {
                    ViewFamily family = action == "floor_plan" ? ViewFamily.FloorPlan :
                        action == "ceiling_plan" ? ViewFamily.CeilingPlan :
                        action == "section" ? ViewFamily.Section : ViewFamily.ThreeDimensional;
                    familyType = FamilyType(doc, family, p);
                    if (action == "floor_plan" || action == "ceiling_plan")
                    {
                        level = doc.GetElement(new ElementId(Id(p, "level_id"))) as Level;
                        if (level == null) return Error(404, "Level not found.");
                    }
                }
                BoundingBoxXYZ sectionBox = action == "section" ? SectionBox(p) : null;
                string name = Token(p, "name");
                if (name != null && (String.IsNullOrWhiteSpace(name) || name.Length > 128))
                    return Error(400, "View name must be nonempty and <=128 characters.");
                if (name != null && new FilteredElementCollector(doc)
                    .OfClass(typeof(View)).Cast<View>()
                    .Any(x => String.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)))
                    return Error(409, "View name already exists.");
                View created = null;
                using (var tx = new Transaction(doc, "RevitGPT Create View"))
                {
                    tx.Start();
                    try
                    {
                        if (action == "floor_plan" || action == "ceiling_plan")
                            created = ViewPlan.Create(doc, familyType.Id, level.Id);
                        if (action == "isometric_3d")
                            created = View3D.CreateIsometric(doc, familyType.Id);
                        if (action == "section")
                            created = ViewSection.CreateSection(doc, familyType.Id, sectionBox);
                        if (action == "duplicate")
                        {
                            ElementId id = source.Duplicate(ViewDuplicateOption.Duplicate);
                            created = doc.GetElement(id) as View;
                        }
                        if (created == null)
                            throw new InvalidOperationException("View creation returned no view.");
                        if (name != null) created.Name = name;
                        if (tx.Commit() != TransactionStatus.Committed)
                            return Error(500, "View transaction did not commit.");
                    }
                    catch
                    {
                        if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                        throw;
                    }
                }
                return Data(new { transaction = "committed",
                    id = created.Id.Value.ToString(CultureInfo.InvariantCulture),
                    name = created.Name, view_type = created.ViewType.ToString(),
                    action, complete = true });
            }
            catch (ArgumentException ex) { return Error(400, ex.Message); }
            catch (InvalidOperationException ex) { return Error(409, ex.Message); }
            catch (Exception ex) { return Error(500, "View creation failed: " + ex.GetType().Name); }
        }
    }
}
