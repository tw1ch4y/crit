// Polica igara se stvarno pomera dok se skroluje (ozivipolicu u launcher.js):
// nagib u smeru kretanja, paralaksa omota i dubina na ivicama. Meri se u pravom
// Electronu:
//
//   1. u miru je nagib nula, a dubina postavljena (zavisi od polozaja)
//   2. usred naglog skrolovanja nagib i paralaksa nisu nula
//   3. kad se stane, oboje se vrate na nulu
//   4. kad igrac ugasi animacije, nista se ne postavlja
//   5. naslovi igara ostaju u istoj liniji, u miru i u kretanju
//
// Server nije potreban: katalog se salje rucno, kao u probi klikova.
//
//   node proba-police.mjs
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { putanjaElektrona } from "./_okruzenje.mjs";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const RADNO = path.join(OVDE, ".radno", "proba-police");
fs.rmSync(RADNO, { recursive: true, force: true });
fs.mkdirSync(RADNO, { recursive: true });

// Dvanaest igara, da polica sigurno bude sira od ekrana i ima gde da klizi.
const IGRE = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, name: "Igra " + (i + 1), path: "C:/g/" + i, args: "", image: null, category: "Igre",
}));

const MAIN = `
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const RENDERER = ${JSON.stringify(path.join(KOREN, "client", "renderer"))};
const IGRE = ${JSON.stringify(IGRE)};

ipcMain.handle("get-config", () => ({ host: "http://127.0.0.1:1", token: "x", configured: true }));
ipcMain.handle("sys-stats", () => ({ cpu: 20, ramUsedPct: 44, ramGb: "16", temp: 40, uptime: 7200 }));
ipcMain.handle("verzija", () => "proba");
ipcMain.handle("program-icon", async () => null);
ipcMain.handle("podesavanja-citaj", () => ({ mis: { brzina: 10, ubrzanje: false }, zvuk: { jacina: 65 } }));
for (const k of ["save-config", "reset-config", "to-server", "launch-game", "open-browser",
  "focus-launcher", "admin-exit", "renderer-ready", "proveri-servisni-pin", "podesavanja-primeni", "otkljucaj-bez-servera"])
  ipcMain.handle(k, () => true);

const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();

// Cita stanje police: nagib i dubinu po plocici, paralaksu omota, i gde stoji
// ime svake igre - po njemu se vidi da li je red prav.
const STANJE = \`(() => {
  const t = document.querySelector(".games-shelf .shelf-track");
  if (!t) return { greska: "nema police" };
  const plocice = [...t.children];
  const medij = plocice.map((p) => p.firstElementChild).filter(Boolean);
  const broj = (e, ime) => parseFloat(e.style.getPropertyValue(ime)) || 0;
  // Samo plocice koje polica NE sece - njima dubina ne sme nista da uradi.
  const cele = [];
  for (const p of plocice) {
    const l = p.offsetLeft - t.scrollLeft;
    if (l >= -0.5 && l + p.offsetWidth <= t.clientWidth + 0.5 && p.firstElementChild)
      cele.push(broj(p.firstElementChild, "--dub"));
  }
  return {
    plocica: medij.length,
    nagib: medij.map((e) => broj(e, "--nagib")),
    dub: medij.map((e) => broj(e, "--dub")),
    celeDub: cele,
    // Donja ivica imena igre, u koordinatama ekrana. Jedini pouzdan nacin da se
    // vidi da li naslovi stoje u liniji: mere se tek posle svih transformacija.
    imena: [...t.querySelectorAll(".tile-name")].map((e) => Math.round(e.getBoundingClientRect().bottom * 10) / 10),
    visine: [...t.querySelectorAll(".tile-name")].map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10),
    skrol: Math.round(t.scrollLeft),
    moze: t.scrollWidth > t.clientWidth + 4,
  };
})()\`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1366, height: 768, show: true, frame: false,
    webPreferences: { preload: path.join(RENDERER, "..", "preload.js"), contextIsolation: true } });
  await win.loadFile(path.join(RENDERER, "index.html"));
  win.webContents.send("ws-status", { connected: true });
  await cekaj(600);
  win.webContents.send("server-msg", { t: "welcome", computer: { id: 7, name: "PC-07" },
    settings: { cafeName: "Crit", currency: "RSD", ratePerHour: 120 },
    shop: [], games: IGRE, tools: [], pozadine: {}, promo: [] });
  win.webContents.send("server-msg", { t: "login_ok", player: { id: 1, username: "marko", displayName: "Marko" },
    balance: 640, remainingSeconds: 19200, session: { id: 1, startedAt: Date.now() }, skoroIgrane: [] });
  // Posle prijave ide pozdravna animacija preko celog ekrana; meri se tek posle nje.
  await cekaj(3400);

  const js = (s) => win.webContents.executeJavaScript(s);
  const dvaKadra = () => js("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");
  const skroluj = (na) => js('(() => { const t = document.querySelector(".games-shelf .shelf-track");'
    + ' t.style.scrollBehavior = "auto"; t.scrollLeft = ' + na + '; t.dispatchEvent(new Event("scroll")); return true; })()');

  const uMiru = await js(STANJE);
  await skroluj(460);
  await dvaKadra();
  const uPokretu = await js(STANJE);
  await cekaj(1500);
  const posle = await js(STANJE);

  // Isto, ali sa ugasenim animacijama - tada se ne sme postaviti nista.
  await js('(() => { S.animacije = false; document.body.classList.add("bez-animacija"); return true; })()');
  await skroluj(120);
  await dvaKadra();
  await cekaj(150);
  const ugaseno = await js(STANJE);

  win.destroy();
  console.log("NALAZI " + JSON.stringify({ uMiru, uPokretu, posle, ugaseno }));
  app.quit();
});
`;

