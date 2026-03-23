import type { Agent as HttpAgent } from "node:http";
import type { Dispatcher } from "undici";
import { ProxyAgent, request } from "undici";
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
  return `${normalized}/bot${token}/${method}`;
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

interface TelegramRequestResponse<T> {
  statusCode: number;
  payload: T;
}

type TelegramRequestImpl = typeof request;

export async function requestTelegramJson<T>(
  {
    apiBase,
    token,
    method,
    proxyUrl,
    body
  }: {
    apiBase: string;
    token: string;
    method: string;
    proxyUrl?: string;
    body?: unknown;
  },
  requestImpl: TelegramRequestImpl = request
): Promise<TelegramRequestResponse<T>> {
  const dispatcher = createTelegramFetchDispatcher(proxyUrl);
  const response = await requestImpl(
    buildTelegramApiUrl(apiBase, token, method),
    {
      method: body ? "POST" : "GET",
      headers: body
        ? {
            "content-type": "application/json"
          }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
      dispatcher
    }
  );
  const rawBody = await response.body.text();

  return {
    statusCode: response.statusCode,
    payload: JSON.parse(rawBody) as T
  };
}
