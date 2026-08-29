import { radniFolder, podigniServer } from "./_okruzenje.mjs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
// Izveštaji su vlasnikov uvid u pazar - ako se brojke ne slažu, gubi poverenje u
// ceo sistem. Ovde se pravi poznat dan (keš i kredit porudžbine, jedna otkazana,
// nešto session prometa) pa se proverava da se sve sabira kako treba.
const BASE = "http://127.0.0.1:8133";
const DATA = radniFolder("izvestaj-data");
await podigniServer(DATA, 8133);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const blizu = (a, b) => Math.abs(a - b) < 0.5;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

// ---- postavka ----
const marko = await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 5000 });
const jle = await api("/api/players", "POST", { username: "jelena", password: "test1234", balance: 5000 });
const shop = await api("/api/shop");
const cena = (i) => shop[i].price;

// KREDIT porudžbine (skidaju se sa naloga, prave shop transakciju)
const k1 = await api("/api/pos", "POST", { items: [{ id: shop[0].id, qty: 2 }], playerId: marko.id, payment: "credit" });
const k2 = await api("/api/pos", "POST", { items: [{ id: shop[1].id, qty: 1 }], playerId: jle.id, payment: "credit" });
// KEŠ porudžbine (walk-in, bez naloga)
const g1 = await api("/api/pos", "POST", { items: [{ id: shop[0].id, qty: 3 }], payment: "cash" });
const g2 = await api("/api/pos", "POST", { items: [{ id: shop[2].id, qty: 1 }], payment: "cash" });
// KREDIT pa OTKAZANA (mora da izađe iz pazara i da se kredit vrati)
const otk = await api("/api/pos", "POST", { items: [{ id: shop[1].id, qty: 2 }], playerId: marko.id, payment: "credit" });

const kreditNecancel = k1.total + k2.total;
const kes = g1.total + g2.total;
const shopUkupno = kreditNecancel + kes; // otkazana se NE računa

// marku je skinut i k1 i otk; posle otkazivanja mora da mu se vrati otk.total
const markoPreOtkaz = (await api(`/api/players?page=1&per=5&search=marko`)).items[0].balance;
await api(`/api/orders/${otk.orderId}/status`, "POST", { status: "cancelled" });
const markoPosle = (await api(`/api/players?page=1&per=5&search=marko`)).items[0].balance;
proveri("otkazivanje kreditne porudžbine vraća tačan iznos", blizu(markoPosle - markoPreOtkaz, otk.total),
  `vraćeno ${markoPosle - markoPreOtkaz}, očekivano ${otk.total}`);

// ---- session promet (ubacen direktno, kao da je naplata tekla) ----
// Sesije i njihove transakcije pravi naplata kroz vreme; ovde se ubacuju gotove,
// sa poznatim iznosom, da se proveri da izveštaj sabira i njih.
const db = new DatabaseSync(path.join(DATA, "crit.db"));
const sada = Date.now();
const compId = (await api("/api/computers"))[0].id;
let sesUkupno = 0;
// Sesija mora i da POCNE i da se ZAVRSI danas, inace je izvestaj za "danas" ne
// broji. Bez ovog ogranicenja test je padao svaki put kad se pokrene u prvom
// satu posle ponoci: "pre 60 minuta" je tada juce.
const ponoc = new Date(sada); ponoc.setHours(0, 0, 0, 0);
for (const [pid, iznos, min] of [[marko.id, 120, 60], [jle.id, 80, 40], [marko.id, 60, 30]]) {
  // Kraj je uvek maločas (sigurno danas i sigurno nije u budućnosti), a
  // početak se po potrebi skrati do ponoći - u prvom satu posle ponoći ceo
  // sat igre prosto ne staje u "danas".
  const zavrseno = sada - 1000;
  const poceto = Math.max(ponoc.getTime() + 1000, zavrseno - min * 60000);
  db.prepare("INSERT INTO sessions (player_id, computer_id, started_at, ended_at, cost, status) VALUES (?,?,?,?,?, 'ended')")
    .run(pid, compId, poceto, zavrseno, iznos);
  db.prepare("INSERT INTO transactions (player_id, type, amount, balance_after, created_at) VALUES (?, 'session', ?, 0, ?)")
    .run(pid, -iznos, zavrseno);
  sesUkupno += iznos;
}
db.close();

