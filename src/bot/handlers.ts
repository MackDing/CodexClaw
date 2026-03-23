import path from "node:path";
import { Markup } from "telegraf";
import {
  buildPlanPrompt,
  extractCommandPayload,
  suggestClosestWord
} from "./commandUtils.js";
import {
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
  t,
  type Locale
} from "./i18n.js";
import { escapeMarkdownV2, splitTelegramMessage } from "./formatter.js";
import type { Scheduler } from "../cron/scheduler.js";
import { toErrorMessage } from "../lib/errors.js";
import type { Router } from "../orchestrator/router.js";
import type { PtyManager } from "../runner/ptyManager.js";
import type {
  ShellExecutionResult,
  ShellManager
} from "../runner/shellManager.js";
import type { DevServerManager } from "../runner/devServerManager.js";
import type { SkillRegistry } from "../orchestrator/skillRegistry.js";

interface SkillResultPayload {
  text?: string;
  testJobId?: string;
  switchToRepo?: string;
}

interface RegisterHandlersOptions {
  bot: any;
  router: Router;
  ptyManager: PtyManager;
  shellManager: ShellManager;
  devServerManager: DevServerManager;
  skills: Record<string, any>;
  skillRegistry: SkillRegistry;
  scheduler: Scheduler;
  adminActions?: {
    restart?: () => Promise<void>;
  };
}

