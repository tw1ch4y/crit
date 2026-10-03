@echo off
setlocal EnableExtensions
REM ============================================================
REM  Crit - zastita racunara igraca (ukljucivanje)
REM
REM  KO POKRECE: osoblje, kao administrator. Jednom po racunaru.
REM    desni klik - "Run as administrator" (Windows trazi lozinku
REM    administratora). Igrac to ne moze: nema tu lozinku.
REM
REM  NA KOJI NALOG: na nalog IGRACA, ne na administratora.
REM    zastita-ukljuci.bat              nalog prijavljen na ekranu
REM    zastita-ukljuci.bat IME-NALOGA   zadati nalog (moze i odjavljen)
REM
REM  Sav posao radi zastita.ps1 iz istog foldera. Pokreci kopiju iz
REM  paketa (USB, racunar osoblja), NE iz foldera instalacije
REM  launchera - taj folder igrac moze da menja.
REM ============================================================
title Crit - zastita racunara igraca

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Pokreni ovaj fajl kao administrator ^(desni klik - Run as administrator^).
  echo.
  pause
  exit /b 1
)
if not exist "%~dp0zastita.ps1" (
  echo.
  echo  Nedostaje zastita.ps1 - mora da stoji u istom folderu kao ovaj fajl.
  echo.
  pause
  exit /b 1
)

echo.
echo  Ukljucujem zastitu...
REM Deinstalacija launchera ne trazi administratora (instaliran je u profil
REM igraca), pa i njen program ide na spisak zabranjenih.
REM Prazan argument se ne prosledjuje: Windows PowerShell ga ume izgubiti.
set "NALOG="
if not "%~1"=="" set "NALOG=-Nalog "%~1""
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zastita.ps1" -Rezim ukljuci %NALOG% -Zabrani "Uninstall Crit Launcher.exe"
if errorlevel 1 (
  color 0C
  echo.
  echo  Zastita NIJE ukljucena do kraja - vidi poruke iznad.
  echo.
  pause
  exit /b 1
)

REM Brzo pokretanje (Fast Startup) smeta paljenju preko mreze (Wake-on-LAN).
powercfg -h off >nul 2>&1

echo.
echo  Za iskljucivanje: zastita-iskljuci.bat ^(isto, kao administrator^).
echo.
pause
exit /b 0
