const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const cors = require('cors');

const app = express();
app.use(cors()); 
app.use(express.json());

const PORT = 4000; 
const akunFile = path.join(__dirname, 'AKUN.txt');

if (!fs.existsSync(akunFile)) {
    fs.writeFileSync(akunFile, '', 'utf8');
}

let isRunning = false;
let isManualStop = false;
let currentProcess = null;
let retryTimeout = null;
let autoRetryCount = 0;
const MAX_AUTO_RETRY = 2;

let liveLogs = [];
function addLog(text) {
    const timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
    const logLine = `[${timeStr}] ${text}`;
    console.log(logLine);
    liveLogs.push(logLine);
    if (liveLogs.length > 150) liveLogs.shift();
}

function runBotProcess(isNewTrigger = false) {
    if (isNewTrigger) {
        autoRetryCount = 0;
        isManualStop = false;
        if (retryTimeout) {
            clearTimeout(retryTimeout);
            retryTimeout = null;
        }
    }

    if (isRunning) {
        addLog(`? [QUEUE] Bot sedang berjalan. Menunggu antrean berikutnya...`);
        return;
    }

    try {
        if (!fs.existsSync(akunFile)) return;
        const content = fs.readFileSync(akunFile, 'utf8');
        const accounts = content.split('\n').map(a => a.trim()).filter(a => a && !a.startsWith('//'));
        
        if (accounts.length === 0) {
            addLog(`?? [INFO] AKUN.txt kosong. Tidak ada akun untuk diproses.`);
            autoRetryCount = 0;
            return;
        }

        if (autoRetryCount > MAX_AUTO_RETRY) {
            addLog(`?? [QUEUE] Batas Auto-Retry maksimal tercapai (${MAX_AUTO_RETRY}x). Sisa ${accounts.length} akun dibiarkan di AKUN.txt.`);
            return;
        }

        isRunning = true;
        isManualStop = false;

        if (autoRetryCount > 0) {
            addLog(`?? [AUTO RETRY ${autoRetryCount}/${MAX_AUTO_RETRY}] Mencoba ulang ${accounts.length} akun...`);
        } else {
            addLog(`?? [START] Memulai proses Auto Pay untuk ${accounts.length} akun...`);
        }
        
        // detached: true penting agar seluruh grup proses (xvfb + node + browser) bisa di-kill sekaligus
        currentProcess = spawn('xvfb-run', ['-a', 'node', 'bot.min.js', '--auto'], {
            cwd: __dirname,
            detached: true
        });

        currentProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(l => { if (l.trim()) addLog(l.trim()); });
        });

        currentProcess.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(l => { if (l.trim()) addLog(`[ERR] ${l.trim()}`); });
        });

        currentProcess.on('close', (code) => {
            isRunning = false;
            currentProcess = null;

            if (isManualStop) {
                addLog(`?? [STOPPED] Proses telah dihentikan secara paksa oleh Admin.`);
                return;
            }

            addLog(`?? [SELESAI] Proses berhenti dengan kode ${code}`);

            const sisaContent = fs.existsSync(akunFile) ? fs.readFileSync(akunFile, 'utf8') : "";
            const sisaAccounts = sisaContent.split('\n').map(a => a.trim()).filter(a => a && !a.startsWith('//'));
            
            if (sisaAccounts.length > 0) {
                autoRetryCount++;
                addLog(`?? Ditemukan ${sisaAccounts.length} sisa akun di AKUN.txt. Auto-Retry dalam 10 detik...`);
                retryTimeout = setTimeout(() => runBotProcess(false), 10000); 
            } else {
                addLog(`? Semua akun di AKUN.txt berhasil dieksekusi dengan bersih!`);
                autoRetryCount = 0; 
            }
        });

        currentProcess.on('error', (err) => {
            addLog(`? [PROCESS ERROR]: ${err.message}`);
            isRunning = false;
            currentProcess = null;
        });

    } catch (err) {
        addLog(`? [QUEUE ERROR]: ${err.message}`);
        isRunning = false;
        currentProcess = null;
    }
}

// 1. Cek Koneksi & Status
app.get('/api/trigger-autopay', (req, res) => {
    res.json({ success: true, online: true, isRunning, message: "Koneksi Web Panel ke VPS Server B Berhasil!" });
});

// 2. Ambil Live Logs & Status Eksekusi
app.get('/api/logs', (req, res) => {
    res.json({ online: true, logs: liveLogs, isRunning });
});

