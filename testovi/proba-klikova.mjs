// Provera da SVAKO dugme u launcheru stvarno stiže do koda.
//
// Zašto postoji: nagradni točak se otvarao, ali se nije mogao ni zavrteti ni
// zatvoriti. Uzrok nije bio u samom točku - delegacija klikova visi na
// #content, a pop-up stoji IZVAN njega, pa klik nikad nije stigao do slušaoca.
// Takav kvar se ne vidi iz koda koji se čita red po red, ne pada nijedan test,
// i otkrije se tek kad neko klikne. Zato se ovde otvara pravi prozor, prolazi
// kroz sve ekrane i za svaki element koji se klikće proverava da li na njemu
// ili iznad njega uopšte postoji slušalac klika.
//
// Slušaoci se hvataju tako što se addEventListener presretne PRE nego što se
// launcher učita - drugačije se ne može saznati ko šta sluša.
//
//   node proba-klikova.mjs            (server na 8096)
//   node proba-klikova.mjs 8097
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const PORT = process.argv[2] || "8096";
const RADNO = path.join(OVDE, ".radno", "proba-klikova");
fs.rmSync(RADNO, { recursive: true, force: true });
fs.mkdirSync(RADNO, { recursive: true });

// Presretač: pamti svaki element koji dobije slušaoca klika.
//
// Mora da se izvrši PRE launcher.js, i to u ISTOM JS svetu u kom launcher radi.
// Zato ide kroz preload i webFrame.executeJavaScript - to je jedini put koji
// radi uz contextIsolation. (executeJavaScript posle loadFile je prekasno;
// CDP Page.addScriptToEvaluateOnNewDocument traži Page.enable, koji u ovoj
// verziji Electrona nikad ne odgovori.)
// Broje se SAMO "click" slušaoci, i to samo na pravim elementima. document,
// window, <html> i <body> se namerno preskaču: launcher na document drži
// slušaoca za zvuk klika (pointerdown) i za tastere. Kad se i to računalo,
// svaki element je ispadao "pokriven" i provera je uvek javljala da je sve u
// redu - i onda kad dugme stvarno ne radi.
const PRESRETAC = `
(() => {
  window.__slusaoci = new Set();
  const stari = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (tip, fn, opt) {
    const globalni = this === document || this === window ||
      this === document.body || this === document.documentElement;
    // "submit" se broji jer dugme u formi radi preko slanja forme, ne preko
    // klika - forma je predak dugmeta, pa provera po precima to nadje.
    if ((tip === "click" || tip === "submit") && !globalni) window.__slusaoci.add(this);
    return stari.call(this, tip, fn, opt);
  };
})();
`;

// Preload u Electronu radi u peskovitom kontekstu: require() tudjeg fajla tamo
// ne prolazi (probano - ni contextBridge ni presretac se ne izvrse, pa launcher
// ostane bez window.crit i uopste ne krene). Zato se pravi preload ne poziva
// nego se njegov SADRZAJ prepisuje ovde, a presretac se doda na kraj.
const OMOTAC = fs.readFileSync(path.join(KOREN, "client", "preload.js"), "utf8") + `

// ---- dodatak samo za ovu probu ----
try {
  const { webFrame: _wf } = require("electron");
  _wf.executeJavaScript(${JSON.stringify(PRESRETAC)});
} catch (e) {
  console.error("[proba] presretac nije ubacen: " + e.message);
}
`;

fs.writeFileSync(path.join(RADNO, "omotac-preload.js"), OMOTAC, "utf8");

