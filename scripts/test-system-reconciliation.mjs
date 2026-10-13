import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWorkTracker } from "../src/work-tracker.mjs";
import { inspectSystemPoststate, reconcileRecoveredSystemOperations } from "../src/system-reconciliation.mjs";

const home=await fs.mkdtemp(path.join(os.tmpdir(),"rg-system-recovery-"));
const prior=process.env.REVITGPT_APPDATA_ROOT;
process.env.REVITGPT_APPDATA_ROOT=home;
const journal=path.join(home,"state","work-journal.json");
const hash=s=>createHash("sha256").update(s).digest("hex");
const ids=["op-edit","op-create","op-append","op-knowledge","op-import","op-mismatch","op-no-marker"];
let counter=0;
const idFactory=()=>ids[counter++];
const tracker=await createWorkTracker({filePath:journal,idFactory});

async function abandoned(tool,args,perform,phase) {
  const id=await tracker.admit(tool,"SYSTEM_SIDE_EFFECT",args);
  await tracker.begin(id);
  if(perform)await perform(id);
  if(phase)await tracker.settle(id,phase,"simulated crash source");
  return id;
}
try {
  const dest=path.join(home,"workspace","sample.md");
  await fs.mkdir(path.dirname(dest),{recursive:true});
  const expected="new document bytes";
  await abandoned("file_edit",{path:dest,expected_sha256:hash("old"),content:expected},
    async()=>fs.writeFile(dest,expected),"OUTCOME_UNKNOWN");
  const create=path.join(home,"workspace","created.md");
  await abandoned("file_create",{path:create,content:"brand new"},
    async()=>fs.writeFile(create,"brand new"),"OUTCOME_UNKNOWN");

  const record=path.join(home,"data","runs","test","r1.ndjson");
  await fs.mkdir(path.dirname(record),{recursive:true});
  await abandoned("run_record_append",{kind:"test",id:"r1"},
    async id=>fs.appendFile(record,JSON.stringify({value:1,revitgpt_operation_id:id})+"\n"),
    "OUTCOME_UNKNOWN");

  const knowledge=path.join(home,"knowledge","revit","WORKING_KNOWLEDGE.md");
  await fs.mkdir(path.dirname(knowledge),{recursive:true});
  await abandoned("knowledge_promote",{title:"Verified title"},
    async id=>fs.appendFile(knowledge,"## Verified title\n\nSome lesson.\n<!-- revitgpt-operation: "+id+" -->\n"),
    "OUTCOME_UNKNOWN");

  await abandoned("asset_import",{kind:"dynamo",library_id:"demo"},
    null,"OUTCOME_UNKNOWN");
  const modified=path.join(home,"workspace","mismatched.md");
  await abandoned("file_create",{path:modified,content:"desired"},
    async()=>fs.writeFile(modified,"different"),"OUTCOME_UNKNOWN");
  await abandoned("run_record_append",{kind:"test",id:"missing"},
    null,"OUTCOME_UNKNOWN");

  const before=tracker.unresolvedOperations();
  assert.equal(before.length,7);
  assert.equal((await inspectSystemPoststate(before[0],{appdataRoot:home})).verdict,
    "POSTSTATE_CONFIRMED");
  const restarted=await createWorkTracker({filePath:journal});
  const output=await reconcileRecoveredSystemOperations(restarted,{appdataRoot:home});
  assert.equal(output.filter(x=>x.verdict==="POSTSTATE_CONFIRMED").length,4,
    "only exact file bytes and unique stamped appends may settle");
  assert.equal(restarted.status().unresolved_count,3,
    "multi-step import, unexpected hash and missing marker must remain blocked");
  assert.deepEqual(new Set(restarted.unresolvedOperations().map(x=>x.tool)),
    new Set(["asset_import","file_create","run_record_append"]));
  assert.equal((await restarted.requestStop()).status,"STOP_BLOCKED");
  assert.equal(await fs.readFile(modified,"utf8"),"different",
    "recovery must not overwrite user-modified file");
  assert.equal((await fs.readFile(record,"utf8")).split("op-append").length-1,1,
    "recovery must not duplicate an append");
  assert.equal((await fs.readFile(knowledge,"utf8")).split("op-knowledge").length-1,1);

  // An unknown path outside managed AppData is never opened for recovery.
  const escaped={id:"evil",effect:"SYSTEM_SIDE_EFFECT",phase:"OUTCOME_UNKNOWN",
    tool:"file_edit",targets:{path:path.join(os.tmpdir(),"private.txt"),content_sha256:hash("a")}};
  assert.equal((await inspectSystemPoststate(escaped,{appdataRoot:home})).reason,
    "UNTRUSTED_RECOVERY_PATH");
  // A forged duplicate marker must NOT count as successful append.
  const double=record+"\n";
  await fs.appendFile(record,JSON.stringify({revitgpt_operation_id:"op-append"})+"\n");
  const check=await inspectSystemPoststate({
    id:"op-append",effect:"SYSTEM_SIDE_EFFECT",phase:"OUTCOME_UNKNOWN",
    tool:"run_record_append",targets:{kind:"test",id:"r1"}
  },{appdataRoot:home});
  assert.equal(check.reason,"DUPLICATE_APPEND_MARKERS");
  console.log("[PASS] SYSTEM crash recovery: exact file hashes and append operation markers settle; partial/unknown operations block stop; no replay or path escape.");
} finally {
  if(prior===undefined)delete process.env.REVITGPT_APPDATA_ROOT;
  else process.env.REVITGPT_APPDATA_ROOT=prior;
  await fs.rm(home,{recursive:true,force:true});
}
