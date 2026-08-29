@echo off
title Crit - vracanje racunara u normalu
color 0E
echo.
echo  ============================================================
echo    VRACANJE RACUNARA U NORMALU
echo  ============================================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
  color 0C
  echo  Pokreni kao ADMINISTRATOR: desni klik na fajl - "Run as administrator"
  echo.
  pause
  exit /b 1
)

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
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Crit Launcher" /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "Crit Launcher" /f >nul 2>&1

echo  [3/4] Brisem ogranicenja (Task Manager, Win taster, Win+R)...
set SYS=Software\Microsoft\Windows\CurrentVersion\Policies\System
set EXP=Software\Microsoft\Windows\CurrentVersion\Policies\Explorer
REM cele kljuceve, za trenutni nalog i za sve naloge na racunaru
reg delete "HKCU\%SYS%" /f >nul 2>&1
reg delete "HKCU\%EXP%" /f >nul 2>&1
reg delete "HKLM\%SYS%" /v DisableTaskMgr /f >nul 2>&1
reg delete "HKLM\%EXP%" /v NoRun /f >nul 2>&1
for /f "tokens=*" %%K in ('reg query HKU 2^>nul ^| findstr /R "S-1-5-21" ^| findstr /V "_Classes"') do (
  reg delete "%%K\%SYS%" /f >nul 2>&1
  reg delete "%%K\%EXP%" /f >nul 2>&1
)
powercfg -h on >nul 2>&1

echo  [4/4] Osvezavam Windows...
taskkill /IM explorer.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
start explorer.exe

echo.
color 0A
echo  ============================================================
echo    GOTOVO.
echo.
echo    Probaj sada Ctrl+Shift+Esc (Task Manager) i Win taster.
echo.
echo    AKO I DALJE NE RADI - launcher se verovatno ponovo pokrece.
echo    Onda ga potpuno ukloni:
echo      Start - Settings - Apps - nadji "Crit Launcher" - Uninstall
echo    ili pokreni: DEINSTALIRAJ-LAUNCHER.bat
echo  ============================================================
echo.
pause
