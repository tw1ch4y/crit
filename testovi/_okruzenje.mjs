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
// Cist radni folder za jednu probu. Ako Windows ne da da se stari obrise
// (Electron iz prethodne probe drzi fajl, OneDrive sinhronizuje), uzima se folder
// sa drugim imenom.
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

// Putanja do electron.exe iz `electron/dist` (ime pise u `path.txt`).
// Pokretanje preko `node_modules/.bin/electron.cmd` trazi `shell: true`: kill()
// tada gasi samo cmd.exe, Node ispisuje DeprecationWarning, a argumenti sa
// razmakom se raspadaju.
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

// Gasi launchere koje je proba pokrenula: iskljucivo electron.exe iz
// node_modules ovog projekta, ne i druge Electron programe na racunaru. Zaostao
// launcher sa istim tokenom bi otimao vezu sledecoj probi.
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
    // Izlaz se odlaže. `process.exit` odmah posle poslednje provere ume da obori
    // Node na Windows-u ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)")
    // jer se veze koje drži `fetch` još gase; suita tada vrati kod 127 iako je sve
    // prošlo.
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
