import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor, brojac } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// NAPLATA IDE KROZ SVE MASINE, I JEDNA NE SME DA ZAUSTAVI OSTALE
//
// `billingTick` je jedna petlja kroz SVE aktivne sesije - u igraonici kroz svih
// trinaest masina. Pozivalac (index.js) hvata gresku, pa server ne pada. Ali to
// nije dovoljno: greska na trecoj sesiji prekida petlju, pa se masine od cetvrte
// do trinaeste tog prolaza ne naplate. A posto se puca na istom mestu pri svakom
// prolazu, one se ne naplate NIKAD.
//
// Rezultat bi bio najgori moguci: devet racunara igra besplatno, server izgleda
// zdravo, i nigde ne pise zasto - otkrilo bi se tek pri obracunu smene.
//
// STA SE OVDE MERI, A STA NE
//
// Meri se ono sto se posteno moze izmeriti: da jedan prolaz naplati SVE masine
// koje igraju, i to jednako. Sam pad jedne sesije se ne glumi - baza ga ne da
// (strani kljucevi drze `sessions` vezanu za postojeceg igraca i racunar), pa bi
// svaka simulacija bila laz. Da je telo petlje zasticeno i da se kvar zapisuje
// proverava se nad izvorom.
const BASE = "http://127.0.0.1:8201";
const DATA = radniFolder("naplata-otporna");
await podigniServer(DATA, 8201);
const { proveri, kraj } = brojac();

const svc = await import("../server/src/service.js");
const { db } = await import("../server/src/db.js");
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

await api("/api/settings", "POST", { ratePerHour: 120 });
const comps = (await api("/api/computers")).body;
proveri("ima bar tri racunara za probu", comps.length >= 3, String(comps.length));

// Ime se drzi ovde, a ne cita iz odgovora: odgovor na pravljenje naloga nosi
// samo id, pa je `igrac.username` bilo undefined i prijava je isla sa lozinkom
// "undefined1234".
const IMENA = ["prvi", "drugi", "treci"];
const igraci = [];
for (const ime of IMENA) {
  igraci.push((await api("/api/players", "POST", { username: ime, password: ime + "1234", balance: 500 })).body);
}

// Tri PRAVE veze i tri prave prijave: naplata namerno preskace racunare bez zive
// veze (nestanak struje ili mreze ne sme da se naplati), pa izmisljene sesije u
// bazi ne bi ni usle u petlju.
const veze = [];
for (let i = 0; i < 3; i++) {
  const poruke = [];
  const w = new WebSocket(`ws://127.0.0.1:8201/ws?kind=client&token=${encodeURIComponent(comps[i].token)}`);
  w.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
  await new Promise((res, rej) => { w.once("open", res); w.once("error", rej); });
  w.send(JSON.stringify({ t: "login", username: IMENA[i], password: IMENA[i] + "1234" }));
  veze.push({ w, poruke });
}
for (const v of veze) {
  for (let k = 0; k < 150 && !v.poruke.some((m) => m.t === "login_ok"); k++) await cekaj(20);
}
const sesije = comps.slice(0, 3).map((c) =>
  db.prepare("SELECT current_session_id s FROM computers WHERE id=?").get(c.id).s);
proveri("sve tri sesije su otvorene", sesije.every(Boolean), JSON.stringify(sesije));

// ---- JEDAN PROLAZ NAPLACUJE SVE, NE SAMO PRVU ----
//
// Prvi prolaz samo namesti vreme (proteklo = 0), pa se jos nista ne skida.
svc.billingTick();
const pre = igraci.map((p) => db.prepare("SELECT balance FROM players WHERE id=?").get(p.id).balance);
await cekaj(1100);
svc.billingTick();
const posle = igraci.map((p) => db.prepare("SELECT balance FROM players WHERE id=?").get(p.id).balance);

for (let i = 0; i < 3; i++) {
  proveri(`${IMENA[i]} je naplacen`, posle[i] < pre[i], `${pre[i]} -> ${posle[i]}`);
}
const skinuto = pre.map((v, i) => v - posle[i]);
proveri("svima je skinuto priblizno isto",
  Math.max(...skinuto) - Math.min(...skinuto) < 0.05, JSON.stringify(skinuto));
// Cena je 120/h, a proslo je oko sekunde: ~0.033 din. Granice su siroke jer
// racunar pod opterecenjem ume da kasni, ali red velicine mora da se poklopi.
proveri("iznos odgovara proteklom vremenu i ceni",
  skinuto[0] > 0.02 && skinuto[0] < 0.5, String(skinuto[0]));

// ---- TELO PETLJE JE ZASTICENO ----
const src = citajIzvor("server/src/service.js");
const petlja = src.slice(src.indexOf("export function billingTick"), src.indexOf("export function billingTick") + 4500);
proveri("svaka sesija se obradjuje pod svojom zastitom",
  /for \(const s of active\) \{[\s\S]{0,600}try \{/.test(petlja),
  "greska na trecoj masini bi inace preskocila sve iza nje, i to pri svakom prolazu");
proveri("kvar se zapisuje, ne guta", /javiKvarNaplate\(s, e\)/.test(petlja));
proveri("vreme se pomera i za sesiju koja je pukla",
  /tickState\.set\(s\.id, \{ last: now \}\);[\s\S]{0,80}javiKvarNaplate/.test(petlja),
  "bez toga bi sledeci prolaz pokusao da naplati sve od pocetka greske odjednom");

const javi = src.slice(src.indexOf("function javiKvarNaplate"), src.indexOf("function javiKvarNaplate") + 800);
proveri("ista greska se javlja najvise jednom u minutu", /< 60000\) return;/.test(javi),
  "naplata ide na svakih pet sekundi - ista greska bi pregazila sve ostalo u logovima");
proveri("poruka kaze da ostali rade normalno", /Ostali računari se naplaćuju normalno/.test(javi),
  "inace zvuci kao da je stala cela naplata");
proveri("poruka kaze i NA KOJOJ masini", /compName\(s\.computer_id\)/.test(javi));

for (const v of veze) v.w.close();
await cekaj(200);
kraj();
