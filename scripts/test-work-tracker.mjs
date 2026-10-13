import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {createWorkTracker} from "../src/work-tracker.mjs";

async function fixture(fn) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rg-work-tracker-"));
  try {await fn(path.join(root,"state","work-journal.json"));}
  finally {await fs.rm(root,{recursive:true,force:true});}
}

test("P1-D: global stop returns BUSY, waits for accepted work, denies new work",async()=>{
  await fixture(async filePath=>{
    let release,signal;
    const started=new Promise(r=>signal=r);
    let stops=0;
    const tracker=await createWorkTracker({filePath,onDrained:async()=>{stops++;}});
    const running=tracker.run("file_search","READ_ONLY",{root:"workspace"},async()=>{
      signal();
      return await new Promise(r=>release=r);
    });
    await started;
    const before=tracker.status();
    assert.equal(before.active_count,1);
    const status=await tracker.requestStop();
    assert.equal(status.status,"BUSY");
    await assert.rejects(tracker.admit("library_list","READ_ONLY"),/STOP_PENDING/);
    assert.equal(stops,0,"stop may not run while work is still active");
    release({content:[{type:"text",text:"ok"}]});
    await running;
    assert.equal(stops,1);
    assert.equal(tracker.status().mode,"STOPPED");
    const disk=JSON.parse(await fs.readFile(filePath,"utf8"));
    assert.equal(disk.mode,"STOPPED");
    const restarted=await createWorkTracker({filePath});
    assert.equal(restarted.status().mode,"STOPPED");
    await restarted.reopen();
    assert.equal(restarted.status().epoch,2);
  });
});

test("P1-D: a write timeout has unknown outcome; stop stays blocked and cannot replay",async()=>{
  await fixture(async filePath=>{
    let stops=0,invocations=0;
    const tracker=await createWorkTracker({filePath,onDrained:async()=>{stops++;}});
    await assert.rejects(
      tracker.run("file_edit","SYSTEM_SIDE_EFFECT",{path:"workspace/a.md",content:"A"},async()=>{
        invocations++;
        throw new Error("Bridge HTTP 504: request timed out; outcome unknown");
      }),
      /outcome unknown/
    );
    assert.equal(invocations,1);
    assert.equal(tracker.status().unresolved_count,1);
    const stopped=await tracker.requestStop();
    assert.equal(stopped.status,"STOP_BLOCKED");
    assert.equal(stops,0);
    const revived=await createWorkTracker({filePath});
    assert.equal(revived.status().unresolved_count,1);
    await assert.rejects(revived.reopen(),/STOP_PENDING/);
    await assert.rejects(revived.admit("file_edit","SYSTEM_SIDE_EFFECT",{}),/STOP_PENDING/);
    assert.equal(invocations,1,"no replay of prior side-effect");
  });
});

test("P1-C: crash before execution proves not started; crash after executing is unknown",async()=>{
  await fixture(async filePath=>{
    let stops=0;
    const a=await createWorkTracker({filePath,onDrained:async()=>{stops++;}});
    await a.admit("file_edit","SYSTEM_SIDE_EFFECT",{path:"workspace/x.md"});
    const restartOne=await createWorkTracker({filePath,onDrained:async()=>{stops++;}});
    assert.equal(restartOne.status().active_count,0,"pre-dispatch stage cannot execute");
    assert.equal(restartOne.status().unresolved_count,0);
    const active=await restartOne.admit("asset_import","SYSTEM_SIDE_EFFECT",{library_id:"m"});
    await restartOne.begin(active); // simulates Node crash after dispatch barrier
    const restartTwo=await createWorkTracker({filePath,onDrained:async()=>{stops++;}});
    assert.equal(restartTwo.status().unresolved_count,1,"running side-effect is unsafe after crash");
    assert.equal((await restartTwo.requestStop()).status,"STOP_BLOCKED");
    assert.equal(stops,0);
  });
});

test("P1-C: non-effectful read failure is known terminal and cannot block stop",async()=>{
  await fixture(async filePath=>{
    const tracker=await createWorkTracker({filePath});
    await assert.rejects(tracker.run("file_read","READ_ONLY",{path:"bad"},async()=>{
      throw new Error("FILE_NOT_FOUND");
    }),/FILE_NOT_FOUND/);
    assert.equal(tracker.status().unresolved_count,0);
    assert.equal((await tracker.requestStop()).status,"STOPPED");
  });
});

test("P1-C: journal write failure prevents any dispatched mutation",async()=>{
  await fixture(async filePath=>{
    let dispatched=false;
    const badFs={...fs,rename:async()=>{throw new Error("NO_DISK");}};
    const tracker=await createWorkTracker({filePath,fsApi:badFs});
    await assert.rejects(tracker.run("file_edit","SYSTEM_SIDE_EFFECT",{},async()=>{
      dispatched=true;
    }),/NO_DISK/);
    assert.equal(dispatched,false);
    assert.equal(tracker.status().active_count,0);
  });
});

test("P1-D: admitted-before-stop work may start and finish after the stop fence",async()=>{
  await fixture(async filePath=>{
    let stopped=0;
    const tracker=await createWorkTracker({filePath,onDrained:async()=>{stopped++;}});
    const id=await tracker.admit("file_search","READ_ONLY",{root:"workspace"});
    assert.equal((await tracker.requestStop()).status,"BUSY");
    await tracker.begin(id); // previously admitted, not new work
    await tracker.settle(id,"TERMINAL_SUCCESS");
    assert.equal(tracker.status().mode,"STOPPED");
    assert.equal(stopped,1);
  });
});

test("P1-D: explicit stop cannot claim STOPPED if intent clear fails",async()=>{
  await fixture(async filePath=>{
    let attempts=0;
    const tracker=await createWorkTracker({filePath,onDrained:async()=>{
      if(++attempts===1)throw new Error("AWAKE_CLEAR_FAILED");
    }});
    await assert.rejects(tracker.requestStop(),/AWAKE_CLEAR_FAILED/);
    assert.equal(tracker.status().mode,"STOP_PENDING");
    assert.equal((await tracker.requestStop()).status,"STOPPED");
    assert.equal(attempts,2);
  });
});

test("P1-C: corrupted journal fails closed rather than dropping unknown writes",async()=>{
  await fixture(async filePath=>{
    await fs.mkdir(path.dirname(filePath),{recursive:true});
    await fs.writeFile(filePath,"not json","utf8");
    await assert.rejects(createWorkTracker({filePath}),SyntaxError);
    assert.equal(await fs.readFile(filePath,"utf8"),"not json");
  });
});
