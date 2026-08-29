// Gašenje programa koje je igrač pokrenuo tokom svoje sesije.
//
// Zašto ovako: igre se često pokreću preko svog pokretača (Steam, Riot, Epic),
// pa .exe koji smo mi pokrenuli izađe, a igra nastavi pod sasvim drugim imenom.
// Gašenje "po imenu" tu ne pomaže. Zato pamtimo šta je radilo PRE prijave
// igrača i na kraju sesije gasimo samo ono što se u međuvremenu pojavilo.

const { exec } = require("node:child_process");
const path = require("node:path");

// Ništa iz Windows fascikle se ne dira - tu su sistemski procesi.
// Ovo je glavna kočnica: i ako se lista pokvari, sistem ostaje netaknut.
const ZASTICENE_PUTANJE = [/\\Windows\\/i];

// Programi koje ne gasimo iako su se pojavili tokom sesije.
const ZASTICENA_IMENA = new Set([
  "explorer.exe", "crit launcher.exe", "electron.exe",
  "onedrive.exe", "searchhost.exe", "startmenuexperiencehost.exe",
  "shellexperiencehost.exe", "textinputhost.exe", "runtimebroker.exe",
  "dllhost.exe", "sihost.exe", "ctfmon.exe", "conhost.exe",
  "msmpeng.exe", "nissrv.exe", "securityhealthservice.exe",
  "nvcontainer.exe", "nvidia share.exe", "radeonsoftware.exe",
  "audiodg.exe", "taskhostw.exe", "smartscreen.exe",
]);

// Vraća [{ ime, putanja, pid, memorija }]
function popisProcesa(cb) {
  const ps =
    "Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId,Name,ExecutablePath,WorkingSetSize | ConvertTo-Json -Compress";
  exec(`powershell -NoProfile -NonInteractive -Command "${ps}"`,
    { windowsHide: true, maxBuffer: 12 * 1024 * 1024 },
    (err, out) => {
      if (err) return cb([]);
      try {
        let lista = JSON.parse(out);
        if (!Array.isArray(lista)) lista = [lista];
        cb(lista.map((p) => ({
          pid: p.ProcessId,
          ime: String(p.Name || "").toLowerCase(),
          putanja: String(p.ExecutablePath || ""),
          memorija: Number(p.WorkingSetSize) || 0,
        })));
      } catch { cb([]); }
    });
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
        try { exec(`taskkill /PID ${p.pid} /F /T`, { windowsHide: true }, () => {}); } catch {}
      }
      log(`${suvo ? "[PROBNI RAD] " : ""}programa za gašenje: ${zaGasenje.length}`);
      res(zaGasenje.length);
    });
  });
}

// Igrač skine .exe kroz pregledač i pokrene ga - tako zaobilazi launcher i
// instalira šta hoće. Igre nikad ne rade iz Preuzimanja ni iz Temp fascikle,
// pa je pokretanje odatle siguran znak da nešto nije u redu.
function zabranjenaPutanja(putanja, env) {
  const p = String(putanja || "").toLowerCase();
  if (!p) return false;
  // naša daljinska instalacija ide kroz Temp - nju ne diramo
  if (p.includes("\\crit-install\\")) return false;

  const HOME = String(env.USERPROFILE || "").toLowerCase();
  const TEMP = String(env.TEMP || "").toLowerCase();
  const mesta = [
    HOME && path.join(HOME, "downloads").toLowerCase(),
    TEMP,
    HOME && path.join(HOME, "desktop").toLowerCase(),
  ].filter(Boolean);
  return mesta.some((m) => p.startsWith(m));
}

/**
 * Gasi programe pokrenute iz Preuzimanja/Temp/Desktop dok traje sesija.
 * @param {function} obavesti  poziva se sa imenom programa kad nešto ugasi
 */
function presretniPokretanja({ suvo = false, obavesti = () => {}, log = () => {} } = {}) {
  return new Promise((res) => {
    popisProcesa((lista) => {
      const sporni = lista.filter((p) => zabranjenaPutanja(p.putanja, process.env) && !zasticen(p, null));
      for (const p of sporni) {
        if (suvo) { log(`  [PROBNI RAD] blokirao bih: ${p.ime}  (${p.putanja})`); continue; }
        try { exec(`taskkill /PID ${p.pid} /F /T`, { windowsHide: true }, () => {}); } catch {}
        obavesti(p.ime);
      }
      res(sporni.length);
    });
  });
}

// ---- DALJINSKI TASK MANAGER (osoblje ga gleda iz panela) ----
//
// Radnik sa glavnog racunara vidi sta radi na izabranoj masini i moze da ugasi
// zaglavljenu igru. Ranije je "Task Manager" iz panela otvarao Task Manager NA
// racunaru igraca - radnik bi morao da ustane i ode do te masine, a igrac bi u
// medjuvremenu imao Task Manager pred sobom.
//
// Sistemski procesi se javljaju kao zasticeni i NE mogu da se ugase odavde.
// Ovo je ista kocnica koja vazi i za ciscenje sesije: i ako spisak pukne,
// Windows ostaje netaknut.
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

// Gasi JEDAN proces po PID-u. Pre gasenja se ponovo proverava da nije
// sistemski: spisak koji radnik gleda moze da bude star nekoliko sekundi, a za
// to vreme se PID moze osloboditi i dodeliti necem drugom.
function ugasiProces(pid) {
  return new Promise((res) => {
    const broj = Number(pid);
    if (!Number.isInteger(broj) || broj <= 0) return res({ ok: false, greska: "Neispravan PID" });
    popisProcesa((lista) => {
      const p = lista.find((x) => x.pid === broj);
      if (!p) return res({ ok: false, greska: "Program više ne radi" });
      if (zasticen(p, null)) return res({ ok: false, greska: `„${p.ime}" je sistemski program i ne može da se ugasi odavde` });
      exec(`taskkill /PID ${broj} /F /T`, { windowsHide: true }, (err) => {
        if (err) return res({ ok: false, greska: "Windows nije dozvolio gašenje", ime: p.ime });
        res({ ok: true, ime: p.ime });
      });
    });
  });
}

module.exports = { snimiStanje, ugasiNoveProcese, popisProcesa, zasticen, presretniPokretanja, zabranjenaPutanja, spisakZaPanel, ugasiProces };
