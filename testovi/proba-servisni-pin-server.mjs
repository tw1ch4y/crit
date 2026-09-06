import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ugasiLaunchere, putanjaElektrona } from "./_okruzenje.mjs";
// SERVISNI PIN SE UPISUJE JEDNOM, U PANELU, I STIZE NA SVE RACUNARE
//
// Taj PIN cuva ulaz u podesavanja launchera i izlaz iz kioska KAD SERVER NE
// RADI. Ranije se upisivao rucno, u podesavanja.json pored programa, na svakoj
// masini posebno. To nije bila nezgodna procedura nego los dizajn: PIN koji se
// menja na trinaest mesta ne promeni se nigde. Ostajao je fabricki 1234 - bas
// onaj kojim igrac koji iscupa mrezni kabl preusmerava racunar na svoj server.
//
// Ovde se proverava ono sto se iz koda ne vidi: da PIN sa servera stvarno
// STIGNE do pravog launchera, da ga on ZAPAMTI preko restarta, da radi KAD
// SERVERA NEMA, i - najvaznije - da fabricki 1234 posle toga PRESTANE da vazi.
//
// Uz to i obrnuta strana: zastita ne sme da bude prestroga. Pogresan potez ovde
// zakljucava osoblje na svih trinaest masina bez nacina da izadje.
//
//   node proba-servisni-pin-server.mjs
const PORT = 8206;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("spin-server-data");
const RADNO = radniFolder("spin-server-klijent");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const digniServer = () => spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
  env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: "ignore",
});
const cekajServer = async () => {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status) return true; } catch {}
    await cekaj(200);
  }
  return false;
};
let server = digniServer();
await cekajServer();
const prijava = async () => (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
let token = await prijava();
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const pc = (await api("/api/computers"))[0];
const NOV_PIN = "7431";

// Na masini stoji FABRICKI PIN - tacno stanje u kom se igraonice i zateknu.
const IZLAZ = path.join(RADNO, "nalaz.jsonl");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, ipcMain } = require("electron");
const fs = require("fs");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});

const IZLAZ = ${JSON.stringify(IZLAZ.replace(/\\/g, "/"))};
const upisi = (o) => { try { fs.appendFileSync(IZLAZ, JSON.stringify(o) + "\\n"); } catch {} };

// PIN se proverava kroz ISTI most kroz koji ga proverava i ekran launchera.
const pitaj = (pin) => ipcMain._invokeHandlers.get("proveri-servisni-pin")(null, pin);

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 3500)); // pusti da se poveze i primi welcome
  const faza = process.env.CRIT_FAZA || "prva";

  if (faza === "prva") {
    upisi({ korak: "pocetak", fabricki: (await pitaj("1234")).ok, nov: (await pitaj(${JSON.stringify(NOV_PIN)})).ok });
    // Vlasnik upisuje PIN u panelu - proba to radi spolja, pa cekamo.
    fs.writeFileSync(IZLAZ + ".postavi", "1");
    for (let i = 0; i < 100; i++) {
      if (!fs.existsSync(IZLAZ + ".postavi")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 1500)); // da poruka stigne i upise se
    upisi({ korak: "posle-postavljanja", fabricki: (await pitaj("1234")).ok, nov: (await pitaj(${JSON.stringify(NOV_PIN)})).ok });
  } else {
    // Drugi zivot launchera: server je UGASEN, a PIN mora i dalje da radi.
    upisi({ korak: "bez-servera", fabricki: (await pitaj("1234")).ok, nov: (await pitaj(${JSON.stringify(NOV_PIN)})).ok,
      pogresan: (await pitaj("0000")).ok, prazan: (await pitaj("")).ok });
  }
  app.exit(0);
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-spin", version: "1.0.0", main: "main.js" }), "utf8");

const electron = putanjaElektrona();

// ---- prvi zivot: server radi, vlasnik upisuje PIN ----
const k1 = spawn(electron, [RADNO], { stdio: "ignore", env: { ...process.env, CRIT_FAZA: "prva" } });
for (let i = 0; i < 250; i++) {
  if (fs.existsSync(IZLAZ + ".postavi")) {
    await api("/api/settings", "POST", { servisniPin: NOV_PIN });
    fs.rmSync(IZLAZ + ".postavi", { force: true });
  }
  try { if (fs.readFileSync(IZLAZ, "utf8").includes("posle-postavljanja")) break; } catch {}
  await cekaj(300);
}
await cekaj(600);
try { k1.kill(); } catch {}
ugasiLaunchere();
await cekaj(800);

// ---- server GINE, pa launcher krece iznova ----
try { server.kill(); } catch {}
await cekaj(1200);
const k2 = spawn(electron, [RADNO], { stdio: "ignore", env: { ...process.env, CRIT_FAZA: "druga" } });
for (let i = 0; i < 200; i++) {
  try { if (fs.readFileSync(IZLAZ, "utf8").includes("bez-servera")) break; } catch {}
  await cekaj(300);
}
await cekaj(600);
try { k2.kill(); } catch {}
ugasiLaunchere();

const redovi = (() => {
  try { return fs.readFileSync(IZLAZ, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
})();
const korak = (ime) => redovi.find((r) => r.korak === ime);

// ---- 1) pocetno stanje: fabricki prolazi, nov ne ----
const a = korak("pocetak");
proveri("na pocetku vazi fabricki PIN", a?.fabricki === true, JSON.stringify(a));
proveri("nov PIN jos ne vazi", a?.nov === false, JSON.stringify(a));

// ---- 2) VLASNIK UPISE PIN U PANELU - JEDNOM ----
const b = korak("posle-postavljanja");
proveri("PIN sa servera odmah vazi na masini", b?.nov === true,
  "nije stigao do launchera - vlasnik bi i dalje morao da ga kuca po masinama");
proveri("FABRICKI PRESTAJE DA VAZI", b?.fabricki === false,
  "dok 1234 radi, igrac koji iscupa kabl preusmerava racunar na svoj server");

// ---- 3) PAMTI SE, I RADI KAD SERVERA NEMA ----
// To je jedini trenutak kad ovaj PIN i treba: kad server ne odgovara.
const c = korak("bez-servera");
proveri("PIN prezivljava restart launchera", c?.nov === true, JSON.stringify(c));
proveri("radi i kad SERVER NE RADI", c?.nov === true,
  "bas tada i sluzi - inace bi osoblje ostalo zakljucano na svih 13 masina");
proveri("fabricki ni tada ne prolazi", c?.fabricki === false, JSON.stringify(c));
proveri("pogresan PIN ne prolazi", c?.pogresan === false, JSON.stringify(c));
proveri("prazan PIN ne prolazi", c?.prazan === false, JSON.stringify(c));

// ---- 4) sam PIN ne sme da se nadje na masini u citljivom obliku ----
const cfg = fs.readFileSync(path.join(RADNO, "config.json"), "utf8");
proveri("PIN se cuva kao hes, ne kao tekst", !cfg.includes(NOV_PIN),
  "inace ga igrac procita iz svog AppData foldera");
proveri("hes i so su zapamceni", /servisniPinHes/.test(cfg) && /"so"/.test(cfg), cfg.slice(0, 200));

try { server.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
