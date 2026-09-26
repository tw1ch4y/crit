@echo off
setlocal
title Crit - potpuno uklanjanje launchera
color 0E
echo.
echo  Uklanjam Crit Launcher sa ovog naloga u potpunosti.
echo.
REM Launcher se instalira po korisniku, pa se ovaj fajl pokrece DVOKLIKOM
REM sa naloga igraca. Starija instalacija iz Program Files trazi
REM administratora - za nju Windows pita sam.

echo  [1/4] Gasim launcher...
taskkill /IM "Crit Launcher.exe" /F /T >nul 2>&1
taskkill /IM "electron.exe" /F /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo  [2/4] Pokrecem deinstalaciju...
set "U1=%ProgramFiles%\Crit Launcher\Uninstall Crit Launcher.exe"
set "U2=%LOCALAPPDATA%\Programs\Crit Launcher\Uninstall Crit Launcher.exe"
set "NADJEN=0"
if exist "%U2%" (
  set "NADJEN=1"
  start /wait "" "%U2%" /S
  echo       deinstalirano iz profila naloga %USERNAME%
)
if exist "%U1%" (
  set "NADJEN=1"
  powershell -NoProfile -Command "try { Start-Process -FilePath $env:U1 -ArgumentList '/S' -Verb RunAs -Wait -ErrorAction Stop; exit 0 } catch { exit 1 }"
  if errorlevel 1 (
    echo       [PAZNJA] Stara instalacija iz Program Files trazi administratora - nije uklonjena.
  ) else (
    echo       deinstalirana stara instalacija iz Program Files
  )
)
if "%NADJEN%"=="0" (
  echo       Na nalogu %USERNAME% nema instalacije.
  echo       Ako je launcher instaliran na nalogu igraca, pokreni ovaj fajl
  echo       dvoklikom sa tog naloga.
)

echo  [3/4] Uklanjam autostart i sacuvana podesavanja...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Crit Launcher" /f >nul 2>&1
del /F /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Crit*.lnk" >nul 2>&1
rmdir /S /Q "%APPDATA%\crit-launcher" >nul 2>&1
rmdir /S /Q "%APPDATA%\Crit Launcher" >nul 2>&1

echo  [4/4] Vracam ogranicenja naloga na normalu...
REM Launcher ih vraca pri urednom izlazu, a ovde je ugasen silom.
set "SYS=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System"
set "EXP=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
for %%V in (DisableTaskMgr DisableLockWorkstation DisableChangePassword DisableRegistryTools) do reg delete "%SYS%" /v %%V /f >nul 2>&1
for %%V in (NoWinKeys NoRun NoClose NoLogoff NoControlPanel) do reg delete "%EXP%" /v %%V /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\StickyKeys" /v Flags /t REG_SZ /d 510 /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\Keyboard Response" /v Flags /t REG_SZ /d 126 /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\ToggleKeys" /v Flags /t REG_SZ /d 62 /f >nul 2>&1

echo.
color 0A
echo  Gotovo. Odjavi se i prijavi ponovo da se ogranicenja skinu do kraja.
echo  Politike pregledaca za ceo racunar skida zastita-iskljuci.bat.
echo.
pause
