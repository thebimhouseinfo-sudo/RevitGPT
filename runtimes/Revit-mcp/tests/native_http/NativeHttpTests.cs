using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using RevitGPT.Native;

internal static class NativeProtocolTests
{
    private static int _assertions;
    static void Check(bool ok, string label)
    {
        if (!ok) throw new Exception("FAIL: " + label);
        _assertions++;
    }

    static async Task Main()
    {
        int called = 0;
        var seen = new List<string>();
        var api = new BridgeHttpProtocol((id,method,path,body,cancel) =>
        {
            Interlocked.Increment(ref called);
            lock (seen) seen.Add(method + " " + path + " " + id);
            return Task.FromResult("{\"data\":{\"id\":\"1\"}}");
        });
        Func<string,string,string,string,string,string,string,CancellationToken,Task<BridgeHttpResponse>> run =
            (method,path,host,origin,content,id,body,token) =>
                api.ProcessAsync(method,path,host,origin,content,id,body,token);
        const string H = "127.0.0.1:8765", ID = "11111111-2222-3333-4444-555555555555";

        var good = await run("GET","/health",H,null,null,ID,"",CancellationToken.None);
        Check(good.StatusCode == 200 && good.Body.Contains("\"data\""), "health result shape");
        good = await run("POST","/elements",H,null,"application/json; charset=utf-8",ID,"{}",CancellationToken.None);
        Check(good.StatusCode == 200, "POST JSON forwarded");

        // Real router error JSON must preserve HTTP status, not look like success.
        var routerError = new BridgeHttpProtocol((id,m,p,b,ct) =>
            Task.FromResult("{\"error\":{\"code\":501,\"message\":\"Writes not enabled.\"}}"));
        var notReady = await routerError.ProcessAsync("POST","/delete",H,null,"application/json",ID,"{}");
        Check(notReady.StatusCode == 501 && notReady.Body.Contains("Writes not enabled."),
            "router write-gate 501 is not false HTTP success");
        var missingTarget = new BridgeHttpProtocol((id,m,p,b,ct) =>
            Task.FromResult("{\"error\":{\"code\":404,\"message\":\"Model not open.\"}}"));
        var missing = await missingTarget.ProcessAsync("POST","/element",H,null,"application/json",ID,"{}");
        Check(missing.StatusCode == 404 && missing.Body.Contains("Model not open."),
            "router missing-model 404 is not false HTTP success");

        var malformed = new [] {
            "{\"error\":{\"code\":200,\"message\":\"False success\"}}",
            "{\"error\":{\"code\":\"501\",\"message\":\"Bad type\"}}",
            "{\"error\":{\"code\":501}}",
            "{\"error\":null}",
            "{\"unrecognized\":true}",
            "not-json",
            "[]",
            "{\"data\":true,\"error\":{\"code\":700,\"message\":\"Conflict\"}}"
        };
        foreach (var envelope in malformed)
        {
            var badRouter = new BridgeHttpProtocol((id,m,p,b,ct) =>
                Task.FromResult(envelope));
            var invalid = await badRouter.ProcessAsync("GET","/health",H,null,null,ID,"");
            Check(invalid.StatusCode == 502 && invalid.Body.Contains("\"error\""),
                "invalid API envelope fails closed without status 200");
        }

        var bad = new [] {
            new {method="GET",path="/health",host="evil.test:8765",origin=(string)null,ct=(string)null,id=ID,body="",status=403},
            new {method="GET",path="/health",host=H,origin="https://evil.test",ct=(string)null,id=ID,body="",status=403},
            new {method="DELETE",path="/health",host=H,origin=(string)null,ct=(string)null,id=ID,body="",status=405},
            new {method="POST",path="/health",host=H,origin=(string)null,ct="application/json",id=ID,body="{}",status=405},
            new {method="GET",path="/unknown",host=H,origin=(string)null,ct=(string)null,id=ID,body="",status=404},
            new {method="GET",path="/health",host=H,origin=(string)null,ct=(string)null,id="",body="",status=400},
            new {method="GET",path="/health",host=H,origin=(string)null,ct=(string)null,id="bad \" quote",body="",status=400},
            new {method="POST",path="/elements",host=H,origin=(string)null,ct="text/plain",id=ID,body="{}",status=415}
        };
        foreach (var entry in bad)
        {
            var result = await run(entry.method,entry.path,entry.host,entry.origin,entry.ct,entry.id,
                entry.body,CancellationToken.None);
            Check(result.StatusCode == entry.status && result.Body.Contains("\"error\""),"reject " + entry.status);
        }
        Check(called == 2,"rejected requests never run API");
        var big = await run("POST","/elements",H,null,"application/json",ID,
            new string('a', BridgeHttpProtocol.MaximumBodyBytes + 1),CancellationToken.None);
        Check(big.StatusCode == 413,"bounded request body");

        var delay = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var timedRead = new BridgeHttpProtocol((id,m,p,b,ct) => delay.Task,
            TimeSpan.FromMilliseconds(25),TimeSpan.FromMilliseconds(35));
        var resultRead = await timedRead.ProcessAsync("GET","/health",H,null,null,ID,"");
        Check(resultRead.StatusCode == 504 && resultRead.Body.Contains("read timed out"),"read timeout");
        var resultWrite = await timedRead.ProcessAsync("POST","/delete",H,null,"application/json",ID,"{}");
        Check(resultWrite.StatusCode == 504 &&
              resultWrite.Body.Contains("outcome unknown"),"write timeout does not lie about mutation");
        delay.TrySetResult("{\"data\":true}");

        // Concurrency: simulated requests await independent ExternalEvent results,
        // and the HTTP protocol does not invoke Revit calls directly.
        var slots = new TaskCompletionSource<string>[10];
        for (int i=0; i<slots.Length; i++)
            slots[i] = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var index = -1;
        var pending = new BridgeHttpProtocol((id,m,p,b,ct) =>
            slots[Interlocked.Increment(ref index)].Task);
        var calls = Enumerable.Range(0,10).Select(i => pending.ProcessAsync(
            "POST","/elements",H,null,"application/json","req-"+i,"{}")).ToArray();
        Check(calls.All(t=>!t.IsCompleted) && index==9,"ten independent pending HTTP requests");
        for (int i=9;i>=0;i--) slots[i].TrySetResult("{\"data\":" + i + "}");
        var outputs = await Task.WhenAll(calls);
        Check(outputs.Length==10 && outputs.Select(r=>r.Body).Distinct().Count()==10,
            "ten isolated HTTP responses");

        var noQueue = new BridgeHttpProtocol((id,m,p,b,ct) =>
            throw new InvalidOperationException("Revit bridge dispatch queue is full."));
        var overload = await noQueue.ProcessAsync("GET","/health",H,null,null,ID,"");
        Check(overload.StatusCode==429,"bounded queue surfaced as overload");

        Console.WriteLine("[PASS] Native HTTP protocol: " + _assertions + " assertions");
    }
}
