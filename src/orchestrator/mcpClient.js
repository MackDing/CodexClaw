import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function normalizeToolContent(result) {
  if (!result) return "";

  if (typeof result === "string") return result;

  if (Array.isArray(result.content)) {
    return result.content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.text) return item.text;
        if (item?.json) return JSON.stringify(item.json);
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (result?.content?.text) return String(result.content.text);
  if (result?.content?.json) return JSON.stringify(result.content.json);

  return JSON.stringify(result);
}

export class McpClient {
  constructor(config, { onChange } = {}) {
    this.config = config;
    this.connections = new Map();
    this.disabledServers = new Set();
    this.onChange = onChange;
  }

  hasServers() {
    return this.config.mcp.servers.length > 0;
  }

  getServerConfig(serverName) {
    return this.config.mcp.servers.find((server) => server.name === serverName) || null;
  }

  hasServer(serverName) {
    return Boolean(this.getServerConfig(serverName));
  }

  isServerEnabled(serverName) {
    return this.hasServer(serverName) && !this.disabledServers.has(serverName);
  }

  isServerConnected(serverName) {
    return this.connections.has(serverName);
  }

  listServers() {
    return this.config.mcp.servers.map((server) => ({
      name: server.name,
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      enabled: this.isServerEnabled(server.name),
      connected: this.isServerConnected(server.name)
    }));
  }

  async connectAll() {
    for (const server of this.config.mcp.servers) {
      await this.connectServer(server);
    }
  }

  async connectServer(server) {
    if (this.disabledServers.has(server.name)) {
      return;
    }

    if (this.connections.has(server.name)) return;

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: {
        ...process.env,
        ...server.env
      }
    });

    const client = new Client(
      {
        name: "codex-telegram-claws",
        version: "0.1.0"
      },
      {
        capabilities: {}
      }
    );

    await client.connect(transport);
    this.connections.set(server.name, { client, transport });
  }

  async connectServerByName(serverName) {
    const server = this.getServerConfig(serverName);
    if (!server) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    if (this.disabledServers.has(serverName)) {
      throw new Error(`MCP server is disabled: ${serverName}`);
    }

    await this.connectServer(server);
  }

  async disconnectServer(serverName) {
    const conn = this.connections.get(serverName);
    if (!conn) return false;

    try {
      await conn.transport?.close?.();
    } catch {
      // Ignore close errors on runtime disconnect.
    }

    this.connections.delete(serverName);
    return true;
  }

  async reconnectServer(serverName) {
    if (!this.hasServer(serverName)) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    if (this.disabledServers.has(serverName)) {
      throw new Error(`MCP server is disabled: ${serverName}`);
    }

    await this.disconnectServer(serverName);
    await this.connectServerByName(serverName);
    return this.listServers().find((server) => server.name === serverName) || null;
  }

  async disableServer(serverName) {
    if (!this.hasServer(serverName)) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    if (this.disabledServers.has(serverName)) {
      const current = this.listServers().find((server) => server.name === serverName) || null;
      return current ? { ...current, changed: false } : null;
    }

    this.disabledServers.add(serverName);
    await this.disconnectServer(serverName);
    this.onChange?.(this.exportState());
    const current = this.listServers().find((server) => server.name === serverName) || null;
    return current ? { ...current, changed: true } : null;
  }

  async enableServer(serverName) {
    if (!this.hasServer(serverName)) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    if (!this.disabledServers.has(serverName) && this.isServerConnected(serverName)) {
      const current = this.listServers().find((server) => server.name === serverName) || null;
      return current ? { ...current, changed: false } : null;
    }

    const changed = this.disabledServers.has(serverName);
    this.disabledServers.delete(serverName);
    await this.connectServerByName(serverName);
    this.onChange?.(this.exportState());
    const current = this.listServers().find((server) => server.name === serverName) || null;
    return current ? { ...current, changed } : null;
  }

  exportState() {
    return {
      disabledServers: [...this.disabledServers].sort()
    };
  }

  restoreState(snapshot = {}) {
    const disabledServers = Array.isArray(snapshot?.disabledServers)
      ? snapshot.disabledServers.filter((serverName) => this.hasServer(serverName))
      : [];

    this.disabledServers = new Set(disabledServers);
  }

  async listTools(serverName) {
    const conn = this.connections.get(serverName);
    if (!conn) throw new Error(`MCP server not connected: ${serverName}`);
    const res = await conn.client.listTools();
    return res.tools || [];
  }

  async callTool({ serverName, toolName, args = {} }) {
    const conn = this.connections.get(serverName);
    if (!conn) throw new Error(`MCP server not connected: ${serverName}`);

    const result = await conn.client.callTool({
      name: toolName,
      arguments: args
    });

    return normalizeToolContent(result);
  }

  async gatherContextForTask(taskText) {
    if (!this.connections.size || !taskText.trim()) {
      return "";
    }

    const contextBlocks = [];
    const toolNameHints = ["search", "query", "lookup", "retrieve", "context", "find", "read"];

    for (const [serverName, conn] of this.connections.entries()) {
      try {
        const toolsResp = await conn.client.listTools();
        const tools = toolsResp.tools || [];

        const preferredTool = tools.find((tool) => {
          const name = String(tool.name || "").toLowerCase();
          return toolNameHints.some((hint) => name.includes(hint));
        });

        if (!preferredTool) continue;

        const result = await conn.client.callTool({
          name: preferredTool.name,
          arguments: {
            query: taskText,
            input: taskText,
            task: taskText
          }
        });

        const text = normalizeToolContent(result).trim();
        if (!text) continue;

        contextBlocks.push(`[${serverName}/${preferredTool.name}]\n${text}`);
      } catch (error) {
        contextBlocks.push(`[${serverName}] MCP query failed: ${error.message}`);
      }
    }

    return contextBlocks.join("\n\n");
  }

  async closeAll() {
    for (const { transport } of this.connections.values()) {
      try {
        await transport.close();
      } catch {
        // Ignore close errors on shutdown.
      }
    }

    this.connections.clear();
  }
}
