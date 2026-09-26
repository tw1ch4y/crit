@echo off
setlocal
title Crit - zakljucavanje racunara igraca
REM ============================================================
REM  Crit - zakljucavanje racunara igraca
REM
REM  Pokrece se DVOKLIKOM, prijavljen na nalog igraca.
REM  Deo koji vazi za ceo racunar (pregledaci, hibernacija) sam
REM  trazi administratora.
REM
REM  "Run as administrator" sa standardnog naloga pokrene skriptu
REM  pod administratorskim nalogom, pa bi ogranicenja naloga otisla
REM  njemu, a ne igracu. Zato se to ovde proverava.
REM ============================================================

if /i "%~1"=="masina" goto masina

set "ADMIN=0"
net session >nul 2>&1
if %errorlevel% equ 0 set "ADMIN=1"

REM Pokrenuto kao administrator: ogranicenja naloga idu samo ako je
REM to isti nalog koji je prijavljen na ovom ekranu.
set "ISTI=1"
if "%ADMIN%"=="1" (
  powershell -NoProfile -Command "$s=(Get-Process -Id $PID).SessionId; $e=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'explorer.exe' -and $_.SessionId -eq $s } | Select-Object -First 1; if (-not $e) { exit 0 }; $o=Invoke-CimMethod -InputObject $e -MethodName GetOwner; if ($o.User -ieq $env:USERNAME) { exit 0 } else { exit 1 }" >nul 2>&1
  if errorlevel 1 set "ISTI=0"
)

echo.
if "%ISTI%"=="0" goto samoMasina

echo  [1/2] Ogranicenja naloga %USERNAME%...
set "SYS=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System"
set "EXP=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
set "GRESKA=0"
for %%V in (DisableTaskMgr DisableLockWorkstation DisableChangePassword) do (
  reg add "%SYS%" /v %%V /t REG_DWORD /d 1 /f >nul 2>&1 || set "GRESKA=1"
)
for %%V in (NoWinKeys NoRun NoClose NoLogoff NoControlPanel) do (
  reg add "%EXP%" /v %%V /t REG_DWORD /d 1 /f >nul 2>&1 || set "GRESKA=1"
)
REM Precice pristupacnosti (pet puta Shift i ostale) otvaraju prozor sa
REM vezom ka Podesavanjima. Launcher ih gasi i sam, odmah; ovo vazi od
REM sledece prijave.
reg add "HKCU\Control Panel\Accessibility\StickyKeys" /v Flags /t REG_SZ /d 498 /f >nul 2>&1 || set "GRESKA=1"
reg add "HKCU\Control Panel\Accessibility\Keyboard Response" /v Flags /t REG_SZ /d 114 /f >nul 2>&1 || set "GRESKA=1"
reg add "HKCU\Control Panel\Accessibility\ToggleKeys" /v Flags /t REG_SZ /d 50 /f >nul 2>&1 || set "GRESKA=1"
if "%GRESKA%"=="1" (
  echo        [PAZNJA] Deo ogranicenja nije upisan. Launcher ih pri svakom
  echo        pokretanju upisuje i sam, pa racunar i dalje radi zakljucan.
) else (
  echo        upisano
)

echo  [2/2] Pregledaci i hibernacija - vazi za ceo racunar...
if "%ADMIN%"=="1" (
  call :masinaTelo
) else (
  powershell -NoProfile -Command "try { Start-Process -FilePath '%~f0' -ArgumentList 'masina' -Verb RunAs -Wait -ErrorAction Stop; exit 0 } catch { exit 1 }"
  if errorlevel 1 (
    echo        [PAZNJA] Administrator nije odobren - ovaj deo je preskocen.
    echo        Pokreni fajl ponovo i odobri pristup kad Windows pita.
  ) else (
    echo        podeseno
  )
)
goto kraj

:samoMasina
echo  Ovaj prozor radi pod nalogom %USERNAME%, a na ekranu je prijavljen
echo  neko drugi. Ogranicenja naloga se zato NE upisuju ovde - za njih
echo  pokreni ovaj fajl dvoklikom, prijavljen kao igrac.
echo.
echo  Podesavam deo koji vazi za ceo racunar...
call :masinaTelo
goto kraj

:masina
REM Pokrenuto od strane prvog dela, sa administratorskim pravima.
call :masinaTelo
if "%GRESKA_M%"=="1" (
  echo.
  echo  [PAZNJA] Deo podesavanja nije upisan - vidi poruke iznad.
  pause
) else (
  timeout /t 3 /nobreak >nul
)
exit /b 0

:masinaTelo
set "GRESKA_M=0"
REM Dijalog za cuvanje i otvaranje fajla u pregledacu je pun Windows
REM Explorer: iz njega se pokrece bilo koji program sa diska. Bez njega
REM preuzimanja idu pravo u Preuzimanja, gde ih launcher nadzire.
REM file:// bi igracu pokazao podesavanja launchera, a sacuvane lozinke
REM ne smeju da ostanu za sledeceg gosta.
for %%P in ("HKLM\SOFTWARE\Policies\Google\Chrome" "HKLM\SOFTWARE\Policies\Microsoft\Edge") do (
  reg add %%P /v AllowFileSelectionDialogs /t REG_DWORD /d 0 /f >nul 2>&1 || set "GRESKA_M=1"
  reg add %%P /v PasswordManagerEnabled /t REG_DWORD /d 0 /f >nul 2>&1 || set "GRESKA_M=1"
  reg add %%P /v DefaultBrowserSettingEnabled /t REG_DWORD /d 0 /f >nul 2>&1 || set "GRESKA_M=1"
  reg add "%%~P\URLBlocklist" /v 1 /t REG_SZ /d "file://*" /f >nul 2>&1 || set "GRESKA_M=1"
)
REM Profil pregledaca se brise posle svakog igraca, pa bi svaki novi gost
REM gledao ekrane dobrodoslice.
reg add "HKLM\SOFTWARE\Policies\Google\Chrome" /v PromotionalTabsEnabled /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Policies\Google\Chrome" /v PrivacySandboxPromptEnabled /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v HideFirstRunExperience /t REG_DWORD /d 1 /f >nul 2>&1
REM Fast Startup smeta paljenju preko mreze (Wake-on-LAN).
powercfg -h off >nul 2>&1
if "%GRESKA_M%"=="1" (echo        [PAZNJA] Politike pregledaca nisu upisane.) else (echo        pregledaci i hibernacija podeseni)
exit /b 0

:kraj
echo.
echo  Zastita je ukljucena. Odjavi se i prijavi ponovo da sve stupi na snagu.
echo  Za servis racunara: zastita-iskljuci.bat
echo.
pause