// 3. Kontrol Start & Stop Proses Bot dari Web Panel
app.post('/api/serverb/control', (req, res) => {
    const { action } = req.body;
    
    if (action === 'start') {
        if (isRunning) {
            return res.json({ success: true, message: "Script Pay sedang berjalan saat ini." });
        }
        const content = fs.existsSync(akunFile) ? fs.readFileSync(akunFile, 'utf8') : '';
        const accounts = content.split('\n').map(a => a.trim()).filter(a => a && !a.startsWith('//'));
        if (accounts.length === 0) {
            return res.status(400).json({ error: "AKUN.txt masih kosong! Isi akun terlebih dahulu." });
        }
        runBotProcess(true);
        return res.json({ success: true, message: `Script Pay dijalankan untuk ${accounts.length} akun.` });
    } 
    else if (action === 'stop') {
        isManualStop = true;
        autoRetryCount = 0;

        if (retryTimeout) {
            clearTimeout(retryTimeout);
            retryTimeout = null;
        }

        if (currentProcess && currentProcess.pid) {
            try {
                // Mematikan seluruh process group (xvfb + node + browser)
                process.kill(-currentProcess.pid, 'SIGKILL');
            } catch (e) {
                try { currentProcess.kill('SIGKILL'); } catch (err) {}
            }
        }

        // Sapu bersih sisa proses bot.min.js atau xvfb jika masih menyangkut di sistem Linux
        exec("pkill -9 -f 'bot.min.js'; pkill -9 -f 'Xvfb'", () => {});

        isRunning = false;
        currentProcess = null;
        addLog(`?? [ADMIN] Perintah STOP diterima dari Web Panel. Menghentikan paksa script pay...`);
        return res.json({ success: true, message: "Script Pay di Server B berhasil dihentikan!" });
    }
    
    res.status(400).json({ error: "Aksi tidak dikenal" });
});

// 4. Menerima Kiriman Akun Otomatis saat Order Sukses
app.post('/api/trigger-autopay', (req, res) => {
    const accounts = req.body.accounts;
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({ error: "Data akun tidak valid" });
    }

    const formattedAccounts = accounts.map(acc => {
        const parts = acc.split(':');
        return parts.length >= 2 ? `${parts[0].trim()} ${parts[1].trim()}` : acc.trim();
    }).join('\n') + '\n';

    try {
        fs.appendFileSync(akunFile, formattedAccounts, 'utf8');
        addLog(`?? [ORDER MASUK] Menerima ${accounts.length} akun baru. Disimpan ke AKUN.txt.`);
    } catch (e) {
        return res.status(500).json({ error: "Gagal menulis ke file AKUN.txt" });
    }

    res.json({ success: true, message: "Akun berhasil diterima dan masuk antrean sistem." });
    runBotProcess(true);
});

// 5. Baca Isi File AKUN.txt untuk Editor Web Panel
app.get('/api/check-failed', (req, res) => {
    try {
        if (!fs.existsSync(akunFile)) {
            fs.writeFileSync(akunFile, '', 'utf8');
            return res.json({ rawContent: '', accounts: [] });
        }
        const content = fs.readFileSync(akunFile, 'utf8');
        const accounts = content.split('\n').map(a => a.trim()).filter(a => a && !a.startsWith('//'));
        res.json({ rawContent: content, accounts });
    } catch (e) {
        res.status(500).json({ error: "Gagal membaca file AKUN.txt" });
    }
});

// 6. Simpan Perubahan Edit File AKUN.txt dari Web Panel
app.post('/api/update-akun', (req, res) => {
    try {
        const { rawContent } = req.body;
        if (rawContent === undefined) return res.status(400).json({ error: "Konten tidak valid" });
        
        // Pastikan format baris rapi dan diakhiri newline jika tidak kosong
        const cleanContent = rawContent.trim() ? rawContent.trim() + '\n' : '';
        fs.writeFileSync(akunFile, cleanContent, 'utf8');
        
        const count = cleanContent ? cleanContent.trim().split('\n').length : 0;
        addLog(`?? [EDITOR] File AKUN.txt diperbarui melalui Web Panel (${count} baris).`);
        res.json({ success: true, message: "File AKUN.txt berhasil disimpan." });
    } catch (e) {
        res.status(500).json({ error: "Gagal menyimpan file AKUN.txt" });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`?? Receiver API untuk Server B aktif di port ${PORT}`);
    addLog(`?? Server B Receiver aktif dan siap menerima perintah.`);
});
