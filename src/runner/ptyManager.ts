import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import process from "node:process";
import pty from "node-pty";
import throttle from "lodash.throttle";
import stripAnsi from "strip-ansi";
import type { AppConfig } from "../config.js";
import { formatPtyOutput, splitTelegramMessage } from "../bot/formatter.js";
import { normalizeLanguage, t } from "../bot/i18n.js";
import { repairNodePtySpawnHelperPermissions } from "./ptyPreflight.js";

type Locale = "en" | "zh" | "zh-HK";
type SessionMode = "pty" | "exec";
type ExitSignal = number | NodeJS.Signals | null;

interface PtyProcess {
  write(input: string): void;
  kill(): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal: number }) => void): void;
}

interface TelegramMessage {
  message_id: number;
}

interface TelegramApiLike {
  sendMessage(
    chatId: string | number,
    text: string,
    options?: Record<string, unknown>
  ): Promise<TelegramMessage>;
  editMessageText(
    chatId: string | number,
    messageId: number,
    inlineMessageId: string | undefined,
    text: string,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  deleteMessage(chatId: string | number, messageId: number): Promise<unknown>;
}

interface BotLike {
  telegram: TelegramApiLike;
}

interface ProjectConversationState {
  lastSessionId: string;
  lastMode: SessionMode | null;
  lastExitCode: number | null;
  lastExitSignal: ExitSignal;
}

interface ChatRuntimeState {
  preferredModel: string | null;
  language: Locale;
  verboseOutput: boolean;
  currentWorkdir: string;
  recentWorkdirs: string[];
  ptySupported: boolean | null;
  projectStates: Map<string, ProjectConversationState>;
}

interface RunnerSession {
  chatId: string;
  mode: SessionMode;
  workdir: string;
  model: string | null;
  sessionId: string;
  trackConversation: boolean;
  proc: PtyProcess | ChildProcessWithoutNullStreams | null;
  rawBuffer: string;
  streamMessageIds: number[];
  lastRendered: string;
  flushQueue: Promise<void>;
  throttledFlush: ReturnType<typeof throttle>;
  write: ((input: string) => void) | null;
  interrupt: (() => void) | null;
  close: (() => void) | null;
}

interface SessionOptions {
  workdir?: string;
  resumeSessionId?: string;
  initialPrompt?: string;
  fullAuto?: boolean;
  extraArgs?: string[];
  trackConversation?: boolean;
}

interface SendPromptOptions {
  forceExec?: boolean;
  fullAuto?: boolean;
  extraArgs?: string[];
  notice?: string;
}

interface SendPromptContext {
  chat: {
    id: string | number;
  };
}

interface StoredProjectConversationState {
  lastSessionId?: unknown;
  lastMode?: unknown;
  lastExitCode?: unknown;
  lastExitSignal?: unknown;
}

interface StoredChatRuntimeState {
  preferredModel?: unknown;
  language?: unknown;
  verboseOutput?: unknown;
  currentWorkdir?: unknown;
  recentWorkdirs?: unknown;
  projects?: Record<string, StoredProjectConversationState>;
}

export interface PtyManagerSnapshot {
  chats: Record<
    string,
    {
      preferredModel: string | null;
      language: Locale;
      verboseOutput: boolean;
      currentWorkdir: string;
      recentWorkdirs: string[];
      projects: Record<
        string,
        {
          lastSessionId: string;
          lastMode: SessionMode | null;
          lastExitCode: number | null;
          lastExitSignal: ExitSignal;
        }
      >;
    }
  >;
}

export interface PtyManagerStatus {
  active: boolean;
  activeMode: SessionMode | null;
  lastMode: SessionMode | null;
  lastExitCode: number | null;
  lastExitSignal: ExitSignal;
  projectSessionId: string | null;
  preferredModel: string | null;
  language: Locale;
  verboseOutput: boolean;
  ptySupported: boolean | null;
  workdir: string;
  relativeWorkdir: string;
  workspaceRoot: string;
  command: string;
  mcpServers: string[];
}

interface PtyManagerOptions {
  bot: BotLike;
  config: Pick<AppConfig, "runner" | "workspace" | "reasoning" | "mcp">;
  onChange?: (snapshot: PtyManagerSnapshot) => void;
}

function isMessageNotModified(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { description?: unknown; message?: unknown };
  return String(candidate.description || candidate.message || "").includes(
    "message is not modified"
  );
}

function isPtySpawnFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { message?: unknown };
  return String(candidate.message || "").includes("posix_spawnp failed");
}

