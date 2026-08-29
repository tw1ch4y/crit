@echo off
title Crit Server
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo  Node.js nije instaliran na ovom racunaru.
  echo  Skini ga sa https://nodejs.org  ^(dugme LTS^), instaliraj,
  echo  pa ponovo pokreni ovaj fajl.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Prva priprema, samo jednom... sacekaj minut.
  call npm install --omit=dev --no-audit --no-fund
)

:loop
node src\index.js
echo.
echo [%date% %time%] Server se zaustavio. Ponovo se pokrece za 3 sekunde.
echo Za izlaz zatvori ovaj prozor.
timeout /t 3 /nobreak >nul
goto loop
