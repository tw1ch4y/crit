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

rem --- server mora da bude ugasen, inace bi pisao preko vracene baze ---
rem Gasi se tek POSLE potvrde: ko odustane ili pogresi broj, server radi dalje.
rem Nadzornik se gasi uredno kad se u data\ pojavi fajl "nadzor-stani". Tako se
rem gasi i onaj iz zakazanog zadatka, koji nema prozor - a za to ne treba
rem administrator. Uredno gasenje brise i data\nadzor.json, pa ga provera na
rem 5 minuta ne podize usred vracanja.
tasklist /fi "imagename eq node.exe" | find /i "node.exe" >nul
if errorlevel 1 goto serverUgasen
echo   Server radi - gasim ga uredno...
type nul > "data\nadzor-stani"
for /l %%i in (1,1,30) do (
  timeout /t 1 /nobreak >nul
  tasklist /fi "imagename eq node.exe" | find /i "node.exe" >nul
  if errorlevel 1 goto serverUgasen
)
del /q "data\nadzor-stani" 2>nul
echo   [PAZNJA] node.exe i dalje radi - server se nije ugasio.
echo   Zatvori prozor servera pa pokreni ovu skriptu ponovo.
echo.
pause
exit /b 1
:serverUgasen

rem --- trenutnu bazu snimi sa strane pre nego sto je pregazis ---
rem wmic vise ne postoji na novim Windows 11, pa datum daje PowerShell.
set "pecat="
for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "pecat=%%T"
if not defined pecat set "pecat=%random%-%random%"

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
  type nul > "data\nadzor-pokreni"
  echo.
  echo   [GRESKA] Kopiranje nije uspelo. Baza nije promenjena.
  echo.
  pause
  exit /b 1
)

echo.
rem Zahtev za paljenje: ako je autostart podesen, provera na 5 minuta digne server
rem sama. Bez autostarta fajl samo ceka, a brise ga prvo pokretanje servera.
type nul > "data\nadzor-pokreni"
echo   Gotovo. Baza je vracena na: !izabrana!
echo   Ako je podesen autostart, server se sam podize za najvise 5 minuta.
echo   Bez autostarta pokreni "Pokreni server.bat". Zatim se prijavi na panel.
echo.
pause
