// Gašenje programa koje je igrač pokrenuo tokom sesije.
//
// Igre se često pokreću preko pokretača (Steam, Riot, Epic) i nastavljaju pod
// drugim imenom, pa se gašenje ne radi po imenu: pamti se šta je radilo pre
// prijave, a na kraju sesije gasi ono što se pojavilo u međuvremenu.

const { execFile, spawn } = require("node:child_process");
const path = require("node:path");

// Procesi iz Windows fascikle se nikad ne diraju, ma šta bilo na spiskovima.
const ZASTICENE_PUTANJE = [/\\Windows\\/i];

// Programi koji se ne gase iako su se pojavili tokom sesije.
const ZASTICENA_IMENA = new Set([
  "explorer.exe", "crit launcher.exe", "electron.exe",
  "onedrive.exe", "searchhost.exe", "startmenuexperiencehost.exe",
  "shellexperiencehost.exe", "textinputhost.exe", "runtimebroker.exe",
  "dllhost.exe", "sihost.exe", "ctfmon.exe", "conhost.exe",
  "msmpeng.exe", "nissrv.exe", "securityhealthservice.exe",
  "nvcontainer.exe", "nvidia share.exe", "radeonsoftware.exe",
  "audiodg.exe", "taskhostw.exe", "smartscreen.exe",
]);

// Komande idu kroz execFile sa rokom (vidi pokreniKomandu u main.js).
const ROK_POPISA = 20000;
const ROK_GASENJA = 10000;

// Vraća [{ ime, putanja, pid, memorija }]. Izlaz je UTF-8, inače putanje sa
// č, ć ili đ stižu izmenjene.
function popisProcesa(cb) {
  const ps =
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; " +
    "Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId,Name,ExecutablePath,WorkingSetSize | ConvertTo-Json -Compress";
  try {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps],
      { windowsHide: true, maxBuffer: 12 * 1024 * 1024, timeout: ROK_POPISA },
      (err, out) => {
        if (err) return cb([]);
        try {
          let lista = JSON.parse(String(out).replace(/^﻿/, ""));
          if (!Array.isArray(lista)) lista = [lista];
          cb(lista.map((p) => ({
            pid: p.ProcessId,
            ime: String(p.Name || "").toLowerCase(),
            putanja: String(p.ExecutablePath || ""),
            memorija: Number(p.WorkingSetSize) || 0,
          })));
        } catch { cb([]); }
      });
  } catch { cb([]); }
}

function ugasiPid(pid, gotovo = () => {}) {
  try {
    execFile("taskkill", ["/PID", String(pid), "/F", "/T"], { windowsHide: true, timeout: ROK_GASENJA },
      (greska) => gotovo(greska));
  } catch (e) { gotovo(e); }
}

function zasticen(p, dodatnoZasticena) {
  if (!p.ime) return true;
  if (ZASTICENA_IMENA.has(p.ime)) return true;
  if (dodatnoZasticena && dodatnoZasticena.has(p.ime)) return true;
  if (!p.putanja) return true; // bez putanje ne znamo šta je - ne diramo
  return ZASTICENE_PUTANJE.some((r) => r.test(p.putanja));
}

/**
 * Snima koji procesi rade sada. Poziva se kad se igrač prijavi.
 * @returns {Promise<Set<number>>} skup PID-ova
 */
function snimiStanje() {
  return new Promise((res) => popisProcesa((lista) => res(new Set(lista.map((p) => p.pid)))));
}

/**
 * Gasi sve što je pokrenuto posle snimka, osim zaštićenog.
 * @param {Set<number>} pocetniPidovi  rezultat snimiStanje()
 * @param {object} o
 * @param {boolean} o.suvo   true = samo ispiši šta bi ugasio
 * @param {Set<string>} o.nediraj  dodatna imena koja se ne gase
 * @param {function} o.log
 */
function ugasiNoveProcese(pocetniPidovi, { suvo = false, nediraj = null, log = () => {} } = {}) {
  return new Promise((res) => {
    if (!pocetniPidovi || !pocetniPidovi.size) { log("nema snimka sa početka sesije - preskačem"); return res(0); }
    popisProcesa((lista) => {
      const zaGasenje = lista.filter((p) => !pocetniPidovi.has(p.pid) && !zasticen(p, nediraj));
      if (!zaGasenje.length) { log("nema programa koje je igrač ostavio da rade"); return res(0); }

      for (const p of zaGasenje) {
        if (suvo) { log(`  [PROBNI RAD] ugasio bih: ${p.ime}  (${p.putanja})`); continue; }
        ugasiPid(p.pid);
      }
      log(`${suvo ? "[PROBNI RAD] " : ""}programa za gašenje: ${zaGasenje.length}`);
      res(zaGasenje.length);
    });
  });
}

