import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder } from "./_okruzenje.mjs";
// SERVISNI PIN PREZIVLJAVA NADOGRADNJU
//
// podesavanja.json stoji u resources/ pored programa i instaler ga pri
// nadogradnji PREPISUJE fabrickim. Servisni PIN je bas tu - onaj koji cuva
// ulaz u podesavanja i izlaz iz launchera kad server ne radi. Ako se cita samo
// iz tog fajla, svaka nova verzija ga tiho vrati na 1234 na svih trinaest
// masina i niko ne primeti dok neko ne proba.
//
// Ovo se NE MOZE proveriti citanjem koda. Zato ovde tri puta pokrecemo PRAVI
// launcher preko istog korisnickog naloga, izmedju pokretanja prepisujemo
// podesavanja.json onako kako to radi instaler, i svaki put pitamo pravi IPC
// koji PIN prihvata.
//
//   node proba-nadogradnja-pin.mjs
const PORT = 8161;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("nadogradnja-data");
const RADNO = radniFolder("nadogradnja-klijent");
fs.mkdirSync(RADNO, { recursive: true });

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server ----
const server = spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
  env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: "ignore",
});
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status) break; } catch {}
  await cekaj(200);
}
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/computers/bulk", "POST", { count: 1, prefix: "PC-" });
const pc = (await api("/api/computers"))[0];

fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-nadogradnja", version: "1.0.0", main: "main.js" }), "utf8");
const ODGOVOR = path.join(RADNO, "odgovor.json");

// Pokrece pravi launcher, pita ga za svaki PIN sa spiska i vrati sta je rekao.
// userData folder je isti kroz sva tri pokretanja - bas kao pravi nalog na
// racunaru u igraonici, koji nadogradnja ne dira.
async function pitajLauncher(pinovi) {
  try { fs.unlinkSync(ODGOVOR); } catch {}
  fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
// Instaliran launcher drzi podesavanja.json u resources/ pored programa. Bas
// taj folder instaler prepisuje pri nadogradnji, pa ga ovde glumimo - inace bi
// proba citala podesavanja iz izvornog foldera i nista ne bi dokazala.
Object.defineProperty(process, "resourcesPath", { value: ${JSON.stringify(RADNO.replace(/\\/g, "/"))}, configurable: true });
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});

app.whenReady().then(async () => {
  // sacekaj da se prozor napravi i preload ucita
  let w = null;
  for (let i = 0; i < 60 && !w; i++) {
    w = BrowserWindow.getAllWindows()[0];
    if (w && w.webContents.isLoading()) w = null;
    if (!w) await new Promise((r) => setTimeout(r, 300));
  }
  const rez = {};
  for (const pin of ${JSON.stringify(pinovi)}) {
    try {
      rez[pin] = await w.webContents.executeJavaScript(
        "window.crit.proveriServisniPin(" + JSON.stringify(pin) + ").then(r => !!r.ok)"
      );
    } catch (e) { rez[pin] = "GRESKA: " + e.message; }
  }
  fs.writeFileSync(${JSON.stringify(ODGOVOR.replace(/\\/g, "/"))}, JSON.stringify(rez));
  app.exit(0);
});
`, "utf8");

  const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
  const p = spawn(electron, [RADNO], { shell: process.platform === "win32", stdio: "ignore" });
  for (let i = 0; i < 80; i++) { if (fs.existsSync(ODGOVOR)) break; await cekaj(300); }
  try { p.kill(); } catch {}
  await cekaj(500);
  try { return JSON.parse(fs.readFileSync(ODGOVOR, "utf8")); } catch { return null; }
}

const upisiPodesavanja = (pin) =>
  fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: pin }), "utf8");
const zapamcenPin = () => {
  try { return JSON.parse(fs.readFileSync(path.join(RADNO, "config.json"), "utf8")).servisniPin; } catch { return undefined; }
};

// config.json glumi vec podeseni racunar u igraonici
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");

// ---- 1) vlasnik je upisao svoj PIN pri postavljanju ----
upisiPodesavanja("7788");
const a = await pitajLauncher(["7788", "1234"]);
proveri("launcher je odgovorio na pitanje o PIN-u", !!a, JSON.stringify(a));
if (a) {
  proveri("vlasnikov PIN prolazi", a["7788"] === true, JSON.stringify(a));
  proveri("fabricki 1234 ne prolazi", a["1234"] === false, JSON.stringify(a));
}
proveri("PIN je zapamcen van resources foldera", zapamcenPin() === "7788", String(zapamcenPin()));

// ---- 2) NADOGRADNJA: instaler prepisuje podesavanja.json fabrickim ----
upisiPodesavanja("1234");
const b = await pitajLauncher(["7788", "1234"]);
proveri("posle nadogradnje vlasnikov PIN JOS UVEK prolazi", b?.["7788"] === true,
  JSON.stringify(b) + "  <- ovde se PIN tiho vracao na fabricki");
proveri("posle nadogradnje fabricki i dalje ne prolazi", b?.["1234"] === false, JSON.stringify(b));

// ---- 3) vlasnik namerno menja PIN: novi odmah preuzima ----
upisiPodesavanja("9900");
const c = await pitajLauncher(["9900", "7788"]);
proveri("novi PIN odmah vazi", c?.["9900"] === true, JSON.stringify(c));
proveri("stari PIN prestaje da vazi", c?.["7788"] === false, JSON.stringify(c));
proveri("novi PIN je zapamcen umesto starog", zapamcenPin() === "9900", String(zapamcenPin()));

try { server.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(400);
process.exit(pao ? 1 : 0);
