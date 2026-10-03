@echo off
setlocal EnableExtensions
REM ============================================================
REM  Crit - zastita racunara igraca (iskljucivanje)
REM
REM  KO POKRECE: osoblje, kao administrator, kad treba odrzavanje
REM  racunara. Skida tacno ono sto je zastita-ukljuci.bat upisao.
REM    zastita-iskljuci.bat              nalog prijavljen na ekranu
REM    zastita-iskljuci.bat IME-NALOGA   zadati nalog (moze i odjavljen)
REM
REM  Kad je nalog igraca zakljucan pa se ovaj fajl tu ne da pokrenuti:
REM  prijavi se na administratorski nalog i zadaj ime naloga igraca.
REM ============================================================
title Crit - iskljucivanje zastite racunara igraca

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
echo  Iskljucujem zastitu...
REM Prazan argument se ne prosledjuje: Windows PowerShell ga ume izgubiti.
set "NALOG="
if not "%~1"=="" set "NALOG=-Nalog "%~1""
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zastita.ps1" -Rezim iskljuci %NALOG%
if errorlevel 1 (
  color 0C
  echo.
  echo  Zastita NIJE skinuta do kraja - vidi poruke iznad.
  echo  Sve odjednom, za sve naloge: POPRAVI-RACUNAR.bat
  echo.
  pause
  exit /b 1
)
echo.
pause
exit /b 0
