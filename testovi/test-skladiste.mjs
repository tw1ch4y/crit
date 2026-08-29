import fs from "node:fs";
import path from "node:path";
import { radniFolder, podigniServer } from "./_okruzenje.mjs";
// DA DISK NIKAD NE PUKNE
//
// Glavni racunar u igraonici niko nece odrzavati. Sve sto raste bez granice pre
// ili kasnije napuni disk, a kad disk stane server ne moze da pise i CELA
// igraonica staje: niko se ne prijavljuje, kasa ne radi, sesije se ne
// naplacuju. Ovde se proverava da tri kocnice stvarno rade - na pravim
// podacima, ne citanjem koda.
const BASE = "http://127.0.0.1:8181";
const DATA = radniFolder("skladiste-data");
await podigniServer(DATA, 8181);
const { db } = await import(new URL("../server/src/db.js", import.meta.url).href);
const odrz = await import(new URL("../server/src/odrzavanje.js", import.meta.url).href);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const DAN = 86400000;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());

const upisiLog = db.prepare("INSERT INTO logs (ts, category, action, actor, detail) VALUES (?,?,?,?,?)");
const brojLogova = () => db.prepare("SELECT COUNT(*) c FROM logs").get().c;
const najstarijiLog = () => db.prepare("SELECT MIN(ts) t FROM logs").get().t;

// ---- 1) LOGOVI SE SEKU PO STAROSTI ----
db.exec("DELETE FROM logs");
const sad = Date.now();
db.exec("BEGIN");
for (let i = 0; i < 200; i++) upisiLog.run(sad - (400 + i) * DAN, "sistem", "staro", "test", "star zapis");
for (let i = 0; i < 50; i++) upisiLog.run(sad - i * DAN, "sistem", "novo", "test", "svež zapis");
db.exec("COMMIT");
proveri("pripremljeno 250 zapisa", brojLogova() === 250, String(brojLogova()));

odrz.ocistiLogove({ ...odrz.PODRAZUMEVANO, logDana: 365 });
proveri("stari zapisi su obrisani", brojLogova() === 50, `${brojLogova()} umesto 50`);
proveri("sveži zapisi su ostali", db.prepare("SELECT COUNT(*) c FROM logs WHERE action='novo'").get().c === 50);

// ---- 2) LOGOVI SE SEKU I PO BROJU ----
// Ovo je ono sto je vlasnik trazio: kad se dodje do granice, brise se NAJSTARIJI
// zapis da bi novi imao mesto. Dan sa turnirom ume da napravi visestruko vise
// zapisa nego obican, pa granica po starosti sama nije dovoljna.
db.exec("DELETE FROM logs");
db.exec("BEGIN");
for (let i = 0; i < 500; i++) upisiLog.run(sad - (500 - i) * 60000, "sistem", "r" + i, "test", "zapis " + i);
db.exec("COMMIT");
const preSecenja = najstarijiLog();

odrz.ocistiLogove({ ...odrz.PODRAZUMEVANO, logNajvise: 100 });
proveri("ostalo je tacno koliko granica kaze", brojLogova() === 100, `${brojLogova()} umesto 100`);
proveri("obrisan je NAJSTARIJI, ne nasumican", najstarijiLog() > preSecenja,
  "brisanje mora da ide od najstarijeg zapisa");
const ostali = db.prepare("SELECT action FROM logs ORDER BY ts ASC LIMIT 1").get().action;
proveri("zadrzano je poslednjih 100 zapisa", ostali === "r400", `najstariji zadrzan: ${ostali}`);

// ---- 3) SMENA KOJA JE JOS OTVORENA SE NE DIRA ----
// Bez njenih zapisa obracun te smene ostaje bez podataka.
db.exec("DELETE FROM logs");
db.exec("INSERT INTO shifts (admin_username, opened_at, opening_cash, status) VALUES ('radnik', 1, 0, 'open')");
const smenaId = db.prepare("SELECT id FROM shifts WHERE status='open'").get().id;
db.prepare("INSERT INTO logs (ts, category, action, actor, detail, shift_id) VALUES (?,?,?,?,?,?)")
  .run(sad - 900 * DAN, "novac", "dopuna", "radnik", "stara dopuna u otvorenoj smeni", smenaId);
upisiLog.run(sad - 900 * DAN, "sistem", "obicno", "test", "star zapis bez smene");
odrz.ocistiLogove({ ...odrz.PODRAZUMEVANO, logDana: 365 }, smenaId);
proveri("zapis otvorene smene prezivljava secenje", brojLogova() === 1, String(brojLogova()));
proveri("prezivelo je bas ono iz smene", db.prepare("SELECT action FROM logs").get().action === "dopuna");
db.exec("DELETE FROM shifts WHERE status='open'");

