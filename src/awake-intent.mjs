import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION = 1;

/**
 * A Windows boot + interactive-logon fingerprint.
 *
 * Do not use process.pid, Date.now()-os.uptime(), environment username or a
 * stale startup file as proof of the same session; those allow old awake state
 * to leak into a later Windows logon or change after sleep.
 *
 * If Windows cannot prove the identity, callers must NOT restore persisted
 * awake intent. Explicit new @rg admission can still awaken this process.
 */
export async function getWindowsBootSessionId({ run = execFileAsync, platform = process.platform } = {}) {
  if (platform !== "win32") return null;
  try {
    const [boot, logon] = await Promise.all([
      run("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')"
      ], { windowsHide: true, timeout: 5500 }),
      run("whoami.exe", ["/logonid"], { windowsHide: true, timeout: 3500 })
    ]);
    const bootStamp = String(boot.stdout || "").trim();
    const logonSid = String(logon.stdout || "").match(/S-1-5-5-\d+-\d+/i)?.[0];
    if (!/^\d{4}-\d\d-\d\dT/.test(bootStamp) || !logonSid) return null;
    return createHash("sha256").update(bootStamp + "|" + logonSid).digest("hex");
  } catch {
    // Diagnostic caller may emit an identity_unverified warning, never an
    // implicit recovery. The control plane must remain reachable in STANDBY.
    return null;
  }
}

function isValidRecord(value) {
  return value && value.version === VERSION &&
    typeof value.boot_session_id === "string" && /^[a-f0-9]{64}$/.test(value.boot_session_id) &&
    typeof value.awake === "boolean";
}

/**
 * One in-process authority shared by all MCP transports/chats.
 * This stores AWAKE INTENT only, not P1-C operation outcomes or STOP_PENDING.
 *
 * Persistence is performed before changing the live intent. Calls are
 * serialized to avoid a stale async write resurrecting an earlier value.
 * A NULL boot identity allows explicit in-memory wake, but cannot restore
 * stale state on a new Node process.
 */
export async function createAwakeIntent({
  filePath,
  fsApi = fs,
  sessionIdProvider = getWindowsBootSessionId
} = {}) {
  if (!filePath || typeof filePath !== "string") throw new Error("AWAKE_INTENT_PATH_REQUIRED");
  const bootSessionId = await sessionIdProvider();
  let awake = false;
  let recovered = false;
  let recoveryReason = bootSessionId ? "NO_VALID_RECORD" : "BOOT_IDENTITY_UNVERIFIED";

  try {
    const parsed = JSON.parse(await fsApi.readFile(filePath, "utf8"));
    if (bootSessionId && isValidRecord(parsed) && parsed.boot_session_id === bootSessionId) {
      awake = parsed.awake;
      recovered = awake;
      recoveryReason = awake ? "SAME_BOOT_LOGON_RECOVERED" : "STANDBY_RECORD";
    } else if (bootSessionId && isValidRecord(parsed)) {
      recoveryReason = "STALE_BOOT_OR_LOGON";
    }
  } catch {
    // A corrupt/missing record cannot cause auto wake.
  }

  let chain = Promise.resolve();
  async function update(next) {
    const operation = chain.catch(() => undefined).then(async () => {
      if (bootSessionId) {
        const record = {
          version: VERSION, boot_session_id: bootSessionId, awake: next,
          updated_at: new Date().toISOString()
        };
        const temp = filePath + ".tmp-" + randomUUID();
        await fsApi.mkdir(path.dirname(filePath), { recursive: true });
        try {
          await fsApi.writeFile(temp, JSON.stringify(record) + "\n", "utf8");
          await fsApi.rename(temp, filePath);
        } catch (error) {
          await fsApi.unlink(temp).catch(() => undefined);
          throw error;
        }
      }
      awake = next;
      recoveryReason = bootSessionId ? (next ? "EXPLICIT_AWAKE" : "EXPLICIT_STANDBY") :
        "UNVERIFIED_IN_MEMORY_ONLY";
      return status();
    });
    chain = operation;
    return operation;
  }

  function status() {
    return {
      awake,
      recovered,
      persistence_verified: Boolean(bootSessionId),
      recovery_reason: recoveryReason
    };
  }

  return Object.freeze({
    status, isAwake: () => awake,
    wake: () => update(true),
    clearAfterDrain: () => update(false)
  });
}
