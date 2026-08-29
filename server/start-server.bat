@echo off
title CRIT Server
cd /d "%~dp0"
echo ================================================
echo   CRIT Server - auto-restart rezim
echo   (ne zatvarati ovaj prozor tokom rada)
echo ================================================
:loop
node src\index.js
echo.
echo [%date% %time%] Server se zaustavio. Restart za 3 sekunde... (Ctrl+C za izlaz)
timeout /t 3 /nobreak >nul
goto loop
