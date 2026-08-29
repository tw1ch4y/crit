import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ugasiLaunchere } from "./_okruzenje.mjs";
// MIS I ZVUK: DA SE STVARNO PROMENI I DA SE STVARNO VRATI
//
// Igrac sme da namesti mis i zvuk sa svog naloga, jer su Windows podesavanja u
// kiosku zakljucana. Dve stvari moraju da rade, i obe se vide samo na pravom
// Windows-u:
//
//   1. promena mora da stigne do sistema, ne samo do ekrana launchera
//   2. pri odjavi se mora vratiti ZATECENO - inace sledeci gost sedne za
//      racunar sa tudjim mis podesavanjima, i tako kroz ceo dan
//
// PAZNJA: ova proba menja podesavanja masine na kojoj se pusta. Zato na pocetku
// snima zatecno stanje i na kraju ga vraca, bez obzira na ishod.
//
//   node proba-podesavanja.mjs
const PORT = 8203;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("podesavanja-data");
const RADNO = radniFolder("podesavanja-klijent");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const winPod = await import(new URL("../client/windows-podesavanja.js", import.meta.url).href)
  .then((m) => m.default || m);

// ---- zatecno stanje masine, da se na kraju vrati ----
const zateceno = await winPod.procitajSve();
console.log(`  (zatečeno na ovom računaru: miš ${zateceno.mis.brzina}, ubrzanje ${zateceno.mis.ubrzanje}, zvuk ${zateceno.zvuk.jacina})`);
const vratiSve = async () => {
  try { await winPod.primeniMis(zateceno.mis); } catch {}
  try { if (zateceno.zvuk.jacina != null) await winPod.primeniZvuk({ jacina: zateceno.zvuk.jacina }); } catch {}
};
process.on("exit", () => {});

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

const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 1000, note: "keš" });

// Namerno drugacije od zatecnog, da se promena jasno vidi.
const CILJ = { brzina: zateceno.mis.brzina === 4 ? 14 : 4, ubrzanje: !zateceno.mis.ubrzanje };

const IZLAZ = path.join(RADNO, "nalaz.json");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234", ciscenjeSesije: false }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});

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
  await new Promise((r) => setTimeout(r, 3500));

  const nalaz = { ekran: await ekran() };

  // Nalog > Mis i zvuk
  await js('(() => { const t = [...document.querySelectorAll(".tab")].find(x => x.dataset.tab === "account"); t.click(); return 1; })()');
  await new Promise((r) => setTimeout(r, 600));
  await js('(() => { const b = document.querySelector(\\'[data-acc-sekcija="podesavanja"]\\'); if (b) b.click(); return 1; })()');
  // citanje sa racunara ide preko PowerShell-a i traje oko sekundu
  await new Promise((r) => setTimeout(r, 4000));

  nalaz.prikazano = await js('(() => { const s = document.querySelector("#podBrzina"); return s ? s.value : "nema klizaca"; })()');

  // Igrac pomera klizac i menja ubrzanje - tacno kao rukom.
  await js('(() => { const s = document.querySelector("#podBrzina"); if (!s) return "nema"; s.value = ${CILJ.brzina};'
    + ' s.dispatchEvent(new Event("change", { bubbles: true })); return "pomereno"; })()');
  await new Promise((r) => setTimeout(r, 3000));
  await js('(() => { const b = document.querySelector("#podUbrzanje"); if (b) b.click(); return 1; })()');
  await new Promise((r) => setTimeout(r, 3000));

  nalaz.posleIzmene = await js('(() => { const s = document.querySelector("#podBrzina");'
    + ' const u = document.querySelector("#podUbrzanje");'
    + ' return JSON.stringify({ brzina: s && s.value, ubrzanjeUgaseno: u && u.classList.contains("ugasen") }); })()');

  try { fs.writeFileSync(${JSON.stringify(IZLAZ.replace(/\\/g, "/"))}, JSON.stringify(nalaz)); } catch {}
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-podesavanja", version: "1.0.0", main: "main.js" }), "utf8");

const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const klijent = spawn(electron, [RADNO], { shell: process.platform === "win32", stdio: "ignore" });
for (let i = 0; i < 160; i++) { if (fs.existsSync(IZLAZ)) break; await cekaj(500); }
const nalaz = (() => { try { return JSON.parse(fs.readFileSync(IZLAZ, "utf8")); } catch { return null; } })();

try {
  proveri("launcher se prijavio", nalaz?.ekran === "desktopScreen", JSON.stringify(nalaz)?.slice(0, 140));
  proveri("odeljak je pročitao pravo stanje računara", String(nalaz?.prikazano) === String(zateceno.mis.brzina),
    `prikazano ${nalaz?.prikazano}, na računaru ${zateceno.mis.brzina}`);

  // ---- 1) PROMENA JE STIGLA DO WINDOWS-A ----
  const uSistemu = await winPod.citajMis();
  proveri("brzina miša je stvarno promenjena u Windows-u", uSistemu.brzina === CILJ.brzina,
    `u sistemu ${uSistemu.brzina}, traženo ${CILJ.brzina}`);
  proveri("ubrzanje je stvarno promenjeno", uSistemu.ubrzanje === CILJ.ubrzanje,
    `u sistemu ${uSistemu.ubrzanje}, traženo ${CILJ.ubrzanje}`);
  const p = (() => { try { return JSON.parse(nalaz.posleIzmene); } catch { return {}; } })();
  proveri("ekran pokazuje isto što i sistem", String(p.brzina) === String(CILJ.brzina), JSON.stringify(p));

  // ---- 2) ODJAVA VRACA ZATECENO ----
  // Server javlja "to_login" kad se sesija zavrsi - isto sto se desi kad igracu
  // istekne vreme ili kad ga radnik odjavi iz panela.
  await api(`/api/computers/${pc.id}/logout`, "POST", {});
  await cekaj(4000);
  const posleOdjave = await winPod.citajMis();
  proveri("odjava vraća brzinu na zatečeno", posleOdjave.brzina === zateceno.mis.brzina,
    `posle odjave ${posleOdjave.brzina}, zatečeno je bilo ${zateceno.mis.brzina}`);
  proveri("odjava vraća i ubrzanje", posleOdjave.ubrzanje === zateceno.mis.ubrzanje,
    `posle odjave ${posleOdjave.ubrzanje}, zatečeno ${zateceno.mis.ubrzanje}`);
} finally {
  // Bez obzira na ishod, masina mora da ostane onakva kakva je bila.
  try { klijent.kill(); } catch {}
  ugasiLaunchere();
  await cekaj(500);
  await vratiSve();
  const kraj = await winPod.procitajSve();
  const isto = kraj.mis.brzina === zateceno.mis.brzina && kraj.mis.ubrzanje === zateceno.mis.ubrzanje;
  console.log(`  (računar vraćen: miš ${kraj.mis.brzina}, ubrzanje ${kraj.mis.ubrzanje}${isto ? "" : "  <- PAŽNJA, nije isto"})`);
  try { server.kill(); } catch {}
}

console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(600);
process.exit(pao ? 1 : 0);
