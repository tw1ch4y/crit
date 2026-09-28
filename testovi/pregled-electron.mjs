// Pregled launchera u pravom Electronu, ne u pregledacu.
// Samo tako se vidi ono sto igrac stvarno vidi: prave ikone iz .exe fajlova
// (window.crit.programIcon postoji jedino ovde) i pravi raspored na punom ekranu.
//
// Slika SVAKI ekran, na svakoj rezoluciji, i uz svaku sliku meri da li nesto
// ispada iz ekrana ili se podvlaci pod donju traku.
//
//   node pregled-electron.mjs                     sve, 1920x1080 i 1366x768
//   node pregled-electron.mjs --port 8095         drugi port servera
//   node pregled-electron.mjs --rez 1366x768      samo jedna rezolucija
//   node pregled-electron.mjs --ekran shop        samo jedan ekran
//
// Slike idu u testovi/.slike/ i tamo se prepisuju pri svakom pokretanju.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const RADNO = path.join(OVDE, ".radno", "electron-pregled");
const SLIKE = path.join(OVDE, ".slike");

const arg = (ime, podrazumevano) => {
  const i = process.argv.indexOf("--" + ime);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : podrazumevano;
};
const PORT = arg("port", "8096");
const REZOLUCIJE = arg("rez", "1920x1080,1366x768").split(",").map((r) => {
  const [w, h] = r.split("x").map(Number);
  return { w, h, ime: `${w}x${h}` };
});
const SAMO_EKRAN = arg("ekran", "");

fs.rmSync(RADNO, { recursive: true, force: true });
fs.mkdirSync(RADNO, { recursive: true });
fs.rmSync(SLIKE, { recursive: true, force: true });
fs.mkdirSync(SLIKE, { recursive: true });

