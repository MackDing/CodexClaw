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
  assert.equal(normalizeLanguage("fr"), "");
});

test("languageLabel resolves localized language names", () => {
  assert.equal(languageLabel("zh-HK", "en"), "Traditional Chinese (Hong Kong)");
  assert.equal(languageLabel("en", "zh"), "英文");
});

test("t falls back through locale catalogs in the documented order", () => {
  assert.equal(t("zh-HK", "usagePlan"), "用法: /plan <task>");
  assert.deepEqual(t("zh-HK", "startLines"), [
    "codex-telegram-claws 已就绪。",
    "普通消息和编码任务会路由到 Codex。",
    "Bot 侧 MCP 仅通过显式 /mcp 命令调用。",
    "试试: /status, /repo, /pwd, /exec, /auto, /plan, /model, /language, /verbose, /skill, /new, /sh",
    'GitHub 示例: /gh commit "feat: init"'
  ]);
});