// ---- 4) REZERVNE KOPIJE SE PROREDJUJU ----
// Ranije se cuvalo poslednjih 30 kopija. Posto se prave na 15 minuta, to je
// svega sedam i po sati unazad: greska primecena sledece jutro vise nije imala
// gde da se vrati.
const dirKopija = path.join(DATA, "backups");
fs.rmSync(dirKopija, { recursive: true, force: true });
fs.mkdirSync(dirKopija, { recursive: true });
const napraviKopiju = (kada, bajta = 1024) => {
  const ime = `crit-${new Date(kada).toISOString().replace(/[:.]/g, "-").slice(0, 23)}.db`;
  const p = path.join(dirKopija, ime);
  fs.writeFileSync(p, Buffer.alloc(bajta));
  fs.utimesSync(p, kada / 1000, kada / 1000);
  return p;
};
// dva meseca rada: na svakih 15 minuta
for (let m = 0; m < 60 * 24 * 4; m += 15) napraviKopiju(sad - m * 60000);
const preProredjivanja = fs.readdirSync(dirKopija).length;
proveri("napravljeno mnogo kopija za probu", preProredjivanja > 300, String(preProredjivanja));

const r = odrz.srediKopije(odrz.PODRAZUMEVANO);
const posle = fs.readdirSync(dirKopija).map((f) => ({ f, t: fs.statSync(path.join(dirKopija, f)).mtimeMs })).sort((a, b) => b.t - a.t);
proveri("ostao je razuman broj kopija", posle.length <= 40 && posle.length >= 10, String(posle.length));
proveri("najnovija kopija je sacuvana", Math.abs(posle[0].t - sad) < 60000);
const najstarija = posle[posle.length - 1];
const danaUnazad = (sad - najstarija.t) / DAN;
proveri("kopije sezu vise dana unazad, ne samo sati", danaUnazad > 2,
  `najstarija je stara ${danaUnazad.toFixed(1)} dana - sa starim pravilom bilo je 0.3`);

// ---- 5) GRANICA UKUPNE VELICINE ----
fs.rmSync(dirKopija, { recursive: true, force: true });
fs.mkdirSync(dirKopija, { recursive: true });
for (let i = 0; i < 20; i++) napraviKopiju(sad - i * 900000, 2 * 1048576); // 20 x 2 MB
const r2 = odrz.srediKopije({ ...odrz.PODRAZUMEVANO, kopijaSvezih: 20, kopijaDana: 0, kopijaNedelja: 0, kopijeMB: 10 });
const ukupnoMB = fs.readdirSync(dirKopija).reduce((z, f) => z + fs.statSync(path.join(dirKopija, f)).size, 0) / 1048576;
proveri("ukupna velicina je spustena ispod granice", ukupnoMB <= 10, `${ukupnoMB.toFixed(1)} MB`);
proveri("bar pet najsvezijih kopija ostaje", fs.readdirSync(dirKopija).length >= 5, String(fs.readdirSync(dirKopija).length));

// ---- 6) PANEL VIDI STANJE ----
const s = await api("/api/skladiste");
proveri("panel dobija velicinu baze", typeof s.bazaMB === "number" && s.bazaMB > 0, JSON.stringify(s).slice(0, 120));
proveri("panel dobija velicinu kopija", typeof s.kopijeMB === "number");
proveri("panel dobija slobodan prostor na disku", typeof s.slobodnoMB === "number" && s.slobodnoMB > 0, String(s.slobodnoMB));
proveri("panel dobija broj redova po tabeli", typeof s.redovi?.logs === "number");
proveri("panel dobija i same granice", s.granice?.logDana > 0 && s.granice?.kopijeMB > 0, JSON.stringify(s.granice));

// ---- 7) GRANICE SE MENJAJU I PAMTE ----
await api("/api/skladiste", "POST", { logDana: 30, kopijeMB: 512 });
const s2 = await api("/api/skladiste");
proveri("promenjena granica je zapamcena", s2.granice.logDana === 30 && s2.granice.kopijeMB === 512, JSON.stringify(s2.granice));
proveri("neposlate granice ostaju kakve su bile", s2.granice.logNajvise === odrz.PODRAZUMEVANO.logNajvise);
await api("/api/skladiste", "POST", { logDana: 365, kopijeMB: 2048 });

// ---- 8) RADNIK NE DIRA ODRZAVANJE ----
await api("/api/admins", "POST", { username: "pera", password: "pera1234", role: "staff" });
const pt = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "pera", password: "pera1234" }) }).then((x) => x.json())).token;
const odgovor = await fetch(BASE + "/api/skladiste", { headers: { authorization: "Bearer " + pt } });
proveri("radnik ne vidi stranu skladista", odgovor.status === 403, `status ${odgovor.status}`);

console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(400);
process.exit(pao ? 1 : 0);
