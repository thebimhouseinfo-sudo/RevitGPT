import assert from "node:assert/strict";
import test from "node:test";
import { capabilityBorrow, capabilityRelease, capabilityBorrowStatus } from "../src/capability-borrow.mjs";
import { effectForTool } from "../src/tool-effects.mjs";

test("different runs share capability IDs without mutual exclusion",()=>{
  const a="run-m3-a",b="run-m3-b",cap="file.write";
  try{
    assert.equal(capabilityBorrow(a,cap).exclusive,false);
    assert.equal(capabilityBorrow(b,cap).borrowed,true);
    assert.deepEqual(capabilityBorrowStatus(a).capability_ids,[cap]);
    assert.deepEqual(capabilityBorrowStatus(b).capability_ids,[cap]);
    assert.equal(capabilityRelease(a,cap).released,1);
    assert.deepEqual(capabilityBorrowStatus(a).capability_ids,[]);
    assert.deepEqual(capabilityBorrowStatus(b).capability_ids,[cap]);
  }finally{capabilityRelease(a);capabilityRelease(b);}
});
test("borrow is bookkeeping, not ownership authority",()=>{
  assert.throws(()=>capabilityBorrow("../wrong","file.write"),/CAPABILITY_INVALID_ID/);
  assert.throws(()=>capabilityBorrow("ok","../other"),/CAPABILITY_INVALID_ID/);
  assert.equal(effectForTool("capability_borrow"),"SYSTEM_SIDE_EFFECT");
  assert.equal(effectForTool("capability_release"),"SYSTEM_SIDE_EFFECT");
  assert.equal(effectForTool("capability_borrow_status"),"READ_ONLY");
});
