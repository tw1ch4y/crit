@echo off
title Crit - otvaranje porta 8095
color 0E
echo.
echo  Otvaram port 8095 da racunari igraca i telefon mogu do servera.
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
  color 0C
  echo  Pokreni kao ADMINISTRATOR: desni klik - "Run as administrator"
  echo.
  pause
  exit /b 1
)

REM ukloni staro pravilo ako postoji, pa dodaj cisto
netsh advfirewall firewall delete rule name="Crit Server" >nul 2>&1
netsh advfirewall firewall add rule name="Crit Server" dir=in action=allow protocol=TCP localport=8095 profile=any >nul

if %errorlevel% equ 0 (
  color 0A
  echo  Port 8095 je otvoren.
) else (
  color 0C
  echo  Nije uspelo. Otvori rucno: Windows Defender Firewall - Advanced settings
  echo  - Inbound Rules - New Rule - Port - TCP 8095 - Allow.
)

echo.
echo  Adrese na kojima je panel dostupan sa drugih racunara:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /C:"IPv4"') do (
  for /f "tokens=*" %%B in ("%%A") do echo    http://%%B:8095
)
echo.
pause
