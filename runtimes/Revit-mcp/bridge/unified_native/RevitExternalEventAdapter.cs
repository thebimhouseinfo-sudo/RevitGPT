using System;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.UI;

namespace RevitGPT.Native
{
    // Construct only while Revit is in an API context. HTTP workers never
    // touch UIApplication or any Document/Element object directly.
    public sealed class RevitExternalEventAdapter : IDisposable
    {
        private sealed class UiCallback : IExternalEventHandler
        {
            private BridgeDispatchQueue _queue;
            private UIApplication _app;
            private int _thread;
            internal void Bind(BridgeDispatchQueue queue) { _queue = queue; }
            public string GetName() { return "RevitGPT UI event dispatcher"; }
            public void Execute(UIApplication app)
            {
                if (_queue == null) return;
                _app = app;
                _thread = Thread.CurrentThread.ManagedThreadId;
                try { _queue.DrainOnRevitUiThread(); }
                finally { _app = null; _thread = 0; }
            }
            internal UIApplication RequireUiApp()
            {
                if (_app == null || _thread != Thread.CurrentThread.ManagedThreadId)
                    throw new InvalidOperationException("Revit API outside ExternalEvent.Execute.");
                return _app;
            }
        }

        private readonly UiCallback _callback;
        private readonly ExternalEvent _event;
        private readonly BridgeDispatchQueue _queue;

        private RevitExternalEventAdapter(UiCallback callback, ExternalEvent ev, BridgeDispatchQueue queue)
        { _callback = callback; _event = ev; _queue = queue; }

        public static RevitExternalEventAdapter CreateOnRevitUiThread(int capacity = 256)
        {
            var callback = new UiCallback();
            var ev = ExternalEvent.Create(callback);
            if (ev == null) throw new InvalidOperationException("ExternalEvent.Create returned null.");
            try
            {
                var queue = new BridgeDispatchQueue(() => Map(ev.Raise()), capacity);
                callback.Bind(queue);
                return new RevitExternalEventAdapter(callback, ev, queue);
            }
            catch { ev.Dispose(); throw; }
        }

        public Task<string> Submit(string id, Func<UIApplication, string> action,
            CancellationToken cancellation = default(CancellationToken))
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            return _queue.Submit(id, () => action(_callback.RequireUiApp()), cancellation);
        }

        private static RaiseOutcome Map(ExternalEventRequest outcome)
        {
            if (outcome == ExternalEventRequest.Accepted) return RaiseOutcome.Accepted;
            if (outcome == ExternalEventRequest.Pending) return RaiseOutcome.Pending;
            if (outcome == ExternalEventRequest.Denied) return RaiseOutcome.Denied;
            if (outcome == ExternalEventRequest.TimedOut) return RaiseOutcome.TimedOut;
            return RaiseOutcome.Denied;
        }

        public void Dispose()
        {
            _queue.Dispose();
            _event.Dispose();
        }
    }
}
