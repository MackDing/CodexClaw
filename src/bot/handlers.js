import { Markup } from "telegraf";
import { escapeMarkdownV2, splitTelegramMessage } from "./formatter.js";

async function sendChunkedMarkdown(ctx, text, extra = {}) {
  const markdown = escapeMarkdownV2(text);
  const chunks = splitTelegramMessage(markdown, 3900);

  for (let i = 0; i < chunks.length; i += 1) {
    await ctx.reply(chunks[i], {
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      ...extra
    });
  }
}

async function sendSkillResult(ctx, result) {
  const payload = typeof result === "string" ? { text: result } : result;
  const text = payload?.text || "(empty response)";
  const markdown = escapeMarkdownV2(text);
  const chunks = splitTelegramMessage(markdown, 3900);

  for (let i = 0; i < chunks.length; i += 1) {
    const maybeMarkup =
      i === chunks.length - 1 && payload.testJobId
        ? Markup.inlineKeyboard([
            Markup.button.callback("刷新测试状态", `gh:test_status:${payload.testJobId}`)
          ])
        : undefined;

    await ctx.reply(chunks[i], {
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      ...(maybeMarkup ? maybeMarkup : {})
    });
  }
}

export function registerHandlers({ bot, router, ptyManager, skills, scheduler }) {
  bot.start(async (ctx) => {
    await sendChunkedMarkdown(
      ctx,
      [
        "codex-telegram-claws ready.",
        "发送编码任务会路由到 Codex CLI。",
        "发送通用检索任务会尝试走 MCP Skill。",
        "GitHub 指令示例: /gh commit \"feat: init\""
      ].join("\n")
    );
  });

  bot.command("help", async (ctx) => {
    await sendChunkedMarkdown(
      ctx,
      [
        "Commands:",
        "/help - 显示帮助",
        "/interrupt - 向 Codex CLI 发送 Ctrl+C",
        "/stop - 终止当前 chat 的 PTY 会话",
        "/cron_now - 立即触发一次日报推送",
        "/gh ... - GitHub skill",
        "/mcp ... - MCP skill"
      ].join("\n")
    );
  });

  bot.command("interrupt", async (ctx) => {
    const ok = ptyManager.interrupt(ctx.chat.id);
    await sendChunkedMarkdown(ctx, ok ? "已发送 Ctrl+C。" : "当前 chat 没有活动 PTY 会话。");
  });

  bot.command("stop", async (ctx) => {
    const ok = ptyManager.closeSession(ctx.chat.id);
    await sendChunkedMarkdown(ctx, ok ? "PTY 会话已终止。" : "当前 chat 没有活动 PTY 会话。");
  });

  bot.command("cron_now", async (ctx) => {
    try {
      await scheduler.triggerDailySummaryNow(ctx.from.id);
      await sendChunkedMarkdown(ctx, "日报已触发并推送。");
    } catch (error) {
      await sendChunkedMarkdown(ctx, `触发失败: ${error.message}`);
    }
  });

  bot.command("gh", async (ctx) => {
    try {
      const text = ctx.message.text.replace(/^\/gh(@\w+)?\s*/i, "").trim() || "help";
      const result = await skills.github.execute({ text: `/gh ${text}`, ctx });
      await sendSkillResult(ctx, result);
    } catch (error) {
      await sendChunkedMarkdown(ctx, `GitHub skill 执行失败: ${error.message}`);
    }
  });

  bot.command("mcp", async (ctx) => {
    try {
      const text = ctx.message.text.trim();
      const result = await skills.mcp.execute({ text, ctx });
      await sendSkillResult(ctx, result);
    } catch (error) {
      await sendChunkedMarkdown(ctx, `MCP skill 执行失败: ${error.message}`);
    }
  });

  bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery?.data || "";
    if (!data.startsWith("gh:test_status:")) return;

    const jobId = data.replace("gh:test_status:", "");
    const result = await skills.github.getTestStatus(jobId);
    await ctx.answerCbQuery("状态已刷新");

    if (!result) {
      await sendChunkedMarkdown(ctx, `找不到测试任务: ${jobId}`);
      return;
    }

    await sendSkillResult(ctx, result);
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text?.trim() || "";
    if (!text || text.startsWith("/")) return;

    try {
      const route = await router.routeMessage(text);
      if (route.target === "pty") {
        await ptyManager.sendPrompt(ctx, route.prompt);
        return;
      }

      const skill = skills[route.skill];
      if (!skill) {
        await sendChunkedMarkdown(ctx, `未找到 skill: ${route.skill}`);
        return;
      }

      const result = await skill.execute({
        text: route.payload,
        ctx
      });
      await sendSkillResult(ctx, result);
    } catch (error) {
      await sendChunkedMarkdown(ctx, `处理消息失败: ${error.message}`);
    }
  });
}
