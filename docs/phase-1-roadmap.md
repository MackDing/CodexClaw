# Phase 1 Roadmap

## Scope

Phase 1 hardens the current single-host beta so it can be distributed to subsidiary CTO teams as a controlled enterprise beta. This phase does not introduce the full control-plane and worker split yet. It makes the existing runtime governable, testable, and easier to operate.

## Success Criteria

- Core runtime contracts are type-safe and documented.
- Dangerous actions require explicit approval and produce audit events.
- Health, logs, and smoke tests are machine-readable and usable in operations.
- A new subsidiary team can install and validate the bot with a repeatable checklist.

## Workstreams

### 1. TypeScript Migration For Core Runtime

Scope:

- Migrate `src/config.ts`
- Migrate `src/orchestrator/router.ts`
- Migrate `src/orchestrator/skillRegistry.ts`
- Migrate `src/orchestrator/mcpClient.ts`
- Migrate `src/runner/ptyManager.ts`
- Migrate `src/runner/shellManager.ts`

Deliverables:

- `tsconfig.json`
- build and typecheck commands
- stable interfaces for config, skill contracts, runner sessions, and runtime state

Acceptance:

- `npm run typecheck` passes
- existing tests still pass
- no runtime behavior regression in `/status`, `/repo`, `/mcp`, `/gh`, `/sh`

### 2. Audit Event Model

Scope:

- Define a structured event schema for operator actions and bot decisions.
- Capture user identity, chat id, project, command, worker host, result, and timestamp.

Deliverables:

- audit event schema document
- append-only local event sink for beta
- hooks in Telegram handlers, skill execution, shell execution, and restart flow

Acceptance:

- every privileged action emits an event
- audit records can be exported as JSON lines

### 3. Approval Gates For Dangerous Actions

Scope:

- Add an approval state machine for write-capable shell actions
- Add approval for `git push`, repo creation, and other GitHub write actions

Deliverables:

- approval command flow
- pending approval state storage
- localized operator-facing prompts

Acceptance:

- dangerous actions cannot execute without explicit approval
- approval and denial both create audit events

### 4. Structured Logging And Health Output

Scope:

- Replace ad hoc console output with structured logs
- Add machine-readable health output for automation

Deliverables:

- JSON log mode
- healthcheck `--json` output
- operator-visible startup summary

Acceptance:

- logs can be ingested by PM2 or external log collectors
- healthcheck can be parsed by CI and supervisor tooling

### 5. Telegram Regression Coverage

Scope:

- Extend beyond `getMe` smoke checks
- Validate critical Telegram command paths against a real bot

Deliverables:

- scripted regression checks for `/status`, `/repo`, `/language`, `/verbose`, `/mcp list`
- operator runbook for live regression

Acceptance:

- regression script can run in a controlled staging bot environment
- failures are visible in CI or release gating

### 6. Subsidiary Deployment Pack

Scope:

- Make first-time installation repeatable for subsidiary CTO teams

Deliverables:

- environment checklist
- service account guidance
- directory isolation requirements
- token and secret handling guide
- PM2 deployment example per host

Acceptance:

- a new team can deploy from docs without direct maintainer intervention

## Recommended Execution Order

1. TypeScript migration for `config`, `router`, and `skillRegistry`
2. Audit event schema and append-only sink
3. Approval flow for dangerous actions
4. Structured logging and machine-readable health output
5. Telegram regression automation
6. Subsidiary deployment pack finalization

## Risks

- Migrating runtime modules to TypeScript without preserving behavior will create operational regressions.
- Approval flow added too late leaves write actions under-governed.
- Regression checks that depend on a personal bot token are not suitable for shared enterprise CI.
- Audit logs without a stable schema will become unusable once the control-plane split starts.

## Out Of Scope

- Multi-worker control plane
- SSO/OIDC and enterprise RBAC
- centralized database-backed audit store
- full tenant isolation
- webhook-based high-availability Telegram ingress

These begin in Phase 2.
