import { spawn } from "node:child_process";
import process from "node:process";
import { Telegraf } from "telegraf";
import { loadConfig } from "./config.js";
import { RuntimeStateStore } from "./runtimeStateStore.js";
import { createAuthMiddleware } from "./bot/middleware.js";
import { registerHandlers } from "./bot/handlers.js";
import { Router } from "./orchestrator/router.js";
import { McpClient } from "./orchestrator/mcpClient.js";
import { SkillRegistry } from "./orchestrator/skillRegistry.js";
import { McpSkill } from "./orchestrator/skills/mcpSkill.js";
import { GitHubSkill } from "./orchestrator/skills/githubSkill.js";
import { PtyManager } from "./runner/ptyManager.js";
import { ShellManager } from "./runner/shellManager.js";
import { DevServerManager } from "./runner/devServerManager.js";
import { Scheduler } from "./cron/scheduler.js";
import { toErrorMessage } from "./lib/errors.js";
import { createTelegramApiAgent } from "./lib/telegramApi.js";

const config = loadConfig();
const telegramApiAgent = createTelegramApiAgent(config.telegram.proxyUrl);
const bot = new Telegraf(config.telegram.botToken, {
  handlerTimeout: 120000,
  telegram: {
    apiRoot: config.telegram.apiBase,
    ...(telegramApiAgent
      ? { agent: telegramApiAgent, attachmentAgent: telegramApiAgent }
      : {})
  }
});
const stateStore = new RuntimeStateStore({ config });
let mcpClient: McpClient | null = null;
let skillRegistry: SkillRegistry | null = null;
let ptyManager: PtyManager | null = null;

async function saveRuntimeState(): Promise<void> {
  if (!mcpClient || !skillRegistry || !ptyManager) return;
  await stateStore.save({
    mcp: mcpClient.exportState(),
    skills: skillRegistry.exportState(),
    runner: ptyManager.exportState()
  });
}

async function restartBotProcess(): Promise<void> {
  await saveRuntimeState();

  const bootstrapScript = [
    "const { spawn } = require('node:child_process');",
    "const cliPath = require.resolve('tsx/dist/cli.mjs');",
    "setTimeout(() => {",
    `  const child = spawn(process.execPath, [cliPath, 'src/index.ts'], { cwd: ${JSON.stringify(process.cwd())}, env: process.env, detached: true, stdio: 'ignore' });`,
    "  child.unref();",
    "}, 1500);"
  ].join("\n");

  const launcher = spawn(process.execPath, ["-e", bootstrapScript], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore"
  });
  launcher.unref();

  await shutdown("RESTART");
}

bot.use(createAuthMiddleware(config));

const runtimeState = await stateStore.load();
mcpClient = new McpClient(config, {
  onChange: () => void saveRuntimeState()
});
mcpClient.restoreState(runtimeState.mcp);
mcpClient.warmConnections({
  onError: (error: unknown) => {
    const message = toErrorMessage(error);
    console.error("[mcp] connect failed:", message);
  }
});

const githubSkill = new GitHubSkill({ config });
const mcpSkill = new McpSkill({ mcpClient });
const skills = {
  github: githubSkill,
  mcp: mcpSkill
};
skillRegistry = new SkillRegistry(skills, {
  onChange: () => void saveRuntimeState()
});
skillRegistry.restoreState(runtimeState.skills);

const router = new Router({
  skills,
  isSkillEnabled: (chatId, skillName) =>
    skillRegistry?.isEnabled(chatId ?? "", skillName) ?? false
});

ptyManager = new PtyManager({
  bot,
  config,
  onChange: () => void saveRuntimeState()
});
ptyManager.restoreState(runtimeState.runner);
const shellManager = new ShellManager({
  config
});
const devServerManager = new DevServerManager();

const scheduler = new Scheduler({
  bot,
  config
});
scheduler.start();

registerHandlers({
  bot,
  router,
  ptyManager,
  shellManager,
  devServerManager,
  skills,
  skillRegistry,
  scheduler,
  adminActions: {
    restart: restartBotProcess
  }
});

bot.catch(async (error: unknown, ctx: any) => {
  console.error("[bot] unhandled error:", error);
  const message = toErrorMessage(error);
  await ctx.reply(`Bot error: ${message}`).catch(() => {});
});

await bot.launch();
console.log("CodexClaw started.");

async function shutdown(signal: string): Promise<void> {
  console.log(`Shutting down by ${signal}...`);
  scheduler.stop();
  await ptyManager?.shutdown();
  await devServerManager.shutdown();
  await mcpClient?.closeAll();
  bot.stop(signal);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
