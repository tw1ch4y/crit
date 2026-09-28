import { radniFolder, podigniServer, citajIzvor } from "./_okruzenje.mjs";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import path from "node:path";

// Sirov HTTP zahtev - fetch (undici) sam obradi 304 i vrati 200, pa bi merio
// svog klijenta umesto servera. Ovde se gleda tacan statusni broj koji server posalje.
function sirovi(putanja, zaglavlja = {}) {
  return new Promise((res, rej) => {
    const r = http.request(BASE + putanja, { headers: zaglavlja }, (o) => {
      let telo = ""; o.on("data", (d) => (telo += d));
      o.on("end", () => res({ status: o.statusCode, etag: o.headers.etag, cache: o.headers["cache-control"], telo }));
    });
    r.on("error", rej); r.end();
  });
}
// Dva razloga zbog kojih nadogradnja "ne uhvati": izgled i kesiran panel.
//
// 1. Igracu fali nov izgled. Tema i pokret pozadine se cuvaju u bazi. Postojeca
//    baza, napravljena pre tema, nema taj podatak - pa bi launcher ostao ravan.
//    Vlasnik zameni fajlove i ne vidi razliku.
// 2. Panelu fale sve izmene. style.css i app.js se ucitavaju bez oznake verzije,
//    pa pregledac posle nadogradnje servira staru, kesiranu stranu. Vlasnik se
//    zakune da se "nista nije promenilo".
const BASE = "http://127.0.0.1:8129";
const DATA = radniFolder("nadogradnja-data");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

// Napravi bazu KAO PRE nadogradnje: podesavanja starog sistema sara, bez
// ijednog zapisa o temi. Server pri pokretanju treba da postavi temu i da
// pocisti stare kljuceve.
{
  const db = new DatabaseSync(path.join(DATA, "crit.db"));
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
  db.exec("INSERT OR REPLACE INTO settings VALUES ('tekstura','crit'),('tekstura_kretanje','talas'),('tekstura_jacina','srednje')");
  db.close();
}

await podigniServer(DATA, 8129);

// ---- 1. tema se ukljuci na postojecoj bazi ----
const posle = new DatabaseSync(path.join(DATA, "crit.db"), { readOnly: true });
const nadji = (k) => posle.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
proveri("kucna tema je postavljena posle nadogradnje", nadji("tema_kuce") === "kuca", `tema_kuce=${nadji("tema_kuce")}`);
proveri("pozadina se lagano krece (inace se ne vidi da radi)", nadji("pokret") === "lagano", `pokret=${nadji("pokret")}`);
proveri("stara podesavanja sara su pociscena",
  ["tekstura", "tekstura_kretanje", "tekstura_jacina"].every((k) => nadji(k) === undefined));
posle.close();

// ---- 2. panel se servira sa verzijom u adresama ----
const html = await fetch(BASE + "/").then((r) => r.text());
proveri("index.html ima verziju u adresi CSS-a", /style\.css\?v=\d+\.\d+\.\d+/.test(html), html.match(/style\.css[^"]*/)?.[0]);
proveri("index.html ima verziju u adresi JS-a", /app\.js\?v=\d+\.\d+\.\d+/.test(html), html.match(/app\.js[^"]*/)?.[0]);
proveri("nije ostao nezamenjen oznaka __VERZIJA__", !html.includes("__VERZIJA__"));
proveri("verzija panela prati package.json",
  html.includes(JSON.parse(citajIzvor("server/package.json")).version),
  "inace se posle nadogradnje ne bi promenila adresa");

// Sama strana se ne sme kesirati - ona referise verzionirane fajlove, pa mora
// uvek da se povuce sveza da bi se videla nova verzija.
const strana = await sirovi("/");
proveri("strana se ne kesira", /no-cache/.test(strana.cache || ""), strana.cache);

// Fajl sa verzijom se servira i vraca ETag (pregledac tako dobija 304 umesto
// celog fajla kad se nije promenio).
const cssOdg = await sirovi("/css/style.css?v=1.0.0");
proveri("CSS se servira", cssOdg.status === 200, String(cssOdg.status));
proveri("CSS ima ETag za jeftinu proveru", !!cssOdg.etag);
const drugi = await sirovi("/css/style.css?v=1.0.0", { "If-None-Match": cssOdg.etag });
proveri("nepromenjen CSS vraca 304, ne ceo fajl", drugi.status === 304, String(drugi.status));

// ---- izvor ----
const db = citajIzvor("server/src/db.js");
const index = citajIzvor("server/src/index.js");
proveri("seed postavlja temu samo ako nije birana", db.includes('tema_kuce: "kuca"') && db.includes("getSetting(k) === null"));
proveri("server ubacuje verziju u panel", index.includes("__VERZIJA__") && index.includes("posaljiPanel"));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
