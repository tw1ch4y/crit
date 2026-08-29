import { radniFolder, podigniServer, ucitajWebSocket } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// PODELA SHOPA U OBRAČUNU SMENE: keš, sa naloga, ukupno.
//
// Piće se prodaje na četiri načina - igrač poruči iz launchera kešom ili sa
// naloga, radnik ukuca na kasi kešom ili sa naloga - a obračun smene ih vodi
// kroz DVA razna izvora: "ukupno" se sabira iz logova, "keš" iz tabele
// porudžbina, a "sa naloga" je razlika ta dva. Dok se ti izvori ne slažu,
// razlika ispada besmislena.
//
// Tako je i bilo: keš porudžbina IZ LAUNCHERA jedina nije upisivala iznos u
// log, pa je gost koji kolu od 130 plati kešom radniku u obračun upisivao
// "Shop ukupno 0, sa naloga −130". Posle otkazivanja je i ukupno postajalo −130,
// jer je poništenje iznos imalo a original nije.
//
// Pazar je pri tom bio tačan (on keš čita iz porudžbina), pa se greška videla
// samo u podeli - tamo gde radnik proverava sebe pred prebrojavanje kase.
//
// Zato se ovde prolazi CELA matrica i posle svakog koraka traži isto: ukupno =
// keš + sa naloga, i nijedan od tri broja nije negativan.
const BASE = "http://127.0.0.1:8172", WSB = "ws://127.0.0.1:8172";
const DATA = radniFolder("obracun-shopa-data");
await podigniServer(DATA, 8172);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const blizu = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.01;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const artikli = await api("/api/shop");
const kola = artikli.find((i) => i.name.startsWith("Coca-Cola")); // 130
const voda = artikli.find((i) => i.name.startsWith("Voda"));      // 80

await api("/api/shift/open", "POST", { openingCash: 0 });
const igrac = await api("/api/players", "POST", { username: "pera", password: "pera1234", balance: 5000 });

// launcher jednog racunara
const comps = await api("/api/computers");
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
ws.send(JSON.stringify({ t: "login", username: "pera", password: "pera1234" }));
await new Promise((r) => setTimeout(r, 700));

const poruciIzLaunchera = async (artikal, qty, payment) => {
  ws.send(JSON.stringify({ t: "order", items: [{ id: artikal.id, qty }], payment }));
  await new Promise((r) => setTimeout(r, 500));
};
const totals = async () => (await api("/api/shift")).totals;

// Posle SVAKOG koraka mora da vazi isto - zato jedna funkcija, ne prepisivanje.
const slaze = async (gde, ocekUkupno, ocekKes) => {
  const t = await totals();
  proveri(`${gde}: ukupan shop`, blizu(t.shop, ocekUkupno), `${t.shop} != ${ocekUkupno}`);
  proveri(`${gde}: keš deo`, blizu(t.shopCash, ocekKes), `${t.shopCash} != ${ocekKes}`);
  proveri(`${gde}: sa naloga = ukupno − keš`, blizu(t.shopCredit, ocekUkupno - ocekKes), `${t.shopCredit} != ${ocekUkupno - ocekKes}`);
  proveri(`${gde}: nijedan deo nije negativan`, t.shop >= 0 && t.shopCash >= 0 && t.shopCredit >= 0,
    `ukupno ${t.shop}, keš ${t.shopCash}, nalog ${t.shopCredit}`);
  return t;
};

// ---- 1) igrac poruci KESOM iz launchera (ovde je greska i bila) ----
await poruciIzLaunchera(kola, 1, "cash"); // 130 kes
await slaze("keš iz launchera", 130, 130);

// ---- 2) igrac poruci SA NALOGA iz launchera ----
await poruciIzLaunchera(voda, 1, "credit"); // 80 sa naloga
await slaze("+ kredit iz launchera", 210, 130);

// ---- 3) radnik ukuca KESOM na kasi ----
await api("/api/pos", "POST", { items: [{ id: voda.id, qty: 2 }], payment: "cash" }); // 160 kes
await slaze("+ keš sa kase", 370, 290);

// ---- 4) radnik ukuca SA NALOGA na kasi ----
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "credit", playerId: igrac.id }); // 130 nalog
const t4 = await slaze("+ kredit sa kase", 500, 290);

// PAZAR: samo kes iz shopa je nov novac. Kupovina sa naloga je placena ranije.
proveri("pazar broji samo keš iz shopa", blizu(t4.revenue, 290), `${t4.revenue} != 290`);

// ---- 5) otkazivanje mora da izadje iz OBA broja ----
const sve = await api("/api/orders?all=1");
const kesIzLaunchera = sve.find((o) => o.source === "client" && o.payment === "cash");
await api(`/api/orders/${kesIzLaunchera.id}/status`, "POST", { status: "cancelled" });
await new Promise((r) => setTimeout(r, 300));
await slaze("otkazana keš porudžbina iz launchera", 370, 160);

const kreditIzLaunchera = sve.find((o) => o.source === "client" && o.payment === "credit");
await api(`/api/orders/${kreditIzLaunchera.id}/status`, "POST", { status: "cancelled" });
await new Promise((r) => setTimeout(r, 300));
const t5 = await slaze("otkazana kredit porudžbina iz launchera", 290, 160);
proveri("pazar prati otkazivanje", blizu(t5.revenue, 160), `${t5.revenue} != 160`);

// ---- 6) zamrznuta smena nosi iste brojke ----
const z = await api("/api/shift/close", "POST", { closingCash: 160 });
proveri("zatvorena smena: ukupan shop", blizu(z.summary.shop, 290), String(z.summary.shop));
proveri("zatvorena smena: keš deo", blizu(z.summary.shopCash, 160), String(z.summary.shopCash));
proveri("zatvorena smena: sa naloga nije negativan", z.summary.shopCredit >= 0, String(z.summary.shopCredit));
proveri("zatvorena smena: kasa se poklapa", blizu(z.summary.difference, 0), String(z.summary.difference));

const detalj = await api(`/api/shifts/${z.summary.id}`);
proveri("detalj zamrznute smene daje iste brojke",
  blizu(detalj.shop, 290) && blizu(detalj.shopCash, 160) && blizu(detalj.shopCredit, 130),
  `${detalj.shop} / ${detalj.shopCash} / ${detalj.shopCredit}`);

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
await new Promise((r) => setTimeout(r, 300));
process.exit(pao ? 1 : 0);
