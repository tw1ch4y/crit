import path from "node:path";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ucitajWebSocket } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Nestanak struje je najizvesniji dogadjaj u igraonici. Ovaj test stvarno ugasi
// server i podigne ga ponovo nad istom bazom, pa proverava sta je prezivelo:
// otvorena smena i njen obracun, aktivne sesije, tokeni prijave, katalog.
const BASE = "http://127.0.0.1:8106", WSB = "ws://127.0.0.1:8106";
const DATA = radniFolder("restart-data");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

let proces = null;
function pokreni() {
  proces = spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
    env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: "8106" },
    stdio: "ignore",
  });
}
async function cekajServer(sekundi = 15) {
  for (let i = 0; i < sekundi * 5; i++) {
    try { const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status) return true; } catch {}
    await cekaj(200);
  }
  return false;
}
async function ugasi() {
  if (!proces) return;
  const p = proces; proces = null;
  await new Promise((res) => { p.once("exit", res); p.kill(); setTimeout(res, 3000); });
  await cekaj(400);
}

pokreni();
proveri("server se podigao", await cekajServer());

const prijava = async () => (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
let token = await prijava();
const zovi = (t) => async (p, m = "GET", b) => {
  const r = await fetch(BASE + p, { method: m,
    headers: { "content-type": "application/json", authorization: "Bearer " + t },
    body: b ? JSON.stringify(b) : undefined });
  const tx = await r.text(); let j; try { j = JSON.parse(tx); } catch { j = tx; }
  return { status: r.status, body: j, ...(typeof j === "object" && j ? j : {}) };
};
let api = zovi(token);

// ---- pripremi stanje pre "nestanka struje" ----
await api("/api/computers/bulk", "POST", { count: 3, prefix: "PC-" });
await api("/api/shop", "POST", { name: "Kola", category: "Pica", price: 140, stock: 10 });
const kola = (await api("/api/shop")).body.find((i) => i.name === "Kola");
await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 600 });
const marko = (await api("/api/players?page=1&per=5&search=marko")).body.items[0];

await api("/api/shift/open", "POST", { openingCash: 2000 });
await api(`/api/players/${marko.id}/topup`, "POST", { amount: 500 });
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 2 }], payment: "cash" });

const comps = (await api("/api/computers")).body;
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
ws.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(800);

const preSmena = (await api("/api/shift")).body;
// igrac se ne vidi kroz /computers (namerno okresano), nego kroz /snapshot
const izSnapshota = async (id) => (await api("/api/snapshot")).body.computers.find((c) => c.id === id);
const preStanje = await izSnapshota(comps[0].id);
const preKredit = (await api("/api/players?page=1&per=5&search=marko")).body.items[0].balance;
proveri("pre gasenja: smena otvorena", preSmena && preSmena.id > 0);
proveri("pre gasenja: igrac za racunarom", preStanje.player?.username === "marko", JSON.stringify(preStanje.player));

// ---- NESTANAK STRUJE ----
try { ws.close(); } catch {}
await ugasi();

pokreni();
proveri("server se podigao posle gasenja", await cekajServer());

// ---- sta je prezivelo ----
api = zovi(token);
const meProvera = await api("/api/me");
proveri("token prijave prezivi restart", meProvera.status === 200, String(meProvera.status));
if (meProvera.status !== 200) { token = await prijava(); api = zovi(token); }

const posleSmena = (await api("/api/shift")).body;
proveri("smena je i dalje otvorena", posleSmena && posleSmena.id === preSmena.id, `${posleSmena?.id} vs ${preSmena.id}`);
proveri("pocetno stanje kase zapamceno", posleSmena?.openingCash === 2000, String(posleSmena?.openingCash));
proveri("dopuna ostala u obracunu", posleSmena?.totals.topups === preSmena.totals.topups, `${posleSmena?.totals.topups} vs ${preSmena.totals.topups}`);
proveri("kes iz shopa ostao u obracunu", posleSmena?.totals.shopCash === 280, String(posleSmena?.totals.shopCash));
proveri("pazar nepromenjen", posleSmena?.totals.revenue === preSmena.totals.revenue, `${posleSmena?.totals.revenue} vs ${preSmena.totals.revenue}`);

const posleKredit = (await api("/api/players?page=1&per=5&search=marko")).body.items[0].balance;
proveri("kredit igraca prezivi", Math.abs(posleKredit - preKredit) < 2, `${preKredit} -> ${posleKredit}`);
proveri("zaliha prezivi", (await api("/api/shop")).body.find((i) => i.name === "Kola").stock === 8, String((await api("/api/shop")).body.find((i) => i.name === "Kola").stock));

// ---- klijent se vraca: sesija se nastavlja ----
const poruke = [];
const ws2 = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
ws2.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { ws2.once("open", res); ws2.once("error", rej); });
await cekaj(900);
const nastavak = poruke.find((m) => m.t === "login_ok");
proveri("sesija se nastavlja bez ponovne prijave", !!nastavak, JSON.stringify(poruke.map((m) => m.t)));
proveri("nastavak nosi istog igraca", nastavak?.player?.username === "marko", JSON.stringify(nastavak?.player));
proveri("racunar je opet zauzet", (await izSnapshota(comps[0].id))?.player?.username === "marko", JSON.stringify((await izSnapshota(comps[0].id))?.player));

// ---- naplata ne sme da "nadoknadi" vreme dok je server bio ugasen ----
const kreditPreCekanja = (await api("/api/players?page=1&per=5&search=marko")).body.items[0].balance;
// naplata ide na 5s, a prvi otkucaj posle povratka samo resetuje sat
// (namerno, da nema naplate unazad) - zato se ceka preko dva otkucaja
await cekaj(13000);
const kreditPosle = (await api("/api/players?page=1&per=5&search=marko")).body.items[0].balance;
const skinuto = kreditPreCekanja - kreditPosle;
proveri("naplata tece normalno posle povratka", skinuto > 0 && skinuto < 2, `skinuto ${skinuto.toFixed(2)} za ~13s`);

// ---- zatvaranje smene i dalje racuna tacno ----
const zatvaranje = await api("/api/shift/close", "POST", { closingCash: 2000 + 500 + 280 });
proveri("obracun smene tacan posle restarta", Math.abs(zatvaranje.summary.difference) < 0.01, JSON.stringify(zatvaranje.summary));

try { ws2.close(); } catch {}
await ugasi();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