// Renderer se ucitava iz pravog foldera launchera, da se gleda bas ono sto ide
// u paket. Ovde se pravi samo glavni proces koji ga otvori i nahrani.
const MAIN = `
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const RENDERER = ${JSON.stringify(path.join(KOREN, "client", "renderer"))};
const IZLAZ = ${JSON.stringify(SLIKE)};
const PORT = ${JSON.stringify(PORT)};
const REZOLUCIJE = ${JSON.stringify(REZOLUCIJE)};
const SAMO_EKRAN = ${JSON.stringify(SAMO_EKRAN)};
const BAZA = "http://127.0.0.1:" + PORT;

// Isti most kao u pravom launcheru - ovde je bitan samo program-icon.
// Kad se kanal preimenuje u client/main.js, mora i ovde, inace pregled tiho
// pokazuje sve na rezervnom izgledu i deluje kao da ikone ne rade.
const kes = new Map();
ipcMain.handle("program-icon", async (e, putanja) => {
  const p = String(putanja || "").trim().replace(/^"|"$/g, "").trim();
  if (!p) return null;
  if (kes.has(p)) return kes.get(p);
  let url = null;
  try {
    if (fs.existsSync(p) && /\\.(exe|lnk)$/i.test(p)) {
      const img = await app.getFileIcon(p, { size: "large" });
      if (img && !img.isEmpty()) url = img.toDataURL();
    }
  } catch { url = null; }
  kes.set(p, url);
  return url;
});
ipcMain.handle("get-config", () => ({ host: BAZA, token: "x", configured: true }));
ipcMain.handle("sys-stats", () => ({ cpu: 23, ramUsedPct: 46, ramGb: "16", temp: 41, uptime: 7200 }));
// Verzija koju bi javio pravi launcher - da se na slici vidi donja traka onakva
// kakvu igrac stvarno gleda.
ipcMain.handle("verzija", () => require(${JSON.stringify(path.join(KOREN, "client", "package.json").replace(/\\/g, "/"))}).version);
ipcMain.handle("podesavanja-citaj", () => ({ mis: { brzina: 10, ubrzanje: false }, zvuk: { jacina: 65 } }));
ipcMain.handle("podesavanja-primeni", () => ({ ok: true, stanje: { mis: { brzina: 10, ubrzanje: false }, zvuk: { jacina: 65 } } }));
for (const k of ["save-config", "reset-config", "to-server", "launch-game", "open-browser",
  "focus-launcher", "admin-exit", "renderer-ready", "proveri-servisni-pin"])
  ipcMain.handle(k, () => true);

const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const posalji = (win, poruka) => win.webContents.send("server-msg", poruka);

// Sta se sve slika. Svaki ekran zna kako se do njega stize.
const EKRANI = [
  // Server salje "to_login" kad je racunar slobodan. Bez te poruke launcher
  // ostaje na ekranu "povezivanje", pa se ekran za prijavu nikad ne bi video.
  { ime: "1-prijava", opis: "Ekran za prijavu igraca", ocekivan: "loginScreen",
    do: async (win) => { posalji(win, { t: "to_login" }); await cekaj(600); } },
  { ime: "2-pocetna", opis: "Pocetna: izdvojena igra, police, alati", ocekivan: "desktopScreen",
    do: async (win, p) => { posalji(win, p.login); await sacekajPozdrav(win); await cekaj(1400); } },
  // Shop se gleda u stanju koje igrac stvarno ima: nesto u korpi i porudzbina
  // koja se sprema. Prazan shop ne pokazuje ni korpu ni spisak porudzbina, a to
  // je bas ono sto treba da izgleda kako valja.
  { ime: "3-shop", opis: "Shop: pica, korpa i porudzbine", ocekivan: "desktopScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win);
      posalji(win, { t: "moje_porudzbine", porudzbine: [
        { id: 41, status: "preparing", total: 260, payment: "credit", createdAt: Date.now() - 240000,
          items: [{ name: "Coca-Cola", qty: 1 }, { name: "Rosa 0.5", qty: 1 }] },
        { id: 38, status: "delivered", total: 140, payment: "cash", createdAt: Date.now() - 3600000,
          items: [{ name: "Ultra Energy 0.33", qty: 1 }] },
      ] });
      await cekaj(300);
      await klik(win, '.tab[data-tab="shop"]'); await cekaj(700);
      await klik(win, ".pice-plus"); await cekaj(220);
      await klik(win, ".pice-step [data-inc]"); await cekaj(220);
      await klik(win, ".shop-grid .pice:nth-child(4) .pice-plus"); await cekaj(600);
    } },
  // Traka kategorija mora stvarno da suzi spisak, ne samo da se oboji.
  { ime: "3b-shop-kategorija", opis: "Shop: izabrana jedna kategorija", ocekivan: "desktopScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win);
      await klik(win, '.tab[data-tab="shop"]'); await cekaj(700);
      await klik(win, '.shop-cip[data-kat="Energetsko"]'); await cekaj(600);
    } },
  // Nalog se gleda sa porudzbinama, jer to je stanje koje igrac najcesce ima -
  // prazan nalog pokazuje samo dve kartice i ne kaze nista o rasporedu.
  { ime: "4-nalog", opis: "Nalog: podaci igraca i porudzbine", ocekivan: "desktopScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win);
      posalji(win, { t: "moje_porudzbine", porudzbine: [
        { id: 41, status: "preparing", total: 210, payment: "credit", createdAt: Date.now() - 240000,
          items: [{ name: "Coca-Cola 0.5", qty: 1 }, { name: "Smoki", qty: 1 }] },
        { id: 38, status: "delivered", total: 250, payment: "cash", createdAt: Date.now() - 3600000,
          items: [{ name: "Red Bull", qty: 1 }] },
        { id: 35, status: "delivered", total: 130, payment: "credit", createdAt: Date.now() - 7200000,
          items: [{ name: "Coca-Cola 0.5", qty: 1 }] },
      ] });
      await cekaj(400);
      await klik(win, '.tab[data-tab="account"]'); await cekaj(800);
    } },
  // Nalog je meni sa cetiri odeljka. Svaki mora da se pogleda posebno - dok se
  // gledao samo prvi, u ostalima je moglo da stoji bilo sta.
  { ime: "4b-nalog-nagrade", opis: "Nalog > Nagrade (tocak, napredak, spisak)", ocekivan: "desktopScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win);
      await cekaj(400);
      await klik(win, '.tab[data-tab="account"]'); await cekaj(500);
      await klik(win, '[data-acc-sekcija="nagrade"]'); await cekaj(600);
    } },
  { ime: "4e-nalog-podesavanja", opis: "Nalog > Mis i zvuk", ocekivan: "desktopScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win);
      await cekaj(400);
      await klik(win, '.tab[data-tab="account"]'); await cekaj(500);
      await klik(win, '[data-acc-sekcija="podesavanja"]'); await cekaj(2500);
    } },
  { ime: "4c-nalog-teme", opis: "Nalog > Teme (izbor teme launchera)", ocekivan: "desktopScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win);
      await cekaj(400);
      await klik(win, '.tab[data-tab="account"]'); await cekaj(500);
      await klik(win, '[data-acc-sekcija="teme"]'); await cekaj(700);
    } },
  { ime: "4d-nalog-lozinka", opis: "Nalog > Lozinka", ocekivan: "desktopScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win);
      await cekaj(400);
      await klik(win, '.tab[data-tab="account"]'); await cekaj(500);
      await klik(win, '[data-acc-sekcija="lozinka"]'); await cekaj(600);
    } },
  { ime: "5-zakljucan", opis: "Zakljucan ekran (isteklo vreme)", ocekivan: "lockedScreen",
    do: async (win, p) => { posalji(win, p.login); await sacekajPozdrav(win); posalji(win, { t: "locked", reason: "time" }); await cekaj(800); } },

  // Nagradni tocak se otvara klikom na widget u baneru - pop-up mora da se vidi.
  { ime: "5b-tocak", opis: "Nagradni tocak (pop-up)", ocekivan: "desktopScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win); await cekaj(500);
      await klik(win, "#heroTocak"); await cekaj(700);
    } },

  // Stanja koja igrac vidi u najgorem trenutku. Nikad nisu bila pregledana, a
  // bas se ona pamte kad nesto krene naopako.
  { ime: "6-prazno", opis: "Nema nijedne igre ni precice", ocekivan: "desktopScreen", sam: true,
    do: async (win, p) => {
      posalji(win, { ...p.welcome, games: [], tools: [], shop: [], promo: [] });
      posalji(win, p.login); await sacekajPozdrav(win); await cekaj(600);
    } },
  { ime: "7-prazan-shop", opis: "Shop bez ijednog artikla", ocekivan: "desktopScreen", sam: true,
    do: async (win, p) => {
      posalji(win, { ...p.welcome, shop: [] });
      posalji(win, p.login); await sacekajPozdrav(win);
      await klik(win, '.tab[data-tab="shop"]'); await cekaj(700);
    } },
  { ime: "8-nema-veze", opis: "Pukla veza sa serverom usred igranja", ocekivan: "connScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win);
      win.webContents.send("ws-status", { connected: false });
      await cekaj(800);
    } },
  { ime: "9-igra-nece", opis: "Igra ne moze da se pokrene", ocekivan: "desktopScreen",
    do: async (win, p) => {
      posalji(win, p.login); await sacekajPozdrav(win);
      // Isti tekst koji main.js stvarno posalje (objasniGresku). Ranije je ovde
      // stajala lepsa poruka nego u stvarnosti, pa je slika krila da igrac
      // dobija sirovu Windows gresku.
      win.webContents.send("game-error", { name: "Counter-Strike 2", message: "Igra nije pronađena na ovom računaru." });
      await cekaj(700);
    } },
];

// Obavestenje koje iskace PREKO IGRE je poseban prozor (overlay.html), ne deo
// launchera - igrac tada gleda igru, ne launcher. Zato se slika zasebno.
// Prvo sam ga trazio u launcheru i pomislio da odbrojavanje pred odjavu uopste
// ne postoji; postoji, samo je u glavnom procesu.
const OBAVESTENJA = [
  { ime: "10-mirovanje", opis: "Odbrojavanje pre odjave zbog mirovanja",
    podaci: { naslov: "Nema aktivnosti za ovim računarom", opis: "Sesija se zatvara za 42 s. Pomeri miš ili pritisni taster da nastaviš.", vrsta: "vreme", boja: "" } },
  { ime: "11-pred-istek", opis: "Upozorenje da vreme istice",
    podaci: { naslov: "Ostalo ti je 5 minuta", opis: "Dopunu kredita radiš na kasi kod osoblja.", vrsta: "vreme", boja: "" } },
  { ime: "12-poruka-osoblja", opis: "Poruka koju osoblje salje igracu",
    podaci: { naslov: "Poruka od osoblja", opis: "Sok je stigao, dolazimo za minut.", vrsta: "poruka", boja: "plava" } },
];

const klik = (win, sel) => win.webContents.executeJavaScript(
  \`(() => { const e = document.querySelector(\\\`\${sel}\\\`); if (e) { e.click(); return true; } return false; })()\`);

// Posle prijave ide pozdravna animacija ("Dobrodosao, MARKO") preko celog
// ekrana. Traje oko 2 s, pa bi slika snimljena ranije uhvatila nju umesto
// ekrana koji se gleda. Ceka se da stvarno nestane, ne "otprilike toliko".
async function sacekajPozdrav(win) {
  for (let i = 0; i < 40; i++) {
    const gotovo = await win.webContents.executeJavaScript(
      \`(() => { const o = document.querySelector("#bootOverlay");
        return !o || o.classList.contains("hidden") || !o.classList.contains("active"); })()\`);
    if (gotovo) { await cekaj(180); return; }
    await cekaj(120);
  }
}

// Mere koje se ne vide golim okom: da li nesto ispada iz ekrana ili se
// podvlaci pod donju traku.
const MERE = \`(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect();
    return { vrh: Math.round(b.top), dno: Math.round(b.bottom), sirina: Math.round(b.width), visina: Math.round(b.height) }; };
  const aktivan = [...document.querySelectorAll(".screen")].find((s) => s.classList.contains("active"))?.id;
  const traka = r(".statusbar");
  const sadrzaj = r(".content") || r(".home");
  // Sta STVARNO izlazi iz ekrana. Element koji viri, a nalazi se u kutiji koja
  // ga secka (polica igara se pomera vodoravno, ukrasni slojevi su razvuceni),
  // ne izlazi nikuda - gledalac ga ne vidi. Zato se gledaju samo oni koje
  // nijedan predak ne secka.
  // Ide se SVE do html elementa: body ima overflow:hidden, pa razvuceni
  // ukrasni slojevi (zamucena pozadina prijave) nikuda ne izlaze.
  const seckaGa = (e) => {
    for (let p = e.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflow !== "visible" || o.overflowX !== "visible" || o.overflowY !== "visible") return true;
      if (o.clipPath && o.clipPath !== "none") return true;
    }
    return false;
  };
  const viri = [...document.querySelectorAll("body *")].filter((e) => {
    const b = e.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return false;
    if (getComputedStyle(e).position === "fixed") return false;
    const izlazi = b.right > innerWidth + 2 || b.bottom > innerHeight + 2 || b.left < -2;
    return izlazi && !seckaGa(e);
  }).slice(0, 6).map((e) => (typeof e.className === "string" && e.className ? e.className.split(" ")[0] : e.tagName));
  // tekst koji je odsecen jer ne staje
  const secen = [...document.querySelectorAll("body *")].filter((e) => {
    if (e.children.length) return false;
    return e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0;
  }).slice(0, 6).map((e) => (e.textContent || "").trim().slice(0, 28));
  // Koji se font STVARNO primenio. Ako Chakra Petch negde izostane, ekran
  // izgleda "napola sredjeno" a nista ne pukne - zato se meri, ne pretpostavlja.
  const fontOd = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontFamily.split(",")[0].replace(/["']/g, "") : null; };
  // Koliko je ekrana zauzeto a koliko prazno - da se praznina meri, ne procenjuje.
  const povrsina = (sel) => { const e = document.querySelector(sel); if (!e) return 0; const b = e.getBoundingClientRect(); return Math.round(b.width * b.height); };
  const ekran = innerWidth * innerHeight;
  const razmaci = (() => {
    const h = document.querySelector(".hero"), pol = document.querySelector(".games-shelf"), net = document.querySelector(".net-shelf");
    if (!h || !pol || !net) return null;
    const hb = h.getBoundingClientRect(), pb = pol.getBoundingClientRect(), nb = net.getBoundingClientRect();
    const plocica = document.querySelector(".tile")?.getBoundingClientRect();
    return {
      hero: Math.round(hb.height),
      heroPrazno: (() => {
        // sirina hero trake minus ono sto je u njoj popunjeno
        const t = document.querySelector(".hero-title")?.getBoundingClientRect();
        const poster = document.querySelector(".hero-poster, .hero-art")?.getBoundingClientRect();
        if (!t) return null;
        const levo = t.right - hb.left;
        const desno = poster ? hb.right - poster.left : 0;
        return Math.round(100 * (hb.width - levo - desno) / hb.width) + "% sredine prazno";
      })(),
      izmedjuPoliceIAlata: Math.round(nb.top - pb.bottom),
      plocicaVisina: plocica ? Math.round(plocica.height) : null,
      policaVisina: Math.round(pb.height),
      policaPrazno: plocica ? Math.round(pb.height - plocica.height - 26) : null,
    };
  })();

  const fontovi = {
    dugme: fontOd(".btn"), tab: fontOd(".tab"), polje: fontOd("input"),
    naslov: fontOd(".hero-title, .acc-name, .ev-t, .brand-tag"), traka: fontOd(".statusbar"),
  };

  return {
    ekran: aktivan,
    preliv: Math.round(document.documentElement.scrollHeight - innerHeight),
    podTrakom: traka && sadrzaj ? Math.max(0, Math.round(sadrzaj.dno - traka.vrh)) : 0,
    viri, secen, fontovi, razmaci,
  };
})()\`;

app.disableHardwareAcceleration();
// Bez ovoga greska u glavnom procesu tiho ubije pregled: Electron izadje sa
// kodom 0 i bez ijednog reda, pa deluje kao da alat "ne radi nista".
process.on("uncaughtException", (e) => { console.log("PUKLO: " + (e && e.stack || e)); app.exit(1); });
process.on("unhandledRejection", (e) => { console.log("ODBIJENO: " + (e && e.stack || e)); app.exit(1); });

// Kad se zatvori poslednji prozor, Electron podrazumevano gasi aplikaciju.
// Ovde se prozor launchera rusi pa se otvara prozor obavestenja - bez ovoga bi
// se ceo pregled ugasio izmedju ta dva koraka, i to bez ijedne poruke: izlaz 0,
// nijedan red ispisa, kao da alat nista ne radi.
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  // Podaci se povlace sa servera, pa se launcheru salju kao da su stigli preko
  // WebSocketa.
  const prijava = await fetch(BAZA + "/api/login", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json());
  const uzmi = (p) => fetch(BAZA + p, { headers: { authorization: "Bearer " + prijava.token } }).then((r) => r.json());
  const [shop, games, tools, poz, promo, izg] = await Promise.all(
    ["/api/shop", "/api/games", "/api/tools", "/api/pozadine", "/api/promo", "/api/izgled-kuce"].map(uzmi));

  const poruke = {
    welcome: { t: "welcome", computer: { id: 7, name: "PC-07" },
      settings: { cafeName: "Crit", currency: "RSD", ratePerHour: 120 },
      shop, games, tools, pozadine: poz.slike || {},
      // Spisak tema: bez njega Nalog > Teme stoji na "Teme se ucitavaju".
      izgled: { tema: izg.tema, pokret: izg.pokret }, teme: izg.teme,
      promo: (promo || []).filter((x) => x.available) },
    login: { t: "login_ok", player: { id: 1, username: "marko", displayName: "Marko" },
      balance: 640, remainingSeconds: 19200, session: { id: 1, startedAt: Date.now() - 3600000 },
      // Igrac koji je vec igrao - da se na pocetnoj vidi "Nastavi gde si stao".
      // Prazan spisak pokazuje samo znak igraonice i ne kaze nista o rasporedu.
      skoroIgrane: [3, 1, 2],
      // Nagradni tocak u stanju "sme da vrti" - da se na slici Naloga vidi tocak.
      tocak: { ukljucen: true, prag: 1200, potroseno: 1450, ispunjava: true, moze: true, sledeciSpin: null,
        nagrade: [{ naziv: "30 din", kredit: 30 }, { naziv: "Ništa", kredit: 0 }, { naziv: "60 din", kredit: 60 },
          { naziv: "Ništa", kredit: 0 }, { naziv: "120 din", kredit: 120 }, { naziv: "250 din", kredit: 250 }] } },
  };

  // Jedan prozor za sve. Pravljenje i rusenje prozora u petlji je pucalo sa
  // ERR_FAILED: novo ucitavanje bi krenulo dok se prethodni prozor jos gasi.
  const win = new BrowserWindow({
    width: REZOLUCIJE[0].w, height: REZOLUCIJE[0].h, show: true, frame: false,
    webPreferences: { preload: path.join(RENDERER, "..", "preload.js"), contextIsolation: true },
  });

  const nalazi = [];
  for (const rez of REZOLUCIJE) {
    for (const ekran of EKRANI) {
      if (SAMO_EKRAN && !ekran.ime.includes(SAMO_EKRAN)) continue;

      win.setContentSize(rez.w, rez.h);
      await cekaj(120);
      // Sveze ucitavanje za svaki ekran, da se stanje prethodnog ne prenese.
      await win.loadFile(path.join(RENDERER, "index.html"));
      await cekaj(150);
      win.webContents.send("ws-status", { connected: true });
      await cekaj(250);
      // Ekrani koji sami salju svoj welcome (prazna stanja) ne dobijaju ovaj.
      if (!ekran.sam) posalji(win, poruke.welcome);
      await cekaj(500);
      await ekran.do(win, poruke);

      const mere = await win.webContents.executeJavaScript(MERE);
      const fajl = \`\${ekran.ime}-\${rez.ime}.png\`;
      // Snimak ne uspeva kad je ekran racunara zakljucan ili ugasen. Mere su i
      // dalje upotrebljive, pa kvar u slikanju ne obara ceo pregled.
      try {
        fs.writeFileSync(path.join(IZLAZ, fajl), (await win.webContents.capturePage()).toPNG());
      } catch (e) {
        mere.bezSlike = String((e && e.message) || e);
      }
      nalazi.push({ ekran: ekran.ime, opis: ekran.opis, rez: rez.ime, fajl, ocekivan: ekran.ocekivan, ...mere });
    }
  }
  win.destroy();
  // Novi prozor ne sme da krene dok se prethodni jos gasi - inace ucitavanje
  // pukne sa ERR_FAILED.
  await cekaj(500);

  // Obavestenja preko igre: svoj prozor, svoja stranica.
  // Kvar ovde ne sme da obori ceo pregled - ekrani launchera su vec snimljeni.
  if (!SAMO_EKRAN || SAMO_EKRAN === "obavestenja") {
    try {
      const ov = new BrowserWindow({
        width: 460, height: 160, show: true, frame: false,
        webPreferences: { preload: path.join(RENDERER, "..", "overlay-preload.js"), contextIsolation: true },
      });
      await ov.loadFile(path.join(RENDERER, "overlay.html"));
      await cekaj(400);
      for (const o of OBAVESTENJA) {
        ov.webContents.send("overlay-prikazi", o.podaci);
        await cekaj(500);
        const fajl = o.ime + "-obavestenje.png";
        try { fs.writeFileSync(path.join(IZLAZ, fajl), (await ov.webContents.capturePage()).toPNG()); } catch {}
        nalazi.push({ ekran: "obavestenje", opis: o.opis, rez: "preko igre", fajl,
          ocekivan: "obavestenje", preliv: 0, podTrakom: 0, viri: [], secen: [] });
      }
      ov.destroy();
    } catch (e) {
      console.log("OBAVESTENJA NISU SNIMLJENA: " + (e && e.message));
    }
  }

  console.log("NALAZI " + JSON.stringify(nalazi));
  app.quit();
});
`;

