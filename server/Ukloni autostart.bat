@echo off
title Crit - uklanjanje autostarta servera
cd /d "%~dp0"

rem Vidi "Podesi autostart.bat" - isto trazenje administratora, bez zagrada.
net session >nul 2>&1
if %errorlevel% equ 0 goto admin
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:admin
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ukloni-autostart.ps1"
echo.
pause
