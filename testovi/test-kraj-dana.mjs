import { radniFolder, podigniServer, citajIzvor } from "./_okruzenje.mjs";
// KRAJ DANA I OBRACUN
//
// Uvece radnik broji kasu i zatvara smenu. Skoro nikad se ne poklopi tacno u
// dinar: vrati se novac gostu, uzme se kusur za sitno, neko se prebroji. Ono
// sto tada mora da radi:
//
//   1. da se razlika izracuna i pokaze
//   2. da se VIDI unazad, bez otvaranja svake smene ponaosob
//   3. da moze da se objasni, jer posle mesec dana gola brojka lici na kradju
//   4. da zatvorena smena zauvek ostane sa istim brojkama
const BASE = "http://127.0.0.1:8195";
const DATA = radniFolder("kraj-dana-data");
await podigniServer(DATA, 8195);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (a, b, e = 0.5) => Math.abs(a - b) < e;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const artikal = (await api("/api/shop"))[0];
await api("/api/players", "POST", { username: "gost", password: "gost1234", displayName: "Gost" });
const gost = (await api("/api/players")).find((p) => p.username === "gost");

// ---- smena kakva se stvarno odradi ----
await api("/api/shift/open", "POST", { openingCash: 2000 });
await api(`/api/players/${gost.id}/topup`, "POST", { amount: 1500, note: "keš" });
await api("/api/pos", "POST", { items: [{ id: artikal.id, qty: 2 }], payment: "cash" });
await api("/api/pos", "POST", { items: [{ id: artikal.id, qty: 1 }], payment: "credit" });

const uToku = await api("/api/shift");
const ocekivano = 2000 + 1500 + artikal.price * 2;
proveri("obracun se racuna i dok smena traje", uToku?.totals?.topups === 1500, JSON.stringify(uToku?.totals));

// ---- zatvaranje sa MANJKOM ----
// Radnik prebroji 300 manje nego sto bi trebalo.
const manjak = -300;
const r = await api("/api/shift/close", "POST", { closingCash: ocekivano + manjak });
proveri("smena je zatvorena", !!r?.summary, JSON.stringify(r).slice(0, 120));
const o = r.summary;
proveri("ocekivana kasa je tacno izracunata", blizu(o.expectedCash, ocekivano),
  `${o.expectedCash}, ocekivano ${ocekivano} (pocetak 2000 + dopuna 1500 + kes ${artikal.price * 2})`);
proveri("razlika je tacna", blizu(o.difference, manjak), `${o.difference}`);
proveri("kupovina sa naloga NIJE u ocekivanoj kasi", !blizu(o.expectedCash, ocekivano + artikal.price),
  "taj novac je usao ranije, pri dopuni - inace bi se isti dinar brojao dvaput");

// ---- 1) MANJAK MORA DA UDJE U LOGOVE ----
// Logovi su jedino mesto koje se pretrazuje unazad, i po radniku i po danu.
const logovi = await api("/api/logs?limit=50");
const zapis = (Array.isArray(logovi) ? logovi : logovi.rows || []).find((l) => l.action === "kasa_manjak");
proveri("manjak je zapisan u logovima", !!zapis,
  "bez toga se manjak nalazi samo otvaranjem bas te smene");
proveri("u zapisu pise i prebrojano i ocekivano", zapis && /prebrojano/.test(zapis.detail) && /očekivano/.test(zapis.detail),
  zapis?.detail);
proveri("zna se ko je zatvorio smenu", zapis && !!zapis.actor, zapis?.actor);
proveri("zapis ne kvari pazar", zapis && zapis.amount == null,
  "iznos u polju amount bi se sabrao u obracun smene u kojoj je zapisan");

