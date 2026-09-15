@echo off
title Crit - autostart servera
cd /d "%~dp0"

rem Zakazani zadatak pravi administrator. Ako skripta nije pokrenuta kao
rem administrator, trazi se dozvola i ona se pokrece ponovo.
rem Bez zagrada oko ovoga: folder servera u imenu ima zagrade, a cmd.exe
rem putanju sa zagradom unutar bloka shvati kao kraj bloka.
net session >nul 2>&1
if %errorlevel% equ 0 goto admin
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:admin
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0podesi-autostart.ps1"
echo.
pause