// ---- provera izveštaja ----
const s = await api("/api/stats?period=today");
proveri("shop promet = zbir nepokazanih porudžbina", blizu(s.revenue.shop, shopUkupno), `${s.revenue.shop} vs ${shopUkupno}`);
proveri("otkazana porudžbina nije u shop prometu", blizu(s.revenue.shop, shopUkupno) && !blizu(s.revenue.shop, shopUkupno + otk.total));
proveri("keš deo je tačan", blizu(s.revenue.shopCash, kes), `${s.revenue.shopCash} vs ${kes}`);
proveri("kredit deo je tačan", blizu(s.revenue.shopCredit, kreditNecancel), `${s.revenue.shopCredit} vs ${kreditNecancel}`);
proveri("keš + kredit = ukupan shop", blizu(s.revenue.shopCash + s.revenue.shopCredit, s.revenue.shop));
proveri("session promet je tačan", blizu(s.revenue.session, sesUkupno), `${s.revenue.session} vs ${sesUkupno}`);
proveri("ukupan promet = session + shop", blizu(s.revenue.total, s.revenue.session + s.revenue.shop),
  `${s.revenue.total} vs ${s.revenue.session}+${s.revenue.shop}`);

// zbir po satima mora da da isti ukupan promet (session + shop)
const poSatima = s.byHour.reduce((a, h) => a + h.revenue, 0);
proveri("zbir po satima = ukupan promet", blizu(poSatima, s.revenue.total), `${poSatima} vs ${s.revenue.total}`);
const poDanima = s.byDay.reduce((a, d) => a + d.revenue, 0);
proveri("zbir po danima = ukupan promet", blizu(poDanima, s.revenue.total), `${poDanima} vs ${s.revenue.total}`);

// broj sesija i minuti
proveri("broj sesija je tačan", s.sessions.count === 3, String(s.sessions.count));
proveri("odigrani minuti su pozitivni", s.sessions.minutes > 0, String(s.sessions.minutes));

// ---- dublji izveštaji: prosek, vrh, novi igrači ----
proveri("prosek po sesiji = session promet / broj sesija", blizu(s.sessions.avg, sesUkupno / 3), `${s.sessions.avg} vs ${sesUkupno / 3}`);
proveri("prosečni minuti po sesiji su pozitivni", s.sessions.avgMin > 0, String(s.sessions.avgMin));
proveri("novi igrači u periodu su izbrojani", s.newPlayers === 2, `${s.newPlayers} (napravili smo marka i jelenu)`);
proveri("vrh sata je najveći sat", s.peak && s.peak.hour && s.peak.hour.revenue > 0,
  JSON.stringify(s.peak?.hour));
proveri("vrh sata ne premašuje ukupan promet", s.peak.hour.revenue <= s.revenue.total + 0.5);

// top igrači: sortirani po potrošnji, bez negativnih
const top = s.topPlayers;
proveri("top igrači su sortirani po potrošnji", top.every((p, i) => i === 0 || top[i - 1].spent >= p.spent), JSON.stringify(top));
proveri("nijedan potrošeni iznos nije negativan", top.every((p) => p.spent >= 0), JSON.stringify(top));

// dnevni izveštaj (danas) - session i shop odvojeno
const rep = await api("/api/report");
proveri("dnevni izveštaj vraća session promet", blizu(rep.sessionRevenue, sesUkupno), `${rep.sessionRevenue} vs ${sesUkupno}`);
proveri("dnevni izveštaj: keš promet tačan", blizu(rep.cashRevenue, kes), `${rep.cashRevenue} vs ${kes}`);

// prazan period ne sme da pukne ni da izmisli promet
const prazno = await api("/api/stats?from=1&to=2");
proveri("prazan period daje nulu, ne grešku", prazno.revenue && prazno.revenue.total === 0, JSON.stringify(prazno.revenue));

// ---- panel: dublji izveštaji su prikazani, izvoz postoji ----
const { citajIzvor } = await import("./_okruzenje.mjs");
const app = citajIzvor("server/public/js/app.js");
proveri("panel prikazuje keš/kredit podelu", app.includes("stat-split") && app.includes("r.shopCash"));
proveri("panel prikazuje nove igrače", app.includes("Novi igrači"));
proveri("panel prikazuje vrh i prosek", app.includes("Najprometniji") && app.includes("Prosečno po sesiji"));
proveri("panel ima izvoz u CSV", app.includes("function izveziIzvestaj") && app.includes('id="repExport"'));
proveri("CSV ima BOM da Excel čita ćirilicu", app.includes('"﻿" + linije.join'));

proveri("server živ posle izveštaja", Array.isArray(await api("/api/computers")));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
