import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import type { AppConfig } from "../config.js";
import { repairNodePtySpawnHelperPermissions } from "../runner/ptyPreflight.js";
import { extractCodexExecResponse } from "../bot/formatter.js";
import { toErrorMessage } from "../lib/errors.js";
import { requestTelegramJson } from "../lib/telegramApi.js";

export type HealthcheckStatus = "pass" | "warn" | "fail";

export interface HealthcheckCheck {
  name: string;
  status: HealthcheckStatus;
  detail: string;
}

export interface HealthcheckResult {
  ok: boolean;
  checks: HealthcheckCheck[];
}

interface CliCodexLiveCheckResult {
  backend: "cli";
  output: string;
}

interface SdkCodexLiveCheckResult {
  backend: "sdk";
  threadId: string | null;
  output: string;
}

type CodexLiveCheckResult = CliCodexLiveCheckResult | SdkCodexLiveCheckResult;

interface HealthcheckOptions {
  strict?: boolean;
  env?: NodeJS.ProcessEnv;
  telegramLiveCheck?: boolean;
  codexLiveCheck?: boolean;
  codexLiveRunner?: (config: AppConfig) => Promise<CodexLiveCheckResult>;
  ptyHelperCheck?: typeof repairNodePtySpawnHelperPermissions;
}

interface TelegramGetMeResponse {
  ok?: boolean;
  result?: {
    username?: string;
  };
  description?: string;
}

function makeCheck(
  name: string,
  status: HealthcheckStatus,
  detail: string
): HealthcheckCheck {
  return { name, status, detail };
}

function isPathExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCommandPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = String(command || "").trim();
  if (!raw) return "";

  if (raw.includes(path.sep)) {
    const candidate = path.resolve(raw);
    return isPathExecutable(candidate) ? candidate : "";
  }

  const pathValue = String(env.PATH || "");
  for (const segment of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(segment, raw);
    if (isPathExecutable(candidate)) {
      return candidate;
    }
  }

  return "";
}

function checkDirectory(
  name: string,
  directoryPath: string | undefined
): HealthcheckCheck {
  if (!directoryPath) {
    return makeCheck(name, "fail", "Path is empty.");
  }

  if (!fs.existsSync(directoryPath)) {
    return makeCheck(name, "fail", `Missing directory: ${directoryPath}`);
  }

  if (!fs.statSync(directoryPath).isDirectory()) {
    return makeCheck(name, "fail", `Expected a directory: ${directoryPath}`);
  }

  return makeCheck(name, "pass", directoryPath);
}

function checkWritableDirectory(
  name: string,
  directoryPath: string | undefined
): HealthcheckCheck {
  const base = checkDirectory(name, directoryPath);
  if (base.status !== "pass") return base;
  const resolvedPath = base.detail;

  try {
    fs.accessSync(resolvedPath, fs.constants.W_OK);
    return base;
  } catch (error: unknown) {
    return makeCheck(
      name,
      "fail",
      `Directory is not writable: ${resolvedPath} (${toErrorMessage(error)})`
    );
  }
}

function runCliCodexLiveCheck(
  config: AppConfig
): Promise<CliCodexLiveCheckResult> {
  return new Promise((resolve, reject) => {
    const prompt = "Reply with exactly: HEALTHCHECK_OK";
    const proc = spawn(
      config.runner.command,
      [...(config.runner.args || []), "exec", prompt],
      {
        cwd: config.runner.cwd,
        env: process.env
      }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk || "");
    });
    proc.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk || "");
    });
    proc.on("error", reject);
    proc.on("close", (code, signal) => {
      const output = extractCodexExecResponse(`${stdout}\n${stderr}`).trim();
      if (code !== 0) {
        reject(
          new Error(
            `CLI health check exited with code ${code}, signal ${signal || "none"}`
          )
        );
        return;
      }

      if (output !== "HEALTHCHECK_OK") {
        reject(
          new Error(`Unexpected CLI response: ${output || "(empty output)"}`)
        );
        return;
      }

      resolve({
        backend: "cli",
        output
      });
    });
  });
}

