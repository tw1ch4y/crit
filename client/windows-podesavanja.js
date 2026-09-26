// Podešavanja koja igrač sme da menja sa svog naloga: miš i zvuk.
//
// Uslov za svako podešavanje ovde: menja se po korisniku (HKCU ili sesija),
// vraća se odmah i ne traži administratora. Rezolucija zato nije tu - režim
// koji monitor ne prikaže ostavio bi crn ekran bez načina za povratak.
// Na odjavi se vraća zatečeno stanje.
const { execFile } = require("node:child_process");

const PS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

function psPokreni(skripta, { timeout = 12000 } = {}) {
  return new Promise((res) => {
    execFile("powershell", [...PS, skripta], { timeout, windowsHide: true },
      (greska, izlaz, greskaIzlaz) => {
        if (greska) return res({ ok: false, greska: String(greskaIzlaz || greska.message).slice(0, 300) });
        res({ ok: true, izlaz: String(izlaz || "").trim() });
      });
  });
}

async function psJson(skripta, opcije) {
  const r = await psPokreni(skripta, opcije);
  if (!r.ok) return { ok: false, greska: r.greska };
  try { return { ok: true, podaci: JSON.parse(r.izlaz || "null") }; }
  catch { return { ok: false, greska: "Neočekivan odgovor: " + r.izlaz.slice(0, 200) }; }
}

// ---------------------------------------------------------------- MIŠ -----
//
// Brzina: HKCU\Control Panel\Mouse\MouseSensitivity (1-20, fabrički 10).
// Ubrzanje ("Enhance pointer precision") su tri vrednosti, MouseSpeed i dva
// praga, i sve tri idu na nulu. Registar Windows čita pri prijavi, pa se
// promena primenjuje i kroz SystemParametersInfo.
const MIS_API = `
Add-Type -Namespace Crit -Name Mis -MemberDefinition @'
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
  [DllImport("user32.dll", SetLastError=true, EntryPoint="SystemParametersInfoW")]
  public static extern bool SystemParametersInfoArr(uint uiAction, uint uiParam, int[] pvParam, uint fWinIni);
'@ -ErrorAction SilentlyContinue
`;

async function citajMis() {
  const r = await psJson(`
    $p = "HKCU:\\Control Panel\\Mouse"
    $brzina = (Get-ItemProperty -Path $p -Name MouseSensitivity -ErrorAction SilentlyContinue).MouseSensitivity
    $ubrzanje = (Get-ItemProperty -Path $p -Name MouseSpeed -ErrorAction SilentlyContinue).MouseSpeed
    [pscustomobject]@{
      brzina = $(if ($brzina) { [int]$brzina } else { 10 })
      ubrzanje = $(if ($ubrzanje -and [int]$ubrzanje -gt 0) { $true } else { $false })
    } | ConvertTo-Json -Compress`);
  if (!r.ok) return { brzina: 10, ubrzanje: false, greska: r.greska };
  return { brzina: r.podaci?.brzina ?? 10, ubrzanje: !!r.podaci?.ubrzanje };
}

async function primeniMis({ brzina, ubrzanje }) {
  const b = Math.max(1, Math.min(20, Math.round(Number(brzina) || 10)));
  const u = ubrzanje ? 1 : 0;
  // SPI_SETMOUSESPEED = 0x0071, SPI_SETMOUSE = 0x0004;
  // SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3.
  const r = await psPokreni(`
    ${MIS_API}
    $p = "HKCU:\\Control Panel\\Mouse"
    Set-ItemProperty -Path $p -Name MouseSensitivity -Value "${b}"
    Set-ItemProperty -Path $p -Name MouseSpeed -Value "${u}"
    Set-ItemProperty -Path $p -Name MouseThreshold1 -Value "${u ? 6 : 0}"
    Set-ItemProperty -Path $p -Name MouseThreshold2 -Value "${u ? 10 : 0}"
    [void][Crit.Mis]::SystemParametersInfo(0x0071, 0, [IntPtr]${b}, 3)
    $niz = [int[]]@(${u ? 6 : 0}, ${u ? 10 : 0}, ${u})
    [void][Crit.Mis]::SystemParametersInfoArr(0x0004, 0, $niz, 3)
  `);
  return r.ok ? { ok: true } : { ok: false, greska: r.greska };
}

// --------------------------------------------------------------- ZVUK -----
//
// Jačina ide kroz COM interfejs IAudioEndpointVolume. Ako na nekom računaru
// ne prođe, jačina je nepoznata i launcher tu stavku ne prikazuje.
const ZVUK_API = `
Add-Type -ErrorAction SilentlyContinue @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l();
  int SetMute(bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int ctx, System.IntPtr a, out IAudioEndpointVolume o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class Zvuk {
  static IAudioEndpointVolume Vol() {
    IMMDeviceEnumerator e = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev; e.GetDefaultAudioEndpoint(0, 1, out dev);
    System.Guid g = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume v; dev.Activate(ref g, 23, System.IntPtr.Zero, out v);
    return v;
  }
  public static float Citaj() { float v; Vol().GetMasterVolumeLevelScalar(out v); return v; }
  public static void Postavi(float v) { Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty); }
}
'@
`;

