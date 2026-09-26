import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Ista porudzbina se ne naplacuje dvaput.
//
// Dugme se otkljucava posle osam sekundi bez odgovora, pa zakasneli drugi klik
// moze da stigne kao nova porudzbina. Zato svaka porudzbina nosi broj pokusaja;
// server pamti sta je sa tim brojem uradio i drugi put vraca isti odgovor. Ovde
// se server gadja direktno, bez dugmeta.
const BASE = "http://127.0.0.1:8178", WSB = "ws://127.0.0.1:8178";
await podigniServer(radniFolder("dvostruka-data"), 8178);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.01;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const artikli = await api("/api/shop");
const kola = artikli.find((i) => i.name.startsWith("Coca-Cola")); // 130
await api("/api/shift/open", "POST", { openingCash: 0 });
const igrac = await api("/api/players", "POST", { username: "pera", password: "pera1234", balance: 5000 });
const broj = async () => (await api("/api/orders?all=1")).length;

// ---- 1) KASA: isti broj pokusaja, tri puta ----
// Ovako izgleda radnik koji je kliknuo, cekao, pa kliknuo opet.
const POID = "proba-1";
const pre = await broj();
const r1 = await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash", poId: POID });
const r2 = await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash", poId: POID });
const r3 = await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash", poId: POID });
proveri("prvi pokusaj pravi racun", r1.ok === true && !!r1.orderId, JSON.stringify(r1));
proveri("ponovljen pokusaj vraca ISTI racun", r2.orderId === r1.orderId && r3.orderId === r1.orderId,
  `${r1.orderId} / ${r2.orderId} / ${r3.orderId}`);
proveri("nastao je SAMO JEDAN racun", (await broj()) === pre + 1, `${pre} -> ${await broj()}`);

const t = (await api("/api/shift")).totals;
proveri("pazar je naplacen jednom", blizu(t.shopCash, 130), `${t.shopCash} umesto 130`);

// Zaliha isto ne sme da se skine tri puta.
await api(`/api/shop/${kola.id}/stock`, "POST", { add: 10 });
const POID2 = "proba-zaliha";
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 2 }], payment: "cash", poId: POID2 });
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 2 }], payment: "cash", poId: POID2 });
const stanje = (await api("/api/shop")).find((x) => x.id === kola.id)?.stock;
proveri("zaliha se skida jednom", stanje === 8, `stanje ${stanje} umesto 8`);

// ---- 2) NOV broj pokusaja = STVARNO nova porudzbina ----
// Ko poruci isto pice dvaput namerno, salje nov broj - i mora da bude naplacen.
const pre2 = await broj();
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash", poId: "proba-2" });
proveri("nov broj pravi nov racun", (await broj()) === pre2 + 1);

// Bez broja se ponasa kao i ranije - stariji launcher ga ne salje, pa ne sme da
// prestane da radi.
const pre3 = await broj();
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash" });
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash" });
proveri("bez broja radi kao i ranije", (await broj()) === pre3 + 2,
  "stariji launcher ga ne salje - ne sme da prestane da radi");

// ---- 3) LAUNCHER: isto, preko pravog WebSocketa ----
const comps = await api("/api/computers");
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
const poruke = [];
ws.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
ws.send(JSON.stringify({ t: "login", username: "pera", password: "pera1234" }));
await cekaj(900);

const kreditPre = (await api("/api/players")).find((p) => p.username === "pera").balance;
const pre4 = await broj();
poruke.length = 0;
for (let i = 0; i < 3; i++) {
  ws.send(JSON.stringify({ t: "order", items: [{ id: kola.id, qty: 1 }], payment: "credit", poId: "igrac-1" }));
  await cekaj(250);
}
await cekaj(900);
const potvrde = poruke.filter((m) => m.t === "order_ok");
proveri("igrac dobija potvrdu na svaki pokusaj", potvrde.length === 3, `${potvrde.length} potvrda`);
proveri("...ali uvek za ISTU porudzbinu", new Set(potvrde.map((p) => p.orderId)).size === 1,
  JSON.stringify(potvrde.map((p) => p.orderId)));
proveri("nastala je samo jedna", (await broj()) === pre4 + 1, `${pre4} -> ${await broj()}`);

const kreditPosle = (await api("/api/players")).find((p) => p.username === "pera").balance;
proveri("KREDIT JE SKINUT JEDNOM", blizu(kreditPre - kreditPosle, 130), `skinuto ${kreditPre - kreditPosle} umesto 130`);

// ---- 4) klijenti stvarno salju taj broj ----
const rend = citajIzvor("client/renderer/js/launcher.js");
proveri("launcher salje broj pokusaja", /window\.crit\.toServer\(\{ t: "order"[^}]*poId \}\)/.test(rend));
proveri("broj se menja kad se korpa promeni", /novPoId\(\); \/\/ promenjena korpa/.test(rend),
  "inace bi druga porudzbina istog pica bila odbijena kao ponavljanje");
const app = citajIzvor("server/public/js/app.js");
proveri("kasa salje broj pokusaja", /poId: state\.posId/.test(app));
proveri("kasa ga menja kad se racun promeni", /state\.posId = null; \/\/ promenjen racun/.test(app));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(300);
process.exit(pao ? 1 : 0);
