// Koliko baza naraste za godinu dana rada igraonice od trinaest racunara:
// velicina baze i kopija, brzina Logova i izvestaja. Puni pravu bazu kroz pravu
// semu, istim redosledom kao igraonica.
//
//   node godina-rada.mjs            365 dana
//   node godina-rada.mjs --dana 90
//   node godina-rada.mjs --dana 730
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const arg = (i, p) => { const k = process.argv.indexOf("--" + i); return k > 0 && process.argv[k + 1] ? process.argv[k + 1] : p; };
const DANA = Number(arg("dana", "365"));
const RADNO = path.join(OVDE, ".radno", "godina");
fs.rmSync(RADNO, { recursive: true, force: true });
fs.mkdirSync(RADNO, { recursive: true });

// Sema se uzima iz pravog servera, da merenje ne bude na izmisljenoj bazi.
process.env.CRIT_DATA_DIR = RADNO;
process.env.PORT = "8177";
const { db } = await import(new URL("../server/src/db.js", import.meta.url).href);

const RACUNARA = 13;
const SESIJA_PO_RACUNARU = 4;      // prosecan dan
const IGARA_PO_SESIJI = 3;
const LOGOVA_PO_SESIJI = 12;       // prijava, odjava, zakljucavanje, porudzbina, komanda...
const PORUDZBINA_DNEVNO = 40;
const IGRACA = 400;                // stalni gosti kroz godinu

const sad = Date.now();
const DAN = 86400000;
const nasumicno = (n) => Math.floor(Math.random() * n);

console.log(`Punim ${DANA} dana rada (${RACUNARA} računara)...`);
const pocetak = Date.now();

db.exec("PRAGMA foreign_keys=OFF");
db.exec("BEGIN");

// Racunari, artikli i igre su vec tu iz pocetnog punjenja servera - koriste se
// ti, da baza ostane onakva kakva stvarno bude u igraonici.
const idRacunara = db.prepare("SELECT id FROM computers ORDER BY id").all().map((r) => r.id);
const idArtikala = db.prepare("SELECT id FROM shop_items ORDER BY id").all().map((r) => r.id);
const idIgara = db.prepare("SELECT id FROM games ORDER BY id").all().map((r) => r.id);
if (!idIgara.length) { db.prepare("INSERT INTO games (name, path, category) VALUES ('Igra','C:\\\\g','Igre')").run(); idIgara.push(db.prepare("SELECT last_insert_rowid() id").get().id); }

for (let i = 1; i <= IGRACA; i++)
  db.prepare("INSERT INTO players (username, password_hash, display_name, balance, created_at) VALUES (?,?,?,?,?)")
    .run("igrac" + i, "x", "Igrač " + i, 500, sad);
const idIgraca = db.prepare("SELECT id FROM players ORDER BY id").all().map((r) => r.id);
const bilo = (a) => a[Math.floor(Math.random() * a.length)];

const uSesiju = db.prepare("INSERT INTO sessions (player_id, computer_id, started_at, ended_at, cost, status) VALUES (?,?,?,?,?,'ended')");
const uLog = db.prepare("INSERT INTO logs (ts, category, action, actor, target, detail, amount) VALUES (?,?,?,?,?,?,?)");
const uIgru = db.prepare("INSERT INTO game_launches (game_id, player_id, computer_id, at) VALUES (?,?,?,?)");
const uPorudzbinu = db.prepare("INSERT INTO orders (player_id, computer_id, total, status, payment, source, created_at) VALUES (?,?,?,'delivered',?,'client',?)");
const uStavku = db.prepare("INSERT INTO order_items (order_id, item_id, name, price, qty) VALUES (?,?,?,?,?)");
const uPromet = db.prepare("INSERT INTO transactions (player_id, type, amount, balance_after, admin_id, note, created_at) VALUES (?,?,?,?,NULL,?,?)");
const uSmenu = db.prepare("INSERT INTO shifts (admin_id, admin_username, opened_at, closed_at, opening_cash, closing_cash) VALUES (NULL,'radnik',?,?,?,?)");

const KATEGORIJE = ["prijava", "sesija", "novac", "shop", "racunar", "nalozi", "sistem"];
const OPIS = "Igrač se prijavio na računar i sesija je pokrenuta bez greške";

