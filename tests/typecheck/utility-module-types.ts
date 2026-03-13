import type { ReasoningExtraction } from "../../src/bot/formatter.js";
import type { CommandPrefixList } from "../../src/runner/commandLine.js";
import type { ExecutablePermissionResult } from "../../src/runner/ptyPreflight.js";

const prefixes: CommandPrefixList = [["git"], ["npm", "test"]];
const reasoning: ReasoningExtraction = {
  cleanText: "visible",
  reasoningBlocks: ["private"]
};
const permissionResult: ExecutablePermissionResult = {
  path: "/tmp/helper",
  changed: false,
  executable: true
};

void prefixes;
void reasoning;
void permissionResult;
