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
import { putanjaElektrona } from "./_okruzenje.mjs";
// Nivoi, znacke i pogodnosti se UZIMAJU iz programa, ne prepisuju ovde - isto
// kao u pregled-electron.mjs. Prepisan spisak bi zastareo cim se doda jedna
// znacka, a alat bi i dalje tvrdio da je sve provereno.
import { nivoZa, otkljucanoZa, BOJE_IMENA, OKVIRI } from "../server/src/nivoi.js";
import { znackeZa, GRUPE } from "../server/src/znacke.js";
import { VIP_BOJE, VIP_OKVIRI, POGODNOSTI } from "../server/src/vip.js";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");

// Profil izmisljenog igraca. Bez njega Nalog stoji na "Ucitavam profil" i
// nijedan odeljak se ne iscrta - a bas tu su kupovina VIP-a, rang lista, boje
// imena i okviri. Iskustvo je u SREDINI nivoa: prazna i puna traka izgledaju
// dobro same po sebi, greske se vide na pola.
const XP = 4200;
const N = nivoZa(XP);
const PROFIL = {
  username: "marko", ime: "Marko", clanOd: Date.now() - 240 * 24 * 3600 * 1000,
  nivo: N.nivo, naziv: N.naziv, xp: N.xp, uNivou: N.uNivou, zaSledeci: N.zaSledeci,
  doSledeceg: N.doSledeceg, poslednji: N.poslednji, sledeciNaziv: N.sledeciNaziv,
  sati: 96.5, poseta: 41, porudzbina: 63, omiljenaIgra: "Counter-Strike 2", omiljenaPuta: 28,
  izgled: { boja: "bela", okvir: "nema" }, otkljucano: otkljucanoZa(XP),
  boje: { ...BOJE_IMENA, ...VIP_BOJE }, okviri: { ...OKVIRI, ...VIP_OKVIRI },
  znacke: znackeZa({ sati: 96, poseta: 41, porudzbina: 63, najduzaSesijaMin: 340,
    ranoSesija: 1, kasnaSesija: 2, razlicitihIgara: 7, pokretanja: 210,
    najvisePutaIgra: 62, igaraUKatalogu: 12, najvisePutaArtikal: 24,
    spinova: 12, dobitakUkupno: 340, nedeljaZaredom: 5, danaOdUpisa: 240 }),
  grupeZnacaka: GRUPE,
  rekordi: { najduzaSesijaMin: 340, najboljiDan: { datum: "2026-08-14", iznos: 2400 },
    omiljenDan: 6, razlicitihIgara: 7, spinova: 12, dobitakUkupno: 340,
    nedeljaZaredom: 5, omiljenoPice: "Coca-Cola 0.5", omiljenoPicePuta: 24 },
  // VIP je UKLJUCEN i NIJE kupljen - jedino tako na profilu stoji dugme "Uzmi
  // VIP", a bas ono se ovde i proverava.
  clanarina: { ukljucen: true, jeVip: false, dana: 0, cena: 1500, trajanje: 30,
    mnozilac: 2, tocakPrag: 700, pogodnosti: POGODNOSTI },
  rang: {
    ukupno: 84,
    vrh: Array.from({ length: 10 }, (_, i) => {
      const b = 34200 - i * 2800, n = nivoZa(b);
      return { mesto: i + 1, ime: "Igrač " + (i + 1), nivo: n.nivo, naziv: n.naziv, xp: b,
        vip: i === 0, izgled: { boja: "bela", okvir: "nema" }, ja: false };
    }),
    komsiluk: [],
    ja: { mesto: 7, ime: "Marko", nivo: N.nivo, naziv: N.naziv, xp: XP, vip: false,
      izgled: { boja: "bela", okvir: "nema" }, ja: true, doSledecegMesta: 640, ispredMene: "Igrač 6" },
  },
};
const VIP_TRAKA = { nivo: N.nivo, naziv: N.naziv, xp: N.uNivou,
  xpDo: N.poslednji ? null : N.zaSledeci, poslednji: N.poslednji, sledeci: N.sledeciNaziv,
  vip: false, vipDana: 0 };
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
const PROFIL_JSON = ${JSON.stringify(PROFIL)};
const VIP_JSON = ${JSON.stringify(VIP_TRAKA)};
const OMOTAC_PUT = ${JSON.stringify(path.join(RADNO, "omotac-preload.js"))};