function extractSessionId(rawText: string): string {
  const matched = String(rawText || "").match(/session id:\s*([0-9a-f-]{36})/i);
  return matched?.[1] || "";
}

function isLocale(value: string): value is Locale {
  return value === "en" || value === "zh" || value === "zh-HK";
}

function toLocale(value: string): Locale {
  return isLocale(value) ? value : "en";
}

export class PtyManager {
  readonly bot: BotLike;
  readonly config: Pick<
    AppConfig,
    "runner" | "workspace" | "reasoning" | "mcp"
  >;
  readonly sessions: Map<string, RunnerSession>;
  readonly chatState: Map<string, ChatRuntimeState>;
  readonly ptyPreflight: {
    path: string;
    changed: boolean;
    executable: boolean;
    error?: string;
  };
  private readonly onChange?: (snapshot: PtyManagerSnapshot) => void;

  constructor({ bot, config, onChange }: PtyManagerOptions) {
    this.bot = bot;
    this.config = config;
    this.onChange = onChange;
    this.sessions = new Map();
    this.chatState = new Map();
    this.ptyPreflight = repairNodePtySpawnHelperPermissions();

    if (this.ptyPreflight.error) {
      console.warn(
        `[runner] node-pty preflight failed: ${this.ptyPreflight.error}`
      );
    } else if (this.ptyPreflight.changed) {
      console.info(
        `[runner] repaired node-pty helper permissions: ${this.ptyPreflight.path}`
      );
    }
  }

  ensureChatState(chatId: string | number): ChatRuntimeState {
    const key = String(chatId);
    const existing = this.chatState.get(key);
    if (existing) return existing;

    const state: ChatRuntimeState = {
      preferredModel: null,
      language: "en",
      verboseOutput: false,
      currentWorkdir: this.config.runner.cwd,
      recentWorkdirs: [this.config.runner.cwd],
      ptySupported: null,
      projectStates: new Map([
        [
          this.config.runner.cwd,
          {
            lastSessionId: "",
            lastMode: null,
            lastExitCode: null,
            lastExitSignal: null
          }
        ]
      ])
    };

    this.chatState.set(key, state);
    return state;
  }

  ensureProjectState(
    chatId: string | number,
    workdir = this.getWorkdir(chatId)
  ): ProjectConversationState {
    const key = String(chatId);
    const state = this.ensureChatState(key);
    const resolvedWorkdir = path.resolve(
      workdir || state.currentWorkdir || this.config.runner.cwd
    );
    const existing = state.projectStates.get(resolvedWorkdir);
    if (existing) return existing;

    const projectState: ProjectConversationState = {
      lastSessionId: "",
      lastMode: null,
      lastExitCode: null,
      lastExitSignal: null
    };

    state.projectStates.set(resolvedWorkdir, projectState);
    return projectState;
  }

  getCommandArgsForSession(chatId: string | number): string[] {
    const state = this.ensureChatState(chatId);
    const args = [...this.config.runner.args];
    if (state.preferredModel) {
      args.push("-m", state.preferredModel);
    }
    return args;
  }

  isVerbose(chatId: string | number): boolean {
    const state = this.ensureChatState(chatId);
    return Boolean(state.verboseOutput);
  }

  getLanguage(chatId: string | number): Locale {
    const state = this.ensureChatState(chatId);
    return toLocale(normalizeLanguage(state.language) || "en");
  }

  setLanguage(chatId: string | number, language: string): Locale {
    const normalized = normalizeLanguage(language);
    if (!normalized) {
      throw new Error("Unsupported language.");
    }

    const state = this.ensureChatState(chatId);
    state.language = toLocale(normalized);
    this.onChange?.(this.exportState());
    return state.language;
  }

  setVerbose(chatId: string | number, enabled: boolean): boolean {
    const state = this.ensureChatState(chatId);
    state.verboseOutput = Boolean(enabled);
    this.onChange?.(this.exportState());
    return state.verboseOutput;
  }

  getWorkdir(chatId: string | number): string {
    const state = this.ensureChatState(chatId);
    return state.currentWorkdir || this.config.runner.cwd;
  }

