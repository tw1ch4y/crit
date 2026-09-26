// Brisanje tragova igrača na kraju sesije: prijave na pregledače i
// pokretače igara, privremeni fajlovi, skorašnji dokumenti, korpa za otpatke.
//
// Brisanje je nepovratno, pa se radi samo kad je ispunjeno sve:
//   0. u korisničkom folderu nema fajla `CRIT-NE-DIRAJ.txt`;
//   1. launcher je instaliran (app.isPackaged);
//   2. launcher nije u --dev ni --no-lock režimu;
//   3. podesavanja.json ima "ciscenjeSesije": true;
//   4. nije prosleđen --suvo (probni rad, samo ispis).
// Uslovi 1 i 2 su u main.js i stižu kao `dozvoljeno`.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

const SUVO = process.argv.includes("--suvo"); // probni rad: ništa se ne briše

// ---- Zaštićen računar ----
//
// Fajl `CRIT-NE-DIRAJ.txt` u korisničkom folderu (%USERPROFILE%) isključuje
// čišćenje bez obzira na način pokretanja. Proverava se po imenu fajla, jer
// podesavanja.json nadogradnja prepisuje.
const STOP_FAJL = "CRIT-NE-DIRAJ.txt";
function racunarJeZasticen(env) {
  const home = (env || process.env).USERPROFILE || "";
  if (!home) return false;
  try { return fs.existsSync(path.join(home, STOP_FAJL)); } catch { return false; }
}

function citajPodesavanja(resourcesPath, execPath, dirname) {
  const mesta = [
    resourcesPath,
    execPath ? path.dirname(execPath) : null,
    dirname,
  ].filter(Boolean); // prazna putanja bi postala relativna i čitala pogrešan fajl
  for (const m of mesta) {
    try { return JSON.parse(fs.readFileSync(path.join(m, "podesavanja.json"), "utf8")); } catch {}
  }
  return {};
}

// Mete brisanja. Profili pregledača se brišu celi (delimično obrisan profil
// ume da zadrži kolačiće prijave), a kod pokretača igara samo fajlovi sa
// nalogom, ne instalacije ni sačuvane igre.
function mete(env) {
  const LOCAL = env.LOCALAPPDATA || "";
  const ROAM = env.APPDATA || "";
  const HOME = env.USERPROFILE || "";
  const PF86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  return [
    // Pregledači
    { opis: "Chrome profil", put: path.join(LOCAL, "Google", "Chrome", "User Data") },
    { opis: "Edge profil", put: path.join(LOCAL, "Microsoft", "Edge", "User Data") },
    { opis: "Firefox profili", put: path.join(ROAM, "Mozilla", "Firefox", "Profiles") },
    { opis: "Opera profil", put: path.join(ROAM, "Opera Software") },
    { opis: "Brave profil", put: path.join(LOCAL, "BraveSoftware") },

    // Pokretači igara (samo prijava)
    { opis: "Steam prijava", put: path.join(PF86, "Steam", "config", "loginusers.vdf") },
    // Noviji Steam čuva zapamćenu prijavu i ovde, šifrovanu za Windows nalog
    // koji svi igrači dele.
    { opis: "Steam zapamćena prijava", put: path.join(LOCAL, "Steam", "local.vdf") },
    { opis: "Epic prijava", put: path.join(LOCAL, "EpicGamesLauncher", "Saved", "Config", "Windows", "GameUserSettings.ini") },
    { opis: "Riot prijava", put: path.join(LOCAL, "Riot Games", "Riot Client", "Data", "RiotGamesPrivateSettings.yaml") },
    { opis: "Battle.net prijava", put: path.join(ROAM, "Battle.net", "Battle.net.config") },
    { opis: "EA prijava", put: path.join(LOCAL, "Electronic Arts", "EA Desktop", "cookiestorage") },
    { opis: "Ubisoft prijava", put: path.join(LOCAL, "Ubisoft Game Launcher", "user.dat") },
    { opis: "Minecraft nalozi", put: path.join(ROAM, ".minecraft", "launcher_accounts.json") },
    { opis: "Minecraft Microsoft prijava", put: path.join(ROAM, ".minecraft", "launcher_msa_credentials.bin") },
    { opis: "Roblox prijava", put: path.join(LOCAL, "Roblox", "LocalStorage") },

    // Discord drži token u Local Storage-u, Spotify automatsku prijavu u `prefs`.
    { opis: "Discord prijava", put: path.join(ROAM, "discord", "Local Storage") },
    { opis: "Discord sesija", put: path.join(ROAM, "discord", "Session Storage") },
    { opis: "Spotify prijava", put: path.join(ROAM, "Spotify", "prefs") },

    // Tragovi rada
    { opis: "Privremeni fajlovi", put: env.TEMP || path.join(LOCAL, "Temp"), sadrzaj: true },
    { opis: "Skorašnji dokumenti", put: path.join(ROAM, "Microsoft", "Windows", "Recent"), sadrzaj: true },

    // Keš šejdera: igre ga prave ponovo, a za mesec dana naraste na nekoliko GB
    // i kad se pokvari pravi trzanje u igri.
    { opis: "DirectX keš šejdera", put: path.join(LOCAL, "D3DSCache"), sadrzaj: true },
    { opis: "NVIDIA keš šejdera", put: path.join(LOCAL, "NVIDIA", "DXCache"), sadrzaj: true },
    { opis: "NVIDIA GL keš", put: path.join(LOCAL, "NVIDIA", "GLCache"), sadrzaj: true },
    { opis: "AMD keš šejdera", put: path.join(LOCAL, "AMD", "DxCache"), sadrzaj: true },

    // Lične fascikle se ne brišu podrazumevano: sa OneDrive-om su u oblaku, pa
    // bi brisanje otišlo i sa naloga. Uključuje se sa "ciscenjeLicnihFascikli".
    { opis: "Preuzimanja", put: path.join(HOME, "Downloads"), sadrzaj: true, licno: true },
    { opis: "Radna površina", put: path.join(HOME, "Desktop"), sadrzaj: true, licno: true },
  ];
}

