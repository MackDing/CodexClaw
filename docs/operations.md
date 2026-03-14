# Operations Guide

## Process Supervision

The recommended production supervisor is PM2. This bot uses Telegram long polling, so run exactly one instance per bot token.

`ecosystem.config.ts` is the source of truth. Start PM2 through `ecosystem.config.cjs`, which is a thin compatibility shim for PM2's config loader.

Start:

```bash
npm install
cp .env.example .env
pm2 start ecosystem.config.cjs
```

Common PM2 commands:

```bash
pm2 status codex-telegram-claws
pm2 logs codex-telegram-claws
pm2 restart codex-telegram-claws
pm2 stop codex-telegram-claws
pm2 save
```

## Health Checks

Static health check:

```bash
npm run healthcheck
```

Strict health check:

```bash
npm run healthcheck:strict
```

Optional Telegram live check:

```bash
npm run healthcheck:strict
npm run healthcheck:live
```

What the health check validates:

- workspace and runner directories exist
- the state file directory is writable
- the configured Codex command can be resolved
- `node-pty` helper permissions are valid
- optional live Telegram API authentication

## Deployment Notes

- Keep exactly one polling process per bot token.
- If you also use Codex directly in a terminal, run that work in a separate git worktree. The bot only detects conflicts with other bot-managed chats, not external terminal sessions.
- Run the bot under a restricted system user.
- Keep `.env` outside version control.
- Rotate Telegram and GitHub tokens if they are ever exposed.
- If you reinstall dependencies on macOS, rerun `npm run healthcheck`; the bot now auto-repairs `node-pty` helper permissions on startup.
