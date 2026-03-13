import type { Context, MiddlewareFn } from "telegraf";
import type { AppConfig } from "../config.js";

export function createAuthMiddleware(
  config: Pick<AppConfig, "telegram">
): MiddlewareFn<Context> {
  const allowedSet = new Set(config.telegram.allowedUserIds.map(String));

  return async (ctx, next) => {
    const fromId = String(ctx.from?.id || ctx.callbackQuery?.from?.id || "");
    if (!allowedSet.has(fromId)) {
      return;
    }

    await next();
  };
}
