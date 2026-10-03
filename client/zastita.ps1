# Zastita racunara igraca: ogranicenja Windows-a na NALOGU IGRACA.
#
# Zovu je .bat fajlovi iz istog foldera (zastita-ukljuci, zastita-iskljuci,
# POPRAVI-RACUNAR, resetuj-launcher, DEINSTALIRAJ-LAUNCHER). Kod stoji OVDE, a
# ne kao tekst u .bat fajlu, iz istog razloga kao podesi.ps1: tamo se navodnici
# i znakovi ^ | lome jedno o drugo.
#
#   zastita.ps1 -Rezim ukljuci  [-Nalog IME] [-Zabrani "Ime programa.exe"]
#   zastita.ps1 -Rezim iskljuci [-Nalog IME]
#   zastita.ps1 -Rezim popravi            svi nalozi na racunaru
#   zastita.ps1 -Rezim nalog    [-Nalog IME]   ispise SID|PROFIL|IME|ADMIN
#
# ZASTO NALOG IGRACA, A NE HKCU
# Kad standardni nalog pokrene skriptu "kao administrator", skripta radi pod
# ADMINISTRATOROM i HKCU je registar administratora. Ranija verzija je zato
# zakljucavala pogresan nalog, a igracu je ostajao Task Manager. Ovde se pise
# pravo u registar naloga igraca (HKEY_USERS\<SID>). Ako nalog nije prijavljen,
# njegov registar (NTUSER.DAT) se otvori, upise i zatvori - pa zastita moze da
# se skine i sa administratorskog naloga kad je nalog igraca vec zakljucan.
#
# Izlaz: 0 uspeh, 1 greska, 2 odustao.
param(
  [Parameter(Mandatory = $true)][ValidateSet("ukljuci", "iskljuci", "popravi", "nalog")][string]$Rezim,
  [string]$Nalog = "",
  [string[]]$Zabrani = @(),
  [switch]$BezPitanja
)

$ErrorActionPreference = "Stop"

# ---------- STA SE UPISUJE ----------
# Jedan spisak za ukljucivanje i za iskljucivanje - ne mogu da se razidju.
$POL = "Software\Microsoft\Windows\CurrentVersion\Policies"
$VREDNOSTI = @(
  # Task Manager, zakljucavanje, promena lozinke, uredjivac registra
  @{ Kljuc = "$POL\System"; Ime = "DisableTaskMgr"; Vrednost = 1 },
  @{ Kljuc = "$POL\System"; Ime = "DisableLockWorkstation"; Vrednost = 1 },
  @{ Kljuc = "$POL\System"; Ime = "DisableChangePassword"; Vrednost = 1 },
  @{ Kljuc = "$POL\System"; Ime = "DisableRegistryTools"; Vrednost = 1 },
  # Windows taster, Win+R, gasenje i odjava iz Start menija
  @{ Kljuc = "$POL\Explorer"; Ime = "NoWinKeys"; Vrednost = 1 },
  @{ Kljuc = "$POL\Explorer"; Ime = "NoRun"; Vrednost = 1 },
  @{ Kljuc = "$POL\Explorer"; Ime = "NoClose"; Vrednost = 1 },
  @{ Kljuc = "$POL\Explorer"; Ime = "NoLogoff"; Vrednost = 1 },
  # Control Panel i Podesavanja (Settings). Odatle se launcher deinstalira bez
  # administratora - instaliran je u profil igraca.
  @{ Kljuc = "$POL\Explorer"; Ime = "NoControlPanel"; Vrednost = 1 },
  # Komandna linija: 2 = interaktivni prompt zabranjen, .bat skripte rade
  # (launcher ih koristi za nadogradnju i za igre upisane kao .bat).
  @{ Kljuc = "Software\Policies\Microsoft\Windows\System"; Ime = "DisableCMD"; Vrednost = 2 },
  # Spisak programa koje Explorer i prozori za izbor fajla ne smeju da pokrenu
  @{ Kljuc = "$POL\Explorer"; Ime = "DisallowRun"; Vrednost = 1 },
  # Prozor "program je prestao da radi" posle pada igre se ne prikazuje: u
  # njemu su linkovi koji otvaraju pregledac i druge programe.
  @{ Kljuc = "Software\Microsoft\Windows\Windows Error Reporting"; Ime = "DontShowUI"; Vrednost = 1 }
)
# Explorer ih ne pokrece igracu (dvoklik, precica, prozor za izbor fajla u igri).
# Launcher svoje alate i igre pokrece sam, mimo Explorer-a, pa ga ovo ne dira.
$ZABRANJENI = @(
  "cmd.exe", "powershell.exe", "pwsh.exe", "powershell_ise.exe",
  "wscript.exe", "cscript.exe", "mshta.exe", "regedit.exe", "mmc.exe",
  "msconfig.exe", "taskmgr.exe", "control.exe"
)
$DISALLOW = "$POL\Explorer\DisallowRun"

