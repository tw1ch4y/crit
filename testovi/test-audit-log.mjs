import path from "node:path";
import { pathToFileURL } from "node:url";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, panelKlijent, brojac } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// GLAVNA KNJIGA (audit_log)
//
// Jedna smena od pocetka do kraja, sa svim vrstama novca: dopuna, skidanje,
// paket, kupovina sa naloga i kešom, otkazivanje oba, vreme za racunarom,
// tocak, brisanje naloga sa kreditom, zatvaranje kase sa manjkom. Posle svakog
// koraka se proverava sta je knjiga zapisala: ko, sta, koliko, stanje pre i
// posle - i na kraju da se lanac ne prekida i da se kasa iz knjige poklapa sa
// obracunom smene.

const PORT = 8223, BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
const b = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (x, y) => Math.abs(Number(x) - Number(y)) < 0.01;

await podigniServer(radniFolder("audit-log-data"), PORT);
const { db } = await import(pathToFileURL(path.join(KOREN, "server", "src", "db.js")).href);
const knjiga = await import(pathToFileURL(path.join(KOREN, "server", "src", "knjiga.js")).href);
const svc = await import(pathToFileURL(path.join(KOREN, "server", "src", "service.js")).href);
const api = await panelKlijent(BASE);
const admin = (await api("/api/me")).body.admin;

const poslednji = (uslov = "1=1", ...arg) => db.prepare(`SELECT * FROM audit_log WHERE ${uslov} ORDER BY id DESC LIMIT 1`).get(...arg);
const redovi = (uslov = "1=1", ...arg) => db.prepare(`SELECT * FROM audit_log WHERE ${uslov} ORDER BY id`).all(...arg);
const isti = (z, ocekivano) => Object.entries(ocekivano).every(([k, v]) => (typeof v === "number" ? blizu(z?.[k], v) : z?.[k] === v));
const opis = (z) => JSON.stringify(z && { tip: z.tip, racun: z.racun, iznos: z.iznos, pre: z.stanje_pre, posle: z.stanje_posle, op: z.operator, opId: z.operator_id });
const radnik = { operator: "admin", operator_id: admin.adminId, operator_tip: "radnik" };

// ---- 1. otvaranje smene ----
const t0 = Date.now();
await api("/api/shift/open", "POST", { openingCash: 1000 });
const smena = (await api("/api/shift")).body;
const z1 = poslednji("racun='kasa'");
b.proveri("otvaranje smene: kasa 0 -> 1000", isti(z1, { tip: "otvaranje_smene", racun: "kasa", iznos: 1000, stanje_pre: 0, stanje_posle: 1000, shift_id: smena.id, ...radnik }), opis(z1));
b.proveri("zapis ima vreme (ms) i potpis radnika", z1.ts >= t0 && z1.ts <= Date.now() && z1.operator_id === admin.adminId);

// ---- 2. dopuna: kredit i kasa, jedna operacija ----
const pera = (await api("/api/players", "POST", { username: "pera", password: "pera1234" })).body;
await api(`/api/players/${pera.id}/topup`, "POST", { amount: 500, note: "keš" });
const uplataIgrac = poslednji("racun='igrac' AND player_id=?", pera.id);
const uplataKasa = poslednji("racun='kasa'");
b.proveri("uplata: kredit 0 -> 500", isti(uplataIgrac, { tip: "uplata", iznos: 500, stanje_pre: 0, stanje_posle: 500, ...radnik }), opis(uplataIgrac));
b.proveri("uplata: kasa 1000 -> 1500", isti(uplataKasa, { tip: "uplata", iznos: 500, stanje_pre: 1000, stanje_posle: 1500, player_id: pera.id }), opis(uplataKasa));
b.proveri("uplata: oba reda su ista operacija", uplataIgrac.operacija === uplataKasa.operacija && /^[0-9a-f-]{36}$/.test(uplataIgrac.operacija));

// ---- 3. skidanje (korekcija) ----
await api(`/api/players/${pera.id}/topup`, "POST", { amount: -100, note: "greska pri kucanju" });
b.proveri("korekcija: kredit 500 -> 400", isti(poslednji("racun='igrac' AND player_id=?", pera.id), { tip: "korekcija", iznos: -100, stanje_pre: 500, stanje_posle: 400 }));
b.proveri("korekcija: kasa 1500 -> 1400 (keš vracen)", isti(poslednji("racun='kasa'"), { tip: "korekcija", iznos: -100, stanje_pre: 1500, stanje_posle: 1400 }));
const previse = await api(`/api/players/${pera.id}/topup`, "POST", { amount: -1000 });
b.proveri("skidanje vise nego sto ima: odbijeno, knjiga netaknuta", previse.status === 400 && poslednji("racun='igrac' AND player_id=?", pera.id).stanje_posle === 400);

