import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { toErrorMessage } from "./lib/errors.js";
import {
  normalizeTelegramApiBase,
  normalizeTelegramProxyUrl
} from "./lib/telegramApi.js";

dotenv.config();

export type ReasoningMode = "quote" | "spoiler";
export type RunnerBackend = "cli" | "sdk";
export type CodexApprovalPolicy =
  | "never"
  | "on-request"
  | "on-failure"
  | "untrusted";
export type CodexSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";
export type CodexReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type CodexWebSearchMode = "disabled" | "cached" | "live";
export type CodexConfigValue =
  | string
  | number
  | boolean
  | CodexConfigValue[]
  | { [key: string]: CodexConfigValue };

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface AppConfig {
  app: {
    name: string;
    stateFile: string;
  };
  workspace: {
    root: string;
  };
  telegram: {
    botToken: string;
    apiBase: string;
    proxyUrl?: string;
    allowedUserIds: string[];
    proactiveUserIds: string[];
  };
  runner: {
    backend: RunnerBackend;
    command: string;
    args: string[];
    cwd: string;
    throttleMs: number;
    maxBufferChars: number;
    telegramChunkSize: number;
    sdkConfig: Record<string, CodexConfigValue>;
    sdkThreadOptions: {
      skipGitRepoCheck: boolean;
      sandboxMode?: CodexSandboxMode;
      approvalPolicy?: CodexApprovalPolicy;
      modelReasoningEffort?: CodexReasoningEffort;
      networkAccessEnabled?: boolean;
      webSearchMode?: CodexWebSearchMode;
      additionalDirectories: string[];
    };
  };
  reasoning: {
    mode: ReasoningMode;
  };
  shell: {
    enabled: boolean;
    readOnly: boolean;
    allowedCommands: string[];
    dangerousCommands: string[];
    timeoutMs: number;
    maxOutputChars: number;
  };
  cron: {
    dailySummary: string;
    timezone: string;
  };
  mcp: {
    servers: McpServerConfig[];
  };
  github: {
    token: string;
    defaultWorkdir: string;
    defaultBranch: string;
    e2eCommand: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || !String(value).trim()) {
    return undefined;
  }

  return parseBoolean(value, false);
}

function parseArgs(value: string): string[] {
  if (!value.trim()) return [];
  const parts = value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return parts.map((part) => part.replace(/^"|"$/g, ""));
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const message = toErrorMessage(error);
    throw new Error(`Invalid JSON in environment variable: ${message}`);
  }
}

function parseEnum<T extends string>(
  value: string | undefined,
  supported: readonly T[]
): T | undefined {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  return supported.includes(normalized as T) ? (normalized as T) : undefined;
}

function resolveDirectory(
  value: string | undefined,
  name: string,
  fallback = process.cwd()
): string {
  const resolvedFallback = path.resolve(fallback);
  const candidate = path.resolve(value || resolvedFallback);

  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return candidate;
  }

  if (value && value.trim()) {
    console.warn(
      `[config] ${name} does not exist: ${candidate}. Falling back to ${resolvedFallback}`
    );
  }

  return resolvedFallback;
}

function resolveFile(value: string | undefined, fallback: string): string {
  const candidate = path.resolve(value || fallback);
  const directory = path.dirname(candidate);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  return candidate;
}

function resolveDirectoryList(raw: unknown, name: string): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const resolved: string[] = [];
  for (const [index, item] of raw.entries()) {
    if (typeof item !== "string" || !item.trim()) {
      continue;
    }

    const candidate = path.resolve(item);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      resolved.push(candidate);
      continue;
    }

    console.warn(
      `[config] ${name}[${index}] does not exist: ${candidate}. Skipping it.`
    );
  }

  return [...new Set(resolved)];
}

function parseRunnerBackend(value: string | undefined): RunnerBackend {
  return String(value || "")
    .trim()
    .toLowerCase() === "sdk"
    ? "sdk"
    : "cli";
}

function normalizeEnvMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, String(value)])
  );
}

function normalizeMcpServer(
  raw: unknown,
  index: number
): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as {
    name?: unknown;
    command?: unknown;
    args?: unknown;
    cwd?: unknown;
    env?: unknown;
  };

  if (!candidate.name || !candidate.command) {
    throw new Error(
      `Invalid MCP server config at index ${index}: "name" and "command" are required.`
    );
  }

  return {
    name: String(candidate.name),
    command: String(candidate.command),
    args: Array.isArray(candidate.args) ? candidate.args.map(String) : [],
    cwd: resolveDirectory(
      candidate.cwd ? String(candidate.cwd) : process.cwd(),
      `MCP_SERVERS[${index}].cwd`
    ),
    env: normalizeEnvMap(candidate.env)
  };
}

