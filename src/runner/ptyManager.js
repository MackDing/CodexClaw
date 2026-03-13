import pty from "node-pty";
import throttle from "lodash.throttle";
import stripAnsi from "strip-ansi";
import { formatPtyOutput, splitTelegramMessage } from "../bot/formatter.js";

function isMessageNotModified(error) {
  return String(error?.description || error?.message || "").includes("message is not modified");
}

export class PtyManager {
  constructor({ bot, config }) {
    this.bot = bot;
    this.config = config;
    this.sessions = new Map();
  }

  ensureSession(chatId) {
    const key = String(chatId);
    const existing = this.sessions.get(key);
    if (existing) return existing;

    const proc = pty.spawn(this.config.runner.command, this.config.runner.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd: this.config.runner.cwd,
      env: {
        ...process.env,
        FORCE_COLOR: "1"
      }
    });

    const session = {
      proc,
      rawBuffer: "",
      streamMessageIds: [],
      lastRendered: "",
      flushQueue: Promise.resolve(),
      throttledFlush: null
    };

    session.throttledFlush = throttle(
      () => this.enqueueFlush(key),
      this.config.runner.throttleMs,
      { leading: true, trailing: true }
    );

    proc.onData((chunk) => {
      session.rawBuffer += stripAnsi(String(chunk || "")).replace(/\r/g, "");
      if (session.rawBuffer.length > this.config.runner.maxBufferChars) {
        session.rawBuffer = session.rawBuffer.slice(-this.config.runner.maxBufferChars);
      }
      session.throttledFlush();
    });

    proc.onExit(({ exitCode, signal }) => {
      this.enqueueFlush(key);
      this.bot.telegram
        .sendMessage(
          key,
          `Codex CLI session exited (code=${exitCode}, signal=${signal}).`
        )
        .catch(() => {});
    });

    this.sessions.set(key, session);
    return session;
  }

  enqueueFlush(chatId) {
    const key = String(chatId);
    const session = this.sessions.get(key);
    if (!session) return;

    session.flushQueue = session.flushQueue
      .then(() => this.flushToTelegram(key))
      .catch(() => {});
  }

  async flushToTelegram(chatId) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    const rawTail = session.rawBuffer.slice(-60000);
    const rendered = formatPtyOutput(rawTail, { mode: this.config.reasoning.mode });
    if (rendered === session.lastRendered) return;
    session.lastRendered = rendered;

    const chunks = splitTelegramMessage(rendered, this.config.runner.telegramChunkSize);
    const existing = session.streamMessageIds;
    const nextIds = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const existingMessageId = existing[i];

      if (existingMessageId) {
        try {
          await this.bot.telegram.editMessageText(chatId, existingMessageId, undefined, chunk, {
            parse_mode: "MarkdownV2",
            disable_web_page_preview: true
          });
          nextIds.push(existingMessageId);
        } catch (error) {
          if (!isMessageNotModified(error)) {
            const sent = await this.bot.telegram.sendMessage(chatId, chunk, {
              parse_mode: "MarkdownV2",
              disable_web_page_preview: true
            });
            nextIds.push(sent.message_id);
          } else {
            nextIds.push(existingMessageId);
          }
        }
      } else {
        const sent = await this.bot.telegram.sendMessage(chatId, chunk, {
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true
        });
        nextIds.push(sent.message_id);
      }
    }

    for (let i = chunks.length; i < existing.length; i += 1) {
      const staleId = existing[i];
      await this.bot.telegram.deleteMessage(chatId, staleId).catch(() => {});
    }

    session.streamMessageIds = nextIds;
  }

  async sendPrompt(ctx, prompt) {
    const chatId = String(ctx.chat.id);
    const session = this.ensureSession(chatId);

    if (!session.streamMessageIds.length) {
      const sent = await this.bot.telegram.sendMessage(
        chatId,
        "Codex CLI session started. Streaming output..."
      );
      session.streamMessageIds.push(sent.message_id);
    }

    session.proc.write(`${prompt}\r`);
  }

  interrupt(chatId) {
    const session = this.sessions.get(String(chatId));
    if (!session) return false;
    session.proc.write("\u0003");
    return true;
  }

  closeSession(chatId) {
    const key = String(chatId);
    const session = this.sessions.get(key);
    if (!session) return false;

    session.throttledFlush?.cancel();
    session.proc.kill();
    this.sessions.delete(key);
    return true;
  }

  async shutdown() {
    for (const chatId of this.sessions.keys()) {
      this.closeSession(chatId);
    }
  }
}
