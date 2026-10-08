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
        private bool _attempted;

        public Result OnStartup(UIControlledApplication app)
        {
            _application = app;
            _attempted = false;
            app.Idling += OnFirstIdle;
            return Result.Succeeded;
        }

        private void OnFirstIdle(object sender, IdlingEventArgs args)
        {
            if (_attempted) return;
            var uiapp = sender as UIApplication;
            if (uiapp == null) return; // Wait for a real Revit API context.
            _attempted = true;
            _application.Idling -= OnFirstIdle;
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
                try { _server?.Dispose(); } catch { }
                _server = null;
                try { _dispatcher?.Dispose(); } catch { }
                _dispatcher = null;
            }
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            if (_application != null)
                _application.Idling -= OnFirstIdle;
            // Shutdown is never a synchronous wait on a pending UI request.
            try { _server?.Dispose(); } catch { }
            try { _dispatcher?.Dispose(); } catch { }
            _server = null;
            _dispatcher = null;
            _application = null;
            return Result.Succeeded;
        }
    }
}
