@echo off
title CRIT Server
cd /d "%~dp0"
echo ================================================
echo   CRIT Server - auto-restart rezim
echo   (ne zatvarati ovaj prozor tokom rada)
echo ================================================
:loop
node src\index.js
rem Kod 3 = port je zauzet, drugi server vec radi. Tada se ne vrti restart na
rem svake 3 sekunde, nego se saceka pa proveri ponovo.
if errorlevel 3 if not errorlevel 4 goto zauzet
echo.
echo [%date% %time%] Server se zaustavio. Restart za 3 sekunde... (Ctrl+C za izlaz)
timeout /t 3 /nobreak >nul
goto loop

:zauzet
echo.
echo [%date% %time%] Server vec radi u drugom prozoru - ovaj ceka.
echo Zatvori ovaj prozor ako ti ne treba. Provera ponovo za 30 sekundi.
timeout /t 30 /nobreak >nul
goto loop