async function runSdkCodexLiveCheck(
  config: AppConfig
): Promise<SdkCodexLiveCheckResult> {
  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex({
    config: config.runner.sdkConfig
  });
  const thread = codex.startThread({
    workingDirectory: config.runner.cwd,
    skipGitRepoCheck: config.runner.sdkThreadOptions.skipGitRepoCheck,
    approvalPolicy: config.runner.sdkThreadOptions.approvalPolicy,
    sandboxMode: config.runner.sdkThreadOptions.sandboxMode,
    modelReasoningEffort: config.runner.sdkThreadOptions.modelReasoningEffort,
    networkAccessEnabled: config.runner.sdkThreadOptions.networkAccessEnabled,
    webSearchMode: config.runner.sdkThreadOptions.webSearchMode,
    additionalDirectories: config.runner.sdkThreadOptions.additionalDirectories
  });
  const turn = await thread.run("Reply with exactly: HEALTHCHECK_OK");

  if (turn.finalResponse.trim() !== "HEALTHCHECK_OK") {
    throw new Error(
      `Unexpected SDK response: ${turn.finalResponse.trim() || "(empty output)"}`
    );
  }

  return {
    backend: "sdk",
    threadId: thread.id,
    output: turn.finalResponse.trim()
  };
}

async function runCodexLiveCheck(
  config: AppConfig,
  options: HealthcheckOptions = {}
): Promise<CodexLiveCheckResult> {
  if (typeof options.codexLiveRunner === "function") {
    return options.codexLiveRunner(config);
  }

  if (config.runner.backend === "sdk") {
    return runSdkCodexLiveCheck(config);
  }

  return runCliCodexLiveCheck(config);
}

export async function runHealthcheck(
  config: AppConfig,
  options: HealthcheckOptions = {}
): Promise<HealthcheckResult> {
  const strict = Boolean(options.strict);
  const env = options.env || process.env;
  const checks: HealthcheckCheck[] = [];

  checks.push(checkDirectory("workspace root", config.workspace.root));
  checks.push(checkDirectory("runner workdir", config.runner.cwd));
  checks.push(checkDirectory("github workdir", config.github.defaultWorkdir));
  checks.push(
    checkWritableDirectory(
      "state file directory",
      path.dirname(config.app.stateFile)
    )
  );

  const resolvedCommand = resolveCommandPath(config.runner.command, env);
  checks.push(
    resolvedCommand
      ? makeCheck(
          "codex command",
          "pass",
          `${config.runner.command} -> ${resolvedCommand}`
        )
      : makeCheck(
          "codex command",
          strict ? "fail" : "warn",
          `Command not found in PATH: ${config.runner.command}`
        )
  );

  const ptyHelperCheck =
    options.ptyHelperCheck || repairNodePtySpawnHelperPermissions;
  const ptyHelper = ptyHelperCheck();
  if (ptyHelper.error) {
    if (config.runner.backend === "sdk") {
      checks.push(
        makeCheck(
          "node-pty helper",
          "pass",
          `Not required for sdk backend (${ptyHelper.error})`
        )
      );
    } else {
      checks.push(
        makeCheck("node-pty helper", strict ? "fail" : "warn", ptyHelper.error)
      );
    }
  } else if (ptyHelper.changed) {
    checks.push(
      makeCheck(
        "node-pty helper",
        "pass",
        `Repaired execute permissions: ${ptyHelper.path}`
      )
    );
  } else {
    checks.push(makeCheck("node-pty helper", "pass", ptyHelper.path));
  }

  const liveTelegramCheck = Boolean(options.telegramLiveCheck);
  if (liveTelegramCheck) {
    try {
      const { statusCode, payload } =
        await requestTelegramJson<TelegramGetMeResponse>({
          apiBase: config.telegram.apiBase,
          token: config.telegram.botToken,
          method: "getMe",
          proxyUrl: config.telegram.proxyUrl
        });
      if (
        statusCode >= 200 &&
        statusCode < 300 &&
        payload?.ok &&
        payload?.result?.username
      ) {
        checks.push(
          makeCheck(
            "telegram api",
            "pass",
            `Authenticated as @${payload.result.username}`
          )
        );
      } else {
        checks.push(
          makeCheck(
            "telegram api",
            "fail",
            payload?.description || `HTTP ${statusCode}`
          )
        );
      }
    } catch (error: unknown) {
      checks.push(makeCheck("telegram api", "fail", toErrorMessage(error)));
    }
  }

  const codexLiveCheck = Boolean(options.codexLiveCheck);
  if (codexLiveCheck) {
    try {
      const result = await runCodexLiveCheck(config, options);
      const threadDetail =
        "threadId" in result && result.threadId
          ? ` (thread ${result.threadId})`
          : "";
      checks.push(
        makeCheck(
          "codex live",
          "pass",
          `${result.backend} backend responded with ${result.output}${threadDetail}`
        )
      );
    } catch (error) {
      checks.push(makeCheck("codex live", "fail", toErrorMessage(error)));
    }
  }

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");

  return {
    ok: failed.length === 0 && (strict ? warned.length === 0 : true),
    checks
  };
}
