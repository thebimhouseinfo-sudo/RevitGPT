using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitGPT.Native
{
    // Preview UI selection only. This is NOT a ChatGPT capability lease.
    // Revit Idling observes/consumes. WPF only reads snapshots and queues clicks.
    public sealed class NativeModelBindingState
    {
        public sealed class Snapshot
        {
            public string Status { get; internal set; }
            public string ActiveId { get; internal set; }
            public string ActiveTitle { get; internal set; }
            public string BoundId { get; internal set; }
            public string BoundTitle { get; internal set; }
            public long Revision { get; internal set; }
        }

        private readonly object _gate = new object();
        private HashSet<string> _open = new HashSet<string>(StringComparer.Ordinal);
        private string _activeId, _activeTitle, _boundId, _boundTitle, _requestedId;
        private bool _boundLost;
        private long _revision;

        public Snapshot Current
        {
            get
            {
                lock (_gate)
                {
                    string status = _boundId == null ? "NOT_BOUND" :
                        _boundLost ? "BOUND_CLOSED" :
                        _activeId == _boundId ? "BOUND_CURRENT" : "BOUND_OTHER_ACTIVE";
                    return new Snapshot
                    {
                        Status = status,
                        ActiveId = _activeId,
                        ActiveTitle = _activeTitle ?? "",
                        BoundId = _boundId,
                        BoundTitle = _boundTitle ?? "",
                        Revision = _revision
                    };
                }
            }
        }

        public void Observe(string activeId, string activeTitle, IEnumerable<string> openIds)
        {
            var open = new HashSet<string>((openIds ?? Enumerable.Empty<string>())
                .Where(id => !String.IsNullOrWhiteSpace(id)), StringComparer.Ordinal);
            lock (_gate)
            {
                _open = open;
                _activeId = !String.IsNullOrWhiteSpace(activeId) && open.Contains(activeId)
                    ? activeId : null;
                _activeTitle = _activeId == null ? "" : (activeTitle ?? "");
                // Closing a bound doc invalidates it even if a new document later
                // reuses the same runtime ID. Rebinding always requires a click.
                if (_boundId != null && !_open.Contains(_boundId)) _boundLost = true;
            }
        }

        public bool RequestBindCurrent()
        {
            lock (_gate)
            {
                if (_activeId == null) return false;
                _requestedId = _activeId;
                return true;
            }
        }

        public bool ConsumePendingBind()
        {
            lock (_gate)
            {
                string requested = _requestedId;
                _requestedId = null;
                // Tab/model change between click and Idling must fail closed.
                if (requested == null || requested != _activeId || !_open.Contains(requested))
                    return false;
                _boundId = requested;
                _boundTitle = _activeTitle;
                _boundLost = false;
                ++_revision;
                return true;
            }
        }

        public void ClearOnShutdown()
        {
            lock (_gate)
            {
                _activeId = null;
                _activeTitle = null;
                _boundId = null;
                _boundTitle = null;
                _requestedId = null;
                _boundLost = false;
                _open.Clear();
            }
        }
    }
}
