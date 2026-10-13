using System.Threading;

namespace RevitGPT.Native
{
    // Thread-safe request flag: only a Revit Idling callback consumes it.
    // Startup gets one automatic attempt; subsequent failures need Refresh.
    public sealed class BridgeRetryState
    {
        private int _requested = 1;

        public void Request() => Interlocked.Exchange(ref _requested, 1);

        public bool TryConsume() => Interlocked.Exchange(ref _requested, 0) == 1;
    }
}
