import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTelegramApiUrl,
  requestTelegramJson
} from "../src/lib/telegramApi.js";

test("buildTelegramApiUrl preserves bot tokens that contain colons", () => {
  assert.equal(
    buildTelegramApiUrl("https://api.telegram.org", "123456:abcDEF", "getMe"),
    "https://api.telegram.org/bot123456:abcDEF/getMe"
  );
});

test("requestTelegramJson issues a GET request without a body by default", async () => {
  const calls: Array<Record<string, unknown>> = [];

  const result = await requestTelegramJson<{ ok: true }>(
    {
      apiBase: "https://api.telegram.org",
      token: "test-token",
      method: "getMe"
    },
    async (url, options) => {
      calls.push({ url, options });
      return {
        statusCode: 200,
        body: {
          text: async () => JSON.stringify({ ok: true })
        }
      } as never;
    }
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.telegram.org/bottest-token/getMe");
  assert.equal((calls[0].options as { method?: string }).method, "GET");
  assert.equal((calls[0].options as { body?: string }).body, undefined);
});

test("requestTelegramJson JSON-encodes POST bodies", async () => {
  const result = await requestTelegramJson<{ ok: true }>(
    {
      apiBase: "https://api.telegram.org",
      token: "test-token",
      method: "sendMessage",
      body: {
        chat_id: "123",
        text: "hello"
      }
    },
    async (_url, options) =>
      ({
        statusCode: 200,
        body: {
          text: async () => {
            assert.ok(options);
            assert.equal(options.method, "POST");
            assert.deepEqual(options.headers, {
              "content-type": "application/json"
            });
            assert.equal(
              options.body,
              JSON.stringify({ chat_id: "123", text: "hello" })
            );
            return JSON.stringify({ ok: true });
          }
        }
      }) as never
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { ok: true });
});
