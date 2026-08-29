@echo off
title Crit Launcher - reset podesavanja
echo.
echo  Brisem sacuvana podesavanja launchera (adresa servera i token).
echo  Posle ovoga ce launcher opet traziti podesavanje, kao prvi put.
echo.

REM zatvori launcher ako radi
taskkill /IM "Crit Launcher.exe" /F >nul 2>&1
taskkill /IM "electron.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul

set FOUND=0
for %%D in ("crit-launcher" "Crit Launcher") do (
  if exist "%APPDATA%\%%~D" (
    rmdir /S /Q "%APPDATA%\%%~D"
    echo  obrisano: %APPDATA%\%%~D
    set FOUND=1
  )
)

if "%FOUND%"=="0" (
  echo  Nije nadjeno nista za brisanje - podesavanja su vec cista.
)

echo.
echo  Gotovo. Pokreni Crit Launcher i unesi podatke ponovo:
echo    Adresa servera: http://IP-GLAVNOG-RACUNARA:8095
echo    Token: iz panela, stranica Racunari
echo.
pause
