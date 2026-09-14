import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { KOREN, radniFolder, putanjaElektrona, brojac } from "./_okruzenje.mjs";
// SERVER SE UGASI USRED IGRANJA - PRAVI LAUNCHER, PRAVI SERVER
//
// Račun je proveren bez Electrona (test-lokalna-sesija) i sa pravim serverom
// bez launchera (test-offline-naplata). Ovde je sve zajedno: pravi main.js i
// pravi ekran, server u posebnom procesu koji se UBIJE - kao kad se glavni
// računar ugasi ili neko zatvori prozor servera.
//
//   1. igrač igra, server nestane: ostaje na radnoj površini, sat ide dalje
//   2. odjava bez servera prolazi; kad se server vrati, naplati se odigrano
//   3. kredit istekne bez servera: računar se zaključa, osoblje ga otključa
//      servisnim PIN-om, a server posle povratka ne zaključava ponovo
//   4. launcher se ugasi i ponovo pokrene dok server ćuti: sesija se nastavlja
//      iz zapisa, a posle povratka servera ide dalje bez prijave
//
// Launcher radi sa --no-lock: ne dira politike, napajanje ni tragove sesije.
// Stanje ekrana se čita kroz mali omotač oko pravog main.js.
//
//   node proba-bez-servera.mjs
const require = createRequire(import.meta.url);
const { ucitajPotpisano } = require("../client/lokalna-sesija.js");
const { proveri, kraj } = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
// Proces ubijen spolja na Windows-u ostaje sa exitCode null i popunjenim
// signalCode - samo exitCode bi rekao da i dalje radi.
const radi = (p) => !!p && p.exitCode === null && p.signalCode === null;

const PORT = 8217;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("bez-servera-data");
const RADNO = radniFolder("bez-servera-klijent");
const STANJE = path.join(RADNO, "stanje.json");
const KOMANDA = path.join(RADNO, "komanda.js");
const SESIJA = path.join(RADNO, "sesija.json");

