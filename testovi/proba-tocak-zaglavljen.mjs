import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ugasiLaunchere } from "./_okruzenje.mjs";
// TOCAK KOJI SE ZAVRTEO A ODGOVOR NIJE STIGAO
//
// Klik na "Zavrti" odmah postavlja da vrtnja traje, a ODGOVOR SE CEKA SA
// SERVERA. Dok vrtnja traje, launcher NAMERNO ne dira prikazano stanje kredita
// - server nagradu doda odmah, a tocak se vrti pet sekundi, pa bi se brojka
// promenila pre nego sto igrac sazna sta je dobio.
//
// Zamka: ako odgovor NIKAD ne stigne - veza pukne u tih pet sekundi, server se
// restartuje, ruter se resetuje - vrtnja ostaje "u toku" ZAUVEK. Od tog trenutka
// se svako novo stanje kredita odbacuje, pa HUD stoji zamrznut dok naplata tece
// dalje. Igrac gleda "1200 din, ostalo 10:00" dok mu vreme stvarno curi, i
// racunar se zakljuca bez ijednog upozorenja.
//
// Ovo se ne moze proveriti iz koda: trazi pravi Electron, pravi klik i pravu
// puknutu vezu. Zato ovde server GINE pre klika, pa se gleda da li se launcher
// sam izvuce.
//
//   node proba-tocak-zaglavljen.mjs
const PORT = 8204;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("tocak-zaglavljen-data");
const RADNO = radniFolder("tocak-zaglavljen-klijent");

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

// Tocak upaljen, prag nula - da igrac sme da vrti odmah.
await api("/api/tocak", "POST", { ukljucen: true, prag: 0 });
const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 1000, note: "keš" });

// Launcher salje ono sto zabelezi u ovaj fajl; svaki korak je zaseban red, da
// se vidi dokle je stigao i ako pukne na pola.
const IZLAZ = path.join(RADNO, "nalaz.jsonl");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
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
  upisi({ korak: "prijava", ekran: await ekran(), hud: await js('(document.querySelector("#hudBal")||{}).textContent||""') });

  // Do tocka se ide onako kako ide i igrac: Nalog > Nagrade > Zavrti tocak.
  await js('(() => { const t = [...document.querySelectorAll(".tab")].find(x => x.dataset.tab === "account"); t.click(); return 1; })()');
  await new Promise((r) => setTimeout(r, 700));
  await js('(() => { const b = document.querySelector(\\'[data-acc-sekcija="nagrade"]\\'); if (b) b.click(); return 1; })()');
  await new Promise((r) => setTimeout(r, 700));
  await js('(() => { const b = document.querySelector("#nagZavrti"); if (b) b.click(); return 1; })()');
  await new Promise((r) => setTimeout(r, 900));
  upisi({ korak: "tocak-otvoren", imaSpin: await js('!!document.querySelector("#tocakSpin")') });

  // ---- SERVER GINE, PA SE KLIKNE ----
  // Klik tada ode u mrtvu vezu: launcher upali "vrtnja traje", a odgovor nikad
  // ne stize. Cekamo da server nestane pa tek onda kliknemo, da ne zavisi od
  // srece u milisekundama.
  fs.writeFileSync(IZLAZ + ".ubij", "1");
  for (let i = 0; i < 100; i++) {
    if (!fs.existsSync(IZLAZ + ".ubij")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await js('(() => { const b = document.querySelector("#tocakSpin"); if (b) b.click(); return 1; })()');
  upisi({ korak: "kliknuto", vrti: await js("S.tocakVrti === true") });

  // Koliko launcheru treba da se sam izvuce.
  let oslobodjenoZa = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await js("S.tocakVrti === false")) { oslobodjenoZa = (i + 1) * 500; break; }
  }
  upisi({ korak: "oslobadjanje", oslobodjenoZa });

  // ---- SERVER SE VRACA ----
  fs.writeFileSync(IZLAZ + ".digni", "1");
  for (let i = 0; i < 200; i++) {
    if (await js("S.wsOk === true")) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, 1500));
  upisi({ korak: "vraceno", wsOk: await js("S.wsOk === true"), vrti: await js("S.tocakVrti === true") });

  // Dopuna sa servera MORA da stigne do HUD-a. Ovo je prava posledica: dok je
  // vrtnja "u toku", svako novo stanje se odbacuje i brojka stoji zamrznuta.
  fs.writeFileSync(IZLAZ + ".dopuni", "1");
  await new Promise((r) => setTimeout(r, 4000));
  upisi({ korak: "posle-dopune",
    balance: await js("S.balance"),
    hud: await js('(document.querySelector("#hudBal")||{}).textContent||""') });

  app.exit(0);
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-tocak-zaglavljen", version: "1.0.0", main: "main.js" }), "utf8");

