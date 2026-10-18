import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { modelIdFromMcpResult,beginModelRun } from "../src/model-run-result.mjs";
import { effectForTool } from "../src/tool-effects.mjs";

const ID="test_20261017T103012123Z_a1b2c3d4";
test("native-bound generated model ID must be present and valid before run output folder is created",async()=>{
  const old=process.env.REVITGPT_APPDATA_ROOT;
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rg-model-results-"));
  process.env.REVITGPT_APPDATA_ROOT=root;
  try{
    const response={content:[{type:"text",text:JSON.stringify({found:true,valid:true,model_id:ID})}]};
    const fixedNow=()=>new Date("2026-10-19T03:04:05.123Z");
    const first=await beginModelRun({jobId:"saved-job",runId:"run-1",readBoundModelAnchor:async()=>response,now:fixedNow});
    assert.equal(first.run_timestamp_utc,"20261019T030405123Z");
    assert.ok(first.results_path.includes("20261019T030405123Z_run-1"));
    assert.ok(first.results_path.includes(ID));
    assert.equal((await fs.stat(first.results_path)).isDirectory(),true);
    assert.equal(first.model_id,ID);
    const revision=await beginModelRun({jobId:"saved-job",runId:"run-1",readBoundModelAnchor:async()=>response,now:()=>new Date("2026-10-19T03:04:06.123Z")});
    assert.notEqual(first.results_path,revision.results_path);
    assert.equal(revision.model_id,first.model_id);
    await assert.rejects(()=>beginModelRun({jobId:"saved-job",runId:"run-1",readBoundModelAnchor:async()=>response,now:fixedNow}),/MODEL_RUN_RESULTS_ALREADY_EXIST/);
    await assert.rejects(()=>beginModelRun({jobId:"../bad",runId:"run-2",readBoundModelAnchor:async()=>response}),/MODEL_RUN_INVALID_ID/);
    await assert.rejects(()=>beginModelRun({jobId:"other",runId:"run-3",readBoundModelAnchor:async()=>({
      structuredContent:{model_id:"Project Renamed",valid:false}
    })}),/MODEL_ANCHOR_MISSING_OR_INVALID/);
    assert.equal(effectForTool("model_run_result_begin"),"SYSTEM_SIDE_EFFECT");
  }finally{
    if(old===undefined)delete process.env.REVITGPT_APPDATA_ROOT;
    else process.env.REVITGPT_APPDATA_ROOT=old;
    await fs.rm(root,{recursive:true,force:true});
  }
});
test("M1 parses MCP text and structured result but refuses guessed identity",()=>{
  assert.equal(modelIdFromMcpResult({structuredContent:{valid:true,model_id:ID}}),ID);
  assert.equal(modelIdFromMcpResult({structuredContent:{result:{content:[{type:"text",text:JSON.stringify({valid:true,model_id:ID})}],isError:false}}}),ID);
  assert.throws(()=>modelIdFromMcpResult({structuredContent:{result:{content:[{type:"text",text:"Bridge HTTP 404"}],isError:true}}}),/MODEL_ANCHOR_UPSTREAM_ERROR/);
  assert.equal(modelIdFromMcpResult({structuredContent:{result:{valid:true,model_id:ID}}}),ID);
  assert.throws(()=>modelIdFromMcpResult({structuredContent:{model_id:"Project Name",valid:false}}),/MODEL_ANCHOR_MISSING_OR_INVALID/);
  assert.throws(()=>modelIdFromMcpResult({isError:true}),/MODEL_ANCHOR_UPSTREAM_ERROR/);
});
