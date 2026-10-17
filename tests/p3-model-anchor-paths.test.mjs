import assert from "node:assert/strict";
import test from "node:test";
import { modelAnchorRoot, modelRunResultRoot } from "../src/model-anchor-paths.mjs";
import { classifyModelOperation } from "../src/model-authority.mjs";

test("persistent RVT UUID is the only Model Anchor path key",()=>{
  const id="60c02344-d967-4540-939d-19b5c4d774fb";
  const root=modelAnchorRoot(id);
  assert.ok(root.includes(id));
  assert.ok(modelRunResultRoot(id,"example-job","run-1").includes("runs"));
  assert.notEqual(modelRunResultRoot(id,"example-job","run-1"),
                  modelRunResultRoot(id,"example-job","run-2"));
  for(const invalid of ["Phase 1 project name","D:/model.rvt","document.123","../escape",""])
    assert.throws(()=>modelAnchorRoot(invalid),/MODEL_ANCHOR_PERSISTENT_UUID_REQUIRED/);
  assert.throws(()=>modelRunResultRoot(id,"../other","run-1"),/MODEL_RUN_INVALID_ID/);
});

test("model ID tools obey native binding, read vs mutation",()=>{
  assert.equal(classifyModelOperation("revit_get_model_anchor"),"READ_ONLY");
  assert.equal(classifyModelOperation("revit_initialize_model_anchor"),"MODEL_MUTATION");
});
