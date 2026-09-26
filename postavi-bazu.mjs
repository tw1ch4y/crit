// Puni bazu katalogom igraonice: igre iz C:\games, prečice sa logotipima,
// pozadine svih pet ekrana, vidljiv shop, šara, nagradni točak, vremenski paket.
//
// Pokretanje:  node postavi-bazu.mjs
// Radi nad server/data/crit.db (ili CRIT_DATA_DIR). Server ne sme da radi.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { pozadinaEkrana, POZADINE_EKRANI } from "./server/src/banner.js";

const ROOT = import.meta.dirname;
// Baza iz CRIT_DATA_DIR, isto kao svuda u projektu.
const DATA_DIR = process.env.CRIT_DATA_DIR || path.join(ROOT, "server", "data");
const DB = path.join(DATA_DIR, "crit.db");
// Slike stoje uz bazu (UPLOADS u server/src/service.js).
const UPLOADS = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });
{
  const staro = path.join(ROOT, "server", "public", "uploads");
  if (staro !== UPLOADS) {
    let imena = [];
    try { imena = fs.readdirSync(staro); } catch { imena = []; }
    for (const ime of imena) {
      const izvor = path.join(staro, ime), cilj = path.join(UPLOADS, ime);
      try { if (!fs.existsSync(cilj) && fs.statSync(izvor).isFile()) fs.copyFileSync(izvor, cilj); } catch {}
    }
  }
}
const db = new DatabaseSync(DB);
const log = (s) => console.log("  " + s);

// Tabele koje inače pravi server pri pokretanju - ovde ih osiguravamo da bi
// skripta radila i na bazi na kojoj server još nije bio pokrenut.
db.exec(`
  CREATE TABLE IF NOT EXISTS paketi (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, hours REAL NOT NULL, price REAL NOT NULL, available INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tocak_nagrade (id INTEGER PRIMARY KEY AUTOINCREMENT, naziv TEXT NOT NULL, kredit REAL NOT NULL DEFAULT 0, tezina INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0);
`);

// ---- 1) Igre ----
//
// Skripta ne briše ništa: upisuje igre koje fale, postojeće ne dira (ime je
// ključ, bez obzira na veličinu slova i razmake).
//
// Naziv -> putanja (bez nastavka; launcher sam nađe .lnk/.url). Redosled je
// redosled na polici, za igre koje se tek upisuju.
const IGRE = [
  ["Counter-Strike 2", "C:\\games\\cs2"],
  ["Valorant", "C:\\games\\valorant"],
  ["Fortnite", "C:\\games\\fortnite"],
  ["League of Legends", "C:\\games\\lol"],
  ["PUBG", "C:\\games\\pubg"],
  ["Minecraft", "C:\\games\\Minecraft"],
  ["Roblox", "C:\\games\\roblox"],
  ["Apex Legends", "C:\\games\\apex"],
  ["World of Warcraft", "C:\\games\\wow"],
];
const zadrzaneSlike = new Set();
const setSetting = (k, v) => db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));

const kljuc = (s) => String(s ?? "").trim().toLowerCase();
const postojece = db.prepare("SELECT id, name FROM games").all();
const imamo = new Set(postojece.map((g) => kljuc(g.name)));
const insG = db.prepare("INSERT INTO games (name, path, args, emoji, category, available, sort, image) VALUES (?,?,?,?,?,1,?,NULL)");
let novih = 0;
const odakleSort = (db.prepare("SELECT COALESCE(MAX(sort), -1) s FROM games").get().s ?? -1) + 1;
IGRE.forEach(([name, p]) => {
  if (imamo.has(kljuc(name))) return;
  insG.run(name, p, "", "", "Igre", odakleSort + novih);
  novih++;
});
log(`Igre: ${db.prepare("SELECT COUNT(*) c FROM games").get().c} ukupno` +
  (novih ? `, ${novih} novih` : ", nijedna nova") + " (postojeće se ne diraju)");

// ---- 2) ALATI: 6 aplikacija iz C:\games + 3 web, svi sa ugrađenim logom ----
const ALATI = [
  ["Steam", "app", "C:\\games\\Steam"],
  ["Epic Games", "app", "C:\\games\\epicgames"],
  ["Battle.net", "app", "C:\\games\\Battle"],
  ["Discord", "app", "C:\\games\\Discord"],
  ["TeamSpeak", "app", "C:\\games\\TeamSpeak"],
  ["FACEIT", "app", "C:\\games\\faceit"],
  ["YouTube", "web", "https://www.youtube.com"],
  ["Twitch", "web", "https://www.twitch.tv"],
  ["Google", "web", "https://www.google.com"],
];
// Isto pravilo kao kod igara: dopunjava se, ne briše. Vlasnik koji doda svoju
// prečicu (drugi launcher, sajt turnira) ne sme da je izgubi.
const imamoAlate = new Set(db.prepare("SELECT name FROM tools").all().map((t) => kljuc(t.name)));
const insT = db.prepare("INSERT INTO tools (name, kind, target, args, color, available, sort, created_at) VALUES (?,?,?,?,?,1,?,?)");
let novihAlata = 0;
const alatSortOd = (db.prepare("SELECT COALESCE(MAX(sort), -1) s FROM tools").get().s ?? -1) + 1;
ALATI.forEach(([name, kind, target]) => {
  if (imamoAlate.has(kljuc(name))) return;
  insT.run(name, kind, target, "", null, alatSortOd + novihAlata, Date.now());
  novihAlata++;
});
log(`Alati: ${db.prepare("SELECT COUNT(*) c FROM tools").get().c} ukupno` +
  (novihAlata ? `, ${novihAlata} novih` : ", nijedan nov"));

