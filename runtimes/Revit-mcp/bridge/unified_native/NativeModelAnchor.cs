using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // P3 Model Anchor: a GUID-identified text shared parameter on Project Information.
    // This is distinct from Revit Global Parameters and does not depend on project title.
    internal static class NativeModelAnchor
    {
        internal const string Name = "RevitGPT_Model_ID";
        internal static readonly Guid DefinitionGuid =
            new Guid("60c02344-d967-4540-939d-19b5c4d774fb");

        private static string Data(object x) => JsonConvert.SerializeObject(new { data = x });
        private static string Error(int code, string message) =>
            JsonConvert.SerializeObject(new { error = new { code, message } });

        private static Parameter Existing(Document doc)
        {
            return doc.ProjectInformation?.get_Parameter(DefinitionGuid);
        }

        private static string CurrentValue(Parameter parameter)
        {
            if (parameter == null || !parameter.HasValue) return null;
            return parameter.AsString();
        }

        // A copied/detached RVT can retain the same Project Information value.
        // Detect concurrently open conflicting documents, but NEVER rewrite IDs
        // automatically or treat project title/path as the model's identity.
        private static bool ValidModelId(string value)
        {
            return !String.IsNullOrWhiteSpace(value) && Regex.IsMatch(value,
                @"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}_\d{8}T\d{9}Z_[0-9a-f]{8}$");
        }

        private static string GenerateModelId(Document doc)
        {
            // Snapshot the model name ONLY at initial creation; later renames must not rekey.
            string slug = Regex.Replace(doc.Title ?? "Model", @"[^A-Za-z0-9]+", "_").Trim('_');
            if (String.IsNullOrEmpty(slug)) slug = "Model";
            if (slug.Length > 64) slug = slug.Substring(0, 64).TrimEnd('_');
            string timestamp = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffZ",
                System.Globalization.CultureInfo.InvariantCulture);
            string random = Guid.NewGuid().ToString("N").Substring(0, 8);
            return slug + "_" + timestamp + "_" + random;
        }

        private static string[] DuplicateOpenModels(Document doc, string value)
        {
            if (!ValidModelId(value)) return new string[0];
            return doc.Application.Documents.Cast<Document>()
                .Where(other => other != null && other.GetHashCode() != doc.GetHashCode() &&
                    !other.IsFamilyDocument && !other.IsLinked)
                .Where(other => String.Equals(CurrentValue(Existing(other)), value,
                    StringComparison.OrdinalIgnoreCase))
                .Select(other => other.Title)
                .ToArray();
        }

        private static ExternalDefinition GetOrCreateDefinition(ApplicationWrapper wrapper)
        {
            var app = wrapper.Document.Application;
            string root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "RevitGPT", "state");
            Directory.CreateDirectory(root);
            string file = Path.Combine(root, "revitgpt-shared-parameters.txt");
            if (!File.Exists(file))
            {
                File.WriteAllText(file,
                    "# RevitGPT shared parameters\r\n*META\tVERSION\tMINVERSION\r\nMETA\t2\t1\r\n" +
                    "*GROUP\tID\tNAME\r\nGROUP\t1\tRevitGPT\r\n" +
                    "*PARAM\tGUID\tNAME\tDATATYPE\tDATACATEGORY\tGROUP\tVISIBLE\tDESCRIPTION\tUSERMODIFIABLE\r\n");
            }

            string previous = app.SharedParametersFilename;
            try
            {
                app.SharedParametersFilename = file;
                DefinitionFile definitions = app.OpenSharedParameterFile();
                if (definitions == null) throw new InvalidOperationException("Shared Parameters definition file unavailable.");
                DefinitionGroup group = definitions.Groups.get_Item("RevitGPT")
                    ?? definitions.Groups.Create("RevitGPT");
                foreach (Definition item in group.Definitions)
                {
                    var existing = item as ExternalDefinition;
                    if (existing != null && existing.GUID == DefinitionGuid) return existing;
                    if (item.Name == Name) throw new InvalidOperationException("Anchor definition name/GUID conflict.");
                }
                var options = new ExternalDefinitionCreationOptions(Name, SpecTypeId.String.Text);
                options.GUID = DefinitionGuid;
                return (ExternalDefinition)group.Definitions.Create(options);
            }
            finally
            {
                app.SharedParametersFilename = previous;
            }
        }

        // Small wrapper keeps the application's parameter-definition handling separate
        // from Document transactions. Never invoke from a read-only request.
        private sealed class ApplicationWrapper
        {
            internal readonly Document Document;
            internal ApplicationWrapper(Document doc) { Document = doc; }
        }

        public static string Execute(Document doc, JObject payload, bool initialize)
        {
            if (doc == null || doc.IsFamilyDocument)
                return Error(422, "A bound project document is required.");
            var existing = Existing(doc);
            var value = CurrentValue(existing);
            if (!initialize)
            {
                var conflicts = DuplicateOpenModels(doc, value);
                return Data(new { found = existing != null, model_id = value,
                    valid = ValidModelId(value) && conflicts.Length == 0,
                    duplicate_open_model_count = conflicts.Length,
                    duplicate_open_model_titles = conflicts,
                    parameter_name = Name, parameter_guid = DefinitionGuid.ToString(),
                    initialized = false });
            }

            if (existing != null && existing.StorageType != StorageType.String)
                return Error(409, "Existing anchor parameter has the wrong storage type.");
            if (!String.IsNullOrWhiteSpace(value))
            {
                if (!ValidModelId(value))
                    return Error(409, "Existing model anchor value is invalid; refusing overwrite.");
                var duplicates = DuplicateOpenModels(doc, value);
                if (duplicates.Length > 0)
                    return Error(409, "Another open RVT has the same persistent Model ID; resolve copied-model identity before continuing.");
                return Data(new { found = true, model_id = value, initialized = false,
                    parameter_guid = DefinitionGuid.ToString() });
            }

            if (doc.IsReadOnly || doc.IsModifiable)
                return Error(409, "Cannot initialize model anchor on a read-only or currently modified transaction document.");

            // Creating a shared parameter definition writes to RevitGPT's own
            // shared-parameter file; it does not change the user's configured file.
            ExternalDefinition definition;
            try { definition = GetOrCreateDefinition(new ApplicationWrapper(doc)); }
            catch (Exception ex) { return Error(422, "Unable to prepare anchor definition: " + ex.Message); }

            using (var transaction = new Transaction(doc, "Initialize RevitGPT Model ID"))
            {
                transaction.Start();
                try
                {
                    if (Existing(doc) == null)
                    {
                        CategorySet categories = doc.Application.Create.NewCategorySet();
                        categories.Insert(doc.Settings.Categories.get_Item(BuiltInCategory.OST_ProjectInformation));
                        Binding binding = doc.Application.Create.NewInstanceBinding(categories);
                        bool inserted = doc.ParameterBindings.Insert(definition, binding, GroupTypeId.Data);
                        if (!inserted)
                        {
                            transaction.RollBack();
                            return Error(409, "Project Information shared parameter binding failed or conflicts.");
                        }
                    }

                    Parameter parameter = Existing(doc);
                    if (parameter == null || parameter.IsReadOnly || parameter.StorageType != StorageType.String)
                    {
                        transaction.RollBack();
                        return Error(409, "Model ID parameter is unavailable or not writable.");
                    }
                    string id = CurrentValue(parameter);
                    if (String.IsNullOrWhiteSpace(id)) id = GenerateModelId(doc);
                    else if (!ValidModelId(id))
                    {
                        transaction.RollBack();
                        return Error(409, "Existing model ID is invalid; refusing overwrite.");
                    }
                    if (!parameter.Set(id))
                    {
                        transaction.RollBack();
                        return Error(409, "Unable to set Project Information Model ID.");
                    }
                    if (transaction.Commit() != TransactionStatus.Committed)
                        return Error(500, "Model ID transaction did not commit.");
                    return Data(new { found = true, model_id = id, initialized = true,
                        parameter_name = Name, parameter_guid = DefinitionGuid.ToString(),
                        requires_save = true });
                }
                catch
                {
                    if (transaction.GetStatus() == TransactionStatus.Started) transaction.RollBack();
                    throw;
                }
            }
        }
    }
}
