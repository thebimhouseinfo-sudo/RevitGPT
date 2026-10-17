import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(process.cwd());

function resolveFromRepo(value, fallback) {
  const configured = value || fallback;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
}

// One deadline for both initial MCP handshake and initial tool inventory.
/**
 * Classify only strong evidence that the Python MCP transport itself died.
 * Ordinary Revit tool errors, Native 504/timeout, or a rejected write whose
 * outcome is unknown must NEVER deactivate a healthy shared MCP.
 */
export function isUpstreamTransportFailure(error) {
  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  if (["EPIPE", "ECONNRESET", "ERR_STREAM_DESTROYED", "ERR_IPC_CHANNEL_CLOSED"].includes(code))
    return true;
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /^(?:MCP error -32000:\s*)?(?:Connection closed|Transport closed|Connection is closed|Not connected)(?:\b|:)/i.test(text) ||
    /(?:^|\s)MCP transport (?:disconnected|closed)(?:\b|:)/i.test(text);
}

function withinDeadline(task, milliseconds, label) {
  let timer;
  return Promise.race([
    task,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " timed out")), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

export class RevitUpstream {
  constructor({
    createClient = () => new Client({ name: "revitgpt-revit-upstream", version: "0.1.0" }),
    createTransport = options => new StdioClientTransport(options),
    initialDeadlineMs = 15000
  } = {}) {
    this.createClient = createClient;
    this.createTransport = createTransport;
    this.initialDeadlineMs = initialDeadlineMs;
    this.lastActivationMs = null;
    this.phase = "sleeping";
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.lastError = null;
    this.connecting = null;
    this.activation = null;
    this.generation = 0;
    this.inFlightCalls = 0;
    this.reloading = false;
  }

  get python() {
    return resolveFromRepo(
      process.env.REVIT_MCP_PYTHON,
      path.join("runtimes", "Revit-mcp", ".venv", "Scripts", "python.exe")
    );
  }

  get entry() {
    return resolveFromRepo(
      process.env.REVIT_MCP_ENTRY,
      path.join("runtimes", "Revit-mcp", "main.py")
    );
  }

  cachedTools() {
    return [...this.tools];
  }

  async activate() {
    // Admission and process watcher share one activation outcome. In
    // particular, a losing caller must not deactivate the winner.
    if (this.activation) return this.activation;
    const activation = (async () => {
      this.phase = "active";
      const started = Date.now();
      try {
        await this.connect();
        this.lastError = null;
        return this.cachedTools();
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        await this.deactivate();
        throw error;
      } finally {
        this.lastActivationMs = Date.now() - started;
      }
    })();
    this.activation = activation;
    try {
      return await activation;
    } finally {
      if (this.activation === activation) this.activation = null;
    }
  }

  async connect() {
    if (this.phase !== "active") {
      throw new Error("REVIT_MCP_SLEEPING");
    }
    if (this.client && this.transport) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const generation = this.generation;
      const client = this.createClient();
      const transport = this.createTransport({
        command: this.python,
        args: [this.entry],
        cwd: path.dirname(this.entry),
        stderr: "pipe"
      });

      let stderrTail = "";
      transport.stderr?.on("data", (chunk) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
        stderrTail = (stderrTail + text).slice(-16384);
        if (text.trim()) console.error("[Revit MCP stderr]", text.trimEnd());
      });

      try {
        const deadline = Date.now() + this.initialDeadlineMs;
        await withinDeadline(client.connect(transport),
          Math.max(1, deadline - Date.now()), "Revit MCP connection");
        const listed = await withinDeadline(client.listTools(),
          Math.max(1, deadline - Date.now()), "Revit MCP initial tools/list");
        if (generation !== this.generation || this.phase !== "active") {
          throw new Error("REVIT_MCP_ACTIVATION_CANCELLED");
        }
        this.client = client;
        this.transport = transport;
        this.tools = listed.tools || [];
      } catch (error) {
        await transport.close().catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(stderrTail.trim() ? message + "\nRevit MCP stderr:\n" + stderrTail.trim() : message);
      }
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  // An explicit DEV reload must not disconnect other chats' in-flight tools.
  // Fail immediately if busy; never wait indefinitely or replay a call.
  async reloadTools() {
    if (this.reloading) throw new Error("REVIT_MCP_RELOAD_ALREADY_RUNNING");
    if (this.inFlightCalls > 0 || this.connecting || this.activation)
      throw new Error("REVIT_MCP_RELOAD_BUSY");
    this.reloading = true;
    try {
      await this.deactivate();
      return await this.activate();
    } finally {
      this.reloading = false;
    }
  }

  async callTool(name, args = {}) {
    if (this.reloading) throw new Error("REVIT_MCP_RELOAD_IN_PROGRESS");
    this.inFlightCalls++;
    try {
      await this.connect();
      if (!this.client) throw new Error("REVIT_MCP_NOT_CONNECTED");
      try {
        return await this.client.callTool({ name, arguments: args });
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        if (isUpstreamTransportFailure(error)) await this.deactivate();
        throw error;
      }
    } finally {
      this.inFlightCalls--;
    }
  }

  status() {
    return {
      phase: this.phase,
      connected: Boolean(this.client && this.transport),
      tool_count: this.tools.length,
      in_flight_calls: this.inFlightCalls,
      reloading: this.reloading,
      last_error: this.lastError,
      last_activation_ms: this.lastActivationMs,
      python: this.python,
      entry: this.entry
    };
  }

  async deactivate() {
    this.generation++;
    const transport = this.transport;
    this.phase = "sleeping";
    this.client = null;
    this.transport = null;
    this.tools = [];
    if (transport) await transport.close().catch(() => undefined);
  }
}

export const revitUpstream = new RevitUpstream();
