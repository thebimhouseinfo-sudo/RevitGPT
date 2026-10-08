using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using RevitGPT.Native;

internal static class NativeDispatchTests
{
    private static int _count;

    private static void True(bool value, string label)
    {
        if (!value) throw new Exception("FAIL: " + label);
        _count++;
    }

    private static async Task<T> Timeout<T>(Task<T> task, string label)
    {
        var done = await Task.WhenAny(task, Task.Delay(2500));
        True(Object.ReferenceEquals(done, task), label + " completed without stranding");
        return await task;
    }

    private static async Task ExpectFailure(Task<string> task, string text)
    {
        try { await Timeout(task, "negative result"); throw new Exception("FAIL: expected " + text); }
        catch (InvalidOperationException ex)
        {
            True(ex.Message.Contains(text), "specific raise failure: " + text);
        }
    }

    private static async Task Main()
    {
        // Retry requests coalesce, never busy-loop after failure, and survive
        // a user Refresh without requiring a real Revit host.
        var retry = new BridgeRetryState();
        True(retry.TryConsume(), "one initial automatic bridge attempt");
        True(!retry.TryConsume(), "failed startup does not spin on every idle");
        Parallel.For(0, 64, _ => retry.Request());
        True(retry.TryConsume(), "concurrent Refresh clicks schedule one retry");
        True(!retry.TryConsume(), "no duplicate retry after coalescing");
        retry.Request();
        True(retry.TryConsume(), "later Refresh can retry a failed startup");
        True(!retry.TryConsume(), "retry is one-shot until next user action");

        // Native panel selection cannot silently bind/rebind on tab changes.
        var binding = new NativeModelBindingState();
        binding.Observe("100", "MAGS", new[] { "100", "200" });
        True(binding.Current.Status == "NOT_BOUND", "opening a model never auto-binds");
        True(!binding.ConsumePendingBind(), "no click means no bind");
        True(binding.RequestBindCurrent(), "click queues an explicit target");
        binding.Observe("200", "Model B", new[] { "100", "200" });
        True(!binding.ConsumePendingBind() && binding.Current.Status == "NOT_BOUND",
            "switch before Idling rejects stale click");
        True(binding.RequestBindCurrent(), "bind Model B explicitly");
        True(binding.ConsumePendingBind() && binding.Current.BoundId == "200",
            "only requested Model B becomes bound");
        binding.Observe("100", "MAGS", new[] { "100", "200" });
        True(binding.Current.Status == "BOUND_OTHER_ACTIVE" &&
            binding.Current.BoundId == "200", "switch does not rebind");
        binding.Observe("200", "Model B", new[] { "100", "200" });
        True(binding.Current.Status == "BOUND_CURRENT", "return to bound model");
        binding.Observe("100", "MAGS", new[] { "100" });
        True(binding.Current.Status == "BOUND_CLOSED", "closed bound model detected");
        binding.Observe("200", "Reopened B", new[] { "100", "200" });
        True(binding.Current.Status == "BOUND_CLOSED", "closed binding does not revive");
        True(binding.RequestBindCurrent() && binding.ConsumePendingBind(),
            "reopening requires explicit rebind");
        True(binding.Current.BoundTitle == "Reopened B" &&
            binding.Current.Status == "BOUND_CURRENT", "rebind replaces primary model");
        binding.Observe(null, null, new[] { "100", "200" });
        True(!binding.RequestBindCurrent(), "cannot bind with no active model");
        True(binding.Current.Revision == 2, "exactly two deliberate binds");
        binding.ClearOnShutdown();
        True(binding.Current.Status == "NOT_BOUND" && binding.Current.BoundId == null,
            "Revit shutdown clears model binding");

        // Ten independent callers. None executes Revit action from HTTP thread.
        int raises = 0, executions = 0;
        var queue = new BridgeDispatchQueue(() => { Interlocked.Increment(ref raises); return RaiseOutcome.Accepted; });
        var pending = new Task<string>[10];
        var producers = Enumerable.Range(0, 10).Select(i => Task.Run(() =>
        {
            pending[i] = queue.Submit("req-" + i, () => { Interlocked.Increment(ref executions); return "result-" + i; });
        })).ToArray();
        await Task.WhenAll(producers);
        True(executions == 0, "HTTP callbacks never execute Revit API before UI callback");
        True(raises == 1, "single-flight only one scheduled ExternalEvent");
        queue.DrainOnRevitUiThread();
        var responses = await Task.WhenAll(pending.Select((t,i) => Timeout(t, "req " + i)));
        True(responses.Distinct().Count() == 10, "all 10 per-request results distinct");
        True(executions == 10, "all 10 actions executed exactly once");

        // Race: new work arrives from worker during a drain.
        Task<string> nested = null;
        var first = queue.Submit("first", () =>
        {
            nested = queue.Submit("arriving-during-drain", () => "nested-value");
            return "first-value";
        });
        queue.DrainOnRevitUiThread();
        True(await Timeout(first, "drain first") == "first-value", "first result");
        True(nested != null && await Timeout(nested, "drain nested") == "nested-value", "arrival during drain served");
        True(raises == 2, "drain arrival did not schedule redundant Raise");

        var after = queue.Submit("after-drain", () => "after-value");
        True(raises == 3, "request after empty-drain schedules fresh Raise");
        queue.DrainOnRevitUiThread();
        True(await Timeout(after, "after-drain") == "after-value", "no exit-boundary lost wakeup");

        // Denied and Pending are fail-closed; recovery enqueues a new event.
        foreach (var rejection in new [] { RaiseOutcome.Denied, RaiseOutcome.TimedOut, RaiseOutcome.Pending })
        {
            using (var bad = new BridgeDispatchQueue(() => rejection))
            {
                var blocked = bad.Submit("blocked", () => throw new Exception("must not execute"));
                await ExpectFailure(blocked, rejection.ToString());
                bad.DrainOnRevitUiThread();
            }
        }
        using (var recover = new BridgeDispatchQueue(() =>
                   Interlocked.Increment(ref raises) > 0 ? RaiseOutcome.Accepted : RaiseOutcome.Denied))
        {
            var t = recover.Submit("recovered", () => "works");
            recover.DrainOnRevitUiThread();
            True(await Timeout(t, "recovered") == "works", "recover after fresh accepted event");
        }

        // Cancellation before Revit execution cannot mutate the document.
        var cts = new CancellationTokenSource();
        int mutations = 0;
        var canceled = queue.Submit("cancel", () => { mutations++; return "unexpected"; }, cts.Token);
        cts.Cancel();
        queue.DrainOnRevitUiThread();
        True(canceled.IsCanceled, "canceled pending item reported canceled");
        True(mutations == 0, "cancel before dispatch skips Revit mutation");

        // Cancellation DURING execution must not claim to undo a mutation.
        var runningCts = new CancellationTokenSource();
        var running = queue.Submit("running", () =>
        {
            runningCts.Cancel();
            return "mutation completed";
        }, runningCts.Token);
        queue.DrainOnRevitUiThread();
        True(await Timeout(running, "running mutation") == "mutation completed", "running mutation not deceptively canceled");

        // Regression: cancellation callback and successful completion race.
        // CancellationTokenRegistration.Dispose must NOT wait while holding
        // the item's state lock or a deadlock can occur.
        for (int i = 0; i < 20; i++)
        {
            using (var raceCancel = new CancellationTokenSource())
            {
                var item = queue.Submit("cancel-race-" + i, () => "finished", raceCancel.Token);
                var waiter = Task.Run(() => raceCancel.Cancel());
                queue.DrainOnRevitUiThread();
                await Timeout(waiter.ContinueWith(_ => "canceled", TaskScheduler.Default), "cancel callback finishes");
                True(item.IsCompleted, "race resolved without stranded request");
            }
        }

        // Individual exception is isolated from sibling responses.
        var fault = queue.Submit("fault", () => throw new InvalidOperationException("element unavailable"));
        var healthy = queue.Submit("healthy", () => "safe");
        queue.DrainOnRevitUiThread();
        await ExpectFailure(fault, "element unavailable");
        True(await Timeout(healthy, "healthy sibling") == "safe", "one failure does not contaminate sibling");

        // Bounded queue never overflows silently.
        using (var bounded = new BridgeDispatchQueue(() => RaiseOutcome.Accepted, maximumPending: 1))
        {
            var slot = bounded.Submit("one", () => "one");
            bool rejected = false;
            try { _ = bounded.Submit("two", () => "two"); }
            catch (InvalidOperationException ex) { rejected = ex.Message.Contains("full"); }
            True(rejected, "queue capacity enforced");
            bounded.DrainOnRevitUiThread();
            True(await Timeout(slot, "bounded slot") == "one", "original survives overflow");
        }

        // Shutdown clears queued requests, rejects new work, never blocks caller.
        var beforeStop = queue.Submit("shutdown", () => "should not run");
        queue.Dispose();
        bool stopped = false;
        try { await beforeStop; }
        catch (ObjectDisposedException) { stopped = true; }
        True(stopped, "pending item fails on shutdown");
        stopped = false;
        try { _ = queue.Submit("after-close", () => "no"); }
        catch (ObjectDisposedException) { stopped = true; }
        True(stopped, "post-shutdown request refused");

        // Revit API adapter positive and negative controls with a fake
        // ExternalEvent. This does NOT represent a real Revit host test.
        using (var adapter = RevitExternalEventAdapter.CreateOnRevitUiThread())
        {
            var external = Autodesk.Revit.UI.ExternalEvent.Last;
            var fakeApp = new Autodesk.Revit.UI.UIApplication { ModelName = "TEST.RVT" };
            int reads = 0;
            var document = adapter.Submit("read-ui", app => { reads++; return app.ModelName; });
            True(reads == 0 && !document.IsCompleted, "API read deferred until UI callback");
            True(external.RaiseCount == 1, "one ExternalEvent raised");
            external.Dispatch(fakeApp);
            True(await Timeout(document, "fake UI read") == "TEST.RVT", "result from callback");
            True(reads == 1, "read executed exactly once");

            external.Response = Autodesk.Revit.UI.ExternalEventRequest.Denied;
            var denied = adapter.Submit("denied", app => "must not execute");
            await ExpectFailure(denied, "Denied");
            external.Response = Autodesk.Revit.UI.ExternalEventRequest.Accepted;
            var recovered = adapter.Submit("recovered", app => app.ModelName);
            external.Dispatch(fakeApp);
            True(await Timeout(recovered, "fake UI recovery") == "TEST.RVT", "denied event can retry safely");
        }

        Console.WriteLine("[PASS] Native dispatcher concurrency tests: " + _count + " assertions.");
    }
}
