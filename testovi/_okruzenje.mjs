// Zajednicko za sve testove: gde je projekat, gde se prave radne baze i kako
// se podize server. Testovi nikad ne diraju pravu bazu iz server/data.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OVDE = path.dirname(fileURLToPath(import.meta.url));
export const KOREN = path.join(OVDE, "..");

// Suita koja pukne mora da IZADJE, ne da visi. Server koji je podigla drzi
// petlju dogadjaja otvorenom, pa bi obicna greska u testu (npr. promenljiva
// upotrebljena pre nego sto je definisana) izgledala kao zaglavljen test i
// zaustavila celu proveru sistema dok je neko rucno ne prekine.
const pukloJe = (sta) => (e) => {
  console.error(`\n  PAO  suita je pukla (${sta}): ${e?.stack || e}`);
  console.log("\n0/1 proslo");
  process.exit(1);
};
process.on("uncaughtException", pukloJe("greska"));
process.on("unhandledRejection", pukloJe("odbijeno obecanje"));

// Svaka suita dobija svoj folder i svoj port, pa mogu da se puste jedna za drugom.
// Cist radni folder za jednu probu.
//
// Na Windows-u se stari folder ponekad ne da obrisati: Electron iz prethodne
// probe jos drzi fajl, ili OneDrive bas u tom trenutku sinhronizuje. Ranije je
// tu letela EPERM greska i cela proba je pucala pre nego sto je isla i sta da
// proveri - a problem nije bio u programu nego u zaostaloj bravi. Zato se u tom
// slucaju uzima folder sa drugim imenom umesto da se odustane.
export function radniFolder(ime) {
  const osnovni = path.join(OVDE, ".radno", ime);
  for (const p of [osnovni, `${osnovni}-${Date.now()}`]) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      fs.mkdirSync(p, { recursive: true });
      return p;
    } catch (e) {
      if (p !== osnovni) throw e;
    }
  }
}

// GDE JE ELECTRON.
//
// Alati su ga pokretali preko `node_modules/.bin/electron.cmd`, a `.cmd` na
// Windows-u trazi `shell: true`. To donosi tri stvari, sve tri lose:
//
//   1. spawn vraca cmd.exe, ne electron.exe - pa kill() ubije samo omotac, a
//      launcher nastavi da radi i udje u sledecu probu (vidi ugasiLaunchere)
//   2. Node na svaki takav poziv ispise DeprecationWarning, koji onda stoji u
//      ispisu svake probe i navikne coveka da preskace redove
//   3. argumenti se nadovezuju kao tekst umesto da se prosledjuju - putanja sa
//      razmakom bi se raspala
//
// Prava izvrsna datoteka stoji u `electron/dist`, a njeno ime pise u `path.txt`
// koji sam paket ostavlja. Odatle se pokrece bez ijednog omotaca.
export function putanjaElektrona() {
  const dir = path.join(KOREN, "client", "node_modules", "electron");
  try {
    const ime = fs.readFileSync(path.join(dir, "path.txt"), "utf8").trim();
    const puna = path.join(dir, "dist", ime);
    if (fs.existsSync(puna)) return puna;
  } catch {}
  // Rezerva: stari nacin. Bolje da alat radi uz upozorenje nego da ne radi.
  return path.join(KOREN, "client", "node_modules", ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron");
}

// GASI LAUNCHERE KOJE JE PROBA POKRENULA.
//
// Ranije se pokretalo preko cmd.exe omotaca, pa je kill() ubijao samo omotac a
// launcher je nastavljao da radi.
// Dva launchera sa istim tokenom se onda otimaju o vezu: server zatvori stariju,
// a onaj kome je zatvorena se za tri sekunde vrati i zatvori drugu. Proba to
// vidi kao "veza stalno puca" iako je kriva samo proba.
//
// Gasi se ISKLJUCIVO electron.exe pokrenut iz node_modules ovog projekta.
// Na radnom racunaru Electron koriste i pravi programi i njih ovo ne dodiruje.
export function ugasiLaunchere() {
  if (process.platform !== "win32") return 0;
  const nas = path.join(KOREN, "client", "node_modules", "electron").toLowerCase();
  let ugaseno = 0;
  try {
    const izlaz = execFileSync("powershell", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | " +
      "Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8" });
    let spisak = JSON.parse(izlaz || "[]");
    if (!Array.isArray(spisak)) spisak = [spisak];
    for (const p of spisak) {
      if (!p?.CommandLine || !p.CommandLine.toLowerCase().includes(nas)) continue;
      try { process.kill(p.ProcessId); ugaseno++; } catch {}
    }
  } catch {}
  return ugaseno;
}

export async function podigniServer(dataDir, port) {
  process.env.CRIT_DATA_DIR = dataDir;
  process.env.PORT = String(port);
  await import(pathToFileURL(path.join(KOREN, "server", "src", "index.js")).href);
  await new Promise((r) => setTimeout(r, 800));
}

export async function ucitajWebSocket() {
  const m = await import(pathToFileURL(path.join(KOREN, "server", "node_modules", "ws", "wrapper.mjs")).href);
  return m.WebSocket;
}

export function citajIzvor(relativna) {
  return fs.readFileSync(path.join(KOREN, relativna), "utf8");
}

// Jednostavan brojac za ispis rezultata.
export function brojac() {
  let pao = 0, prosao = 0;
  return {
    proveri(naziv, uslov, detalj = "") {
      if (uslov) { prosao++; console.log("  OK   " + naziv); }
      else { pao++; console.log("  PAO  " + naziv + (detalj ? "  -> " + detalj : "")); }
    },
    // IZLAZ SE NE ŽURI.
    //
    // `process.exit` odmah po poslednjoj proveri ume da obori Node na Windows-u:
    // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)". Uzrok su veze
    // koje `fetch` drži otvorenim ka podignutom serveru - gase se u pozadini, a
    // izlaz ih zatekne nasred gašenja.
    //
    // Posledica nije bezazlena: suita ispiše "19/19 proslo" pa vrati izlazni kod
    // 127, i pokretač je vidi kao PALU. Zelena provera koja se prijavljuje kao
    // crvena je gora od nikakve - posle dva takva niko više ne gleda rezultat.
    async kraj() {
      console.log(`\n${prosao}/${prosao + pao} proslo`);
      await new Promise((r) => setTimeout(r, 300));
      process.exit(pao ? 1 : 0);
    },
  };
}

// Klijent ka API-ju sa vec ubacenim tokenom vlasnika.
export async function panelKlijent(base) {
  const token = (await fetch(base + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  }).then((r) => r.json())).token;

  return async function api(p, m = "GET", b) {
    const r = await fetch(base + p, {
      method: m,
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: b ? JSON.stringify(b) : undefined,
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, ...(typeof j === "object" && j ? j : {}) };
  };
}
