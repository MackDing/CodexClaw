# TypeScript Runtime Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the remaining JavaScript runtime modules under `src/` to TypeScript without changing bot behavior, and leave the runtime fully covered by TypeScript typechecking.

**Architecture:** Keep the existing feature-oriented layout and NodeNext `.js` import specifiers, rename the remaining `src/**/*.js` modules to `.ts`, and add narrow exported interfaces next to the code that owns them. Sequence the migration from small helpers to shared bot modules to runtime services and skills so later slices can consume stable types instead of growing new `any` usage.

**Tech Stack:** Node.js 20+, TypeScript 5.x, tsx, node:test, Telegraf, node-cron, simple-git, @octokit/rest, @openai/codex-sdk

---

## File Map

### Runtime modules to move from JavaScript to TypeScript

- Move: `src/runner/commandLine.js` -> `src/runner/commandLine.ts`
- Move: `src/runner/ptyPreflight.js` -> `src/runner/ptyPreflight.ts`
- Move: `src/bot/commandUtils.js` -> `src/bot/commandUtils.ts`
- Move: `src/bot/formatter.js` -> `src/bot/formatter.ts`
- Move: `src/bot/i18n.js` -> `src/bot/i18n.ts`
- Move: `src/bot/middleware.js` -> `src/bot/middleware.ts`
- Move: `src/cron/scheduler.js` -> `src/cron/scheduler.ts`
- Move: `src/ops/healthcheck.js` -> `src/ops/healthcheck.ts`
- Move: `src/orchestrator/skills/mcpSkill.js` -> `src/orchestrator/skills/mcpSkill.ts`
- Move: `src/orchestrator/skills/githubSkill.js` -> `src/orchestrator/skills/githubSkill.ts`

### Existing TypeScript callers likely to change

- Modify: `src/bot/handlers.ts`
  Responsibility: consume shared locale and scheduler types instead of duplicating local unions or using `any`.
- Modify: `src/runner/shellManager.ts`
  Responsibility: consume typed command-line helpers and shared locale type.
- Modify: `src/runner/ptyManager.ts`
  Responsibility: consume typed formatter and locale exports.
- Modify: `src/index.ts`
  Responsibility: absorb any constructor or exported type changes from the converted runtime services and skills.
- Modify: `scripts/healthcheck.js`
  Responsibility: keep the CLI entrypoint aligned with the typed `runHealthcheck` surface if option/result names change.
- Modify: `tsconfig.json`
  Responsibility: tighten JavaScript escape hatches after `src/` no longer depends on `.js` runtime files.
- Modify: `package.json`
  Responsibility: only if the final typecheck tightening needs a dedicated runtime tsconfig.
- Modify: `README.md`
  Responsibility: only if the migration changes a documented developer command or verification step.

### Existing tests to extend

- Modify: `tests/commandUtils.test.js`
- Modify: `tests/formatter.test.js`
- Modify: `tests/healthcheck.test.js`
- Modify: `tests/mcpSkill.test.js`
- Modify: `tests/middleware.test.js`
- Modify: `tests/ptyPreflight.test.js`
- Modify: `tests/router.test.js`
- Modify: `tests/shellManager.test.js`

### New tests to add

- Create: `tests/i18n.test.js`
- Create: `tests/scheduler.test.js`
- Create: `tests/githubSkill.test.js`

## Chunk 1: Utility And Bot Foundation

### Task 1: Convert Utility Modules First

**Files:**

- Move: `src/runner/commandLine.js` -> `src/runner/commandLine.ts`
- Move: `src/runner/ptyPreflight.js` -> `src/runner/ptyPreflight.ts`
- Move: `src/bot/commandUtils.js` -> `src/bot/commandUtils.ts`
- Move: `src/bot/formatter.js` -> `src/bot/formatter.ts`
- Modify: `src/runner/shellManager.ts`
- Modify: `src/runner/ptyManager.ts`
- Test: `tests/commandUtils.test.js`
- Test: `tests/formatter.test.js`
- Test: `tests/ptyPreflight.test.js`
- Test: `tests/shellManager.test.js`

- [ ] **Step 1: Extend the existing utility regression tests before renaming files**

Add focused coverage for the untyped helper behavior that current tests do not pin down yet.

