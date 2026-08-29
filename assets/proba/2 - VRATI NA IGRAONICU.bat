@echo off
title Crit - vrati podesavanja za igraonicu
echo.
echo  ==========================================================
echo   VRATI PODESAVANJA ZA IGRAONICU
echo  ==========================================================
echo.
echo  Ukljucuje ciscenje sesije i blokadu preuzetih programa,
echo  i postavlja adresu glavnog racunara.
echo.
echo  Ciscenje licnih fascikli - Desktop i Preuzimanja - OSTAJE
echo  iskljuceno. Na racunarima sa OneDrive-om bi se brisanje
echo  prenelo u oblak. Ukljucuje se rucno ako ti bas treba.
echo.

set "IP="
set /p IP=  IP adresa glavnog racunara (npr. 192.168.1.100):
if not defined IP (
  echo.
  echo  Nisi upisao adresu. Prekidam, nista nije promenjeno.
  echo.
  pause
  exit /b 1
)

taskkill /IM "Crit Launcher.exe" /F >nul 2>&1
ping -n 2 127.0.0.1 >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0podesi.ps1" -Rezim igraonica -Ip "%IP%"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
echo  Gotovo. Adresa i ciscenje su vraceni na rezim za igraonicu.
echo.
echo  Ako je launcher ranije zapamtio drugu adresu, obrisi je sa:
echo    Program Files\Crit Launcher\resources\resetuj-launcher.bat
echo.
pause