export function loadConfig(): AppConfig {
  const allowedUserIds = parseCsv(process.env.ALLOWED_USER_IDS);
  if (!allowedUserIds.length) {
    throw new Error(
      "ALLOWED_USER_IDS must contain at least one Telegram user id."
    );
  }

  const proactiveUserIds = parseCsv(
    process.env.PROACTIVE_USER_IDS || process.env.ALLOWED_USER_IDS
  );
  const runnerBackend = parseRunnerBackend(process.env.CODEX_BACKEND);
  const rawMcpServers = parseJson<unknown[]>(process.env.MCP_SERVERS, []);
  const mcpServers = Array.isArray(rawMcpServers)
    ? rawMcpServers
        .map((server, index) => normalizeMcpServer(server, index))
        .filter((server): server is McpServerConfig => Boolean(server))
    : [];
  const runnerCwd = resolveDirectory(
    process.env.CODEX_WORKDIR,
    "CODEX_WORKDIR"
  );
  const workspaceRoot = resolveDirectory(
    process.env.WORKSPACE_ROOT,
    "WORKSPACE_ROOT",
    runnerCwd
  );
  const githubDefaultWorkdir = resolveDirectory(
    process.env.GITHUB_DEFAULT_WORKDIR,
    "GITHUB_DEFAULT_WORKDIR"
  );
  const rawShellAllowedCommands = parseJson<unknown[]>(
    process.env.SHELL_ALLOWED_COMMANDS,
    []
  );
  const shellAllowedCommands = Array.isArray(rawShellAllowedCommands)
    ? rawShellAllowedCommands
        .map((value) => String(value).trim())
        .filter(Boolean)
    : [];
  const rawShellDangerousCommands = parseJson<unknown[]>(
    process.env.SHELL_DANGEROUS_COMMANDS,
    []
  );
  const shellDangerousCommands = Array.isArray(rawShellDangerousCommands)
    ? rawShellDangerousCommands
        .map((value) => String(value).trim())
        .filter(Boolean)
    : [];
  const shellEnabled = parseBoolean(process.env.SHELL_ENABLED, false);
  const sdkConfig = parseJson<Record<string, CodexConfigValue>>(
    process.env.CODEX_SDK_CONFIG,
    {}
  );
  const rawSdkAdditionalDirectories = parseJson<unknown[]>(
    process.env.CODEX_SDK_ADDITIONAL_DIRECTORIES,
    []
  );
  const sdkThreadOptions = {
    skipGitRepoCheck: parseBoolean(
      process.env.CODEX_SDK_SKIP_GIT_REPO_CHECK,
      true
    ),
    sandboxMode:
      parseEnum<CodexSandboxMode>(process.env.CODEX_SDK_SANDBOX_MODE, [
        "read-only",
        "workspace-write",
        "danger-full-access"
      ]) || (runnerBackend === "sdk" ? "danger-full-access" : undefined),
    approvalPolicy:
      parseEnum<CodexApprovalPolicy>(process.env.CODEX_SDK_APPROVAL_POLICY, [
        "never",
        "on-request",
        "on-failure",
        "untrusted"
      ]) || (runnerBackend === "sdk" ? "never" : undefined),
    modelReasoningEffort: parseEnum<CodexReasoningEffort>(
      process.env.CODEX_SDK_REASONING_EFFORT,
      ["minimal", "low", "medium", "high", "xhigh"]
    ),
    networkAccessEnabled: parseOptionalBoolean(
      process.env.CODEX_SDK_NETWORK_ACCESS_ENABLED
    ),
    webSearchMode: parseEnum<CodexWebSearchMode>(
      process.env.CODEX_SDK_WEB_SEARCH_MODE,
      ["disabled", "cached", "live"]
    ),
    additionalDirectories: resolveDirectoryList(
      rawSdkAdditionalDirectories,
      "CODEX_SDK_ADDITIONAL_DIRECTORIES"
    )
  };

  if (shellEnabled && !shellAllowedCommands.length) {
    throw new Error(
      "SHELL_ALLOWED_COMMANDS must contain at least one command prefix when SHELL_ENABLED=true."
    );
  }

  return {
    app: {
      name: "CodexClaw",
      stateFile: resolveFile(
        process.env.STATE_FILE,
        path.join(process.cwd(), ".codex-telegram-claws-state.json")
      )
    },
    workspace: {
      root: workspaceRoot
    },
    telegram: {
      botToken: required("BOT_TOKEN"),
      apiBase: normalizeTelegramApiBase(process.env.TELEGRAM_API_BASE),
      proxyUrl: normalizeTelegramProxyUrl(process.env.TELEGRAM_PROXY_URL),
      allowedUserIds,
      proactiveUserIds
    },
    runner: {
      backend: runnerBackend,
      command: process.env.CODEX_COMMAND?.trim() || "codex",
      args: parseArgs(process.env.CODEX_ARGS || ""),
      cwd: runnerCwd,
      throttleMs: parseNumber(process.env.STREAM_THROTTLE_MS, 1200),
      maxBufferChars: parseNumber(process.env.STREAM_BUFFER_CHARS, 120000),
      telegramChunkSize: 3900,
      sdkConfig,
      sdkThreadOptions
    },
    reasoning: {
      mode: process.env.REASONING_RENDER_MODE === "quote" ? "quote" : "spoiler"
    },
    shell: {
      enabled: shellEnabled,
      readOnly: parseBoolean(process.env.SHELL_READ_ONLY, true),
      allowedCommands: shellAllowedCommands,
      dangerousCommands: shellDangerousCommands,
      timeoutMs: parseNumber(process.env.SHELL_TIMEOUT_MS, 20000),
      maxOutputChars: parseNumber(process.env.SHELL_MAX_OUTPUT_CHARS, 12000)
    },
    cron: {
      dailySummary: process.env.CRON_DAILY_SUMMARY?.trim() || "0 9 * * *",
      timezone: process.env.CRON_TIMEZONE?.trim() || "Asia/Shanghai"
    },
    mcp: {
      servers: mcpServers
    },
    github: {
      token: process.env.GITHUB_TOKEN?.trim() || "",
      defaultWorkdir: githubDefaultWorkdir,
      defaultBranch: process.env.GITHUB_DEFAULT_BRANCH?.trim() || "main",
      e2eCommand:
        process.env.E2E_TEST_COMMAND?.trim() ||
        "npx playwright test --reporter=line"
    }
  };
}