for (let d = DANA; d > 0; d--) {
  const dan = sad - d * DAN;
  uSmenu.run(dan + 10 * 3600000, dan + 24 * 3600000, 5000, 5000 + nasumicno(40000));

  for (const pc of idRacunara) {
    for (let s = 0; s < SESIJA_PO_RACUNARU; s++) {
      const kad = dan + (10 + s * 3) * 3600000 + nasumicno(3600000);
      const igrac = bilo(idIgraca);
      uSesiju.run(igrac, pc, kad, kad + 5400000, 180 + nasumicno(300));
      uPromet.run(igrac, "session", -(180 + nasumicno(300)), nasumicno(2000), "Sesija", kad);
      for (let g = 0; g < IGARA_PO_SESIJI; g++) uIgru.run(bilo(idIgara), igrac, pc, kad + g * 900000);
      for (let l = 0; l < LOGOVA_PO_SESIJI; l++)
        uLog.run(kad + l * 60000, KATEGORIJE[nasumicno(KATEGORIJE.length)], "radnja", "igrac" + igrac, `PC-${pc}`, OPIS, null);
    }
  }
  for (let o = 0; o < PORUDZBINA_DNEVNO; o++) {
    const kad = dan + 12 * 3600000 + nasumicno(10 * 3600000);
    const igrac = bilo(idIgraca);
    uPorudzbinu.run(igrac, bilo(idRacunara), 300, o % 3 ? "credit" : "cash", kad);
    const oid = db.prepare("SELECT last_insert_rowid() id").get().id;
    for (let i = 0; i < 2; i++) uStavku.run(oid, bilo(idArtikala), "Artikal", 150, 1);
    uPromet.run(igrac, "shop", -300, nasumicno(2000), "Shop", kad);
    if (o % 4 === 0) uPromet.run(igrac, "topup", 1000, nasumicno(3000), "Dopuna kešom", kad);
  }
}
db.exec("COMMIT");

const broj = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
const tabele = ["logs", "sessions", "game_launches", "orders", "order_items", "transactions", "shifts"];
const redovi = Object.fromEntries(tabele.map((t) => [t, broj(t)]));

db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
const mb = (n) => (n / 1048576).toFixed(1) + " MB";
const velicina = fs.statSync(path.join(RADNO, "crit.db")).size;

console.log(`\nnapunjeno za ${((Date.now() - pocetak) / 1000).toFixed(0)} s\n`);
console.log(`  BAZA POSLE ${DANA} DANA:  ${mb(velicina)}\n`);
for (const t of tabele) console.log(`    ${t.padEnd(16)} ${String(redovi[t]).padStart(9)} redova`);

// ---- koliko traju upiti koje panel stvarno radi ----
const meri = (ime, fn) => {
  const t0 = performance.now();
  const r = fn();
  const ms = performance.now() - t0;
  console.log(`    ${ime.padEnd(38)} ${ms.toFixed(0).padStart(5)} ms`);
  return { ms, r };
};
console.log("\n  STRANE PANELA:");
meri("Logovi (prva strana, 100 redova)", () => db.prepare("SELECT * FROM logs ORDER BY ts DESC LIMIT 100").all());
meri("Logovi filtrirani po kategoriji", () => db.prepare("SELECT * FROM logs WHERE category='novac' ORDER BY ts DESC LIMIT 100").all());
meri("Logovi pretraga po tekstu", () => db.prepare("SELECT * FROM logs WHERE detail LIKE '%greške%' ORDER BY ts DESC LIMIT 100").all());
meri("Izveštaj za danas", () => db.prepare("SELECT type, SUM(amount) s FROM transactions WHERE created_at > ? GROUP BY type").all(sad - DAN));
meri("Izveštaj za mesec", () => db.prepare("SELECT type, SUM(amount) s FROM transactions WHERE created_at > ? GROUP BY type").all(sad - 30 * DAN));
meri("Najigranije igre", () => db.prepare("SELECT game_id, COUNT(*) c FROM game_launches GROUP BY game_id ORDER BY c DESC LIMIT 10").all());
meri("Istorija jednog igrača", () => db.prepare("SELECT * FROM transactions WHERE player_id=1 ORDER BY created_at DESC LIMIT 50").all());
// Najgori slucaj: trazi se nesto cega nema, pa se prolazi kroz CELU tabelu.
// Kad radnik nesto trazi i nista ne nadje, panel do tada stoji.
meri("Logovi: pretraga bez ijednog pogotka", () => db.prepare("SELECT * FROM logs WHERE detail LIKE '%zzqq%' ORDER BY ts DESC LIMIT 100").all());
meri("Logovi: kategorija koje skoro nema", () => db.prepare("SELECT * FROM logs WHERE category='podesavanja' ORDER BY ts DESC LIMIT 100").all());
meri("Logovi: ukupan broj (za paginaciju)", () => db.prepare("SELECT COUNT(*) c FROM logs").get());