async function sendChunkedMarkdown(
  ctx: any,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
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

async function sendSkillResult(
  ctx: any,
  result: string | SkillResultPayload,
  locale: Locale = "en"
): Promise<void> {
  const payload = typeof result === "string" ? { text: result } : result;
  const text = payload?.text || t(locale, "emptyResponse");
  const markdown = escapeMarkdownV2(text);
  const chunks = splitTelegramMessage(markdown, 3900);

  for (let i = 0; i < chunks.length; i += 1) {
    const maybeMarkup =
      i === chunks.length - 1 && payload.testJobId
        ? Markup.inlineKeyboard([
            Markup.button.callback(
              t(locale, "buttonRefreshTestStatus"),
              `gh:test_status:${payload.testJobId}`
            )
          ])
        : undefined;

    await ctx.reply(chunks[i], {
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      ...(maybeMarkup ? maybeMarkup : {})
    });
  }
}

async function applySkillResult(
  ctx: any,
  result: string | SkillResultPayload,
  locale: Locale,
  ptyManager: PtyManager
): Promise<void> {
  const payload = typeof result === "string" ? { text: result } : { ...result };

  if (payload.switchToRepo) {
    try {
      ptyManager.switchWorkdir(ctx.chat.id, payload.switchToRepo);
    } catch (error) {
      const suffix = t(locale, "repoSwitchFailed", {
        error: toErrorMessage(error)
      });
      payload.text = payload.text ? `${payload.text}\n\n${suffix}` : suffix;
    }
  }

  await sendSkillResult(ctx, payload, locale);
}

function formatProjectLines(
  projects: Array<{ path: string; relativePath: string; name?: string }>,
  currentWorkdir: string
): string[] {
  return projects.map((project) => {
    const marker = project.path === currentWorkdir ? " <current>" : "";
    return `- ${project.relativePath}${marker}`;
  });
}

function formatSkillLines(
  skillStates: Array<{ name: string; enabled: boolean }>
): string[] {
  return skillStates.map(
    (skill) => `- ${skill.name}: ${skill.enabled ? "on" : "off"}`
  );
}

function suggestProjectName(
  input: string,
  projects: Array<{ relativePath: string; name?: string }>
): string | null {
  const candidates = [
    ...new Set(
      projects
        .flatMap((project) => [project.relativePath, project.name])
        .filter(Boolean) as string[]
    )
  ];

  const threshold = Math.min(
    6,
    Math.max(2, Math.ceil(String(input || "").trim().length * 0.35))
  );

  return suggestClosestWord(input, candidates, threshold);
}

function isInsideWorkspaceRoot(root: string, candidate: string): boolean {
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function extractCloneTarget(
  result: Pick<
    ShellExecutionResult,
    "status" | "command" | "output" | "workdir"
  >
): string | null {
  if (
    result.status !== "passed" ||
    !result.command ||
    !result.output ||
    !result.workdir ||
    !/^git\s+clone(?:\s|$)/i.test(result.command)
  ) {
    return null;
  }

  const match = result.output.match(/Cloning into '([^']+)'\.\.\./i);
  if (!match?.[1]) {
    return null;
  }

  return path.resolve(result.workdir, match[1]);
}

function buildShellSuccessFollowUp(
  locale: Locale,
  result: Pick<
    ShellExecutionResult,
    "status" | "command" | "output" | "workdir"
  >,
  workspaceRoot: string
): string | null {
  const cloneTarget = extractCloneTarget(result);
  if (!cloneTarget) {
    return null;
  }

  const relativePath = path.relative(workspaceRoot, cloneTarget) || ".";
  const repoCommand = isInsideWorkspaceRoot(workspaceRoot, cloneTarget)
    ? `/repo ${relativePath}`
    : "";

  return t(locale, "shellCloneSucceeded", {
    relativePath,
    workdir: cloneTarget,
    repoCommand
  });
}

export function registerHandlers({
  bot,
  router,
  ptyManager,
  shellManager,
  devServerManager,
  skills,
  skillRegistry,
  scheduler,
  adminActions
}: RegisterHandlersOptions): void {
  const localeOf = (chatId: string | number): Locale =>
    ptyManager.getLanguage(chatId);
  const handlePromptResult = async (
    ctx: any,
    locale: Locale,
    result:
      | Awaited<ReturnType<PtyManager["sendPrompt"]>>
      | Awaited<ReturnType<PtyManager["continuePendingPrompt"]>>,
    {
      announceContinue = false
    }: {
      announceContinue?: boolean;
    } = {}
  ): Promise<void> => {
    if (result.started) {
      if (announceContinue) {
        await sendChunkedMarkdown(
          ctx,
          t(locale, "continueStarted", { mode: result.mode })
        );
      }
      return;
    }

    if (result.reason === "workspace_busy") {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "workspaceContention", {
          relativeWorkdir: result.relativeWorkdir,
          mode: result.activeMode || "unknown",
          blockingChatId: result.blockingChatId,
          continueCommand: "/continue"
        })
      );
      return;
    }

    if (result.reason === "no_pending_prompt") {
      await sendChunkedMarkdown(ctx, t(locale, "continueNothingPending"));
      return;
    }

    await sendChunkedMarkdown(
      ctx,
      t(locale, "taskBusy", { mode: result.activeMode || "unknown" })
    );
  };

  bot.start(async (ctx: any) => {
    await sendChunkedMarkdown(
      ctx,
      t(localeOf(ctx.chat.id), "startLines").join("\n")
    );
  });

  bot.command("help", async (ctx: any) => {
    await sendChunkedMarkdown(
      ctx,
      t(localeOf(ctx.chat.id), "helpLines").join("\n")
    );
  });

  bot.command("status", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const status = ptyManager.getStatus(ctx.chat.id);
    const skillStates = skillRegistry.list(ctx.chat.id);
    const mcpServers = skills.mcp.mcpClient.listServers();
    const shellSummary = shellManager.isEnabled()
      ? `enabled, ${shellManager.isReadOnly() ? "read-only" : "writable"} (${shellManager.getAllowedCommands().length} prefixes)`
      : "disabled";
    const skillsSummary =
      skillStates
        .map(
          (skill: { name: string; enabled: boolean }) =>
            `${skill.name}:${skill.enabled ? "on" : "off"}`
        )
        .join(", ") || "none";
    const mcpSummary = mcpServers.length
      ? mcpServers
          .map(
            (server: { name: string; enabled: boolean; connected: boolean }) =>
              `${server.name}:${server.enabled ? "on" : "off"}/${server.connected ? "up" : "down"}`
          )
          .join(", ")
      : "none";
    await sendChunkedMarkdown(
      ctx,
      t(locale, "statusLines", {
        status,
        recentProjects:
          ptyManager
            .getRecentProjects(ctx.chat.id)
            .map((item) => item.relativePath)
            .join(", ") || ".",
        shellSummary,
        skillsSummary,
        mcpSummary
      }).join("\n")
    );
  });

  bot.command("pwd", async (ctx: any) => {
    const status = ptyManager.getStatus(ctx.chat.id);
    await sendChunkedMarkdown(
      ctx,
      t(localeOf(ctx.chat.id), "pwdLines", {
        status,
        recent:
          ptyManager
            .getRecentProjects(ctx.chat.id)
            .map((item) => item.relativePath)
            .join(", ") || "."
      }).join("\n")
    );
  });

  bot.command("repo", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const payload = extractCommandPayload(ctx.message.text, "repo");
    const status = ptyManager.getStatus(ctx.chat.id);

    if (!payload) {
      const projects = ptyManager.listProjects();
      const recent = ptyManager.getRecentProjects(ctx.chat.id);
      const lines = formatProjectLines(projects, status.workdir);
      const recentLines = recent.map((project) => `- ${project.relativePath}`);

      await sendChunkedMarkdown(
        ctx,
        t(locale, "repoList", {
          workspaceRoot: status.workspaceRoot,
          projectLines: lines,
          recentLines
        })
      );
      return;
    }

    if (/^recent$/i.test(payload)) {
      const recent = ptyManager
        .getRecentProjects(ctx.chat.id)
        .map((project) => `- ${project.relativePath}`);
      await sendChunkedMarkdown(
        ctx,
        t(locale, "repoRecent", {
          recentLines: recent
        })
      );
      return;
    }

    try {
      let target = payload;
      if (payload !== "-") {
        const projects = ptyManager.listProjects();
        const exact = projects.find(
          (project) =>
            project.relativePath === payload || project.name === payload
        );

        if (!exact) {
          const lowerPayload = payload.toLowerCase();
          const matches = projects.filter((project) =>
            project.relativePath.toLowerCase().includes(lowerPayload)
          );

          if (!matches.length) {
            const suggestion = suggestProjectName(payload, projects);
            if (suggestion) {
              throw new Error(
                t(locale, "repoSuggestion", { value: payload, suggestion })
              );
            }

            throw new Error(t(locale, "repoNoMatch", { value: payload }));
          }

          if (matches.length > 1) {
            await sendChunkedMarkdown(
              ctx,
              t(locale, "repoMultipleMatches", {
                value: payload,
                projectLines: formatProjectLines(matches, status.workdir)
              })
            );
            return;
          }

          target = matches[0].relativePath;
        }
      }

      const result =
        target === "-"
          ? ptyManager.switchToPreviousWorkdir(ctx.chat.id)
          : ptyManager.switchWorkdir(ctx.chat.id, target);
      await sendChunkedMarkdown(
        ctx,
        t(locale, "repoSwitched", {
          relativePath: result.relativePath,
          workdir: result.workdir
        })
      );
    } catch (error) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "repoSwitchFailed", { error: toErrorMessage(error) })
      );
    }
  });

  bot.command("skill", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const payload = extractCommandPayload(ctx.message.text, "skill");
    if (!payload || /^(list|status)$/i.test(payload)) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "skillList", {
          skillLines: formatSkillLines(skillRegistry.list(ctx.chat.id))
        })
      );
      return;
    }

    const [action, rawName] = payload.split(/\s+/, 2);
    if (!/^(on|off)$/i.test(action) || !rawName) {
      await sendChunkedMarkdown(ctx, t(locale, "skillUsage"));
      return;
    }

    try {
      const actionResult = /^on$/i.test(action)
        ? skillRegistry.enable(ctx.chat.id, rawName)
        : skillRegistry.disable(ctx.chat.id, rawName);
      if (/^on$/i.test(action)) {
        await sendChunkedMarkdown(
          ctx,
          t(locale, "skillStateChanged", {
            name: rawName,
            enabled: true,
            changed: actionResult.changed,
            skillLines: formatSkillLines(actionResult.skills)
          })
        );
        return;
      }

      await sendChunkedMarkdown(
        ctx,
        t(locale, "skillStateChanged", {
          name: rawName,
          enabled: false,
          changed: actionResult.changed,
          skillLines: formatSkillLines(actionResult.skills)
        })
      );
    } catch (error) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "skillManagementFailed", { error: toErrorMessage(error) })
      );
    }
  });

  bot.command("new", async (ctx: any) => {
    const result = ptyManager.resetCurrentProjectConversation(ctx.chat.id);
    await sendChunkedMarkdown(
      ctx,
      t(localeOf(ctx.chat.id), "conversationReset", { closed: result.closed })
    );
  });

  bot.command("restart", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    if (!adminActions?.restart) {
      await sendChunkedMarkdown(ctx, t(locale, "restartUnavailable"));
      return;
    }

    await sendChunkedMarkdown(ctx, t(locale, "restarting"));
    await adminActions.restart();
  });

  bot.command("exec", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const task = extractCommandPayload(ctx.message.text, "exec");
    if (!task) {
      await sendChunkedMarkdown(ctx, t(locale, "usageExec"));
      return;
    }

    const result = await ptyManager.sendPrompt(ctx, task, {
      forceExec: true,
      notice: t(locale, "execNotice")
    });

    await handlePromptResult(ctx, locale, result);
  });

  bot.command("sh", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const command = extractCommandPayload(ctx.message.text, "sh");
    if (!command) {
      await sendChunkedMarkdown(ctx, t(locale, "usageSh"));
      return;
    }

    const status = ptyManager.getStatus(ctx.chat.id);
    if (status.active) {
      await sendChunkedMarkdown(ctx, t(locale, "codexBusyForShell"));
      return;
    }

    let validation;
    try {
      validation = shellManager.inspectCommand(command, { locale });
    } catch (error) {
      await sendChunkedMarkdown(ctx, toErrorMessage(error));
      return;
    }

    if (validation.requiresConfirmation) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "shellRequiresConfirmation", {
          command: validation.commandText,
          confirmationCommand: validation.confirmationCommand
        })
      );
      return;
    }

    await sendChunkedMarkdown(
      ctx,
      t(locale, "runningSafeShell", {
        workdir: status.workdir,
        command: validation.argv.join(" ")
      })
    );

    const result = await shellManager.execute({
      chatId: ctx.chat.id,
      rawCommand: command,
      workdir: status.workdir,
      locale
    });

    if (!result.started) {
      await sendChunkedMarkdown(ctx, t(locale, "shellBusy"));
      return;
    }

    await sendChunkedMarkdown(ctx, t(locale, "shellResult", { result }));

    const followUp = buildShellSuccessFollowUp(
      locale,
      result,
      status.workspaceRoot
    );
    if (followUp) {
      await sendChunkedMarkdown(ctx, followUp);
    }
  });

  bot.command("dev", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const payload = extractCommandPayload(ctx.message.text, "dev");
    const subcommand = (payload || "status").trim().toLowerCase();
    const runtimeStatus = ptyManager.getStatus(ctx.chat.id);
    const workdir = runtimeStatus.workdir;
    const relativeWorkdir = runtimeStatus.relativeWorkdir;

    if (!subcommand || subcommand === "status") {
      const devStatus = devServerManager.getStatus(workdir);
      await sendChunkedMarkdown(
        ctx,
        t(locale, "devStatus", {
          devStatus,
          relativeWorkdir
        })
      );
      return;
    }

    if (subcommand === "start") {
      const result = await devServerManager.start({
        workdir,
        chatId: ctx.chat.id
      });

      if (result.started) {
        await sendChunkedMarkdown(
          ctx,
          t(locale, "devStarted", {
            command: result.command,
            scriptName: result.scriptName,
            relativeWorkdir
          })
        );
        return;
      }

      if (result.reason === "already_running") {
        await sendChunkedMarkdown(
          ctx,
          t(locale, "devAlreadyRunning", {
            relativeWorkdir,
            startedByChatId: result.status.startedByChatId || "unknown",
            command: result.status.command || "unknown"
          })
        );
        return;
      }

      if (result.reason === "no_package_json") {
        await sendChunkedMarkdown(
          ctx,
          t(locale, "devNoPackageJson", { relativeWorkdir })
        );
        return;
      }

      if (result.reason === "no_script") {
        await sendChunkedMarkdown(
          ctx,
          t(locale, "devNoScript", {
            relativeWorkdir,
            availableScripts: result.availableScripts.join(", ") || "(none)"
          })
        );
        return;
      }

      await sendChunkedMarkdown(
        ctx,
        t(locale, "devSpawnFailed", { error: result.error })
      );
      return;
    }

    if (subcommand === "stop") {
      const stopped = devServerManager.stop(workdir);
      await sendChunkedMarkdown(
        ctx,
        t(locale, stopped ? "devStopped" : "devNotRunning", {
          relativeWorkdir
        })
      );
      return;
    }

    if (subcommand === "logs") {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "devLogs", {
          relativeWorkdir,
          logs: devServerManager.getLogs(workdir)
        })
      );
      return;
    }

    if (subcommand === "url") {
      const url = devServerManager.getUrl(workdir);
      await sendChunkedMarkdown(
        ctx,
        t(locale, url ? "devUrl" : "devNoUrl", {
          relativeWorkdir,
          url: url || ""
        })
      );
      return;
    }

    await sendChunkedMarkdown(ctx, t(locale, "usageDev"));
  });

  bot.command("auto", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const task = extractCommandPayload(ctx.message.text, "auto");
    if (!task) {
      await sendChunkedMarkdown(ctx, t(locale, "usageAuto"));
      return;
    }

    const result = await ptyManager.sendPrompt(ctx, task, {
      forceExec: true,
      fullAuto: true,
      notice: t(locale, "autoNotice")
    });

    await handlePromptResult(ctx, locale, result);
  });

  bot.command("plan", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const task = extractCommandPayload(ctx.message.text, "plan");
    if (!task) {
      await sendChunkedMarkdown(ctx, t(locale, "usagePlan"));
      return;
    }

    const result = await ptyManager.sendPrompt(ctx, buildPlanPrompt(task), {
      forceExec: true,
      notice: t(locale, "planNotice")
    });

    await handlePromptResult(ctx, locale, result);
  });

  bot.command("continue", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const result = await ptyManager.continuePendingPrompt(ctx);
    await handlePromptResult(ctx, locale, result, {
      announceContinue: true
    });
  });

  bot.command("model", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const value = extractCommandPayload(ctx.message.text, "model");
    if (!value) {
      const status = ptyManager.getStatus(ctx.chat.id);
      await sendChunkedMarkdown(
        ctx,
        t(locale, "modelCurrent", { model: status.preferredModel })
      );
      return;
    }

    if (/^(reset|default|inherit)$/i.test(value)) {
      ptyManager.clearPreferredModel(ctx.chat.id);
      const closed = ptyManager.closeSession(ctx.chat.id);
      await sendChunkedMarkdown(ctx, t(locale, "modelReset", { closed }));
      return;
    }

    ptyManager.setPreferredModel(ctx.chat.id, value);
    const closed = ptyManager.closeSession(ctx.chat.id);
    await sendChunkedMarkdown(ctx, t(locale, "modelSet", { value, closed }));
  });

  bot.command("verbose", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const value = extractCommandPayload(ctx.message.text, "verbose");
    if (!value) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "verboseCurrent", {
          enabled: ptyManager.isVerbose(ctx.chat.id)
        })
      );
      return;
    }

    if (/^(on|true|1)$/i.test(value)) {
      ptyManager.setVerbose(ctx.chat.id, true);
      await sendChunkedMarkdown(
        ctx,
        t(locale, "verboseSet", { enabled: true })
      );
      return;
    }

    if (/^(off|false|0)$/i.test(value)) {
      ptyManager.setVerbose(ctx.chat.id, false);
      await sendChunkedMarkdown(
        ctx,
        t(locale, "verboseSet", { enabled: false })
      );
      return;
    }

    await sendChunkedMarkdown(ctx, t(locale, "usageVerbose"));
  });

  bot.command("language", async (ctx: any) => {
    const currentLocale = localeOf(ctx.chat.id);
    const value = extractCommandPayload(ctx.message.text, "language");
    if (!value) {
      await sendChunkedMarkdown(
        ctx,
        t(currentLocale, "languageCurrent", {
          language: currentLocale
        })
      );
      return;
    }

    const normalized = normalizeLanguage(value);
    if (!normalized || !SUPPORTED_LANGUAGES.includes(normalized)) {
      await sendChunkedMarkdown(ctx, t(currentLocale, "languageInvalid"));
      return;
    }

    ptyManager.setLanguage(ctx.chat.id, normalized);
    await sendChunkedMarkdown(
      ctx,
      t(normalized, "languageSet", {
        language: normalized
      })
    );
  });

  bot.command("interrupt", async (ctx: any) => {
    const ok = ptyManager.interrupt(ctx.chat.id);
    await sendChunkedMarkdown(
      ctx,
      t(localeOf(ctx.chat.id), "interruptResult", { ok })
    );
  });

  bot.command("stop", async (ctx: any) => {
    const ok = ptyManager.closeSession(ctx.chat.id);
    await sendChunkedMarkdown(
      ctx,
      t(localeOf(ctx.chat.id), "stopResult", { ok })
    );
  });

  bot.command("cron_now", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    try {
      await scheduler.triggerDailySummaryNow(ctx.from.id);
      await sendChunkedMarkdown(ctx, t(locale, "cronTriggered"));
    } catch (error) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "triggerFailed", { error: toErrorMessage(error) })
      );
    }
  });

  bot.command("gh", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    if (!skillRegistry.isEnabled(ctx.chat.id, "github")) {
      await sendChunkedMarkdown(ctx, t(locale, "githubDisabled"));
      return;
    }

    try {
      const text = extractCommandPayload(ctx.message.text, "gh") || "help";
      const result = await skills.github.execute({
        text: `/gh ${text}`,
        chatId: ctx.chat.id,
        workdir: ptyManager.getStatus(ctx.chat.id).workdir,
        locale
      });
      await applySkillResult(ctx, result, locale, ptyManager);
    } catch (error) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "githubFailed", { error: toErrorMessage(error) })
      );
    }
  });

  bot.command("mcp", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    if (!skillRegistry.isEnabled(ctx.chat.id, "mcp")) {
      await sendChunkedMarkdown(ctx, t(locale, "mcpDisabled"));
      return;
    }

    try {
      const text = ctx.message.text.trim();
      const result = await skills.mcp.execute({ text, ctx, locale });
      await applySkillResult(ctx, result, locale, ptyManager);
    } catch (error) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "mcpFailed", { error: toErrorMessage(error) })
      );
    }
  });

  bot.on("callback_query", async (ctx: any) => {
    const locale = localeOf(ctx.chat.id);
    const data = ctx.callbackQuery?.data || "";
    if (!data.startsWith("gh:test_status:")) return;

    const jobId = data.replace("gh:test_status:", "");
    const result = await skills.github.getTestStatus(jobId, locale);
    await ctx.answerCbQuery(t(locale, "callbackRefreshed"));

    if (!result) {
      await sendChunkedMarkdown(ctx, t(locale, "testJobNotFound", { jobId }));
      return;
    }

    await sendSkillResult(ctx, result, locale);
  });

  bot.on("text", async (ctx: any) => {
    const text = ctx.message.text?.trim() || "";
    const locale = localeOf(ctx.chat.id);
    if (!text) return;
    if (/^(重启\s*bot|重启机器人|restart bot)$/i.test(text)) {
      await sendChunkedMarkdown(ctx, t(locale, "useRestartCommand"));
      return;
    }
    if (/^\/\s+\S+/.test(text)) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "slashSpaceError", {
          fixed: text.replace(/^\/\s+/, "/")
        })
      );
      return;
    }
    if (text.startsWith("/")) return;

    try {
      const route = await router.routeMessage(text, {
        chatId: ctx.chat.id
      });
      if (route.target === "pty") {
        const result = await ptyManager.sendPrompt(ctx, route.prompt);
        await handlePromptResult(ctx, locale, result);
        return;
      }

      const skill = skills[route.skill];
      if (!skill) {
        await sendChunkedMarkdown(
          ctx,
          t(locale, "skillNotFound", { name: route.skill })
        );
        return;
      }

      const result = await skill.execute({
        text: route.payload,
        chatId: ctx.chat.id,
        workdir: ptyManager.getStatus(ctx.chat.id).workdir,
        locale
      });
      await applySkillResult(ctx, result, locale, ptyManager);
    } catch (error) {
      await sendChunkedMarkdown(
        ctx,
        t(locale, "processingFailed", { error: toErrorMessage(error) })
      );
    }
  });
}
