import { radniFolder, podigniServer, citajIzvor } from "./_okruzenje.mjs";
// Prolazi kroz SVAKU rutu i gadja je smecem: praznim telom, pogresnim tipovima,
// nepostojecim id-jevima. Nijedna ne sme da vrati stack trace ni da obori server.
//
// Povod: izmena igre bez imena je vracala HTTP 500 sa celim stack trace-om i
// apsolutnim putanjama fajlova. Otkriveno je slucajno, na jednoj ruti. Ovde se
// isto pita svaka ruta odjednom, da se ne otkriva jedna po jedna u igraonici.
const BASE = "http://127.0.0.1:8125";
await podigniServer(radniFolder("otpornost-data"), 8125);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
async function zovi(m, p, b) {
  const r = await fetch(BASE + p, { method: m,
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, tekst: t };
}

// Rute koje menjaju stanje. GET rute se gadjaju bez tela, ostale sa tri vrste
// smeca. Namerno se NE diraju: /logout (obara token), /backup (pravi fajlove),
// /computers-action i wake (salju komande na mrezu).
const RUTE = [
  ["GET", "/api/computers"], ["GET", "/api/games"], ["GET", "/api/tools"], ["GET", "/api/shop"],
  ["GET", "/api/orders"], ["GET", "/api/logs"], ["GET", "/api/players"], ["GET", "/api/programs"],
  ["GET", "/api/promo"], ["GET", "/api/pozadine"], ["GET", "/api/tekstura"], ["GET", "/api/settings"],
  ["GET", "/api/report"], ["GET", "/api/stats"], ["GET", "/api/shifts"], ["GET", "/api/shift"],
  ["GET", "/api/admins"], ["GET", "/api/server-info"], ["GET", "/api/snapshot"], ["GET", "/api/zalihe"],
  ["GET", "/api/me"], ["GET", "/api/install-status"], ["GET", "/api/kopije"],
  ["GET", "/api/players/999999/transactions"], ["GET", "/api/shifts/999999"], ["GET", "/api/kopije/nema-ovoga.db"],
  ["POST", "/api/games"], ["PUT", "/api/games/1"], ["PUT", "/api/games/999999"], ["DELETE", "/api/games/999999"],
  ["POST", "/api/shop"], ["PUT", "/api/shop/1"], ["PUT", "/api/shop/999999"], ["DELETE", "/api/shop/999999"],
  ["POST", "/api/tools"], ["PUT", "/api/tools/1"], ["PUT", "/api/tools/999999"], ["DELETE", "/api/tools/999999"],
  ["POST", "/api/players"], ["DELETE", "/api/players/999999"],
  ["POST", "/api/players/999999/topup"], ["POST", "/api/players/999999/ban"], ["POST", "/api/players/999999/password"],
  ["POST", "/api/players/guests"], ["POST", "/api/players/guests/ocisti"],
  ["POST", "/api/computers"], ["POST", "/api/computers/bulk"], ["DELETE", "/api/computers/999999"],
  ["POST", "/api/computers/999999/lock"], ["POST", "/api/computers/999999/unlock"],
  ["POST", "/api/computers/999999/message"], ["POST", "/api/computers/999999/logout"],
  ["POST", "/api/computers/999999/command"],
  ["POST", "/api/settings"], ["POST", "/api/pos"], ["POST", "/api/orders/999999/status"],
  ["POST", "/api/games/999999/image"], ["POST", "/api/games/999999/banner"],
  ["DELETE", "/api/games/999999/image"], ["DELETE", "/api/games/999999/banner"],
  ["POST", "/api/shop/999999/image"], ["DELETE", "/api/shop/999999/image"],
  ["POST", "/api/tools/999999/image"], ["DELETE", "/api/tools/999999/image"],
  ["POST", "/api/pozadine/prijava"], ["DELETE", "/api/pozadine/nepostojeci"],
  ["POST", "/api/promo"], ["DELETE", "/api/promo/999999"],
  ["POST", "/api/programs"], ["DELETE", "/api/programs/999999"], ["POST", "/api/install"],
  ["DELETE", "/api/install-status"],
  ["POST", "/api/tekstura"], ["POST", "/api/me/password"],
  ["POST", "/api/admins"], ["POST", "/api/admins/999999/password"], ["DELETE", "/api/admins/999999"],
  ["POST", "/api/shift/open"], ["POST", "/api/shift/close"],
  // Nepoznata adresa pod /api mora da vrati JSON. Express podrazumevano vrati
  // HTML stranicu, a panel je onda pokusa procitati kao JSON i javi igracu
  // nerazumljivu gresku umesto "ta adresa ne postoji".
  ["GET", "/api/nema-ovoga"], ["POST", "/api/nema-ovoga"],
];

// Tri vrste smeca: nista, pogresni tipovi, i vrednosti koje lome brojeve.
const TELA = [
  ["prazno telo", {}],
  ["pogresni tipovi", { name: [], username: {}, path: {}, target: [], price: {}, amount: [], id: {}, kind: 7,
    count: {}, add: [], image: 12, kljuc: [], url: {}, message: [], cmd: {}, status: [], stock: {},
    password: [], balance: {}, ratePerHour: [], idleMinutes: {}, cafeName: [], unlockPin: {}, tekstura: [] }],
  ["lomljivi brojevi", { price: "Infinity", amount: "NaN", count: -99999, add: 1e308, balance: "-0",
    ratePerHour: "1e400", idleMinutes: "-5", stock: "abc", id: "abc" }],
];

let html = 0, petice = 0, primeri = [];
for (const [m, p] of RUTE) {
  const varijante = m === "GET" ? [["bez tela", undefined]] : TELA;
  for (const [kako, telo] of varijante) {
    let r;
    try { r = await zovi(m, p, telo); }
    catch (e) { petice++; primeri.push(`${m} ${p} (${kako}) -> veza pukla: ${e.message}`); continue; }
    if (typeof r.body === "string" && /<!DOCTYPE|<html/i.test(r.body)) {
      html++; primeri.push(`${m} ${p} (${kako}) -> HTML stack trace`);
    } else if (r.status >= 500) {
      petice++; primeri.push(`${m} ${p} (${kako}) -> ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
    }
  }
}
for (const x of primeri.slice(0, 12)) console.log("       " + x);

const ukupno = RUTE.reduce((n, [m]) => n + (m === "GET" ? 1 : TELA.length), 0);
proveri(`nijedan od ${ukupno} zahteva ne vraca stack trace`, html === 0, `${html} vratilo HTML`);
proveri("nijedan zahtev ne obara rutu (5xx)", petice === 0, `${petice} vratilo 5xx`);

// Server mora da bude ziv posle svega - ovo je poenta cele suite.
const posle = await zovi("GET", "/api/computers");
proveri("server je ziv posle svih zahteva", posle.status === 200, String(posle.status));

// Neprijavljen zahtev ne sme da prodje ni da otkrije kako je server sastavljen.
const bezTokena = await fetch(BASE + "/api/games", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const telo = await bezTokena.text();
proveri("bez tokena se ne moze menjati katalog", bezTokena.status === 401, String(bezTokena.status));
proveri("odbijenica ne otkriva putanje fajlova", !/[A-Z]:\\\\|\/Users\//.test(telo), telo.slice(0, 80));

proveri("postoji zastitna mreza za neuhvacene greske",
  citajIzvor("server/src/index.js").includes("Greška na serveru. Pokušaj ponovo"));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
