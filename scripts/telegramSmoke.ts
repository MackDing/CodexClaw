import "dotenv/config";
import process from "node:process";
import {
  normalizeTelegramApiBase,
  requestTelegramJson
} from "../src/lib/telegramApi.js";

interface TelegramBotUser {
  id: number;
  username: string;
}

interface TelegramSendMessageResult {
  message_id: number;
}

interface TelegramApiSuccess<T> {
  ok: true;
  result: T;
  description?: string;
}

interface TelegramApiFailure {
  ok: false;
  description?: string;
}

type TelegramApiResponse<T> = TelegramApiSuccess<T> | TelegramApiFailure;

const token = String(process.env.BOT_TOKEN || "").trim();
const expectedUsername = String(process.env.TELEGRAM_EXPECTED_USERNAME || "")
  .trim()
  .replace(/^@/, "");
const smokeChatId = String(process.env.TELEGRAM_SMOKE_CHAT_ID || "").trim();
const apiBase = normalizeTelegramApiBase(process.env.TELEGRAM_API_BASE);
const proxyUrl = process.env.TELEGRAM_PROXY_URL;

if (!token) {
  console.error("Missing BOT_TOKEN.");
  process.exit(1);
}

const { statusCode: getMeStatusCode, payload: getMePayload } =
  await requestTelegramJson<TelegramApiResponse<TelegramBotUser>>({
    apiBase,
    token,
    method: "getMe",
    proxyUrl
  });

if (getMeStatusCode < 200 || getMeStatusCode >= 300 || !getMePayload?.ok) {
  console.error(
    `Telegram getMe failed: ${getMePayload?.description || getMeStatusCode}`
  );
  process.exit(1);
}

const botUser = getMePayload.result;
console.log(`Bot username: @${botUser.username}`);
console.log(`Bot id: ${botUser.id}`);

if (expectedUsername && botUser.username !== expectedUsername) {
  console.error(`Expected @${expectedUsername}, got @${botUser.username}`);
  process.exit(1);
}

if (smokeChatId) {
  const message = `codex-telegram-claws smoke check ${new Date().toISOString()}`;
  const { statusCode: sendStatusCode, payload: sendPayload } =
    await requestTelegramJson<TelegramApiResponse<TelegramSendMessageResult>>({
      apiBase,
      token,
      method: "sendMessage",
      proxyUrl,
      body: {
        chat_id: smokeChatId,
        text: message
      }
    });

  if (sendStatusCode < 200 || sendStatusCode >= 300 || !sendPayload?.ok) {
    console.error(
      `Telegram sendMessage failed: ${sendPayload?.description || sendStatusCode}`
    );
    process.exit(1);
  }

  console.log(`Smoke message sent to chat ${smokeChatId}.`);
}
