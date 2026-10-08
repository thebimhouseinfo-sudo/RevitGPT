using System;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
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
        private readonly NativeBridgeRecoveryPolicy _recovery = new NativeBridgeRecoveryPolicy();
        private readonly NativeModelBindingState _binding = new NativeModelBindingState();
        private readonly NativePanelSession _panelSession = new NativePanelSession();

        public Result OnStartup(UIControlledApplication app)
        {
            _application = app;
            try
            {
                // WPF pane lifetime never owns or blocks the native listener.
                app.RegisterDockablePane(RevitGptPaneProvider.PaneId, "RevitGPT",
                    new RevitGptPaneProvider(_retry.Request, _binding, _panelSession));
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
            if (uiapp == null) return;
            try
            {
                // Only this Revit callback can access the Revit API.
                var active = uiapp.ActiveUIDocument?.Document;
                var openIds = uiapp.Application.Documents.Cast<Document>()
                    .Select(d => d.GetHashCode().ToString(CultureInfo.InvariantCulture));
                _binding.Observe(
                    active?.GetHashCode().ToString(CultureInfo.InvariantCulture),
                    active?.Title, openIds);
                _binding.ConsumePendingBind();
            }
            catch (Exception error)
            {
                Debug.WriteLine("[RevitGPT] Binding observation failed: " + error);
                _binding.Observe(null, null, new string[0]);
            }
            var manualRetry = _retry.TryConsume();
            // A healthy listener must never be replaced by a panel click.
            if (_server != null && _server.IsRunning)
            {
                _recovery.ReportHealthy();
                return;
            }
            // A listener which died (including after a Windows sleep/wake)
            // may be retried from Idling without network polling or freezing UI.
            var now = DateTimeOffset.UtcNow;
            if (!manualRetry && !_recovery.ShouldRetry(now)) return;
            _recovery.ReportAttempt(now);
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
                            ui => RevitApiRouter.Execute(ui, method, path, body, _binding),
                            cancellation));
                _server = new BridgeHttpServer(protocol);
                _server.Start();
                _recovery.ReportHealthy();
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
            _binding.ClearOnShutdown();
            _panelSession.Clear();
            _application = null;
            return Result.Succeeded;
        }
    }
}
