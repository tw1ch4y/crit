// Provera da animacije sare STVARNO rade, ne samo da je CSS napisan.
// Meri se pozicija pozadine kroz vreme: ako se ne menja, animacija ne radi.
// Snima i po dve slike svakog kretanja, razmaknute u vremenu, da se vidi pomak.
//
//   node proba-kretanja.mjs            (server na 8096)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const PORT = process.argv[2] || "8096";
const RADNO = path.join(OVDE, ".radno", "proba-kretanja");
const SLIKE = path.join(OVDE, ".slike-kretanje");

fs.rmSync(RADNO, { recursive: true, force: true });
fs.mkdirSync(RADNO, { recursive: true });
fs.rmSync(SLIKE, { recursive: true, force: true });
fs.mkdirSync(SLIKE, { recursive: true });

const MAIN = `
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const RENDERER = ${JSON.stringify(path.join(KOREN, "client", "renderer"))};
const IZLAZ = ${JSON.stringify(SLIKE)};
const BAZA = "http://127.0.0.1:${PORT}";

// Racunari u igraonici su skoro uvek "optimizovani za igre" - Windows animacije
// iskljucene. Takav Windows javlja prefers-reduced-motion: reduce. Ovde se to
// stanje namerno izaziva, jer je pod njim sara stajala mrtva a da to nijedna
// provera nije hvatala: na racunaru na kom se radi animacije su ukljucene.
if (process.env.CRIT_REDUCED) app.commandLine.appendSwitch("force-prefers-reduced-motion");

ipcMain.handle("program-icon", async () => null);
ipcMain.handle("get-config", () => ({ host: BAZA, token: "x", configured: true }));
ipcMain.handle("sys-stats", () => ({ cpu: 23, ramUsedPct: 46, ramGb: "16", temp: 41, uptime: 7200 }));
// Svaki kanal koji preload nudi mora da ima odgovor.
//
// Kanal koji nedostaje ne pukne odmah nego se odbije obecanje, a to ovde pada
// u "unhandledRejection" i gasi probu sa porukom koja ne kaze nista o
// animacijama. Bas se to desavalo sa kanalom "verzija": proba je nekad prolazila
// a nekad se gasila u cetvrtoj sekundi, zavisno od toga sta launcher stigne da
// pozove. Spisak je preuzet iz preload.js - ako se tamo doda novi kanal, dodaje
// se i ovde.
for (const k of ["save-config", "reset-config", "to-server", "launch-game", "open-browser",
  "focus-launcher", "admin-exit", "renderer-ready", "podesavanja-citaj", "podesavanja-primeni", "verzija", "proveri-servisni-pin"])
  ipcMain.handle(k, () => true);

const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const posalji = (win, p) => win.webContents.send("server-msg", p);
process.on("uncaughtException", (e) => { console.log("PUKLO: " + (e && e.stack || e)); app.exit(1); });
process.on("unhandledRejection", (e) => { console.log("ODBIJENO: " + (e && e.stack || e)); app.exit(1); });
app.on("window-all-closed", () => {});
app.disableHardwareAcceleration();

// Ono sto se stvarno meri: pozicija pozadine i maske u datom trenutku.
const STANJE = \`(() => {
  const cs = getComputedStyle(document.body, "::after");
  // Iskre su pravi elementi u svom sloju - broji se koliko ih gori i da li
  // stoje tacno na koraku mreze (inace se crvena figura ne bi poklopila sa
  // belom ispod nje, pa bi izgledalo kao nalepljen kvadrat).
  const iskre = [...document.querySelectorAll(".iskra")];
  const korak = parseFloat(document.body.style.getPropertyValue("--tekstura-korak")) || 0;
  const naMrezi = korak ? iskre.every((i) => {
    const l = parseFloat(i.style.left), t = parseFloat(i.style.top);
    return l % korak === 0 && t % korak === 0;
  }) : null;
  return {
    kretanje: document.body.dataset.kretanje,
    poz: cs.backgroundPosition,
    maska: cs.webkitMaskPosition || cs.maskPosition || "",
    slojeva: (cs.backgroundImage.match(/url\\\\(/g) || []).length,
    pomeraj: document.body.style.getPropertyValue("--par-x") + " " + document.body.style.getPropertyValue("--par-y"),
    trajanje: cs.animationDuration,
    iskri: iskre.length, naMrezi,
    iskraCrvena: (document.body.style.getPropertyValue("--tekstura-iskra") || "").includes("ff2b2b"),
  };
})()\`;

app.whenReady().then(async () => {
  const prijava = await fetch(BAZA + "/api/login", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json());
  const uzmi = (p) => fetch(BAZA + p, { headers: { authorization: "Bearer " + prijava.token } }).then((r) => r.json());
  const [shop, games, tools, poz, promo, tex] = await Promise.all(
    ["/api/shop", "/api/games", "/api/tools", "/api/pozadine", "/api/promo", "/api/tekstura"].map(uzmi));

  const win = new BrowserWindow({ width: 1280, height: 800, show: true, frame: false,
    webPreferences: { preload: path.join(RENDERER, "..", "preload.js"), contextIsolation: true } });
  await win.loadFile(path.join(RENDERER, "index.html"));
  win.setContentSize(1280, 800);
  win.webContents.send("ws-status", { connected: true });
  await cekaj(300);

  const nalazi = [];
  for (const kretanje of ["mirno", "klizanje", "talas", "dubina", "iskre"]) {
    // Crvena varijanta se trazi sa servera, isto kao sto je dobija launcher.
    const spremna = await fetch(BAZA + "/api/tekstura", { method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + prijava.token },
      body: JSON.stringify({ kljuc: "kockice", jacina: "jako", kretanje }) }).then((r) => r.json());
    const tekstura = { ...spremna, sara: tex.spisak.kockice.sara, prozirnost: 1 };
    posalji(win, { t: "welcome", computer: { id: 7, name: "PC-07" },
      settings: { cafeName: "Crit", currency: "RSD", ratePerHour: 120 },
      shop, games, tools, pozadine: {}, tekstura,
      teksture: { spisak: tex.spisak, jacine: tex.jacine, kretanja: tex.kretanja, prozirnosti: tex.prozirnosti },
      promo: [] });
    posalji(win, { t: "login_ok", player: { id: 1, username: "marko", displayName: "Marko" },
      balance: 640, remainingSeconds: 19200, session: { id: 1, startedAt: Date.now() }, skoroIgrane: [], tekstura });
    await cekaj(2200);

    const a = await win.webContents.executeJavaScript(STANJE);
    fs.writeFileSync(path.join(IZLAZ, kretanje + "-1.png"), (await win.webContents.capturePage()).toPNG());
    await cekaj(2600);
    const b = await win.webContents.executeJavaScript(STANJE);
    fs.writeFileSync(path.join(IZLAZ, kretanje + "-2.png"), (await win.webContents.capturePage()).toPNG());

    // Mis se "pomera" samo kod dubine, da se vidi da sloj prati pokret.
    let pomerajPosle = a.pomeraj;
    if (kretanje === "dubina") {
      // Prozor mora da bude u prvom planu pre merenja.
      //
      // Sloj prati mis kroz requestAnimationFrame, a Chromium ga USPORAVA ili
      // sasvim zaustavlja prozoru koji je zaklonjen. Pustena sama, proba je
      // prolazila; pustena kroz pokretac, prozor se otvarao iza i sloj se nije
      // pomerao - pa je ispadalo da parallax ne radi, iako radi.
      try { win.showInactive(); win.moveTop(); win.focus(); } catch {}
      await cekaj(300);
      await win.webContents.executeJavaScript(
        \`window.dispatchEvent(new PointerEvent("pointermove", { clientX: 1180, clientY: 120, bubbles: true })), true\`);
      // Sacekaj dva ocrtavanja, ne samo proteklo vreme - inace merenje pada na
      // sporijem racunaru bez ijedne greske u programu.
      await win.webContents.executeJavaScript(
        "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");
      await cekaj(300);
      pomerajPosle = (await win.webContents.executeJavaScript(STANJE)).pomeraj;
    }

    nalazi.push({ kretanje, prvo: a, drugo: b, pomerajPosle, trajanje: a.trajanje, slojeva: a.slojeva });
  }
  win.destroy();
  console.log("NALAZI " + JSON.stringify(nalazi));
  app.quit();
});
`;

