export class McpSkill {
  constructor({ mcpClient }) {
    this.mcpClient = mcpClient;
  }

  supports(text) {
    const normalized = text.trim().toLowerCase();
    return normalized.startsWith("/mcp") || normalized.includes("mcp ");
  }

  async execute({ text }) {
    if (!this.mcpClient.hasServers()) {
      return {
        text: "MCP server 未配置。请先在 .env 的 MCP_SERVERS 中添加服务定义。"
      };
    }

    const normalized = text.trim();
    if (normalized.startsWith("/mcp")) {
      return this.handleCommand(normalized);
    }

    const context = await this.mcpClient.gatherContextForTask(normalized);
    if (!context) {
      return {
        text: "MCP 已连接，但没有找到可用于该请求的上下文工具。"
      };
    }

    return {
      text: `MCP Context:\n${context}`
    };
  }

  async handleCommand(rawText) {
    const stripped = rawText.replace(/^\/mcp(@\w+)?\s*/i, "").trim();
    if (!stripped) {
      return {
        text: [
          "MCP 指令示例：",
          "/mcp tools <server>",
          '/mcp call <server> <tool> {"query":"hello"}'
        ].join("\n")
      };
    }

    const [subcommand, ...rest] = stripped.split(" ");
    if (subcommand === "tools") {
      const serverName = rest[0];
      if (!serverName) {
        return { text: "用法: /mcp tools <server>" };
      }

      const tools = await this.mcpClient.listTools(serverName);
      if (!tools.length) {
        return { text: `${serverName} 没有可用工具。` };
      }

      const lines = tools.map((tool) => `- ${tool.name}: ${tool.description || "No description"}`);
      return {
        text: [`${serverName} tools:`, ...lines].join("\n")
      };
    }

    if (subcommand === "call") {
      const serverName = rest[0];
      const toolName = rest[1];
      const jsonPart = rest.slice(2).join(" ").trim();

      if (!serverName || !toolName) {
        return { text: "用法: /mcp call <server> <tool> <jsonArgs>" };
      }

      let args = {};
      if (jsonPart) {
        try {
          args = JSON.parse(jsonPart);
        } catch (error) {
          return { text: `JSON 参数解析失败: ${error.message}` };
        }
      }

      const result = await this.mcpClient.callTool({
        serverName,
        toolName,
        args
      });

      return {
        text: result || "(empty MCP response)"
      };
    }

    return { text: "未知 MCP 子命令。支持: tools, call。" };
  }
}