  getRelativeWorkdir(chatId: string | number): string {
    const workdir = this.getWorkdir(chatId);
    const relative = path.relative(this.config.workspace.root, workdir);
    return relative || ".";
  }

  getProjectState(
    chatId: string | number,
    workdir = this.getWorkdir(chatId)
  ): ProjectConversationState {
    return this.ensureProjectState(chatId, workdir);
  }

  rememberWorkdir(state: ChatRuntimeState, workdir: string): void {
    const history = [
      workdir,
      ...(state.recentWorkdirs || []).filter((item) => item !== workdir)
    ];
    state.recentWorkdirs = history.slice(0, 6);
  }

  isInsideWorkspaceRoot(candidate: string): boolean {
    const root = path.resolve(this.config.workspace.root);
    const target = path.resolve(candidate);
    const relative = path.relative(root, target);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }

  listProjects(): Array<{ name: string; path: string; relativePath: string }> {
    const root = this.config.workspace.root;
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const projects: Array<{
      name: string;
      path: string;
      relativePath: string;
    }> = [];

    if (fs.existsSync(path.join(root, ".git"))) {
      projects.push({
        name: path.basename(root),
        path: root,
        relativePath: "."
      });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(root, entry.name);
      if (!fs.existsSync(path.join(fullPath, ".git"))) continue;

      projects.push({
        name: entry.name,
        path: fullPath,
        relativePath: entry.name
      });
    }

    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  getRecentProjects(
    chatId: string | number
  ): Array<{ path: string; relativePath: string }> {
    const state = this.ensureChatState(chatId);
    return (state.recentWorkdirs || [])
      .filter(
        (workdir) =>
          fs.existsSync(workdir) && this.isInsideWorkspaceRoot(workdir)
      )
      .map((workdir) => ({
        path: workdir,
        relativePath: path.relative(this.config.workspace.root, workdir) || "."
      }));
  }

  switchWorkdir(
    chatId: string | number,
    targetName: string
  ): { workdir: string; relativePath: string } {
    const key = String(chatId);
    const requested = String(targetName || "").trim();
    if (!requested) {
      throw new Error(t(this.getLanguage(key), "projectNameRequired"));
    }

    const root = this.config.workspace.root;
    let targetPath: string;

    if (requested === "." || requested === path.basename(root)) {
      targetPath = root;
    } else {
      targetPath = path.resolve(root, requested);
    }

    if (!this.isInsideWorkspaceRoot(targetPath)) {
      throw new Error(t(this.getLanguage(key), "targetOutsideWorkspaceRoot"));
    }

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
      throw new Error(
        t(this.getLanguage(key), "projectDirDoesNotExist", { path: targetPath })
      );
    }

    if (!fs.existsSync(path.join(targetPath, ".git"))) {
      throw new Error(
        t(this.getLanguage(key), "targetNotGitRepository", { path: targetPath })
      );
    }

    const state = this.ensureChatState(key);
    this.ensureProjectState(key, targetPath);
    state.currentWorkdir = targetPath;
    this.rememberWorkdir(state, targetPath);
    this.closeSession(key);
    this.onChange?.(this.exportState());

    return {
      workdir: targetPath,
      relativePath: path.relative(root, targetPath) || "."
    };
  }

  switchToPreviousWorkdir(chatId: string | number): {
    workdir: string;
    relativePath: string;
  } {
    const key = String(chatId);
    const state = this.ensureChatState(key);
    const previous = (state.recentWorkdirs || []).find(
      (workdir) => workdir !== state.currentWorkdir
    );

    if (!previous) {
      throw new Error(t(this.getLanguage(key), "noPreviousProject"));
    }

    return this.switchWorkdir(key, previous);
  }

  getExecArgs(
    chatId: string | number,
    prompt: string,
    options: SessionOptions = {}
  ): string[] {
    const state = this.ensureChatState(chatId);
    const args = options.resumeSessionId ? ["exec", "resume"] : ["exec"];

    if (options.fullAuto) {
      args.push("--full-auto");
    }

    if (state.preferredModel) {
      args.push("-m", state.preferredModel);
    }

    if (Array.isArray(options.extraArgs) && options.extraArgs.length) {
      args.push(...options.extraArgs);
    }

    if (options.resumeSessionId) {
      args.push(options.resumeSessionId);
    }

    args.push(prompt);
    return args;
  }

