import { radniFolder, podigniServer, ucitajWebSocket } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// "PROMET DANAS" NA KONTROLNOJ TABLI
//
// To je jedina brojka koju vlasnik pogleda u prolazu, sa telefona, i po njoj
// zakljuci kako ide vece. Zato mora da znaci tacno ono sto pise, i mora da se
// poklapa sa Izvestajima - kad se dva broja na dve strane ne slazu, prestaje da
// se veruje obojici.
//
// Dve stvari su je kvarile, svaka na svoju stranu:
//
//  1. NIJE VIDELA NIKOGA KO TRENUTNO IGRA. Trosak sesije se u `transactions`
//     upisuje tek kad se sesija ZAVRSI. U osam uvece, sa deset zauzetih masina
//     po dva sata, to je oko 2400 dinara koje vlasnik ne vidi - pa mu puno vece
//     izgleda slabo. Zarada po racunaru u Izvestajima ih je pri tom videla, jer
//     cita `sessions.cost`, pa su se dva broja na istoj strani razilazila.
//
//  2. BROJALA JE OTKAZANE PORUDZBINE. Kes zato sto se filter po statusu nije ni
//     pisao, a kupovina sa naloga zato sto se citala iz `transactions`, gde
//     povracaj ulazi kao zaseban red i original ne ponistava. Obracun smene i
//     Izvestaji su otkazano oduvek izbacivali - tabla je jedina pokazivala vise.
const BASE = "http://127.0.0.1:8175", WSB = "ws://127.0.0.1:8175";
await podigniServer(radniFolder("promet-danas-data"), 8175);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const blizu = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());

const artikli = await api("/api/shop");
const kola = artikli.find((i) => i.name.startsWith("Coca-Cola")); // 130
const tabla = async () => {
  const r = await api("/api/report");
  return { ...r, ukupno: r.sessionRevenue + r.shopRevenue + r.cashRevenue };
};

const igrac = await api("/api/players", "POST", { username: "zika", password: "zika1234", balance: 3000 });

// ---- 1) otkazana porudzbina izlazi iz prometa ----
const pre = await tabla();
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash" });
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "credit", playerId: igrac.id });
const sa = await tabla();
proveri("dve porudzbine ulaze u promet", blizu(sa.ukupno - pre.ukupno, 260), `${pre.ukupno} -> ${sa.ukupno}`);
proveri("kes deo je tacan", blizu(sa.cashRevenue, 130), String(sa.cashRevenue));
proveri("deo sa naloga je tacan", blizu(sa.shopRevenue, 130), String(sa.shopRevenue));

for (const o of await api("/api/orders?all=1")) await api(`/api/orders/${o.id}/status`, "POST", { status: "cancelled" });
await new Promise((r) => setTimeout(r, 300));
const posle = await tabla();
proveri("OTKAZAN KES izlazi iz prometa", blizu(posle.cashRevenue, 0), String(posle.cashRevenue));
proveri("OTKAZANA kupovina sa naloga izlazi iz prometa", blizu(posle.shopRevenue, 0), String(posle.shopRevenue));
proveri("promet se vraca na pocetno", blizu(posle.ukupno, pre.ukupno), `${posle.ukupno} != ${pre.ukupno}`);

// ---- 2) igrac koji TRENUTNO igra se broji ----
const comps = await api("/api/computers");
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
ws.send(JSON.stringify({ t: "login", username: "zika", password: "zika1234" }));
await new Promise((r) => setTimeout(r, 9000)); // pusti naplatu da odradi nekoliko prolaza

const uToku = await tabla();
proveri("tabla vidi sesiju koja jos traje", uToku.sessionRevenue > 0,
  "bez ovoga u osam uvece nedostaje promet svih zauzetih masina");

// KLJUCNO: ista brojka na dve strane mora da bude ISTA.
const izv = await api("/api/stats?period=today");
const poRacunarima = (izv.byComputer || []).reduce((s, x) => s + x.revenue, 0);
proveri("tabla i Izvestaji se poklapaju", blizu(uToku.sessionRevenue, poRacunarima, 0.5),
  `tabla ${uToku.sessionRevenue}, po racunarima ${poRacunarima}`);
proveri("ukupan promet u Izvestajima takodje vidi sesiju u toku", izv.revenue.session > 0,
  String(izv.revenue.session));

// ---- 3) kad se sesija zavrsi, brojka NE poskoci ----
// Zapis stize sa punim iznosom i istim datumom; ovo je isto ono sto bi ionako
// uslo, samo ranije. Da nije tako, vlasnik bi video skok bez razloga.
const preOdjave = (await tabla()).sessionRevenue;
ws.send(JSON.stringify({ t: "logout" }));
await new Promise((r) => setTimeout(r, 1200));
const posleOdjave = (await tabla()).sessionRevenue;
proveri("odjava ne pravi skok u prometu", blizu(posleOdjave, preOdjave, 0.5),
  `${preOdjave} -> ${posleOdjave}`);
proveri("zavrsena sesija ostaje u prometu", posleOdjave > 0, String(posleOdjave));

// ---- 4) zatvoren period u proslosti ne dobija sesije u toku ----
const juce = await api(`/api/stats?from=${Date.now() - 3 * 86400000}&to=${Date.now() - 2 * 86400000}`);
proveri("period u proslosti ne broji sesije koje sad traju", blizu(juce.revenue.session, 0),
  String(juce.revenue.session));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
await new Promise((r) => setTimeout(r, 300));
process.exit(pao ? 1 : 0);
