# SERVER SE PODIZE SAM, PRI PALJENJU RACUNARA - I BEZ PRIJAVE NA WINDOWS
#
# Do sada je autostart bio precica u Startup folderu. Ona se pokrece tek kad se
# neko prijavi na Windows, i otvara prozor koji se zatvori jednim klikom. Ako se
# glavni racunar restartuje nocu (Windows Update, nestanak struje), server ne
# radi do jutra - dok neko ne sedne i ne prijavi se.
#
# Sada je to zakazani zadatak koji se pokrece pri paljenju racunara, kao SYSTEM,
# bez prozora. Pokrece nadzornika (nadzornik.mjs), a on drzi server.
#
# Uz njega ide i drugi zadatak, PROVERA NA 5 MINUTA: nadzornik ugasen silom
# (Task Manager) povuce i server, a "ponovo pri gresci" to ne pokriva. Vidi
# "--provera" u nadzornik.mjs.
#
# Skripta sama proverava da je proradilo: pokrene zadatak i saceka da server
# odgovori. Ako ne odgovori, zadaci se uklanjaju i sve ostaje kao pre.
#
# Pokrece se preko "Podesi autostart.bat" (on trazi administratora). Tekst je
# bez kvacica: Windows PowerShell 5.1 fajl bez BOM-a cita u staroj kodnoj strani.

$ErrorActionPreference = "Stop"
$Ime = "Crit Server"
$ImeProvere = "Crit Server - provera"
$Folder = $PSScriptRoot
$Port = 8095

function Zdravlje {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$Port/api/zdravlje").StatusCode -eq 200 }
  catch { return $false }
}

# Nadzornik moze da radi pod bilo kojim od dva zadatka: provera ga digne pod svojim.
function Radi-Neki {
  foreach ($z in @($Ime, $ImeProvere)) {
    $t = Get-ScheduledTask -TaskName $z -ErrorAction SilentlyContinue
    if ($t -and $t.State -eq "Running") { return $true }
  }
  return $false
}

function Ukloni-Zadatak {
  # Provera prva: da ne digne nadzornika izmedju dva brisanja.
  foreach ($z in @($ImeProvere, $Ime)) {
    Stop-ScheduledTask -TaskName $z -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $z -Confirm:$false -ErrorAction SilentlyContinue
  }
}

function Ugasi-Postojeci {
  # Nadzornik se gasi uredno kad se u data\ pojavi ovaj fajl. Uredno gasenje
  # brise i data\nadzor.json, pa ga provera na 5 minuta ne podize ponovo.
  New-Item -ItemType File -Force -Path (Join-Path $Folder "data\nadzor-stani") | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Radi-Neki)) { break }
    Start-Sleep -Seconds 1
  }
  Ukloni-Zadatak
}

Write-Host ""
Write-Host "  CRIT - server se pokrece sam pri paljenju racunara"
Write-Host "  --------------------------------------------------"
Write-Host ""

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host "  [GRESKA] Node.js nije instaliran. Skini ga sa https://nodejs.org (LTS) pa pokreni ovo ponovo."
  exit 1
}
if (-not (Test-Path (Join-Path $Folder "nadzornik.mjs"))) {
  Write-Host "  [GRESKA] U ovom folderu nema nadzornik.mjs - pokreni skriptu iz foldera servera."
  exit 1
}
if (-not (Test-Path (Join-Path $Folder "node_modules"))) {
  Write-Host "  [GRESKA] Server jos nije pripremljen. Prvo jednom pokreni 'Pokreni server.bat', zatvori ga, pa ovo."
  exit 1
}

# Zadatak radi kao SYSTEM. Fajl u folderu koji sinhronizuje OneDrive moze da
# bude samo "u oblaku" (postoji, a sadrzaja nema na disku) - SYSTEM ga tada ne
# procita, i server ne krene.
if ($Folder -match "OneDrive") {
  Write-Host "  [PAZNJA] Server je u folderu koji sinhronizuje OneDrive:"
  Write-Host "           $Folder"
  Write-Host "           Preporuka: premesti ceo folder servera na C:\Crit\server i pokreni ovo odatle."
  Write-Host ""
}

$postojeci = (Get-ScheduledTask -TaskName $Ime -ErrorAction SilentlyContinue) -or (Get-ScheduledTask -TaskName $ImeProvere -ErrorAction SilentlyContinue)
if ((Zdravlje) -and -not (Radi-Neki)) {
  Write-Host "  [PAZNJA] Server vec radi u prozoru 'Crit Server'."
  Write-Host "           Zatvori taj prozor, pa pokreni ovu skriptu ponovo."
  exit 1
}

