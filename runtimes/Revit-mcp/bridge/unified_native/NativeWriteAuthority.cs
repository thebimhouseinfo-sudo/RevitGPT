using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Native WPF confirmation is the sole origin of WRITE authority.
    // A remote request can only STAGE an intent. It cannot approve itself.
    // Grants apply once to one exact path+JSON payload+host+binding revision.
    public sealed class NativeWriteAuthority
    {
        private sealed class Intent
        {
            public string HostId;
            public long BindingRevision;
            public string DocumentId;
            public string DocumentTitle;
            public string Route;
            public string Digest;
            public string Preview;
            public DateTimeOffset ExpiresUtc;
            public bool Approved;
        }

        private readonly object _gate = new object();
        private Intent _pending;
        private readonly TimeSpan _ttl = TimeSpan.FromMinutes(3);

        // Test writes require an explicitly opted-in local, non-workshared RVT.
        // The fixture directory remains available for compatibility. Other RVTs
        // require an exact absolute path in a local user-managed allowlist.
        private static bool IsDisposableFixture(Document doc)
        {
            if (doc == null || doc.IsLinked || doc.IsFamilyDocument ||
                doc.IsWorkshared || String.IsNullOrWhiteSpace(doc.PathName))
                return false;
            try
            {
                string candidate = Path.GetFullPath(doc.PathName);
                if (!File.Exists(candidate) ||
                    candidate.StartsWith(@"\\", StringComparison.Ordinal) ||
                    !String.Equals(Path.GetExtension(candidate), ".rvt",
                        StringComparison.OrdinalIgnoreCase))
                    return false;
                // Refuse path indirection, including a symlink on any parent.
                string segment = candidate;
                while (!String.IsNullOrEmpty(segment))
                {
                    if ((File.GetAttributes(segment) & FileAttributes.ReparsePoint) != 0)
                        return false;
                    string parent = Path.GetDirectoryName(segment);
                    if (String.Equals(parent, segment, StringComparison.Ordinal)) break;
                    segment = parent;
                }
                string appRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RevitGPT");
                string fixtures = Path.GetFullPath(Path.Combine(appRoot, "fixtures")) +
                    Path.DirectorySeparatorChar;
                if (candidate.StartsWith(fixtures, StringComparison.OrdinalIgnoreCase))
                    return true;
                string allowlist = Path.Combine(appRoot, "config", "write-test-models.txt");
                if (!File.Exists(allowlist) ||
                    (File.GetAttributes(allowlist) & FileAttributes.ReparsePoint) != 0)
                    return false;
                return File.ReadAllLines(allowlist)
                    .Where(line => !String.IsNullOrWhiteSpace(line) &&
                        !line.TrimStart().StartsWith("#", StringComparison.Ordinal))
                    .Any(line => String.Equals(line.Trim(), candidate,
                        StringComparison.OrdinalIgnoreCase));
            }
            catch { return false; }
        }

        private static JToken Canonical(JToken token)
        {
            if (token is JObject obj)
            {
                var next = new JObject();
                foreach (var property in obj.Properties().OrderBy(x => x.Name, StringComparer.Ordinal))
                    next.Add(property.Name, Canonical(property.Value));
                return next;
            }
            if (token is JArray arr)
                return new JArray(arr.Select(Canonical));
            return token.DeepClone();
        }

        private static string ComputeDigest(string route, JObject payload,
            NativeModelBindingState.Snapshot snapshot)
        {
            string content = snapshot.HostInstanceId + "\n" +
                snapshot.Revision.ToString(CultureInfo.InvariantCulture) + "\n" +
                snapshot.BoundId + "\n" + route + "\n" +
                Canonical(payload).ToString(Formatting.None);
            using (var sha = SHA256.Create())
            {
                byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(content));
                return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
            }
        }

        private static string PreviewPayload(JObject payload)
        {
            var keys = new[] { "action", "element_id", "element_ids", "parameter",
                "family", "type", "view_id", "x", "y", "z", "dx", "dy", "dz",
                "new_type_id", "confirm", "text", "value" };
            var fields = keys.Where(key => payload[key] != null)
                .Select(key => {
                    JToken token = payload[key];
                    string display = token is JArray array
                        ? array.Count.ToString(CultureInfo.InvariantCulture) + " item(s)"
                        : token.ToString(Formatting.None);
                    display = display.Replace("\r", " ").Replace("\n", " ");
                    if (display.Length > 60) display = display.Substring(0, 60) + "...";
                    return key + "=" + display;
                });
            string combined = String.Join("; ", fields);
            return combined.Length > 240 ? combined.Substring(0, 240) + "..." : combined;
        }

        public string PendingDescription
        {
            get
            {
                lock (_gate)
                {
                    if (_pending == null || _pending.ExpiresUtc < DateTimeOffset.UtcNow)
                    {
                        _pending = null;
                        return null;
                    }
                    return _pending.Route + " | " + _pending.DocumentTitle +
                        " | " + _pending.Preview + " | " + _pending.Digest.Substring(0, 12);
                }
            }
        }

        public bool ApproveFromNativePane(NativeModelBindingState.Snapshot snapshot)
        {
            lock (_gate)
            {
                if (_pending == null || _pending.ExpiresUtc <= DateTimeOffset.UtcNow)
                {
                    _pending = null;
                    return false;
                }
                if (snapshot == null || snapshot.Status != "BOUND_CURRENT" ||
                    snapshot.HostInstanceId != _pending.HostId ||
                    snapshot.Revision != _pending.BindingRevision ||
                    snapshot.BoundId != _pending.DocumentId)
                {
                    _pending = null;
                    return false;
                }
                _pending.Approved = true;
                return true;
            }
        }

        // Returns null only when a preexisting UI-approved, exact, one-shot
        // intent was atomically consumed. Caller must never retry automatically.
        public string DenialOrConsume(string route, JObject payload,
            NativeModelBindingState.Snapshot snapshot, Document doc)
        {
            if (snapshot == null || snapshot.Status != "BOUND_CURRENT" ||
                snapshot.ActiveId != snapshot.BoundId)
                return "MODEL_BINDING_NOT_CURRENT";
            if (!IsDisposableFixture(doc))
                return "WRITE_TEST_MODEL_NOT_ALLOWED: Use a disposable RVT under LocalAppData/RevitGPT/fixtures or explicitly allowlist its exact local path.";
            string digest = ComputeDigest(route, payload, snapshot);
            lock (_gate)
            {
                if (_pending != null && _pending.ExpiresUtc > DateTimeOffset.UtcNow &&
                    _pending.HostId == snapshot.HostInstanceId &&
                    _pending.BindingRevision == snapshot.Revision &&
                    _pending.DocumentId == snapshot.BoundId &&
                    _pending.Route == route && _pending.Digest == digest)
                {
                    if (_pending.Approved)
                    {
                        _pending = null; // consume BEFORE Revit API execution
                        return null;
                    }
                    return "WRITE_APPROVAL_PENDING: Approve exact operation in the RevitGPT pane.";
                }
                _pending = new Intent {
                    HostId = snapshot.HostInstanceId,
                    BindingRevision = snapshot.Revision,
                    DocumentId = snapshot.BoundId,
                    DocumentTitle = doc.Title,
                    Route = route,
                    Digest = digest,
                    Preview = PreviewPayload(payload),
                    Approved = false,
                    ExpiresUtc = DateTimeOffset.UtcNow + _ttl
                };
                return "WRITE_APPROVAL_PENDING: Approve exact operation in the RevitGPT pane.";
            }
        }

        public void Clear()
        {
            lock (_gate) _pending = null;
        }
    }
}
