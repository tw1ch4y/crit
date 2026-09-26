import { radniFolder, podigniServer, ucitajWebSocket, brojac } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Rang se zaradjuje, VIP se kupuje.
//
//   1. VIP se naplacuje u istom poslu sa upisom roka
//   2. obnova produzava postojeci rok
//   3. pogodnosti rade: dvostruk XP i nizi prag za tocak
//   4. VIP izgled se ne moze uzeti mimo launchera
//   5. istekla clanarina prestaje da vazi sama
const BASE = "http://127.0.0.1:8195", WSB = "ws://127.0.0.1:8195";
await podigniServer(radniFolder("vip-data"), 8195);
const { proveri, kraj } = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const svc = await import("../server/src/service.js");
const { db } = await import("../server/src/db.js");
const vip = await import("../server/src/vip.js");

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const DAN = 86400000;

// ---- 0) SAM RACUN, BEZ BAZE ----
proveri("prosao rok nije VIP", !vip.vaziVip(Date.now() - 1000));
proveri("buduci rok jeste", vip.vaziVip(Date.now() + DAN));
proveri("prazan rok nije", !vip.vaziVip(null) && !vip.vaziVip(0) && !vip.vaziVip("kad-tad"));
proveri("dani se zaokruzuju NAGORE", vip.danaOstalo(Date.now() + DAN * 1.2) === 2,
  "ko ima jos pola dana ima 'jos 1 dan', ne 'jos 0'");

// OBNOVA SE NADOVEZUJE.
const rok = Date.now() + 10 * DAN;
const posle = vip.novRok(rok, 30);
proveri("obnova PRODUZAVA postojeci rok", Math.round((posle - rok) / DAN) === 30,
  "inace bi gost koji obnovi dan ranije izgubio taj dan - i naucio da ceka da mu istekne");
proveri("obnova posle isteka krece od danas",
  Math.round((vip.novRok(Date.now() - 5 * DAN, 30) - Date.now()) / DAN) === 30);

// MNOZILAC I PRAG NE SMEJU DA KAZNE.
proveri("ne-VIP uvek ima mnozilac 1", vip.xpMnozilac(false, 5) === 1);
proveri("mnozilac ispod 1 se ne prima", vip.xpMnozilac(true, 0.5) === 1,
  "mnozilac manji od 1 bi bio KAZNA za one koji nisu kupili, a to nije nagrada za one koji jesu");
proveri("VIP prag nikad nije visi od obicnog",
  vip.pragZaSpin({ jeVip: true, prag: 1200, vipPrag: 5000 }) === 1200,
  "greska u kucanju bi inace VIP pretvorila u kaznu");

// ---- 1) PODESAVANJA ----
proveri("VIP na pocetku nije u ponudi", (await api("/api/vip")).body.ukljucen === false);
const lose = await api("/api/vip", "POST", { xpMnozilac: 0.5 });
proveri("mnozilac ispod 1 se odbija i na ruti", lose.status === 400, JSON.stringify(lose.body));
proveri("trajanje van granica se odbija",
  (await api("/api/vip", "POST", { dana: 999 })).status === 400);
const post = await api("/api/vip", "POST", { ukljucen: true, cena: 1500, dana: 30, xpMnozilac: 2, tocakPrag: 700 });
proveri("podesavanje prolazi", post.status === 200 && post.body.ukljucen === true, JSON.stringify(post.body));
proveri("ponuda nosi spisak pogodnosti", (post.body.pogodnosti || []).length >= 4);

// ---- 2) KUPOVINA ----
const igrac = (await api("/api/players", "POST", { username: "kupac", password: "kupac123", balance: 500 })).body;
const bez = svc.kupiVip(igrac.id);
proveri("bez dovoljno kredita se ne prodaje", !!bez.error, bez.error);
proveri("i kaze KOLIKO tacno fali", /Fali ti još \d+/.test(bez.error || ""), bez.error);

