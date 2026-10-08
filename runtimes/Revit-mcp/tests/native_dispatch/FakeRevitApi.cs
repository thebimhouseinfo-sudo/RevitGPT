using System;
namespace Autodesk.Revit.UI
{
    // TEST-ONLY fake. Never compile into a production add-in.
    public class UIApplication { public string ModelName { get; set; } }
    public enum ExternalEventRequest { Accepted, Pending, Denied, TimedOut }
    public interface IExternalEventHandler
    {
        void Execute(UIApplication app);
        string GetName();
    }
    public sealed class ExternalEvent : IDisposable
    {
        public static ExternalEvent Last;
        private readonly IExternalEventHandler _handler;
        public ExternalEventRequest Response = ExternalEventRequest.Accepted;
        public int RaiseCount;
        private ExternalEvent(IExternalEventHandler handler) { _handler = handler; }
        public static ExternalEvent Create(IExternalEventHandler handler)
        {
            Last = new ExternalEvent(handler);
            return Last;
        }
        public ExternalEventRequest Raise() { RaiseCount++; return Response; }
        public void Dispatch(UIApplication app) { _handler.Execute(app); }
        public void Dispose() { }
    }
}