// ---- 3) BANERI: nijedan; vrh početne nosi znak kuće i točak ----
// Prvo obriši prethodne generisane banere iz uploads da se ne gomilaju.
for (const f of fs.readdirSync(UPLOADS)) {
  if (/^(baner-igra|promo-crit|poz-)/.test(f)) { try { fs.unlinkSync(path.join(UPLOADS, f)); } catch {} }
}
const upisiSvg = (prefix, svg) => {
  const fname = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}.svg`;
  fs.writeFileSync(path.join(UPLOADS, fname), svg, "utf8");
  return `/uploads/${fname}`;
};
// Generisani baneri igara (`baner-igra-*`) se skidaju: baner je rezervna
// pozadina prijave i imao bi prednost nad omotom. Baner koji je vlasnik
// okačio ostaje.
const skinuti = db.prepare("UPDATE games SET banner=NULL WHERE banner LIKE '%/baner-igra-%'").run().changes || 0;
// Promo baneri se ne prave; okačeni ostaju.
const promoIma = db.prepare("SELECT COUNT(*) c FROM promo").get().c;
log(`Baneri: skinuto ${skinuti} generisanih; promo: ${promoIma ? `${promoIma} zatečeno, ne dira se` : "nijedan"}`);

// ---- 3b) Pozadine ekrana (2560x1440) ----
for (const kljuc of POZADINE_EKRANI) {
  const url = upisiSvg(`poz-${kljuc}`, pozadinaEkrana(kljuc));
  setSetting(`pozadina_${kljuc}`, url);
  zadrzaneSlike.add(path.basename(url));
}
log(`Pozadine ekrana: ${POZADINE_EKRANI.length} (prijava, početna, shop, nalog, zaključan)`);

// Biblioteku instalacija pravi server pri prvom pokretanju (db.js).
log(`Instalacije: ${db.prepare("SELECT COUNT(*) c FROM programs").get().c} programa u biblioteci`);

// ---- 4) SHOP: prikaži sve artikle (fabrički su skriveni) ----
db.exec("UPDATE shop_items SET available=1");
for (const s of db.prepare("SELECT image FROM shop_items WHERE image IS NOT NULL").all()) zadrzaneSlike.add(path.basename(s.image));
log(`Shop: ${db.prepare("SELECT COUNT(*) c FROM shop_items").get().c} artikala vidljivo`);

// ---- 5) Podešavanja: šara, točak, paket ----
setSetting("tekstura", "kockice");
setSetting("tekstura_jacina", "slabo");
setSetting("tekstura_kretanje", "talas");
setSetting("tocak_ukljucen", "1");   // nagradni točak upaljen
setSetting("tocak_prag", "1200");
log("Šara: d20 kockice (slabo, talas), nagradni točak upaljen (prag 1200)");

// paket 5h/500 (ako ga nema)
if (db.prepare("SELECT COUNT(*) c FROM paketi").get().c === 0) {
  db.prepare("INSERT INTO paketi (name, hours, price, available, sort, created_at) VALUES ('5 sati',5,500,1,1,?)").run(Date.now());
}
// Nagrade točka (najveća 250 din), samo ako ih nema.
if (db.prepare("SELECT COUNT(*) c FROM tocak_nagrade").get().c === 0) {
  const insN = db.prepare("INSERT INTO tocak_nagrade (naziv, kredit, tezina, sort) VALUES (?,?,?,?)");
  [
    ["30 din", 30, 28, 1],
    ["Ništa", 0, 24, 2],
    ["60 din", 60, 21, 3],
    ["Ništa", 0, 16, 4],
    ["120 din", 120, 8, 5],
    ["250 din", 250, 3, 6],
  ].forEach((n) => insN.run(...n));
}
log("Vremenski paket 5h/500 i nagrade točka spremne");

// ---- 6) Omoti koje više nijedna igra ne koristi ----
//
// Spisak korišćenih se čita iz baze.
for (const g of db.prepare("SELECT image FROM games WHERE image IS NOT NULL AND image <> ''").all()) {
  zadrzaneSlike.add(path.basename(g.image));
}
for (const g of db.prepare("SELECT banner FROM games WHERE banner IS NOT NULL AND banner <> ''").all()) {
  zadrzaneSlike.add(path.basename(g.banner));
}
let obrisano = 0;
for (const f of fs.readdirSync(UPLOADS)) {
  if (/^game-\d+-/.test(f) && !zadrzaneSlike.has(f)) { try { fs.unlinkSync(path.join(UPLOADS, f)); obrisano++; } catch {} }
}
if (obrisano) log(`Očišćeno ${obrisano} slika koje nijedna igra ne koristi`);

db.close();
console.log("\n  Baza je postavljena. Sada pokreni:  node napravi-paket.mjs\n");
