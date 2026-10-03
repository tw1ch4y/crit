@echo off
title Crit - bezbedan rezim za probu
echo.
echo  ==========================================================
echo   BEZBEDAN REZIM ZA PROBU
echo  ==========================================================
echo.
echo  Ovo iskljucuje tri stvari koje su za igraonicu dobre, a na
echo  racunaru na kome samo probas mogu da naprave stetu:
echo.
echo    - ciscenje sesije    odjavljuje Steam, Epic, Riot,
echo                         Battle.net i pregledace kad se
echo                         igrac odjavi
echo    - ciscenje fascikli  Desktop i Preuzimanja
echo    - blokada preuzetih  gasi programe pokrenute iz
echo      programa           Preuzimanja, Temp i sa Desktopa
echo.
echo  I postavlja adresu servera na  http://127.0.0.1:8095
echo  jer su server i launcher na istom racunaru.
echo.
echo  Vazi samo kad launcher radi na ADMINISTRATORSKOM nalogu - na nalogu
echo  igraca u igraonici launcher ovaj prekidac namerno ne slusa.
echo.
echo  Kad zavrsis probu, pokreni  "2 - VRATI NA IGRAONICU.bat"
echo.
pause

REM Zatvori launcher da ne prepise podesavanja u toku rada.
taskkill /IM "Crit Launcher.exe" /F >nul 2>&1
ping -n 2 127.0.0.1 >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0podesi.ps1" -Rezim proba
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
echo  Gotovo. Pokreni Crit Launcher.
echo.
echo  Ako si vec uneo pogresnu adresu servera, prvo je obrisi sa:
echo    2 - LAUNCHER - racunari igraca\ALATI OSOBLJA\resetuj-launcher.bat  ^(kao administrator^)
echo.
echo  Izlaz iz launchera dok probas:  Ctrl+Alt+Shift+Q  pa PIN 1234
echo.
pause
