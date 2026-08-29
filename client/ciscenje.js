// Brisanje tragova igrača kad se sesija završi: prijave na pregledače,
// prijave na Steam/Epic/Riot/Battle.net, privremeni fajlovi, skorašnji dokumenti.
//
// OVO JE NEPOVRATNO. Zato brave, redom kojim se proveravaju - čišćenje se
// izvršava samo ako je ISPUNJENO SVE:
//   0. u korisničkom folderu NEMA fajla `CRIT-NE-DIRAJ.txt`
//      (jedina brava koja ne zavisi od načina pokretanja - vidi niže)
//   1. launcher je INSTALIRAN, ne pokrenut iz izvornog koda (app.isPackaged)
//   2. launcher nije u --dev ni --no-lock režimu
//   3. podesavanja.json ima  "ciscenjeSesije": true
//   4. nije prosleđen --suvo (probni rad, samo ispisuje šta bi obrisao)
//
// Brave 1 i 2 stoje u main.js i dolaze ovamo kao `dozvoljeno`. Brava 0 je ovde
// i namerno je nezavisna: da zaboravljena zastavica u nekom alatu ne može da
// obriše profile na računaru na kom se program piše.

const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");

const SUVO = process.argv.includes("--suvo"); // probni rad: ništa se ne briše

// ---- POSLEDNJA BRAVA: RAČUNAR KOJI SE NIKAD NE ČISTI ----
//
// Sve ostale brave su u main.js i zavise od toga kako je launcher pokrenut.
// Ova ne zavisi ni od čega osim od jednog fajla na disku, i zato postoji.
//
// Ono što se ovde briše je NEPOVRATNO: profili pregledača sa svim prijavama,
// prijave na Steam/Epic/Riot/Battle.net, skorašnji dokumenti, korpa za otpatke.
// Na računaru na kom se program piše to je gubitak koji se ne vraća - a
// dovoljna je jedna zaboravljena zastavica u nekom alatu da se desi.
//
// Zato: napravi prazan fajl `CRIT-NE-DIRAJ.txt` u svom korisničkom folderu
// (`%USERPROFILE%`) i ovaj računar se ne čisti nikad, bez obzira na sve ostalo.
// Na računarima igrača tog fajla nema, pa tamo sve radi kao i do sada.
//
// Provera je namerno po IMENU FAJLA, ne po podešavanju u bazi ili u JSON-u:
// podešavanje se prepisuje pri nadogradnji, a fajl u korisničkom folderu ne
// dira niko.
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

// Fascikle i fajlovi koje brišemo. Namerno ciljamo profile pregledača u celini
// (pola-obrisan profil ume da ostavi kolačiće prijave) i fajlove sa prijavama
// game launchera - ne diramo instalacije ni sačuvane igre.
function mete(env) {
  const LOCAL = env.LOCALAPPDATA || "";
  const ROAM = env.APPDATA || "";
  const HOME = env.USERPROFILE || "";
  const PF86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  return [
    // pregledači
    { opis: "Chrome profil", put: path.join(LOCAL, "Google", "Chrome", "User Data") },
    { opis: "Edge profil", put: path.join(LOCAL, "Microsoft", "Edge", "User Data") },
    { opis: "Firefox profili", put: path.join(ROAM, "Mozilla", "Firefox", "Profiles") },
    { opis: "Opera profil", put: path.join(ROAM, "Opera Software") },
    { opis: "Brave profil", put: path.join(LOCAL, "BraveSoftware") },

    // prijave na game launchere (samo fajl sa nalogom, ne i igre)
    { opis: "Steam prijava", put: path.join(PF86, "Steam", "config", "loginusers.vdf") },
    { opis: "Epic prijava", put: path.join(LOCAL, "EpicGamesLauncher", "Saved", "Config", "Windows", "GameUserSettings.ini") },
    { opis: "Riot prijava", put: path.join(LOCAL, "Riot Games", "Riot Client", "Data", "RiotGamesPrivateSettings.yaml") },
    { opis: "Battle.net prijava", put: path.join(ROAM, "Battle.net", "Battle.net.config") },
    { opis: "EA prijava", put: path.join(LOCAL, "Electronic Arts", "EA Desktop", "cookiestorage") },
    { opis: "Ubisoft prijava", put: path.join(LOCAL, "Ubisoft Game Launcher", "user.dat") },

    // tragovi rada
    { opis: "Privremeni fajlovi", put: env.TEMP || path.join(LOCAL, "Temp"), sadrzaj: true },
    { opis: "Skorašnji dokumenti", put: path.join(ROAM, "Microsoft", "Windows", "Recent"), sadrzaj: true },

    // Keš šejdera. Igre ga same naprave ponovo, pa je brisanje bezbedno, ali
    // se za mesec dana nakupi i po nekoliko GB - a pokvaren keš je čest uzrok
    // trzanja u igri koje izgleda kao kvar na grafičkoj.
    { opis: "DirectX keš šejdera", put: path.join(LOCAL, "D3DSCache"), sadrzaj: true },
    { opis: "NVIDIA keš šejdera", put: path.join(LOCAL, "NVIDIA", "DXCache"), sadrzaj: true },
    { opis: "NVIDIA GL keš", put: path.join(LOCAL, "NVIDIA", "GLCache"), sadrzaj: true },
    { opis: "AMD keš šejdera", put: path.join(LOCAL, "AMD", "DxCache"), sadrzaj: true },

    // Lične fascikle NISU u podrazumevanom čišćenju. Na računarima sa OneDrive-om
    // one su preusmerene u oblak, pa bi brisanje obrisalo fajlove i sa naloga -
    // nepovratno. Uključuju se samo ručno: "ciscenjeLicnihFascikli": true
    { opis: "Preuzimanja", put: path.join(HOME, "Downloads"), sadrzaj: true, licno: true },
    { opis: "Radna površina", put: path.join(HOME, "Desktop"), sadrzaj: true, licno: true },
  ];
}

