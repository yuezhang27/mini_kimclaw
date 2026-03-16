import axios from "axios";
import dotenv from "dotenv";
import { execSync } from "child_process";
import {
  getOldestPendingMessage,
  registerGroup,
  saveMessage,
  updateMessageStatus,
} from "./database";

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set in .env");
}

if (!anthropicApiKey) {
  throw new Error("ANTHROPIC_API_KEY is not set in .env");
}

const apiUrl = `https://api.telegram.org/bot${botToken}`;
const TRIGGER_WORDS = ["@MiniClaw", "@kim_miniclaw_bot"];
const GROUP_CHAT_TYPES = new Set(["group", "supergroup"]);

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
};

type TelegramMessage = {
  message_id: number;
  chat: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel" | string;
  };
  text?: string;
  date: number;
};

type GetUpdatesResponse = {
  ok: boolean;
  result: TelegramUpdate[];
};

function getIncomingMessage(update: TelegramUpdate): TelegramMessage | null {
  if (update.message) {
    return update.message;
  }

  if (update.channel_post) {
    return update.channel_post;
  }

  return null;
}

let lastUpdateId = 0;

type ContainerRunResult = {
  ok: true;
  reply: string;
} | {
  ok: false;
};

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
      // LOG FOR DEBUG
      // console.log(`[DEBUG] Raw update:`, JSON.stringify(update));
      const incomingMessage = getIncomingMessage(update);

      if (incomingMessage?.text) {
        const chatId = incomingMessage.chat.id;
        const chatType = incomingMessage.chat.type;
        const text = incomingMessage.text;
        const messageId = incomingMessage.message_id;

        if (chatType === "private") {
          console.log(
            `[Telegram] Private message from chat_id=${chatId}: ${text}`,
          );
        } else if (GROUP_CHAT_TYPES.has(chatType)) {
          // LOG FOR DEBUG
          // console.log(`[DEBUG] Group message raw text: "${text}"`);
          const hasTrigger = TRIGGER_WORDS.some((triggerWord) =>
            text.includes(triggerWord),
          );

          if (!hasTrigger) {
            console.log(
              `[Telegram] Group message ignored (no trigger word): ${text}`,
            );
            lastUpdateId = update.update_id;
            continue;
          }

          console.log(
            `[Telegram] Group message from chat_id=${chatId}: ${text}`,
          );

          const isNewGroup = registerGroup(chatId);
          if (isNewGroup) {
            console.log(`[DB] New group registered: ${chatId}`);
          }
        } else {
          console.log(`[Telegram] Unsupported chat type=${chatType}: ${text}`);
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

async function schedulerLoop(): Promise<void> {
  const pendingMessage = getOldestPendingMessage();

  if (pendingMessage) {
    console.log(`[Scheduler] Found pending task: id=${pendingMessage.id}, group_id=${pendingMessage.group_id}`);

    const containerResult = runAgentContainer(
      pendingMessage.id,
      pendingMessage.group_id,
      pendingMessage.text,
    );

    if (!containerResult.ok) {
      updateMessageStatus(pendingMessage.id, "error");
      console.log(`[DB] Task id=${pendingMessage.id} marked as error`);
      await sendMessage(Number(pendingMessage.group_id), "抱歉，任务处理失败，请重试");
      console.log(`[Telegram] Reply sent to group_id=${pendingMessage.group_id}`);
      setTimeout(schedulerLoop, 2000);
      return;
    }

    updateMessageStatus(pendingMessage.id, "done");
    console.log(`[DB] Task id=${pendingMessage.id} marked as done`);
    await sendMessage(Number(pendingMessage.group_id), containerResult.reply);
    console.log(`[Telegram] Reply sent to group_id=${pendingMessage.group_id}`);
  }

  setTimeout(schedulerLoop, 2000);
}

function runAgentContainer(taskId: number, groupId: string, messageText: string): ContainerRunResult {
  console.log(`[Container] Starting container for task id=${taskId}...`);

  try {
    const output = execSync(
      "docker run --rm -e ANTHROPIC_API_KEY -e GROUP_ID -e MESSAGE_TEXT miniclaw-agent",
      {
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: anthropicApiKey,
          GROUP_ID: groupId,
          MESSAGE_TEXT: messageText,
        },
      },
    );

    const replyLine = output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("AGENT_REPLY:"));

    if (!replyLine) {
      console.error("[Container] No AGENT_REPLY found in container output");
      return { ok: false };
    }

    const reply = replyLine.replace("AGENT_REPLY:", "").trim();
    console.log(`[Container] Output: ${reply}`);
    return { ok: true, reply };
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[Container] Failed: ${error.message}`);
    } else {
      console.error("[Container] Failed with unknown error");
    }

    return { ok: false };
  }
}

console.log("Bot started. Polling every 2 seconds...");
pollLoop();
schedulerLoop();