// ---- 2) RAZLIKA SE VIDI U SPISKU, BEZ OTVARANJA ----
const spisak = await api("/api/shifts");
const uSpisku = spisak.find((x) => x.id === o.id);
proveri("spisak smena nosi razliku", uSpisku && blizu(uSpisku.difference, manjak), JSON.stringify(uSpisku));
proveri("spisak nosi i ocekivanu kasu", uSpisku && blizu(uSpisku.expectedCash, ocekivano));
const panel = citajIzvor("server/public/js/app.js");
proveri("panel ima kolonu za razliku", /<th>Razlika u kasi<\/th>/.test(panel));
proveri("manjak se boji drugacije od viska", /manjak \? "danger" : "locked"/.test(panel));
proveri("kad se poklapa, tako i pise", /poklapa se/.test(panel),
  "prazno polje bi izgledalo kao da nije ni brojano");

// ---- 3) RAZLIKA MOZE DA SE OBJASNI ----
const napomena = "300 vraćeno gostu za otkazanu porudžbinu";
const n1 = await api(`/api/shifts/${o.id}/napomena`, "POST", { note: napomena });
proveri("napomena moze da se upise", !n1?.error, JSON.stringify(n1).slice(0, 100));
const detalj = await api(`/api/shifts/${o.id}`);
proveri("napomena se cita nazad", detalj.note === napomena, String(detalj.note));
proveri("napomena se vidi i u spisku", (await api("/api/shifts")).find((x) => x.id === o.id)?.note === napomena);
proveri("upis napomene ostaje u logovima", ((await api("/api/logs?limit=30")) || []).some((l) => l.action === "shift_note"));
proveri("obracun pri zatvaranju odmah trazi objasnjenje", /Zašto se kasa ne poklapa/.test(panel),
  "sutra radnik vise ne zna zasto");
proveri("ne pita kad se kasa poklapa", /const razlika = s\.difference != null && Math\.abs\(s\.difference\) >= 0\.5/.test(panel));

const prazna = await api(`/api/shifts/${o.id}/napomena`, "POST", { note: "" });
proveri("napomena moze i da se obrise", prazna?.note === null, JSON.stringify(prazna));
await api(`/api/shifts/${o.id}/napomena`, "POST", { note: napomena });

// ---- 4) ZATVORENA SMENA SE NE MENJA ----
// Posle zatvaranja se i dalje radi: neko dopuni kredit u 2 ujutru. To ne sme da
// pomeri vec zakljucen obracun.
await api(`/api/players/${gost.id}/topup`, "POST", { amount: 999, note: "posle smene" });
await cekaj(300);
const opet = await api(`/api/shifts/${o.id}`);
proveri("zatvorena smena zadrzava svoj pazar", blizu(opet.revenue, o.revenue), `${o.revenue} -> ${opet.revenue}`);
proveri("i svoju razliku", blizu(opet.difference, manjak), `${opet.difference}`);
proveri("novac posle smene se vodi kao van smene", blizu((await api("/api/snapshot")).vanSmene, 999),
  "inace bi radnik imao visak koji obracun ne pominje");

// ---- 5) VISAK SE VODI ISTO ----
await api("/api/shift/open", "POST", { openingCash: 1000 });
const r2 = await api("/api/shift/close", "POST", { closingCash: 1250 });
proveri("visak se takodje racuna", blizu(r2.summary.difference, 250), String(r2.summary.difference));
proveri("visak ima svoj zapis u logovima",
  ((await api("/api/logs?limit=30")) || []).some((l) => l.action === "kasa_visak"));

// ---- 6) smena zatvorena bez brojanja ----
await api("/api/shift/open", "POST", { openingCash: 1000 });
const r3 = await api("/api/shift/close", "POST", { closingCash: "" });
proveri("smena moze da se zatvori i bez brojanja kase", !!r3?.summary);
proveri("tada nema izmisljene razlike", r3.summary.difference === null, String(r3.summary.difference));
proveri("i nema laznog zapisa o manjku",
  ((await api("/api/logs?limit=20")) || []).filter((l) => l.action === "kasa_manjak").length === 1,
  "prazno polje ne znaci da fali novac");

console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(400);
process.exit(pao ? 1 : 0);