// Program pokrenut iz Preuzimanja, Temp-a ili sa radne površine je skinut
// kroz pregledač; igre odatle ne rade.
function zabranjenaPutanja(putanja, env) {
  const p = String(putanja || "").toLowerCase();
  if (!p) return false;
  // Daljinska instalacija iz panela ide kroz Temp i ne dira se.
  if (p.includes("\\crit-install\\")) return false;

  const HOME = String(env.USERPROFILE || "").toLowerCase();
  const TEMP = String(env.TEMP || "").toLowerCase();
  // Završna kosa crta: "...\downloads\" ne sme da uhvati i "...\downloads-igre\".
  const uz = (s) => (s.endsWith("\\") ? s : s + "\\");
  const mesta = [
    HOME && uz(path.join(HOME, "downloads").toLowerCase()),
    TEMP && uz(TEMP),
    HOME && uz(path.join(HOME, "desktop").toLowerCase()),
  ].filter(Boolean);
  return mesta.some((m) => p.startsWith(m));
}

// ---- Straža nad preuzetim programima ----
//
// Jedan pomoćni PowerShell proces za celu sesiju, na sniženom prioritetu.
// Popis ide kroz .NET (bez WMI), a javljaju se samo procesi koje još nije
// video. Sam se gasi kad launchera nema; kad zaćuti, launcher ga diže
// ponovo, a kad pada u krug, pauzira i javlja osoblju.
//
// Odluka šta se gasi (zabranjenaPutanja, zasticen) je ovde u JS-u.
//
// Skripta nema dvostruke navodnike: PowerShell 5.1 ih u argumentu za -Command
// tumači nedosledno.
function skriptaStraze(roditelj, razmakMs) {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
    "try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}",
    `$roditelj = ${Number(roditelj) || 0}`,
    "$imeRoditelja = (Get-Process -Id $roditelj).ProcessName",
    "if (-not $imeRoditelja) { exit 0 }",
    "$poznati = @{}",
    "while ($true) {",
    "$r = Get-Process -Id $roditelj",
    "if (-not $r -or $r.ProcessName -ne $imeRoditelja) { exit 0 }",
    "$sada = @{}",
    "foreach ($p in [System.Diagnostics.Process]::GetProcesses()) {",
    "$k = [string]$p.Id + '|' + $p.ProcessName",
    "$sada[$k] = 1",
    "if (-not $poznati.ContainsKey($k)) {",
    "$put = $null",
    "try { $put = $p.Path } catch {}",
    "try { [Console]::Out.WriteLine((@{ pid = $p.Id; ime = $p.ProcessName; putanja = $put } | ConvertTo-Json -Compress)) } catch { exit 0 }",
    "}",
    "$p.Dispose()",
    "}",
    "$poznati = $sada",
    "try { [Console]::Out.WriteLine('ZIV'); [Console]::Out.Flush() } catch { exit 0 }",
    `Start-Sleep -Milliseconds ${Math.max(200, Number(razmakMs) || 3000)}`,
    "}",
  ].join("; ");
}

const PS_STRAZA = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

// .NET daje ime bez nastavka ("skinuto"), ostatak koda radi sa "skinuto.exe".
function imeProcesa(ime) {
  const n = String(ime || "").toLowerCase();
  return n && !n.endsWith(".exe") ? n + ".exe" : n;
}

/**
 * Pokreće stražu za jednu sesiju. Vraća { zaustavi(), pid }.
 * @param {object} o
 * @param {function} o.obavesti  (ime) kad je nešto ugašeno
 * @param {function} o.kvar      (opis) kad straža ne može da radi - ide osoblju
 * @param {function} o.log
 * @param {boolean}  o.suvo      true = samo ispiši šta bi ugasio
 * Parametri sa donjom crtom i kraći rokovi postoje zbog testova.
 */
