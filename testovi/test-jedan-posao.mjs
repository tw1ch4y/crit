import { radniFolder, podigniServer, citajIzvor, KOREN } from "./_okruzenje.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
// Jedan posao, jedan upis.
//
// Porudzbina su pet upisa: red u orders, stavke, zaliha, kredit i transactions.
// Proverava se da se izmene stvarno vrate unazad kad posao pukne na pola, ne
// samo da je kod obmotan.
const BASE = "http://127.0.0.1:8157";
const DATA = radniFolder("posao-data");
await podigniServer(DATA, 8157);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const { db, uJednomPoslu } = await import(pathToFileURL(path.join(KOREN, "server", "src", "db.js")).href);

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/players", "POST", { username: "ana", password: "ana12345", displayName: "Ana" });
const ana = (await api("/api/players")).find((p) => p.username === "ana");
await api(`/api/players/${ana.id}/topup`, "POST", { amount: 1000, note: "test" });
const stanje = () => db.prepare("SELECT balance FROM players WHERE id=?").get(ana.id).balance;
const brojTransakcija = () => db.prepare("SELECT COUNT(*) c FROM transactions WHERE player_id=?").get(ana.id).c;

proveri("pocetno stanje je 1000", stanje() === 1000);

// ---- 1) posao koji prodje ostavlja SVE izmene ----
const preT = brojTransakcija();
uJednomPoslu(() => {
  db.prepare("UPDATE players SET balance=? WHERE id=?").run(700, ana.id);
  db.prepare("INSERT INTO transactions (player_id, type, amount, balance_after, created_at) VALUES (?, 'shop', -300, 700, ?)").run(ana.id, Date.now());
});
proveri("uspesan posao upisuje sve", stanje() === 700 && brojTransakcija() === preT + 1,
  `stanje ${stanje()}, transakcija ${brojTransakcija()}`);

// ---- 2) posao koji pukne NE ostavlja nista ----
// Ovo je sustina: prva izmena je vec izvrsena kad druga pukne. Bez zajednickog
// posla bi ostala upisana.
let bacio = false;
try {
  uJednomPoslu(() => {
    db.prepare("UPDATE players SET balance=? WHERE id=?").run(1, ana.id);
    db.prepare("INSERT INTO transactions (player_id, type, amount, balance_after, created_at) VALUES (?, 'shop', -699, 1, ?)").run(ana.id, Date.now());
    throw new Error("prekid nasred posla");
  });
} catch { bacio = true; }
proveri("greska se prosledjuje dalje", bacio);
proveri("stanje kredita je vraceno unazad", stanje() === 700, `stanje ${stanje()}`);
proveri("ni zapis u transakcijama nije ostao", brojTransakcija() === preT + 1, `transakcija ${brojTransakcija()}`);

// ---- 3) posao u poslu (prodaja paketa zove dopunu kredita) ----
// SQLite ne dozvoljava BEGIN unutar BEGIN-a; zato se koriste savepoint-i.
let unutrasnjiRadi = false;
uJednomPoslu(() => {
  db.prepare("UPDATE players SET balance=? WHERE id=?").run(800, ana.id);
  uJednomPoslu(() => {
    db.prepare("UPDATE players SET balance=? WHERE id=?").run(900, ana.id);
  });
  unutrasnjiRadi = true;
});
proveri("posao u poslu prolazi", unutrasnjiRadi && stanje() === 900, `stanje ${stanje()}`);

// Unutrasnji posao pukne, spoljasnji nastavi.
uJednomPoslu(() => {
  db.prepare("UPDATE players SET balance=? WHERE id=?").run(950, ana.id);
  try {
    uJednomPoslu(() => {
      db.prepare("UPDATE players SET balance=? WHERE id=?").run(999, ana.id);
      throw new Error("unutrasnji pukao");
    });
  } catch {}
});
proveri("kad pukne unutrasnji, spoljasnji ostaje", stanje() === 950, `stanje ${stanje()}`);

// Spoljasnji pukne - pada sve, i ono sto je unutrasnji vec potvrdio.
try {
  uJednomPoslu(() => {
    db.prepare("UPDATE players SET balance=? WHERE id=?").run(111, ana.id);
    uJednomPoslu(() => { db.prepare("UPDATE players SET balance=? WHERE id=?").run(222, ana.id); });
    throw new Error("spoljasnji pukao");
  });
} catch {}
proveri("kad pukne spoljasnji, pada i unutrasnji", stanje() === 950, `stanje ${stanje()}`);

// ---- 4) baza je i dalje upotrebljiva posle svih prekida ----
// Zaboravljen otvoren posao bi zakljucao bazu i sve sledece bi visilo.
proveri("baza radi posle prekida", (await api("/api/players")).length > 0);
await api(`/api/players/${ana.id}/topup`, "POST", { amount: 50, note: "posle prekida" });
proveri("moze da se radi dalje", stanje() === 1000, `stanje ${stanje()}`);