// ---- da li se baza STABILIZUJE ----
// Logovi i pokretanja igara se seku na godinu dana, pa posle prve godine vise
// ne rastu. Promet, sesije i porudzbine se NE seku - to je poslovna evidencija,
// bez nje obracun nema smisla - ali one rastu polako.
const odrz = await import(new URL("../server/src/odrzavanje.js", import.meta.url).href);
const preOdrzavanja = velicina;
odrz.ocistiLogove(odrz.PODRAZUMEVANO);
odrz.ocistiPokretanja(odrz.PODRAZUMEVANO);
db.exec("VACUUM");
const posleOdrzavanja = fs.statSync(path.join(RADNO, "crit.db")).size;
console.log("\n  POSLE ODRŽAVANJA:");
console.log(`    baza                                   ${mb(preOdrzavanja)} -> ${mb(posleOdrzavanja)}`);
console.log(`    logovi                                 ${redovi.logs} -> ${broj("logs")} redova`);
console.log(`    pokretanja igara                       ${redovi.game_launches} -> ${broj("game_launches")} redova`);
const trajno = broj("sessions") + broj("orders") + broj("order_items") + broj("transactions");
console.log(`    poslovna evidencija (ne briše se)      ${trajno} redova`);

// Isti upiti jos jednom: da se vidi da odrzavanje vraca i brzinu, ne samo mesto.
console.log("\n  BRZINA POSLE ODRŽAVANJA:");
meri("Logovi: pretraga bez ijednog pogotka", () => db.prepare("SELECT * FROM logs WHERE detail LIKE '%zzqq%' ORDER BY ts DESC LIMIT 100").all());
meri("Logovi: kategorija koje skoro nema", () => db.prepare("SELECT * FROM logs WHERE category='podesavanja' ORDER BY ts DESC LIMIT 100").all());
meri("Najigranije igre", () => db.prepare("SELECT game_id, COUNT(*) c FROM game_launches GROUP BY game_id ORDER BY c DESC LIMIT 10").all());

const dirK = path.join(RADNO, "backups");
fs.rmSync(dirK, { recursive: true, force: true });
fs.mkdirSync(dirK, { recursive: true });
// Kopije kakve bi se stvarno nakupile: na 15 minuta, kroz ceo period.
let napravljeno = 0;
for (let m = 0; m < Math.min(DANA, 70) * 24 * 60; m += 15) {
  const kada = sad - m * 60000;
  const p = path.join(dirK, `crit-${new Date(kada).toISOString().replace(/[:.]/g, "-").slice(0, 23)}.db`);
  fs.writeFileSync(p, Buffer.alloc(4096));
  fs.utimesSync(p, kada / 1000, kada / 1000);
  napravljeno++;
}
const posleSredjivanja = odrz.srediKopije(odrz.PODRAZUMEVANO);
const preostale = fs.readdirSync(dirK).map((f) => fs.statSync(path.join(dirK, f)).mtimeMs).sort((a, b) => a - b);
const dubinaDana = preostale.length ? (sad - preostale[0]) / DAN : 0;

// Kopija se pravi od ODRŽAVANE baze, pa se racuna sa njenom velicinom - inace
// bi ispalo skoro cetiri puta gore nego sto stvarno jeste.
console.log("\n  REZERVNE KOPIJE:");
console.log(`    jedna kopija                           ${mb(posleOdrzavanja)}`);
console.log(`    staro pravilo: 30 komada               ${mb(posleOdrzavanja * 30)}   (seže 7.5 sati unazad)`);
console.log(`    novo pravilo:  ${String(preostale.length).padStart(2)} komada               ${mb(posleOdrzavanja * preostale.length)}   (seže ${dubinaDana.toFixed(0)} dana unazad)`);
console.log(`\n    UKUPNO NA DISKU posle ${DANA} dana:        ${mb(posleOdrzavanja + posleOdrzavanja * preostale.length)}`);
console.log(`    tvrda granica (kopijeMB)               ${odrz.PODRAZUMEVANO.kopijeMB} MB - preko toga se briše najstarija`);

console.log("");
