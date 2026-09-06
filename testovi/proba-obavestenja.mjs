import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ugasiLaunchere, putanjaElektrona } from "./_okruzenje.mjs";
// OBAVESTENJE PREKO IGRE
//
// Igrac je skoro uvek u punom ekranu i ne vidi launcher. Zato launcher pravi
// zaseban prozor iznad svega: tu stize upozorenje da vreme istice, poruka
// osoblja i odbrojavanje pred zatvaranje zbog mirovanja.
//
// To je najvidljivija zastita koju igrac ima. Ako tiho pukne, igrac ostane
// zakljucan nasred meca bez ijednog upozorenja, a osoblje sazna tek kad neko
// dodje da se zali. Dosad nije bilo provereno nijednom tvrdnjom.
//
// Ne moze da se proveri iz koda: prozor postoji samo u pravom Electronu, pravi
// ga tek prvo obavestenje, i sadrzaj mu stize kroz IPC.
//
//   node proba-obavestenja.mjs
const PORT = 8191;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("obavestenja-data");
const RADNO = radniFolder("obavestenja-klijent");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

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

// 60 din/h znaci 1 dinar u minutu: kredit u dinarima = minuti. Lako se pogodi
// prag, a naplata ne juri toliko brzo da preskoci vise pragova odjednom.
await api("/api/settings", "POST", { ratePerHour: 60 });
const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 20, note: "keš" }); // 20 minuta

// ---- pravi launcher, BEZ --dev (u dev rezimu se prozor namerno ne pravi) ----
const IZLAZ = path.join(RADNO, "vidjeno.json");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});

// Prozor sa obavestenjem se pravi tek kad prvo obavestenje stigne. Ovde se
// prati sve sto se u njemu pojavi, da se posle proveri sta je igrac video.
const vidjeno = [];
const pracene = new WeakSet();
setInterval(() => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (pracene.has(w) || w.isDestroyed()) continue;
    const url = w.webContents.getURL() || "";
    if (!url.includes("overlay")) continue;
    pracene.add(w);
    vidjeno.push({ dogadjaj: "prozor-napravljen", vidljiv: w.isVisible() });
    w.webContents.on("ipc-message", () => {});
  }
  // ocitaj sadrzaj svih overlay prozora
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    const url = w.webContents.getURL() || "";
    if (!url.includes("overlay")) continue;
    // Uz tekst se cita i BOJA leve ivice. Obavestenje je zaseban prozor i ne
    // vidi CSS launchera, pa je ovo jedini nacin da se proveri da li je boja
    // kuce stvarno stigla do njega - ili je ostala ona upisana u sam fajl.
    w.webContents.executeJavaScript(
      'JSON.stringify({ t: document.body.innerText, b: getComputedStyle(document.getElementById("kartica")).borderLeftColor })')
      .then((sirovo) => {
        let o = {}; try { o = JSON.parse(sirovo); } catch { return; }
        const tekst = String(o.t || "").replace(/\\s+/g, " ").trim();
        if (!tekst) return;
        const zadnji = vidjeno[vidjeno.length - 1];
        if (!zadnji || zadnji.tekst !== tekst || zadnji.ivica !== o.b) vidjeno.push({ tekst, ivica: o.b, vidljiv: w.isVisible() });
      })
      .catch(() => {});
  }
  try { fs.writeFileSync(${JSON.stringify(IZLAZ.replace(/\\/g, "/"))}, JSON.stringify(vidjeno)); } catch {}
}, 500);
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-obavestenja", version: "1.0.0", main: "main.js" }), "utf8");

const electron = putanjaElektrona();
const klijent = spawn(electron, [RADNO], { stdio: "ignore" });

const procitaj = () => { try { return JSON.parse(fs.readFileSync(IZLAZ, "utf8")); } catch { return []; } };
const sveVidjeno = () => procitaj().map((x) => x.tekst || "").join(" || ");

let povezan = false;
for (let i = 0; i < 40; i++) {
  const c = (await api("/api/computers")).find((x) => x.id === pc.id);
  if (c?.online) { povezan = true; break; }
  await cekaj(500);
}
proveri("launcher se povezao", povezan);

// ---- 1) PORUKA OSOBLJA STIZE PREKO IGRE ----
//
// Pre slanja se menja BOJA KUCE, na neku koja se ne moze pomesati sa fabrickom.
// Obavestenje je zaseban prozor i ne vidi CSS launchera, pa je do sada nosilo
// plavu upisanu u sam fajl - istu u svakoj igraonici, bez obzira sta je vlasnik
// izabrao. A to je jedino sto igrac gleda dok je u igri.
await api("/api/brend/boja", "POST", { akcenat: "#8a45d6" });
await cekaj(1200);

// Radnik salje poruku sa panela dok je igrac u igri.
await api(`/api/computers/${pc.id}/message`, "POST", { text: "Dođi na šank, čeka te sok." });
await cekaj(3000);
proveri("prozor iznad igre je napravljen", procitaj().some((x) => x.dogadjaj === "prozor-napravljen"),
  "bez njega igrac ne vidi nista dok je u punom ekranu");
proveri("poruka osoblja se pojavila", /Poruka od osoblja/i.test(sveVidjeno()), sveVidjeno().slice(0, 160));
proveri("tekst poruke je bas onaj koji je radnik ukucao", /Dođi na šank/.test(sveVidjeno()),
  sveVidjeno().slice(0, 160));