```js
import {
  hasForbiddenShellSyntax,
  matchesAllowedCommandPrefix
} from "../src/runner/commandLine.js";

test("hasForbiddenShellSyntax rejects shell control operators and newlines", () => {
  assert.equal(hasForbiddenShellSyntax("git status && pwd"), true);
  assert.equal(hasForbiddenShellSyntax("echo $(pwd)"), true);
  assert.equal(hasForbiddenShellSyntax("git status\npwd"), true);
});

test("matchesAllowedCommandPrefix only accepts exact token prefixes", () => {
  assert.equal(matchesAllowedCommandPrefix(["git", "status"], [["git"]]), true);
  assert.equal(
    matchesAllowedCommandPrefix(["git", "status"], [["git", "push"]]),
    false
  );
});
```

- [ ] **Step 2: Run the focused utility tests to capture the current baseline**

Run: `node --import tsx --test tests/commandUtils.test.js tests/formatter.test.js tests/ptyPreflight.test.js tests/shellManager.test.js`

Expected: PASS. This establishes the behavior that must remain unchanged through the rename and typing work.

- [ ] **Step 3: Rename the four utility modules to `.ts` and add explicit exported types**

Keep all `.js` import specifiers in callers. Add narrow types at the module boundary instead of introducing a shared catch-all type file.

```ts
export type CommandPrefix = readonly string[];
export type CommandPrefixList = readonly CommandPrefix[];

export interface ReasoningExtraction {
  cleanText: string;
  reasoningBlocks: string[];
}

export interface ExecutablePermissionResult {
  path: string;
  changed: boolean;
  executable: boolean;
  error?: string;
}

export function parseCommandLine(value = ""): string[] {
  /* preserve current behavior */
}
export function extractReasoning(raw = ""): ReasoningExtraction {
  /* preserve current behavior */
}
export function ensureExecutablePermissions(
  filePath: string
): ExecutablePermissionResult {
  /* preserve current behavior */
}
```

- [ ] **Step 4: Update the existing TypeScript callers to consume the new typed exports without changing behavior**

Use the converted module exports to remove implicit `any` from helper boundaries in `src/runner/shellManager.ts` and `src/runner/ptyManager.ts`, but do not widen the scope into unrelated cleanup.

```ts
import {
  hasForbiddenShellSyntax,
  matchesAllowedCommandPrefix,
  parseCommandLine,
  type CommandPrefixList
} from "./commandLine.js";
```

- [ ] **Step 5: Run typecheck and the focused utility tests again**

Run: `npm run typecheck`

Expected: PASS with the renamed `.ts` utility modules resolving through the existing `.js` specifiers.

Run: `node --import tsx --test tests/commandUtils.test.js tests/formatter.test.js tests/ptyPreflight.test.js tests/shellManager.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the utility slice**

```bash
git add src/runner/commandLine.ts src/runner/ptyPreflight.ts src/bot/commandUtils.ts src/bot/formatter.ts src/runner/shellManager.ts src/runner/ptyManager.ts tests/commandUtils.test.js tests/formatter.test.js tests/ptyPreflight.test.js tests/shellManager.test.js
git commit -m "refactor: migrate runtime utility modules to typescript"
```

### Task 2: Convert Shared Bot Modules

**Files:**

- Move: `src/bot/i18n.js` -> `src/bot/i18n.ts`
- Move: `src/bot/middleware.js` -> `src/bot/middleware.ts`
- Modify: `src/bot/handlers.ts`
- Modify: `src/runner/shellManager.ts`
- Modify: `src/runner/ptyManager.ts`
- Test: `tests/middleware.test.js`
- Test: `tests/i18n.test.js`

- [ ] **Step 1: Add missing dedicated tests for `i18n` and keep the middleware tests in place**

Create a dedicated `tests/i18n.test.js` file so the migration can lock down the public language surface instead of relying only on indirect behavior through handlers.

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_LANGUAGES,
  languageLabel,
  normalizeLanguage,
  t
} from "../src/bot/i18n.js";

test("normalizeLanguage accepts case and separator variants", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ["en", "zh", "zh-HK"]);
  assert.equal(normalizeLanguage("ZH_hk"), "zh-HK");
  assert.equal(normalizeLanguage(""), "en");
});

test("t falls back through locale catalogs in the documented order", () => {
  assert.match(t("zh-HK", "usagePlan"), /用法|Usage/);
  assert.equal(languageLabel("zh-HK", "en"), "Traditional Chinese (Hong Kong)");
});
```