await api(`/api/players/${igrac.id}/topup`, "POST", { amount: 2000 });
const pre = (await api("/api/players")).body.find((p) => p.id === igrac.id).balance;
const kupio = svc.kupiVip(igrac.id);
proveri("kupovina prolazi", kupio.ok === true, JSON.stringify(kupio));
const posleKupovine = (await api("/api/players")).body.find((p) => p.id === igrac.id).balance;
proveri("KREDIT JE STVARNO SKINUT", Math.round(pre - posleKupovine) === 1500,
  `${pre} -> ${posleKupovine}`);
proveri("rok je upisan na 30 dana", kupio.dana === 30, String(kupio.dana));

// Obnova dok jos traje - rok se nadovezuje, ne pocinje ispocetka.
await api(`/api/players/${igrac.id}/topup`, "POST", { amount: 2000 });
const obnova = svc.kupiVip(igrac.id);
proveri("obnova dok traje daje 60 dana", obnova.dana === 60, String(obnova.dana));

// ---- 3) POGODNOSTI STVARNO RADE ----
//
// DVOSTRUK XP. Mnozilac stoji na JEDNOM mestu kroz koje prolazi svaki XP - i od
// vremena i od pica. Da se mnozilo na mestu poziva, jedno od ta dva bi pre ili
// kasnije ostalo bez njega i VIP bi tiho vazio samo za pola.
const xpPre = db.prepare("SELECT xp FROM players WHERE id=?").get(igrac.id).xp;
svc.dodajXp(igrac.id, 100);
const xpPosle = db.prepare("SELECT xp FROM players WHERE id=?").get(igrac.id).xp;
proveri("VIP dobija DVOSTRUK XP", Math.round(xpPosle - xpPre) === 200, `${xpPre} -> ${xpPosle}`);

const obican = (await api("/api/players", "POST", { username: "obican", password: "obican12", balance: 300 })).body;
const oPre = db.prepare("SELECT xp FROM players WHERE id=?").get(obican.id).xp;
svc.dodajXp(obican.id, 100);
proveri("ne-VIP dobija koliko je i potrosio",
  Math.round(db.prepare("SELECT xp FROM players WHERE id=?").get(obican.id).xp - oPre) === 100);

// NIZI PRAG ZA TOCAK.
await api("/api/tocak", "POST", { ukljucen: true, prag: 1200 });
proveri("obicnom gostu prag ostaje 1200", svc.tocakInfo(obican.id).prag === 1200,
  String(svc.tocakInfo(obican.id).prag));
proveri("VIP-u je prag nizi", svc.tocakInfo(igrac.id).prag === 700,
  String(svc.tocakInfo(igrac.id).prag));

// ---- 4) VIP IZGLED SE NE MOZE UZETI MIMO LAUNCHERA ----
//
// Launcher zakljucano prikazuje sivo i ne da da se klikne - ali launcher stoji
// na racunaru igraca. Poruka koja stigne mimo njega mora da dobije isti odgovor.
const kradja = svc.sacuvajProfilIgraca(obican.id, { boja: "plamen" });
proveri("ne-VIP ne moze da uzme VIP boju", !!kradja.error, kradja.error);
proveri("i receno mu je zasto", /VIP/.test(kradja.error || ""), kradja.error);
const sme = svc.sacuvajProfilIgraca(igrac.id, { boja: "plamen" });
proveri("VIP moze", sme.ok === true, JSON.stringify(sme));

// Izbor OSTAJE zapisan i posle isteka - da posle obnove ne mora sve iznova.
db.prepare("UPDATE players SET vip_do=? WHERE id=?").run(Date.now() - DAN, igrac.id);
const profIstekao = svc.profilIgraca(igrac.id);
proveri("istekla clanarina prestaje da vazi sama", profIstekao.clanarina.jeVip === false,
  "rok se ne kvari: prosao je ili nije, i ne treba niko da ga gasi");
proveri("ali izabrana VIP boja ostaje zapisana", profIstekao.izgled.boja === "plamen",
  "inace bi posle obnove morao sve iznova da bira");
proveri("i XP mu se vraca na obicno",
  (() => { const a = db.prepare("SELECT xp FROM players WHERE id=?").get(igrac.id).xp;
    svc.dodajXp(igrac.id, 100);
    return Math.round(db.prepare("SELECT xp FROM players WHERE id=?").get(igrac.id).xp - a) === 100; })());

