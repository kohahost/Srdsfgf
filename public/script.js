document.addEventListener('DOMContentLoaded', () => {
    try {
        const socket = io();

        // Elemen UI Global
        const sidebar = document.querySelector('.sidebar');
        const mainContent = document.querySelector('.main-content');
        const menuBtn = document.querySelector('.menu-btn');
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const logOutputEl = document.getElementById('log-output');
        const navLinks = document.querySelectorAll('.sidebar-nav a');
        const pages = document.querySelectorAll('.page-content');
        
        // Elemen Form
        const receiverAddressInput = document.getElementById('receiver-address');
        const memoInput = document.getElementById('memo');
        const phrasesTextarea = document.getElementById('phrases');
        const tokenInput = document.getElementById('telegram-token');
        const chatIdInput = document.getElementById('telegram-chat-id');
        const allSaveButtons = document.querySelectorAll('.btn-save');
        const allStatusElements = document.querySelectorAll('.save-status');

        // Elemen Status
        const statusIndicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');

        // --- BATAS MAKSIMUM LOG (BARU) ---
        const MAX_LOG_ENTRIES = 20; // Ganti angka ini jika ingin lebih banyak/sedikit

        // --- FUNGSI UTAMA ---

        function toggleSidebar() {
            sidebar.classList.toggle('collapsed');
            mainContent.classList.toggle('collapsed');
        }

        function showPage(targetId) {
            const id = targetId.substring(1);
            pages.forEach(page => page.id === id ? page.classList.remove('hidden') : page.classList.add('hidden'));
            navLinks.forEach(link => link.getAttribute('href') === targetId ? link.classList.add('active') : link.classList.remove('active'));
        }

        async function loadSettings() {
            try {
                const response = await fetch('/api/settings');
                if (!response.ok) throw new Error(`Network response error (${response.status})`);
                const settings = await response.json();
                receiverAddressInput.value = settings.receiverAddress || '';
                memoInput.value = settings.memo || '';
                phrasesTextarea.value = settings.phrases || '';
                tokenInput.value = settings.token || '';
                chatIdInput.value = settings.chatId || '';
            } catch (error) { renderLogEntry({ type: 'error', message: `[PANEL] Gagal memuat pengaturan: ${error.message}` }); }
        }
        
        async function saveAllSettings() {
            const settings = {
                receiverAddress: receiverAddressInput.value, memo: memoInput.value,
                phrases: phrasesTextarea.value, token: tokenInput.value, chatId: chatIdInput.value,
            };
            allStatusElements.forEach(el => { el.textContent = 'Menyimpan...'; el.style.color = 'var(--accent-primary)'; });

            try {
                const response = await fetch('/api/settings', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                const result = await response.json();
                const isOk = response.ok;
                const statusMsg = isOk ? result.message : `Error: ${result.error}`;
                allStatusElements.forEach(el => {
                    el.textContent = statusMsg;
                    el.style.color = isOk ? 'var(--accent-success)' : 'var(--accent-danger)';
                });
            } catch (error) {
                const errorMsg = 'Gagal terhubung ke server.';
                allStatusElements.forEach(el => { el.textContent = errorMsg; el.style.color = 'var(--accent-danger)';});
            }
            setTimeout(() => allStatusElements.forEach(el => el.textContent = ''), 4000);
        }
        
        function updateBotStatusUI(isRunning) {
            const allFormElements = document.querySelectorAll('input, textarea, .btn-save');
            if (isRunning) {
                statusIndicator.classList.remove('offline');
                statusIndicator.classList.add('online');
                statusText.textContent = 'Online';
                startBtn.style.display = 'none';
                stopBtn.style.display = 'block';
                stopBtn.disabled = false;
                allFormElements.forEach(el => el.disabled = true);
            } else {
                statusIndicator.classList.remove('online');
                statusIndicator.classList.add('offline');
                statusText.textContent = 'Offline';
                startBtn.style.display = 'block';
                stopBtn.style.display = 'none';
                stopBtn.disabled = true;
                allFormElements.forEach(el => el.disabled = false);
            }
        }
        
        function renderLogEntry({ type, message }) {
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry';
            const cleanMessage = message.replace(/\[.*?\]\s*/, '').trim();
            const lines = cleanMessage.split('\n');
            lines.forEach((line, index) => {
                const lineEl = document.createElement('span');
                let lineClass = 'log-line';
                if (index === 0) lineClass += ' log-main';
                if (type === 'success') lineClass += ' log-success';
                if (type === 'error') lineClass += ' log-error';
                if (['info', 'api', 'panel'].includes(type)) lineClass += ' log-info';
                
                lineEl.className = lineClass;
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                if (line.match(urlRegex) && line.includes('blockexplorer')) {
                    lineEl.innerHTML = line.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">Lihat Transaksi</a>');
                } else {
                    lineEl.textContent = line;
                }
                logEntry.appendChild(lineEl);
            });
            logOutputEl.appendChild(logEntry);

            // --- LOGIKA HAPUS LOG OTOMATIS (BARU) ---
            // Saat jumlah log melebihi batas, hapus log yang paling lama (paling atas)
            while (logOutputEl.children.length > MAX_LOG_ENTRIES) {
                logOutputEl.removeChild(logOutputEl.firstChild);
            }
            // --- AKHIR LOGIKA ---

            logOutputEl.scrollTop = logOutputEl.scrollHeight;
        }

        // --- EVENT LISTENERS ---
        menuBtn.addEventListener('click', toggleSidebar);
        navLinks.forEach(link => { link.addEventListener('click', (e) => { e.preventDefault(); showPage(link.getAttribute('href')); }); });
        allSaveButtons.forEach(button => { button.addEventListener('click', saveAllSettings); });
        startBtn.addEventListener('click', () => { renderLogEntry({type: 'panel', message: '[PANEL] Perintah START dikirim...'}); fetch('/api/start', { method: 'POST' }); });
        stopBtn.addEventListener('click', () => { renderLogEntry({type: 'panel', message: '[PANEL] Perintah STOP dikirim...'}); fetch('/api/stop', { method: 'POST' }); });
        
        // --- SOCKET.IO LISTENERS ---
        socket.on('connect', () => {
            logOutputEl.innerHTML = '';
            renderLogEntry({ type: 'api', message: '[SERVER] Terhubung ke server...' });
            loadSettings();
            fetch('/api/status').then(res => res.json()).then(status => updateBotStatusUI(status.isRunning));
        });
        socket.on('new_log', (data) => renderLogEntry(data));
        socket.on('statusUpdate', (status) => updateBotStatusUI(status.isRunning));

        // Inisialisasi
        showPage('#activities');
    } catch (error) {
        console.error("!!! FATAL SCRIPT ERROR !!!", error);
        alert("Terjadi error fatal pada JavaScript. Silakan cek Console (F12) untuk detail.");
    }
});