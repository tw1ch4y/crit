@echo off
setlocal
title Crit - vracanje racunara u normalu
REM ============================================================
REM  Crit - vracanje racunara u normalu (servis, odrzavanje)
REM
REM  Pokrece se DVOKLIKOM, prijavljen na nalog igraca - isto kao
REM  zastita-ukljuci.bat. Deo za ceo racunar sam trazi administratora.
REM  Pre toga izadji iz launchera (Ctrl+Alt+Shift+Q), inace ih on
REM  pri sledecem pokretanju upise ponovo.
REM ============================================================

if /i "%~1"=="masina" goto masina

echo.
echo  [1/2] Ogranicenja naloga %USERNAME%...
set "SYS=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System"
set "EXP=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
for %%V in (DisableTaskMgr DisableLockWorkstation DisableChangePassword DisableRegistryTools) do (
  reg delete "%SYS%" /v %%V /f >nul 2>&1
)
for %%V in (NoWinKeys NoRun NoClose NoLogoff NoControlPanel) do (
  reg delete "%EXP%" /v %%V /f >nul 2>&1
)
REM Precice pristupacnosti na fabricko stanje Windows-a.
reg add "HKCU\Control Panel\Accessibility\StickyKeys" /v Flags /t REG_SZ /d 510 /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\Keyboard Response" /v Flags /t REG_SZ /d 126 /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\ToggleKeys" /v Flags /t REG_SZ /d 62 /f >nul 2>&1
echo        uklonjeno

echo  [2/2] Politike pregledaca - vazi za ceo racunar...
net session >nul 2>&1
if %errorlevel% equ 0 (
  call :masinaTelo
) else (
  powershell -NoProfile -Command "try { Start-Process -FilePath '%~f0' -ArgumentList 'masina' -Verb RunAs -Wait -ErrorAction Stop; exit 0 } catch { exit 1 }"
  if errorlevel 1 (
    echo        [PAZNJA] Administrator nije odobren - politike pregledaca su ostale.
  ) else (
    echo        uklonjeno
  )
)

echo.
echo  Zastita je iskljucena. Odjavi se i prijavi ponovo da sve stupi na snagu.
echo.
pause
exit /b 0

:masina
call :masinaTelo
timeout /t 3 /nobreak >nul
exit /b 0

:masinaTelo
for %%P in ("HKLM\SOFTWARE\Policies\Google\Chrome" "HKLM\SOFTWARE\Policies\Microsoft\Edge") do (
  for %%V in (AllowFileSelectionDialogs PasswordManagerEnabled DefaultBrowserSettingEnabled PromotionalTabsEnabled PrivacySandboxPromptEnabled HideFirstRunExperience) do (
    reg delete %%P /v %%V /f >nul 2>&1
  )
  reg delete "%%~P\URLBlocklist" /v 1 /f >nul 2>&1
)
exit /b 0
