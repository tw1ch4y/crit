import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ugasiLaunchere, putanjaElektrona } from "./_okruzenje.mjs";
// OTKLJUCAVANJE NE SME DA UGASI LAUNCHER
//
// Osoblje ima dve prece: Ctrl+Alt+U otkljucava racunar, a Ctrl+Alt+Shift+Q
// izlazi iz launchera. Obe traze PIN, i to su dva razlicita posla.
//
// Zamka: cim se otvori prozor za admin izlaz, launcher upamti "izlazim". Ako se
// racunar u tom trenutku otkljuca BILO KAKO - radnik sa panela, "Otkljucaj sve",
// ili sam igrac ukuca PIN na zakljucanom ekranu - launcher bi se UGASIO umesto
// da se otkljuca. Masina bi ostala bez launchera do sledeceg paljenja.
//
// A to nije redak splet okolnosti nego svakodnevni: na zakljucanom ekranu stoje
// DVA polja za PIN, radnik ukuca u ono koje mu je blize.
//
// Ovo se ne moze proveriti iz koda - trazi pravi Electron i pravu poruku sa
// servera. Zato ovde launcher zaista mora da PREZIVI otkljucavanje.
//
//   node proba-admin-izlaz.mjs
const PORT = 8205;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("admin-izlaz-data");
const RADNO = radniFolder("admin-izlaz-klijent");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
  env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: "ignore",
});
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status) break; } catch {}
  await cekaj(200);
}
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 1000, note: "keš" });

const IZLAZ = path.join(RADNO, "nalaz.jsonl");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "4321" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});

const IZLAZ = ${JSON.stringify(IZLAZ.replace(/\\/g, "/"))};
const upisi = (o) => { try { fs.appendFileSync(IZLAZ, JSON.stringify(o) + "\\n"); } catch {} };
// Ako launcher krene da se gasi, to je BAS ono sto se proverava - zapisi pre
// nego sto nestane, inace bi proba samo istekla bez objasnjenja.
app.on("before-quit", () => upisi({ korak: "GASI-SE" }));

app.whenReady().then(async () => {
  let w = null;
  for (let i = 0; i < 80 && !w; i++) {
    w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !(x.webContents.getURL() || "").includes("overlay"));
    if (w && w.webContents.isLoading()) w = null;
    if (!w) await new Promise((r) => setTimeout(r, 300));
  }
  const js = (izraz) => w.webContents.executeJavaScript(izraz).catch((e) => "GRESKA: " + e.message);
  const ekran = () => js('[...document.querySelectorAll(".screen")].find(s => s.classList.contains("active"))?.id');

  for (let i = 0; i < 60; i++) { if ((await ekran()) === "loginScreen") break; await new Promise((r) => setTimeout(r, 500)); }
  await js('(() => { document.querySelector("#pUser").value = "mile"; document.querySelector("#pPass").value = "mile1234";'
    + ' document.querySelector("#loginForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); return 1; })()');
  await new Promise((r) => setTimeout(r, 3000));
  upisi({ korak: "prijava", ekran: await ekran() });

  // Radnik zakljuca racunar sa panela.
  fs.writeFileSync(IZLAZ + ".zakljucaj", "1");
  for (let i = 0; i < 60; i++) { if ((await ekran()) === "lockedScreen") break; await new Promise((r) => setTimeout(r, 300)); }
  upisi({ korak: "zakljucano", ekran: await ekran() });

  // Radnik pritisne Ctrl+Alt+Shift+Q - isto sto radi i preca. Prozor za PIN se
  // otvori, ali radnik ga ne dovrsi.
  await js('(() => { openPin("Admin izlaz iz launchera", true); return 1; })()');
  await new Promise((r) => setTimeout(r, 400));
  upisi({ korak: "pin-otvoren", pending: await js("S.pendingExit === true") });

  // ...pa se predomisli i otkljuca sa panela.
  fs.writeFileSync(IZLAZ + ".otkljucaj", "1");
  await new Promise((r) => setTimeout(r, 3000));

  // Ako je launcher jos ziv, ovo ce se upisati. Ako se ugasio, upisace se
  // "GASI-SE" iz before-quit i ovoga nece biti.
  upisi({ korak: "posle-otkljucavanja", ekran: await ekran(), ziv: true });

  // Pravi admin izlaz i dalje mora da radi: PIN kroz prozor za PIN.
  //
  // Kuca se PIN IZ PANELA (1234), ne lokalni servisni (4321). Dok server radi,
  // admin izlaz se proverava kod njega; lokalni servisni je rezerva za slucaj
  // kad servera nema - inace bi osoblje ostalo zakljucano na svih 13 masina.
  await js('(() => { openPin("Admin izlaz iz launchera", true); document.querySelector("#pinInput").value = "1234";'
    + ' document.querySelector("#pinOk").click(); return 1; })()');
  await new Promise((r) => setTimeout(r, 2500));
  upisi({ korak: "posle-pravog-izlaza", jos: true });
  app.exit(0);
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-admin-izlaz", version: "1.0.0", main: "main.js" }), "utf8");

const electron = putanjaElektrona();
const klijent = spawn(electron, [RADNO], { stdio: "ignore" });

const gotov = () => { try { const t = fs.readFileSync(IZLAZ, "utf8"); return t.includes("posle-pravog-izlaza") || t.includes("GASI-SE"); } catch { return false; } };
for (let i = 0; i < 300; i++) {
  if (fs.existsSync(IZLAZ + ".zakljucaj")) { await api(`/api/computers/${pc.id}/lock`, "POST"); fs.rmSync(IZLAZ + ".zakljucaj", { force: true }); }
  if (fs.existsSync(IZLAZ + ".otkljucaj")) { await api(`/api/computers/${pc.id}/unlock`, "POST"); fs.rmSync(IZLAZ + ".otkljucaj", { force: true }); }
  if (gotov()) break;
  await cekaj(300);
}
await cekaj(800);
try { klijent.kill(); } catch {}
ugasiLaunchere();

const redovi = (() => {
  try { return fs.readFileSync(IZLAZ, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
})();
const korak = (ime) => redovi.find((r) => r.korak === ime);
const redosled = redovi.map((r) => r.korak);

proveri("launcher se prijavio", korak("prijava")?.ekran === "desktopScreen", JSON.stringify(korak("prijava")));
proveri("racunar je zakljucan sa panela", korak("zakljucano")?.ekran === "lockedScreen", JSON.stringify(korak("zakljucano")));
proveri("prozor za admin izlaz je otvoren", korak("pin-otvoren")?.pending === true, JSON.stringify(korak("pin-otvoren")));

// ---- OVDE JE CELA POENTA ----
const ugasioSePreRano = redosled.indexOf("GASI-SE") > -1
  && redosled.indexOf("GASI-SE") < redosled.indexOf("posle-pravog-izlaza");
proveri("OTKLJUCAVANJE NIJE UGASILO LAUNCHER", !!korak("posle-otkljucavanja") && !ugasioSePreRano,
  "launcher se ugasio na obicno otkljucavanje - masina ostaje bez launchera do sledeceg paljenja");
proveri("posle otkljucavanja se ceka prijava", korak("posle-otkljucavanja")?.ekran === "loginScreen",
  JSON.stringify(korak("posle-otkljucavanja")));

// ...ali pravi admin izlaz mora da radi, inace bi zastita bila prestroga.
proveri("pravi admin izlaz i dalje gasi launcher", redosled.includes("GASI-SE"),
  "PIN kroz prozor za admin izlaz mora da izadje iz kioska");

try { server.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
