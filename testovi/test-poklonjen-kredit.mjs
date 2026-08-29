import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// POKLONJEN KREDIT (nagradni tocak, popust na vremenski paket)
//
// Ovo je najlakse pogresiti u celom obracunu: kredit sa tocka JESTE novac za
// igraca, ali NIJE novac u kasi. Ako udje u pazar, radnik na kraju smene ima
// manjak koji ne moze da objasni. Ako se nigde ne prikazuje, vlasnik ne zna
// koliko ga je tocak kostao i tocak izgleda kao da je besplatan.
const BASE = "http://127.0.0.1:8159", WSB = "ws://127.0.0.1:8159";
const DATA = radniFolder("poklon-data");
await podigniServer(DATA, 8159);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (a, b) => Math.abs(a - b) < 0.5;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

// smena mora da bude otvorena da bi pazar imao gde da se racuna
await api("/api/shift/open", "POST", { openingCash: 0 }).catch(() => {});
await api("/api/computers/bulk", "POST", { count: 1, prefix: "PC-" });
const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");

// Dopuna: PRAVI novac koji ulazi u kasu.
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 2000, note: "kes" });

const smena = async () => (await api("/api/shift"))?.totals || {};
const izvestaj = async () => (await api("/api/stats?period=today"))?.revenue || {};

const s1 = await smena();
proveri("dopuna ulazi u pazar", blizu(s1.revenue, 2000), `pazar ${s1.revenue}`);
const i1 = await izvestaj();
proveri("pre tocka nema poklonjenog", blizu(i1.poklonjeno || 0, 0), String(i1.poklonjeno));

// ---- tocak: poklon od 250 ----
await api("/api/tocak", "POST", { ukljucen: true, prag: 0 });
const cfg = await api("/api/tocak");
for (const n of cfg.nagrade || []) await api(`/api/tocak/nagrade/${n.id}`, "DELETE");
await api("/api/tocak/nagrade", "POST", { naziv: "250 din", kredit: 250, tezina: 1 });

const ws = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=proba`);
await new Promise((r) => ws.on("open", r));
await cekaj(300);
ws.send(JSON.stringify({ t: "login", username: "mile", password: "mile1234" }));
await cekaj(700);
ws.send(JSON.stringify({ t: "tocak_spin" }));
await cekaj(900);

const stanje = (await api("/api/players")).find((p) => p.id === mile.id).balance;
proveri("igrac je dobio poklon na stanje", stanje >= 2250, `stanje ${stanje}`);

// ---- ovo je sustina ----
const s2 = await smena();
proveri("poklon NE ulazi u pazar smene", blizu(s2.revenue, 2000), `pazar ${s2.revenue} (bio bi 2250 da poklon ulazi)`);
proveri("poklon NE ulazi u dopune", blizu(s2.topups, 2000), `dopune ${s2.topups}`);

const i2 = await izvestaj();
proveri("poklon se VIDI u izvestaju", blizu(i2.poklonjeno, 250), `poklonjeno ${i2.poklonjeno}`);
proveri("dopune u izvestaju ostaju cist novac", blizu(i2.topups, 2000), `dopune ${i2.topups}`);

// ---- panel to i prikazuje ----
const panel = citajIzvor("server/public/js/app.js");
proveri("izvestaj prikazuje poklonjeno", /poklonjeno \$\{money\(r\.poklonjeno\)\}/.test(panel),
  "bez toga trosak nigde ne postoji i tocak izgleda besplatan");
proveri("prikazuje se samo kad ima sta", /r\.poklonjeno \?/.test(panel));

// ---- popust na vremenski paket se vodi isto ----
const src = citajIzvor("server/src/service.js");
proveri("popust na paket je takodje poklon, ne dopuna", /popust i vodi se kao 'bonus'/.test(src));
proveri("poklon se sabira zasebnim upitom", /type='bonus'/.test(src));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(400);
process.exit(pao ? 1 : 0);
