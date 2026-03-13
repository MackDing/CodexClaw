import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const EXECUTE_MASK = 0o111;

export interface ExecutablePermissionResult {
  path: string;
  changed: boolean;
  executable: boolean;
  error?: string;
}

interface NativePtyModule {
  dir: string;
}

interface NodePtyUtilsModule {
  loadNativeModule(name: string): NativePtyModule;
}

export function ensureExecutablePermissions(
  filePath: string
): ExecutablePermissionResult {
  const stat = fs.statSync(filePath);
  const executable = Boolean(stat.mode & EXECUTE_MASK);
  if (executable) {
    return {
      path: filePath,
      changed: false,
      executable: true
    };
  }

  fs.chmodSync(filePath, stat.mode | EXECUTE_MASK);
  const verified = Boolean(fs.statSync(filePath).mode & EXECUTE_MASK);
  return {
    path: filePath,
    changed: true,
    executable: verified
  };
}

export function resolveNodePtySpawnHelperPath(): string {
  const require = createRequire(import.meta.url);
  const unixTerminalPath = require.resolve("node-pty/lib/unixTerminal.js");
  const unixTerminalDir = path.dirname(unixTerminalPath);
  const utils = require("node-pty/lib/utils") as NodePtyUtilsModule;
  const native = utils.loadNativeModule("pty");

  return path.resolve(unixTerminalDir, native.dir, "spawn-helper");
}

export function repairNodePtySpawnHelperPermissions(): ExecutablePermissionResult {
  try {
    const helperPath = resolveNodePtySpawnHelperPath();
    return ensureExecutablePermissions(helperPath);
  } catch (error: unknown) {
    return {
      path: "",
      changed: false,
      executable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