ipcMain.handle("program-icon", async () => null);
ipcMain.handle("get-config", () => ({ host: BAZA, token: "x", configured: true }));
ipcMain.handle("verzija", () => "proba");
ipcMain.handle("sys-stats", () => ({ cpu: 20, ramUsedPct: 44, ramGb: "16", temp: 40, uptime: 7200 }));
for (const k of ["save-config", "reset-config", "launch-game", "open-browser",
  "focus-launcher", "admin-exit", "renderer-ready", "podesavanja-citaj", "podesavanja-primeni", "proveri-servisni-pin", "otkljucaj-bez-servera"])
  ipcMain.handle(k, () => true);

// STA JE LAUNCHER STVARNO POSLAO SERVERU.
//
// Ostatak ovog alata proverava da klik ima slusaoca - to hvata mrtvo dugme, ali
// ne i dugme koje slusa a nista ne posalje. Kod kupovine VIP-a to je razlika
// izmedju "ne radi" i "uzeo pare": gost klikne, nista se ne desi, i on klikne
// ponovo. Zato se poruke ka serveru ovde pamte, pa se posle proverava da li je
// bas ona prava izasla.
const poslato = [];
ipcMain.handle("to-server", (e, poruka) => { poslato.push(poruka); return true; });
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const posalji = (w, m) => w.webContents.send("server-msg", m);

