using System;

namespace RevitGPT.Native
{
    // Pure wire-contract builder used by the real router, testable without Revit.
    public static class NativeDocumentContract
    {
        public static object Create(string runtimeId, string title, string path,
            bool isWorkshared, string revitVersion)
        {
            if (String.IsNullOrWhiteSpace(runtimeId))
                throw new ArgumentException("Document runtime ID cannot be blank.", nameof(runtimeId));
            return new
            {
                id = runtimeId,
                runtime_id = runtimeId,
                title = title ?? "",
                path = path ?? "",
                is_workshared = isWorkshared,
                revit_version = revitVersion ?? ""
            };
        }
    }
}