// ---- server u svom procesu, da može da se ubije ----
let server = null;
async function podigniServer() {
  server = spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
    env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (r.status) return true;
    } catch {}
    await cekaj(250);
  }
  return false;
}
async function ubijServer() {
  const s = server;
  if (!radi(s)) return;
  const izasao = new Promise((r) => s.once("exit", r));
  try { s.kill(); } catch {}
  await Promise.race([izasao, cekaj(4000)]);
}
let token = null;
async function api(p, m = "GET", b) {
  if (!token) {
    token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
  }
  const r = await fetch(BASE + p, { method: m, headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

// ---- launcher ----
let klijent = null;
function pokreniLauncher() {
  klijent = spawn(putanjaElektrona(), [RADNO], { stdio: "ignore" });
}
async function ugasiLauncher() {
  const k = klijent;
  if (!radi(k)) return;
  const izasao = new Promise((r) => k.once("exit", r));
  try { k.kill(); } catch {}
  await Promise.race([izasao, cekaj(5000)]);
}
const stanje = () => { try { return JSON.parse(fs.readFileSync(STANJE, "utf8")); } catch { return {}; } };
async function sacekaj(uslov, ms = 20000) {
  const doKad = Date.now() + ms;
  while (Date.now() < doKad) { const s = stanje(); if (uslov(s)) return s; await cekaj(200); }
  return stanje();
}
function izvrsi(js) { fs.writeFileSync(KOMANDA, js, "utf8"); }
const zapisSesije = (pcToken) => ucitajPotpisano(SESIJA, pcToken).podaci;

console.log("PROBA: SERVER SE UGASI USRED IGRANJA\n");
let greska = null;
try {
  // ---- priprema ----
  proveri("server se diže", await podigniServer());
  await api("/api/settings", "POST", { ratePerHour: 3600 }); // dinar u sekundi
  for (const [u, kredit] of [["mile", 3000], ["kratki", 25]]) {
    await api("/api/players", "POST", { username: u, password: u + "1234", displayName: u });
    const p = (await api("/api/players")).find((x) => x.username === u);
    await api(`/api/players/${p.id}/topup`, "POST", { amount: kredit, note: "keš" });
  }
  const pc = (await api("/api/computers"))[0];
  const kredit = async (u) => Number((await api("/api/players")).find((p) => p.username === u).balance);
  const logovi = async () => JSON.stringify(await api("/api/logs?limit=300"));

  fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
  fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-bez-servera", version: "1.0.0", main: "main.js" }), "utf8");
  fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const RADNO = ${JSON.stringify(RADNO)};
app.setPath("userData", RADNO);
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js"))});
const KOMANDA = ${JSON.stringify(KOMANDA)};
const STANJE = ${JSON.stringify(STANJE)};
const CITAJ = 'JSON.stringify({ ekran: (document.querySelector(".screen.active") || {}).id || null,' +
  ' igrac: (typeof S !== "undefined" && S.player) ? S.player.username : null,' +
  ' preostalo: typeof S !== "undefined" ? S.remaining : null, wsOk: typeof S !== "undefined" ? S.wsOk : null,' +
  ' traka: (document.querySelector("#sbNet .sb-txt") || {}).textContent || null })';
app.whenReady().then(() => {
  setInterval(async () => {
    const w = BrowserWindow.getAllWindows().find((x) => { try { return x.webContents.getURL().endsWith("/index.html"); } catch { return false; } });
    if (!w) return;
    try {
      if (fs.existsSync(KOMANDA)) { const js = fs.readFileSync(KOMANDA, "utf8"); fs.unlinkSync(KOMANDA); await w.webContents.executeJavaScript(js); }
      const s = await w.webContents.executeJavaScript(CITAJ);
      fs.writeFileSync(STANJE + ".novo", s); fs.renameSync(STANJE + ".novo", STANJE);
    } catch {}
  }, 250);
});
`, "utf8");

  const prijavi = (u) => izvrsi(`document.querySelector("#pUser").value = ${JSON.stringify(u)};
    document.querySelector("#pPass").value = ${JSON.stringify(u + "1234")};
    document.querySelector("#loginForm").requestSubmit();`);

  pokreniLauncher();
  let s = await sacekaj((x) => x.ekran === "loginScreen", 30000);
  proveri("launcher se povezao i čeka prijavu", s.ekran === "loginScreen", JSON.stringify(s));

  // ---- 1) SERVER NESTANE USRED IGRANJA ----
  prijavi("mile");
  s = await sacekaj((x) => x.ekran === "desktopScreen" && x.igrac === "mile");
  proveri("igrač je prijavljen", s.igrac === "mile", JSON.stringify(s));
  await cekaj(6000);
  const kPre = await kredit("mile");

  await ubijServer();
  const ubijenU = Date.now();
  s = await sacekaj((x) => x.wsOk === false, 8000);
  await cekaj(1500);
  s = stanje();
  proveri("igrač ostaje na radnoj površini", s.ekran === "desktopScreen" && s.igrac === "mile", JSON.stringify(s));
  proveri("donja traka kaže da igra dalje bez servera", s.traka === "Bez servera: igraš dalje", String(s.traka));
  const p1 = s.preostalo;
  await cekaj(5000);
  const p2 = stanje().preostalo;
  proveri("sat ide dalje i bez servera", p1 - p2 >= 3 && p1 - p2 <= 7, `${p1} -> ${p2}`);
  const z1 = zapisSesije(pc.token);
  proveri("sesija je zapisana na disku, potpisana", !!z1 && z1.nepotvrdjeno === true && !z1.kraj, JSON.stringify(z1));

  // ---- 2) ODJAVA BEZ SERVERA, PA POVRATAK ----
  izvrsi('window.crit.toServer({ t: "logout" })');
  s = await sacekaj((x) => x.ekran === "connScreen" && !x.igrac, 8000);
  const odjavljenU = Date.now();
  proveri("odjava bez servera prolazi", s.ekran === "connScreen" && !s.igrac, JSON.stringify(s));
  proveri("i ulazi u zapis kao kraj", zapisSesije(pc.token)?.kraj === "odjava");

  proveri("server se ponovo diže", await podigniServer());
  s = await sacekaj((x) => x.ekran === "loginScreen" && x.wsOk === true, 20000);
  proveri("posle povratka računar čeka sledećeg igrača", s.ekran === "loginScreen", JSON.stringify(s));
  await cekaj(800);
  const naplaceno = kPre - (await kredit("mile"));
  const bezServera = (odjavljenU - ubijenU) / 1000;
  proveri("naplaćeno je odigrano bez servera", naplaceno >= bezServera - 3 && naplaceno <= bezServera + 8,
    `naplaćeno ${naplaceno.toFixed(1)}, bez servera ${bezServera.toFixed(1)} s (+ do 5 s pre gašenja)`);
  proveri("zapis je obrisan posle potvrde", !fs.existsSync(SESIJA));
  proveri("u logovima piše da je igrao bez servera", (await logovi()).includes("offline_naplata"));

  // ---- 3) KREDIT ISTEKNE BEZ SERVERA ----
  prijavi("kratki");
  s = await sacekaj((x) => x.ekran === "desktopScreen" && x.igrac === "kratki");
  proveri("igrač sa 25 s kredita je prijavljen", s.igrac === "kratki", JSON.stringify(s));
  await ubijServer();
  s = await sacekaj((x) => x.ekran === "lockedScreen", 45000);
  proveri("bez servera se računar zaključa kad kredit istekne", s.ekran === "lockedScreen", JSON.stringify(s));
  izvrsi('document.querySelector("#lockPin").value = "1234"; document.querySelector("#lockUnlock").click();');
  s = await sacekaj((x) => x.ekran === "connScreen", 8000);
  proveri("osoblje ga otključa servisnim PIN-om", s.ekran === "connScreen", JSON.stringify(s));
  proveri("server se ponovo diže", await podigniServer());
  s = await sacekaj((x) => x.ekran === "loginScreen" && x.wsOk === true, 20000);
  proveri("posle povratka se ne zaključava ponovo", s.ekran === "loginScreen", JSON.stringify(s));
  // Launcher zaključava kad na satu ostane manje od sekunde, pa igraču ostane
  // najviše vrednost te jedne sekunde - ovde dinar, u igraonici pare.
  proveri("kredit je potrošen (do jedne sekunde, u korist igrača)", (await kredit("kratki")) <= 1.01, String(await kredit("kratki")));

  // ---- 4) LAUNCHER SE PONOVO POKRENE DOK SERVER ĆUTI ----
  prijavi("mile");
  s = await sacekaj((x) => x.ekran === "desktopScreen" && x.igrac === "mile");
  await ubijServer();
  await sacekaj((x) => x.wsOk === false, 8000);
  await cekaj(2000);
  await ugasiLauncher();
  try { fs.unlinkSync(STANJE); } catch {}
  pokreniLauncher();
  s = await sacekaj((x) => x.ekran === "desktopScreen" && x.igrac === "mile", 30000);
  proveri("launcher pokrenut bez servera nastavlja sesiju", s.ekran === "desktopScreen" && s.igrac === "mile", JSON.stringify(s));
  const r1 = stanje().preostalo;
  await cekaj(4000);
  const r2 = stanje().preostalo;
  proveri("i sat ide dalje", r1 - r2 >= 2 && r1 - r2 <= 6, `${r1} -> ${r2}`);
  proveri("server se ponovo diže", await podigniServer());
  s = await sacekaj((x) => x.wsOk === true && x.traka === "Server: povezan", 20000);
  proveri("posle povratka igrač je i dalje u sesiji, bez nove prijave", s.ekran === "desktopScreen" && s.igrac === "mile", JSON.stringify(s));
  await cekaj(1500);
  const z4 = zapisSesije(pc.token);
  proveri("i zapis više ne čeka potvrdu", !!z4 && z4.nepotvrdjeno === false, JSON.stringify(z4));
  // Po jedna naplata iz drugog, trećeg i ovog dela.
  proveri("i ovo vreme bez servera je naplaćeno", ((await logovi()).match(/offline_naplata/g) || []).length >= 3);
} catch (e) {
  greska = e;
  console.log("  PAO  proba je pukla: " + (e?.stack || e));
} finally {
  await ugasiLauncher();
  await ubijServer();
  await cekaj(500);
}
proveri("launcher je ugašen", !radi(klijent));
proveri("server je ugašen", !radi(server));
if (greska) proveri("proba je prošla do kraja", false, String(greska?.message || greska));
await kraj();
