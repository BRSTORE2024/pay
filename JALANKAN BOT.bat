@echo off
set BOT_DIR=%~dp0
cd /d %BOT_DIR%

:: Jalankan bot menggunakan Node.js
node bot.min.js

pause
