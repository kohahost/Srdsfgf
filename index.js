const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { startBot, stopBot, getStatus } = require('./bot-worker');
const telegramNotifier = require('./telegram-notifier');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const ENV_PATH = path.join(__dirname, '.env');
const PHRASES_PATH = path.join(__dirname, 'phrases.txt');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('[SERVER] Panel web terhubung.');
    socket.emit('statusUpdate', getStatus());
});

const originalLog = console.log;
console.log = function(...args) {
    const rawMessage = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    originalLog.apply(console, args);

    let type = 'info';
    if (rawMessage.includes('✅')) type = 'success';
    if (rawMessage.includes('❌')) type = 'error';
    if (rawMessage.startsWith('[PANEL]')) type = 'panel';
    if (rawMessage.startsWith('[API]')) type = 'api';
    
    io.emit('new_log', { type, message: rawMessage });
};
console.error = console.log;

app.post('/api/start', (req, res) => {
    try {
        console.log('[API] Menerima permintaan start...');
        const recipient = process.env.RECEIVER_ADDRESS;
        if (!recipient || !recipient.startsWith('G') || recipient.length !== 56) throw new Error("RECEIVER_ADDRESS di .env tidak valid.");
        if (!fs.existsSync(PHRASES_PATH)) throw new Error("File phrases.txt tidak ditemukan.");
        const mnemonics = fs.readFileSync(PHRASES_PATH, 'utf8').split(/\r?\n/).filter(l => l.trim() !== '');
        if (mnemonics.length === 0) throw new Error("File phrases.txt kosong.");

        startBot({ mnemonics, recipient, memo: process.env.MEMO || "PiBot Panel" });
        io.emit('statusUpdate', getStatus());
        res.json({ success: true, message: 'Bot berhasil dimulai.' });
    } catch (e) {
        console.log(`[API_ERROR] Gagal memulai bot: ${e.message}`);
        res.status(400).json({ success: false, message: e.message });
    }
});

app.post('/api/stop', (req, res) => {
    console.log('[API] Menerima permintaan stop...');
    stopBot();
    io.emit('statusUpdate', getStatus());
    res.json({ success: true, message: 'Bot dihentikan.' });
});

app.get('/api/status', (req, res) => res.json(getStatus()));

app.get('/api/settings', (req, res) => {
    try {
        res.json({
            receiverAddress: process.env.RECEIVER_ADDRESS || '', memo: process.env.MEMO || '',
            token: process.env.TELEGRAM_BOT_TOKEN || '', chatId: process.env.TELEGRAM_CHAT_ID || '',
            phrases: fs.existsSync(PHRASES_PATH) ? fs.readFileSync(PHRASES_PATH, 'utf8') : ''
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings', (req, res) => {
    if (getStatus().isRunning) return res.status(400).json({ error: 'Hentikan bot sebelum mengubah pengaturan.' });
    try {
        const { receiverAddress, memo, token, chatId, phrases } = req.body;
        fs.writeFileSync(PHRASES_PATH, phrases, 'utf8');

        let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
        const settingsToUpdate = {
            RECEIVER_ADDRESS: receiverAddress, MEMO: memo,
            TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId,
        };
        for (const [key, value] of Object.entries(settingsToUpdate)) {
            const regex = new RegExp(`^${key}=.*`, 'm');
            if (envContent.match(regex)) {
                envContent = envContent.replace(regex, `${key}=${value}`);
            } else {
                envContent += `\n${key}=${value}`;
            }
        }
        fs.writeFileSync(ENV_PATH, envContent.trim());
        
        require('dotenv').config({ override: true });
        telegramNotifier.updateConfig();

        console.log("[API] Pengaturan berhasil disimpan.");
        res.json({ success: true, message: 'Pengaturan berhasil disimpan!' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

server.listen(PORT, '0.0.0.0', () => {
    originalLog(`[SERVER] Server panel berjalan di http://localhost:${PORT}`);
    telegramNotifier.sendNotification("🖥️ *Server Panel Online*");
});
