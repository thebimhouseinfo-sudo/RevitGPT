using System;
using System.Diagnostics;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;

namespace RevitGPT.Native
{
    // Preview host, NOT installable until API route parity and host QA pass.
    // OnStartup only attaches to Idling; does not wait for ExternalEvent work.
    public sealed class RevitGptApplication : IExternalApplication
    {
        private UIControlledApplication _application;
        private RevitExternalEventAdapter _dispatcher;
        private BridgeHttpServer _server;
        // Refresh requests are consumed only in Revit's Idling API context.
        private readonly BridgeRetryState _retry = new BridgeRetryState();

        public Result OnStartup(UIControlledApplication app)
        {
            _application = app;
            try
            {
                // WPF pane lifetime never owns or blocks the native listener.
                app.RegisterDockablePane(RevitGptPaneProvider.PaneId, "RevitGPT",
                    new RevitGptPaneProvider(_retry.Request));
            }
            catch (Exception error)
            {
                Debug.WriteLine("[RevitGPT] Pane unavailable: " + error);
            }
            app.Idling += OnFirstIdle;
            return Result.Succeeded;
        }

        private void OnFirstIdle(object sender, IdlingEventArgs args)
        {
            var uiapp = sender as UIApplication;
            if (uiapp == null || !_retry.TryConsume()) return;
            // A healthy listener must never be replaced by a panel click.
            if (_server != null && _server.IsRunning) return;
            // A stopped/failed listener must release its old dispatcher first.
            DisposeBridge();
            try
            {
                // Both handler construction and ExternalEvent.Create occur in
                // a valid Revit callback, never on the HTTP listener thread.
                _dispatcher = RevitExternalEventAdapter.CreateOnRevitUiThread();
                var protocol = new BridgeHttpProtocol(
                    (id, method, path, body, cancellation) =>
                        _dispatcher.Submit(id,
                            ui => RevitApiRouter.Execute(ui, method, path, body),
                            cancellation));
                _server = new BridgeHttpServer(protocol);
                _server.Start();
                Debug.WriteLine("[RevitGPT] Native bridge listener initialized.");
            }
            catch (Exception error)
            {
                // Do NOT kill other port owners, block Revit, or start the
                // retired standalone/pyRevit bridge as a workaround.
                Debug.WriteLine("[RevitGPT] Native bridge unavailable: " + error);
                DisposeBridge();
            }
        }

        private void DisposeBridge()
        {
            try { _server?.Dispose(); } catch { }
            _server = null;
            try { _dispatcher?.Dispose(); } catch { }
            _dispatcher = null;
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            if (_application != null)
                _application.Idling -= OnFirstIdle;
            // Shutdown is never a synchronous wait on a pending UI request.
            DisposeBridge();
            _application = null;
            return Result.Succeeded;
        }
    }
}
