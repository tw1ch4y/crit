@echo off
REM ============================================================
REM  Crit - zakljucavanje racunara igraca
REM  Pokrenuti JEDNOM, desni klik -> "Run as administrator",
REM  na Windows nalogu na kome igraci rade.
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Pokreni ovaj fajl kao administrator ^(desni klik - Run as administrator^).
  pause
  exit /b 1
)

echo Ukljucujem zastitu...

REM --- Task Manager, zakljucavanje, promena lozinke, odjava (Ctrl+Alt+Del ekran) ---
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /t REG_DWORD /d 1 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableChangePassword /t REG_DWORD /d 1 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableRegistryTools /t REG_DWORD /d 1 /f >nul

REM --- Windows taster, Run dijalog, gasenje iz Start menija ---
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /t REG_DWORD /d 1 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoRun /t REG_DWORD /d 1 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoClose /t REG_DWORD /d 1 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoLogoff /t REG_DWORD /d 1 /f >nul

REM --- Ugasi Fast Startup (smeta Wake-on-LAN paljenju) ---
powercfg -h off >nul 2>&1

echo.
echo Zastita je ukljucena.
echo Odjavi se i prijavi ponovo (ili restartuj) da sve stupi na snagu.
echo Za iskljucivanje pokreni: zastita-iskljuci.bat
pause
