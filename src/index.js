require('dotenv').config();
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

let lastUpdateId = 0;

async function getUpdates() {
  try {
    const response = await axios.get(`${API_URL}/getUpdates`, {
      params: {
        offset: lastUpdateId + 1
      }
    });

    if (response.data.ok && response.data.result.length > 0) {
      for (const update of response.data.result) {
        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text;

          console.log(`[Telegram] Received message from chat_id=${chatId}: ${text}`);

          await sendMessage(chatId, `ECHO: 收到消息: ${text}`);
        }

        lastUpdateId = update.update_id;
      }
    }
  } catch (error) {
    if (error.response) {
      console.error('API error:', error.response.data);
    } else {
      console.error('Network error:', error.message);
    }
  }
}

async function sendMessage(chatId, text) {
  try {
    await axios.post(`${API_URL}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
  } catch (error) {
    if (error.response) {
      console.error('API error:', error.response.data);
    } else {
      console.error('Network error:', error.message);
    }
  }
}

console.log('Bot started. Polling every 2 seconds...');

setInterval(getUpdates, 2000);