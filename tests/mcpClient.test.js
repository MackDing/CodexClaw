import test from "node:test";
import assert from "node:assert/strict";
import { McpClient } from "../src/orchestrator/mcpClient.js";

function createClient() {
  return new McpClient({
    mcp: {
      servers: [
        {
          name: "context7",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
          cwd: process.cwd(),
          env: {}
        },
        {
          name: "sequential-thinking",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
          cwd: process.cwd(),
          env: {}
        }
      ]
    }
  });
}

test("mcp client lists configured servers and their runtime state", () => {
  const client = createClient();
  client.connections.set("context7", {
    transport: {
      close: async () => {}
    }
  });

  assert.deepEqual(client.listServers().map((server) => ({
    name: server.name,
    enabled: server.enabled,
    connected: server.connected
  })), [
    { name: "context7", enabled: true, connected: true },
    { name: "sequential-thinking", enabled: true, connected: false }
  ]);
});

test("mcp client disable and enable update runtime state", async () => {
  const client = createClient();
  let connectCalls = 0;
  client.connectServer = async (server) => {
    connectCalls += 1;
    client.connections.set(server.name, {
      transport: {
        close: async () => {}
      }
    });
  };

  const disabled = await client.disableServer("context7");
  assert.equal(disabled.changed, true);
  assert.equal(client.isServerEnabled("context7"), false);
  assert.equal(client.isServerConnected("context7"), false);

  const enabled = await client.enableServer("context7");
  assert.equal(enabled.changed, true);
  assert.equal(client.isServerEnabled("context7"), true);
  assert.equal(client.isServerConnected("context7"), true);
  assert.equal(connectCalls, 1);
});

test("mcp client reconnect refreshes a known enabled server", async () => {
  const client = createClient();
  const closes = [];
  let connectCalls = 0;
  client.connections.set("context7", {
    transport: {
      close: async () => {
        closes.push("context7");
      }
    }
  });
  client.connectServer = async (server) => {
    connectCalls += 1;
    client.connections.set(server.name, {
      transport: {
        close: async () => {}
      }
    });
  };

  const result = await client.reconnectServer("context7");

  assert.equal(result.name, "context7");
  assert.equal(result.connected, true);
  assert.deepEqual(closes, ["context7"]);
  assert.equal(connectCalls, 1);
});

test("mcp client exports and restores disabled server state", () => {
  const client = createClient();
  client.restoreState({
    disabledServers: ["sequential-thinking"]
  });

  assert.deepEqual(client.exportState(), {
    disabledServers: ["sequential-thinking"]
  });
  assert.equal(client.isServerEnabled("sequential-thinking"), false);
  assert.equal(client.isServerEnabled("context7"), true);
});

test("mcp client reports idempotent enable and disable operations", async () => {
  const client = createClient();
  client.connectServer = async (server) => {
    client.connections.set(server.name, {
      transport: {
        close: async () => {}
      }
    });
  };
  client.connections.set("context7", {
    transport: {
      close: async () => {}
    }
  });

  assert.equal((await client.enableServer("context7")).changed, false);
  assert.equal((await client.disableServer("context7")).changed, true);
  assert.equal((await client.disableServer("context7")).changed, false);
});
