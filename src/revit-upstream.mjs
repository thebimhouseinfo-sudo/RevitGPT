import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(process.cwd());

function resolveFromRepo(value, fallback) {
  const configured = value || fallback;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
}

class RevitUpstream {
  constructor() {
    this.phase = "sleeping";
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.lastError = null;
    this.connecting = null;
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
    this.phase = "active";
    try {
      await this.connect();
      const listed = await this.client.listTools();
      this.tools = listed.tools || [];
      this.lastError = null;
      return [...this.tools];
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.deactivate();
      throw error;
    }
  }

  async connect() {
    if (this.phase !== "active") {
      throw new Error("REVIT_MCP_SLEEPING");
    }
    if (this.client && this.transport) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const client = new Client({ name: "revitgpt-revit-upstream", version: "0.1.0" });
      const transport = new StdioClientTransport({
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
        await Promise.race([
          client.connect(transport),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Revit MCP connection timed out")), 15000)
          )
        ]);
        const listed = await client.listTools();
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

  async callTool(name, args = {}) {
    await this.connect();
    if (!this.client) throw new Error("REVIT_MCP_NOT_CONNECTED");
    try {
      return await this.client.callTool({ name, arguments: args });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.deactivate();
      throw error;
    }
  }

  status() {
    return {
      phase: this.phase,
      connected: Boolean(this.client && this.transport),
      tool_count: this.tools.length,
      last_error: this.lastError,
      python: this.python,
      entry: this.entry
    };
  }

  async deactivate() {
    const transport = this.transport;
    this.phase = "sleeping";
    this.client = null;
    this.transport = null;
    this.tools = [];
    if (transport) await transport.close().catch(() => undefined);
  }
}

export const revitUpstream = new RevitUpstream();
