import test from "node:test";
import assert from "node:assert/strict";
import { registerHandlers } from "../src/bot/handlers.js";

type Handler = (ctx: TestContext) => Promise<void> | void;

interface ReplyRecord {
  text: string;
  options?: Record<string, unknown>;
}

interface TestContext {
  chat: {
    id: number;
  };
  from: {
    id: number;
  };
  message: {
    text: string;
  };
  callbackQuery?: {
    data?: string;
  };
  replies: ReplyRecord[];
  reply: (text: string, options?: Record<string, unknown>) => Promise<void>;
  answerCbQuery: (text?: string) => Promise<void>;
}

class FakeBot {
  readonly commands = new Map<string, Handler>();
  readonly events = new Map<string, Handler>();
  startHandler: Handler | null = null;

  start(handler: Handler): void {
    this.startHandler = handler;
  }

  command(name: string, handler: Handler): void {
    this.commands.set(name, handler);
  }

  on(event: string, handler: Handler): void {
    this.events.set(event, handler);
  }
}

function createContext(text: string, chatId = 1): TestContext {
  const replies: ReplyRecord[] = [];
  return {
    chat: {
      id: chatId
    },
    from: {
      id: chatId
    },
    message: {
      text
    },
    replies,
    reply: async (replyText: string, options?: Record<string, unknown>) => {
      replies.push({
        text: replyText,
        options
      });
    },
    answerCbQuery: async () => {}
  };
}

function createDependencies(overrides: {
  sendPrompt?: () => Promise<unknown>;
  continuePendingPrompt?: () => Promise<unknown>;
} = {}) {
  const bot = new FakeBot();
  const ptyManager = {
    getLanguage: () => "en",
    sendPrompt:
      overrides.sendPrompt ||
      (async () => ({
        started: true,
        mode: "sdk"
      })),
    continuePendingPrompt:
      overrides.continuePendingPrompt ||
      (async () => ({
        started: true,
        mode: "sdk"
      })),
    getStatus: () => ({
      backend: "sdk",
      active: false,
      activeMode: null,
      lastMode: null,
      lastExitCode: null,
      lastExitSignal: null,
      projectSessionId: null,
      preferredModel: null,
      language: "en",
      verboseOutput: false,
      ptySupported: null,
      workdir: process.cwd(),
      relativeWorkdir: ".",
      workspaceRoot: process.cwd(),
      command: "codex",
      mcpServers: []
    })
  };

  registerHandlers({
    bot,
    router: {
      routeMessage: async (text: string) => ({
        target: "pty" as const,
        prompt: text
      })
    } as any,
    ptyManager: ptyManager as any,
    shellManager: {
      isEnabled: () => false,
      isReadOnly: () => true,
      getAllowedCommands: () => [],
      inspectCommand: () => {
        throw new Error("not used");
      },
      execute: async () => ({ started: false, reason: "busy" })
    } as any,
    skills: {
      github: {
        execute: async () => ({ text: "unused" }),
        getTestStatus: async () => null
      },
      mcp: {
        execute: async () => ({ text: "unused" }),
        mcpClient: {
          listServers: () => []
        }
      }
    } as any,
    skillRegistry: {
      list: () => [],
      isEnabled: () => true,
      enable: () => ({
        changed: true,
        skills: []
      }),
      disable: () => ({
        changed: true,
        skills: []
      })
    } as any,
    scheduler: {
      triggerDailySummaryNow: async () => {}
    } as any
  });

  return { bot };
}

test("text handler warns before starting a second codex run in the same workdir", async () => {
  const { bot } = createDependencies({
    sendPrompt: async () => ({
      started: false,
      reason: "workspace_busy",
      activeMode: "sdk",
      blockingChatId: "2",
      relativeWorkdir: "."
    })
  });
  const ctx = createContext("please fix the repo");
  const textHandler = bot.events.get("text");

  if (!textHandler) {
    throw new Error("Expected text handler to be registered");
  }

  await textHandler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /\/continue/);
  assert.match(ctx.replies[0].text, /same workdir|same project|another chat/i);
});

test("continue command replays a blocked request once", async () => {
  const { bot } = createDependencies({
    continuePendingPrompt: async () => ({
      started: true,
      mode: "sdk"
    })
  });
  const ctx = createContext("/continue");
  const handler = bot.commands.get("continue");

  if (!handler) {
    throw new Error("Expected /continue handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /continu|replay/i);
});

test("continue command reports when no blocked request is pending", async () => {
  const { bot } = createDependencies({
    continuePendingPrompt: async () => ({
      started: false,
      reason: "no_pending_prompt"
    })
  });
  const ctx = createContext("/continue");
  const handler = bot.commands.get("continue");

  if (!handler) {
    throw new Error("Expected /continue handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /no blocked|nothing pending/i);
});