const MAIN = `
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const RENDERER = ${JSON.stringify(path.join(KOREN, "client", "renderer"))};
const BAZA = "http://127.0.0.1:${PORT}";
const OMOTAC_PUT = ${JSON.stringify(path.join(RADNO, "omotac-preload.js"))};

ipcMain.handle("program-icon", async () => null);
ipcMain.handle("get-config", () => ({ host: BAZA, token: "x", configured: true }));
ipcMain.handle("verzija", () => "proba");
ipcMain.handle("sys-stats", () => ({ cpu: 20, ramUsedPct: 44, ramGb: "16", temp: 40, uptime: 7200 }));
for (const k of ["save-config", "reset-config", "to-server", "launch-game", "open-browser",
  "focus-launcher", "admin-exit", "renderer-ready", "podesavanja-citaj", "podesavanja-primeni", "proveri-servisni-pin"])
  ipcMain.handle(k, () => true);
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const posalji = (w, m) => w.webContents.send("server-msg", m);

// Sve sto se klikce, po tome kako je oznaceno u launcheru.
const KLIKABILNO = [
  "button", "a[href]", "[data-game]", "[data-tool]", "[data-add]", "[data-inc]",
  "[data-dec]", "[data-kat]", "[data-nacin]", "[data-arr]", "[data-promo-idi]",
  "button[data-tema]", "[data-acc-sekcija]", ".tab", ".tile",
  ".site-card", ".pice", ".shop-cip",
].join(", ");

const PREGLED = \`(() => {
  const van = [];
  for (const el of document.querySelectorAll(\${JSON.stringify(KLIKABILNO)})) {
    if (!el.offsetParent && el.offsetWidth === 0 && el.offsetHeight === 0) continue; // nije na ekranu
    let n = el, nasao = false;
    while (n) { if (window.__slusaoci.has(n)) { nasao = true; break; } n = n.parentElement; }
    if (!nasao) {
      van.push({
        znak: el.id ? "#" + el.id : (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\\\s+/)[0] : el.tagName.toLowerCase()),
        tekst: (el.textContent || "").replace(/\\\\s+/g, " ").trim().slice(0, 28),
        ekran: (el.closest(".screen, .overlay") || {}).id || "?",
      });
    }
  }
  return { van, slusalaca: window.__slusaoci ? window.__slusaoci.size : -1, crit: typeof window.crit, ekranAktivan: ([...document.querySelectorAll(".screen")].find((e) => e.classList.contains("active")) || {}).id, skenirano: document.querySelectorAll(\${JSON.stringify(KLIKABILNO)}).length, tocakOtvoren: document.querySelector("#tocakOverlay").classList.contains("active") };
})()\`;

app.whenReady().then(async () => {
  const prijava = await fetch(BAZA + "/api/login", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json());
  const uzmi = (p) => fetch(BAZA + p, { headers: { authorization: "Bearer " + prijava.token } }).then((r) => r.json());
  const [shop, games, tools, izg] = await Promise.all(
    ["/api/shop", "/api/games", "/api/tools", "/api/izgled-kuce"].map(uzmi));

  const win = new BrowserWindow({ width: 1600, height: 900, show: true, frame: false,
    webPreferences: { preload: OMOTAC_PUT, contextIsolation: true } });
  await win.loadFile(path.join(RENDERER, "index.html"));
  win.webContents.send("ws-status", { connected: true });
  await cekaj(400);

  const tocak = { ukljucen: true, moze: true, prag: 1200, potroseno: 1500, nagrade: [
    { id: 1, naziv: "30 din", kredit: 30 }, { id: 2, naziv: "Ništa", kredit: 0 },
    { id: 3, naziv: "60 din", kredit: 60 }, { id: 4, naziv: "250 din", kredit: 250 } ] };

  const nalazi = {};
  // Zastita: ako se negde zaglavi, prozor se ipak zatvori i javi sta je stiglo.
  // Bez ovoga alat visi u pozadini i ne kaze nista.
  const cuvar = setTimeout(() => {
    console.log("NALAZI " + JSON.stringify(nalazi));
    console.error("[proba] isteklo vreme - prijavljeno je samo ono sto je stiglo");
    try { win.destroy(); } catch {}
    app.quit();
  }, 90000);
  const korak = (s) => console.error("[korak] " + s);
  const js = (s) => win.webContents.executeJavaScript(s);
  const klik = (sel) => js('(() => { const e = document.querySelector(' + JSON.stringify(sel) + '); if (!e) return false; e.click(); return true; })()');

  // 1) Ekran za prijavu
  posalji(win, { t: "welcome", computer: { id: 7, name: "PC-07" },
    settings: { cafeName: "Crit", currency: "RSD", ratePerHour: 120 },
    shop, games, tools, pozadine: {}, promo: [], izgled: { tema: izg.tema, pokret: izg.pokret }, teme: izg.teme });
  posalji(win, { t: "to_login" });
  await cekaj(700);
  korak("ekran prijave"); nalazi["ekran prijave"] = await js(PREGLED);

  // 2) Prijavljen: pocetna, shop, nalog
  posalji(win, { t: "login_ok", player: { id: 1, username: "marko", displayName: "Marko" },
    balance: 640, remainingSeconds: 19200, session: { id: 1, startedAt: Date.now() },
    skoroIgrane: [], tocak });
  await cekaj(4200);
  korak("pocetna"); nalazi["pocetna"] = await js(PREGLED);

  await klik('.tab[data-tab="shop"]'); await cekaj(700);
  // Nesto u korpu, da se pojave i dugmad korpe i koracnik na kartici.
  await klik(".pice-plus"); await cekaj(300);
  korak("shop"); nalazi["shop"] = await js(PREGLED);

  await klik('.tab[data-tab="account"]'); await cekaj(700);
  korak("nalog"); nalazi["nalog"] = await js(PREGLED);
  await klik('[data-acc-sekcija="teme"]'); await cekaj(500);
  korak("nalog teme"); nalazi["nalog teme"] = await js(PREGLED);

  // 3) Pop-up nagradnog tocka - tu je i bio kvar
  await klik('.tab[data-tab="home"]'); await cekaj(600);
  await klik("#heroTocak"); await cekaj(700);
  korak("pop-up tocka"); nalazi["pop-up tocka"] = await js(PREGLED);
  await klik("#tocakX"); await cekaj(400);

  // 4) Overlay-i koje igrac vidi
  await klik("#logoutBtn"); await cekaj(500);
  korak("potvrda odjave"); nalazi["potvrda odjave"] = await js(PREGLED);
  await klik("#cfNo"); await cekaj(300);

  posalji(win, { t: "poruka", tekst: "Proba" }); await cekaj(500);
  korak("poruka osoblja"); nalazi["poruka osoblja"] = await js(PREGLED);
  await klik("#msgOk"); await cekaj(300);

  // 5) Zakljucan ekran
  posalji(win, { t: "locked", reason: "time" }); await cekaj(700);
  await klik("#lockStaff"); await cekaj(400);
  korak("zakljucan ekran"); nalazi["zakljucan ekran"] = await js(PREGLED);

  clearTimeout(cuvar);
  win.destroy();
  console.log("NALAZI " + JSON.stringify(nalazi));
  app.quit();
});
`;

