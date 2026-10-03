@echo off
setlocal EnableExtensions
REM ============================================================
REM  Crit - reset podesavanja launchera (adresa servera i token)
REM
REM  KO POKRECE: osoblje, kao administrator (desni klik - Run as
REM  administrator). Ranije je radio i bez administratora - pa je
REM  igrac mogao sam da ugasi launcher, obrise mu podesavanja i na
REM  ekranu za podesavanje upise adresu SVOG servera.
REM
REM    resetuj-launcher.bat              nalog prijavljen na ekranu
REM    resetuj-launcher.bat IME-NALOGA   zadati nalog
REM
REM  Brise se folder podesavanja na NALOGU IGRACA. Kao administrator
REM  %APPDATA% bi pokazivao na folder administratora, pa se putanje
REM  ovde preusmeravaju na profil igraca.
REM ============================================================
title Crit Launcher - reset podesavanja

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Pokreni ovaj fajl kao administrator ^(desni klik - Run as administrator^).
  echo.
  pause
  exit /b 1
)

set "NALOG="
if not "%~1"=="" set "NALOG=-Nalog "%~1""
set "IGRAC="
set "PROFIL="
if exist "%~dp0zastita.ps1" (
  for /f "usebackq tokens=1-3 delims=|" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zastita.ps1" -Rezim nalog %NALOG%`) do (
    set "PROFIL=%%B"
    set "IGRAC=%%C"
  )
)
if not defined PROFIL (
  echo.
  echo  Nisam mogao da odredim nalog igraca. Prijavi se na nalog igraca i
  echo  pokreni ponovo, ili zadaj ime naloga:  resetuj-launcher.bat IME-NALOGA
  echo.
  pause
  exit /b 1
)
set "APPDATA=%PROFIL%\AppData\Roaming"

echo.
echo  Nalog igraca: %IGRAC%
echo  Ako to nije nalog igraca: N, pa  resetuj-launcher.bat IME-NALOGA
echo.
echo  Brisem sacuvana podesavanja launchera (adresa servera i token).
echo  Posle ovoga ce launcher opet traziti podesavanje, kao prvi put.
echo.
choice /C DN /M "  Nastaviti"
if errorlevel 2 exit /b 2

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
echo  Gotovo. Prijavi se na nalog igraca, pokreni Crit Launcher i unesi:
echo    Adresa servera: http://IP-GLAVNOG-RACUNARA:8095
echo    Token: iz panela, stranica Racunari
echo.
pause
exit /b 0
