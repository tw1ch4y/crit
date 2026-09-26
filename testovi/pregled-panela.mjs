// Pregled panela: slika svaku stranu i meri sta ispada iz ekrana, koji je tekst
// odsecen i koliko je strana popunjena.
//
//   node pregled-panela.mjs                 sve strane, 1920x1080 i 1366x768
//   node pregled-panela.mjs --rez 1366x768  samo jedna rezolucija
//   node pregled-panela.mjs --strana igraci samo jedna strana
//
// Kod koji se izvrsava u strani je u zasebnim fajlovima (u-strani/*.js).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { putanjaElektrona } from "./_okruzenje.mjs";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const arg = (ime, p) => { const i = process.argv.indexOf("--" + ime); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : p; };
const PORT = arg("port", "8096");
// Treća rezolucija je telefon (412x915, tipičan Android): panel na uskom
// ekranu ima svoj raspored (donja traka, profil u vrhu, upozorenja dole).
const REZOLUCIJE = arg("rez", "1920x1080,1366x768,412x915").split(",").map((r) => { const [w, h] = r.split("x").map(Number); return { w, h, ime: `${w}x${h}` }; });
const SAMO = arg("strana", "");
const RADNO = path.join(OVDE, ".radno", "pregled-panela");
const SLIKE = path.join(OVDE, ".slike-panel");

fs.rmSync(RADNO, { recursive: true, force: true });
fs.mkdirSync(path.join(RADNO, "u-strani"), { recursive: true });
fs.rmSync(SLIKE, { recursive: true, force: true });
fs.mkdirSync(SLIKE, { recursive: true });

// ---- kod koji se izvrsava u samoj strani ----
fs.writeFileSync(path.join(RADNO, "u-strani", "prijava.js"), `(() => {
  document.querySelector("#loginUser").value = "admin";
  document.querySelector("#loginPass").value = "admin";
  document.querySelector("#loginForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return true;
})()`, "utf8");

fs.writeFileSync(path.join(RADNO, "u-strani", "spisak.js"), `[...document.querySelectorAll("[data-view]")]
  .map((e) => ({ kljuc: e.dataset.view, ime: e.textContent.trim().replace(/\\d+$/, "").trim() }))`, "utf8");

