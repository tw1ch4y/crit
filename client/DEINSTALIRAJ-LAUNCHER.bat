@echo off
setlocal EnableExtensions
REM ============================================================
REM  Crit - potpuno uklanjanje launchera sa racunara
REM
REM  KO POKRECE: osoblje, kao administrator (desni klik - Run as
REM  administrator). Pokreci kopiju iz paketa (USB, racunar osoblja),
REM  NE iz foldera instalacije launchera - taj folder igrac moze da menja.
REM
REM    DEINSTALIRAJ-LAUNCHER.bat              nalog prijavljen na ekranu
REM    DEINSTALIRAJ-LAUNCHER.bat IME-NALOGA   launcher sa zadatog naloga
REM
REM  Launcher je instaliran u profil igraca. Kao administrator %APPDATA%
REM  i %LOCALAPPDATA% pokazuju na folder ADMINISTRATORA, pa se ovde
REM  preusmeravaju na profil igraca (zastita.ps1 -Rezim nalog).
REM ============================================================
title Crit - potpuno uklanjanje launchera
color 0E
echo.
echo  Uklanjam Crit Launcher sa ovog racunara u potpunosti.
echo.

net session >nul 2>&1
if errorlevel 1 (
  color 0C
  echo  Pokreni kao ADMINISTRATOR: desni klik - "Run as administrator"
  echo.
  pause
  exit /b 1
)

set "NALOG="
if not "%~1"=="" set "NALOG=-Nalog "%~1""
set "IGRAC="
set "PROFIL="
set "SID="
if exist "%~dp0zastita.ps1" (
  for /f "usebackq tokens=1-3 delims=|" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zastita.ps1" -Rezim nalog %NALOG%`) do (
    set "SID=%%A"
    set "PROFIL=%%B"
    set "IGRAC=%%C"
  )
)
if defined PROFIL (
  set "APPDATA=%PROFIL%\AppData\Roaming"
  set "LOCALAPPDATA=%PROFIL%\AppData\Local"
  set "DESKTOP=%PROFIL%\Desktop"
) else (
  echo  PAZNJA: nalog igraca nije odredjen - radim nad nalogom koji pokrece ovo.
  echo  Ako je launcher na drugom nalogu:  DEINSTALIRAJ-LAUNCHER.bat IME-NALOGA
  set "IGRAC=%USERNAME%"
  set "DESKTOP=%USERPROFILE%\Desktop"
)
echo  Nalog igraca: %IGRAC%
echo  Ako to nije nalog igraca: N, pa  DEINSTALIRAJ-LAUNCHER.bat IME-NALOGA
echo.
choice /C DN /M "  Ukloniti launcher"
if errorlevel 2 exit /b 2

echo  [1/3] Gasim launcher...
taskkill /IM "Crit Launcher.exe" /F /T >nul 2>&1
taskkill /IM "electron.exe" /F /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo  [2/3] Pokrecem deinstalaciju...
set "U1=%ProgramFiles%\Crit Launcher\Uninstall Crit Launcher.exe"
set "U2=%LOCALAPPDATA%\Programs\Crit Launcher\Uninstall Crit Launcher.exe"
set "FOLDER=%LOCALAPPDATA%\Programs\Crit Launcher"
set "USPEH=1"
REM Instalacija u profilu igraca se brise direktno, BEZ njenog deinstalera:
REM pokrenut kao administrator, on trazi instalaciju u profilu ADMINISTRATORA,
REM ne nadje je i javi uspeh. Launcher je gore ugasen, pa fajlovi nisu zauzeti.
if exist "%U1%" (
  start /wait "" "%U1%" /S
  echo       deinstalirano iz Program Files
) else if exist "%U2%" (
  rmdir /S /Q "%FOLDER%" >nul 2>&1
  if exist "%FOLDER%\" (
    set "USPEH=0"
    echo       NIJE obrisan folder - obrisi ga rucno:
    echo       "%FOLDER%"
  ) else (
    echo       obrisano iz profila igraca
  )
) else (
  echo       nije nadjen instaler - obrisi rucno folder "Crit Launcher"
)

echo  [3/3] Brisem sacuvana podesavanja i precice...
rmdir /S /Q "%APPDATA%\crit-launcher" >nul 2>&1
rmdir /S /Q "%APPDATA%\Crit Launcher" >nul 2>&1
del /F /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Crit*.lnk" >nul 2>&1
REM Deinstalacija pokrenuta kao administrator brise precice administratora;
REM precice i stavka u "Apps" na nalogu igraca se brisu ovde.
del /F /Q "%DESKTOP%\Crit Launcher.lnk" >nul 2>&1
del /F /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Crit Launcher.lnk" >nul 2>&1
REM Stavka u "Apps" na nalogu igraca - i kad nalog nije prijavljen (zastita.ps1
REM tada otvori njegov registar).
if defined PROFIL (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zastita.ps1" -Rezim deinstaliraj %NALOG% -Program "Crit Launcher"
)

echo.
if "%USPEH%"=="0" (
  color 0C
  echo  Launcher NIJE uklonjen do kraja - vidi poruke iznad.
  echo.
  pause
  exit /b 1
)
color 0A
echo  Gotovo. Launcher je uklonjen sa racunara.
echo  Zastita naloga igraca (Task Manager, Win taster...) ostaje dok se ne
echo  pokrene zastita-iskljuci.bat ili POPRAVI-RACUNAR.bat.
echo.
pause
exit /b 0
