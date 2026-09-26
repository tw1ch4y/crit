# Menja podesavanja.json instaliranog launchera. Zove se iz dva .bat fajla u
# istom folderu (u .bat fajlu se nastavak reda ^ i navodnici ne slazu).
#
#   podesi.ps1 -Rezim proba
#   podesi.ps1 -Rezim igraonica -Ip 192.168.1.100
param(
  [Parameter(Mandatory = $true)][ValidateSet("proba", "igraonica")][string]$Rezim,
  [string]$Ip = ""
)

$mesta = @(
  "$env:ProgramFiles\Crit Launcher\resources\podesavanja.json",
  "${env:ProgramFiles(x86)}\Crit Launcher\resources\podesavanja.json",
  "$env:LOCALAPPDATA\Programs\Crit Launcher\resources\podesavanja.json"
)
if ($env:CRIT_PODESAVANJA) { $mesta = @($env:CRIT_PODESAVANJA) + $mesta }

$put = $mesta | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $put) {
  Write-Host ""
  Write-Host "  NIJE NADJEN launcher na ovom racunaru."
  Write-Host "  Prvo instaliraj 'Crit Launcher Setup', pa pokreni ovo ponovo."
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "  Fajl: $put"

try { $t = Get-Content -LiteralPath $put -Raw -Encoding UTF8 }
catch { Write-Host "  NE MOGU DA PROCITAM FAJL."; exit 1 }

if ($Rezim -eq "proba") {
  $adresa = "http://127.0.0.1:8095"
  # Ciscenje i blokada se gase, da proba ne brise prijave na tom racunaru.
  $t = $t -replace '("ciscenjeSesije"\s*:\s*)true', '${1}false'
  $t = $t -replace '("ciscenjeLicnihFascikli"\s*:\s*)true', '${1}false'
  $t = $t -replace '("blokirajPreuzeteProgram"\s*:\s*)true', '${1}false'
  # bez-zakljucavanja.txt (NO_LOCK u launcheru): dok postoji, launcher ne
  # menja Windows podesavanja (Task Manager, Win tasteri, plan napajanja).
  $zastava = Join-Path (Split-Path -Parent (Split-Path -Parent $put)) "bez-zakljucavanja.txt"
  try {
    Set-Content -LiteralPath $zastava -Value "Proba na jednom racunaru - launcher ne dira Windows podesavanja. Obrisi ovaj fajl za rad u igraonici." -Encoding UTF8
    Write-Host "  Zastita kioska iskljucena (bez-zakljucavanja.txt)"
  } catch { Write-Host "  PAZNJA: nisam mogao da upisem bez-zakljucavanja.txt - pokreni kao administrator" }
} else {
  # Adresa se proverava ovde jer "set /p" u .bat fajlu na prazan unos ume da
  # ostavi razmak. Prima i celu adresu (http://192.168.1.100:8095) iz prozora
  # servera.
  $cist = $Ip.Trim() -replace '^\s*https?://', '' -replace '[:/].*$', ''
  $jeIp = $cist -match '^\d{1,3}(\.\d{1,3}){3}$'
  $jeIme = $cist -match '^[A-Za-z0-9][A-Za-z0-9.-]*$'
  if (-not $jeIp -and -not $jeIme) {
    Write-Host ""
    Write-Host "  Adresa '$Ip' ne lici na IP adresu ni na ime racunara."
    Write-Host "  Ocekuje se npr.  192.168.1.100"
    Write-Host "  Nista nije promenjeno."
    Write-Host ""
    exit 1
  }
  # "$cist:8095" bi PowerShell procitao kao promenljivu iz opsega (kao $env:X).
  $adresa = "http://$($cist):8095"
  # Ciscenje licnih fascikli ostaje iskljuceno: sa OneDrive-om bi se brisanje
  # Desktopa i Preuzimanja prenelo u oblak.
  $t = $t -replace '("ciscenjeSesije"\s*:\s*)false', '${1}true'
  $t = $t -replace '("blokirajPreuzeteProgram"\s*:\s*)false', '${1}true'
  # Vracanje na igraonicu skida prekidac iz probe, inace zastita kioska ostaje
  # iskljucena.
  $zastava = Join-Path (Split-Path -Parent (Split-Path -Parent $put)) "bez-zakljucavanja.txt"
  if (Test-Path -LiteralPath $zastava) {
    try { Remove-Item -LiteralPath $zastava -Force; Write-Host "  Zastita kioska vracena" }
    catch { Write-Host "  PAZNJA: nisam mogao da obrisem bez-zakljucavanja.txt - pokreni kao administrator" }
  }
}
$t = $t -replace '("host"\s*:\s*)"[^"]*"', ('${1}"' + $adresa + '"')

try { Set-Content -LiteralPath $put -Value $t -NoNewline -Encoding UTF8 }
catch {
  Write-Host ""
  Write-Host "  NE MOGU DA UPISEM - fajl je u Program Files."
  Write-Host "  Desni klik na .bat fajl -> 'Run as administrator'."
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "  Upisano. Sada stoji:"
Select-String -LiteralPath $put -Pattern '"(host|ciscenjeSesije|ciscenjeLicnihFascikli|blokirajPreuzeteProgram)"' |
  ForEach-Object { Write-Host ("    " + $_.Line.Trim()) }
exit 0