- [ ] **Step 2: Run the shared bot tests before conversion**

Run: `node --import tsx --test tests/i18n.test.js tests/middleware.test.js tests/commandUtils.test.js tests/formatter.test.js`

Expected: PASS.

- [ ] **Step 3: Rename `i18n` and `middleware` to `.ts` and export the shared locale types**

Replace duplicate locale unions in the TypeScript callers with imports from the converted module.

```ts
export const SUPPORTED_LANGUAGES = ["en", "zh", "zh-HK"] as const;
export type Locale = (typeof SUPPORTED_LANGUAGES)[number];

export function normalizeLanguage(value = ""): Locale | "" {
  /* preserve behavior */
}
export function languageLabel(
  language: string,
  locale: Locale = DEFAULT_LANGUAGE
): string {
  /* preserve behavior */
}
export function t(
  locale: string,
  key: string,
  params: Record<string, unknown> = {}
): string {
  /* preserve behavior */
}
```

- [ ] **Step 4: Replace duplicated locale unions in existing TypeScript callers**

Update `src/bot/handlers.ts`, `src/runner/shellManager.ts`, and `src/runner/ptyManager.ts` to import `type Locale` from `src/bot/i18n.ts` rather than maintaining separate local unions.

```ts
import {
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
  t,
  type Locale
} from "./i18n.js";
```

- [ ] **Step 5: Run typecheck and the shared bot tests after the conversion**

Run: `npm run typecheck`

Expected: PASS.

Run: `node --import tsx --test tests/i18n.test.js tests/middleware.test.js tests/commandUtils.test.js tests/formatter.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the shared bot slice**

```bash
git add src/bot/i18n.ts src/bot/middleware.ts src/bot/handlers.ts src/runner/shellManager.ts src/runner/ptyManager.ts tests/i18n.test.js tests/middleware.test.js
git commit -m "refactor: migrate bot runtime helpers to typescript"
```

## Chunk 2: Runtime Services And Skill Layer

### Task 3: Convert Scheduler And Healthcheck Services

**Files:**

- Move: `src/cron/scheduler.js` -> `src/cron/scheduler.ts`
- Move: `src/ops/healthcheck.js` -> `src/ops/healthcheck.ts`
- Modify: `src/bot/handlers.ts`
- Modify: `src/index.ts`
- Modify: `scripts/healthcheck.js`
- Test: `tests/healthcheck.test.js`
- Test: `tests/scheduler.test.js`

- [ ] **Step 1: Add dedicated scheduler coverage and extend healthcheck assertions where types matter**

Create `tests/scheduler.test.js` to pin the service contract that currently has no direct coverage.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../src/cron/scheduler.js";

test("buildDailySummary formats the previous day summary", async () => {
  const sent = [];
  const scheduler = new Scheduler({
    bot: {
      telegram: {
        sendMessage: async (...args) => sent.push(args)
      }
    },
    config: {
      cron: { dailySummary: "0 9 * * *", timezone: "UTC" },
      github: { defaultWorkdir: process.cwd() },
      telegram: { proactiveUserIds: ["1"] }
    }
  });

  scheduler.git = {
    log: async () => ({
      total: 1,
      all: [{ hash: "abcdef0", message: "feat: ok" }]
    }),
    diffSummary: async () => ({ changed: 2, insertions: 5, deletions: 1 })
  };

  const summary = await scheduler.buildDailySummary();
  assert.match(summary, /Daily Code Summary/);
  assert.match(summary, /Commits: 1/);
});
```

Also extend `tests/healthcheck.test.js` so the typed result shape stays explicit:

```js
assert.equal(
  result.checks.every((check) => typeof check.detail === "string"),
  true
);
assert.equal(
  result.checks.every((check) =>
    ["pass", "warn", "fail"].includes(check.status)
  ),
  true
);
```

- [ ] **Step 2: Run the service tests before conversion**

Run: `node --import tsx --test tests/healthcheck.test.js tests/scheduler.test.js`

Expected: PASS.

- [ ] **Step 3: Rename the service modules to `.ts` and add explicit service/result contracts**

Keep the constructor shapes narrow and caller-facing.