// ---- 4. paket: placeno 500, kredit +600 (100 popust) ----
const paket = (await api("/api/paketi")).body[0];
await api(`/api/players/${pera.id}/paket`, "POST", { paketId: paket.id });
const [pu, pp] = redovi("racun='igrac' AND player_id=? AND referenca=?", pera.id, `paket:${paket.id}`);
b.proveri("paket: uplata 400 -> 900", isti(pu, { tip: "uplata", iznos: 500, stanje_pre: 400, stanje_posle: 900 }), opis(pu));
b.proveri("paket: popust kao poklon 900 -> 1000", isti(pp, { tip: "poklon", iznos: 100, stanje_pre: 900, stanje_posle: 1000 }), opis(pp));
b.proveri("paket: u kasu ide samo placeno (1400 -> 1900)", isti(poslednji("racun='kasa'"), { tip: "uplata", iznos: 500, stanje_pre: 1400, stanje_posle: 1900 }));

// ---- 5. kupovina: sa naloga i kešom ----
const kola = (await api("/api/shop")).body.find((i) => i.name.startsWith("Coca-Cola"));
const kredit = (await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], playerId: pera.id, payment: "credit" })).body;
const zk = poslednji("racun='igrac' AND player_id=?", pera.id);
b.proveri("kupovina kreditom: 1000 -> 870", isti(zk, { tip: "kupovina_artikla", iznos: -130, stanje_pre: 1000, stanje_posle: 870, referenca: `porudzbina:${kredit.orderId}`, ...radnik }), opis(zk));
b.proveri("kupovina kreditom ne dira kasu", poslednji("racun='kasa'").stanje_posle === 1900);
const kes = (await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], playerId: pera.id, payment: "cash" })).body;
b.proveri("kupovina kešom: kasa 1900 -> 2030, kredit netaknut",
  isti(poslednji("racun='kasa'"), { tip: "kupovina_artikla", iznos: 130, stanje_pre: 1900, stanje_posle: 2030, referenca: `porudzbina:${kes.orderId}` })
  && poslednji("racun='igrac' AND player_id=?", pera.id).stanje_posle === 870);

// ---- 6. storno oba ----
await api(`/api/orders/${kredit.orderId}/status`, "POST", { status: "cancelled" });
b.proveri("storno kredita: 870 -> 1000", isti(poslednji("racun='igrac' AND player_id=?", pera.id), { tip: "storno", iznos: 130, stanje_pre: 870, stanje_posle: 1000, ...radnik }));
await api(`/api/orders/${kes.orderId}/status`, "POST", { status: "cancelled" });
b.proveri("storno keša: kasa 2030 -> 1900", isti(poslednji("racun='kasa'"), { tip: "storno", iznos: -130, stanje_pre: 2030, stanje_posle: 1900 }));
const dupliStorno = await api(`/api/orders/${kredit.orderId}/status`, "POST", { status: "cancelled" });
b.proveri("drugo otkazivanje iste porudzbine ne vraca kredit ponovo",
  dupliStorno.status === 200 && redovi("tip='storno' AND racun='igrac' AND referenca=?", `porudzbina:${kredit.orderId}`).length === 1);

