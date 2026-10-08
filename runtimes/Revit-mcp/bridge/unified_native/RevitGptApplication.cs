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
        // Revit remembers whether a pane was hidden in its previous session.
        // VisibleByDefault only applies on first registration. Explicitly
        // show once at startup; never force it back after user closes it.
        private bool _paneRegistered;
        private bool _initialPaneShowPending;
        private int _initialPaneShowAttempts;

        public Result OnStartup(UIControlledApplication app)
        {
            _application = app;
            try
            {
                // WPF pane lifetime never owns or blocks the native listener.
                app.RegisterDockablePane(RevitGptPaneProvider.PaneId, "RevitGPT",
                    new RevitGptPaneProvider(_binding));
                _paneRegistered = true;
                _initialPaneShowPending = true;
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
            TryShowInitialPane(uiapp);
            try
            {
                // Only this Revit callback can access the Revit API.
                var active = uiapp.ActiveUIDocument?.Document;
                var openIds = uiapp.Application.Documents.Cast<Document>()
                    .Where(d => !d.IsLinked && !d.IsFamilyDocument)
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

        private void TryShowInitialPane(UIApplication uiapp)
        {
            if (!_paneRegistered || !_initialPaneShowPending) return;
            // Called from a real Revit UI callback, not from OnStartup,
            // WPF, WebView2, an HTTP listener, or a background thread.
            ++_initialPaneShowAttempts;
            try
            {
                var pane = uiapp.GetDockablePane(RevitGptPaneProvider.PaneId);
                if (!pane.IsShown()) pane.Show();
                // Stop retrying after success. A manual hide must STAY hidden.
                if (pane.IsShown())
                {
                    _initialPaneShowPending = false;
                    Debug.WriteLine("[RevitGPT] Dockable panel visible on startup.");
                    return;
                }
                Debug.WriteLine("[RevitGPT] Dockable panel was not visible after Show.");
            }
            catch (Exception error)
            {
                // A temporarily unavailable UI may recover on another Idling
                // tick; permanent registration errors must not retry forever.
                Debug.WriteLine("[RevitGPT] Startup pane Show failed: " + error);
            }
            if (_initialPaneShowAttempts >= 3)
            {
                _initialPaneShowPending = false;
                Debug.WriteLine("[RevitGPT] Startup pane Show retries exhausted.");
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
            _initialPaneShowPending = false;
            _paneRegistered = false;
            _application = null;
            return Result.Succeeded;
        }
    }
}
