using System;

namespace RevitGPT.Native
{
    // A dockable pane cannot reliably be shown in Revit's zero-document Home.
    // Wait indefinitely for the first project, then retry at a bounded pace.
    public sealed class NativePaneStartupPolicy
    {
        public bool Pending { get; private set; } = true;
        public int Attempts { get; private set; }
        public const int MaximumAttempts = 8;
        private DateTimeOffset _next = DateTimeOffset.MinValue;

        public bool ShouldAttempt(bool activeProject, DateTimeOffset now)
        {
            return Pending && activeProject && Attempts < MaximumAttempts && now >= _next;
        }

        public void ReportAttempt(DateTimeOffset now)
        {
            if (!ShouldAttempt(true, now))
                throw new InvalidOperationException("Startup pane show attempt not allowed.");
            Attempts++;
            _next = now.AddSeconds(3);
        }

        public void ReportShown() { Pending = false; }
    }
}