```ts
export interface HealthcheckCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface HealthcheckResult {
  ok: boolean;
  checks: HealthcheckCheck[];
}

export interface SchedulerOptions {
  bot: {
    telegram: {
      sendMessage(
        chatId: string | number,
        text: string,
        options?: Record<string, unknown>
      ): Promise<unknown>;
    };
  };
  config: Pick<AppConfig, "cron" | "github" | "telegram">;
}
```

- [ ] **Step 4: Replace adjacent `any` usage in callers only where the new module types make that straightforward**

`src/bot/handlers.ts` should stop using `scheduler: any` and import the concrete `Scheduler` type. `scripts/healthcheck.js` should continue to call the same exported function names and option keys after the conversion.

```ts
import type { Scheduler } from "../cron/scheduler.js";

interface RegisterHandlersOptions {
  scheduler: Scheduler;
}
```

- [ ] **Step 5: Run typecheck and the service tests after conversion**

Run: `npm run typecheck`

Expected: PASS.

Run: `node --import tsx --test tests/healthcheck.test.js tests/scheduler.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the service slice**

```bash
git add src/cron/scheduler.ts src/ops/healthcheck.ts src/bot/handlers.ts src/index.ts scripts/healthcheck.js tests/healthcheck.test.js tests/scheduler.test.js
git commit -m "refactor: migrate runtime services to typescript"
```

### Task 4: Convert The MCP Skill

**Files:**

- Move: `src/orchestrator/skills/mcpSkill.js` -> `src/orchestrator/skills/mcpSkill.ts`
- Modify: `tests/mcpSkill.test.js`
- Modify: `src/index.ts`

- [ ] **Step 1: Expand the MCP skill tests to cover the full public command surface that the migration will type**

Keep the test doubles small, but make the returned shapes explicit.

```js
test("mcp skill returns usage text for missing call arguments", async () => {
  const skill = createSkill();
  const result = await skill.execute({
    text: "/mcp call context7",
    locale: "en"
  });
  assert.match(result.text, /\/mcp call <server> <tool>/);
});

