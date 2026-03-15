"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set in .env');
}
const apiUrl = `https://api.telegram.org/bot${botToken}`;
let lastUpdateId = 0;
async function sendMessage(chatId, text) {
    try {
        await axios_1.default.post(`${apiUrl}/sendMessage`, {
            chat_id: chatId,
            text
        });
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error) && error.response) {
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
async function getUpdates() {
    try {
        const response = await axios_1.default.get(`${apiUrl}/getUpdates`, {
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
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error) && error.response) {
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
async function pollLoop() {
    await getUpdates();
    setTimeout(pollLoop, 2000);
}
console.log('Bot started. Polling every 2 seconds...');
pollLoop();
