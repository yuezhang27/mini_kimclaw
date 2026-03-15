import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in .env');
}

const apiUrl = `https://api.telegram.org/bot${botToken}`;

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: {
      id: number;
      type: string;
    };
    text?: string;
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
      text
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('API error:', error.response.data);
      return;
    }

    if (error instanceof Error) {
      console.error('Network error:', error.message);
      return;
    }

    console.error('Unknown error while sending message');
  }
}

async function getUpdates(): Promise<void> {
  try {
    const response = await axios.get<GetUpdatesResponse>(`${apiUrl}/getUpdates`, {
      params: {
        offset: lastUpdateId + 1
      }
    });

    if (!response.data.ok || response.data.result.length === 0) {
      return;
    }

    for (const update of response.data.result) {
      if (update.message?.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text;

        console.log(`[Telegram] Received message from chat_id=${chatId}: ${text}`);
        await sendMessage(chatId, `ECHO: 收到消息: ${text}`);
      }

      lastUpdateId = update.update_id;
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('API error:', error.response.data);
      return;
    }

    if (error instanceof Error) {
      console.error('Network error:', error.message);
      return;
    }

    console.error('Unknown error while fetching updates');
  }
}

async function pollLoop(): Promise<void> {
  await getUpdates();
  setTimeout(pollLoop, 2000);
}

console.log('Bot started. Polling every 2 seconds...');
pollLoop();