fs.writeFileSync(path.join(RADNO, "main.js"), MAIN, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-klikova", version: "1.0.0", main: "main.js" }, null, 2), "utf8");

const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const p = spawn(electron, [RADNO], { shell: process.platform === "win32" });
let izlaz = "";
p.stdout.on("data", (d) => (izlaz += d));
p.stderr.on("data", (d) => (izlaz += d));
p.on("close", (kod) => {
  const m = /NALAZI (\{.*\})/s.exec(izlaz);
  if (!m) {
    console.error(izlaz.split("\n").filter((l) => l.trim() && !/Deprecation|trace-dep/.test(l)).slice(-15).join("\n"));
    process.exit(kod || 1);
  }
  const nalazi = JSON.parse(m[1]);
  console.log("PROVERA DA SVAKO DUGME STIZE DO KODA\n");

  // SAMOPROVERA. Ako presretac ne radi ili launcher uopste nije krenuo, provera
  // bi tiho javila da je "sve u redu" - a to je gore od nikakve provere. Ovo je
  // vec jednom bilo: presretac je bio ubacen prekasno i sve je izgledalo cisto.
  const lose = [];
  for (const [ekran, r] of Object.entries(nalazi)) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    if (!(r.slusalaca > 0)) lose.push(`${ekran}: presretac nije uhvatio nijednog slusaoca`);
    if (r.crit !== "object") lose.push(`${ekran}: launcher nema window.crit, nije ni krenuo`);
    if (!r.ekranAktivan) lose.push(`${ekran}: nijedan ekran nije aktivan`);
  }
  if (lose.length) {
    console.log("  PROVERA NIJE ISPRAVNA - rezultat se ne racuna:");
    for (const l of [...new Set(lose)]) console.log("    " + l);
    process.exit(2);
  }

  let mrtvih = 0;
  for (const [ekran, rez] of Object.entries(nalazi)) {
    const van = rez.van || rez;
    if (!van.length) { console.log(`  OK   ${ekran}  (pregledano ${rez.skenirano})`); continue; }
    mrtvih += van.length;
    console.log(`  PAO  ${ekran} - ${van.length} bez slusaoca:`);
    for (const v of van) console.log(`         ${v.znak}  "${v.tekst}"  (u ${v.ekran})`);
  }
  console.log(mrtvih ? `\n${mrtvih} dugmadi ne stize do koda` : "\nsvako dugme stize do koda");
  process.exit(mrtvih ? 1 : 0);
});
