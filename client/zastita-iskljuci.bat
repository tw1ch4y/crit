@echo off
REM ============================================================
REM  Crit - vracanje racunara u normalu
REM  Pokrenuti kao administrator kad treba odrzavanje racunara.
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Pokreni ovaj fajl kao administrator ^(desni klik - Run as administrator^).
  pause
  exit /b 1
)

echo Iskljucujem zastitu...

reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableChangePassword /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableRegistryTools /f >nul 2>&1

reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoRun /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoClose /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoLogoff /f >nul 2>&1

echo.
echo Zastita je iskljucena. Odjavi se i prijavi ponovo da sve stupi na snagu.
pause