fs.writeFileSync(path.join(RADNO, "main.js"), MAIN, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "crit-pregled", version: "1.0.0", main: "main.js" }, null, 2), "utf8");

const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
if (!fs.existsSync(electron)) {
  console.error("Electron nije nadjen. Pokreni prvo: cd client && npm install");
  process.exit(1);
}

const p = spawn(electron, [RADNO], { shell: process.platform === "win32" });
let izlaz = "";
p.stdout.on("data", (d) => (izlaz += d));
p.stderr.on("data", (d) => (izlaz += d));
p.on("close", (kod) => {
  const m = /NALAZI (\[.*\])/s.exec(izlaz);
  if (!m) {
    console.error(izlaz.split("\n").filter((l) => l.trim() && !/DeprecationWarning|trace-deprecation/.test(l)).slice(-12).join("\n"));
    process.exit(kod || 1);
  }
  const nalazi = JSON.parse(m[1]);
  let problema = 0;
  console.log("PREGLED LAUNCHERA\n");
  let rezSad = "";
  for (const n of nalazi) {
    if (n.rez !== rezSad) { rezSad = n.rez; console.log(`  ${rezSad}`); }
    const greske = [];
    if (n.ekran !== n.ocekivan) greske.push(`nije stigao do ekrana (na "${n.ekran}", ocekivan "${n.ocekivan}")`);
    if (n.preliv > 1) greske.push(`ispada ${n.preliv}px van ekrana`);
    if (n.podTrakom > 1) greske.push(`ulazi ${n.podTrakom}px pod donju traku`);
    if (n.viri?.length) greske.push(`viri: ${n.viri.join(", ")}`);
    if (n.secen?.length) greske.push(`odsecen tekst: ${n.secen.join(" | ")}`);
    // Font se proverava svuda gde je predvidjen - ne sme da izostane na jednom
    // ekranu a bude na drugom.
    const bezFonta = Object.entries(n.fontovi || {})
      .filter(([, v]) => v && v !== "Chakra Petch").map(([k, v]) => `${k}=${v}`);
    if (bezFonta.length) greske.push(`nije gaming font: ${bezFonta.join(", ")}`);
    problema += greske.length;
    console.log(`    ${greske.length ? "PAZI" : "OK  "}  ${n.fajl.padEnd(26)} ${n.opis}`);
    for (const g of greske) console.log(`            -> ${g}`);
    // Praznina se meri, ne procenjuje - "deluje prazno" nije nalaz.
    // Ekrani bez police (prijava, zakljucan, nema veze) nemaju sta da prijave.
    if (n.razmaci && n.razmaci.hero > 0) {
      const r = n.razmaci;
      console.log(`            hero ${r.hero}px (${r.heroPrazno})   polica ${r.policaVisina}px, plocica ${r.plocicaVisina}px`
        + `   visak u polici ${r.policaPrazno}px   praznina do alata ${r.izmedjuPoliceIAlata}px`);
    }
  }
  console.log(`\nslike: testovi/.slike/  (${nalazi.length} komada)`);
  console.log(problema ? `nadjeno ${problema} stvari za pogledati` : "nista ne ispada iz ekrana");
  process.exit(0);
});
