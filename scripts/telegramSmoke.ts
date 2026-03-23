import "dotenv/config";
import process from "node:process";
import {
  buildTelegramApiUrl,
  createTelegramFetchDispatcher,
  normalizeTelegramApiBase
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
const dispatcher = createTelegramFetchDispatcher(
  process.env.TELEGRAM_PROXY_URL
);

if (!token) {
  console.error("Missing BOT_TOKEN.");
  process.exit(1);
}

const getMeResponse = await fetch(
  buildTelegramApiUrl(apiBase, token, "getMe"),
  dispatcher ? { dispatcher } : undefined
);
const getMePayload =
  (await getMeResponse.json()) as TelegramApiResponse<TelegramBotUser>;

if (!getMeResponse.ok || !getMePayload?.ok) {
  console.error(
    `Telegram getMe failed: ${getMePayload?.description || getMeResponse.status}`
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
  const sendResponse = await fetch(
    buildTelegramApiUrl(apiBase, token, "sendMessage"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: smokeChatId,
        text: message
      }),
      ...(dispatcher ? { dispatcher } : {})
    }
  );
  const sendPayload =
    (await sendResponse.json()) as TelegramApiResponse<TelegramSendMessageResult>;

  if (!sendResponse.ok || !sendPayload?.ok) {
    console.error(
      `Telegram sendMessage failed: ${sendPayload?.description || sendResponse.status}`
    );
    process.exit(1);
  }

  console.log(`Smoke message sent to chat ${smokeChatId}.`);
}