fs.writeFileSync(path.join(RADNO, "main.js"), MAIN, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-police", version: "1.0.0", main: "main.js" }, null, 2), "utf8");

const p = spawn(putanjaElektrona(), [RADNO]);
let izlaz = "";
p.stdout.on("data", (d) => (izlaz += d));
p.stderr.on("data", (d) => (izlaz += d));
p.on("close", (kod) => {
  const m = /NALAZI (\{.*\})/s.exec(izlaz);
  if (!m) {
    console.error(izlaz.split("\n").filter((l) => l.trim() && !/Deprecation|trace-dep/.test(l)).slice(-12).join("\n"));
    process.exit(kod || 1);
  }
  const n = JSON.parse(m[1]);
  let pao = 0, prosao = 0;
  const proveri = (ime, uslov, detalj = "") => {
    if (uslov) { prosao++; console.log("  OK   " + ime); }
    else { pao++; console.log("  PAO  " + ime + (detalj ? "  -> " + detalj : "")); }
  };
  const najveci = (niz) => Math.max(...(niz || [0]).map(Math.abs));

  console.log("PROVERA ANIMACIJE POLICE\n");
  proveri("polica postoji i ima gde da klizi", n.uMiru.moze === true && n.uMiru.plocica >= 6,
    JSON.stringify({ plocica: n.uMiru.plocica, moze: n.uMiru.moze }));

  // U miru: nagib nula, ali dubina vec radi - ona zavisi od polozaja, ne od kretanja.
  proveri("u miru nema nagiba", najveci(n.uMiru.nagib) < 0.2, String(najveci(n.uMiru.nagib)));
  proveri("ali dubina je vec postavljena", n.uMiru.dub.some((d) => d > 0 && d < 1),
    JSON.stringify(n.uMiru.dub.slice(0, 4)));

  // Dubina gasi SAMO ono sto je preseceno ivicom. Dok je isla po udaljenosti od
  // sredine, prva igra - najigranija, i uvek cela vidljiva - stalno je bila
  // utisana, a to je govorilo da je manje vazna.
  const celeRade = (s) => s.celeDub.length > 0 && s.celeDub.every((d) => d === 1);
  proveri("cela plocica se ne utisava", celeRade(n.uMiru), JSON.stringify(n.uMiru.celeDub));
  proveri("ni usred kretanja", celeRade(n.uPokretu), JSON.stringify(n.uPokretu.celeDub));
  proveri("presecena plocica jeste utisana", n.uMiru.dub.some((d) => d > 0 && d < 0.999),
    "inace dubina nista ne radi i nema joj ni svrhe");

  // Usred kretanja: nagib mora da postoji.
  proveri("dok se skroluje, plocice se naginju", najveci(n.uPokretu.nagib) > 0.5,
    `najveci nagib ${najveci(n.uPokretu.nagib)}`);
  proveri("skrol je stvarno pomeren", n.uPokretu.skrol > 100, String(n.uPokretu.skrol));

  // Kad se stane, mora da se smiri - inace bi polica ostala nakrivljena.
  proveri("kad se stane, nagib se vraca na nulu", najveci(n.posle.nagib) < 0.2,
    String(najveci(n.posle.nagib)));
  proveri("dubina ostaje i posle mirovanja", n.posle.dub.some((d) => d > 0 && d < 1),
    "dubina zavisi od polozaja, ne od kretanja");

  // RED MORA DA BUDE PRAV.
  //
  // Ovo je provera zbog koje proba i postoji u ovom obliku. Animacija sme sve
  // osim jednog: da pokvari red imena. Ime igre stoji UNUTAR okvira koji se
  // animira, pa ga svaka promena velicine okvira pomeri i smanji - a osam
  // naslova na razlicitim visinama izgleda kao greska u programu, ne kao dubina.
  const raspon = (niz) => (niz && niz.length ? Math.max(...niz) - Math.min(...niz) : 0);
  proveri("u miru imena igara stoje u istoj liniji", raspon(n.uMiru.imena) <= 1,
    `razlika ${raspon(n.uMiru.imena)}px izmedju najviseg i najnizeg naslova`);
  proveri("i usred skrolovanja ostaju u liniji", raspon(n.uPokretu.imena) <= 1,
    `razlika ${raspon(n.uPokretu.imena)}px`);
  proveri("i posle mirovanja", raspon(n.posle.imena) <= 1, `razlika ${raspon(n.posle.imena)}px`);
  proveri("i sva su iste velicine", raspon(n.uMiru.visine) <= 0.5,
    `visine: ${JSON.stringify(n.uMiru.visine.slice(0, 5))}`);

  // Igrac koji je ugasio animacije ne dobija nijednu.
  proveri("sa ugasenim animacijama nema ni nagiba ni dubine",
    najveci(n.ugaseno.nagib) === 0 && najveci(n.ugaseno.dub) === 0,
    JSON.stringify({ nagib: najveci(n.ugaseno.nagib), dub: najveci(n.ugaseno.dub) }));

  console.log(`\n${prosao}/${prosao + pao} proslo`);
  process.exit(pao ? 1 : 0);
});
