#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function appDataRoot() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}

const cadLog = argValue("--log") || path.join(appDataRoot(), "CadGPT", "logs", "continuity.ndjson");
const evidenceDir = argValue("--evidence-dir") || path.join(appDataRoot(), "RevitGPT", "session-probe");
const checkpointFile = path.join(evidenceDir, "checkpoints.ndjson");

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch {}
  }
  return rows;
}

function sourceRows() {
  const dir = path.dirname(cadLog);
  const previous = path.join(dir, "continuity.previous.ndjson");
  return [...readNdjson(previous), ...readNdjson(cadLog)]
    .filter((r) => r && r.event === "request_received")
    .filter((r) => r.header_fingerprints && r.header_fingerprints["x-openai-session"])
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

function latestSourceRow() {
  const rows = sourceRows();
  return rows.at(-1) || null;
}

function capture(label) {
  const row = latestSourceRow();
  if (!row) {
    console.error("No CadGPT continuity request with x-openai-session was found.");
    console.error("Invoke the CG/CadGPT plugin once, then run this capture command again.");
    process.exit(2);
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  const headers = row.header_fingerprints || {};
  const checkpoint = {
    label,
    captured_at: new Date().toISOString(),
    source_timestamp: row.timestamp,
    runtime_id: row.runtime_id || null,
    x_openai_session_fp: headers["x-openai-session"] || null,
    x_openai_subject_fp: headers["x-openai-subject"] || null,
    mcp_session_fp: row.transport_session || null,
    rpc_method: row.rpc_method || null,
    tool_name: row.tool_name || null,
    source_log: cadLog
  };
  fs.appendFileSync(checkpointFile, JSON.stringify(checkpoint) + "\n", "utf8");
  console.log(JSON.stringify(checkpoint, null, 2));
}

function report() {
  const rows = readNdjson(checkpointFile);
  if (!rows.length) {
    console.error("No checkpoints found.");
    console.error("Use: session-test.bat capture t0");
    process.exit(2);
  }

  const baseline = rows[0];
  console.log("");
  console.log("RevitGPT x-openai-session stability report");
  console.log("==========================================");
  console.log("Evidence:", checkpointFile);
  console.log("Baseline:", baseline.label, baseline.source_timestamp);
  console.log("");

  let comparableCount = 0;
  let stableCount = 0;
  for (const row of rows) {
    const sameRuntime = row.runtime_id === baseline.runtime_id;
    const sameSession = sameRuntime && row.x_openai_session_fp === baseline.x_openai_session_fp;
    const sameSubject = sameRuntime && row.x_openai_subject_fp === baseline.x_openai_subject_fp;
    const transportChanged = sameRuntime && row.mcp_session_fp !== baseline.mcp_session_fp;
    const verdict = !sameRuntime ? "UNCOMPARABLE_RUNTIME_RESTART" : sameSession ? "SAME_CHAT_ID" : "DIFFERENT_CHAT_ID";
    if (sameRuntime) {
      comparableCount += 1;
      if (sameSession) stableCount += 1;
    }
    console.log(
      [
        row.label.padEnd(12),
        verdict.padEnd(29),
        ("session=" + (row.x_openai_session_fp || "-")).padEnd(26),
        ("subject=" + (row.x_openai_subject_fp || "-")).padEnd(26),
        ("transport=" + (row.mcp_session_fp || "-")).padEnd(28),
        transportChanged ? "transport-rotated" : ""
      ].join(" ")
    );
  }

  console.log("");
  console.log("Comparable checkpoints:", comparableCount);
  console.log("Same x-openai-session as baseline:", stableCount + "/" + comparableCount);
  if (rows.some((r) => r.runtime_id !== baseline.runtime_id)) {
    console.log("WARNING: CadGPT runtime_id changed. CadGPT fingerprints use a per-runtime salt, so cross-runtime rows cannot prove equality/inequality.");
  }
  console.log("");
  console.log("Interpretation:");
  console.log("- SAME_CHAT_ID at t0/1h/4h/8h supports x-openai-session stability for that duration.");
  console.log("- A changed mcp transport with stable x-openai-session is positive evidence that logical chat identity survives transport rotation.");
  console.log("- A control capture from a different ChatGPT conversation should produce DIFFERENT_CHAT_ID while x-openai-subject normally remains the same.");
}

function reset() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (fs.existsSync(checkpointFile)) fs.rmSync(checkpointFile);
  console.log("Reset:", checkpointFile);
}

const [command, label] = process.argv.slice(2).filter((x) => !x.startsWith("--") && x !== argValue("--log") && x !== argValue("--evidence-dir"));
if (command === "capture") {
  if (!label) {
    console.error("Usage: session-test.bat capture <label>");
    process.exit(2);
  }
  capture(label);
} else if (command === "report") {
  report();
} else if (command === "reset") {
  reset();
} else {
  console.log("Usage:");
  console.log("  session-test.bat reset");
  console.log("  session-test.bat capture t0");
  console.log("  session-test.bat capture 1h");
  console.log("  session-test.bat capture 4h");
  console.log("  session-test.bat capture 8h");
  console.log("  session-test.bat capture control-new-chat");
  console.log("  session-test.bat report");
}
