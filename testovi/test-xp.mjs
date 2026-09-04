import { radniFolder, podigniServer, ucitajWebSocket, brojac } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// ISKUSTVO SE ZARADJUJE, NE POKLANJA
//
// Jedan potrosen dinar = jedan XP. Ovde se ne proverava racun nivoa (to radi
// test-nivoi.mjs, bez servera) nego ono sto se moze pokvariti tek u igraonici:
//
//   - da POTROSNJA donosi iskustvo, a DOPUNA ne
//   - da poklonjen kredit i nagrada sa tocka NE donose - inace je tocak precica
//     do nivoa, a nivo prestaje da znaci da je neko igrao
//   - da se zakljucane stvari ne mogu uzeti mimo launchera
//   - da igrac odmah vidi da je presao nivo
const BASE = "http://127.0.0.1:8187", WSB = "ws://127.0.0.1:8187";
await podigniServer(radniFolder("xp-data"), 8187);
const { proveri, kraj } = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; });

const xpOd = async (id) => (await api("/api/players")).body.find((p) => p.id === id)?.xp;

await api("/api/shift/open", "POST", { openingCash: 0 });
const igrac = (await api("/api/players", "POST", { username: "pera", password: "pera1234", balance: 10000 })).body;
proveri("nov igrac krece od nula iskustva", (await xpOd(igrac.id)) === 0, String(await xpOd(igrac.id)));
proveri("nov igrac je na prvom nivou",
  (await api("/api/players")).body.find((p) => p.id === igrac.id)?.nivo === 1);

// ---- 1) DOPUNA NE DONOSI ISKUSTVO ----
//
// Dopuna je obecanje, potrosnja je ono sto se stvarno desilo. Ko dopuni 5000 i
// ode kuci nije igrao. Da dopuna daje XP, nivo bi merio koliko je neko uplatio,
// a ne koliko je proveo u igraonici.
await api(`/api/players/${igrac.id}/topup`, "POST", { amount: 5000 });
proveri("DOPUNA NE DONOSI ISKUSTVO", (await xpOd(igrac.id)) === 0, String(await xpOd(igrac.id)));

// ---- 2) potrosnja u shopu donosi ----
const pice = (await api("/api/shop")).body.find((x) => x.price > 0);
const r = await api("/api/pos", "POST", { items: [{ id: pice.id, qty: 2 }], payment: "credit", playerId: igrac.id });
proveri("kupovina kreditom je prosla", r.status === 200, JSON.stringify(r.body).slice(0, 100));
await cekaj(300);
proveri("POTROSNJA DONOSI ISKUSTVO", (await xpOd(igrac.id)) === pice.price * 2,
  `${await xpOd(igrac.id)} umesto ${pice.price * 2}`);

// ---- 3) KES NE DONOSI ----
//
// Ne zato sto je kes manje vredan, nego zato sto se za kes ne zna ciji je - na
// kasi ga moze platiti i neko ko nije prijavljen ni na jednom racunaru.
const preKes = await xpOd(igrac.id);
await api("/api/pos", "POST", { items: [{ id: pice.id, qty: 3 }], payment: "cash" });
await cekaj(300);
proveri("kes ne donosi iskustvo", (await xpOd(igrac.id)) === preKes, String(await xpOd(igrac.id)));

// ---- 4) POKLONJEN KREDIT NE DONOSI ----
//
// Kuca je dala, igrac nije zaradio. Da poklon daje XP, radnik bi mogao da
// nekome podigne nivo dopunom, a nagradni tocak bi bio precica do svega.
const prePoklon = await xpOd(igrac.id);
await api(`/api/players/${igrac.id}/topup`, "POST", { amount: 3000, note: "poklon" });
await cekaj(200);
proveri("POKLONJEN KREDIT NE DONOSI ISKUSTVO", (await xpOd(igrac.id)) === prePoklon,
  "inace bi nivo merio darezljivost kuce, ne igru");

