using System;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitGPT.Native
{
    // Token never enters WebView2, external logging, or a Revit element.
    public sealed class NativePanelSession
    {
        private readonly object _gate = new object();
        private string _token;

        public bool IsPaired { get { lock (_gate) return !String.IsNullOrEmpty(_token); } }
        public string Token { get { lock (_gate) return _token; } }

        public void SetToken(string token)
        {
            if (String.IsNullOrEmpty(token) || !Regex.IsMatch(token, "^[0-9a-f]{64}$"))
                throw new ArgumentException("Invalid panel session token.", nameof(token));
            lock (_gate) _token = token;
        }

        public void Clear() { lock (_gate) _token = null; }
    }

    // Ordinary asynchronous localhost HTTP; never touches Revit API and never
    // awaits synchronously. The server validates loopback, Origin and tokens.
    public static class NativePanelPairingClient
    {
        private static readonly HttpClient Client = new HttpClient {
            Timeout = TimeSpan.FromSeconds(7)
        };
        private const string BaseUrl = "http://127.0.0.1:3300";

        private static async Task<JObject> PostAsync(string path, object body)
        {
            using (var request = new StringContent(
                JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json"))
            using (var response = await Client.PostAsync(BaseUrl + path, request))
            {
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException(
                        "Local RevitGPT control plane rejected request: HTTP " +
                        (int)response.StatusCode);
                var json = JObject.Parse(await response.Content.ReadAsStringAsync());
                return json;
            }
        }

        public static async Task<string> PairAsync(string code)
        {
            string normalized = (code ?? "").Trim().ToUpperInvariant();
            if (!Regex.IsMatch(normalized, "^[0-9A-F]{32}$"))
                throw new ArgumentException("Enter a valid 32-character pairing code.");
            var data = await PostAsync("/panel/pair", new { code = normalized });
            string token = data.Value<string>("token");
            if (String.IsNullOrEmpty(token) || !Regex.IsMatch(token, "^[0-9a-f]{64}$"))
                throw new InvalidOperationException("Local RevitGPT returned an invalid panel session.");
            return token;
        }

        public static async Task LeaseAsync(string token, NativeModelBindingState.Snapshot snapshot)
        {
            if (snapshot == null || snapshot.Status != "BOUND_CURRENT")
                throw new InvalidOperationException("Cannot lease an inactive bound model.");
            var data = await PostAsync("/panel/lease", new {
                token,
                binding = new {
                    host_instance_id = snapshot.HostInstanceId,
                    revision = snapshot.Revision,
                    bound_id = snapshot.BoundId
                }
            });
            if (data.Value<string>("status") != "LEASED_READ_ONLY")
                throw new InvalidOperationException("RevitGPT did not confirm read-only lease.");
        }
    }
}
