import { radniFolder, podigniServer, ucitajWebSocket } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Server ne veruje klijentu: sve sto stigne kroz WebSocket prolazi proveru.
//
// Zaliha se proverava po artiklu, ne po stavci: isti artikal u pet redova po 20
// komada mora da se sabere i uporedi sa zalihom.
const BASE = "http://127.0.0.1:8131", WSB = "ws://127.0.0.1:8131";
const DATA = radniFolder("zloupotreba-data");
await podigniServer(DATA, 8131);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/computers/bulk", "POST", { count: 1, prefix: "PC-" });
const pc = (await api("/api/computers"))[0];
await api("/api/shop", "POST", { name: "Proba Kola", category: "Test", price: 100, stock: 10 });
const artikal = (await api("/api/shop")).find((i) => i.name === "Proba Kola");
// Skriven artikal - igrac ga ne sme kupiti kroz launcher.
await api("/api/shop", "POST", { name: "Proba Skriveno", category: "Test", price: 50, stock: 10 });
const skriveni = (await api("/api/shop")).find((i) => i.name === "Proba Skriveno");
await api(`/api/shop/${skriveni.id}`, "PUT", { name: skriveni.name, category: skriveni.category, price: skriveni.price, available: 0, stock: 10 });

await api("/api/players", "POST", { username: "pera", password: "pera1234", displayName: "Pera" });
const pera = (await api("/api/players")).find((p) => p.username === "pera");
await api(`/api/players/${pera.id}/topup`, "POST", { amount: 100000, note: "test" });

// Launcher se javlja isto kao pravi.
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=proba`);
const poruke = [];
ws.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
await new Promise((r) => ws.on("open", r));
await cekaj(300);
ws.send(JSON.stringify({ t: "login", username: "pera", password: "pera1234" }));
await cekaj(600);
proveri("igrac je prijavljen", poruke.some((m) => m.t === "login_ok"), JSON.stringify(poruke.map((m) => m.t + (m.message ? ":" + m.message : ""))));

const zaliha = async () => (await api("/api/shop")).find((i) => i.id === artikal.id).stock;
const poslednja = (t) => [...poruke].reverse().find((m) => m.t === t);
const posalji = async (poruka) => { poruke.length = 0; ws.send(JSON.stringify(poruka)); await cekaj(700); };

// ---- 1) ocigledan slucaj: jedan red vec premasuje zalihu ----
proveri("pocetna zaliha je 10", (await zaliha()) === 10);
await posalji({ t: "order", payment: "credit", items: Array.from({ length: 5 }, () => ({ id: artikal.id, qty: 20 })) });
proveri("jedan red preko zalihe je odbijen", !!poslednja("order_err"), JSON.stringify(poslednja("order_ok") || poslednja("order_err")));
proveri("zaliha se nije pomerila", (await zaliha()) === 10, `zaliha ${await zaliha()}`);

// ---- 1b) PRAVI slucaj: svaki red je ISPOD zalihe, ali zbir je preko ----
// Ovo je ono sto je stara provera propustala. Zaliha 10, pet redova po 3 - svaki
// red prolazi (10 >= 3), a trazi se ukupno 15 komada. Bez spajanja bi se
// porudzbina primila, zaliha bi pala na nulu, a radnik bi kod frizidera video
// da pica nema za pet naruсenih.
await posalji({ t: "order", payment: "credit", items: Array.from({ length: 5 }, () => ({ id: artikal.id, qty: 3 })) });
proveri("zbir redova preko zalihe je odbijen", !!poslednja("order_err"),
  JSON.stringify(poslednja("order_ok") || poslednja("order_err")));
proveri("zaliha ni tada nije dirana", (await zaliha()) === 10, `zaliha ${await zaliha()}`);

// ---- 2) uredna porudzbina i dalje prolazi ----
await posalji({ t: "order", payment: "credit", items: [{ id: artikal.id, qty: 3 }] });
proveri("uredna porudzbina prolazi", !!poslednja("order_ok"));
proveri("zaliha je skinuta tacno 3", (await zaliha()) === 7, `zaliha ${await zaliha()}`);

// ---- 3) isti artikal u dva reda se SABIRA, ne racuna dvaput ----
await posalji({ t: "order", payment: "credit", items: [{ id: artikal.id, qty: 2 }, { id: artikal.id, qty: 2 }] });
const ok3 = poslednja("order_ok");
proveri("dva reda istog artikla su spojena u jedan", !!ok3 && ok3.total === 400, JSON.stringify(ok3 && ok3.total));
proveri("zaliha je skinuta tacno 4", (await zaliha()) === 3, `zaliha ${await zaliha()}`);

// ---- 4) kolicina se ne moze naduvati ----
await posalji({ t: "order", payment: "credit", items: [{ id: artikal.id, qty: 999999 }] });
proveri("ogromna kolicina ne prolazi kroz zalihu", !!poslednja("order_err"));
await posalji({ t: "order", payment: "credit", items: [{ id: artikal.id, qty: -5 }] });
const ok4 = poslednja("order_ok");
proveri("minus kolicina se svede na jedan komad", !!ok4 && ok4.total === 100, JSON.stringify(ok4 && ok4.total));

// ---- 5) skriven artikal se ne moze kupiti kroz launcher ----
await posalji({ t: "order", payment: "credit", items: [{ id: skriveni.id, qty: 1 }] });
proveri("skriven artikal se ne moze poruciti", !poslednja("order_ok"), JSON.stringify(poslednja("order_ok")));

// ---- 6) cena UVEK dolazi iz baze ----
await posalji({ t: "order", payment: "credit", items: [{ id: artikal.id, qty: 1, price: 1, total: 1 }] });
const ok6 = poslednja("order_ok");
proveri("cena iz poruke se ne uzima u obzir", !!ok6 && ok6.total === 100, JSON.stringify(ok6 && ok6.total));

// ---- 7) besmislice ne rusi server ----
for (const smece of [
  { t: "order", payment: "credit", items: "nije niz" },
  { t: "order", payment: "credit", items: [{ id: "abc", qty: 1 }] },
  { t: "order", payment: "credit", items: [{ id: 999999, qty: 1 }] },
  { t: "order", payment: "credit", items: [null, undefined, 5] },
  { t: "order", payment: "credit", items: Array.from({ length: 500 }, (_, i) => ({ id: i + 1, qty: 20 })) },
]) await posalji(smece);
proveri("server je i dalje ziv posle besmislica", (await api("/api/shop")).length > 0);
proveri("nista od toga nije prosло kao porudzbina", (await api("/api/orders")).filter((o) => o.total > 10000).length === 0);

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
