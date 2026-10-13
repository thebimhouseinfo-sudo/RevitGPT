import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createAwakeIntent, getWindowsBootSessionId } from "../src/awake-intent.mjs";

const BOOT_A = "a".repeat(64), BOOT_B = "b".repeat(64);

async function withPath(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rg-awake-intent-"));
  try { await fn(path.join(dir, "runtime", "awake-intent.json")); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test("P1-B: new boot/logon starts STANDBY, explicit wake persists, same generation recovers", async () => {
  await withPath(async filePath => {
    const first = await createAwakeIntent({ filePath, sessionIdProvider: async () => BOOT_A });
    assert.equal(first.status().awake, false);
    assert.equal(first.status().recovered, false);
    await first.wake();
    assert.equal(first.isAwake(), true);
    const disk = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(disk.boot_session_id, BOOT_A);
    assert.equal(disk.awake, true);
    const second = await createAwakeIntent({ filePath, sessionIdProvider: async () => BOOT_A });
    assert.deepEqual([second.isAwake(), second.status().recovered], [true, true]);
    const laterLogon = await createAwakeIntent({ filePath, sessionIdProvider: async () => BOOT_B });
    assert.equal(laterLogon.isAwake(), false);
    assert.equal(laterLogon.status().recovery_reason, "STALE_BOOT_OR_LOGON");
  });
});

test("P1-B: clearing after proven stop remains STANDBY across same session", async () => {
  await withPath(async filePath => {
    const first = await createAwakeIntent({ filePath, sessionIdProvider: async () => BOOT_A });
    await first.wake();
    await first.clearAfterDrain();
    const newProcess = await createAwakeIntent({ filePath, sessionIdProvider: async () => BOOT_A });
    assert.equal(newProcess.isAwake(), false);
    assert.equal(newProcess.status().recovery_reason, "STANDBY_RECORD");
  });
});

test("P1-B: unverifiable identity cannot revive stale state after process restart", async () => {
  await withPath(async filePath => {
    const seed = await createAwakeIntent({ filePath, sessionIdProvider: async () => BOOT_A });
    await seed.wake();
    const unknown = await createAwakeIntent({ filePath, sessionIdProvider: async () => null });
    assert.equal(unknown.isAwake(), false);
    assert.equal(unknown.status().persistence_verified, false);
    await unknown.wake(); // valid explicit user intent, but only in this process
    assert.equal(unknown.isAwake(), true);
    const unknownAgain = await createAwakeIntent({ filePath, sessionIdProvider: async () => null });
    assert.equal(unknownAgain.isAwake(), false);
    // An in-memory session must not erase the old disk evidence.
    assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).awake, true);
  });
});

test("P1-B: corrupt record and wrong version are never authority", async () => {
  await withPath(async filePath => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{"version":999,"awake":true}', "utf8");
    const store = await createAwakeIntent({ filePath, sessionIdProvider: async () => BOOT_A });
    assert.equal(store.isAwake(), false);
  });
});

test("P1-B: persistence error fails closed and preserves previous intent", async () => {
  await withPath(async filePath => {
    const brokenFs = {
      ...fs,
      rename: async () => { throw new Error("DISK_WRITE_DENIED"); }
    };
    const store = await createAwakeIntent({
      filePath, fsApi: brokenFs, sessionIdProvider: async () => BOOT_A
    });
    await assert.rejects(store.wake(), /DISK_WRITE_DENIED/);
    assert.equal(store.isAwake(), false);
    assert.equal(store.status().recovered, false);
    const dirContents = await fs.readdir(path.dirname(filePath));
    assert.equal(dirContents.length, 0, "partial temporary files should be cleaned");
  });
});

test("P1-B: concurrent updates serialize; last accepted state wins durably", async () => {
  await withPath(async filePath => {
    const store = await createAwakeIntent({ filePath, sessionIdProvider: async () => BOOT_A });
    await Promise.all([store.wake(), store.clearAfterDrain(), store.wake()]);
    const disk = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(disk.awake, true);
    assert.equal(store.isAwake(), true);
  });
});

test("P1-B: boot/logon ID uses stable Windows boot timestamp plus unique logon SID", async () => {
  let count = 0;
  const run = async (cmd, args) => {
    count++;
    if (cmd === "whoami.exe") return { stdout: "LOGON ID SID: S-1-5-5-123-456\n" };
    if (cmd === "powershell.exe")
      return { stdout: "2026-10-13T10:32:04.0000000Z\n" };
    throw new Error("UNEXPECTED_COMMAND");
  };
  const id = await getWindowsBootSessionId({ run, platform: "win32" });
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(count, 2);
  const none = await getWindowsBootSessionId({ run, platform: "linux" });
  assert.equal(none, null);
  assert.equal(count, 2, "non-Windows must not execute Windows process probes");
  const bad = await getWindowsBootSessionId({
    run: async () => ({ stdout: "unavailable" }), platform: "win32"
  });
  assert.equal(bad, null, "unverified identity must not enable restoration");
});
