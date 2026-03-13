import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeMarkdownV2,
  extractCodexExecResponse,
  extractReasoning,
  formatPtyOutput,
  splitTelegramMessage
} from "../src/bot/formatter.js";

test("escapeMarkdownV2 escapes Telegram MarkdownV2 special characters", () => {
  const input = "_*[]()~`>#+-=|{}.!\\";
  const escaped = escapeMarkdownV2(input);

  assert.equal(
    escaped,
    "\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\"
  );
});

test("extractReasoning separates think blocks from visible output", () => {
  const result = extractReasoning("before<think>first</think>middle<think>second</think>after");

  assert.equal(result.cleanText, "beforemiddleafter");
  assert.deepEqual(result.reasoningBlocks, ["first", "second"]);
});

test("formatPtyOutput renders visible output and spoiler reasoning", () => {
  const rendered = formatPtyOutput("done<think>private reasoning</think>", {
    mode: "spoiler"
  });

  assert.match(rendered, /done/);
  assert.match(rendered, /Reasoning Stream/);
  assert.match(rendered, /\|\|private reasoning\|\|/);
});

test("extractCodexExecResponse strips codex exec transcript noise and keeps the final assistant reply", () => {
  const raw = [
    "OpenAI Codex v0.114.0 (research preview)",
    "--------",
    "workdir: /tmp/demo",
    "model: gpt-5.4",
    "session id: 11111111-1111-1111-1111-111111111111",
    "--------",
    "user",
    "run unit test",
    "mcp startup: no servers",
    "codex",
    "I’m checking the repository layout first.",
    "exec",
    "/bin/zsh -lc 'npm test' succeeded in 1.07s:",
    "ok",
    "codex",
    "`npm test` passed.",
    "",
    "15 tests ran, 15 passed, 0 failed.",
    "tokens used",
    "8,301",
    "`npm test` passed.",
    "",
    "15 tests ran, 15 passed, 0 failed."
  ].join("\n");

  assert.equal(
    extractCodexExecResponse(raw),
    "`npm test` passed.\n\n15 tests ran, 15 passed, 0 failed."
  );
});

test("formatPtyOutput uses cleaned codex exec content when session mode is exec", () => {
  const raw = [
    "OpenAI Codex v0.114.0 (research preview)",
    "--------",
    "workdir: /tmp/demo",
    "--------",
    "user",
    "who are u",
    "mcp startup: no servers",
    "codex",
    "I am Codex."
  ].join("\n");

  const rendered = formatPtyOutput(raw, {
    mode: "spoiler",
    sessionMode: "exec"
  });

  assert.equal(rendered, "I am Codex\\.");
});

test("splitTelegramMessage preserves content and avoids trailing escape characters in chunks", () => {
  const input = `${"a".repeat(9)}\\b`;
  const chunks = splitTelegramMessage(input, 10);

  assert.deepEqual(chunks, ["a".repeat(9), "\\b"]);
  assert.equal(chunks.join(""), input);
  assert.ok(chunks.every((chunk) => !chunk.endsWith("\\")));
});