// Fascikle koje sinhronizuje oblak se ne diraju - brisanje bi se prenelo na nalog.
function uOblaku(put) {
  return /[\\/](OneDrive|Dropbox|Google ?Drive|iCloud)/i.test(put);
}

// Registry vrednosti: Steam pamti poslednji nalog i van fajla
const REG_KOMANDE = [
  'reg delete "HKCU\\Software\\Valve\\Steam" /v AutoLoginUser /f',
  'reg delete "HKCU\\Software\\Valve\\Steam" /v RememberPassword /f',
];

// Korpa za otpatke se ne brise kao fascikla - Windows je cuva po disku i
// direktno brisanje ume da je ostavi u nevaljanom stanju. Ovo je zvanicni put.
// Cisti se samo korpa TEKUCEG korisnika (naloga za igrace).
const KORPA_KOMANDA =
  'powershell -NoProfile -NonInteractive -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"';

function obrisi(meta, log, licneDozvoljene) {
  const { put, opis, sadrzaj, licno } = meta;
  if (!put || put.length < 8) return; // odbrana od prazne/kratke putanje
  if (licno && !licneDozvoljene) { log(`  preskočeno (nije uključeno): ${opis}`); return; }
  if (uOblaku(put)) { log(`  preskočeno (sinhronizuje se sa oblakom): ${opis}`); return; }
  if (!fs.existsSync(put)) { log(`  preskočeno (ne postoji): ${opis}`); return; }

  if (SUVO) { log(`  [PROBNI RAD] obrisao bih: ${opis}  ->  ${put}`); return; }

  try {
    if (sadrzaj) {
      // briše sadržaj, ali ostavlja samu fasciklu
      for (const e of fs.readdirSync(put)) {
        try { fs.rmSync(path.join(put, e), { recursive: true, force: true }); } catch {}
      }
    } else {
      fs.rmSync(put, { recursive: true, force: true });
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
  // Prvo brava koja ne zavisi ni od čega drugog - vidi racunarJeZasticen gore.
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
  for (const m of mete(process.env)) obrisi(m, log, licneDozvoljene);

  if (!SUVO) {
    for (const c of REG_KOMANDE) exec(c, { windowsHide: true }, () => {});
    exec(KORPA_KOMANDA, { windowsHide: true }, () => log("  ispražnjena korpa za otpatke"));
  } else {
    log("  [PROBNI RAD] obrisao bih Steam AutoLoginUser iz registry-ja");
    log("  [PROBNI RAD] ispraznio bih korpu za otpatke");
  }

  log("čišćenje završeno");
  return { radjeno: !SUVO, probni: SUVO };
}

module.exports = { ocistiSesiju, mete, SUVO, racunarJeZasticen, STOP_FAJL };
