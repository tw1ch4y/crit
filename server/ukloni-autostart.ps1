# UKLANJANJE AUTOSTARTA SERVERA - vidi podesi-autostart.ps1
#
# Server se uredno gasi (fajl data\nadzor-stani), brisu se oba zadatka - i
# provera na 5 minuta - i server se od tada pokrece rucno, sa "Pokreni
# server.bat", kao ranije.

$Ime = "Crit Server"
$ImeProvere = "Crit Server - provera"
$Folder = $PSScriptRoot

function Radi-Neki {
  foreach ($z in @($Ime, $ImeProvere)) {
    $t = Get-ScheduledTask -TaskName $z -ErrorAction SilentlyContinue
    if ($t -and $t.State -eq "Running") { return $true }
  }
  return $false
}

Write-Host ""
$zadaci = @($Ime, $ImeProvere) | Where-Object { Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue }
if (-not $zadaci) {
  Write-Host "  Autostart nije podesen - nema sta da se uklanja."
  exit 0
}
if (Radi-Neki) {
  Write-Host "  Gasim server uredno..."
  New-Item -ItemType File -Force -Path (Join-Path $Folder "data\nadzor-stani") | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Radi-Neki)) { break }
    Start-Sleep -Seconds 1
  }
}
# Provera prva: da ne digne nadzornika izmedju dva brisanja.
foreach ($z in @($ImeProvere, $Ime)) {
  Stop-ScheduledTask -TaskName $z -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $z -Confirm:$false -ErrorAction SilentlyContinue
}
Write-Host "  Autostart je uklonjen. Server se sada pokrece rucno: 'Pokreni server.bat'."
exit 0
