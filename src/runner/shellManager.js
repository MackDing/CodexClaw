import { spawn } from "node:child_process";
import process from "node:process";
import {
  hasForbiddenShellSyntax,
  matchesAllowedCommandPrefix,
  parseCommandLine
} from "./commandLine.js";

function trimOutputTail(value, maxChars) {
  if (value.length <= maxChars) return value;
  return value.slice(-maxChars);
}

export class ShellManager {
  constructor({ config }) {
    this.config = config;
    this.runningJobs = new Map();
    this.allowedPrefixes = config.shell.allowedCommands.map((command) => parseCommandLine(command));
    this.dangerousPrefixes = (config.shell.dangerousCommands || []).map((command) =>
      parseCommandLine(command)
    );
  }

  isEnabled() {
    return this.config.shell.enabled;
  }

  isReadOnly() {
    return this.config.shell.readOnly;
  }

  isBusy(chatId) {
    return this.runningJobs.has(String(chatId));
  }

  getAllowedCommands() {
    return [...this.config.shell.allowedCommands];
  }

  getDangerousCommands() {
    return [...(this.config.shell.dangerousCommands || [])];
  }

  inspectCommand(rawCommand) {
    if (!this.isEnabled()) {
      throw new Error("受限 Shell 功能未启用。先在 .env 中设置 SHELL_ENABLED=true。");
    }

    let commandText = String(rawCommand || "").trim();
    let confirmed = false;

    if (/^--confirm\s+/i.test(commandText)) {
      confirmed = true;
      commandText = commandText.replace(/^--confirm\s+/i, "").trim();
    }

    if (!commandText) {
      throw new Error("用法: /sh <command>");
    }

    if (hasForbiddenShellSyntax(commandText)) {
      throw new Error("不支持管道、重定向、命令替换或多条 shell 语句。");
    }

    const argv = parseCommandLine(commandText);
    if (!argv.length) {
      throw new Error("无法解析命令。");
    }

    if (!matchesAllowedCommandPrefix(argv, this.allowedPrefixes)) {
      throw new Error(
        `命令不在白名单中。允许前缀: ${this.getAllowedCommands().join(", ")}`
      );
    }

    const dangerous = matchesAllowedCommandPrefix(argv, this.dangerousPrefixes);
    if (dangerous && this.isReadOnly()) {
      throw new Error("当前 /sh 处于只读模式，禁止执行写操作命令。");
    }

    return {
      argv,
      commandText,
      confirmed,
      dangerous,
      requiresConfirmation: dangerous && !confirmed,
      confirmationCommand: dangerous ? `/sh --confirm ${commandText}` : ""
    };
  }

  validateCommand(rawCommand) {
    const inspected = this.inspectCommand(rawCommand);
    if (inspected.requiresConfirmation) {
      throw new Error(`该命令需要二次确认。请发送: ${inspected.confirmationCommand}`);
    }

    return inspected.argv;
  }

  async execute({ chatId, rawCommand, workdir }) {
    const key = String(chatId);
    if (this.isBusy(key)) {
      return {
        started: false,
        reason: "busy"
      };
    }

    const argv = this.validateCommand(rawCommand);
    const [command, ...args] = argv;
    const outputLimit = this.config.shell.maxOutputChars;

    return await new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const child = spawn(command, args, {
        cwd: workdir,
        env: process.env,
        shell: false
      });

      this.runningJobs.set(key, child);

      const appendOutput = (chunk) => {
        output = trimOutputTail(`${output}${String(chunk || "")}`, outputLimit);
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      }, this.config.shell.timeoutMs);

      child.stdout.on("data", appendOutput);
      child.stderr.on("data", appendOutput);

      child.on("error", (error) => {
        clearTimeout(timeout);
        this.runningJobs.delete(key);
        resolve({
          started: true,
          status: "failed",
          command: argv.join(" "),
          workdir,
          exitCode: -1,
          signal: null,
          output: trimOutputTail(`${output}\n[spawn error] ${error.message}`, outputLimit)
        });
      });

      child.on("close", (exitCode, signal) => {
        clearTimeout(timeout);
        this.runningJobs.delete(key);
        resolve({
          started: true,
          status: timedOut ? "timed_out" : exitCode === 0 ? "passed" : "failed",
          command: argv.join(" "),
          workdir,
          exitCode,
          signal,
          output: output || "(no output)"
        });
      });
    });
  }
}