// ---- 7. vreme za racunarom (zbirno) i porudzbina sa launchera ----
const pc = (await api("/api/computers")).body[0];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}&p=2`);
const poruke = [];
ws.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
await new Promise((r) => ws.once("open", r));
ws.send(JSON.stringify({ t: "login", username: "pera", password: "pera1234" }));
await cekaj(11500); // bar dva prolaza naplate (na 5 s)
const otvoren = redovi("tip='trosak_vreme' AND player_id=?", pera.id);
b.proveri("vreme: vise prolaza naplate = JEDAN red u knjizi", otvoren.length === 1, String(otvoren.length));
b.proveri("vreme: red je otvoren dok sesija traje", otvoren[0]?.zatvoren === 0 && otvoren[0].ts_do > otvoren[0].ts, JSON.stringify(otvoren[0]));
b.proveri("vreme: skida sistem, pre/posle se sabiraju",
  otvoren[0]?.operator === "sistem" && otvoren[0].operator_id === null && otvoren[0].iznos < 0
  && blizu(otvoren[0].stanje_pre + otvoren[0].iznos, otvoren[0].stanje_posle), opis(otvoren[0]));
poruke.length = 0;
ws.send(JSON.stringify({ t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit", poId: "audit-1" }));
await cekaj(600);
const zl = poslednji("racun='igrac' AND player_id=?", pera.id);
b.proveri("porudzbina sa launchera: potpis igraca", isti(zl, { tip: "kupovina_artikla", iznos: -130, operator: "pera", operator_tip: "igrac" }) && zl.operator_id === null, opis(zl));
b.proveri("porudzbina zatvara odsecak vremena (lanac se nastavlja)",
  db.prepare("SELECT zatvoren FROM audit_log WHERE id=?").get(otvoren[0].id).zatvoren === 1
  && blizu(db.prepare("SELECT stanje_posle FROM audit_log WHERE id=?").get(otvoren[0].id).stanje_posle, zl.stanje_pre));
await cekaj(5500);
ws.send(JSON.stringify({ t: "logout" }));
await cekaj(600);
ws.close();
const sesija = db.prepare("SELECT * FROM sessions WHERE player_id=? ORDER BY id DESC LIMIT 1").get(pera.id);
const vreme = redovi("tip='trosak_vreme' AND player_id=? AND referenca=?", pera.id, `sesija:${sesija.id}`);
const ukupnoVreme = -vreme.reduce((s, z) => s + z.iznos, 0);
b.proveri("posle odjave su svi redovi vremena zatvoreni", vreme.length >= 2 && vreme.every((z) => z.zatvoren === 1), JSON.stringify(vreme.map((z) => z.zatvoren)));
b.proveri("zbir vremena u knjizi = cena sesije", blizu(ukupnoVreme, sesija.cost), `${ukupnoVreme} / ${sesija.cost}`);
const trajanje = (sesija.ended_at - sesija.started_at) / 1000;
b.proveri("naplaceno nije vise od cene po satu (120 din/h)", sesija.cost <= (trajanje / 3600) * 120 + 0.01,
  `${sesija.cost} za ${trajanje.toFixed(1)} s`);

// ---- 8. naplata je tacna i na dugom roku ----
let ostatak = 0, naplaceno = 0, staro = 1000, bal = 1000;
for (let i = 0; i < 720; i++) {
  const z = svc.zaNaplatu(5, 120, ostatak);
  ostatak = z.ostatak;
  naplaceno = Math.round((naplaceno + z.trazeno) * 100) / 100;
  staro = Math.round((staro - (5 / 3600) * 120) * 100) / 100; // kako je bilo: zaokruzivanje na svakom prolazu
}
b.proveri("sat igre (720 prolaza po 5 s) kosta tacno 120", naplaceno === 120, String(naplaceno));
b.proveri("ranije zaokruzivanje bi naplatilo 122,40", Math.round((bal - staro) * 100) / 100 === 122.4, String(bal - staro));

// ---- 9. tocak: poklon, potpis igraca ----
for (const n of (await api("/api/tocak")).body.nagrade) await api(`/api/tocak/nagrade/${n.id}`, "DELETE");
await api("/api/tocak/nagrade", "POST", { naziv: "50 din", kredit: 50, tezina: 1 });
await api("/api/tocak", "POST", { ukljucen: true, prag: 0 });
const pre9 = poslednji("racun='igrac' AND player_id=?", pera.id).stanje_posle;
svc.zavrtiTocak(pera.id);
b.proveri("tocak: poklon +50, potpis igraca, kasa netaknuta",
  isti(poslednji("racun='igrac' AND player_id=?", pera.id), { tip: "poklon", iznos: 50, stanje_pre: pre9, stanje_posle: pre9 + 50, operator_tip: "igrac" })
  && poslednji("racun='kasa'").tip !== "poklon");

// ---- 10. brisanje naloga sa kreditom ----
const brisi = (await api("/api/players", "POST", { username: "brisi", password: "brisi1234", balance: 75 })).body;
const pocetni = poslednji("racun='igrac' AND player_id=?", brisi.id);
b.proveri("pocetni kredit pri otvaranju naloga: uplata 0 -> 75, potpis radnika", isti(pocetni, { tip: "uplata", iznos: 75, stanje_pre: 0, stanje_posle: 75, ...radnik }), opis(pocetni));
await api(`/api/players/${brisi.id}`, "DELETE");
b.proveri("brisanje: preostali kredit knjizen kao korekcija 75 -> 0",
  isti(poslednji("racun='igrac' AND player_id=?", brisi.id), { tip: "korekcija", iznos: -75, stanje_pre: 75, stanje_posle: 0, ...radnik }));
b.proveri("knjiga obrisanog naloga ostaje (ne brise se sa nalogom)", redovi("player_id=?", brisi.id).length === 2);

// ---- 11. zatvaranje smene sa manjkom ----
const ocekivano = (await api("/api/shift")).body.totals;
const kasaKnjiga = knjiga.stanjeKase(smena.id);
const zatvoreno = (await api("/api/shift/close", "POST", { closingCash: kasaKnjiga - 20 })).body;
b.proveri("kasa iz knjige = ocekivano po obracunu smene", blizu(zatvoreno.summary.kasaPoKnjizi, zatvoreno.summary.expectedCash),
  `knjiga ${zatvoreno.summary.kasaPoKnjizi}, obracun ${zatvoreno.summary.expectedCash}`);
const zz = poslednji("racun='kasa'");
b.proveri("zatvaranje smene: po knjizi -> prebrojano, manjak -20",
  isti(zz, { tip: "zatvaranje_smene", iznos: -20, stanje_pre: kasaKnjiga, stanje_posle: kasaKnjiga - 20, shift_id: smena.id, ...radnik }), opis(zz));
b.proveri("ocekivano u kasi je 1900 (1000 + 500 - 100 + 500, keš otkazan)", blizu(kasaKnjiga, 1900), String(kasaKnjiga));
b.proveri("obracun smene vidi isto", blizu(1000 + ocekivano.topups - ocekivano.deducts + ocekivano.shopCash, 1900), JSON.stringify(ocekivano));

// ---- 12. ceo zapis: polja, tipovi, lanac ----
const sve = redovi();
const trazeni = ["uplata", "trosak_vreme", "kupovina_artikla", "storno", "otvaranje_smene", "zatvaranje_smene"];
b.proveri("knjiga ima sve trazene vrste", trazeni.every((t) => sve.some((z) => z.tip === t)), trazeni.filter((t) => !sve.some((z) => z.tip === t)).join(","));
b.proveri("svaki red ima vreme, operatera, tip, iznos i stanje pre i posle",
  sve.every((z) => Number.isInteger(z.ts) && z.ts > 0 && typeof z.operator === "string" && z.operator
    && ["radnik", "sistem", "igrac"].includes(z.operator_tip) && knjiga.TIPOVI.includes(z.tip)
    && [z.iznos, z.stanje_pre, z.stanje_posle].every((x) => typeof x === "number")));
b.proveri("radnicki redovi nose operator_id", sve.filter((z) => z.operator_tip === "radnik").every((z) => z.operator_id === admin.adminId));
const provera = knjiga.proveri();
b.proveri("lanac je neprekinut i svi nalozi se slazu sa knjigom", provera.ok, JSON.stringify(provera.greske.slice(0, 3)));

// ---- 13. prvo pokretanje na bazi od pre knjige ----
db.prepare("INSERT INTO players (username, password_hash, balance, created_at) VALUES ('stari', 'x', 300, ?)").run(Date.now());
const stari = db.prepare("SELECT id FROM players WHERE username='stari'").get().id;
b.proveri("nalog od pre knjige: provera ga prijavljuje", knjiga.proveri({ playerId: stari }).greske.some((g) => g.vrsta === "nalog_bez_knjige"));
const prenos = knjiga.pripremi();
b.proveri("priprema prenosi pocetno stanje (300)", prenos.naloga === 1
  && isti(poslednji("player_id=?", stari), { tip: "pocetno_stanje", iznos: 0, stanje_pre: 300, stanje_posle: 300 }));
b.proveri("priprema je jednokratna", knjiga.pripremi().naloga === 0);
b.proveri("posle prenosa nalog je uredan", knjiga.proveri({ playerId: stari }).ok);

// ---- 14. API ----
// Storno keša je red na racunu kase, ali i on nosi igraca - zato filter po
// racunu razdvaja vraceni kredit od vracenog keša.
const lista = (await api(`/api/audit?player=${pera.id}&tip=storno&racun=igrac`)).body;
b.proveri("API: filter po igracu, tipu i racunu", lista.items.length === 1 && lista.items[0].racun === "igrac" && lista.ukupno === 1, JSON.stringify(lista).slice(0, 200));
b.proveri("API: bez racuna dobija oba storna", (await api(`/api/audit?player=${pera.id}&tip=storno`)).body.ukupno === 2);
b.proveri("API: provera lanca", (await api("/api/audit/provera")).body.ok === true);
await api("/api/admins", "POST", { username: "radnik1", password: "radnik1234", role: "staff" });
const rt = (await (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "radnik1", password: "radnik1234" }) })).json()).token;
b.proveri("API: radnik ne vidi knjigu", (await fetch(BASE + "/api/audit", { headers: { authorization: "Bearer " + rt } })).status === 403);
const lazni = await api("/api/players", "POST", { username: "lazni", password: "lazni1234", balance: 10, operator: { id: 999, ime: "neko", tip: "sistem" } });
b.proveri("operater se uzima iz prijave, ne iz zahteva", isti(poslednji("player_id=?", lazni.body.id), radnik), opis(poslednji("player_id=?", lazni.body.id)));

await b.kraj();