function pokreniStrazu({
  obavesti = () => {}, kvar = () => {}, log = () => {},
  razmakMs = 3000, env = process.env, suvo = false,
  rokTisine = Math.max(30000, razmakMs * 8), pauzaPosleSmrti = 2000, pauzaPokusaja = 2000,
  _spawn = spawn, _ugasi = ugasiPid,
} = {}) {
  let dete = null;
  let zaustavljena = false;
  let poslednjiZnak = 0;
  let padovi = [];
  let ponovo = null;
  let javljenKvar = false;
  const gasim = new Set(); // PID-ovi koji se upravo gase - da se isti ne gasi dvaput

  const blokiraj = (p, pokusaj = 1) => {
    if (suvo) { log(`  [PROBNI RAD] blokirao bih: ${p.ime}  (${p.putanja})`); return; }
    if (pokusaj === 1) {
      if (gasim.has(p.pid)) return;
      gasim.add(p.pid);
    }
    _ugasi(p.pid, (greska) => {
      if (zaustavljena) return;
      if (!greska) { gasim.delete(p.pid); obavesti(p.ime, p); return; }
      if (pokusaj < 3) { setTimeout(() => blokiraj(p, pokusaj + 1), pauzaPokusaja); return; }
      // Tri odbijanja ili je program sam izašao; igraču se ne javlja ništa.
      gasim.delete(p.pid);
      log(`nije ugašen: ${p.ime} (${String(greska.message || greska).slice(0, 80)})`);
    });
  };

  const obradi = (red) => {
    red = String(red).replace(/^﻿/, "").trim();
    if (!red) return;
    poslednjiZnak = Date.now();
    if (red === "ZIV") return;
    let x;
    try { x = JSON.parse(red); } catch { return; }
    const p = { pid: Number(x.pid), ime: imeProcesa(x.ime), putanja: String(x.putanja || "") };
    if (!Number.isInteger(p.pid) || p.pid <= 0) return;
    if (zabranjenaPutanja(p.putanja, env) && !zasticen(p, null)) blokiraj(p);
  };

  const podigni = () => {
    ponovo = null;
    if (zaustavljena) return;
    const sada = Date.now();
    padovi = padovi.filter((t) => sada - t < 60000);
    if (padovi.length >= 5) {
      if (!javljenKvar) { javljenKvar = true; kvar("Straža nad preuzetim programima pada u krug - pauza od minut"); }
      ponovo = setTimeout(podigni, 60000);
      return;
    }
    padovi.push(sada);

    let d;
    try {
      d = _spawn("powershell", [...PS_STRAZA, skriptaStraze(process.pid, razmakMs)],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      ponovo = setTimeout(podigni, pauzaPosleSmrti);
      return;
    }
    dete = d;
    poslednjiZnak = Date.now();

    let ostatak = "";
    d.stdout.setEncoding("utf8");
    d.stdout.on("data", (komad) => {
      ostatak += komad;
      let i;
      while ((i = ostatak.indexOf("\n")) >= 0) {
        obradi(ostatak.slice(0, i));
        ostatak = ostatak.slice(i + 1);
      }
      if (ostatak.length > 64 * 1024) ostatak = ""; // red bez kraja se ne gomila
    });

    let gotov = false;
    const kraj = () => {
      if (gotov) return;
      gotov = true;
      if (dete === d) dete = null;
      if (!zaustavljena && !ponovo) ponovo = setTimeout(podigni, pauzaPosleSmrti);
    };
    d.on("error", kraj);
    d.on("exit", kraj);
  };

  // Straža koja ne daje znak života se gasi i diže ponovo.
  const nadzor = setInterval(() => {
    if (dete && Date.now() - poslednjiZnak > rokTisine) {
      log("straža ne javlja znak života - diže se iznova");
      try { dete.kill(); } catch {}
    }
  }, Math.min(5000, rokTisine));
  if (nadzor.unref) nadzor.unref();

  podigni();

  return {
    zaustavi() {
      zaustavljena = true;
      clearInterval(nadzor);
      clearTimeout(ponovo);
      ponovo = null;
      if (dete) { try { dete.kill(); } catch {} }
      dete = null;
    },
    get pid() { return dete ? dete.pid : null; },
  };
}

// ---- Daljinski spisak procesa (panel) ----
//
// Sistemski procesi su označeni kao zaštićeni i ne mogu da se ugase odavde.
function spisakZaPanel() {
  return new Promise((res) => {
    popisProcesa((lista) => {
      const spisak = lista
        .filter((p) => p.ime)
        .map((p) => ({
          pid: p.pid,
          ime: p.ime,
          putanja: p.putanja,
          memorija: p.memorija,
          zasticen: zasticen(p, null),
        }))
        .sort((a, b) => b.memorija - a.memorija);
      res(spisak);
    });
  });
}

// Gasi jedan proces po PID-u. Zaštita se proverava ponovo, jer je spisak
// koji radnik gleda star nekoliko sekundi, a PID je mogao da pripadne drugom
// procesu.
function ugasiProces(pid) {
  return new Promise((res) => {
    const broj = Number(pid);
    if (!Number.isInteger(broj) || broj <= 0) return res({ ok: false, greska: "Neispravan PID" });
    popisProcesa((lista) => {
      const p = lista.find((x) => x.pid === broj);
      if (!p) return res({ ok: false, greska: "Program više ne radi" });
      if (zasticen(p, null)) return res({ ok: false, greska: `„${p.ime}" je sistemski program i ne može da se ugasi odavde` });
      ugasiPid(broj, (err) => {
        if (err) return res({ ok: false, greska: "Windows nije dozvolio gašenje", ime: p.ime });
        res({ ok: true, ime: p.ime });
      });
    });
  });
}

module.exports = {
  snimiStanje, ugasiNoveProcese, popisProcesa, zasticen, zabranjenaPutanja,
  spisakZaPanel, ugasiProces, pokreniStrazu, skriptaStraze,
};