  getInteractiveArgs(
    chatId: string | number,
    options: SessionOptions = {}
  ): string[] {
    const args = options.resumeSessionId
      ? ["resume", options.resumeSessionId]
      : this.getCommandArgsForSession(chatId);

    if (options.resumeSessionId && options.initialPrompt) {
      args.push(options.initialPrompt);
    }

    return args;
  }

  createBaseSession(
    chatId: string | number,
    mode: SessionMode,
    options: SessionOptions = {}
  ): RunnerSession {
    const key = String(chatId);
    const state = this.ensureChatState(key);
    const workdir = path.resolve(
      options.workdir || state.currentWorkdir || this.config.runner.cwd
    );
    const projectState = this.ensureProjectState(key, workdir);
    const session: RunnerSession = {
      chatId: key,
      mode,
      workdir,
      model: state.preferredModel,
      sessionId: projectState.lastSessionId || "",
      trackConversation: options.trackConversation !== false,
      proc: null,
      rawBuffer: "",
      streamMessageIds: [],
      lastRendered: "",
      flushQueue: Promise.resolve(),
      throttledFlush: throttle(
        () => this.enqueueFlush(key),
        this.config.runner.throttleMs,
        { leading: true, trailing: true }
      ),
      write: null,
      interrupt: null,
      close: null
    };

    this.sessions.set(key, session);
    return session;
  }

  captureSessionMetadata(session: RunnerSession): void {
    if (!session.trackConversation) return;

    const sessionId = extractSessionId(session.rawBuffer);
    if (!sessionId || sessionId === session.sessionId) return;

    session.sessionId = sessionId;
    const projectState = this.ensureProjectState(
      session.chatId,
      session.workdir
    );
    projectState.lastSessionId = sessionId;
    this.onChange?.(this.exportState());
  }

  attachOutput(
    session: RunnerSession,
    stream:
      | NodeJS.ReadableStream
      | { on: (event: "data", listener: (chunk: unknown) => void) => void }
  ): void {
    stream.on("data", (chunk: unknown) => {
      session.rawBuffer += stripAnsi(String(chunk || "")).replace(/\r/g, "");
      if (session.rawBuffer.length > this.config.runner.maxBufferChars) {
        session.rawBuffer = session.rawBuffer.slice(
          -this.config.runner.maxBufferChars
        );
      }
      this.captureSessionMetadata(session);
      session.throttledFlush();
    });
  }

  attachExit(
    session: RunnerSession,
    handler: (
      listener: (payload: {
        exitCode: number | null;
        signal: ExitSignal;
      }) => void
    ) => void
  ): void {
    handler(async ({ exitCode, signal }) => {
      this.captureSessionMetadata(session);
      const projectState = this.ensureProjectState(
        session.chatId,
        session.workdir
      );
      projectState.lastMode = session.mode;
      projectState.lastExitCode = exitCode;
      projectState.lastExitSignal = signal;
      this.onChange?.(this.exportState());

      this.enqueueFlush(session.chatId);
      if (this.isVerbose(session.chatId)) {
        await this.bot.telegram
          .sendMessage(
            session.chatId,
            t(this.getLanguage(session.chatId), "codexSessionExited", {
              mode: session.mode,
              exitCode,
              signal
            })
          )
          .catch(() => {});
      }
      session.throttledFlush.cancel();
      this.sessions.delete(session.chatId);
    });
  }

  startPtySession(
    chatId: string | number,
    options: SessionOptions = {}
  ): RunnerSession {
    const session = this.createBaseSession(chatId, "pty", options);
    const proc = pty.spawn(
      this.config.runner.command,
      this.getInteractiveArgs(chatId, options),
      {
        name: "xterm-256color",
        cols: 120,
        rows: 32,
        cwd: session.workdir,
        env: {
          ...process.env,
          FORCE_COLOR: "1"
        }
      }
    ) as PtyProcess;

    this.ensureChatState(chatId).ptySupported = true;
    session.proc = proc;
    session.write = (input: string) => proc.write(input);
    session.interrupt = () => proc.write("\u0003");
    session.close = () => proc.kill();

    proc.onData((chunk) => {
      session.rawBuffer += stripAnsi(String(chunk || "")).replace(/\r/g, "");
      if (session.rawBuffer.length > this.config.runner.maxBufferChars) {
        session.rawBuffer = session.rawBuffer.slice(
          -this.config.runner.maxBufferChars
        );
      }
      this.captureSessionMetadata(session);
      session.throttledFlush();
    });

    this.attachExit(session, (listener) => proc.onExit(listener));
    return session;
  }