# ---------- POMOCNE ----------
function Pisi([string]$t = "") { Write-Host "  $t" }

function JeAdministrator {
  $ja = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $ja.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Ko je nalog igraca: zadato ime, ili nalog koji je sada prijavljen na ekranu.
function NadjiNalog([string]$ime) {
  if (-not $ime) {
    try { $ime = (Get-CimInstance Win32_ComputerSystem).UserName } catch {}
  }
  if (-not $ime) {
    # Udaljena sesija nema "prijavljenog na ekranu" - uzima se vlasnik Explorer-a,
    # ali samo ako je jedan.
    try {
      $vlasnici = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | ForEach-Object {
          $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner
          if ($o.User) { "$($o.Domain)\$($o.User)" }
        } | Sort-Object -Unique)
      if ($vlasnici.Count -eq 1) { $ime = $vlasnici[0] }
    } catch {}
  }
  if (-not $ime) { return $null }
  try {
    $sid = (New-Object Security.Principal.NTAccount($ime)).Translate([Security.Principal.SecurityIdentifier]).Value
  } catch { return $null }
  $profil = $null
  try {
    $profil = (Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid").ProfileImagePath
    if ($profil) { $profil = [Environment]::ExpandEnvironmentVariables($profil) }
  } catch {}
  return [pscustomobject]@{ Sid = $sid; Profil = $profil; Ime = $ime; Admin = (AdminStatus $sid) }
}

# "da", "ne" ili "?" (kad Windows ne da spisak grupe - npr. obrisan nalog u njoj)
function AdminStatus([string]$sid) {
  try {
    $clanovi = @(Get-LocalGroupMember -SID "S-1-5-32-544")
    if ($clanovi | Where-Object { $_.SID.Value -eq $sid }) { return "da" }
    return "ne"
  } catch { return "?" }
}

# Otvara registar naloga. Prijavljen nalog je vec u HKEY_USERS\<SID>; za
# neprijavljen se NTUSER.DAT ucita pod privremenim imenom.
function OtvoriRegistar($n) {
  if (Test-Path -LiteralPath "Registry::HKEY_USERS\$($n.Sid)") {
    return [pscustomobject]@{ Koren = "Registry::HKEY_USERS\$($n.Sid)"; Ucitan = $null }
  }
  if (-not $n.Profil) { throw "nalog $($n.Ime) nema profil na ovom racunaru (nikad se nije prijavio)" }
  $dat = Join-Path $n.Profil "NTUSER.DAT"
  if (-not (Test-Path -LiteralPath $dat)) { throw "nema fajla $dat" }
  $privremeno = "ZastitaIgraca"
  # Greska programa (reg.exe) ne sme da postane izuzetak - proverava se kod izlaza.
  $ErrorActionPreference = "Continue"
  & reg.exe load "HKU\$privremeno" "$dat" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "registar naloga $($n.Ime) ne moze da se otvori (prijavljen u drugoj sesiji?)" }
  return [pscustomobject]@{ Koren = "Registry::HKEY_USERS\$privremeno"; Ucitan = "HKU\$privremeno" }
}

function ZatvoriRegistar($r) {
  if (-not $r -or -not $r.Ucitan) { return }
  $ErrorActionPreference = "Continue"
  # PowerShell drzi kljuceve otvorene dok ih GC ne pokupi; bez ovoga unload pukne.
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  for ($i = 0; $i -lt 5; $i++) {
    & reg.exe unload $r.Ucitan 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Milliseconds 400
  }
  Pisi "PAZNJA: registar naloga je ostao otvoren ($($r.Ucitan)). Restartuj racunar pre prijave na taj nalog."
}

function Upisi([string]$koren, $v) {
  $k = "$koren\$($v.Kljuc)"
  if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }
  New-ItemProperty -LiteralPath $k -Name $v.Ime -PropertyType DWord -Value $v.Vrednost -Force | Out-Null
}