async function citajZvuk() {
  const r = await psPokreni(`${ZVUK_API}
    [int][math]::Round([Zvuk]::Citaj() * 100)`);
  if (!r.ok) return { jacina: null, greska: r.greska };
  // Prazan izlaz nije nula (Number("") je 0).
  const n = r.izlaz === "" ? NaN : Number(r.izlaz);
  return { jacina: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null };
}

async function primeniZvuk({ jacina }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(jacina) || 0)));
  const r = await psPokreni(`${ZVUK_API}
    [Zvuk]::Postavi(${(v / 100).toFixed(3)})`);
  return r.ok ? { ok: true } : { ok: false, greska: r.greska };
}

// ------------------------------------------- PREČICE PRISTUPAČNOSTI -----
//
// Pet puta Shift, desni Shift držan osam sekundi i Num Lock držan pet sekundi
// otvaraju Windows prozor sa vezom ka Podešavanjima. Gasi se samo prečica;
// funkcija ostaje kakva jeste. SystemParametersInfo sa SPIF_UPDATEINIFILE
// važi odmah i ostaje u HKCU\Control Panel\Accessibility. Na izlazu iz
// kioska prečice se vraćaju na fabričko stanje Windows-a.
const PRISTUP_API = `
Add-Type -Namespace Crit -Name Pristup -MemberDefinition @'
  [StructLayout(LayoutKind.Sequential)] public struct Dva { public uint cbSize; public uint dwFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct Filter { public uint cbSize; public uint dwFlags; public uint a; public uint b; public uint c; public uint d; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SystemParametersInfo(uint akcija, uint velicina, ref Dva p, uint upis);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SystemParametersInfo(uint akcija, uint velicina, ref Filter p, uint upis);
'@ -ErrorAction SilentlyContinue
`;

// Bitovi HOTKEYACTIVE (4) i CONFIRMHOTKEY (8) su isti za sve tri strukture.
// SPI_GET/SET: STICKYKEYS 0x3A/0x3B, TOGGLEKEYS 0x34/0x35, FILTERKEYS 0x32/0x33.
function skriptaPristupacnosti(ukljucene) {
  return `${PRISTUP_API}
    function Precica([uint32]$v) {
      if (${ukljucene ? "$true" : "$false"}) { return [uint32]($v -bor 12) }
      if ($v -band 4) { $v = $v - 4 }
      if ($v -band 8) { $v = $v - 8 }
      return [uint32]$v
    }
    $s = New-Object 'Crit.Pristup+Dva'; $s.cbSize = 8
    $t = New-Object 'Crit.Pristup+Dva'; $t.cbSize = 8
    $f = New-Object 'Crit.Pristup+Filter'; $f.cbSize = 24
    if (-not [Crit.Pristup]::SystemParametersInfo(0x3A, 8, [ref]$s, 0)) { throw 'StickyKeys se ne cita' }
    if (-not [Crit.Pristup]::SystemParametersInfo(0x34, 8, [ref]$t, 0)) { throw 'ToggleKeys se ne cita' }
    if (-not [Crit.Pristup]::SystemParametersInfo(0x32, 24, [ref]$f, 0)) { throw 'FilterKeys se ne cita' }
    $s.dwFlags = Precica $s.dwFlags
    $t.dwFlags = Precica $t.dwFlags
    $f.dwFlags = Precica $f.dwFlags
    [void][Crit.Pristup]::SystemParametersInfo(0x3B, 8, [ref]$s, 3)
    [void][Crit.Pristup]::SystemParametersInfo(0x35, 8, [ref]$t, 3)
    [void][Crit.Pristup]::SystemParametersInfo(0x33, 24, [ref]$f, 3)
    'ok'`;
}

async function precicePristupacnosti(ukljucene) {
  const r = await psPokreni(skriptaPristupacnosti(!!ukljucene));
  return r.ok ? { ok: true } : { ok: false, greska: r.greska };
}

// ------------------------------------------------------------- SPOLJA -----

// Sve odjednom; deo koji ne uspe ne obara ostale.
async function procitajSve() {
  const [mis, zvuk] = await Promise.all([citajMis(), citajZvuk()]);
  // Nepročitan miš je null, ne fabrička vrednost, da se na odjavi ne upiše
  // broj koji niko nije pročitao.
  return { mis: mis.greska ? null : mis, zvuk };
}

module.exports = {
  citajMis, primeniMis, citajZvuk, primeniZvuk, procitajSve,
  precicePristupacnosti, skriptaPristupacnosti,
};
