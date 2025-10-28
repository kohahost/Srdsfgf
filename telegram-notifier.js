const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

let bot;
let chatId = process.env.TELEGRAM_CHAT_ID;
let token = process.env.TELEGRAM_BOT_TOKEN;

function initializeBot() {
    try {
        if (token && token !== 'TOKEN_BOT_ANDA_DARI_BOTFATHER' && chatId) {
            if (bot && bot.isPolling()) {
                bot.stopPolling();
            }
            bot = new TelegramBot(token);
            console.log('[TELEGRAM] Notifikasi Telegram diaktifkan.');
        } else {
            bot = null;
            console.warn('[TELEGRAM] Token atau Chat ID tidak valid. Notifikasi dinonaktifkan.');
        }
    } catch (error) {
        console.error(`[TELEGRAM] Gagal inisialisasi bot: ${error.message}`);
        bot = null;
    }
}

initializeBot();

async function sendNotification(message) {
    if (!bot || !chatId) return;
    try {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (error) {
        console.error(`[TELEGRAM] Gagal mengirim notifikasi: ${error.message}`);
    }
}

function updateConfig() {
    require('dotenv').config({ override: true });
    token = process.env.TELEGRAM_BOT_TOKEN;
    chatId = process.env.TELEGRAM_CHAT_ID;
    initializeBot();
}

module.exports = { sendNotification, updateConfig };