function Obrisi([string]$koren, $v) {
  $k = "$koren\$($v.Kljuc)"
  if (Test-Path -LiteralPath $k) { Remove-ItemProperty -LiteralPath $k -Name $v.Ime -ErrorAction SilentlyContinue }
}

# DisallowRun: vrednosti "1", "2", ... sa imenom programa. Tudji unosi ostaju;
# dodaju se samo nasi, sa prvim slobodnim brojem.
function ZabraniProgram([string]$koren, [string[]]$programi) {
  $k = "$koren\$DISALLOW"
  if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }
  $postoji = @{}
  $brojevi = @()
  $s = Get-ItemProperty -LiteralPath $k
  foreach ($p in $s.PSObject.Properties) {
    if ($p.Name -like "PS*") { continue }
    $postoji[([string]$p.Value).ToLower()] = $true
    $n = 0; if ([int]::TryParse($p.Name, [ref]$n)) { $brojevi += $n }
  }
  $sledeci = 1; if ($brojevi.Count) { $sledeci = ($brojevi | Measure-Object -Maximum).Maximum + 1 }
  foreach ($prog in $programi) {
    if (-not $prog -or $postoji[$prog.ToLower()]) { continue }
    New-ItemProperty -LiteralPath $k -Name ([string]$sledeci) -PropertyType String -Value $prog -Force | Out-Null
    $postoji[$prog.ToLower()] = $true
    $sledeci++
  }
}

function SkiniZabrane([string]$koren, [string[]]$programi) {
  $k = "$koren\$DISALLOW"
  if (-not (Test-Path -LiteralPath $k)) { return }
  $nasi = @{}; foreach ($p in $programi) { if ($p) { $nasi[$p.ToLower()] = $true } }
  $ostalo = 0
  $s = Get-ItemProperty -LiteralPath $k
  foreach ($p in $s.PSObject.Properties) {
    if ($p.Name -like "PS*") { continue }
    if ($nasi[([string]$p.Value).ToLower()]) { Remove-ItemProperty -LiteralPath $k -Name $p.Name } else { $ostalo++ }
  }
  # Spisak bez ijednog unosa se brise, i prekidac uz njega.
  if ($ostalo -eq 0) {
    Remove-Item -LiteralPath $k -Force -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath "$koren\$POL\Explorer" -Name "DisallowRun" -ErrorAction SilentlyContinue
  }
}

# Programi koje skidamo: nasi + svaki "Uninstall ... Launcher.exe" (ime zavisi
# od imena igraonice, pa ga iskljucivanje ne mora da zna).
function NasiProgrami([string]$koren) {
  $lista = @($ZABRANJENI) + @($Zabrani)
  $k = "$koren\$DISALLOW"
  if (Test-Path -LiteralPath $k) {
    $s = Get-ItemProperty -LiteralPath $k
    foreach ($p in $s.PSObject.Properties) {
      if ($p.Name -notlike "PS*" -and [string]$p.Value -like "Uninstall * Launcher.exe") { $lista += [string]$p.Value }
    }
  }
  return $lista
}

function Ukljuci([string]$koren) {
  $greske = 0
  foreach ($v in $VREDNOSTI) {
    try { Upisi $koren $v } catch { Pisi "nije upisano: $($v.Kljuc) $($v.Ime)"; $greske++ }
  }
  try { ZabraniProgram $koren (@($ZABRANJENI) + @($Zabrani)) } catch { Pisi "nije upisan spisak zabranjenih programa"; $greske++ }
  return $greske
}

function Iskljuci([string]$koren) {
  $greske = 0
  try { SkiniZabrane $koren (NasiProgrami $koren) } catch { Pisi "nije skinut spisak zabranjenih programa"; $greske++ }
  # Ako je u spisku zabrana ostalo nesto tudje, prekidac DisallowRun ostaje -
  # bez njega bi i tudja zabrana prestala da vazi.
  $tudjiSpisak = Test-Path -LiteralPath "$koren\$DISALLOW"
  foreach ($v in $VREDNOSTI) {
    if ($v.Ime -eq "DisallowRun" -and $tudjiSpisak) { continue }
    try { Obrisi $koren $v } catch { Pisi "nije obrisano: $($v.Kljuc) $($v.Ime)"; $greske++ }
  }
  return $greske
}