// ---- 5) zakljucano se ne moze uzeti ni mimo launchera ----
//
// Launcher zakljucane stvari prikazuje sivo i ne da da se kliknu - ali launcher
// stoji na racunaru igraca. Poruka koja stigne mimo njega mora da dobije isti
// odgovor.
const comps = (await api("/api/computers")).body;
const poruke = [];
const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
w.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { w.once("open", res); w.once("error", rej); });
w.send(JSON.stringify({ t: "login", username: "pera", password: "pera1234" }));
await cekaj(700);

const prijava = poruke.find((m) => m.t === "login_ok");
proveri("uz prijavu stize nivo i iskustvo", !!prijava?.vip && Number.isFinite(prijava.vip.nivo),
  JSON.stringify(prijava?.vip));
proveri("uz prijavu stize i profil", !!prijava?.profil?.otkljucano, JSON.stringify(Object.keys(prijava?.profil || {})));

poruke.length = 0;
w.send(JSON.stringify({ t: "moj_profil", boja: "zlatna" }));
await cekaj(400);
const bojaOdbijena = [...poruke].reverse().find((m) => m.t === "profil_err");
proveri("boja imena se ne moze uzeti pre nivoa", !!bojaOdbijena, JSON.stringify(poruke.map((m) => m.t)));
proveri("i receno je na kom nivou dolazi", /nivou/.test(bojaOdbijena?.message || ""), bojaOdbijena?.message);

// Bela i "bez okvira" su podrazumevano - njih sme svako, inace se igrac ne bi
// mogao vratiti na pocetno stanje.
poruke.length = 0;
w.send(JSON.stringify({ t: "moj_profil", boja: "bela" }));
await cekaj(400);
proveri("podrazumevana boja se uvek sme", !!poruke.find((m) => m.t === "profil"),
  JSON.stringify(poruke.map((m) => m.t)));

// ---- 6) PRELAZAK NIVOA SE JAVLJA ODMAH ----
//
// Bez toga bi napredak postojao samo u bazi: igrac bi jednom slucajno primetio
// da mu je traka drugacija, a otkljucana stvar bi stajala neiskoriscena.
poruke.length = 0;
const doNivoa2 = 1200 - (await xpOd(igrac.id));
const kolikoKomada = Math.ceil(doNivoa2 / pice.price);
w.send(JSON.stringify({ t: "order", items: [{ id: pice.id, qty: kolikoKomada }], payment: "credit" }));
await cekaj(900);
const gore = poruke.find((m) => m.t === "nivo_gore");
proveri("prelazak nivoa se javlja igracu ODMAH", !!gore, JSON.stringify(poruke.map((m) => m.t)));
proveri("poruka nosi nivo i naziv", gore?.nivo === 2 && !!gore?.naziv, JSON.stringify(gore));
proveri("poruka kaze STA je otkljucano", Array.isArray(gore?.otkljucano) && gore.otkljucano.length > 0,
  JSON.stringify(gore?.otkljucano));
proveri("uz nivo stize i osvezena traka", !!poruke.find((m) => m.t === "vip"),
  "inace bi traka ostala na starom nivou do sledece prijave");

// Sada sme ono sto je otkljucano na drugom nivou.
poruke.length = 0;
w.send(JSON.stringify({ t: "moja_tekstura", kljuc: "munje", jacina: "jako", kretanje: "talas" }));
await cekaj(500);
proveri("posle nivoa svoja sara radi", !!poruke.find((m) => m.t === "tekstura"),
  JSON.stringify(poruke.map((m) => m.t)));

// ---- 7) panel vidi nivo ----
const uPanelu = (await api("/api/players")).body.find((p) => p.id === igrac.id);
proveri("panel vidi nivo igraca", uPanelu?.nivo === 2 && !!uPanelu?.nivoNaziv, JSON.stringify(uPanelu?.nivo));

w.close();
await cekaj(200);
kraj();