fs.writeFileSync(path.join(RADNO, "main.js"), MAIN, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-kretanja", version: "1.0.0", main: "main.js" }, null, 2), "utf8");

// --reduced pokrece istu probu na Windows-u sa iskljucenim animacijama.
const REDUCED = process.argv.includes("--reduced");
const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const p = spawn(electron, [RADNO], {
  shell: process.platform === "win32",
  env: { ...process.env, ...(REDUCED ? { CRIT_REDUCED: "1" } : {}) },
});
let izlaz = "";
p.stdout.on("data", (d) => (izlaz += d));
p.stderr.on("data", (d) => (izlaz += d));
p.on("close", (kod) => {
  const m = /NALAZI (\[.*\])/s.exec(izlaz);
  if (!m) {
    console.error(izlaz.split("\n").filter((l) => l.trim() && !/Deprecation|trace-dep/.test(l)).slice(-12).join("\n"));
    process.exit(kod || 1);
  }
  console.log("PROVERA KRETANJA SARE\n");
  let pao = 0;
  for (const n of JSON.parse(m[1])) {
    const pomeriloSe = n.prvo.poz !== n.drugo.poz;
    const maskaSePomera = n.prvo.maska !== n.drugo.maska;
    const misRadi = n.prvo.pomeraj !== n.pomerajPosle;
    const greske = [];
    if (n.kretanje === "mirno") {
      if (pomeriloSe || maskaSePomera) greske.push("nesto se pomera iako je izabrano Mirno");
      if (n.prvo.iskri) greske.push(`gori ${n.prvo.iskri} iskri iako je izabrano Mirno`);
    }
    if (n.kretanje === "iskre") {
      if (!n.prvo.iskraCrvena) greske.push("crvena varijanta sare nije stigla");
      if (!n.prvo.iskri && !n.drugo.iskri) greske.push("nijedna iskra se nije upalila");
      if (n.prvo.naMrezi === false || n.drugo.naMrezi === false)
        greske.push("iskra ne stoji na koraku mreze - crvena figura se ne poklapa sa belom");
      if (pomeriloSe) greske.push("sara se pomera, a kod iskri treba da stoji");
    }
    if (n.kretanje === "klizanje" && !pomeriloSe) greske.push("sara se ne pomera");
    if (n.kretanje === "talas" && !maskaSePomera) greske.push("pojas svetla se ne krece");
    if (n.kretanje === "dubina") {
      if (!pomeriloSe) greske.push("slojevi se ne pomeraju");
      if (n.slojeva < 2) greske.push(`ocekivana dva sloja, nadjeno ${n.slojeva}`);
      if (!misRadi) greske.push("pomeranje misa ne pomera blizi sloj");
    }
    pao += greske.length;
    console.log(`  ${greske.length ? "PAO " : "OK  "} ${n.kretanje.padEnd(9)} trajanje ${n.trajanje.padEnd(8)} slojeva ${n.slojeva}`);
    console.log(`         pozicija: ${n.prvo.poz}  ->  ${n.drugo.poz}`);
    if (n.prvo.maska) console.log(`         maska:    ${n.prvo.maska}  ->  ${n.drugo.maska}`);
    if (n.kretanje === "dubina") console.log(`         mis:      "${n.prvo.pomeraj}"  ->  "${n.pomerajPosle}"`);
    if (n.kretanje === "iskre") console.log(`         iskri:    ${n.prvo.iskri}  ->  ${n.drugo.iskri}   na mrezi: ${n.prvo.naMrezi}   crvena: ${n.prvo.iskraCrvena}`);
    for (const g of greske) console.log(`         -> ${g}`);
  }
  console.log(`\nslike: testovi/.slike-kretanje/  (po dve za svako kretanje)`);
  console.log(pao ? `${pao} problema` : "sva kretanja rade");
  process.exit(pao ? 1 : 0);
});