// Fascikle koje sinhronizuje oblak se ne diraju - brisanje bi se prenelo na nalog.
function uOblaku(put) {
  return /[\\/](OneDrive|Dropbox|Google ?Drive|iCloud)/i.test(put);
}

// Steam pamti poslednji nalog i u registru.
const REG_KOMANDE = [
  ["reg", ["delete", "HKCU\\Software\\Valve\\Steam", "/v", "AutoLoginUser", "/f"]],
  ["reg", ["delete", "HKCU\\Software\\Valve\\Steam", "/v", "RememberPassword", "/f"]],
];

// Korpa za otpatke se prazni zvaničnim putem (Clear-RecycleBin), samo za
// tekućeg korisnika.
const KORPA_KOMANDA = ["powershell", ["-NoProfile", "-NonInteractive", "-Command",
  "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"]];

// Brisanje je asinhrono: profil pregledača ima desetine hiljada fajlova, a
// glavni proces ne sme da stoji. Profili se brišu sa ponovnim pokušajima
// (pregledač koji se gasi još drži fajlove); sadržaj Temp-a bez njih, jer su
// zaključani fajlovi tamo uobičajeni.
async function obrisi(meta, log, licneDozvoljene) {
  const { put, opis, sadrzaj, licno } = meta;
  if (!put || put.length < 8) return; // odbrana od prazne/kratke putanje
  if (licno && !licneDozvoljene) { log(`  preskočeno (nije uključeno): ${opis}`); return; }
  if (uOblaku(put)) { log(`  preskočeno (sinhronizuje se sa oblakom): ${opis}`); return; }
  try { await fsp.access(put); } catch { log(`  preskočeno (ne postoji): ${opis}`); return; }

  if (SUVO) { log(`  [PROBNI RAD] obrisao bih: ${opis}  ->  ${put}`); return; }

  try {
    if (sadrzaj) {
      // Briše sadržaj, fascikla ostaje.
      for (const e of await fsp.readdir(put)) {
        try { await fsp.rm(path.join(put, e), { recursive: true, force: true }); } catch {}
      }
    } else {
      await fsp.rm(put, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
    log(`  obrisano: ${opis}`);
  } catch (e) {
    log(`  nije uspelo (${opis}): ${e.message}`);
  }
}

/**
 * @param {object} o
 * @param {boolean} o.dozvoljeno  false ako je --dev/--no-lock (tada se ne radi ništa)
 * @param {string}  o.resourcesPath
 * @param {string}  o.execPath
 * @param {string}  o.dirname
 * @param {function} o.log
 */
function ocistiSesiju({ dozvoljeno, resourcesPath, execPath, dirname, log = () => {} }) {
  if (racunarJeZasticen(process.env)) {
    log(`čišćenje ODBIJENO: ovaj računar je zaštićen (${STOP_FAJL} u korisničkom folderu)`);
    return { radjeno: false, razlog: "zasticen" };
  }
  if (!dozvoljeno) { log("čišćenje preskočeno: probni/programerski režim"); return { radjeno: false, razlog: "dev" }; }

  const pod = citajPodesavanja(resourcesPath, execPath, dirname);
  if (pod.ciscenjeSesije !== true) {
    log("čišćenje preskočeno: nije uključeno u podesavanja.json");
    return { radjeno: false, razlog: "iskljuceno" };
  }

  log(SUVO ? "čišćenje sesije (PROBNI RAD - ništa se ne briše)" : "čišćenje sesije");
  const licneDozvoljene = pod.ciscenjeLicnihFascikli === true;
  // Odluka da li se čisti vraća se odmah; samo brisanje ide kroz `posao`.
  const posao = (async () => {
    for (const m of mete(process.env)) await obrisi(m, log, licneDozvoljene);
    if (!SUVO) {
      for (const [program, argumenti] of REG_KOMANDE) {
        execFile(program, argumenti, { windowsHide: true, timeout: 10000 }, () => {});
      }
      execFile(KORPA_KOMANDA[0], KORPA_KOMANDA[1], { windowsHide: true, timeout: 60000 },
        () => log("  ispražnjena korpa za otpatke"));
    } else {
      log("  [PROBNI RAD] obrisao bih Steam AutoLoginUser iz registry-ja");
      log("  [PROBNI RAD] ispraznio bih korpu za otpatke");
    }
    log("čišćenje završeno");
  })();
  return { radjeno: !SUVO, probni: SUVO, posao };
}

module.exports = { ocistiSesiju, mete, SUVO, racunarJeZasticen, STOP_FAJL };
