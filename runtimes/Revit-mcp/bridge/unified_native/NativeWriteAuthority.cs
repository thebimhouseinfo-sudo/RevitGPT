using System;
using Autodesk.Revit.DB;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Revit authoring is allowed on the current, explicitly bound document.
    // The router performs a fresh binding check before every request.
    public sealed class NativeWriteAuthority
    {
        public string PendingDescription => null;

        public bool ApproveFromNativePane(NativeModelBindingState.Snapshot snapshot)
        {
            return false;
        }

        public string DenialOrConsume(string route, JObject payload,
            NativeModelBindingState.Snapshot snapshot, Document doc)
        {
            if (snapshot == null || snapshot.Status != "BOUND_CURRENT" ||
                snapshot.ActiveId != snapshot.BoundId ||
                doc == null || doc.GetHashCode().ToString(
                    System.Globalization.CultureInfo.InvariantCulture) != snapshot.BoundId)
                return "MODEL_BINDING_NOT_CURRENT";
            return null;
        }

        public void Clear() { }
    }
}
