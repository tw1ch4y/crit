import path from "node:path";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { KOREN, OVDE, radniFolder, podigniServer, ucitajWebSocket, panelKlijent, brojac } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// PET ISTOVREMENIH KUPOVINA SA NALOGA KOJI IMA ZA JEDNU
//
// Igrac ima tacno onoliko kredita koliko kosta jedno pice. Pet zahteva za
// kupovinu stize u isto vreme. Mora da prodje TACNO JEDAN; ostala cetiri moraju
// da budu odbijena jasnom porukom, a kredit ne sme da ode u minus ni da se
// "potrosi" vise puta.
//
// Proverava se na tri nivoa:
//   A) kroz pravi server: pet racuna na kasi (HTTP) u isto vreme, pet porudzbina
//      sa launchera (WebSocket) u jednom rafalu, i mesavina oba
//   B) kroz SAMU BAZU: pet niti, svaka sa svojom vezom ka istoj bazi (kao pet
//      procesa), krecu sa iste barijere. Ovo meri izolaciju, a ne to sto je Node
//      jednonitan. Uz to i KONTROLA: stari obrazac (citanje van posla) u istom
//      testu stvarno gubi upise - dokaz da bi test uhvatio gresku.
//   C) vreme i porudzbina u isto vreme nad istim kreditom: dobija samo jedno
//
// Na kraju: nijedan nalog u minusu, i glavna knjiga se slaze sa nalozima.

const PORT = 8221, BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
const b = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (x, y) => Math.abs(Number(x) - Number(y)) < 0.01;

await podigniServer(radniFolder("paralelna-kupovina-data"), PORT);
const { db } = await import(pathToFileURL(path.join(KOREN, "server", "src", "db.js")).href);
const knjiga = await import(pathToFileURL(path.join(KOREN, "server", "src", "knjiga.js")).href);
const api = await panelKlijent(BASE);

const kola = (await api("/api/shop")).body.find((i) => i.name.startsWith("Coca-Cola"));
const CENA = kola.price; // 130
await api(`/api/shop/${kola.id}`, "PUT", { stock: 500 });
await api("/api/shift/open", "POST", { openingCash: 0 });

const nalog = async (ime, kredit) => {
  await api("/api/players", "POST", { username: ime, password: ime + "1234", balance: kredit });
  return (await api("/api/players")).body.find((p) => p.username === ime);
};
const stanje = (id) => db.prepare("SELECT balance FROM players WHERE id=?").get(id).balance;
const zaliha = () => db.prepare("SELECT stock FROM shop_items WHERE id=?").get(kola.id).stock;
const brojPorudzbina = (id) => db.prepare("SELECT COUNT(*) n FROM orders WHERE player_id=? AND status<>'cancelled'").get(id).n;
const kupovineUKnjizi = (id) => db.prepare("SELECT * FROM audit_log WHERE racun='igrac' AND player_id=? AND tip='kupovina_artikla' ORDER BY id").all(id);
const knjigaUredna = (id) => knjiga.proveri({ playerId: id });

// ================= A) PRAVI SERVER =================

// ---- A1: pet racuna na kasi u isto vreme, kredit tacno za jedan ----
const p1 = await nalog("jedan", CENA);
const zalihaPre = zaliha();
const odgovori = await Promise.all(Array.from({ length: 5 }, () =>
  api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], playerId: p1.id, payment: "credit" })));
const uspelo = odgovori.filter((r) => r.status === 200 && r.body.ok);
const odbijeno = odgovori.filter((r) => r.status === 400);
b.proveri("A1 kasa: tacno jedna od pet kupovina prolazi", uspelo.length === 1, JSON.stringify(odgovori.map((r) => r.status)));
b.proveri("A1 kasa: ostale cetiri su odbijene (400)", odbijeno.length === 4);
b.proveri("A1 kasa: greska je jasna i kaze koliko fali",
  odbijeno.every((r) => /^Nedovoljno kredita \(potrebno 130, ima 0\)$/.test(r.body.error)), JSON.stringify(odbijeno.map((r) => r.body.error)));
