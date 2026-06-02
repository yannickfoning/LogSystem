@echo off
title LogSystem Server
echo ========================================
echo         LOGSYSTEM STARTER
echo ========================================
echo.

echo [1/4] Verification MySQL...
net start mysql >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ MySQL non demarre - Demarrage en cours...
    net start mysql
    timeout /t 5 >nul
)

echo [2/4] Arret processus Node.js...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 >nul

echo [3/4] Demarrage serveur...
cd /d "%~dp0..\.."
node server.js

echo [4/4] Serveur demarre!
echo 🌐 Acces: http://localhost:3001/login.html
echo 👤 Admin: admin@logsystem.local / Admin@1234
echo 👤 User: user@logsystem.local / User@1234
echo.
echo Appuyez sur une touche pour ouvrir le navigateur...
pause >nul
start http://localhost:3001/login.html

echo.
echo Pour arreter: Ctrl+C dans cette fenetre
pause