  startExecSessionWithOptions(
    chatId: string | number,
    prompt: string,
    options: SessionOptions = {}
  ): RunnerSession {
    const session = this.createBaseSession(chatId, "exec", options);
    const proc = spawn(
      this.config.runner.command,
      this.getExecArgs(chatId, prompt, options),
      {
        cwd: session.workdir,
        env: process.env
      }
    );

    session.proc = proc;
    session.write = null;
    session.interrupt = () => proc.kill("SIGINT");
    session.close = () => proc.kill("SIGTERM");

    if (proc.stdout) {
      this.attachOutput(session, proc.stdout);
    }
    if (proc.stderr) {
      this.attachOutput(session, proc.stderr);
    }
    this.attachExit(session, (listener) =>
      proc.on("close", (exitCode, signal) => listener({ exitCode, signal }))
    );

    proc.on("error", async (error) => {
      await this.bot.telegram
        .sendMessage(
          session.chatId,
          t(this.getLanguage(session.chatId), "codexExecFailed", {
            error: error.message
          })
        )
        .catch(() => {});
      session.throttledFlush.cancel();
      this.sessions.delete(session.chatId);
    });

    return session;
  }

  ensureSession(
    chatId: string | number,
    options: SessionOptions = {}
  ): RunnerSession | null {
    const key = String(chatId);
    const existing = this.sessions.get(key);
    if (existing) return existing;

    try {
      return this.startPtySession(key, options);
    } catch (error) {
      if (!isPtySpawnFailure(error)) {
        throw error;
      }

      this.ensureChatState(key).ptySupported = false;
      console.warn(
        `[runner] PTY spawn failed for chat ${key}; falling back to codex exec mode.`
      );
      return null;
    }
  }

  enqueueFlush(chatId: string | number): void {
    const key = String(chatId);
    const session = this.sessions.get(key);
    if (!session) return;

    session.flushQueue = session.flushQueue
      .then(() => this.flushToTelegram(key))
      .catch(() => {});
  }

