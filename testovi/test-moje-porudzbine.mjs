import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Igrac mora da vidi svoje porudzbine i njihov status, ne samo poruku od par
// sekundi koja promakne dok je u igri.
const BASE = "http://127.0.0.1:8104", WSB = "ws://127.0.0.1:8104";
const DATA = radniFolder("porudzbine-igraca");
await podigniServer(DATA, 8104);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/computers/bulk", "POST", { count: 2, prefix: "PC-" });
await api("/api/shop", "POST", { name: "Kola", category: "Pica", price: 140, stock: "" });
await api("/api/shop", "POST", { name: "Voda", category: "Vode", price: 100, stock: "" });
const artikli = await api("/api/shop");
const kola = artikli.find((i) => i.name === "Kola"), voda = artikli.find((i) => i.name === "Voda");
await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 1000 });
await api("/api/players", "POST", { username: "ana", password: "test1234", balance: 1000 });

const comps = await api("/api/computers");
const poruke = [];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
ws.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(700);

const prijava = poruke.find((m) => m.t === "login_ok");
proveri("prijava nosi spisak porudzbina", Array.isArray(prijava.porudzbine), JSON.stringify(prijava.porudzbine));
proveri("nov igrac nema porudzbina", prijava.porudzbine.length === 0);

const zadnji = () => [...poruke].reverse().find((m) => m.t === "moje_porudzbine");

// --- porudzbina odmah stize u spisak ---
poruke.length = 0;
ws.send(JSON.stringify({ t: "order", items: [{ id: kola.id, qty: 2 }], payment: "credit" }));
await cekaj(700);
const p1 = zadnji();
proveri("posle porucivanja stize spisak", !!p1, "nema poruke moje_porudzbine");
proveri("porudzbina je u spisku", p1?.porudzbine.length === 1, JSON.stringify(p1?.porudzbine));
proveri("status je primljeno", p1?.porudzbine[0].status === "pending", p1?.porudzbine[0].status);
proveri("stavke su tu", p1?.porudzbine[0].items[0].qty === 2 && p1?.porudzbine[0].items[0].name === "Kola", JSON.stringify(p1?.porudzbine[0].items));
proveri("nacin placanja zapamcen", p1?.porudzbine[0].payment === "credit", p1?.porudzbine[0].payment);
const orderId = p1.porudzbine[0].id;

// --- radnik menja status, igrac odmah vidi ---
poruke.length = 0;
await api(`/api/orders/${orderId}/status`, "POST", { status: "preparing" });
await cekaj(600);
proveri("promena statusa stize igracu", zadnji()?.porudzbine[0].status === "preparing", zadnji()?.porudzbine[0].status);

poruke.length = 0;
await api(`/api/orders/${orderId}/status`, "POST", { status: "delivered" });
await cekaj(600);
proveri("dostavljeno stize igracu", zadnji()?.porudzbine[0].status === "delivered", zadnji()?.porudzbine[0].status);

// --- otkazivanje ---
poruke.length = 0;
ws.send(JSON.stringify({ t: "order", items: [{ id: voda.id, qty: 1 }], payment: "cash" }));
await cekaj(700);
const drugi = zadnji().porudzbine[0].id;
poruke.length = 0;
await api(`/api/orders/${drugi}/status`, "POST", { status: "cancelled" });
await cekaj(600);
const posle = zadnji()?.porudzbine.find((o) => o.id === drugi);
proveri("otkazano stize igracu", posle?.status === "cancelled", JSON.stringify(posle));
proveri("novija porudzbina je prva", zadnji()?.porudzbine[0].id === drugi, JSON.stringify(zadnji()?.porudzbine.map((o) => o.id)));

// --- tudje porudzbine se ne vide ---
const ws2 = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[1].token)}`);
const poruke2 = [];
ws2.on("message", (b) => { try { poruke2.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { ws2.once("open", res); ws2.once("error", rej); });
ws2.send(JSON.stringify({ t: "login", username: "ana", password: "test1234" }));
await cekaj(700);
const anaPrijava = poruke2.find((m) => m.t === "login_ok");
proveri("ana ne vidi markove porudzbine", anaPrijava.porudzbine.length === 0, JSON.stringify(anaPrijava.porudzbine));

// --- ponovna prijava zadrzava istoriju ---
ws.send(JSON.stringify({ t: "logout" }));
await cekaj(500);
poruke.length = 0;
ws.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(700);
const ponovo = poruke.find((m) => m.t === "login_ok");
proveri("posle ponovne prijave spisak je tu", ponovo.porudzbine.length === 2, JSON.stringify(ponovo.porudzbine.map((o) => o.status)));

// --- klijentski deo: koje se prikazuju i GDE ---
//
// Isti spisak je ranije stajao i u Shop-u i na nalogu, sa dva razlicita
// markupa. Igrac je istu stvar vidjao dvaput, a svaka izmena je morala na dva
// mesta. Sada spisak zivi samo na nalogu, a Shop nosi jednu liniju dok se
// porudzbina sprema.
const izvor = citajIzvor("client/renderer/js/launcher.js");
proveri("spisak porudzbina postoji na nalogu", /function sekcijaPorudzbine\(\)/.test(izvor));
proveri("aktivne se izdvajaju od ranijih", /const aktivne = aktivnePorudzbine\(\)/.test(izvor));
proveri("sta je aktivno racuna se na jednom mestu",
  /const aktivnePorudzbine = \(\) =>[\s\S]{0,140}pending[\s\S]{0,40}preparing/.test(izvor),
  "dve definicije istog uslova se razidju cim se jedna promeni");

const shopBlok = izvor.slice(izvor.indexOf("function shopPorudzbine()"),
  izvor.indexOf("const oblikKom"));
proveri("Shop vise ne crta ceo spisak", !/\.map\(red\)/.test(shopBlok) && !/STATUS_PORUDZBINE/.test(shopBlok),
  "to je bio duplikat spiska sa naloga");
proveri("Shop pokazuje samo dok nesto stize", /if \(!aktivne\.length\) return "";/.test(shopBlok));
proveri("traka iz Shop-a vodi na nalog", /data-acc-sekcija="porudzbine"/.test(shopBlok),
  "inace igrac vidi da nesto stize, ali ne i gde da pogleda");

// Koliko se ranijih cuva odlucuje SERVER (igracevePorudzbine, limit 6), pa
// klijent nema sta da secka - inace bi dva razlicita ogranicenja radila jedno
// protiv drugog.
proveri("klijent ne secka spisak sam", !/ranije[\s\S]{0,60}\.slice\(0,/.test(izvor),
  "granicu drzi server, na jednom mestu");

ws.close(); ws2.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