fs.writeFileSync(path.join(RADNO, "u-strani", "mere.js"), `(() => {
  // Element koji viri, a nalazi se u kutiji koja ga secka, nikuda ne izlazi -
  // gledalac ga ne vidi. Isto pravilo kao kod launchera.
  const seckaGa = (e) => {
    for (let p = e.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflow !== "visible" || o.overflowX !== "visible" || o.overflowY !== "visible") return true;
    }
    return false;
  };
  const viri = [...document.querySelectorAll("body *")].filter((e) => {
    const b = e.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return false;
    if (getComputedStyle(e).position === "fixed") return false;
    return (b.right > innerWidth + 2 || b.left < -2) && !seckaGa(e);
  }).slice(0, 5).map((e) => (typeof e.className === "string" && e.className ? e.className.split(" ")[0] : e.tagName));

  // Tekst koji je NAMERNO skracen sa "..." i uz koji stoji ceo sadrzaj u title
  // atributu nije izgubljen - misem se vidi ceo. Kad bi se i to prijavljivalo,
  // alat bi na svakom pokretanju vikao na isto, pa bi se prestao citati i prava
  // greska bi prosla neprimeceno.
  const namerno = (e) => getComputedStyle(e).textOverflow === "ellipsis" && e.title.trim().length > 0;
  const secen = [...document.querySelectorAll("#main *")].filter((e) => {
    if (e.children.length) return false;
    if (namerno(e)) return false;
    return e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0;
  }).slice(0, 5).map((e) => (e.textContent || "").trim().slice(0, 30));

  const main = document.querySelector("#main");
  const okvir = main ? main.getBoundingClientRect() : null;
  // Koliko je strana stvarno popunjena: dokle dopire sadrzaj u odnosu na
  // raspolozivu visinu. Skoro prazna strana je znak da nesto fali.
  const dno = [...(main ? main.children : [])].map((e) => e.getBoundingClientRect().bottom).sort((a, b) => b - a)[0] || 0;
  // Tri stanja na svemu sto se klikce: prelazak, pritisak, fokus. Panel se koristi
  // i sa telefona (pritisak je jedina potvrda dodira) i tastaturom na kasi (fokus).
  // Pravila se citaju iz stvarnih stilova strane, ne iz izvora.
  const bezStanja = (() => {
    const pravila = { hover: [], pritisak: [], fokus: [] };
    // Uzima se deo selektora DO stanja: ".switch:active .slider" znaci da
    // prekidac REAGUJE, samo se pomera njegovo dete.
    const nosilac = (d, st) => {
      const i = d.indexOf(st);
      if (i < 0) return null;
      return d.slice(0, i).replace(/:(hover|active|focus-visible|focus|not\\([^)]*\\))/g, "").trim() || "*";
    };
    for (const ss of document.styleSheets) {
      let rr; try { rr = ss.cssRules; } catch (e) { continue; }
      for (const r of rr) {
        const sel = r.selectorText; if (!sel) continue;
        for (const deo of sel.split(",")) {
          const d = deo.trim();
          const h = nosilac(d, ":hover"); if (h) pravila.hover.push(h);
          const a2 = nosilac(d, ":active"); if (a2) pravila.pritisak.push(a2);
          const f = nosilac(d, ":focus-visible") || nosilac(d, ":focus"); if (f) pravila.fokus.push(f);
        }
      }
    }
    const ima = (el, lista) => lista.some((sel) => { try { return el.matches(sel); } catch (e) { return false; } });
    const jeKlik = (el) => el.namespaceURI !== "http://www.w3.org/2000/svg" &&
      (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].indexOf(el.tagName) >= 0 || getComputedStyle(el).cursor === "pointer");
    const van = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!el.offsetParent && el.tagName !== "INPUT") continue;
      // Sakriveno polje (kvacica, izbor fajla) NIJE ono sto covek dodiruje - to
      // je nacrtana kutija ili natpis oko njega, i stanje stoji na njoj. Polje
      // bez velicine se zato ne racuna, inace alat vice na nesto sto se ne vidi.
      const b0 = el.getBoundingClientRect();
      if (b0.width < 2 || b0.height < 2) continue;
      if (!jeKlik(el)) continue;
      let pokriven = false;
      for (let r = el.parentElement; r; r = r.parentElement) if (jeKlik(r)) { pokriven = true; break; }
      if (pokriven) continue;
      // Kartica koja u sebi ima svoje dugme ne mora sama da prima fokus.
      const svoje = !!el.querySelector("button, a[href], input");
      const fali = [];
      if (!ima(el, pravila.hover)) fali.push("hover");
      if (el.tagName !== "INPUT" && !ima(el, pravila.pritisak)) fali.push("pritisak");
      if (!svoje && !ima(el, pravila.fokus)) fali.push("fokus");
      if (fali.length) {
        const k = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).join(".") : "";
        van.push(el.tagName.toLowerCase() + (k ? "." + k : "") + " [" + fali.join("+") + "]");
      }
    }
    const g = {};
    for (const v of van) g[v] = (g[v] || 0) + 1;
    return Object.keys(g).map((k) => k + " x" + g[k]);
  })();

  return {
    bezStanja,
    naslov: main && main.querySelector("h1") ? main.querySelector("h1").textContent.trim() : null,
    tekstaZnakova: (main ? main.textContent : "").replace(/\\s+/g, " ").trim().length,
    popunjeno: okvir ? Math.round(100 * (dno - okvir.top) / Math.max(1, innerHeight - okvir.top)) : null,
    vodoravniPreliv: Math.round(document.documentElement.scrollWidth - innerWidth),
    viri, secen,
  };
})()`, "utf8");

// ---- glavni proces ----
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const IZLAZ = ${JSON.stringify(SLIKE)};
const BAZA = "http://127.0.0.1:${PORT}";
const REZOLUCIJE = ${JSON.stringify(REZOLUCIJE)};
const SAMO = ${JSON.stringify(SAMO)};
const uStrani = (ime) => fs.readFileSync(path.join(__dirname, "u-strani", ime + ".js"), "utf8");

