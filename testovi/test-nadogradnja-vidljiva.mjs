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
// Dva razloga zbog kojih se nadogradnja ne vidi:
//
// 1. Stara baza nema podatak o sari i kretanju; bez njega launcher ne crta nista.
// 2. style.css i app.js bez oznake verzije pregledac posle nadogradnje servira
//    iz kesa.
const BASE = "http://127.0.0.1:8129";
const DATA = radniFolder("nadogradnja-data");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

// Napravi bazu KAO PRE nadogradnje: bez ijednog zapisa o teksturi. To radi tako
// sto prvi put digne server (napravi tabele i seed), pa obrise teksture, pa se
// server u testu ponovo digne i seed treba da ih vrati.
{
  // seed se dogodi pri prvom import-u; ovde samo obrisemo teksture iz gotove baze
  const db = new DatabaseSync(path.join(DATA, "crit.db"));
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
  db.close();
}

await podigniServer(DATA, 8129);

// ---- 1. sara se ukljuci na postojecoj bazi ----
const posle = new DatabaseSync(path.join(DATA, "crit.db"), { readOnly: true });
const nadji = (k) => posle.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
proveri("sara je ukljucena posle nadogradnje", nadji("tekstura") === "crit", `tekstura=${nadji("tekstura")}`);
proveri("kretanje nije 'mirno' (inace se ne vidi da radi)", nadji("tekstura_kretanje") === "talas", `kretanje=${nadji("tekstura_kretanje")}`);
proveri("jacina je postavljena", nadji("tekstura_jacina") === "srednje", `jacina=${nadji("tekstura_jacina")}`);
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
proveri("seed postavlja saru samo ako nije birana", /tekstura: "crit"[\s\S]{0,200}getSetting\(k\) === null/.test(db.replace(/\n/g, " ")) || (db.includes('tekstura: "crit"') && db.includes("getSetting(k) === null")));
proveri("server ubacuje verziju u panel", index.includes("__VERZIJA__") && index.includes("posaljiPanel"));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
