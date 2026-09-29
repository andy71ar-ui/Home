@echo off
cd /d "%~dp0"
set PORT=3101
echo Iniciando Control del hogar en http://localhost:%PORT%
node server.js
pause
