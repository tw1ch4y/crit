@echo off
title Crit - autostart servera
cd /d "%~dp0"

echo Postavljam da se Crit server sam pokrene kad se upali racunar...

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%~dp0Pokreni server.bat"
set "LNK=%STARTUP%\Crit Server.lnk"

powershell -NoProfile -Command ^
  "$s=New-Object -ComObject WScript.Shell; $l=$s.CreateShortcut('%LNK%'); $l.TargetPath='%TARGET%'; $l.WorkingDirectory='%~dp0'; $l.WindowStyle=7; $l.Description='Crit server'; $l.Save()"

if exist "%LNK%" (
  echo.
  echo  Gotovo. Server ce se ubuduce sam pokretati pri paljenju racunara.
  echo  Za iskljucivanje obrisi: %LNK%
) else (
  echo  Nije uspelo. Napravi precicu rucno: Win+R -^> shell:startup -^> prevuci "Pokreni server.bat"
)
echo.
pause