// #8a45d6 = rgb(138, 69, 214). Fabricka je rgb(47, 106, 232) - ako se pojavi
// ona, boja nije stigla nego stoji ona iz fajla.
const ivice = procitaj().map((x) => x.ivica).filter(Boolean);
proveri("obavestenje nosi BOJU KUCE, ne onu iz fajla",
  ivice.some((b) => /138,\s*69,\s*214/.test(b)),
  `videne ivice: ${[...new Set(ivice)].join(" | ") || "nijedna"}`);

// ---- 2) UPOZORENJE DA VREME ISTICE ----
//
// Igrac se prijavljuje KROZ SAM LAUNCHER, kao sto to radi u igraonici. Ulazi sa
// 20 minuta, pa mu se kredit spusti tako da predje prag od 5 minuta. Prag od 30
// se namerno ne javlja nekome ko ima 20 - to bi bila lazna uzbuna.
const IZLAZ2 = path.join(RADNO, "prijava.json");
fs.appendFileSync(path.join(RADNO, "main.js"), `
app.whenReady().then(async () => {
  let w = null;
  for (let i = 0; i < 80 && !w; i++) {
    w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !(x.webContents.getURL() || "").includes("overlay"));
    if (w && w.webContents.isLoading()) w = null;
    if (!w) await new Promise((r) => setTimeout(r, 300));
  }
  // Cekaj da launcher STVARNO dodje do ekrana za prijavu. Ranije se forma
  // slala dok je jos stajao "Povezivanje...", pa je klik padao u prazno.
  const aktivni = () => w.webContents.executeJavaScript(
    '[...document.querySelectorAll(".screen")].find(s => s.classList.contains("active"))?.id').catch(() => "greska");
  let pre = "?";
  for (let i = 0; i < 60; i++) {
    pre = await aktivni();
    if (pre === "loginScreen" || pre === "desktopScreen") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  let stanje = "nema prozora", poslato = "?";
  if (w) {
    poslato = await w.webContents.executeJavaScript(
      '(() => { const u = document.querySelector("#pUser"); const p = document.querySelector("#pPass");' +
      ' const f = document.querySelector("#loginForm");' +
      ' if (!u || !p || !f) return "nema forme"; u.value = "mile"; p.value = "mile1234";' +
      ' f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));' +
      ' return "poslato"; })()').catch((e) => "greska: " + e.message);
    await new Promise((r) => setTimeout(r, 4000));
    stanje = await w.webContents.executeJavaScript(
      '[...document.querySelectorAll(".screen")].find(s => s.classList.contains("active"))?.id').catch(() => "greska");
  }
  try { fs.writeFileSync(${JSON.stringify(IZLAZ2.replace(/\\/g, "/"))}, JSON.stringify({ stanje, pre, poslato })); } catch {}
});
`, "utf8");

// main.js se menja posle pokretanja, pa launcher mora ponovo.
// Stari launcher mora STVARNO da izadje pre novog. Dva launchera sa istim
// tokenom se otimaju o vezu: server zatvori stariju, a onaj kome je zatvorena
// se za tri sekunde vrati i zatvori onu drugu. Tada probu vidi kao "veza puca"
// iako je kriva samo proba.
try { klijent.kill(); } catch {}
ugasiLaunchere();
await cekaj(1500);
try { fs.unlinkSync(IZLAZ); } catch {}
const klijent2 = spawn(electron, [RADNO], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { if (fs.existsSync(IZLAZ2)) break; await cekaj(500); }
const prijava = (() => { try { return JSON.parse(fs.readFileSync(IZLAZ2, "utf8")); } catch { return {}; } })();
proveri("igrac se prijavio kroz sam launcher", prijava.stanje === "desktopScreen",
  `pre: ${prijava.pre}, forma: ${prijava.poslato}, posle: ${prijava.stanje}`);

const sesijaRadi = (await api("/api/snapshot")).computers.find((c) => c.id === pc.id)?.player?.username === "mile";
proveri("sesija stvarno tece", sesijaRadi);

// Spusti kredit na 4 minuta: prag od 5 mora da se javi.
await api(`/api/players/${mile.id}/topup`, "POST", { amount: -16, note: "proba praga" });
console.log("  ...cekam upozorenje o vremenu");
let predjenPrag = false;
for (let i = 0; i < 20 && !predjenPrag; i++) {
  await cekaj(1000);
  predjenPrag = /Ostalo ti je još|Ostao ti je još/i.test(sveVidjeno());
}
proveri("upozorenje o vremenu se pojavilo preko igre", predjenPrag,
  sveVidjeno().slice(-200) || "(prozor je ostao prazan)");
proveri("upozorenje kaze igracu sta da uradi", /osoblju/i.test(sveVidjeno()),
  "bez toga igrac zna da mu istice vreme, ali ne i kome da se javi");

// ---- 3) prozor ne otima fokus igri ----
const src = fs.readFileSync(path.join(KOREN, "client", "main.js"), "utf8");
proveri("prozor se prikazuje bez otimanja fokusa", src.includes("showInactive()"),
  "obicni show() bi izbacio igraca iz punog ekrana nasred meca");
proveri("prozor ne hvata klikove umesto igre", src.includes("setIgnoreMouseEvents(true)"));
proveri("stoji iznad punog ekrana", src.includes('setAlwaysOnTop(true, "screen-saver")'));

try { klijent2.kill(); } catch {}
ugasiLaunchere();
try { server.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(600);
process.exit(pao ? 1 : 0);
