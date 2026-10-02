#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "RevitGPT", "session-probe");
const logPath = path.join(root, "probe.ndjson");
const checkpointPath = path.join(root, "checkpoints.ndjson");

function rows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function latestProbeRow() {
  return rows(logPath)
    .filter(r => r.event === "request_received" && r.x_openai_session_fp)
    .at(-1) || null;
}

function capture(label) {
  const r = latestProbeRow();
  if (!r) {
    console.error("No probe request found. Connect the Session Probe plugin and send one ping first.");
    process.exit(2);
  }
  fs.mkdirSync(root, { recursive: true });
  const cp = {
    label,
    captured_at: new Date().toISOString(),
    source_timestamp: r.timestamp,
    x_openai_session_fp: r.x_openai_session_fp,
    x_openai_subject_fp: r.x_openai_subject_fp,
    mcp_session_fp: r.mcp_session_fp
  };
  fs.appendFileSync(checkpointPath, JSON.stringify(cp) + "\n", "utf8");
  console.log(JSON.stringify(cp, null, 2));
}

function report() {
  const list = rows(checkpointPath);
  if (!list.length) {
    console.error("No checkpoints.");
    process.exit(2);
  }
  const base = list[0];
  console.log("RevitGPT persistent session continuity report");
  console.log("===========================================");
  for (const r of list) {
    const same = r.x_openai_session_fp === base.x_openai_session_fp;
    const subjectSame = r.x_openai_subject_fp === base.x_openai_subject_fp;
    const transportSame = r.mcp_session_fp === base.mcp_session_fp;
    console.log(
      [r.label.padEnd(20),
       (same ? "SAME_CHAT_ID" : "DIFFERENT_CHAT_ID").padEnd(18),
       ("session=" + (r.x_openai_session_fp || "-")).padEnd(34),
       ("subject=" + (subjectSame ? "same" : "different")).padEnd(20),
       "transport=" + (transportSame ? "same" : "rotated")
      ].join(" ")
    );
  }
}

function reset() {
  fs.mkdirSync(root, { recursive: true });
  if (fs.existsSync(checkpointPath)) fs.rmSync(checkpointPath);
  console.log("Reset checkpoints only. Persistent fingerprint key is preserved.");
}

const [cmd, label] = process.argv.slice(2);
if (cmd === "capture") capture(label || "checkpoint");
else if (cmd === "report") report();
else if (cmd === "reset") reset();
else {
  console.log("Usage:");
  console.log("  node scripts/session-stability-report.mjs reset");
  console.log("  node scripts/session-stability-report.mjs capture t0");
  console.log("  node scripts/session-stability-report.mjs capture 4h");
  console.log("  node scripts/session-stability-report.mjs report");
}
