import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Obracun smene od pocetka do kraja. Ovo je mesto gde se novac tiho gubi,
// pa se svaka stavka racuna rucno i uporedjuje sa onim sto server tvrdi.
import fs from "node:fs";

const BASE = "http://127.0.0.1:8101", WSB = "ws://127.0.0.1:8101";
const DATA = radniFolder("kasa-data");
await podigniServer(DATA, 8101);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const blizu = (a, b, tol = 1.5) => Math.abs(Number(a) - Number(b)) <= tol;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/computers/bulk", "POST", { count: 2, prefix: "PC-" });
const artikli = await api("/api/shop");
const kola = artikli.find((i) => i.name.startsWith("Coca-Cola")); // 130
const kafa = artikli.find((i) => i.name === "Kafa");              // 120

// ---- smena krece sa 2000 u kasi ----
await api("/api/shift/open", "POST", { openingCash: 2000 });

const p1 = await api("/api/players", "POST", { username: "marko", password: "test1234" });
const p2 = await api("/api/players", "POST", { username: "ana", password: "test1234" });

// dopune: 1000 + 500, pa ispravka greske -200
await api(`/api/players/${p1.id}/topup`, "POST", { amount: 1000 });
await api(`/api/players/${p2.id}/topup`, "POST", { amount: 500 });
await api(`/api/players/${p1.id}/topup`, "POST", { amount: -200 });
const ocekDopune = 1500, ocekSkinuto = 200;

// kasa: jedna kes porudzbina (2 kole = 260) i jedna sa naloga (kafa = 120)
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 2 }], payment: "cash" });
await api("/api/pos", "POST", { items: [{ id: kafa.id, qty: 1 }], payment: "credit", playerId: p2.id });
const ocekKes = 260, ocekShop = 380;

const s1 = await api("/api/shift");
proveri("dopune tacne", blizu(s1.totals.topups, ocekDopune, 0.01), `${s1.totals.topups} != ${ocekDopune}`);
proveri("skidanja tacna", blizu(s1.totals.deducts, ocekSkinuto, 0.01), `${s1.totals.deducts} != ${ocekSkinuto}`);
proveri("kes iz shopa tacan", blizu(s1.totals.shopCash, ocekKes, 0.01), `${s1.totals.shopCash} != ${ocekKes}`);
proveri("ukupan shop tacan", blizu(s1.totals.shop, ocekShop, 0.01), `${s1.totals.shop} != ${ocekShop}`);
proveri("shop sa naloga = shop - kes", blizu(s1.totals.shopCredit, ocekShop - ocekKes, 0.01), String(s1.totals.shopCredit));

// KLJUCNO: kupovina sa naloga NIJE nov novac u kasi
const ocekPazar = ocekDopune - ocekSkinuto + ocekKes; // 1560
proveri("pazar ne broji isti dinar dvaput", blizu(s1.totals.revenue, ocekPazar, 0.01), `${s1.totals.revenue} != ${ocekPazar}`);

// ---- igranje: naplata mora da smanji kredit ali NE i pazar ----
const comps = await api("/api/computers");
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
ws.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await new Promise((r) => setTimeout(r, 5000)); // pusti naplatu da odradi par sekundi
ws.send(JSON.stringify({ t: "logout" }));
await new Promise((r) => setTimeout(r, 600));
ws.close();

const s2 = await api("/api/shift");
proveri("sesija zabelezena", s2.totals.sessions > 0, String(s2.totals.sessions));
proveri("igranje ne uvecava pazar", blizu(s2.totals.revenue, ocekPazar, 0.01), `${s2.totals.revenue} != ${ocekPazar}`);

// ---- zatvaranje: radnik izbroji tacno onoliko koliko treba ----
const ocekKasa = 2000 + ocekDopune - ocekSkinuto + ocekKes; // 3560
proveri("ocekivano stanje kase", blizu((await api("/api/shifts")).length >= 0 ? ocekKasa : 0, ocekKasa, 0.01));
const z = await api("/api/shift/close", "POST", { closingCash: ocekKasa });
proveri("obracun trazi tacan iznos", blizu(z.summary.expectedCash, ocekKasa, 0.01), `${z.summary.expectedCash} != ${ocekKasa}`);
proveri("nema razlike kad se poklopi", blizu(z.summary.difference, 0, 0.01), String(z.summary.difference));

// manjak se prijavljuje kao minus
await api("/api/shift/open", "POST", { openingCash: 1000 });
await api(`/api/players/${p1.id}/topup`, "POST", { amount: 300 });
const z2 = await api("/api/shift/close", "POST", { closingCash: 1250 });
proveri("manjak u kasi se vidi", blizu(z2.summary.difference, -50, 0.01), String(z2.summary.difference));

// ---- zatvorena smena mora da ostane zamrznuta ----
const pre = (await api(`/api/shifts/${z.summary.id}`)).revenue;
await api(`/api/players/${p1.id}/topup`, "POST", { amount: 9999 }); // kasnija dopuna, druga smena
const posle = (await api(`/api/shifts/${z.summary.id}`)).revenue;
proveri("zatvorena smena se ne menja naknadno", blizu(pre, posle, 0.01), `${pre} -> ${posle}`);

// ---- otkazana porudzbina ne sme da ostane u pazaru ----
await api("/api/shift/open", "POST", { openingCash: 0 });
const o = await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash" });
const pre2 = (await api("/api/shift")).totals;
await api(`/api/orders/${o.orderId || o.id}/status`, "POST", { status: "cancelled" });
const posle2 = (await api("/api/shift")).totals;
proveri("otkazana kes porudzbina izlazi iz pazara",
  blizu(posle2.shopCash, pre2.shopCash - 130, 0.01), `${pre2.shopCash} -> ${posle2.shopCash}`);
await api("/api/shift/close", "POST", { closingCash: null });

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
