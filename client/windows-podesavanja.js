// PODEŠAVANJA KOJA IGRAČ SME DA MENJA
//
// Igrač sedne za računar i zatekne tuđa podešavanja: miš od prethodnog gosta,
// ubrzanje pokazivača uključeno, zvuk na nuli. Windows podešavanja su u kiosku
// zaključana i s razlogom, pa mu je jedini izlaz da zove radnika.
//
// ŠTA SME DA UĐE OVDE - tri uslova, sva tri moraju:
//   1. menja se PO KORISNIKU (HKCU ili sesija), ne za ceo računar
//   2. vraća se odmah, istim dugmetom
//   3. ne traži administratora
//
// Zato ovde NEMA rezolucije ni osvežavanja ekrana. Windows ume da prihvati
// režim koji monitor ne prikaže: ekran ostane crn, a igrač u kiosku nema čime
// da vrati staro. Dobitak ne vredi te cene; ko hoće drugu rezoluciju, javi se
// radniku.
//
// Sve se vraća na zatečeno kad se igrač odjavi - igraonica ne sme da pamti
// podešavanja jednog gosta za sledećeg.
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
// Brzina je HKCU\Control Panel\Mouse\MouseSensitivity (1-20, fabrički 10).
//
// Ubrzanje ("Enhance pointer precision") su TRI vrednosti: MouseSpeed i dva
// praga. Sve tri moraju na nulu - gašenje samo jedne ostavlja ubrzanje upola.
// Za igru je to najvažnija stavka na ovom spisku: dok je uključeno, isti potez
// rukom daje različit pomeraj u igri, pa se nišan ne može naučiti.
//
// Upis u registar sam po sebi ne menja ništa dok sesija traje - Windows te
// vrednosti čita pri prijavi. Zato se odmah zove i SystemParametersInfo, koji
// primeni promenu na živoj sesiji.
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
  // SPI_SETMOUSESPEED = 0x0071, SPI_SETMOUSE = 0x0004
  // SPIF_UPDATEINIFILE(1) | SPIF_SENDCHANGE(2) = 3, da promena i ostane zapisana.
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
// Jačina zvuka ide kroz IAudioEndpointVolume. Nema je ni u Electron-u ni u
// običnom PowerShell-u, pa se COM sučelje opisuje ovde. Ako na nekoj mašini ne
// prođe, jačina se javi kao nepoznata i launcher tu stavku sakrije - ostatak
// podešavanja i dalje radi.
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
  const n = Number(r.izlaz);
  return { jacina: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null };
}

async function primeniZvuk({ jacina }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(jacina) || 0)));
  const r = await psPokreni(`${ZVUK_API}
    [Zvuk]::Postavi(${(v / 100).toFixed(3)})`);
  return r.ok ? { ok: true } : { ok: false, greska: r.greska };
}

// ------------------------------------------------------------- SPOLJA -----

// Sve odjednom, za prikaz u launcheru. Jedan deo koji ne uspe ne obara ostale:
// mašina na kojoj zvuk ne prođe i dalje treba da dobije podešavanja miša.
async function procitajSve() {
  const [mis, zvuk] = await Promise.all([citajMis(), citajZvuk()]);
  return { mis, zvuk };
}

module.exports = { citajMis, primeniMis, citajZvuk, primeniZvuk, procitajSve };
