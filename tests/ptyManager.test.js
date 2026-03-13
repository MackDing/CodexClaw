import test from "node:test";
import assert from "node:assert/strict";
import { PtyManager } from "../src/runner/ptyManager.js";

function createManager() {
  return new PtyManager({
    bot: {
      telegram: {
        sendMessage: async () => ({})
      }
    },
    config: {
      runner: {
        command: "codex",
        args: [],
        cwd: process.cwd(),
        throttleMs: 10,
        maxBufferChars: 1000,
        telegramChunkSize: 3900
      },
      reasoning: {
        mode: "spoiler"
      },
      mcp: {
        servers: [{ name: "context7" }, { name: "sequential-thinking" }]
      }
    }
  });
}

test("pty manager stores model preference per chat", () => {
  const manager = createManager();

  manager.setPreferredModel(123, "gpt-5-codex");
  const status = manager.getStatus(123);

  assert.equal(status.preferredModel, "gpt-5-codex");

  manager.clearPreferredModel(123);
  assert.equal(manager.getStatus(123).preferredModel, null);
});

test("pty manager status exposes runner workdir and MCP server names", () => {
  const manager = createManager();
  const status = manager.getStatus(456);

  assert.equal(status.workdir, process.cwd());
  assert.deepEqual(status.mcpServers, ["context7", "sequential-thinking"]);
  assert.equal(status.active, false);
});
