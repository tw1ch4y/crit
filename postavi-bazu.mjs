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
// Otpremljene slike stoje UZ BAZU (vidi UPLOADS u server/src/service.js) - one
// su podaci igraonice, pa se kopiraju sa bazom i ne mešaju se sa programom.
// Instalacija koja se tek seli ih još ima na starom mestu; server ih prenese
// sam pri pokretanju, a ova skripta ume da se pokrene i pre toga.
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

// ---- 1) IGRE ----
//
// OVA SKRIPTA NIŠTA NE BRIŠE. To je najvažnije pravilo ovde, i naučeno je
// skupo: ranije je radila `DELETE FROM games` pa upisivala svoj spisak. Svaka
// igra koju je vlasnik dodao kroz panel nestajala je pri svakom pokretanju - a
// odmah zatim bi korak 6 obrisao i njen omot sa diska, kao "orphan". Vlasnik je
// ponovo dodavao Apex Legends i World of Warcraft, ponovo kačio korice, i sve
// je opet nestajalo. (Po brojevima igara u bazi - 111 pa naviše - videlo se da
// se to desilo bar desetak puta.)
//
// Zato je sada DOPUNA: šta fali, upiše se; šta postoji, ne dira se. Ime je
// ključ, i poredi se bez obzira na velika slova i razmake.
//
// Naziv -> putanja (bez nastavka; launcher sam nađe .lnk/.url). Redosled je
// redosled u polici, i važi samo za one koje se TEK upisuju.
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
// Baneri igara se NE prave unapred. Baner je rezervna pozadina ekrana prijave i
// ima prednost nad omotom - a generisani baner je prazan šablon, pa bi na
// ekranu prijave pobedio pravu koricu igre. Osoblje ga okači ako ga hoće
// (Igre > izmena igre > Baner), ili ga napravi dugmetom u panelu.
// Skida se samo GENERISANI baner (`baner-igra-*`) - prazan šablon koji bi na
// ekranu prijave pobedio pravu koricu igre. Baner koji je vlasnik sam okačio
// ostaje: "UPDATE games SET banner=NULL" je brisalo i njega.
const skinuti = db.prepare("UPDATE games SET banner=NULL WHERE banner LIKE '%/baner-igra-%'").run().changes || 0;
// Promo baneri se NE prave unapred. Vrh početne nosi znak kuće (crit-logo.png)
// i widget nagradnog točka, sve iscrtano u launcheru. Ali ako je vlasnik promo
// ipak okačio, njegov je - ranije ga je `DELETE FROM promo` brisalo bez reči.
const promoIma = db.prepare("SELECT COUNT(*) c FROM promo").get().c;
log(`Baneri: skinuto ${skinuti} generisanih; promo: ${promoIma ? `${promoIma} zatečeno, ne dira se` : "nijedan"}`);

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
// Samo ako ih nema. Vlasnik koji je nagrade podesio po svojoj kući nije hteo da
// mu se vrate fabričke - a ranije ih je `DELETE FROM tocak_nagrade` vraćalo pri
// svakom pokretanju.
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

// ---- 6) očisti cover slike koje NIJEDNA igra više ne koristi ----
//
// Spisak se čita IZ BAZE, ne iz spiska gore. Ranije se brisalo sve što nije uz
// jednu od sedam ukucanih igara - a pošto je korak 1 te druge igre upravo
// obrisao, ovde bi nestale i njihove korice. Vlasnik ih je kačio iznova, i
// iznova ih gubio.
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
