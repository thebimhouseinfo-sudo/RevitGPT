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
            public DateTimeOffset ExpiresUtc;
            public bool Approved;
        }

        private readonly object _gate = new object();
        private Intent _pending;
        private readonly TimeSpan _ttl = TimeSpan.FromMinutes(3);

        // Compile-only development gate. MUTATIONS ARE NEVER PERMITTED outside
        // %LOCALAPPDATA%/RevitGPT/fixtures before final Human acceptance.
        private static bool IsDisposableFixture(Document doc)
        {
            if (doc == null || doc.IsLinked || doc.IsFamilyDocument ||
                doc.IsWorkshared || String.IsNullOrWhiteSpace(doc.PathName))
                return false;
            try
            {
                string root = Path.GetFullPath(Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RevitGPT", "fixtures")) + Path.DirectorySeparatorChar;
                string candidate = Path.GetFullPath(doc.PathName);
                return candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase);
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
                        " | " + _pending.Digest.Substring(0, 12);
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
                return "WRITE_DEV_FIXTURE_ONLY: Save a disposable RVT under LocalAppData/RevitGPT/fixtures.";
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
