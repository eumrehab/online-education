@echo off
cd /d "%~dp0"
start "교육원 테스트 서버" /min node server.js
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8080
