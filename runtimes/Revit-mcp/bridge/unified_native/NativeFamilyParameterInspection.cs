// Family definition inspection is separate from Project shared-parameter binding.
// Global Parameters are document-level constraints, not replacements for
// category-bound shared parameters. Family Type definitions are never deleted.
using System;
using System.Linq;
using System.Globalization;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    internal static class NativeFamilyParameterInspection
    {
        private static string Data(object value) => JsonConvert.SerializeObject(new { data = value });
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });

        public static string Read(Document project, JObject request)
        {
            long familyId;
            if (!long.TryParse(request.Value<string>("family_id"), NumberStyles.None,
                    CultureInfo.InvariantCulture, out familyId) || familyId <= 0)
                return Error(400, "Exact positive family_id required.");
            var family = project.GetElement(new ElementId(familyId)) as Family;
            if (family == null) return Error(404, "Loadable family not found.");
            if (!family.IsEditable) return Error(422, "Family is not editable.");
            Document familyDocument = null;
            try
            {
                familyDocument = project.EditFamily(family);
                var parameters = familyDocument.FamilyManager.Parameters
                    .Cast<FamilyParameter>()
                    .Select(parameter => new
                    {
                        name = parameter.Definition.Name,
                        is_instance = parameter.IsInstance,
                        is_shared = parameter.IsShared,
                        guid = parameter.IsShared ? parameter.GUID.ToString() : null,
                        data_type = parameter.Definition.GetDataType().TypeId,
                        group = parameter.Definition.GetGroupTypeId().TypeId,
                        is_read_only = parameter.IsReadOnly
                    }).ToList();
                return Data(new
                {
                    family_id = familyId.ToString(CultureInfo.InvariantCulture),
                    family_name = family.Name,
                    parameter_count = parameters.Count,
                    parameters
                });
            }
            catch (Exception exception)
            {
                return Error(422, "Family inspection failed: " + exception.GetType().Name);
            }
            finally
            {
                if (familyDocument != null)
                    try { familyDocument.Close(false); }
                    catch { /* Do not mask original diagnostic. */ }
            }
        }
    }
}
