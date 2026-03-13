export function createAuthMiddleware(config) {
  const allowedSet = new Set(config.telegram.allowedUserIds.map(String));

  return async (ctx, next) => {
    const fromId = String(ctx.from?.id || ctx.callbackQuery?.from?.id || "");
    if (!allowedSet.has(fromId)) {
      return;
    }

    await next();
  };
}
