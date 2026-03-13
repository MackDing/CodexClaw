import { Telegraf } from "telegraf";
import { loadConfig } from "./config.js";
import { createAuthMiddleware } from "./bot/middleware.js";
import { registerHandlers } from "./bot/handlers.js";
import { Router } from "./orchestrator/router.js";
import { McpClient } from "./orchestrator/mcpClient.js";
import { McpSkill } from "./orchestrator/skills/mcpSkill.js";
import { GitHubSkill } from "./orchestrator/skills/githubSkill.js";
import { PtyManager } from "./runner/ptyManager.js";
import { Scheduler } from "./cron/scheduler.js";

const config = loadConfig();
const bot = new Telegraf(config.telegram.botToken, {
  handlerTimeout: 120000
});

bot.use(createAuthMiddleware(config));

const mcpClient = new McpClient(config);
await mcpClient.connectAll().catch((error) => {
  console.error("[mcp] connect failed:", error.message);
});

const githubSkill = new GitHubSkill({ config });
const mcpSkill = new McpSkill({ mcpClient });
const skills = {
  github: githubSkill,
  mcp: mcpSkill
};

const router = new Router({
  mcpClient,
  skills
});

const ptyManager = new PtyManager({
  bot,
  config
});

const scheduler = new Scheduler({
  bot,
  config
});
scheduler.start();

registerHandlers({
  bot,
  router,
  ptyManager,
  skills,
  scheduler
});

bot.catch(async (error, ctx) => {
  console.error("[bot] unhandled error:", error);
  await ctx.reply(`Bot error: ${error.message}`).catch(() => {});
});

await bot.launch();
console.log("codex-telegram-claws started.");

async function shutdown(signal) {
  console.log(`Shutting down by ${signal}...`);
  scheduler.stop();
  await ptyManager.shutdown();
  await mcpClient.closeAll();
  bot.stop(signal);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
