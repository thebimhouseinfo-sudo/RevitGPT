using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace RevitGPT.Native
{
    // Pure .NET core, deliberately independent of Revit DLLs so concurrency
    // failures can be exercised in CI without launching Revit.
    public enum RaiseOutcome { Accepted, Pending, Denied, TimedOut }

    public sealed class BridgeDispatchQueue : IDisposable
    {
        private sealed class WorkItem
        {
            private readonly object _gate = new object();
            private readonly TaskCompletionSource<string> _source =
                new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            private int _state; // 0=pending, 1=executing, 2=terminal
            private string _terminalPhase;
            private CancellationTokenRegistration _registration;

            internal string Phase
            {
                get
                {
                    lock (_gate)
                        return _state == 0 ? "PENDING" :
                            _state == 1 ? "EXECUTING" : (_terminalPhase ?? "UNKNOWN");
                }
            }
            internal bool IsTerminal
            {
                get { lock (_gate) return _state == 2; }
            }

            internal WorkItem(string id, Func<string> action)
            {
                Id = id;
                Action = action;
            }

            internal string Id { get; }
            internal Func<string> Action { get; }
            internal Task<string> Result => _source.Task;

            internal void RegisterCancellation(CancellationToken token)
            {
                if (!token.CanBeCanceled) return;
                var registration = token.Register(() => CancelPending());
                bool dispose = false;
                lock (_gate)
                {
                    if (_state != 2) _registration = registration;
                    else dispose = true;
                }
                // Never Dispose an in-flight CancellationTokenRegistration
                // while holding a lock that its callback needs.
                if (dispose) registration.Dispose();
            }

            internal bool Begin()
            {
                lock (_gate)
                {
                    if (_state != 0) return false;
                    _state = 1;
                    return true;
                }
            }

            internal void Complete(string value, Exception error)
            {
                CancellationTokenRegistration registration;
                lock (_gate)
                {
                    if (_state != 1) return;
                    _state = 2;
                    _terminalPhase = error == null ? "TERMINAL_SUCCESS" : "TERMINAL_FAILURE";
                    registration = _registration;
                }
                registration.Dispose();
                if (error == null) _source.TrySetResult(value);
                else _source.TrySetException(error);
            }

            internal void FailPending(Exception error)
            {
                CancellationTokenRegistration registration;
                lock (_gate)
                {
                    if (_state != 0) return;
                    _state = 2;
                    _terminalPhase = "FAILED_BEFORE_START";
                    registration = _registration;
                }
                registration.Dispose();
                _source.TrySetException(error);
            }

            private void CancelPending()
            {
                lock (_gate)
                {
                    // A running Revit mutation cannot be safely interrupted;
                    // only cancel before it enters the Revit UI/API context.
                    if (_state != 0) return;
                    _state = 2;
                    _terminalPhase = "CANCELED_BEFORE_START";
                    _source.TrySetCanceled();
                }
            }
        }

        private readonly object _gate = new object();
        private readonly Queue<WorkItem> _pending = new Queue<WorkItem>();
        private readonly Dictionary<string, WorkItem> _operations =
            new Dictionary<string, WorkItem>(StringComparer.Ordinal);
        private readonly Queue<string> _operationOrder = new Queue<string>();
        private const int MaxOperationHistory = 8192;
        private readonly Func<RaiseOutcome> _raise;
        private readonly int _limit;
        private bool _scheduled;
        private bool _draining;
        private bool _disposed;

        public BridgeDispatchQueue(Func<RaiseOutcome> raise, int maximumPending = 256)
        {
            _raise = raise ?? throw new ArgumentNullException(nameof(raise));
            if (maximumPending < 1) throw new ArgumentOutOfRangeException(nameof(maximumPending));
            _limit = maximumPending;
        }

        public Task<string> Submit(string requestId, Func<string> runInsideRevit, CancellationToken cancellation = default(CancellationToken))
        {
            if (String.IsNullOrWhiteSpace(requestId)) throw new ArgumentException("Request ID required.", nameof(requestId));
            if (runInsideRevit == null) throw new ArgumentNullException(nameof(runInsideRevit));
            if (cancellation.IsCancellationRequested) return Task.FromCanceled<string>(cancellation);

            var item = new WorkItem(requestId, runInsideRevit);
            bool mustRaise = false;
            lock (_gate)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(BridgeDispatchQueue));
                if (_pending.Count >= _limit)
                    throw new InvalidOperationException("Revit bridge dispatch queue is full.");
                if (_operations.ContainsKey(requestId))
                    throw new InvalidOperationException(
                        "DUPLICATE_OPERATION_ID: query operation status; never replay a side effect.");
                TrimTerminalHistory();
                if (_operations.Count >= MaxOperationHistory)
                    throw new InvalidOperationException(
                        "Native operation history is full with nonterminal work.");
                // Admission and duplicate detection share the same queue gate.
                // HTTP timeout does not remove status for executing operations.
                _operations.Add(requestId, item);
                _operationOrder.Enqueue(requestId);
                _pending.Enqueue(item);
                if (!_scheduled && !_draining)
                {
                    _scheduled = true;
                    mustRaise = true;
                }
            }
            item.RegisterCancellation(cancellation);
            if (mustRaise) RaiseOrReject();
            return item.Result;
        }

        // HTTP-safe observation: this never touches UIApplication/RevitAPI.
        public string OperationPhase(string requestId)
        {
            if (String.IsNullOrWhiteSpace(requestId)) return null;
            lock (_gate)
            {
                WorkItem item;
                return _operations.TryGetValue(requestId, out item) ? item.Phase : null;
            }
        }

        // Retain the recent terminal history for Node/Python reconciliation;
        // never evict an executing or pending operation merely due to volume.
        private void TrimTerminalHistory()
        {
            if (_operations.Count < MaxOperationHistory) return;
            int inspections = _operationOrder.Count;
            while (inspections-- > 0 &&
                   _operations.Count > MaxOperationHistory * 3 / 4)
            {
                string id = _operationOrder.Dequeue();
                WorkItem previous;
                if (_operations.TryGetValue(id, out previous) && previous.IsTerminal)
                    _operations.Remove(id);
                else
                    _operationOrder.Enqueue(id);
            }
        }

        private void RaiseOrReject()
        {
            RaiseOutcome result;
            try { result = _raise(); }
            catch (Exception ex) { RejectPending(ex); return; }

            // Pending is NOT proof that this scheduler owns an accepted event.
            if (result != RaiseOutcome.Accepted)
                RejectPending(new InvalidOperationException("Revit ExternalEvent.Raise returned " + result));
        }

        private void RejectPending(Exception error)
        {
            List<WorkItem> failed = new List<WorkItem>();
            lock (_gate)
            {
                while (_pending.Count != 0) failed.Add(_pending.Dequeue());
                _scheduled = false;
                // An actual UI callback may already be draining work; it owns
                // its dequeued items and completes them independently.
            }
            foreach (var item in failed) item.FailPending(error);
        }

        // ONLY the native Revit IExternalEventHandler.Execute should call this.
        public void DrainOnRevitUiThread()
        {
            lock (_gate)
            {
                if (_disposed || _draining) return;
                _scheduled = false;
                _draining = true;
            }
            try
            {
                while (true)
                {
                    WorkItem item;
                    lock (_gate)
                    {
                        if (_pending.Count == 0)
                        {
                            // Enqueue and the exit transition are protected by
                            // the SAME gate: no arrival can be stranded.
                            _draining = false;
                            return;
                        }
                        item = _pending.Dequeue();
                    }
                    if (!item.Begin()) continue; // canceled before UI execution
                    string value = null;
                    Exception error = null;
                    try { value = item.Action(); }
                    catch (Exception ex) { error = ex; }
                    item.Complete(value, error);
                }
            }
            finally
            {
                // Defensive closeout if an unforeseen scheduler exception
                // escapes before the ordinary empty-queue transition.
                bool mustRaise = false;
                lock (_gate)
                {
                    if (_draining)
                    {
                        _draining = false;
                        if (!_disposed && _pending.Count != 0 && !_scheduled)
                        {
                            _scheduled = true;
                            mustRaise = true;
                        }
                    }
                }
                if (mustRaise) RaiseOrReject();
            }
        }

        public void Dispose()
        {
            List<WorkItem> failed = new List<WorkItem>();
            lock (_gate)
            {
                if (_disposed) return;
                _disposed = true;
                _scheduled = false;
                while (_pending.Count != 0) failed.Add(_pending.Dequeue());
            }
            foreach (var item in failed) item.FailPending(new ObjectDisposedException(nameof(BridgeDispatchQueue)));
        }
    }
}
