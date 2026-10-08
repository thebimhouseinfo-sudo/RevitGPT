using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace RevitGPT.Native
{
    // Loopback-only HTTP server. No Revit API code may appear here.
    public sealed class BridgeHttpServer : IDisposable
    {
        private readonly BridgeHttpProtocol _protocol;
        private readonly HttpListener _listener = new HttpListener();
        private readonly CancellationTokenSource _stop = new CancellationTokenSource();
        private int _running;
        private int _disposed;

        public BridgeHttpServer(BridgeHttpProtocol protocol)
        {
            _protocol = protocol ?? throw new ArgumentNullException(nameof(protocol));
            _listener.Prefixes.Add("http://127.0.0.1:8765/");
        }

        public bool IsRunning => Volatile.Read(ref _running) == 1;

        public void Start()
        {
            if (Volatile.Read(ref _disposed) != 0) throw new ObjectDisposedException(nameof(BridgeHttpServer));
            if (Interlocked.CompareExchange(ref _running, 1, 0) != 0) return;
            try
            {
                // Fails closed if another process owns this port; no attempt
                // to terminate/reconfigure a competing process.
                _listener.Start();
                _ = Task.Run(ListenLoopAsync);
            }
            catch
            {
                Interlocked.Exchange(ref _running, 0);
                try { _listener.Close(); } catch { }
                throw;
            }
        }

        private async Task ListenLoopAsync()
        {
            while (IsRunning && !_stop.IsCancellationRequested)
            {
                HttpListenerContext context;
                try { context = await _listener.GetContextAsync().ConfigureAwait(false); }
                catch (HttpListenerException) { break; }
                catch (ObjectDisposedException) { break; }
                _ = Task.Run(() => HandleAsync(context));
            }
        }

        private async Task HandleAsync(HttpListenerContext context)
        {
            BridgeHttpResponse output;
            try
            {
                var request = context.Request;
                // Enforce body limit before buffering, including chunked body.
                string body = "";
                if (request.HasEntityBody)
                {
                    if (request.ContentLength64 > BridgeHttpProtocol.MaximumBodyBytes)
                    {
                        output = new BridgeHttpResponse(413,
                            "{\"error\":{\"code\":413,\"message\":\"Request body too large.\"}}");
                        await WriteAsync(context, output).ConfigureAwait(false);
                        return;
                    }
                    using (var buffer = new MemoryStream())
                    {
                        var chunk = new byte[16384];
                        int count;
                        while ((count = await request.InputStream.ReadAsync(
                            chunk, 0, chunk.Length, _stop.Token).ConfigureAwait(false)) > 0)
                        {
                            if (buffer.Length + count > BridgeHttpProtocol.MaximumBodyBytes)
                            {
                                output = new BridgeHttpResponse(413,
                                    "{\"error\":{\"code\":413,\"message\":\"Request body too large.\"}}");
                                await WriteAsync(context, output).ConfigureAwait(false);
                                return;
                            }
                            buffer.Write(chunk, 0, count);
                        }
                        body = new UTF8Encoding(false, true).GetString(buffer.ToArray());
                    }
                }
                output = await _protocol.ProcessAsync(
                    request.HttpMethod, request.Url.AbsolutePath,
                    request.Headers["Host"], request.Headers["Origin"],
                    request.ContentType, request.Headers["X-Request-ID"],
                    body, _stop.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                output = new BridgeHttpResponse(503,
                    "{\"error\":{\"code\":503,\"message\":\"Bridge stopping.\"}}");
            }
            catch (DecoderFallbackException)
            {
                output = new BridgeHttpResponse(400,
                    "{\"error\":{\"code\":400,\"message\":\"Invalid UTF-8 body.\"}}");
            }
            catch (Exception)
            {
                output = new BridgeHttpResponse(500,
                    "{\"error\":{\"code\":500,\"message\":\"HTTP request failed.\"}}");
            }
            await WriteAsync(context, output).ConfigureAwait(false);
        }

        private static async Task WriteAsync(HttpListenerContext context, BridgeHttpResponse result)
        {
            try
            {
                var response = context.Response;
                byte[] bytes = Encoding.UTF8.GetBytes(result.Body);
                response.StatusCode = result.StatusCode;
                response.ContentType = "application/json; charset=utf-8";
                response.Headers["Cache-Control"] = "no-store";
                response.ContentLength64 = bytes.Length;
                await response.OutputStream.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
                response.OutputStream.Close();
            }
            catch (Exception) { /* Client departed while waiting for Revit. */ }
        }

        public void Stop()
        {
            if (Interlocked.Exchange(ref _running, 0) == 0) return;
            _stop.Cancel();
            try { _listener.Stop(); } catch { }
            try { _listener.Close(); } catch { }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            Stop();
            _stop.Dispose();
        }
    }
}
