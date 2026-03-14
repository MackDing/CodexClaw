import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AppConfig, McpServerConfig } from "../config.js";

interface ToolTextItem {
  text?: string;
  json?: unknown;
}

interface ToolResultLike {
  content?: string | ToolTextItem[];
}

interface McpConnection {
  client: {
    connect: (transport: unknown) => Promise<void>;
    listTools: () => Promise<{ tools?: Array<{ name?: string }> }>;
    callTool: (input: {
      name: string;
      arguments: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  transport: {
    close?: () => Promise<void>;
  };
}

export interface McpServerStatus {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  enabled: boolean;
  connected: boolean;
}

export interface McpClientSnapshot {
  disabledServers: string[];
}

interface McpClientOptions {
  onChange?: (snapshot: McpClientSnapshot) => void;
}

interface McpWarmConnectionsOptions {
  onError?: (error: unknown) => void;
}

function normalizeToolContent(result: unknown): string {
  if (!result) return "";

  if (typeof result === "string") return result;

  const content = (result as ToolResultLike & { content?: unknown }).content;

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.text) return item.text;
        if (item?.json) return JSON.stringify(item.json);
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content && typeof content === "object") {
    const record = content as ToolTextItem;
    if (record.text) {
      return String(record.text);
    }

    if (record.json !== undefined) {
      return JSON.stringify(record.json);
    }
  }

  return JSON.stringify(result);
}

export class McpClient {
  readonly config: Pick<AppConfig, "mcp">;
  readonly connections: Map<string, McpConnection>;
  disabledServers: Set<string>;
  private readonly onChange?: (snapshot: McpClientSnapshot) => void;

  constructor(
    config: Pick<AppConfig, "mcp">,
    { onChange }: McpClientOptions = {}
  ) {
    this.config = config;
    this.connections = new Map();
    this.disabledServers = new Set();
    this.onChange = onChange;
  }

  hasServers(): boolean {
    return this.config.mcp.servers.length > 0;
  }

  getServerConfig(serverName: string): McpServerConfig | null {
    return (
      this.config.mcp.servers.find((server) => server.name === serverName) ||
      null
    );
  }

  hasServer(serverName: string): boolean {
    return Boolean(this.getServerConfig(serverName));
  }

  isServerEnabled(serverName: string): boolean {
    return this.hasServer(serverName) && !this.disabledServers.has(serverName);
  }

  isServerConnected(serverName: string): boolean {
    return this.connections.has(serverName);
  }

  listServers(): McpServerStatus[] {
    return this.config.mcp.servers.map((server) => ({
      name: server.name,
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      enabled: this.isServerEnabled(server.name),
      connected: this.isServerConnected(server.name)
    }));
  }

  async connectAll(): Promise<void> {
    for (const server of this.config.mcp.servers) {
      await this.connectServer(server);
    }
  }

  warmConnections({ onError }: McpWarmConnectionsOptions = {}): void {
    void this.connectAll().catch((error: unknown) => {
      onError?.(error);
    });
  }

  async connectServer(server: McpServerConfig): Promise<void> {
    if (this.disabledServers.has(server.name)) {
      return;
    }

    if (this.connections.has(server.name)) return;

    const env = Object.fromEntries(
      Object.entries({
        ...process.env,
        ...server.env
      }).filter(([, value]) => value !== undefined)
    ) as Record<string, string>;

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env
    });

    const client = new Client(
      {
        name: "codex-telegram-claws",
        version: "0.1.0"
      },
      {
        capabilities: {}
      }
    ) as McpConnection["client"];