test("mcp skill reports JSON parse errors from /mcp call", async () => {
  const skill = createSkill();
  const result = await skill.execute({
    text: '/mcp call context7 search {"broken": }',
    locale: "en"
  });
  assert.match(result.text, /JSON/);
});
```

- [ ] **Step 2: Run the MCP skill tests before conversion**

Run: `node --import tsx --test tests/mcpSkill.test.js`

Expected: PASS.

- [ ] **Step 3: Rename `mcpSkill` to `.ts` and add explicit client/response interfaces**

Do not introduce a shared base class. Keep the narrow skill contract local to this module.

```ts
interface McpClientLike {
  hasServers(): boolean;
  listServers(): Array<{ name: string; enabled: boolean; connected: boolean }>;
  reconnectServer(name: string): Promise<unknown>;
  enableServer(name: string): Promise<unknown>;
  disableServer(name: string): Promise<unknown>;
  listTools(
    serverName: string
  ): Promise<Array<{ name: string; description?: string }>>;
  callTool(args: {
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<string>;
}

export interface SkillExecutionResult {
  text: string;
  testJobId?: string;
}
```

- [ ] **Step 4: Re-run typecheck and the MCP tests**

Run: `npm run typecheck`

Expected: PASS.

Run: `node --import tsx --test tests/mcpSkill.test.js tests/router.test.js`

Expected: PASS. `tests/router.test.js` stays in the loop because the router depends on skill `supports()` behavior.

- [ ] **Step 5: Commit the MCP skill slice**

```bash
git add src/orchestrator/skills/mcpSkill.ts src/index.ts tests/mcpSkill.test.js tests/router.test.js
git commit -m "refactor: migrate mcp skill to typescript"
```

### Task 5: Convert The GitHub Skill

**Files:**

- Move: `src/orchestrator/skills/githubSkill.js` -> `src/orchestrator/skills/githubSkill.ts`
- Modify: `src/index.ts`
- Modify: `tests/router.test.js`
- Test: `tests/githubSkill.test.js`

- [ ] **Step 1: Add dedicated GitHub skill tests for the public behaviors that currently have no direct coverage**

Focus on public behavior and job-state bookkeeping. Stub the git client and avoid real network or process execution.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { GitHubSkill } from "../src/orchestrator/skills/githubSkill.js";

function createGitHubConfig() {
  return {
    github: {
      token: "",
      defaultWorkdir: process.cwd(),
      defaultBranch: "main",
      e2eCommand: "npm test"
    }
  };
}

test("github skill returns no-job text when test status is requested before any run", async () => {
  const skill = new GitHubSkill({
    config: createGitHubConfig()
  });

  const result = await skill.readTestStatusFromText("test status", "en");
  assert.match(result.text, /No test jobs|no test jobs/i);
});

test("github skill returns commit-and-push success text from a stub git client", async () => {
  const skill = new GitHubSkill({ config: createGitHubConfig() });
  skill.getGit = () => ({
    status: async () => ({ files: [{ path: "src/index.ts" }] }),
    add: async () => {},
    commit: async () => {},
    branch: async () => ({ current: "main" }),
    push: async () => {}
  });

  const result = await skill.commitAndPush(
    '/gh commit "feat: migrate"',
    process.cwd(),
    "en"
  );
  assert.match(result.text, /feat: migrate/);
});
```

- [ ] **Step 2: Run the GitHub skill tests before conversion**

Run: `node --import tsx --test tests/githubSkill.test.js tests/router.test.js`

Expected: PASS.

- [ ] **Step 3: Rename `githubSkill` to `.ts` and type the mutable job state and external dependencies**

Keep the current public method names intact. The point is to type the existing shape, not redesign the skill.

```ts
export interface GitHubTestJob {
  jobId: string;
  status: "running" | "passed" | "failed";
  workdir: string;
  command: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  output: string;
}

interface GitLike {
  status(): Promise<{ files: Array<{ path: string }> }>;
  add(pathspec: string): Promise<unknown>;
  commit(message: string): Promise<unknown>;
  branch(): Promise<{ current: string }>;
  push(...args: unknown[]): Promise<unknown>;
}
```

- [ ] **Step 4: Re-run typecheck and the GitHub-focused tests**

Run: `npm run typecheck`

Expected: PASS.

Run: `node --import tsx --test tests/githubSkill.test.js tests/router.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the GitHub skill slice**

```bash
git add src/orchestrator/skills/githubSkill.ts src/index.ts tests/githubSkill.test.js tests/router.test.js
git commit -m "refactor: migrate github skill to typescript"
```

## Chunk 3: Final Runtime Sweep

### Task 6: Tighten Typecheck Coverage And Run Release Verification

**Files:**

- Modify: `tsconfig.json`
- Modify: `package.json` if a dedicated runtime tsconfig is required
- Modify: `README.md` only if a command or verification step changes

- [ ] **Step 1: Confirm the runtime migration is complete before tightening config**

Run: `rg --files src | rg '\.js$'`

Expected: no output. If any `src/**/*.js` file remains, stop here and finish that module before touching `tsconfig.json`.

- [ ] **Step 2: Tighten the typecheck configuration with the least risky change**

Preferred path:

```json
{
  "compilerOptions": {
    "allowJs": false,
    "strict": true,
    "noEmit": true
  }
}
```

Fallback path if disabling `allowJs` causes an avoidable mixed-tooling problem:

- Create: `tsconfig.runtime.json`
- Modify: `package.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowJs": false
  },
  "include": ["src/**/*"]
}
```

Use the fallback only if the preferred path breaks unchanged JS tooling in a way that is not worth solving in this migration pass.

- [ ] **Step 3: Run the full required verification suite**

Run: `npm run check`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

Run: `npm run format:check`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Run: `npm run healthcheck`

Expected: PASS.

- [ ] **Step 4: Inspect the final diff for accidental changes**

Run: `git diff --stat`

Expected: only the runtime `.ts` migrations, the targeted test additions/updates, and any intentional `tsconfig` or package-script changes.

Run: `git status --short`

Expected: no unexpected untracked files or unrelated edits.

- [ ] **Step 5: Commit the final runtime migration**

Preferred commit if `tsconfig.json` was tightened directly:

```bash
git add tsconfig.json package.json README.md src tests scripts
git commit -m "refactor: finish runtime typescript migration"
```

If `tsconfig.runtime.json` was created instead:

```bash
git add tsconfig.json tsconfig.runtime.json package.json README.md src tests scripts
git commit -m "refactor: finish runtime typescript migration"
```
