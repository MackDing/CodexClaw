import cron from "node-cron";
import simpleGit from "simple-git";
import { escapeMarkdownV2 } from "../bot/formatter.js";

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

export class Scheduler {
  constructor({ bot, config }) {
    this.bot = bot;
    this.config = config;
    this.tasks = [];
    this.git = simpleGit({
      baseDir: config.github.defaultWorkdir
    });
  }

  start() {
    const task = cron.schedule(
      this.config.cron.dailySummary,
      async () => {
        const report = await this.buildDailySummary();
        await this.pushToUsers(report);
      },
      {
        timezone: this.config.cron.timezone
      }
    );

    this.tasks.push(task);
    task.start();
  }

  stop() {
    for (const task of this.tasks) {
      task.stop();
      task.destroy();
    }
    this.tasks = [];
  }

  async triggerDailySummaryNow(targetUserId) {
    const report = await this.buildDailySummary();
    if (targetUserId) {
      await this.bot.telegram.sendMessage(String(targetUserId), escapeMarkdownV2(report), {
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true
      });
      return;
    }

    await this.pushToUsers(report);
  }

  async pushToUsers(report) {
    const message = escapeMarkdownV2(report);
    for (const userId of this.config.telegram.proactiveUserIds) {
      await this.bot.telegram.sendMessage(String(userId), message, {
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true
      });
    }
  }

  async buildDailySummary() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const since = startOfYesterday.toISOString();
    const until = startOfToday.toISOString();

    let commitCount = 0;
    let commitLines = [];
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    try {
      const logs = await this.git.log({ "--since": since, "--until": until, maxCount: 20 });
      commitCount = logs.total;
      commitLines = logs.all.slice(0, 8).map((entry) => `- ${entry.hash.slice(0, 7)} ${entry.message}`);
    } catch (error) {
      commitLines = [`- git log error: ${error.message}`];
    }

    try {
      const diff = await this.git.diffSummary([`${since}..${until}`]);
      filesChanged = diff.changed;
      insertions = diff.insertions;
      deletions = diff.deletions;
    } catch {
      // Ignore diff failures in empty repositories.
    }

    return [
      `Daily Code Summary (${dateOnly(startOfYesterday)})`,
      `Commits: ${commitCount}`,
      `Files changed: ${filesChanged}`,
      `Insertions: ${insertions}`,
      `Deletions: ${deletions}`,
      "",
      "Recent commits:",
      ...(commitLines.length ? commitLines : ["- No commits yesterday."])
    ].join("\n");
  }
}
