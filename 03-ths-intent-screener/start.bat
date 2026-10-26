@echo off
cd /d "%~dp0"
echo Starting Intent Screener on http://127.0.0.1:8080
echo Close this window to stop.
node server\server.js
pause
