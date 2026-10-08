using System;
using System.Threading;
using System.Threading.Tasks;

namespace RevitGPT.Native
{
    public sealed class BridgeHttpResponse
    {
        public int StatusCode { get; }
        public string Body { get; }
        public BridgeHttpResponse(int statusCode, string body)
        {
            StatusCode = statusCode;
            Body = body;
        }
    }

    // HTTP protocol validation/response handling has no Revit dependency.
    // The injected dispatcher must enqueue into RevitExternalEventAdapter.
    public sealed class BridgeHttpProtocol
    {
        private readonly Func<string, string, string, string, CancellationToken, Task<string>> _dispatch;
        private readonly TimeSpan _readTimeout;
        private readonly TimeSpan _writeTimeout;
        public const int MaximumBodyBytes = 1024 * 1024;

        public BridgeHttpProtocol(
            Func<string, string, string, string, CancellationToken, Task<string>> dispatch,
            TimeSpan? readTimeout = null,
            TimeSpan? writeTimeout = null)
        {
            _dispatch = dispatch ?? throw new ArgumentNullException(nameof(dispatch));
            _readTimeout = readTimeout ?? TimeSpan.FromMilliseconds(2500);
            _writeTimeout = writeTimeout ?? TimeSpan.FromSeconds(25);
            if (_readTimeout <= TimeSpan.Zero || _writeTimeout <= TimeSpan.Zero)
                throw new ArgumentOutOfRangeException(nameof(readTimeout));
        }

        public static bool IsWrite(string path)
        {
            return path == "/place" || path == "/create/duct" || path == "/create/pipe" ||
                   path == "/parameter/set" || path == "/delete" || path == "/move" ||
                   path.StartsWith("/annotation/", StringComparison.Ordinal);
        }

        public async Task<BridgeHttpResponse> ProcessAsync(
            string method, string path, string host, string origin,
            string contentType, string requestId, string body,
            CancellationToken stopping = default(CancellationToken))
        {
            if (String.IsNullOrWhiteSpace(host) || !host.Equals("127.0.0.1:8765", StringComparison.Ordinal))
                return Error(403, "Invalid local Host header.");
            // No browser-origin API access. Python MCP does not send Origin.
            if (!String.IsNullOrEmpty(origin))
                return Error(403, "Browser-origin requests are not permitted.");
            if (method != "GET" && method != "POST")
                return Error(405, "Method not allowed.");
            if (!BridgeRouteContract.Supports(method, path))
                return Error(BridgeRouteContract.KnownPath(path) ? 405 : 404,
                    "Unsupported route or method.");
            if (String.IsNullOrWhiteSpace(requestId) || requestId.Length > 128)
                return Error(400, "X-Request-ID header required.");
            foreach (char ch in requestId)
                if (!(Char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' || ch == '.'))
                    return Error(400, "Invalid request ID.");
            if (method == "POST" &&
                (String.IsNullOrEmpty(contentType) ||
                 !contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase)))
                return Error(415, "POST requires application/json.");
            if (body != null && System.Text.Encoding.UTF8.GetByteCount(body) > MaximumBodyBytes)
                return Error(413, "Request body too large.");
            if (stopping.IsCancellationRequested)
                return Error(503, "Bridge shutting down.");

            // The timeout cancels a PENDING queue item; once an API operation
            // starts, cancellation cannot roll back a Revit transaction.
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopping))
            {
                Task<string> dispatched;
                try { dispatched = _dispatch(requestId, method, path, body ?? "", timeout.Token); }
                catch (ObjectDisposedException) { return Error(503, "Bridge shutting down."); }
                catch (InvalidOperationException ex) { return Error(429, ex.Message); }
                catch (Exception) { return Error(500, "Dispatch initialization failed."); }

                if (dispatched == null) return Error(500, "Dispatch returned no task.");
                var delay = Task.Delay(IsWrite(path) ? _writeTimeout : _readTimeout);
                var completed = await Task.WhenAny(dispatched, delay).ConfigureAwait(false);
                if (completed != dispatched)
                {
                    timeout.Cancel();
                    // A mutation might have begun; explicitly report ambiguity.
                    _ = dispatched.ContinueWith(t => { var ignored = t.Exception; },
                        CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted,
                        TaskScheduler.Default);
                    return Error(504, IsWrite(path)
                        ? "Revit write timed out; outcome unknown; do not retry automatically."
                        : "Revit read timed out.");
                }
                try
                {
                    string result = await dispatched.ConfigureAwait(false);
                    if (String.IsNullOrWhiteSpace(result))
                        return Error(502, "Empty Revit API response.");
                    return new BridgeHttpResponse(200, result);
                }
                catch (OperationCanceledException)
                {
                    return Error(503, "Request canceled before API execution.");
                }
                catch (ObjectDisposedException)
                {
                    return Error(503, "Bridge shutting down.");
                }
                catch (InvalidOperationException ex)
                {
                    return Error(503, ex.Message);
                }
                catch (Exception)
                {
                    return Error(500, "Revit API execution failed.");
                }
            }
        }

        private static BridgeHttpResponse Error(int status, string message)
        {
            return new BridgeHttpResponse(status, "{\"error\":{\"code\":" + status +
                ",\"message\":\"" + Escape(message) + "\"}}");
        }

        private static string Escape(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"")
                .Replace("\r", "\\r").Replace("\n", "\\n");
        }
    }
}