// ---- 5) prave putanje sa novcem koriste zajednicki posao ----
const src = citajIzvor("server/src/service.js");
for (const [gde, sablon] of [
  // Uz orderId i stanje, isti posao vraca i prelazak nivoa (XP se dodaje u
  // ISTOM upisu kao kredit) - zato se ne trazi tacan spisak polja.
  ["porudzbina igraca", /orderId, newBal[^}]*\} = uJednomPoslu/],
  ["racun na kasi", /orderId, javiIgracu[^}]*\} = uJednomPoslu/],
  // Zapis iz kog se racuna "Shop" u obracunu smene je deo istog posla - i za
  // porudzbinu sa racunara i za racun na kasi.
  ["zapis porudzbine", /const l = upisiLog\(\{ category: "shop", action: "order"/],
  ["zapis racuna na kasi", /const l = upisiLog\(\{ category: "shop", action: "pos"/],
  ["nagradni tocak", /bal = uJednomPoslu/],
  // Ove cetiri su bile propustene: svaka je pomerala novac u dva ili tri
  // odvojena upisa. Dopuna je najskuplja - kroz nju prolazi svaki dinar koji
  // gost preda preko pulta.
  ["dopuna kredita", /log = uJednomPoslu\(\(\) => \{\s*\n\s*db\.prepare\("UPDATE players SET balance=\? WHERE id=\?"\)/],
  ["prodaja paketa", /\{ bal, log \} = uJednomPoslu/],
  // Uz kredit i status, isti posao vraca i pice na stanje - inace bi pad izmedju
  // njih ostavio gosta sa vracenim novcem i picem koje i dalje fali u evidenciji.
  ["otkazivanje porudzbine", /\{ vracen, log, vracenoNaStanje \} = uJednomPoslu/],
  ["vracanje pica na stanje", /const naStanje = cancelling \? vratiStock\(orderId\) : \[\];/],
  ["kraj sesije", /log = uJednomPoslu\(\(\) => \{\s*\n\s*let l = null;/],
]) proveri(`${gde} je jedan posao`, sablon.test(src));
// Stanje za igraca izlazi iz transakcije kao vrednost i salje se tek posle nje.
const kasa = src.slice(src.indexOf("export function createPosOrder"));
const krajPosla = kasa.indexOf("} catch (e) {", kasa.indexOf("uJednomPoslu("));
const javljanje = kasa.indexOf('sendClient(comp.id, { t: "balance"');
proveri("igracu se javlja tek posle potvrde upisa",
  kasa.indexOf("uJednomPoslu(") > 0 && krajPosla > 0 && javljanje > krajPosla &&
  /if \(javiIgracu && player\) \{/.test(kasa.slice(krajPosla, javljanje)),
  "inace bi mu pisalo novo stanje kredita za racun koji nije prosao");
proveri("brisanje igraca ide kroz zajednicki posao, ne kroz sirov BEGIN",
  !/db\.exec\("BEGIN"\)/.test(src),
  "sirov BEGIN puca cim se pozove iz nekog sireg posla");

// ---- 6) ZAPIS U LOGU JE DEO POSLA SA NOVCEM ----
//
// Obracun smene se racuna iz logova (po shift_id), pa se zapis o dopuni upisuje
// u istom poslu kao i sama dopuna.
proveri("log se upisuje bez javljanja panelima (moze u posao)", /function upisiLog\(/.test(src));
proveri("javljanje ide tek posle potvrde upisa", /function javiLog\(/.test(src));
proveri("dopuna sama pise svoj log", /upisiLog\(\{\s*\n?\s*category: "novac", action: amount >= 0 \? "topup" : "deduct"/.test(src));
proveri("paket sam pise svoj log", /upisiLog\(\{\s*\n?\s*category: "novac", action: "paket"/.test(src));
const rt = citajIzvor("server/src/routes.js");
proveri("ruta za dopunu vise ne pise log posle posla",
  !/topUpPlayer[\s\S]{0,220}svc\.logEvent\(\{ category: "novac"/.test(rt));

// A sada isto to ponasanjem: posle dopune, sva tri traga moraju da postoje i da
// se slazu - stanje na nalogu, red u istoriji naloga i zapis u obracunu smene.
await api("/api/shift/open", "POST", { openingCash: 0 });
const preStanje = stanje();
await api(`/api/players/${ana.id}/topup`, "POST", { amount: 640, note: "provera traga" });
const t = (await api("/api/shift")).totals;
const zadnjaTx = db.prepare("SELECT * FROM transactions WHERE player_id=? ORDER BY id DESC LIMIT 1").get(ana.id);
proveri("dopuna: stanje na nalogu", stanje() === preStanje + 640, `${preStanje} -> ${stanje()}`);
proveri("dopuna: red u istoriji naloga", zadnjaTx?.type === "topup" && zadnjaTx.amount === 640, JSON.stringify(zadnjaTx));
proveri("dopuna: ista brojka u obracunu smene", Math.abs(t.topups - 640) < 0.01, `topups ${t.topups}`);
proveri("dopuna: log nosi ime radnika", /admin/.test(
  db.prepare("SELECT actor FROM logs WHERE category='novac' AND action='topup' ORDER BY id DESC LIMIT 1").get()?.actor || ""),
  "bez imena manjak u kasi nema potpis");
await api("/api/shift/close", "POST", { closingCash: null });

console.log(`\n${prosao}/${prosao + pao} proslo`);
await new Promise((r) => setTimeout(r, 400));
process.exit(pao ? 1 : 0);