  async flushToTelegram(chatId: string | number): Promise<void> {
    const session = this.sessions.get(String(chatId));
    if (!session) return;

    const rawTail = session.rawBuffer.slice(-60000);
    const rendered = formatPtyOutput(rawTail, {
      mode: this.config.reasoning.mode,
      sessionMode: session.mode
    });
    if (rendered === session.lastRendered) return;
    session.lastRendered = rendered;

    const chunks = splitTelegramMessage(
      rendered,
      this.config.runner.telegramChunkSize
    );
    const existing = session.streamMessageIds;
    const nextIds: number[] = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const existingMessageId = existing[i];

      if (existingMessageId) {
        try {
          await this.bot.telegram.editMessageText(
            chatId,
            existingMessageId,
            undefined,
            chunk,
            {
              parse_mode: "MarkdownV2",
              disable_web_page_preview: true
            }
          );
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

  async sendPrompt(
    ctx: SendPromptContext,
    prompt: string,
    options: SendPromptOptions = {}
  ): Promise<
    | { started: false; reason: "busy"; activeMode: SessionMode }
    | {
        started: true;
        mode: SessionMode;
        fallback?: boolean;
        resumed?: boolean;
      }
  > {
    const chatId = String(ctx.chat.id);
    const projectState = this.ensureProjectState(chatId);
    if (options.forceExec) {
      const running = this.sessions.get(chatId);
      if (running) {
        return {
          started: false,
          reason: "busy",
          activeMode: running.mode
        };
      }

      this.startExecSessionWithOptions(chatId, prompt, {
        fullAuto: Boolean(options.fullAuto),
        extraArgs: options.extraArgs || [],
        workdir: this.getWorkdir(chatId),
        trackConversation: false
      });

      if (options.notice && this.isVerbose(chatId)) {
        await this.bot.telegram.sendMessage(chatId, options.notice);
      }

      return {
        started: true,
        mode: "exec"
      };
    }

    const existingSession = this.sessions.get(chatId);
    if (existingSession) {
      if (existingSession.mode === "exec") {
        return {
          started: false,
          reason: "busy",
          activeMode: existingSession.mode
        };
      }

      existingSession.write?.(`${prompt}\r`);
      return {
        started: true,
        mode: "pty"
      };
    }

    let session = this.ensureSession(
      chatId,
      projectState.lastSessionId
        ? {
            workdir: this.getWorkdir(chatId),
            resumeSessionId: projectState.lastSessionId,
            initialPrompt: prompt
          }
        : {
            workdir: this.getWorkdir(chatId)
          }
    );

    if (!session) {
      session = this.startExecSessionWithOptions(chatId, prompt, {
        fullAuto: Boolean(options.fullAuto),
        extraArgs: options.extraArgs || [],
        workdir: this.getWorkdir(chatId),
        resumeSessionId: projectState.lastSessionId || ""
      });
      if (this.isVerbose(chatId)) {
        await this.bot.telegram.sendMessage(
          chatId,
          projectState.lastSessionId
            ? t(this.getLanguage(chatId), "execFallbackResume")
            : t(this.getLanguage(chatId), "execFallbackSingle")
        );
      }
      return {
        started: true,
        mode: "exec",
        fallback: true,
        resumed: Boolean(projectState.lastSessionId)
      };
    }

    if (!session.streamMessageIds.length && this.isVerbose(chatId)) {
      const sent = await this.bot.telegram.sendMessage(
        chatId,
        projectState.lastSessionId
          ? t(this.getLanguage(chatId), "sessionRestored", {
              project: this.getRelativeWorkdir(chatId),
              mode: session.mode
            })
          : t(this.getLanguage(chatId), "sessionStarted", {
              mode: session.mode
            })
      );
      session.streamMessageIds.push(sent.message_id);
    }

    if (projectState.lastSessionId) {
      return {
        started: true,
        mode: "pty",
        resumed: true
      };
    }

    session.write?.(`${prompt}\r`);
    return {
      started: true,
      mode: "pty"
    };
  }

  interrupt(chatId: string | number): boolean {
    const session = this.sessions.get(String(chatId));
    if (!session) return false;
    session.interrupt?.();
    return true;
  }

  resetCurrentProjectConversation(chatId: string | number): {
    closed: boolean;
    workdir: string;
  } {
    const key = String(chatId);
    const workdir = this.getWorkdir(key);
    const projectState = this.ensureProjectState(key, workdir);
    const closed = this.closeSession(key);

    projectState.lastSessionId = "";
    projectState.lastMode = null;
    projectState.lastExitCode = null;
    projectState.lastExitSignal = null;
    this.onChange?.(this.exportState());

    return {
      closed,
      workdir
    };
  }

  closeSession(chatId: string | number): boolean {
    const key = String(chatId);
    const session = this.sessions.get(key);
    if (!session) return false;

    session.throttledFlush.cancel();
    session.close?.();
    this.sessions.delete(key);
    return true;
  }

  async shutdown(): Promise<void> {
    for (const chatId of this.sessions.keys()) {
      this.closeSession(chatId);
    }
  }

  serializeWorkdir(workdir: string): string {
    const relative = path.relative(this.config.workspace.root, workdir);
    if (!relative) return ".";
    return !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative
      : workdir;
  }

  resolveStoredWorkdir(stored: unknown): string | null {
    if (!stored || typeof stored !== "string") return null;
    const candidate = path.isAbsolute(stored)
      ? path.resolve(stored)
      : path.resolve(this.config.workspace.root, stored);

    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      return null;
    }

    if (!this.isInsideWorkspaceRoot(candidate)) {
      return null;
    }

    return candidate;
  }

  exportState(): PtyManagerSnapshot {
    const chats: PtyManagerSnapshot["chats"] = {};

    for (const [chatId, state] of this.chatState.entries()) {
      const projects: PtyManagerSnapshot["chats"][string]["projects"] = {};
      for (const [workdir, projectState] of state.projectStates.entries()) {
        projects[this.serializeWorkdir(workdir)] = {
          lastSessionId: projectState.lastSessionId || "",
          lastMode: projectState.lastMode,
          lastExitCode: projectState.lastExitCode,
          lastExitSignal: projectState.lastExitSignal
        };
      }

      chats[chatId] = {
        preferredModel: state.preferredModel,
        language: this.getLanguage(chatId),
        verboseOutput: Boolean(state.verboseOutput),
        currentWorkdir: this.serializeWorkdir(state.currentWorkdir),
        recentWorkdirs: (state.recentWorkdirs || []).map((workdir) =>
          this.serializeWorkdir(workdir)
        ),
        projects
      };
    }

    return {
      chats
    };
  }

  restoreState(snapshot: Partial<PtyManagerSnapshot> = {}): void {
    const chats = snapshot?.chats;
    if (!chats || typeof chats !== "object") return;

    this.chatState.clear();

    for (const [chatId, rawState] of Object.entries(
      chats as Record<string, StoredChatRuntimeState>
    )) {
      const currentWorkdir =
        this.resolveStoredWorkdir(rawState?.currentWorkdir) ||
        this.config.runner.cwd;

      const recentWorkdirs = Array.isArray(rawState?.recentWorkdirs)
        ? rawState.recentWorkdirs
            .map((stored) => this.resolveStoredWorkdir(stored))
            .filter((workdir): workdir is string => Boolean(workdir))
        : [];

      const projectStates = new Map<string, ProjectConversationState>();
      const rawProjects = rawState?.projects;
      if (rawProjects && typeof rawProjects === "object") {
        for (const [storedWorkdir, rawProjectState] of Object.entries(
          rawProjects
        )) {
          const resolvedWorkdir = this.resolveStoredWorkdir(storedWorkdir);
          if (!resolvedWorkdir) continue;

          projectStates.set(resolvedWorkdir, {
            lastSessionId: String(rawProjectState?.lastSessionId || "").trim(),
            lastMode:
              rawProjectState?.lastMode === "pty" ||
              rawProjectState?.lastMode === "exec"
                ? rawProjectState.lastMode
                : null,
            lastExitCode:
              rawProjectState?.lastExitCode === null ||
              rawProjectState?.lastExitCode === undefined
                ? null
                : Number(rawProjectState.lastExitCode),
            lastExitSignal:
              rawProjectState?.lastExitSignal === null ||
              rawProjectState?.lastExitSignal === undefined
                ? null
                : (rawProjectState.lastExitSignal as ExitSignal)
          });
        }
      }

      if (!projectStates.has(currentWorkdir)) {
        projectStates.set(currentWorkdir, {
          lastSessionId: "",
          lastMode: null,
          lastExitCode: null,
          lastExitSignal: null
        });
      }

      this.chatState.set(String(chatId), {
        preferredModel:
          typeof rawState?.preferredModel === "string" &&
          rawState.preferredModel.trim()
            ? rawState.preferredModel.trim()
            : null,
        language: toLocale(
          normalizeLanguage(String(rawState?.language || "")) || "en"
        ),
        verboseOutput: Boolean(rawState?.verboseOutput),
        currentWorkdir,
        recentWorkdirs: [
          currentWorkdir,
          ...recentWorkdirs.filter((workdir) => workdir !== currentWorkdir)
        ].slice(0, 6),
        ptySupported: null,
        projectStates
      });
    }
  }

  getStatus(chatId: string | number): PtyManagerStatus {
    const key = String(chatId);
    const state = this.ensureChatState(key);
    const projectState = this.ensureProjectState(key, state.currentWorkdir);
    const session = this.sessions.get(key);

    return {
      active: Boolean(session),
      activeMode: session?.mode || null,
      lastMode: projectState.lastMode,
      lastExitCode: projectState.lastExitCode,
      lastExitSignal: projectState.lastExitSignal,
      projectSessionId: projectState.lastSessionId || null,
      preferredModel: state.preferredModel,
      language: this.getLanguage(key),
      verboseOutput: Boolean(state.verboseOutput),
      ptySupported: state.ptySupported,
      workdir: this.getWorkdir(key),
      relativeWorkdir: this.getRelativeWorkdir(key),
      workspaceRoot: this.config.workspace.root,
      command: this.config.runner.command,
      mcpServers: this.config.mcp.servers.map((server) => server.name)
    };
  }

  setPreferredModel(chatId: string | number, model: string): string | null {
    const state = this.ensureChatState(chatId);
    state.preferredModel = model?.trim() || null;
    this.onChange?.(this.exportState());
    return state.preferredModel;
  }

  clearPreferredModel(chatId: string | number): void {
    const state = this.ensureChatState(chatId);
    state.preferredModel = null;
    this.onChange?.(this.exportState());
  }
}
