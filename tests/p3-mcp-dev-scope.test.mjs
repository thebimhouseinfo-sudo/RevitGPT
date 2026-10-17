import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerRevitMcpDevTools } from "../src/revit-mcp-dev.mjs";

test("M8 DEV edit/create remain available without snapshot or acceptance", async()=>{
  const old=process.env.REVITGPT_DEV_MODE;
  process.env.REVITGPT_DEV_MODE="1";
  try{
    const handlers=new Map();
    registerRevitMcpDevTools({registerTool(n,_c,fn){handlers.set(n,fn);}});
    const create=handlers.get("revit_mcp_dev_create");
    const edit=handlers.get("revit_mcp_dev_edit");
    assert.equal(typeof create,"function");
    assert.equal(typeof edit,"function");
    // Source remains inside explicitly bounded runtime; do not mutate the repo in CI.
    const result=await handlers.get("revit_mcp_dev_root")({});
    assert.match(result.structuredContent.root,/Revit-mcp/);
    await assert.rejects(()=>create({path:"../../../../outside.js",content:"x"}),/REVIT_MCP_DEV_PATH_OUTSIDE_RUNTIME/);
    await assert.rejects(()=>edit({path:"../../../../outside.js",expected_sha256:"0".repeat(64),content:"x"}),/REVIT_MCP_DEV_PATH_OUTSIDE_RUNTIME/);
  }finally{
    if(old===undefined)delete process.env.REVITGPT_DEV_MODE;
    else process.env.REVITGPT_DEV_MODE=old;
  }
});
