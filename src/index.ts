import axios from "axios";
import dotenv from "dotenv";
import { registerGroup, saveMessage } from "./database";

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set in .env");
}

const apiUrl = `https://api.telegram.org/bot${botToken}`;
const TRIGGER_WORD = "@MiniClaw";
const GROUP_CHAT_TYPES = new Set(["group", "supergroup"]);

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: {
      id: number;
      type: "private" | "group" | "supergroup" | string;
    };
    text?: string;
    date: number;
  };
};

type GetUpdatesResponse = {
  ok: boolean;
  result: TelegramUpdate[];
};

let lastUpdateId = 0;

async function sendMessage(chatId: number, text: string): Promise<void> {
  try {
    await axios.post(`${apiUrl}/sendMessage`, {
      chat_id: chatId,
      text,
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error("API error:", error.response.data);
      return;
    }

    if (error instanceof Error) {
      console.error("Network error:", error.message);
      return;
    }

    console.error("Unknown error while sending message");
  }
}

async function getUpdates(): Promise<void> {
  try {
    const response = await axios.get<GetUpdatesResponse>(
      `${apiUrl}/getUpdates`,
      {
        params: {
          offset: lastUpdateId + 1,
        },
      },
    );

    if (!response.data.ok || response.data.result.length === 0) {
      return;
    }

    for (const update of response.data.result) {
      if (update.message?.text) {
        const chatId = update.message.chat.id;
        const chatType = update.message.chat.type;
        const text = update.message.text;
        const messageId = update.message.message_id;

        if (chatType === "private") {
          console.log(`[Telegram] Private message from chat_id=${chatId}: ${text}`);
        } else if (GROUP_CHAT_TYPES.has(chatType)) {
          if (!text.includes(TRIGGER_WORD)) {
            console.log(`[Telegram] Group message ignored (no trigger word): ${text}`);
            lastUpdateId = update.update_id;
            continue;
          }

          console.log(`[Telegram] Group message from chat_id=${chatId}: ${text}`);

          const isNewGroup = registerGroup(chatId);
          if (isNewGroup) {
            console.log(`[DB] New group registered: ${chatId}`);
          }
        } else {
          lastUpdateId = update.update_id;
          continue;
        }

        const saved = saveMessage(chatId, messageId, text);
        if (saved) {
          console.log(
            `[DB] Message saved: id=${saved.id}, group_id=${saved.group_id}, status=${saved.status}`,
          );
          await sendMessage(chatId, `ECHO: 收到消息: ${text}`);
        }
      }

      lastUpdateId = update.update_id;
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error("API error:", error.response.data);
      return;
    }

    if (error instanceof Error) {
      console.error("Network error:", error.message);
      return;
    }

    console.error("Unknown error while fetching updates");
  }
}

async function pollLoop(): Promise<void> {
  await getUpdates();
  setTimeout(pollLoop, 2000);
}

console.log("Bot started. Polling every 2 seconds...");
pollLoop();
