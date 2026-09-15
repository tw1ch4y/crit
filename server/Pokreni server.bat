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

rem Server drzi NADZORNIK: dize ga posle pada i kad se zaglavi, i gasi ga
rem uredno kad se ovaj prozor zatvori. Ako server vec radi u pozadini
rem (zakazani zadatak), nadzornik to kaze i izlazi - drugi se ne pokrece.
:loop
node nadzornik.mjs
if %errorlevel% equ 0 goto kraj
echo.
echo [%date% %time%] Nadzornik se zaustavio, kod %errorlevel%. Ponovo za 5 sekundi.
echo Za izlaz zatvori ovaj prozor.
timeout /t 5 /nobreak >nul
goto loop

:kraj
echo.
pause