// ---- 5) OSOBLJE DAJE VIP ZA KES ----
const dat = await api(`/api/players/${obican.id}/vip`, "POST", { dana: 7 });
proveri("radnik moze da upise VIP", dat.status === 200 && dat.body.dana === 7, JSON.stringify(dat.body));
const oduzet = await api(`/api/players/${obican.id}/vip`, "POST", { dana: 0 });
proveri("nula oduzima odmah", oduzet.status === 200 && oduzet.body.dana === 0);
proveri("besmislen broj dana se odbija",
  (await api(`/api/players/${obican.id}/vip`, "POST", { dana: -5 })).status === 400);

// ---- 5b) KES ZA VIP MORA DA ZAVRSI U PAZARU ----
//
// Placanje kesom se vodi kao dopuna pa odmah naplata clanarine: stanje na nalogu
// ostaje isto, a oba koraka su u obracunu.
await api("/api/shift/open", "POST", { openingCash: 1000 });
const preKesa = (await api("/api/players")).body.find((p) => p.id === obican.id).balance;
const kes = await api(`/api/players/${obican.id}/vip`, "POST", { dana: 30, naplati: 1500 });
proveri("upis sa naplatom prolazi", kes.status === 200 && kes.body.naplaceno === 1500, JSON.stringify(kes.body));
const posleKesa = (await api("/api/players")).body.find((p) => p.id === obican.id).balance;
proveri("KREDIT GOSTU OSTAJE NEDIRNUT", Math.round(posleKesa - preKesa) === 0,
  `${preKesa} -> ${posleKesa}; gost je platio clanarinu, nije dopunio nalog`);
const smena = await api("/api/shift");
proveri("KES ZA VIP ULAZI U PAZAR SMENE", smena.body?.totals?.topups === 1500,
  `topups=${smena.body?.totals?.topups}; bez ovoga u fioci stoji visak koji obracun ne pominje`);
const t = smena.body?.totals || {};
proveri("i kasa ga ocekuje pri zatvaranju",
  smena.body.openingCash + t.topups - t.deducts + t.shopCash === 2500,
  `ocekivano=${smena.body.openingCash + t.topups - t.deducts + t.shopCash} (1000 pocetno + 1500 kes)`);

// POKLONJEN VIP NE DIRA KASU.
const preP = (await api("/api/shift")).body.totals.topups;
const poklon = await api(`/api/players/${obican.id}/vip`, "POST", { dana: 7 });
proveri("poklonjen VIP prolazi bez naplate", poklon.status === 200 && poklon.body.naplaceno === 0);
proveri("i ne pomera pazar", (await api("/api/shift")).body.totals.topups === preP,
  "poklon nije novac u fioci");
proveri("oduzimanje se ne naplacuje",
  (await api(`/api/players/${obican.id}/vip`, "POST", { dana: 0, naplati: 500 })).status === 400);

// KUPOVINA KREDITOM NE SME DA NAPUHA KASU.
//
// Ovo je greska koja je vec bila u kodu: log kupovine nosio je `amount`, a iz
// `logs.amount` u kategoriji "novac" se racuna koliko para radnik mora da ima
// na kraju smene. Svaka clanarina placena kreditom trazila je od radnika 1500
// dinara viska - i to bi ispilo tek uvece, kao manjak bez objasnjenja.
const preKredit = (await api("/api/shift")).body.totals.topups;
await api(`/api/players/${igrac.id}/topup`, "POST", { amount: 2000 });
svc.kupiVip(igrac.id);
const posleKredit = (await api("/api/shift")).body.totals.topups;
proveri("kupovina KREDITOM ne dodaje nista u kasu", posleKredit - preKredit === 2000,
  `razlika ${posleKredit - preKredit}; sme da udje samo dopuna od 2000, ne i clanarina`);

// ---- 5c) VIP SE VIDI U IZVESTAJU ----
//
// Da ne ulazi u promet, VIP bi izgledao kao da ne donosi nista - pa bi ga
// vlasnik prvi ugasio, bas onu stvar koja se prodaje sama i ne trazi radnika.
const izv = (await api("/api/stats?period=today")).body;
proveri("VIP clanarine stoje u prometu", (izv?.revenue?.vip || 0) >= 1500,
  `vip=${izv?.revenue?.vip}`);
