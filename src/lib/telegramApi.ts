import type { Agent as HttpAgent } from "node:http";
import type { Dispatcher } from "undici";
import { ProxyAgent } from "undici";
import { HttpsProxyAgent } from "https-proxy-agent";

const DEFAULT_TELEGRAM_API_BASE = "https://api.telegram.org";

export function normalizeTelegramApiBase(value?: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return DEFAULT_TELEGRAM_API_BASE;
  return trimmed.replace(/\/+$/, "");
}

export function normalizeTelegramProxyUrl(value?: string): string | undefined {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : undefined;
}

export function buildTelegramApiUrl(
  apiBase: string,
  token: string,
  method: string
): string {
  const normalized = normalizeTelegramApiBase(apiBase);
  const baseUrl = new URL(`${normalized}/`);
  return new URL(`bot${token}/${method}`, baseUrl).toString();
}

export function createTelegramApiAgent(
  proxyUrl?: string
): HttpAgent | undefined {
  const normalized = normalizeTelegramProxyUrl(proxyUrl);
  if (!normalized) return undefined;
  return new HttpsProxyAgent(normalized);
}

export function createTelegramFetchDispatcher(
  proxyUrl?: string
): Dispatcher | undefined {
  const normalized = normalizeTelegramProxyUrl(proxyUrl);
  if (!normalized) return undefined;
  return new ProxyAgent(normalized);
}
