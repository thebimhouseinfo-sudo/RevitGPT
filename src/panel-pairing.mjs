import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest();
const same = (a, b) => a.length === b.length && timingSafeEqual(a, b);

/**
 * Local-panel pairing only. A code is shown to the authenticated ChatGPT
 * session and entered out-of-band in the native WPF panel. The returned
 * 256-bit bearer is held only in the native process; never in WebView2.
 * All grants are read-only and bound to exactly one MCP server instance.
 */
export class PanelPairingRegistry {
  constructor({ now = Date.now, bytes = randomBytes, pendingMs = 300000,
    pairedMs = 8 * 3600000, maxEntries = 64 } = {}) {
    this.now = now;
    this.bytes = bytes;
    this.pendingMs = pendingMs;
    this.pairedMs = pairedMs;
    this.maxEntries = maxEntries;
    this.pending = new Map();
    this.paired = new Map();
  }
  sweep() {
    const now = this.now();
    for (const [key,value] of this.pending)
      if (value.expires <= now) this.pending.delete(key);
    for (const [key,value] of this.paired)
      if (value.expires <= now) this.paired.delete(key);
  }
  begin(authority) {
    this.sweep();
    if (!authority || typeof authority.leaseCurrent !== "function")
      throw new Error("PAIRING_INVALID_OWNER");
    // There can be only one pending challenge for an MCP session.
    for (const [key,value] of this.pending)
      if (value.authority === authority) this.pending.delete(key);
    if (this.pending.size >= this.maxEntries) throw new Error("PAIRING_CAPACITY_EXCEEDED");
    const code = this.bytes(16).toString("hex").toUpperCase();
    const hash = digest(code).toString("hex");
    this.pending.set(hash, { authority, expires: this.now() + this.pendingMs });
    return { code, expires_in_seconds: Math.ceil(this.pendingMs / 1000) };
  }
  claim(input) {
    this.sweep();
    const code = String(input || "").trim().toUpperCase();
    if (!/^[0-9A-F]{32}$/.test(code)) throw new Error("PANEL_PAIR_CODE_INVALID");
    const hash = digest(code).toString("hex");
    let match;
    // Constant-time comparison also prevents early-return timing leaks.
    for (const [key,value] of this.pending) {
      if (same(Buffer.from(key,"hex"),Buffer.from(hash,"hex"))) match={key,value};
    }
    if (!match) throw new Error("PANEL_PAIR_CODE_INVALID_OR_EXPIRED");
    this.pending.delete(match.key); // single-use even on later failure
    // Re-pairing this ChatGPT session revokes its previously issued panel token.
    for (const [key,value] of this.paired)
      if (value.authority === match.value.authority) this.paired.delete(key);
    if (this.paired.size >= this.maxEntries) throw new Error("PAIRING_CAPACITY_EXCEEDED");
    const token = this.bytes(32).toString("hex");
    this.paired.set(digest(token).toString("hex"), {
      authority:match.value.authority,expires:this.now()+this.pairedMs
    });
    return { token, expires_in_seconds:Math.ceil(this.pairedMs/1000) };
  }
  async lease(token, claimed) {
    this.sweep();
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token))
      throw new Error("PANEL_SESSION_NOT_PAIRED");
    const entry = this.paired.get(digest(token).toString("hex"));
    if (!entry) throw new Error("PANEL_SESSION_NOT_PAIRED");
    if (!claimed || typeof claimed !== "object" ||
        !Number.isSafeInteger(claimed.revision) || claimed.revision < 1 ||
        typeof claimed.host_instance_id !== "string" ||
        typeof claimed.bound_id !== "string")
      throw new Error("PANEL_BIND_CONFIRMATION_INVALID");
    // authority.leaseCurrent() rechecks native status before granting.
    const lease = await entry.authority.leaseCurrent();
    if (lease.revision !== claimed.revision ||
        lease.host_instance_id !== claimed.host_instance_id ||
        lease.bound_id !== claimed.bound_id) {
      entry.authority.clear();
      throw new Error("PANEL_BIND_CONFIRMATION_STALE");
    }
    return { status:"LEASED_READ_ONLY", bound_title:lease.bound_title };
  }
}
