# TypeScript Runtime Migration Design

**Date:** 2026-03-14

**Goal:** Finish the runtime TypeScript migration by converting the remaining JavaScript modules under `src/` to `.ts`, preserving behavior while tightening type boundaries across the bot, runner, MCP, and GitHub skill surfaces.

## Context

The repository is already partially migrated:

- Core bootstrap and runtime coordination are in TypeScript.
- Ten runtime modules under `src/` are still JavaScript.
- `tsconfig.json` currently permits unchecked JavaScript with `allowJs: true` and `checkJs: false`.

That means `npm run typecheck` only validates the TypeScript entry graph, while a non-trivial portion of the runtime still escapes static checking.

## Scope

This design covers the remaining JavaScript modules in `src/`:

- `src/bot/commandUtils.js`
- `src/bot/formatter.js`
- `src/bot/i18n.js`
- `src/bot/middleware.js`
- `src/cron/scheduler.js`
- `src/ops/healthcheck.js`
- `src/orchestrator/skills/githubSkill.js`
- `src/orchestrator/skills/mcpSkill.js`
- `src/runner/commandLine.js`
- `src/runner/ptyPreflight.js`

This pass may update `tests/` and `scripts/` only when required to keep imports, types, or behavior aligned with the converted runtime modules.

## Non-Goals

- Full TypeScript conversion of `tests/` and `scripts/` in the same pass.
- Feature changes to bot commands, MCP behavior, GitHub workflows, or healthcheck semantics.
- Broad refactors unrelated to the migration.

## Constraints

- Preserve current runtime behavior for `/status`, `/repo`, `/mcp`, `/gh`, `/sh`, cron delivery, and healthcheck flows.
- Keep the existing module layout and public interfaces unless type safety requires a narrow, explicit contract.
- Avoid mixing migration work with unrelated cleanup.

## Recommended Approach

Use an incremental runtime-first migration:

1. Convert low-risk utility modules first.
2. Convert shared bot helpers that depend on those utilities.
3. Convert behavior-heavy modules that benefit from the new shared types.
4. Tighten `tsconfig.json` only after the remaining `src/` JavaScript surface is removed.

This keeps the work reviewable, reduces regression risk, and ensures later modules can consume stable types instead of duplicating inline annotations.

## Module Groups

### 1. Utility Foundation

Convert:

- `src/runner/commandLine.js`
- `src/runner/ptyPreflight.js`
- `src/bot/commandUtils.js`
- `src/bot/formatter.js`

Purpose:

- Establish typed helpers for shell parsing, PTY helper repair, command parsing, Markdown formatting, and Codex transcript extraction.

Expected exported types:

- shell argv and allowed-prefix inputs
- PTY permission repair result
- plan prompt helpers
- reasoning extraction and formatted message output

### 2. Shared Bot Surface

Convert:

- `src/bot/i18n.js`
- `src/bot/middleware.js`

Purpose:

- Define stable locale and translation-key types.
- Type the auth middleware contract used by `Telegraf`.

Expected exported types:

- supported locale union
- translation parameter map where practical
- auth middleware input contract

### 3. Runtime Services

Convert:

- `src/cron/scheduler.js`
- `src/ops/healthcheck.js`

Purpose:

- Type the scheduler dependencies and the healthcheck result model.
- Remove implicit `any` around cron, Telegram send operations, CLI process output, and Codex SDK live checks.

Expected exported types:

- scheduler constructor dependencies
- healthcheck options
- check result/status shape
- live check result unions for SDK and CLI backends

### 4. Skill Layer

Convert:

- `src/orchestrator/skills/mcpSkill.js`
- `src/orchestrator/skills/githubSkill.js`

Purpose:

- Add explicit input and response types for skill execution.
- Type the internal GitHub test job state and MCP command parsing flow.

Expected exported types:

- skill execute payload
- skill response shape
- GitHub test job record
- supported MCP subcommand handling inputs

## Type Boundary Decisions

The migration should prefer explicit narrow interfaces over deep imported implementation types.

Examples:

- `Scheduler` should depend on the minimum bot/config shape it actually uses, not the entire bootstrap object graph.
- `runHealthcheck` should return a typed result object that callers and tests can assert without stringly-typed assumptions.
- `GitHubSkill` and `McpSkill` should expose stable execute-result shapes instead of returning ad hoc objects.
- `i18n` should type locale values consistently so handlers and skills stop passing unchecked language identifiers.

This keeps module boundaries understandable and prevents type coupling from spreading through the runtime.

## `tsconfig.json` End State

The migration target for this pass is:

- remove the remaining `src/**/*.js` runtime modules from active use
- update imports to `.js` specifiers backed by `.ts` sources under NodeNext
- tighten JavaScript escape hatches once the runtime conversion is complete

The preferred follow-up state is either:

- keep `allowJs: true` temporarily only because `tests/` and `scripts/` still include JavaScript, or
- split runtime and tooling configs if that produces a cleaner path to a fully typed `src/`

The migration should not disable `allowJs` prematurely if doing so blocks unchanged tests or scripts.

## Error Handling Expectations

- Behavior must remain identical for malformed `/mcp` JSON payloads, missing GitHub credentials, empty shell commands, and failed live checks.
- Existing user-facing strings should remain unchanged unless a type-driven fix is required for correctness.
- All caught errors should be normalized with `instanceof Error ? error.message : String(error)` where the current code assumes `.message`.

## Testing Strategy

Verification should be incremental, not deferred to the end.

For each migration slice:

- run `npm run typecheck`
- run focused tests for the affected module area

For the full pass:

- run `npm run check`
- run `npm run lint`
- run `npm run format:check`
- run `npm test`
- run `npm run healthcheck`

If a module conversion changes operator-visible behavior, update `README.md` in the same change set. A pure migration should avoid README churn.

## Risks

- `i18n` is large and may tempt over-modeling; translation typing should stay pragmatic.
- `healthcheck` touches CLI and SDK live paths, so type cleanup must not alter execution order or output parsing.
- `githubSkill` contains mutable async job tracking; incorrect typing can hide lifecycle bugs if the model is too loose.
- Tightening `tsconfig.json` before the runtime surface is fully migrated can create noisy failures that obscure real regressions.

## Success Criteria

- The ten remaining runtime `.js` modules under `src/` are converted to `.ts`.
- Runtime imports and tests continue to resolve correctly under NodeNext.
- `npm run typecheck` covers the full runtime surface in `src/`.
- Existing behavior remains stable for command handling, skill execution, scheduler delivery, and healthcheck output.

## Follow-Up

After this design is accepted, the implementation plan should break the work into small TDD-oriented tasks, grouped by the module slices above, with verification after each slice and a final `tsconfig.json` tightening step.
