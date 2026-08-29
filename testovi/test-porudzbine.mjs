// Porudzbina sa klijenta: igrac bira kredit ili kes.
// Kes ne sme da dira kredit, ali mora da udje u pazar smene.
import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, brojac, panelKlijent } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();

const BASE = "http://127.0.0.1:8103", WSB = "ws://127.0.0.1:8103";
const DATA = radniFolder("porudzbine-data");
await podigniServer(DATA, 8103);

const { proveri, kraj } = brojac();
const api = await panelKlijent(BASE);
const blizu = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

await api("/api/computers/bulk", "POST", { count: 2, prefix: "PC-" });
const artikli = (await api("/api/shop")).body;
const kola = artikli.find((i) => i.name.startsWith("Coca-Cola"));
const kafa = artikli.find((i) => i.name === "Kafa");

await api("/api/shift/open", "POST", { openingCash: 0 });
const p = (await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 1000 })).body;
const comps = (await api("/api/computers")).body;

const poruke = [];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
ws.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await new Promise((r) => setTimeout(r, 700));
proveri("igrac prijavljen", poruke.some((m) => m.t === "login_ok"));

const stanje = async () => (await api(`/api/players?page=1&per=5&search=marko`)).body.items[0].balance;
const zadnja = (t) => [...poruke].reverse().find((m) => m.t === t);
const naruci = async (items, payment) => {
  poruke.length = 0;
  ws.send(JSON.stringify({ t: "order", items, payment }));
  await new Promise((r) => setTimeout(r, 700));
};

// ---- kredit: skida se sa naloga ----
const preKredit = await stanje();
await naruci([{ id: kola.id, qty: 2 }], "credit");
const ok1 = zadnja("order_ok");
proveri("kredit porudzbina primljena", !!ok1, JSON.stringify(poruke.map((m) => m.t)));
proveri("kredit oznacen kao kredit", ok1?.payment === "credit", ok1?.payment);
proveri("kredit skinut sa naloga", blizu(await stanje(), preKredit - 2 * kola.price), `${preKredit} -> ${await stanje()}`);

// ---- kes: kredit ostaje netaknut ----
const preKes = await stanje();
await naruci([{ id: kafa.id, qty: 1 }], "cash");
const ok2 = zadnja("order_ok");
proveri("kes porudzbina primljena", !!ok2, JSON.stringify(poruke.map((m) => m.t)));
proveri("kes oznacen kao kes", ok2?.payment === "cash", ok2?.payment);
proveri("kes NE dira kredit", blizu(await stanje(), preKes), `${preKes} -> ${await stanje()}`);
proveri("klijent dobio iznos za naplatu", blizu(ok2?.total, kafa.price), String(ok2?.total));

// ---- kes prolazi i kad igrac nema ni dinara ----
await api(`/api/players/${p.id}/topup`, "POST", { amount: -(await stanje()) });
proveri("nalog je na nuli", blizu(await stanje(), 0), String(await stanje()));
await naruci([{ id: kola.id, qty: 1 }], "credit");
proveri("bez kredita se kredit porudzbina odbija", !!zadnja("order_err"), JSON.stringify(poruke.map((m) => m.t)));
await naruci([{ id: kola.id, qty: 1 }], "cash");
proveri("bez kredita kes porudzbina prolazi", !!zadnja("order_ok"), JSON.stringify(poruke.map((m) => m.t)));

// ---- panel vidi nacin placanja ----
const aktivne = (await api("/api/orders")).body;
const kesPorudzbine = aktivne.filter((o) => o.payment === "cash");
proveri("panel vidi kes porudzbine", kesPorudzbine.length === 2, String(kesPorudzbine.length));
proveri("kes porudzbina ima igraca i racunar", !!kesPorudzbine[0].player && !!kesPorudzbine[0].computer, JSON.stringify(kesPorudzbine[0]));

// ---- obracun smene ----
const t = (await api("/api/shift")).body.totals;
const ocekKes = kafa.price + kola.price;
proveri("kes iz klijenta ulazi u pazar", blizu(t.shopCash, ocekKes), `${t.shopCash} != ${ocekKes}`);
proveri("kredit porudzbina nije u kesu", blizu(t.shopCash, ocekKes), String(t.shopCash));

// ---- otkazivanje: kredit se vraca, kes nema sta da vrati ----
const kesId = kesPorudzbine[0].id;
const preOtkaz = await stanje();
await api(`/api/orders/${kesId}/status`, "POST", { status: "cancelled" });
proveri("otkazan kes ne dodaje kredit", blizu(await stanje(), preOtkaz), `${preOtkaz} -> ${await stanje()}`);
const t2 = (await api("/api/shift")).body.totals;
proveri("otkazan kes izlazi iz pazara", blizu(t2.shopCash, ocekKes - kesPorudzbine[0].total), `${t2.shopCash}`);

const kreditPorudzbina = aktivne.find((o) => o.payment === "credit");
await api(`/api/players/${p.id}/topup`, "POST", { amount: 500 });
const pre2 = await stanje();
await api(`/api/orders/${kreditPorudzbina.id}/status`, "POST", { status: "cancelled" });
proveri("otkazan kredit vraca novac na nalog", blizu(await stanje(), pre2 + kreditPorudzbina.total), `${pre2} -> ${await stanje()}`);

// ---- logovi razlikuju nacin ----
const log = (await api("/api/logs?page=1&per=30&category=shop")).body.items || [];
proveri("log belezi kes", log.some((l) => /\(keš\)/.test(l.detail || "")), JSON.stringify(log.slice(0, 2).map((l) => l.detail)));
proveri("log belezi kredit", log.some((l) => /\(kredit\)/.test(l.detail || "")), JSON.stringify(log.slice(0, 3).map((l) => l.detail)));

ws.close();
kraj();
