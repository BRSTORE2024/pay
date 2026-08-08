const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process'); // Menggunakan spawn agar bisa live log

const app = express();
app.use(express.json());

const PORT = 4000; 
const API_SECRET = "rahasia-brstore-2026"; 

app.post('/api/trigger-autopay', (req, res) => {
    if (req.headers['x-api-key'] !== API_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const accounts = req.body.accounts;
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({ error: "Data akun tidak valid" });
    }

    const formattedAccounts = accounts.map(acc => {
        const parts = acc.split(':');
        return parts.length >= 2 ? `${parts[0].trim()} ${parts[1].trim()}` : acc;
    }).join('\n') + '\n';

    const akunFile = path.join(__dirname, 'AKUN.txt');
    try {
        fs.appendFileSync(akunFile, formattedAccounts);
        console.log(`\n?? [API] Menerima ${accounts.length} akun baru. Menyimpan ke AKUN.txt...`);
    } catch (e) {
        return res.status(500).json({ error: "Gagal menulis ke file AKUN.txt" });
    }

    console.log(`?? [API] Memulai proses Auto Pay...`);
    
    // Mengeksekusi autopay.js menggunakan spawn untuk mendapatkan log secara REAL-TIME
    const autopayProcess = spawn('node', ['bot.min.js', '--auto', '--headless']);

    // Menangkap log normal (console.log dari autopay.js)
    autopayProcess.stdout.on('data', (data) => {
        // Teks dicetak langsung ke layar terminal Server B
        process.stdout.write(data.toString()); 
    });

    // Menangkap pesan error
    autopayProcess.stderr.on('data', (data) => {
        process.stderr.write(`[ERROR] ${data.toString()}`);
    });

    // Mengetahui kapan prosesnya benar-benar selesai
    autopayProcess.on('close', (code) => {
        console.log(`? [AUTO PAY SELESAI] Proses berhenti dengan kode ${code}`);
    });

    res.json({ success: true, message: "Proses Auto Pay sedang dijalankan di background." });
});

app.listen(PORT, async () => {
    console.log(`?? Receiver API untuk Auto Pay aktif di port ${PORT}`);
    
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        const publicIP = data.ip;
        
        console.log('\n================================================================');
        console.log('? SALIN URL DI BAWAH INI KE WEB PANEL ADMIN BOT TOKO KAMU:');
        console.log(`??  http://${publicIP}:${PORT}/api/trigger-autopay`);
        console.log('================================================================\n');
    } catch (err) {
        console.log('\n================================================================');
        console.log('?? Gagal mendeteksi IP otomatis. Gunakan IP VPS kamu:');
        console.log(`??  http://IP_VPS_KAMU:${PORT}/api/trigger-autopay`);
        console.log('================================================================\n');
    }
});
