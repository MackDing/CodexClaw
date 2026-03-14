import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "telegraf";
import { createAuthMiddleware } from "../src/bot/middleware.js";

function createConfig(allowedUserIds: string[]) {
  return {
    telegram: {
      botToken: "dummy-token",
      allowedUserIds,
      proactiveUserIds: []
    }
  };
}

function createContext({
  fromId,
  callbackFromId
}: {
  fromId?: number;
  callbackFromId?: number;
}): Context {
  return {
    from:
      fromId === undefined
        ? undefined
        : {
            id: fromId,
            is_bot: false,
            first_name: "Test User"
          },
    callbackQuery:
      callbackFromId === undefined
        ? undefined
        : ({
            from: {
              id: callbackFromId,
              is_bot: false,
              first_name: "Callback User"
            }
          } as Context["callbackQuery"])
  } as Context;
}

test("auth middleware allows whitelisted users", async () => {
  const middleware = createAuthMiddleware(createConfig(["123"]));

  let called = false;
  await middleware(createContext({ fromId: 123 }), async () => {
    called = true;
  });

  assert.equal(called, true);
});

test("auth middleware silently blocks non-whitelisted users", async () => {
  const middleware = createAuthMiddleware(createConfig(["123"]));

  let called = false;
  await middleware(createContext({ fromId: 999 }), async () => {
    called = true;
  });

  assert.equal(called, false);
});

test("auth middleware also checks callback query origin", async () => {
  const middleware = createAuthMiddleware(createConfig(["555"]));

  let called = false;
  await middleware(createContext({ callbackFromId: 555 }), async () => {
    called = true;
  });

  assert.equal(called, true);
});
