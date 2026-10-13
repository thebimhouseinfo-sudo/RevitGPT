using System;

namespace RevitGPT.Native
{
    // Strictly passive between Idling callbacks: no threads, timers, network
    // probes or Revit API calls. A failed native listener gets an eventual
    // retry, bounded to avoid excessive attempts during port conflicts.
    public sealed class NativeBridgeRecoveryPolicy
    {
        private DateTimeOffset _nextRetryUtc = DateTimeOffset.MinValue;
        private int _failures;

        public bool ShouldRetry(DateTimeOffset now) => now >= _nextRetryUtc;

        public void ReportAttempt(DateTimeOffset now)
        {
            // 2, 4, 8, 16, 32, then 60 seconds maximum.
            int seconds = _failures >= 5 ? 60 : 1 << Math.Min(_failures + 1, 5);
            _nextRetryUtc = now.AddSeconds(seconds);
            if (_failures < 6) ++_failures;
        }

        public void ReportHealthy()
        {
            _failures = 0;
            _nextRetryUtc = DateTimeOffset.MinValue;
        }
    }
}
