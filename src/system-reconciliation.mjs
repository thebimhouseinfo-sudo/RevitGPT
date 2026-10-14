import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { allowedManagedRoots, getAppDataRoot, runDataRoot } from "./appdata.mjs";

const MAX_INSPECT_BYTES = 16 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/i;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function inside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

async function readTrustedFile(target, roots, fsApi) {
  if (!path.isAbsolute(target) || !roots.some(root => inside(root, target)))
    return {error:"UNTRUSTED_RECOVERY_PATH"};
  try {
    const stat = await fsApi.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INSPECT_BYTES)
      return {error:"UNSUPPORTED_RECOVERY_FILE"};
    const bytes = await fsApi.readFile(target);
    return {bytes};
  } catch (error) {
    return {error:"FILE_UNAVAILABLE",code:error?.code};
  }
}

function recordPath(op, appdataRoot) {
  const t = op.targets ?? {};
  if (op.tool === "file_create" || op.tool === "file_edit")
    return {file:t.path,roots:Object.values(allowedManagedRoots())};
  if (op.tool === "run_record_append") {
    if (!SAFE_NAME.test(t.kind ?? "") || !SAFE_NAME.test(t.id ?? "") ||
        t.kind==="." || t.kind===".." || t.id==="." || t.id==="..")
      return null;
    return {file:path.join(runDataRoot(),t.kind,t.id+".ndjson"),roots:[runDataRoot()]};
  }
  if (op.tool === "knowledge_failure_append")
    return {file:path.join(appdataRoot,"knowledge","failures","ERROR_LOG.md"),
      roots:[path.join(appdataRoot,"knowledge")]};
  if (op.tool === "knowledge_promote")
    return {file:path.join(appdataRoot,"knowledge","revit","WORKING_KNOWLEDGE.md"),
      roots:[path.join(appdataRoot,"knowledge")]};
  return null;
}

export async function inspectSystemPoststate(op, {
  fsApi = fs, appdataRoot = getAppDataRoot()
} = {}) {
  if (!op || op.effect !== "SYSTEM_SIDE_EFFECT" || !["OUTCOME_UNKNOWN","PARTIAL"].includes(op.phase))
    return {verdict:"NOT_APPLICABLE"};
  const destination = recordPath(op, appdataRoot);
  if (!destination || typeof destination.file !== "string")
    return {verdict:"UNRESOLVED",reason:"MULTI_STEP_OR_UNSUPPORTED_SYSTEM_OPERATION"};
  const file = await readTrustedFile(destination.file,destination.roots,fsApi);
  if (!file.bytes) return {verdict:"UNRESOLVED",reason:file.error};

  if (op.tool === "file_create" || op.tool === "file_edit") {
    const expected = op.targets?.content_sha256;
    if (!SHA.test(expected ?? ""))
      return {verdict:"UNRESOLVED",reason:"EXPECTED_CONTENT_HASH_MISSING"};
    const actual = createHash("sha256").update(file.bytes).digest("hex");
    if (actual !== expected)
      return {verdict:"UNRESOLVED",reason:"POST_STATE_HASH_DIFFERENT"};
    // This proves the exact desired file bytes are present, NOT which process
    // wrote them. It authorizes no replay, and never overwrites user changes.
    return {verdict:"POSTSTATE_CONFIRMED",reason:"EXPECTED_FILE_SHA256_PRESENT"};
  }

  const body = file.bytes.toString("utf8");
  if (op.tool === "run_record_append") {
    const records = body.split(/\r?\n/).filter(Boolean);
    let found=0;
    for (const raw of records) {
      let record;
      try { record=JSON.parse(raw); } catch { return {verdict:"UNRESOLVED",reason:"RUN_RECORD_CORRUPT"}; }
      if (record?.revitgpt_operation_id===op.id) found++;
    }
    return found===1 ? {verdict:"POSTSTATE_CONFIRMED",reason:"EXACT_APPEND_MARKER_PRESENT"} :
      {verdict:"UNRESOLVED",reason:found>1?"DUPLICATE_APPEND_MARKERS":"APPEND_MARKER_NOT_FOUND"};
  }
  const marker="<!-- revitgpt-operation: "+op.id+" -->";
  const count=body.split(marker).length-1;
  if (count!==1)return {verdict:"UNRESOLVED",
    reason:count>1?"DUPLICATE_APPEND_MARKERS":"APPEND_MARKER_NOT_FOUND"};
  // A marker is written AFTER the Markdown block by one appendFile call.
  if (op.targets?.title && !body.slice(Math.max(0,body.lastIndexOf(marker)-8192),body.lastIndexOf(marker))
    .includes(op.targets.title))
    return {verdict:"UNRESOLVED",reason:"MARKER_WITHOUT_EXPECTED_TITLE"};
  return {verdict:"POSTSTATE_CONFIRMED",reason:"EXACT_APPEND_MARKER_PRESENT"};
}

/**
 * P1-C read-only-on-disk recovery, not a Job runner. Only proves a terminal
 * POSTSTATE via matching bytes/marker. Anything else stays STOP_BLOCKED.
 * No import, delete, copy, replay or rollback action is performed.
 */
export async function reconcileRecoveredSystemOperations(tracker, options = {}) {
  if (typeof tracker?.unresolvedOperations !== "function")
    return [{verdict:"UNAVAILABLE",reason:"JOURNAL_CANNOT_BE_INSPECTED"}];
  const results=[];
  for (const op of tracker.unresolvedOperations()) {
    if (op.effect !== "SYSTEM_SIDE_EFFECT")continue;
    let decision;
    try { decision=await inspectSystemPoststate(op,options); }
    catch (error) {
      decision={verdict:"UNRESOLVED",reason:"RECOVERY_READ_FAILED",
        detail:error instanceof Error?error.message:String(error)};
    }
    if (decision.verdict === "POSTSTATE_CONFIRMED") {
      try { await tracker.settle(op.id,"TERMINAL_SUCCESS",decision.reason); }
      catch (error) {
        decision={verdict:"UNRESOLVED",reason:"RECOVERY_JOURNAL_WRITE_FAILED",
          detail:error instanceof Error?error.message:String(error)};
      }
    }
    results.push({id:op.id,tool:op.tool,...decision});
  }
  return results;
}