function Potvrdi([string]$pitanje) {
  if ($BezPitanja) { return $true }
  $odg = Read-Host "  $pitanje Upisi DA za nastavak"
  return ("$odg".Trim() -ceq "DA")
}

# ---------- RAD ----------
if ($Rezim -eq "nalog") {
  # Za .bat fajlove: jedan red, polja odvojena sa |
  $n = NadjiNalog $Nalog
  if (-not $n) { exit 1 }
  Write-Output ("{0}|{1}|{2}|{3}" -f $n.Sid, $n.Profil, $n.Ime, $n.Admin)
  exit 0
}

if (-not (JeAdministrator)) {
  Pisi "Ovo mora da radi kao administrator (desni klik - Run as administrator)."
  exit 1
}

if ($Rezim -eq "popravi") {
  # Svi pravi nalozi (lokalni i domenski), i prijavljeni i neprijavljeni.
  $greske = 0
  $sidovi = @(Get-ChildItem -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" |
      Where-Object { $_.PSChildName -match "^S-1-5-21-" } | ForEach-Object { $_.PSChildName })
  foreach ($sid in $sidovi) {
    $profil = $null
    try { $profil = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid").ProfileImagePath) } catch {}
    $n = [pscustomobject]@{ Sid = $sid; Profil = $profil; Ime = $(if ($profil) { Split-Path $profil -Leaf } else { $sid }) }
    $r = $null
    try {
      $r = OtvoriRegistar $n
      $g = Iskljuci $r.Koren
      if ($g) { $greske += $g } else { Pisi "ociscen nalog $($n.Ime)" }
    } catch {
      Pisi "preskocen nalog $($n.Ime): $($_.Exception.Message)"
    } finally { ZatvoriRegistar $r }
  }
  if ($greske) { exit 1 } else { exit 0 }
}

$n = NadjiNalog $Nalog
if (-not $n) {
  Pisi "Nisam mogao da odredim nalog igraca."
  Pisi "Prijavi se na nalog igraca i pokreni ponovo, ili zadaj ime naloga:"
  Pisi "   zastita-$Rezim.bat IME-NALOGA"
  exit 1
}

$ja = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
Pisi ""
Pisi "Nalog igraca:  $($n.Ime)"
Pisi "SID:           $($n.Sid)"
Pisi ""

if ($Rezim -eq "ukljuci") {
  if ($n.Sid -eq $ja) {
    Pisi "PAZNJA: to je nalog sa kog sada radis (administrator). Zastita se stavlja"
    Pisi "na nalog IGRACA: prijavi se na njega i pokreni ponovo, ili zadaj ime:"
    Pisi "   zastita-ukljuci.bat IME-NALOGA-IGRACA"
    Pisi ""
    if (-not (Potvrdi "Ipak zakljucati OVAJ nalog?")) { exit 2 }
  } elseif ($n.Admin -eq "da") {
    Pisi "PAZNJA: ovaj nalog je ADMINISTRATOR. Igrac na administratorskom nalogu"
    Pisi "skida zastitu jednim klikom. Napravi poseban STANDARDNI nalog za igrace"
    Pisi "(POKRETANJE.md, deo 'Dozvole')."
    Pisi ""
    if (-not (Potvrdi "Svejedno ukljuciti zastitu na ovom nalogu?")) { exit 2 }
  }
}

$r = $null
$greske = 0
try {
  $r = OtvoriRegistar $n
  if ($Rezim -eq "ukljuci") { $greske = Ukljuci $r.Koren } else { $greske = Iskljuci $r.Koren }
} catch {
  Pisi "GRESKA: $($_.Exception.Message)"
  $greske++
} finally { ZatvoriRegistar $r }

Pisi ""
if ($greske) {
  Pisi "PAZNJA: deo nije upisan (vidi poruke iznad)."
  exit 1
}
if ($Rezim -eq "ukljuci") {
  Pisi "Zastita je ukljucena za nalog $($n.Ime)."
  Pisi "Odjavi se i prijavi ponovo na nalog igraca (ili restartuj) da sve stupi na snagu."
  Pisi "Proveri: na nalogu igraca Ctrl+Shift+Esc NE SME da otvori Task Manager."
} else {
  Pisi "Zastita je iskljucena za nalog $($n.Ime)."
  Pisi "Odjavi se i prijavi ponovo na nalog igraca da sve stupi na snagu."
}
exit 0
