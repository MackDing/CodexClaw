import process from "node:process";
import { loadConfig } from "../src/config.js";
import { runHealthcheck } from "../src/ops/healthcheck.js";

const strict = process.argv.includes("--strict");
const telegramLiveCheck = process.argv.includes("--telegram-live");
const codexLiveCheck = process.argv.includes("--codex-live");

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FAIL] config: ${message}`);
  process.exit(1);
}

const result = await runHealthcheck(config, {
  strict,
  telegramLiveCheck,
  codexLiveCheck
});

for (const check of result.checks) {
  console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.detail}`);
}

process.exit(result.ok ? 0 : 1);