const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const klijent = spawn(electron, [RADNO], { shell: process.platform === "win32", stdio: "ignore" });

// Launcher trazi gasenje/dizanje servera preko fajlova - on sam to ne moze.
const gotov = () => fs.existsSync(IZLAZ) && fs.readFileSync(IZLAZ, "utf8").includes("posle-dopune");
for (let i = 0; i < 400; i++) {
  if (fs.existsSync(IZLAZ + ".ubij")) {
    try { server.kill(); } catch {}
    await cekaj(1200);
    fs.rmSync(IZLAZ + ".ubij", { force: true });
  }
  if (fs.existsSync(IZLAZ + ".digni")) {
    server = digniServer();
    await cekajServer();
    token = await prijava();
    fs.rmSync(IZLAZ + ".digni", { force: true });
  }
  if (fs.existsSync(IZLAZ + ".dopuni")) {
    await api(`/api/players/${mile.id}/topup`, "POST", { amount: 500, note: "posle prekida" });
    fs.rmSync(IZLAZ + ".dopuni", { force: true });
  }
  if (gotov()) break;
  await cekaj(300);
}
await cekaj(500);
try { klijent.kill(); } catch {}
ugasiLaunchere();

const redovi = (() => {
  try { return fs.readFileSync(IZLAZ, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
})();
const korak = (ime) => redovi.find((r) => r.korak === ime);

proveri("launcher se prijavio", korak("prijava")?.ekran === "desktopScreen", JSON.stringify(korak("prijava")));
proveri("točak se otvorio", korak("tocak-otvoren")?.imaSpin === true, JSON.stringify(korak("tocak-otvoren")));
proveri("klik je upalio vrtnju", korak("kliknuto")?.vrti === true,
  "ako nije, proba ne meri ono zbog cega postoji");

// ---- OVDE JE CELA POENTA ----
const osl = korak("oslobadjanje");
proveri("launcher se SAM izvuče iz zaglavljene vrtnje", osl?.oslobodjenoZa != null,
  "vrtnja je ostala 'u toku' i posle 30 s - od tog trenutka se svako novo stanje kredita odbacuje");
if (osl?.oslobodjenoZa != null) {
  proveri("izvuče se u razumnom roku (do 20 s)", osl.oslobodjenoZa <= 20000, `${osl.oslobodjenoZa} ms`);
}

proveri("veza se vratila", korak("vraceno")?.wsOk === true, JSON.stringify(korak("vraceno")));
proveri("vrtnja više ne stoji upaljena", korak("vraceno")?.vrti === false, JSON.stringify(korak("vraceno")));

// Prag je 1400, ne tacno 1500: igrac sve vreme IGRA, pa mu naplata usput skine
// koji dinar. Zamrznut HUD bi ostao na oko 1000, pa je razlika ocigledna.
const posle = korak("posle-dopune");
proveri("dopuna sa servera STIŽE do kredita", posle && Number(posle.balance) > 1400,
  `stanje u launcheru ${posle?.balance} (očekivano oko 1500, zamrznuto bi bilo oko 1000) - HUD stoji zamrznut dok naplata teče`);
proveri("HUD pokazuje novo stanje", /1[.,]?500/.test(posle?.hud || ""), posle?.hud);

try { server.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