b.proveri("A1 kasa: kredit je tacno 0, ne u minusu", stanje(p1.id) === 0, String(stanje(p1.id)));
b.proveri("A1 kasa: nastala je jedna porudzbina", brojPorudzbina(p1.id) === 1, String(brojPorudzbina(p1.id)));
b.proveri("A1 kasa: zaliha je skinuta jednom", zaliha() === zalihaPre - 1, `${zalihaPre} -> ${zaliha()}`);
const k1 = kupovineUKnjizi(p1.id);
b.proveri("A1 kasa: knjiga ima jednu kupovinu, 130 -> 0",
  k1.length === 1 && k1[0].stanje_pre === 130 && k1[0].stanje_posle === 0 && k1[0].iznos === -130, JSON.stringify(k1));
b.proveri("A1 kasa: knjiga se slaze sa nalogom", knjigaUredna(p1.id).ok, JSON.stringify(knjigaUredna(p1.id).greske));

// ---- A2: pet porudzbina sa launchera u jednom rafalu ----
// Igrac je prijavljen, pa naplata vremena tece: kredit 200 je dovoljan za jedno
// pice (130) i par minuta igre, a nikako za dva.
const p2 = await nalog("dva", 200);
const pc = (await api("/api/computers")).body[0];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}&p=2`);
const poruke = [];
ws.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
await new Promise((r) => ws.once("open", r));
ws.send(JSON.stringify({ t: "login", username: "dva", password: "dva1234" }));
await cekaj(700);
b.proveri("A2 launcher: igrac je prijavljen", poruke.some((m) => m.t === "login_ok"));
poruke.length = 0;
for (let i = 0; i < 5; i++) {
  ws.send(JSON.stringify({ t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit", poId: `rafal-${i}` }));
}
await cekaj(1200);
const ok2 = poruke.filter((m) => m.t === "order_ok");
const err2 = poruke.filter((m) => m.t === "order_err");
b.proveri("A2 launcher: tacno jedna od pet porudzbina prolazi", ok2.length === 1, JSON.stringify(poruke.map((m) => m.t)));
b.proveri("A2 launcher: cetiri su odbijene", err2.length === 4);
b.proveri("A2 launcher: igrac dobija jasnu poruku", err2.every((m) => /^Nedovoljno kredita \(potrebno 130, imate \d+(\.\d+)?\)\.$/.test(m.message)),
  JSON.stringify(err2.map((m) => m.message)));
b.proveri("A2 launcher: kredit nije u minusu", stanje(p2.id) >= 0 && stanje(p2.id) <= 70, String(stanje(p2.id)));
b.proveri("A2 launcher: jedna porudzbina", brojPorudzbina(p2.id) === 1);

// ---- A3: mesavina - tri sa kase i dve sa launchera, u isto vreme ----
await cekaj(1500); // da kocnica brzine porudzbina (6 pa 1/s) ne bude razlog odbijanja
await api(`/api/players/${p2.id}/topup`, "POST", { amount: round2(200 - stanje(p2.id)) });
poruke.length = 0;
const kasaA3 = Promise.all(Array.from({ length: 3 }, () =>
  api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], playerId: p2.id, payment: "credit" })));
for (let i = 0; i < 2; i++) ws.send(JSON.stringify({ t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit", poId: `mesano-${i}` }));
const r3 = await kasaA3;
await cekaj(1000);
const uspehA3 = r3.filter((r) => r.status === 200).length + poruke.filter((m) => m.t === "order_ok").length;
const odbijA3 = r3.filter((r) => r.status === 400).length + poruke.filter((m) => m.t === "order_err").length;
b.proveri("A3 kasa + launcher: tacno jedna od pet prolazi", uspehA3 === 1 && odbijA3 === 4, `uspelo ${uspehA3}, odbijeno ${odbijA3}`);
b.proveri("A3: kredit nije u minusu", stanje(p2.id) >= 0, String(stanje(p2.id)));
ws.send(JSON.stringify({ t: "logout" }));
await cekaj(500);
ws.close();
b.proveri("A2/A3: knjiga se slaze sa nalogom (i sa naplatom vremena)", knjigaUredna(p2.id).ok, JSON.stringify(knjigaUredna(p2.id).greske));
function round2(n) { return Math.round(n * 100) / 100; }

// ================= B) SAMA BAZA: PET VEZA, ISTA BARIJERA =================
const pusti = async (nacin, playerId, broj = 5, dodatno = {}) => {
  const barijera = new SharedArrayBuffer(16);
  return Promise.all(Array.from({ length: broj }, (_, redni) => new Promise((res) => {
    const w = new Worker(path.join(OVDE, "_paralelni-radnik.mjs"), {
      workerData: { koren: KOREN, nacin: Array.isArray(nacin) ? nacin[redni] : nacin, barijera, broj, redni, playerId,
        artikal: kola.id, cena: CENA, ...dodatno },
    });
    w.once("message", res);
    w.once("error", (e) => res({ redni, ok: false, greska: "nit je pukla: " + e.message }));
  })));
};

// ---- B1: prava putanja (racun na kasi) iz pet niti ----
const p3 = await nalog("tri", CENA);
const zalihaB1 = zaliha();
const b1 = await pusti("kasa", p3.id);
const okB1 = b1.filter((r) => r.ok);
const errB1 = b1.filter((r) => !r.ok);
b.proveri("B1 pet veza, racun na kasi: tacno jedan prolazi", okB1.length === 1, JSON.stringify(b1));
b.proveri("B1: ostala cetiri dobijaju 'Nedovoljno kredita'", errB1.length === 4 && errB1.every((r) => /^Nedovoljno kredita \(potrebno 130, ima 0\)$/.test(r.greska)),
  JSON.stringify(errB1.map((r) => r.greska)));
b.proveri("B1: kredit 0, jedna porudzbina, zaliha skinuta jednom",
  stanje(p3.id) === 0 && brojPorudzbina(p3.id) === 1 && zaliha() === zalihaB1 - 1, `${stanje(p3.id)} / ${brojPorudzbina(p3.id)} / ${zalihaB1}->${zaliha()}`);
b.proveri("B1: knjiga uredna", knjigaUredna(p3.id).ok, JSON.stringify(knjigaUredna(p3.id).greske));

// ---- B2: najgori slucaj - svi videli dovoljno, poslovi se preklapaju ----
const p4 = await nalog("cetiri", CENA);
const b2 = await pusti("zastareo", p4.id);
b.proveri("B2: svih pet je PRE kupovine videlo 130 (svako je mislilo da ima dovoljno)", b2.every((r) => r.video === 130), JSON.stringify(b2));
const okB2 = b2.filter((r) => r.ok), errB2 = b2.filter((r) => !r.ok);
b.proveri("B2: i pored toga tacno jedan prolazi", okB2.length === 1, JSON.stringify(b2));
b.proveri("B2: cetiri dobijaju NedovoljnoKredita sa jasnom porukom",
  errB2.length === 4 && errB2.every((r) => r.kod === "NEDOVOLJNO_KREDITA" && /^Nedovoljno kredita \(potrebno 130, ima 0\)$/.test(r.greska)),
  JSON.stringify(errB2));
b.proveri("B2: kredit tacno 0", stanje(p4.id) === 0, String(stanje(p4.id)));
const kB2 = kupovineUKnjizi(p4.id);
b.proveri("B2: knjiga ima jednu kupovinu, 130 -> 0", kB2.length === 1 && kB2[0].stanje_pre === 130 && kB2[0].stanje_posle === 0, JSON.stringify(kB2));
b.proveri("B2: knjiga uredna", knjigaUredna(p4.id).ok, JSON.stringify(knjigaUredna(p4.id).greske));

// ---- B3: KONTROLA - stari obrazac stvarno gubi upise ----
// Ako ovo ne propadne, test iznad ne dokazuje nista (mozda se niti nisu ni
// preklopile). Propada: svih pet "kupi", a skinuto je samo jednom.
const p5 = await nalog("kontrola", CENA);
const b3 = await pusti("naivno", p5.id);
const okB3 = b3.filter((r) => r.ok).length;
b.proveri("KONTROLA: stari obrazac (citanje van posla) pusti vise od jedne kupovine", okB3 > 1, `${okB3} od 5 "uspelo"`);
b.proveri("KONTROLA: ...a kredit je skinut samo jednom - izgubljeni upisi", stanje(p5.id) === 0 && okB3 * CENA > CENA,
  `"prodato" za ${okB3 * CENA}, skinuto 130`);
const kontrola = knjigaUredna(p5.id);
b.proveri("KONTROLA: provera knjige otkriva novac pomeren mimo knjige",
  !kontrola.ok && kontrola.greske.some((g) => g.vrsta === "stanje_ne_odgovara"), JSON.stringify(kontrola.greske));

// ================= C) VREME I PORUDZBINA NAD ISTIM KREDITOM =================
// Kredit tacno 130. Naplata vremena trazi 130, racun na kasi trazi 130, u istom
// trenutku. Dobija samo jedno - nikad oba, nikad minus.
const p6 = await nalog("sest", 0);
let oba = 0, nijedno = 0, minus = 0, krugova = 0;
const ishodi = { porudzbina: 0, vreme: 0 };
for (let krug = 0; krug < 8; krug++) {
  const dopuna = round2(CENA - stanje(p6.id));
  if (dopuna) await api(`/api/players/${p6.id}/topup`, "POST", { amount: dopuna });
  const r = await pusti(["vreme", "kasa"], p6.id, 2);
  const vreme = r.find((x) => x.nacin === "vreme");
  const kasa = r.find((x) => x.nacin === "kasa");
  const porudzbinaProsla = kasa.ok === true;
  const vremeNaplaceno = blizu(vreme.naplaceno, CENA);
  if (porudzbinaProsla && vreme.naplaceno > 0) oba++;
  if (!porudzbinaProsla && !vremeNaplaceno) nijedno++;
  if (stanje(p6.id) < 0) minus++;
  if (porudzbinaProsla) ishodi.porudzbina++; else ishodi.vreme++;
  krugova++;
}
b.proveri("C: nijednom nije naplaceno i vreme i porudzbina", oba === 0, `${oba} od ${krugova}`);
b.proveri("C: svaki put je kredit otisao na tacno jedno", nijedno === 0, JSON.stringify(ishodi));
b.proveri("C: kredit nikad u minusu", minus === 0);
b.proveri("C: knjiga uredna posle svih krugova", knjigaUredna(p6.id).ok, JSON.stringify(knjigaUredna(p6.id).greske));

// ================= D) BAZA SAMA ODBIJA MINUS I IZMENU KNJIGE =================
const baca = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
b.proveri("D: direktan upis minusa u bazu je odbijen",
  /minus/.test(baca(() => db.prepare("UPDATE players SET balance=-1 WHERE id=?").run(p1.id)) || ""));
b.proveri("D: nov nalog sa minusom je odbijen",
  /minus/.test(baca(() => db.prepare("INSERT INTO players (username, password_hash, balance, created_at) VALUES ('m','x',-5,0)").run()) || ""));
b.proveri("D: zapis iz knjige ne moze da se obrise", /ne brise/.test(baca(() => db.prepare("DELETE FROM audit_log").run()) || ""));
b.proveri("D: zatvoren zapis iz knjige ne moze da se izmeni",
  /ne menja/.test(baca(() => db.prepare("UPDATE audit_log SET iznos = 0 WHERE id = ?").run(k1[0].id)) || ""));
b.proveri("D: knjizenje van posla je odbijeno", /uJednomPoslu/.test(baca(() => knjiga.promeniKredit({ playerId: p1.id, iznos: 5, tip: "uplata" })) || ""));

// ================= UKUPNO =================
b.proveri("nijedan nalog nije u minusu", db.prepare("SELECT COUNT(*) n FROM players WHERE balance < 0").get().n === 0);
const sve = knjiga.proveri();
const bezKontrole = sve.greske.filter((g) => g.playerId !== p5.id);
b.proveri("cela knjiga uredna (osim namerne kontrole)", bezKontrole.length === 0, JSON.stringify(bezKontrole.slice(0, 3)));
b.proveri("server i dalje radi", (await api("/api/computers")).status === 200);

await b.kraj();
