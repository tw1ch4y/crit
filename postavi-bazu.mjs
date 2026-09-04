// Postavlja bazu tako da igraonica ODMAH radi: prave igre iz C:\games sa
// pravim prečicama, 9 alata sa logotipima, pozadine svih pet ekrana,
// vidljiv shop, upaljena tekstura i nagradni točak, vremenski paket.
//
// Pokreni:  node postavi-bazu.mjs
// Radi na server/data/crit.db (baza koja se pakuje). Server NE sme da radi.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { pozadinaEkrana, POZADINE_EKRANI } from "./server/src/banner.js";

const ROOT = import.meta.dirname;
// ODAKLE BAZA - ISTO PRAVILO KAO SVUDA U PROJEKTU.
//
// Ovo je pisalo pravo u `server/data`, mimo `CRIT_DATA_DIR` koji postuje sve
// ostalo. Ko god pokrene ovu skriptu misleci da radi nad probnom bazom -
// obrise prave igre, alate i nagrade iz razvojne. Skripta radi tacno ono sto
// treba, samo nad pogresnim fajlom, pa greska ne izgleda kao greska.
const DATA_DIR = process.env.CRIT_DATA_DIR || path.join(ROOT, "server", "data");
const DB = path.join(DATA_DIR, "crit.db");
const UPLOADS = path.join(ROOT, "server", "public", "uploads");
const db = new DatabaseSync(DB);
const log = (s) => console.log("  " + s);

// Tabele koje inače pravi server pri pokretanju - ovde ih osiguravamo da bi
// skripta radila i na bazi na kojoj server još nije bio pokrenut.
db.exec(`
  CREATE TABLE IF NOT EXISTS paketi (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, hours REAL NOT NULL, price REAL NOT NULL, available INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tocak_nagrade (id INTEGER PRIMARY KEY AUTOINCREMENT, naziv TEXT NOT NULL, kredit REAL NOT NULL DEFAULT 0, tezina INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0);
`);

// ---- 1) IGRE: samo one koje stvarno postoje kao prečica u C:\games ----
// Naziv -> putanja (bez nastavka; launcher sam nađe .lnk/.url). Redosled je
// redosled u polici.
const IGRE = [
  ["Counter-Strike 2", "C:\\games\\cs2"],
  ["Valorant", "C:\\games\\valorant"],
  ["Fortnite", "C:\\games\\fortnite"],
  ["League of Legends", "C:\\games\\lol"],
  ["PUBG", "C:\\games\\pubg"],
  ["Minecraft", "C:\\games\\Minecraft"],
  ["Roblox", "C:\\games\\roblox"],
];
// Zadrži cover slike koje su već okačene - poveži ih po imenu igre.
const stareIgre = db.prepare("SELECT id, name, image, banner FROM games").all();
const coverPoImenu = new Map(stareIgre.map((g) => [g.name.trim().toLowerCase(), g.image]));

// Obriši stare banere (regenerišu se), zapamti koje cover slike ostaju u upotrebi.
const zadrzaneSlike = new Set();
const setSetting = (k, v) => db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));
db.exec("DELETE FROM games");
const insG = db.prepare("INSERT INTO games (name, path, args, emoji, category, available, sort, image) VALUES (?,?,?,?,?,1,?,?)");
IGRE.forEach(([name, p], i) => {
  const cover = coverPoImenu.get(name.trim().toLowerCase()) || null;
  if (cover) zadrzaneSlike.add(path.basename(cover));
  insG.run(name, p, "", "", "Igre", i, cover);
});
log(`Igre: ${IGRE.length} (sa pravim prečicama iz C:\\games)`);

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
db.exec("DELETE FROM tools");
const insT = db.prepare("INSERT INTO tools (name, kind, target, args, color, available, sort, created_at) VALUES (?,?,?,?,?,1,?,?)");
ALATI.forEach(([name, kind, target], i) => insT.run(name, kind, target, "", null, i, Date.now()));
log(`Alati: ${ALATI.length} (${ALATI.filter((a) => a[1] === "app").length} iz C:\\games + ${ALATI.filter((a) => a[1] === "web").length} web)`);

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
// Baneri igara se NE prave unapred. Baner je rezervna pozadina ekrana prijave i
// ima prednost nad omotom - a generisani baner je prazan šablon, pa bi na
// ekranu prijave pobedio pravu koricu igre. Osoblje ga okači ako ga hoće
// (Igre > izmena igre > Baner), ili ga napravi dugmetom u panelu.
db.prepare("UPDATE games SET banner=NULL").run();
// Promo baneri se NE prave unapred. Vrh početne sada nosi pravi znak kuće
// (crit-logo.png) i widget nagradnog točka, sve iscrtano u launcheru. Okačen
// promo baner bi to prekrio, pa ostaje na volju osoblju kroz panel.
db.exec("DELETE FROM promo");
log("Baneri i promo: nijedan (vrh početne nosi znak kuće i nagradni točak)");

// ---- 3b) POZADINE EKRANA (2560x1440) ----
// Bez njih je ekran prijave razvlačio baner izdvojene igre (2800x400) preko
// celog ekrana i menjao ga pri svakom osvežavanju kataloga - pozadina je
// "skakala". Ove su u pravom odnosu i mirne.
for (const kljuc of POZADINE_EKRANI) {
  const url = upisiSvg(`poz-${kljuc}`, pozadinaEkrana(kljuc));
  setSetting(`pozadina_${kljuc}`, url);
  zadrzaneSlike.add(path.basename(url));
}
log(`Pozadine ekrana: ${POZADINE_EKRANI.length} (prijava, početna, shop, nalog, zaključan)`);

// Biblioteka instalacija je FABRIČKI sadržaj i pravi je server pri prvom
// pokretanju (db.js) - Steam i Discord trebaju svakoj igraonici, pa se ne
// podešavaju po kući kao igre i šara. Ovde se samo javi šta je zateknuto.
log(`Instalacije: ${db.prepare("SELECT COUNT(*) c FROM programs").get().c} programa u biblioteci`);

// ---- 4) SHOP: prikaži sve artikle (fabrički su skriveni) ----
db.exec("UPDATE shop_items SET available=1");
for (const s of db.prepare("SELECT image FROM shop_items WHERE image IS NOT NULL").all()) zadrzaneSlike.add(path.basename(s.image));
log(`Shop: ${db.prepare("SELECT COUNT(*) c FROM shop_items").get().c} artikala vidljivo`);

// ---- 5) PODEŠAVANJA: tekstura, točak, paket ----
// Sara: sitna d20 kockica koja se ponavlja. Ranije je stajala rec "CRIT" i to
// je preko praznog ekrana izgledalo kao vodeni zig, a ne kao tekstura.
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
// Nagrade točka. Najveća je 250 din; retka, da ostane vredna. Šest polja je
// taman toliko da se svako pročita dok se točak vrti.
db.exec("DELETE FROM tocak_nagrade");
{
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

// ---- 6) očisti cover slike igara koje su izbačene (orphani) ----
let obrisano = 0;
for (const f of fs.readdirSync(UPLOADS)) {
  if (/^game-\d+-/.test(f) && !zadrzaneSlike.has(f)) { try { fs.unlinkSync(path.join(UPLOADS, f)); obrisano++; } catch {} }
}
if (obrisano) log(`Očišćeno ${obrisano} cover slika izbačenih igara`);

db.close();
console.log("\n  Baza je postavljena. Sada pokreni:  node napravi-paket.mjs\n");