process.on("uncaughtException", (e) => { console.log("PUKLO: " + (e && e.stack || e)); app.exit(1); });
process.on("unhandledRejection", (e) => { console.log("ODBIJENO: " + (e && e.stack || e)); app.exit(1); });
app.on("window-all-closed", () => {});
app.disableHardwareAcceleration();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: REZOLUCIJE[0].w, height: REZOLUCIJE[0].h, show: true, frame: false,
    webPreferences: { contextIsolation: true } });
  await win.loadURL(BAZA);
  await cekaj(900);
  await win.webContents.executeJavaScript(uStrani("prijava"));
  await cekaj(1800);

  const strane = await win.webContents.executeJavaScript(uStrani("spisak"));
  const mereKod = uStrani("mere");
  const nalazi = [];

  for (const rez of REZOLUCIJE) {
    win.setContentSize(rez.w, rez.h);
    await cekaj(400);
    for (const s of strane) {
      if (SAMO && s.kljuc.indexOf(SAMO) < 0) continue;
      await win.webContents.executeJavaScript(
        "(() => { const b = [...document.querySelectorAll('[data-view]')].find((e) => e.dataset.view === " +
        JSON.stringify(s.kljuc) + "); if (b) b.click(); return true; })()");
      await cekaj(1100);
      const mere = await win.webContents.executeJavaScript(mereKod);
      const fajl = s.kljuc + "-" + rez.ime + ".png";
      try { fs.writeFileSync(path.join(IZLAZ, fajl), (await win.webContents.capturePage()).toPNG()); }
      catch (e) { mere.bezSlike = String(e && e.message); }
      nalazi.push(Object.assign({}, s, { rez: rez.ime, fajl }, mere));
    }
  }
  win.destroy();
  console.log("NALAZI " + JSON.stringify(nalazi));
  app.quit();
});
`, "utf8");

fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "pregled-panela", version: "1.0.0", main: "main.js" }, null, 2), "utf8");

const electron = putanjaElektrona();
const p = spawn(electron, [RADNO]);
let izlaz = "";
p.stdout.on("data", (d) => (izlaz += d));
p.stderr.on("data", (d) => (izlaz += d));
p.on("close", (kod) => {
  const m = /NALAZI (\[.*\])/s.exec(izlaz);
  if (!m) {
    console.error(izlaz.split("\n").filter((l) => l.trim() && !/Deprecation|trace-dep/.test(l)).slice(-12).join("\n"));
    process.exit(kod || 1);
  }
  const nalazi = JSON.parse(m[1]);
  console.log("PREGLED PANELA\n");
  let problema = 0, rezSad = "";
  for (const n of nalazi) {
    if (n.rez !== rezSad) { rezSad = n.rez; console.log(`  ${rezSad}`); }
    const g = [];
    if (n.vodoravniPreliv > 1) g.push(`strana se pomera u stranu ${n.vodoravniPreliv}px`);
    if (n.viri?.length) g.push(`viri: ${n.viri.join(", ")}`);
    if (n.secen?.length) g.push(`odsecen tekst: ${n.secen.join(" | ")}`);
    if (!n.naslov) g.push("strana nema naslov");
    if (n.bezStanja?.length) g.push("bez svih stanja: " + n.bezStanja.join(", "));
    if (n.tekstaZnakova < 40) g.push(`strana je skoro prazna (${n.tekstaZnakova} znakova)`);
    problema += g.length;
    console.log(`    ${g.length ? "PAZI" : "OK  "}  ${n.fajl.padEnd(28)} ${String(n.ime).padEnd(18)} popunjeno ${String(n.popunjeno).padStart(3)}%`);
    for (const x of g) console.log(`            -> ${x}`);
  }
  console.log(`\nslike: testovi/.slike-panel/  (${nalazi.length} komada)`);
  console.log(problema ? `nadjeno ${problema} stvari za pogledati` : "nista ne ispada iz ekrana, i sve klikabilno ima hover, pritisak i fokus");
  process.exit(0);
});
