@echo off
title Crit - potpuno uklanjanje launchera
color 0E
echo.
echo  Uklanjam Crit Launcher sa ovog racunara u potpunosti.
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
  color 0C
  echo  Pokreni kao ADMINISTRATOR: desni klik - "Run as administrator"
  echo.
  pause
  exit /b 1
)

echo  [1/3] Gasim launcher...
taskkill /IM "Crit Launcher.exe" /F /T >nul 2>&1
taskkill /IM "electron.exe" /F /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo  [2/3] Pokrecem deinstalaciju...
set "U1=%ProgramFiles%\Crit Launcher\Uninstall Crit Launcher.exe"
set "U2=%LOCALAPPDATA%\Programs\Crit Launcher\Uninstall Crit Launcher.exe"
if exist "%U1%" (
  start /wait "" "%U1%" /S
  echo       deinstalirano iz Program Files
) else if exist "%U2%" (
  start /wait "" "%U2%" /S
  echo       deinstalirano iz LocalAppData
) else (
  echo       nije nadjen instaler - obrisi rucno folder "Crit Launcher"
)

echo  [3/3] Brisem sacuvana podesavanja...
rmdir /S /Q "%APPDATA%\crit-launcher" >nul 2>&1
rmdir /S /Q "%APPDATA%\Crit Launcher" >nul 2>&1
del /F /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Crit*.lnk" >nul 2>&1

echo.
color 0A
echo  Gotovo. Launcher je uklonjen sa racunara.
echo  Ako je racunar i dalje ogranicen, pokreni POPRAVI-RACUNAR.bat
echo.
pause