// Sve sto se klikce, po tome kako je oznaceno u launcheru.
const KLIKABILNO = [
  "button", "a[href]", "[data-game]", "[data-tool]", "[data-add]", "[data-inc]",
  "[data-dec]", "[data-kat]", "[data-nacin]", "[data-arr]", "[data-promo-idi]",
  "[data-moja-sara]", "[data-moja-jacina]", "[data-moja-kretanje]", ".tab", ".tile",
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
  return { van, bezStanja: stanjaVan(), slusalaca: window.__slusaoci ? window.__slusaoci.size : -1, crit: typeof window.crit, ekranAktivan: ([...document.querySelectorAll(".screen")].find((e) => e.classList.contains("active")) || {}).id, skenirano: document.querySelectorAll(\${JSON.stringify(KLIKABILNO)}).length, tocakOtvoren: document.querySelector("#tocakOverlay").classList.contains("active") };
})()\`;

// TRI STANJA NA SVEMU STO SE KLIKCE.
//
// Klik koji stize do koda jos ne znaci da se od njega nesto VIDI. Kiosk radi na
// jeftinim misevima i na mrezi koja ume da zastane; kad se pritisak ne vidi,
// igrac klikne drugi put. A fokusa nije imao NIJEDAN element: igrac se prijavljuje
// tastaturom (ime, Tab, lozinka, Enter) i nije video gde je, a kad mis zataji
// usred smene, radnik nije mogao da dodje ni do "Odjava".
//
// Pravila se citaju iz STVARNIH stilova ucitanih u prozoru, ne iz izvora - tako
// se hvata i ono sto je pravilom prekriveno ili pogresno napisano.
const STANJA = \`
window.stanjaVan = function () {
  const pravila = { hover: [], pritisak: [], fokus: [] };
  for (const ss of document.styleSheets) {
    let rr; try { rr = ss.cssRules; } catch (e) { continue; }
    for (const r of rr) {
      const s = r.selectorText; if (!s) continue;
      // Uzima se DEO SELEKTORA DO stanja, ne ceo selektor.
      //
      // ".hero-tocak:active .hw-tocak" znaci da tocak REAGUJE na pritisak - samo
      // se pomera njegovo dete. Kad se iz celog selektora samo izbaci ":active",
      // ostane ".hero-tocak .hw-tocak", sto ne odgovara samom tocku, pa bi alat
      // prijavio da pritisak ne postoji iako se lepo vidi.
      const nosilac = function (d, stanje) {
        const i = d.indexOf(stanje);
        if (i < 0) return null;
        // sve do stanja je element koji ga NOSI; ostala stanja na njemu se skidaju
        return d.slice(0, i).replace(/:(hover|active|focus-visible|focus|not\\([^)]*\\))/g, "").trim() || "*";
      };
      for (const deo of s.split(",")) {
        const d = deo.trim();
        const h = nosilac(d, ":hover"); if (h) pravila.hover.push(h);
        const a = nosilac(d, ":active"); if (a) pravila.pritisak.push(a);
        const f = nosilac(d, ":focus-visible") || nosilac(d, ":focus"); if (f) pravila.fokus.push(f);
      }
    }
  }
  const ima = function (el, lista) {
    for (const sel of lista) { try { if (el.matches(sel)) return true; } catch (e) {} }
    return false;
  };
  const jeKlik = function (el) {
    if (el.namespaceURI === "http://www.w3.org/2000/svg") return false;
    if (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].indexOf(el.tagName) >= 0) return true;
    return getComputedStyle(el).cursor === "pointer";
  };
  const van = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!el.offsetParent && el.tagName !== "INPUT") continue;
    // Sakriveno polje (kvacica, izbor fajla) NIJE ono sto covek dodiruje - to je
    // nacrtana kutija ili natpis oko njega, i stanje stoji na njoj.
    const b0 = el.getBoundingClientRect();
    if (b0.width < 2 || b0.height < 2) continue;
    if (!jeKlik(el)) continue;
    // Racuna se samo NAJVISI klikabilni element: deca naslede pokazivac, a igrac
    // klikce na celu plocicu, ne na natpis u njoj.
    let pokriven = false;
    for (let r = el.parentElement; r; r = r.parentElement) if (jeKlik(r)) { pokriven = true; break; }
    if (pokriven) continue;
    // Kartica koja U SEBI ima svoje dugme ne mora sama da prima fokus - tastatura
    // do nje stize kroz to dugme (kartica pica i njeno "+"). Dugme u dugmetu nije
    // ispravno, pa se ovde i ne trazi.
    const svojeDugme = !!el.querySelector("button, a[href], input");
    const fali = [];
    if (!ima(el, pravila.hover)) fali.push("hover");
    if (el.tagName !== "INPUT" && !ima(el, pravila.pritisak)) fali.push("pritisak");
    if (!svojeDugme && !ima(el, pravila.fokus)) fali.push("fokus");
    if (fali.length) {
      const kls = typeof el.className === "string" ? el.className.trim().split(/\\\\s+/).filter(Boolean).join(".") : "";
      van.push({ znak: el.tagName.toLowerCase() + (kls ? "." + kls : ""), fali: fali.join("+") });
    }
  }
  // Isti oblik se javlja jednom, sa brojem - inace bi sedamnaest kartica pica
  // dalo sedamnaest istih redova.
  const grupe = {};
  for (const v of van) { const k = v.znak + " [" + v.fali + "]"; grupe[k] = (grupe[k] || 0) + 1; }
  return Object.keys(grupe).map(function (k) { return k + " x" + grupe[k]; });
};
// Poslednja vrednost mora da bude prenosiva. Bez ovoga se vraca sama funkcija,
// koju Electron ne ume da prenese iz prozora - executeJavaScript odbije obecanje,
// lanac se prekine PRE nego sto se postavi cuvar vremena, i alat visi zauvek sa
// otvorenim prozorom, bez ijednog reda ispisa.
true;
\`;

app.whenReady().then(async () => {
  const prijava = await fetch(BAZA + "/api/login", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json());
  const uzmi = (p) => fetch(BAZA + p, { headers: { authorization: "Bearer " + prijava.token } }).then((r) => r.json());
  const [shop, games, tools, tex] = await Promise.all(
    ["/api/shop", "/api/games", "/api/tools", "/api/tekstura"].map(uzmi));

  const win = new BrowserWindow({ width: 1600, height: 900, show: true, frame: false,
    webPreferences: { preload: OMOTAC_PUT, contextIsolation: true } });
  await win.loadFile(path.join(RENDERER, "index.html"));
  win.webContents.send("ws-status", { connected: true });
  await win.webContents.executeJavaScript(STANJA);
  await cekaj(400);

  const tocak = { ukljucen: true, moze: true, prag: 1200, potroseno: 1500, nagrade: [
    { id: 1, naziv: "30 din", kredit: 30 }, { id: 2, naziv: "Ništa", kredit: 0 },
    { id: 3, naziv: "60 din", kredit: 60 }, { id: 4, naziv: "250 din", kredit: 250 } ] };
  const tekstura = { kljuc: "kockice", sara: tex.spisak.kockice.sara, prozirnost: 0.5,
    korak: tex.spisak.kockice.korak, sekundi: 15, kretanje: "talas" };

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
    shop, games, tools, pozadine: {}, promo: [], tekstura,
    teksture: { spisak: tex.spisak, jacine: tex.jacine, kretanja: tex.kretanja, prozirnosti: tex.prozirnosti } });
  posalji(win, { t: "to_login" });
  await cekaj(700);
  korak("ekran prijave"); nalazi["ekran prijave"] = await js(PREGLED);

  // 2) Prijavljen: pocetna, shop, nalog
  posalji(win, { t: "login_ok", player: { id: 1, username: "marko", displayName: "Marko" },
    balance: 640, remainingSeconds: 19200, session: { id: 1, startedAt: Date.now() },
    skoroIgrane: [], tocak, tekstura,
    // Bez profila Nalog stoji na "Ucitavam profil" i nijedan odeljak se ne
    // iscrta - racuna se u omotacu, jer glavni proces je zaseban fajl.
    profil: PROFIL_JSON, vip: VIP_JSON,
    teksture: { spisak: tex.spisak, jacine: tex.jacine, kretanja: tex.kretanja, prozirnosti: tex.prozirnosti } });
  await cekaj(4200);
  korak("pocetna"); nalazi["pocetna"] = await js(PREGLED);

  await klik('.tab[data-tab="shop"]'); await cekaj(700);
  // Nesto u korpu, da se pojave i dugmad korpe i koracnik na kartici.
  await klik(".pice-plus"); await cekaj(300);
  korak("shop"); nalazi["shop"] = await js(PREGLED);

  await klik('.tab[data-tab="account"]'); await cekaj(700);
  korak("nalog"); nalazi["nalog"] = await js(PREGLED);

  // NALOG JE MENI SA SEDAM ODELJAKA, A GLEDAO SE SAMO PRVI.
  //
  // Dok se prijava slala bez profila, Nalog je stajao na "Ucitavam profil" i
  // nijedan od njih se nije ni iscrtao. Tako su bas najnoviji ekrani - profil sa
  // kupovinom VIP-a, rang lista i znacke - ostali van svake provere.
  for (const [kljuc, ime] of [["profil", "nalog > profil"], ["rang", "nalog > rang lista"],
    ["porudzbine", "nalog > porudzbine"], ["nagrade", "nalog > nagrade"],
    ["podesavanja", "nalog > mis i zvuk"], ["pozadina", "nalog > pozadina"],
    ["lozinka", "nalog > lozinka"]]) {
    await klik('[data-acc-sekcija="' + kljuc + '"]'); await cekaj(600);
    korak(ime); nalazi[ime] = await js(PREGLED);
  }

  // KUPOVINA VIP-A: KLIK MORA DA IZADJE IZ LAUNCHERA.
  //
  // Ovde se skida kredit, pa nije dovoljno da dugme ima slusaoca. Gost koji
  // klikne i ne vidi nista klikne ponovo - a ako poruka izlazi, drugi klik ne
  // sme da je posalje jos jednom dok prvi ne dobije odgovor.
  await klik('[data-acc-sekcija="profil"]'); await cekaj(600);
  poslato.length = 0;
  await klik("#vipKupi"); await cekaj(300);
  const prviKlik = poslato.filter((m) => m && m.t === "kupi_vip").length;
  await klik("#vipKupi"); await cekaj(300);
  const posleDrugog = poslato.filter((m) => m && m.t === "kupi_vip").length;
  // Ime pocinje donjom crtom: to nije merenje ekrana nego poseban nalaz, pa ga
  // petlje koje broje mrtva dugmad preskacu.
  nalazi["_kupovinaVipa"] = { poslato: prviKlik, posleDvaKlika: posleDrugog,
    zakljucano: await js('(() => { const b = document.querySelector("#vipKupi"); return !!b && b.disabled; })()') };

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

const electron = putanjaElektrona();
const p = spawn(electron, [RADNO]);
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
    if (ekran.startsWith("_")) continue;
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

  // TRI STANJA - hover, pritisak, fokus - na svemu sto se klikce.
  //
  // Klik koji stize do koda jos ne znaci da se od njega nesto VIDI. Kad se
  // pritisak ne vidi, igrac klikne drugi put; a bez fokusa se tastaturom ne
  // moze ni prijaviti ni doci do "Odjava" kad mis zataji.
  let bezStanja = 0;
  for (const [ekran, rez] of Object.entries(nalazi)) {
    if (ekran.startsWith("_")) continue;
    const b = rez.bezStanja;
    if (!Array.isArray(b) || !b.length) continue;
    bezStanja += b.length;
    console.log(`  PAO  ${ekran} - ${b.length} bez svih stanja:`);
    for (const v of b) console.log("         " + v);
  }
  if (!bezStanja) console.log("  OK   svako klikabilno ima hover, pritisak i fokus");

  let mrtvih = 0;
  for (const [ekran, rez] of Object.entries(nalazi)) {
    if (ekran.startsWith("_")) continue;
    const van = rez.van || rez;
    if (!van.length) { console.log(`  OK   ${ekran}  (pregledano ${rez.skenirano})`); continue; }
    mrtvih += van.length;
    console.log(`  PAO  ${ekran} - ${van.length} bez slusaoca:`);
    for (const v of van) console.log(`         ${v.znak}  "${v.tekst}"  (u ${v.ekran})`);
  }

  // KUPOVINA VIP-A: OVDE SE SKIDA KREDIT.
  //
  // Slusalac na dugmetu nije dovoljan - dugme sme da slusa a da nista ne
  // posalje. A drugi klik, koji gost napravi kad se prvi put nista ne vidi, ne
  // sme da posalje istu poruku jos jednom: to bi bila dva puta naplacena
  // clanarina.
  let vipLose = 0;
  const kv = nalazi._kupovinaVipa;
  if (!kv) {
    console.log("  PAO  kupovina VIP-a - nalaz nije ni stigao");
    vipLose++;
  } else {
    if (kv.poslato === 1) console.log("  OK   klik na 'Uzmi VIP' stvarno salje poruku serveru");
    else { console.log(`  PAO  klik na 'Uzmi VIP' poslao ${kv.poslato} poruka (ocekivano 1)`); vipLose++; }
    if (kv.posleDvaKlika === 1) console.log("  OK   drugi klik ne salje jos jednom (dvostruka naplata)");
    else { console.log(`  PAO  dva klika poslala ${kv.posleDvaKlika} poruka - clanarina bi se naplatila dvaput`); vipLose++; }
    if (kv.zakljucano) console.log("  OK   dugme je zakljucano dok se ceka odgovor");
    else { console.log("  PAO  dugme ostaje otkljucano dok se ceka odgovor"); vipLose++; }
  }

  console.log(mrtvih ? `\n${mrtvih} dugmadi ne stize do koda` : "\nsvako dugme stize do koda");
  if (bezStanja) console.log(`${bezStanja} oblika bez nekog od tri stanja`);
  process.exit(mrtvih || bezStanja || vipLose ? 1 : 0);
});
