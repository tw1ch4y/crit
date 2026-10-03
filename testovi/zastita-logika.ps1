# Logika client/zastita.ps1 BEZ pravog registra.
#
# Zove je test-alati-osoblja.mjs (na Windows-u kroz Windows PowerShell 5.1, a
# bilo gde gde postoji pwsh). Iz zastita.ps1 se uzimaju samo definicije - spisak
# podesavanja i funkcije - pa se njegov glavni deo (koji trazi administratora i
# pise u registar) ne izvrsava. Registar je zamenjen recnikom u memoriji:
# funkcije sa imenom cmdleta imaju prednost nad cmdletima, pa zastita.ps1 pise u
# recnik, a ne u Windows.
#
# Ispisuje jedan red po proveri: "OK  opis" ili "PAO opis".
param([Parameter(Mandatory = $true)][string]$Skripta)

$ErrorActionPreference = "Stop"
$tokeni = $null; $greske = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Skripta, [ref]$tokeni, [ref]$greske)
if ($greske) { Write-Output "PAO zastita.ps1 se ne parsira"; exit 1 }

$DEFINICIJE = @('$POL', '$VREDNOSTI', '$ZABRANJENI', '$DISALLOW')
foreach ($s in $ast.EndBlock.Statements) {
  $definicija = ($s -is [System.Management.Automation.Language.FunctionDefinitionAst]) -or
    (($s -is [System.Management.Automation.Language.AssignmentStatementAst]) -and ($DEFINICIJE -contains $s.Left.Extent.Text))
  if ($definicija) { . ([scriptblock]::Create($s.Extent.Text)) }
}
$Zabrani = @("Uninstall Proba Launcher.exe")
$BezPitanja = $true

# ---- registar u memoriji ----
$global:REG = @{}
function Test-Path { param([string]$LiteralPath, [string]$Path) return $global:REG.ContainsKey(("$LiteralPath$Path").ToLower()) }
function New-Item { param([string]$Path, [switch]$Force) if (-not $global:REG.ContainsKey($Path.ToLower())) { $global:REG[$Path.ToLower()] = [ordered]@{} } }
function New-ItemProperty { param([string]$LiteralPath, [string]$Name, [string]$PropertyType, $Value, [switch]$Force) $global:REG[$LiteralPath.ToLower()][$Name] = $Value }
function Get-ItemProperty {
  param([string]$LiteralPath)
  $h = $global:REG[$LiteralPath.ToLower()]
  if (-not $h -or $h.Count -eq 0) { return $null }
  # pravi Get-ItemProperty dodaje i PS* polja - zastita.ps1 mora da ih preskoci
  $o = [ordered]@{ PSPath = "x"; PSParentPath = "x"; PSChildName = "x"; PSDrive = "x"; PSProvider = "x" }
  foreach ($k in $h.Keys) { $o[$k] = $h[$k] }
  return [pscustomobject]$o
}
function Remove-ItemProperty { param([string]$LiteralPath, [string]$Name, $ErrorAction) $h = $global:REG[$LiteralPath.ToLower()]; if ($h) { $h.Remove($Name) } }
function Remove-Item { param([string]$LiteralPath, [switch]$Force, $ErrorAction) $global:REG.Remove($LiteralPath.ToLower()) }

function Proveri([string]$opis, [bool]$uslov) { if ($uslov) { Write-Output "OK  $opis" } else { Write-Output "PAO $opis" } }
$K = "Registry::HKEY_USERS\S-1-5-21-1-2-3-1001"
$exp = "$K\$POL\Explorer".ToLower()
$dis = "$K\$DISALLOW".ToLower()
$sys = "$K\$POL\System".ToLower()
$cmd = "$K\Software\Policies\Microsoft\Windows\System".ToLower()
function Zabranjeni { $h = $global:REG[$dis]; if (-not $h) { return @() }; return @($h.Values) }

# 1. cist nalog
$g = Ukljuci $K
Proveri "ukljucivanje bez greske" ($g -eq 0)
Proveri "Task Manager ugasen" ($global:REG[$sys]["DisableTaskMgr"] -eq 1)
Proveri "komandna linija: 2 (skripte rade)" ($global:REG[$cmd]["DisableCMD"] -eq 2)
Proveri "DisallowRun ukljucen" ($global:REG[$exp]["DisallowRun"] -eq 1)
Proveri "zabranjen cmd.exe" ((Zabranjeni) -contains "cmd.exe")
Proveri "zabranjena deinstalacija launchera" ((Zabranjeni) -contains "Uninstall Proba Launcher.exe")
Proveri "zabrane su numerisane od 1 bez rupa" ((@($global:REG[$dis].Keys) -join ",") -eq ((1..($global:REG[$dis].Count)) -join ","))

# 2. drugi put - nista se ne duplira
$pre = $global:REG[$dis].Count
$g = Ukljuci $K
Proveri "drugo ukljucivanje ne duplira zabrane" ($g -eq 0 -and $global:REG[$dis].Count -eq $pre)

# 3. iskljucivanje skida sve
$g = Iskljuci $K
Proveri "iskljucivanje bez greske" ($g -eq 0)
Proveri "Task Manager vracen" (-not $global:REG[$sys].Contains("DisableTaskMgr"))
Proveri "komandna linija vracena" (-not $global:REG[$cmd].Contains("DisableCMD"))
Proveri "spisak zabrana obrisan" (-not $global:REG.ContainsKey($dis))
Proveri "DisallowRun iskljucen" (-not $global:REG[$exp].Contains("DisallowRun"))

# 4. tudji unos u DisallowRun ostaje
$global:REG = @{}
New-Item -Path "$K\$DISALLOW" -Force
New-ItemProperty -LiteralPath "$K\$DISALLOW" -Name "1" -PropertyType String -Value "neka-igra.exe" -Force
New-Item -Path "$K\$POL\Explorer" -Force
New-ItemProperty -LiteralPath "$K\$POL\Explorer" -Name "DisallowRun" -PropertyType DWord -Value 1 -Force
$null = Ukljuci $K
Proveri "nasi unosi idu posle tudjeg" ($global:REG[$dis]["1"] -eq "neka-igra.exe" -and $global:REG[$dis]["2"] -eq "cmd.exe")
$null = Iskljuci $K
Proveri "tudji unos ostaje posle iskljucivanja" ((Zabranjeni) -join "," -eq "neka-igra.exe")
Proveri "a sa njim i DisallowRun" ($global:REG[$exp]["DisallowRun"] -eq 1)

# 5. iskljucivanje zna i deinstalaciju pod drugim imenom (igraonica preimenovana)
$global:REG = @{}
$Zabrani = @("Uninstall Staro Ime Launcher.exe")
$null = Ukljuci $K
$Zabrani = @()
$null = Iskljuci $K
Proveri "skida se i deinstalacija pod starim imenom" (-not $global:REG.ContainsKey($dis))
