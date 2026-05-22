# Security Policy

## Scope

This repository contains CodexClaw, a Telegram-controlled automation runtime for Codex, GitHub workflows, MCP routing, scheduled jobs, and related operational tooling. Security issues in authentication, authorization, sandbox configuration, shell execution, GitHub token handling, state files, dependency configuration, and deployment guidance are in scope.

## Reporting a Vulnerability

Do not disclose secrets, bot tokens, GitHub tokens, chat IDs, session identifiers, private keys, production logs, screenshots, or exploit details in public issues, pull requests, commits, or chat.

Use GitHub private vulnerability reporting if it is enabled for this repository. If it is not available, contact the repository owner privately with a redacted summary, affected paths, reproduction steps, and impact. Include enough detail to reproduce the issue without pasting raw credentials or sensitive runtime identifiers.

## High-Risk Areas

Prioritize reports involving:

- Telegram user whitelist bypass.
- Unauthorized shell execution or command allowlist bypass.
- Unsafe escalation to `danger-full-access` or `approvalPolicy=never`.
- GitHub token over-scope or unintended repository write access.
- State files that expose chat IDs, thread IDs, tokens, or recoverable identity data.
- Logs or error responses that include tokens, command output, private paths, or secrets.

## Secret Handling

If a token, API key, cookie, private key, session, or credential-like value has entered Git history, logs, artifacts, caches, screenshots, or documentation, treat it as exposed even if the repository is private.

Required response:

1. Revoke or rotate the credential in the upstream service.
2. Move replacement values to GitHub Secrets, deployment platform secrets, or a dedicated secret manager.
3. Confirm old credentials are rejected by the upstream service.
4. Remove or redact exposed values from current files, logs, artifacts, caches, and documentation where possible.
5. Record only redacted evidence and completion status.

## Secure Development Baseline

- Keep `.env`, `.env.*`, local state, tokens, cookies, and production logs out of Git.
- Default remote execution to least privilege.
- Keep shell execution disabled unless explicitly required.
- Keep GitHub Actions permissions read-only by default and elevate per job only when needed.
- Do not print authorization headers, bot tokens, GitHub tokens, chat IDs, cookies, or upstream response bodies that may contain secrets.

## Expected Response Time

The maintainer should acknowledge a credible vulnerability report as soon as practical and prioritize remote execution, credential exposure, authentication bypass, data leakage, and production-impacting issues first.