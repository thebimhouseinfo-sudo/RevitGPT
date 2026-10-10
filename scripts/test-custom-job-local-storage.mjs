import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rg-custom-job-"));
process.env.REVITGPT_APPDATA_ROOT = path.join(tmp, "AppData");
const app = await import("../src/appdata.mjs");
const { registerManagedTools } = await import("../src/managed-tools.mjs");
const handlers = new Map();
try {
  await app.ensureAppDataLayout();
  registerManagedTools({ registerTool(name, _spec, run) { handlers.set(name, run); } });
  const call = (name, args) => {
    assert.ok(handlers.has(name), "tool registered: " + name);
    return handlers.get(name)(args);
  };

  const external = path.join(tmp, "external-user-source");
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, "JOB.md"), "# Approved imported Job\n");
  const before = await fs.readFile(app.registryCapabilitiesPath(), "utf8");
  await assert.rejects(call("asset_register_external", {
    kind: "jobs", library_id: "external", name: "External Job",
    source_path: external, user_approved_source: true
  }), /CUSTOM_JOBS_MUST_USE_LOCAL_APPDATA/);
  assert.equal(await fs.readFile(app.registryCapabilitiesPath(), "utf8"), before);

  await call("library_create", { kind: "jobs", id: "custom" });
  const reasoning = (await call("job_draft_new", {
    library_id: "custom", name: "inspect-fcu", mode: "reasoning",
    goal: "Inspect placed FCU candidates"
  })).structuredContent;
  const direct = (await call("job_draft_new", {
    library_id: "custom", name: "audit-equipment", mode: "direct",
    goal: "Produce a deterministic inventory"
  })).structuredContent;
  assert.equal(reasoning.mode, "reasoning");
  assert.equal(direct.mode, "direct");
  assert.equal(path.basename(reasoning.draft_path), "JOB.md");
  assert.equal(path.extname(direct.draft_path), ".py");
  assert.ok(reasoning.draft_path.startsWith(app.jobDraftRoot()+path.sep));
  assert.ok(direct.draft_path.startsWith(app.jobDraftRoot()+path.sep));
  await call("job_draft_validate", { path: reasoning.draft_path, mode: "reasoning" });
  const promoted = (await call("job_promote_draft", {
    draft_path: reasoning.draft_path, library_id: "custom",
    relative_path: "inspect-fcu/JOB.md", id: "job.custom.inspect-fcu",
    title: "Inspect FCU", summary: "Reasoning task", mode: "reasoning"
  })).structuredContent;
  assert.ok(promoted.path.startsWith(app.jobLibrariesRoot()+path.sep));
  const loaded = (await call("job_get", { id: promoted.id })).structuredContent;
  assert.equal(loaded.entry.mode, "reasoning");
  assert.match(loaded.source, /Inspect placed FCU candidates/);

  const imported = (await call("asset_import", {
    kind: "jobs", library_id: "imported", name: "Imported library",
    source_path: external, user_approved_source: true
  })).structuredContent;
  assert.equal(imported.registered, 1);
  assert.ok(imported.managed_path.startsWith(app.jobLibrariesRoot()+path.sep));
  const registry = JSON.parse(await fs.readFile(app.registryCapabilitiesPath(), "utf8"));
  const entry = registry.entries.find(x => x.kind === "job" && x.library_id === "imported");
  assert.ok(entry, "external source was copied and indexed locally");
  const loadedImported = (await call("job_get", { id: entry.id })).structuredContent;
  assert.match(loadedImported.source, /Approved imported Job/);

  registry.entries.push({
    id: "job.legacy-external", kind: "job", mode: "reasoning",
    path: path.join(external, "JOB.md")
  });
  await fs.writeFile(app.registryCapabilitiesPath(), JSON.stringify(registry));
  await assert.rejects(
    call("job_get", { id: "job.legacy-external" }),
    /CUSTOM_JOB_OUTSIDE_LOCAL_APPDATA/
  );
  console.log("[PASS] Custom Job Direct/Reasoning drafts, promotion and import stay in Local AppData; external registration/read rejected.");
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
