@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Crit - vracanje rezervne kopije baze
cd /d "%~dp0"

echo.
echo ================================================
echo   VRACANJE REZERVNE KOPIJE BAZE
echo ================================================
echo.
echo   Ovo vraca bazu na stanje iz izabrane kopije.
echo   Sve sto se desilo POSLE te kopije bice izgubljeno
echo   (dopune, porudzbine, sesije...).
echo.
echo   Trenutna baza se NE brise - snima se sa strane,
echo   pa moze da se vrati ako se predomislis.
echo.

rem --- server mora da bude ugasen, inace bi pisao preko vracene baze ---
tasklist /fi "imagename eq node.exe" | find /i "node.exe" >nul
if not errorlevel 1 (
  echo   [PAZNJA] node.exe je pokrenut - server verovatno jos radi.
  echo   Zatvori prozor servera pa pokreni ovu skriptu ponovo.
  echo.
  pause
  exit /b 1
)

if not exist "data\backups" (
  echo   Nema foldera sa kopijama ^(data\backups^).
  echo.
  pause
  exit /b 1
)

echo   Dostupne kopije ^(najnovije prve^):
echo.
set /a n=0
for /f "delims=" %%F in ('dir /b /o-d "data\backups\crit-*.db" 2^>nul') do (
  set /a n+=1
  set "kopija[!n!]=%%F"
  if !n! leq 15 echo     !n!^)  %%F
)

if %n%==0 (
  echo   Nema nijedne kopije.
  echo.
  pause
  exit /b 1
)

echo.
set "izbor="
set /p izbor=  Upisi broj kopije koju vracas ^(ili Enter za odustajanje^):
if "%izbor%"=="" (
  echo   Odustao si, nista nije promenjeno.
  echo.
  pause
  exit /b 0
)

if not defined kopija[%izbor%] (
  echo   Ne postoji kopija pod tim brojem.
  echo.
  pause
  exit /b 1
)
set "izabrana=!kopija[%izbor%]!"

echo.
echo   Vracas: !izabrana!
set "potvrda="
set /p potvrda=  Upisi DA za potvrdu:
if /i not "%potvrda%"=="DA" (
  echo   Odustao si, nista nije promenjeno.
  echo.
  pause
  exit /b 0
)

rem --- trenutnu bazu snimi sa strane pre nego sto je pregazis ---
for /f "tokens=2 delims==" %%T in ('wmic os get localdatetime /value 2^>nul ^| find "="') do set "sada=%%T"
set "pecat=%sada:~0,4%-%sada:~4,2%-%sada:~6,2%_%sada:~8,2%-%sada:~10,2%-%sada:~12,2%"

if exist "data\crit.db" (
  if not exist "data\pre-vracanja" mkdir "data\pre-vracanja"
  copy /y "data\crit.db" "data\pre-vracanja\crit-%pecat%.db" >nul
  echo   Trenutna baza je snimljena u: data\pre-vracanja\crit-%pecat%.db
)

rem --- WAL i SHM moraju da odu, inace bi se stara izmena vratila preko kopije ---
del /q "data\crit.db-wal" 2>nul
del /q "data\crit.db-shm" 2>nul

copy /y "data\backups\!izabrana!" "data\crit.db" >nul
if errorlevel 1 (
  echo.
  echo   [GRESKA] Kopiranje nije uspelo. Baza nije promenjena.
  echo.
  pause
  exit /b 1
)

echo.
echo   Gotovo. Baza je vracena na: !izabrana!
echo   Pokreni "Pokreni server.bat" i prijavi se na panel.
echo.
pause