    await client.connect(transport);
    this.connections.set(server.name, { client, transport });
  }

  async connectServerByName(serverName: string): Promise<void> {
    const server = this.getServerConfig(serverName);
    if (!server) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    if (this.disabledServers.has(serverName)) {
      throw new Error(`MCP server is disabled: ${serverName}`);
    }

    await this.connectServer(server);
  }

  async disconnectServer(serverName: string): Promise<boolean> {
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

  async reconnectServer(serverName: string): Promise<McpServerStatus | null> {
    if (!this.hasServer(serverName)) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    if (this.disabledServers.has(serverName)) {
      throw new Error(`MCP server is disabled: ${serverName}`);
    }

    await this.disconnectServer(serverName);
    await this.connectServerByName(serverName);
    return (
      this.listServers().find((server) => server.name === serverName) || null
    );
  }

  async disableServer(
    serverName: string
  ): Promise<(McpServerStatus & { changed: boolean }) | null> {
    if (!this.hasServer(serverName)) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    if (this.disabledServers.has(serverName)) {
      const current =
        this.listServers().find((server) => server.name === serverName) || null;
      return current ? { ...current, changed: false } : null;
    }

    this.disabledServers.add(serverName);
    await this.disconnectServer(serverName);
    this.onChange?.(this.exportState());
    const current =
      this.listServers().find((server) => server.name === serverName) || null;
    return current ? { ...current, changed: true } : null;
  }

  async enableServer(
    serverName: string
  ): Promise<(McpServerStatus & { changed: boolean }) | null> {
    if (!this.hasServer(serverName)) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    if (
      !this.disabledServers.has(serverName) &&
      this.isServerConnected(serverName)
    ) {
      const current =
        this.listServers().find((server) => server.name === serverName) || null;
      return current ? { ...current, changed: false } : null;
    }

    const changed = this.disabledServers.has(serverName);
    this.disabledServers.delete(serverName);
    await this.connectServerByName(serverName);
    this.onChange?.(this.exportState());
    const current =
      this.listServers().find((server) => server.name === serverName) || null;
    return current ? { ...current, changed } : null;
  }

  exportState(): McpClientSnapshot {
    return {
      disabledServers: [...this.disabledServers].sort()
    };
  }

  restoreState(snapshot: Partial<McpClientSnapshot> = {}): void {
    const disabledServers = Array.isArray(snapshot?.disabledServers)
      ? snapshot.disabledServers.filter((serverName) =>
          this.hasServer(serverName)
        )
      : [];

    this.disabledServers = new Set(disabledServers);
  }

  async listTools(serverName: string): Promise<Array<{ name?: string }>> {
    const conn = this.connections.get(serverName);
    if (!conn) throw new Error(`MCP server not connected: ${serverName}`);
    const res = await conn.client.listTools();
    return res.tools || [];
  }

  async callTool({
    serverName,
    toolName,
    args = {}
  }: {
    serverName: string;
    toolName: string;
    args?: Record<string, unknown>;
  }): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn) throw new Error(`MCP server not connected: ${serverName}`);

    const result = await conn.client.callTool({
      name: toolName,
      arguments: args
    });

    return normalizeToolContent(result);
  }

  async gatherContextForTask(taskText: string): Promise<string> {
    if (!this.connections.size || !taskText.trim()) {
      return "";
    }

    const contextBlocks: string[] = [];
    const toolNameHints = [
      "search",
      "query",
      "lookup",
      "retrieve",
      "context",
      "find",
      "read"
    ];

    for (const [serverName, conn] of this.connections.entries()) {
      try {
        const toolsResp = await conn.client.listTools();
        const tools = toolsResp.tools || [];

        const preferredTool = tools.find((tool) => {
          const name = String(tool.name || "").toLowerCase();
          return toolNameHints.some((hint) => name.includes(hint));
        });

        if (!preferredTool?.name) continue;

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
        const message = error instanceof Error ? error.message : String(error);
        contextBlocks.push(`[${serverName}] MCP query failed: ${message}`);
      }
    }

    return contextBlocks.join("\n\n");
  }

  async closeAll(): Promise<void> {
    for (const { transport } of this.connections.values()) {
      try {
        await transport.close?.();
      } catch {
        // Ignore close errors on shutdown.
      }
    }

    this.connections.clear();
  }
}
