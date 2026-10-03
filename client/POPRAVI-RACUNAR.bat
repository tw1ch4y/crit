@echo off
setlocal EnableExtensions
REM ============================================================
REM  Crit - vracanje racunara u normalu
REM
REM  KO POKRECE: osoblje, kao administrator (desni klik - Run as
REM  administrator), kad je racunar zakljucan a launcher ne moze ni da
REM  se pokrene. Skida SVU zastitu sa SVIH naloga i vadi launcher iz
REM  autostarta. Pokreci kopiju iz paketa (USB, racunar osoblja), NE iz
REM  foldera instalacije launchera - taj folder igrac moze da menja.
REM
REM  Explorer se ovde vise NE pokrece ponovo: pokrenut iz prozora
REM  administratora, mogao bi da ostane sa pravima administratora na
REM  ekranu igraca. Umesto toga - odjava i ponovna prijava.
REM ============================================================
title Crit - vracanje racunara u normalu
color 0E
echo.
echo  ============================================================
echo    VRACANJE RACUNARA U NORMALU
echo  ============================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  color 0C
  echo  Pokreni kao ADMINISTRATOR: desni klik na fajl - "Run as administrator"
  echo.
  pause
  exit /b 1
)

echo  Ovo gasi launcher, vadi ga iz autostarta i skida zastitu
echo  ^(Task Manager, Win taster, komandna linija^) sa SVIH naloga.
echo  Racunar posle toga NIJE zasticen dok se zastita ne vrati.
echo.
choice /C DN /M "  Nastaviti"
if errorlevel 2 exit /b 2
echo.

echo  [1/4] Gasim launcher...
taskkill /IM "Crit Launcher.exe" /F /T >nul 2>&1
taskkill /IM "electron.exe" /F /T >nul 2>&1
wmic process where "ExecutablePath like '%%Crit%%'" call terminate >nul 2>&1
timeout /t 2 /nobreak >nul
tasklist /FI "IMAGENAME eq Crit Launcher.exe" /NH 2>nul | find /I "Crit Launcher.exe" >nul
if %errorlevel% equ 0 (echo       PAZNJA: launcher se i dalje vrti) else (echo       ugasen)

echo  [2/4] Uklanjam iz autostarta...
del /F /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Crit*.lnk" >nul 2>&1
del /F /Q "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp\Crit*.lnk" >nul 2>&1
REM Kao administrator %APPDATA% je folder administratora - precica igraca je u
REM njegovom profilu, pa se prolazi kroz sve profile.
for /d %%P in ("%SystemDrive%\Users\*") do del /F /Q "%%~P\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Crit*.lnk" >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Crit Launcher" /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "Crit Launcher" /f >nul 2>&1

echo  [3/4] Brisem ogranicenja (Task Manager, Win taster, Win+R, komandna linija)...
set SYS=Software\Microsoft\Windows\CurrentVersion\Policies\System
set EXP=Software\Microsoft\Windows\CurrentVersion\Policies\Explorer
set CMDPOL=Software\Policies\Microsoft\Windows\System
set WER=Software\Microsoft\Windows\Windows Error Reporting
REM cele kljuceve, za trenutni nalog i za sve prijavljene naloge
REM (Explorer kljuc nosi i spisak zabranjenih programa - DisallowRun)
reg delete "HKCU\%SYS%" /f >nul 2>&1
reg delete "HKCU\%EXP%" /f >nul 2>&1
reg delete "HKCU\%CMDPOL%" /v DisableCMD /f >nul 2>&1
reg delete "HKLM\%SYS%" /v DisableTaskMgr /f >nul 2>&1
reg delete "HKLM\%EXP%" /v NoRun /f >nul 2>&1
for /f "tokens=*" %%K in ('reg query HKU 2^>nul ^| findstr /R "S-1-5-21" ^| findstr /V "_Classes"') do (
  reg delete "%%K\%SYS%" /f >nul 2>&1
  reg delete "%%K\%EXP%" /f >nul 2>&1
  reg delete "%%K\%CMDPOL%" /v DisableCMD /f >nul 2>&1
  reg delete "%%K\%WER%" /v DontShowUI /f >nul 2>&1
  reg delete "%%K\Software\Microsoft\Windows\CurrentVersion\Run" /v "Crit Launcher" /f >nul 2>&1
)
REM Nalozi koji sada NISU prijavljeni nisu u HKU - njih otvara zastita.ps1.
if exist "%~dp0zastita.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zastita.ps1" -Rezim popravi
) else (
  echo       zastita.ps1 nije pored ovog fajla - odjavljeni nalozi nisu ocisceni
)
powercfg -h on >nul 2>&1

echo  [4/4] Gotovo sa registrom.

echo.
color 0A
echo  ============================================================
echo    GOTOVO.
echo.
echo    Odjavi se i prijavi ponovo na nalog igraca ^(ili restartuj
echo    racunar^) - tek tada Windows ucita nova pravila.
echo    Onda probaj Ctrl+Shift+Esc ^(Task Manager^) i Win taster.
echo.
echo    AKO I DALJE NE RADI - launcher se verovatno ponovo pokrece.
echo    Onda ga potpuno ukloni:
echo      Start - Settings - Apps - nadji "Crit Launcher" - Uninstall
echo    ili pokreni: DEINSTALIRAJ-LAUNCHER.bat
echo  ============================================================
echo.
pause
exit /b 0