proveri("i ulaze u ukupan promet",
  Math.round(izv.revenue.total) === Math.round(izv.revenue.session + izv.revenue.shop + izv.revenue.vip),
  JSON.stringify(izv.revenue));
await api("/api/shift/close", "POST", { closingCash: "" });

// ---- 5d) OSOBLJE VIDI KO JE VIP, BEZ OTVARANJA ICEGA ----
const spisak = (await api("/api/players")).body;
const vipRed = spisak.find((p) => p.id === obican.id);
proveri("spisak igraca nosi VIP oznaku", vipRed.vip === true, JSON.stringify(vipRed));
proveri("i koliko je jos ostalo", vipRed.vipDana > 0, String(vipRed.vipDana));

// ---- 5e) PREDNOST NA KASI ----
//
// Obecana je u spisku pogodnosti, pa mora i da postoji: radnik radi odozgo
// nadole, i "prednost" znaci tacno to - dok ceka, VIP porudzbina stoji iznad
// ostalih.
const artikal = (await api("/api/shop", "POST", { name: "Sok", price: 100, stock: 100 })).body;
const kupi = async (id) => (await api("/api/pos", "POST", { playerId: id, payment: "cash",
  items: [{ id: artikal.id, qty: 1 }] })).body?.orderId;
// "igrac" je gore opet kupio VIP kreditom - da bi poredjenje imalo smisla,
// jedan od dvojice mora da bude obican gost.
await api(`/api/players/${igrac.id}/vip`, "POST", { dana: 0 });
// Redosled kucanja je namerno obrnut od ocekivanog: VIP porudzbina je STARIJA.
// Da je novija, stajala bi prva i bez ijedne pogodnosti - pa test ne bi merio
// nista.
const vipBr = await kupi(obican.id);          // "obican" je VIP
await cekaj(20);
const obicanBr = await kupi(igrac.id);        // ovome je VIP upravo oduzet
const aktivne = (await api("/api/orders")).body;
proveri("VIP porudzbina je PRVA u spisku", aktivne[0]?.id === vipBr,
  `redosled: ${aktivne.map((o) => o.id + (o.vip ? "(vip)" : "")).join(", ")}; ${obicanBr} je NOVIJA pa bi inace bila prva`);
proveri("i nosi oznaku, da radnik vidi zasto", aktivne[0]?.vip === true);
proveri("obicna porudzbina nije oznacena",
  aktivne.find((o) => o.id === obicanBr)?.vip === false);
// Istorija je evidencija i cita se po vremenu - nju niko ne preredja.
for (const o of aktivne) await api(`/api/orders/${o.id}/status`, "POST", { status: "delivered" });
const sve = (await api("/api/orders?all=1")).body;
const iA = sve.findIndex((o) => o.id === vipBr), iB = sve.findIndex((o) => o.id === obicanBr);
proveri("istorija ostaje po vremenu, bez preredjanja", iB >= 0 && iB < iA,
  `vip na ${iA}, obicna na ${iB}; novija (obicna) mora da bude prva jer je novija`);

// ---- 6) KUPOVINA MIMO LAUNCHERA ----
//
// "obican" ima 300 din: dovoljno da se PRIJAVI (bez kredita launcher ne pusta
// na masinu), a premalo za VIP od 1500 - pa provera stvarno nesto cuva.
const comps = (await api("/api/computers")).body;
const poruke = [];
const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
w.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { w.once("open", res); w.once("error", rej); });
w.send(JSON.stringify({ t: "login", username: "obican", password: "obican12" }));
await cekaj(900);
proveri("igrac se prijavio preko poruke", !!poruke.find((m) => m.t === "login_ok"),
  JSON.stringify(poruke.map((m) => m.t + (m.message ? ": " + m.message : ""))));
poruke.length = 0;
w.send(JSON.stringify({ t: "kupi_vip" }));
await cekaj(500);
const odbijen = poruke.find((m) => m.t === "vip_err");
proveri("bez kredita se ne prodaje ni preko poruke", !!odbijen, JSON.stringify(poruke.map((m) => m.t)));
w.close();
await cekaj(200);

kraj();