try {
  if ($postojeci) {
    Write-Host "  Autostart je vec bio podesen - pravim ga iznova."
    Ugasi-Postojeci
  }

  $skripta = '"' + (Join-Path $Folder "nadzornik.mjs") + '"'
  $akcija  = New-ScheduledTaskAction -Execute $node -Argument $skripta -WorkingDirectory $Folder
  $okidac  = New-ScheduledTaskTrigger -AtStartup
  $ko      = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  # Bez vremenskog ogranicenja (zadatak radi dok racunar radi), nikad dva
  # odjednom, i ponovo na minut ako zadatak ne uspe da se POKRENE. Nadzornika
  # koji je posle ugasen to ne pokriva - za to je provera ispod.
  $pravila = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $Ime -Action $akcija -Trigger $okidac -Principal $ko -Settings $pravila `
    -Description "Crit server: nadzornik koji drzi server i dize ga posle pada." -Force | Out-Null

  Write-Host "  Zadatak je napravljen. Pokrecem server i cekam da se javi..."
  Start-ScheduledTask -TaskName $Ime
} catch {
  Ukloni-Zadatak
  Write-Host ""
  Write-Host "  [GRESKA] $($_.Exception.Message)"
  Write-Host "           Autostart NIJE podesen. Server se i dalje pokrece sa 'Pokreni server.bat'."
  exit 1
}

$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  if (Zdravlje) { $ok = $true; break }
}

if (-not $ok) {
  Ugasi-Postojeci
  Write-Host ""
  Write-Host "  [GRESKA] Server se nije javio za 30 sekundi. Autostart NIJE podesen."
  Write-Host "           Sve je ostalo kao pre: server se pokrece sa 'Pokreni server.bat'."
  $zapis = Join-Path $Folder "data\nadzor.log"
  if (Test-Path $zapis) {
    Write-Host ""
    Write-Host "  Poslednji redovi iz data\nadzor.log:"
    Get-Content $zapis -Tail 15 | ForEach-Object { Write-Host "    $_" }
  }
  exit 1
}

# PROVERA NA 5 MINUTA. Svaki dan od ponoci, na 5 minuta, ceo dan: tako zapisano
# "zauvek" prima svaka verzija Windows-a (beskonacno trajanje ponavljanja neke
# odbiju). Dok nadzornik radi, pokrenuta provera odmah izadje; kad ga nema, a nije
# ugasen uredno, digne ga. Ako Windows ovo ne prihvati, autostart ostaje - samo
# bez provere - i to se kaze.
$provera = $false
try {
  $okidacProvere = New-ScheduledTaskTrigger -Daily -At "00:00"
  $okidacProvere.Repetition = (New-ScheduledTaskTrigger -Once -At "00:00" `
    -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
  $akcijaProvere = New-ScheduledTaskAction -Execute $node -Argument ($skripta + " --provera") -WorkingDirectory $Folder
  Register-ScheduledTask -TaskName $ImeProvere -Action $akcijaProvere -Trigger $okidacProvere -Principal $ko -Settings $pravila `
    -Description "Crit server: dize nadzornika ako je ugasen silom." -Force | Out-Null
  if ((Get-ScheduledTaskInfo -TaskName $ImeProvere).NextRunTime) { $provera = $true }
} catch {}
if (-not $provera) {
  Unregister-ScheduledTask -TaskName $ImeProvere -Confirm:$false -ErrorAction SilentlyContinue
}

$stara = Join-Path ([Environment]::GetFolderPath("Startup")) "Crit Server.lnk"
if (Test-Path $stara) {
  Remove-Item $stara -Force
  Write-Host "  Uklonjena stara precica iz Startup foldera (ona je cekala prijavu na Windows)."
}

Write-Host ""
Write-Host "  GOTOVO. Server radi u pozadini, bez prozora, i pokretace se sam"
Write-Host "  svaki put kad se racunar upali - i pre nego sto se iko prijavi."
Write-Host ""
if ($provera) {
  Write-Host "  Provera na 5 minuta: ako neko ugasi server silom, digne se sam."
} else {
  Write-Host "  [PAZNJA] Provera na 5 minuta NIJE podesena - Windows je nije prihvatio."
  Write-Host "           Server se i dalje digne pri paljenju i posle svakog pada, ali ako"
  Write-Host "           neko ugasi node.exe u Task Manager-u, ostaje ugasen do restarta."
}
Write-Host ""
Write-Host "  Panel:            http://localhost:$Port"
Write-Host "  Zapis nadzornika: data\nadzor.log"
Write-Host "  Povratak na staro: 'Ukloni autostart.bat'"
Write-Host ""
Write-Host "  PROVERI SUTRA: ako je u panelu kopija van racunara podesena na MREZNI"
Write-Host "  folder, pogledaj da je prosla. Server sada radi kao SYSTEM, ne kao ti."
exit 0
