import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Pracenje pokretanja igara: statistika za vlasnika i redosled police za igraca.
import fs from "node:fs";

const BASE = "http://127.0.0.1:8099";
const WSB = "ws://127.0.0.1:8099";
const DATA = radniFolder("igre-data");
await podigniServer(DATA, 8099);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/computers/bulk", "POST", { count: 3, prefix: "PC-" });
for (const ime of ["CS2", "Fortnite", "GTA V", "Valorant"]) {
  await api("/api/games", "POST", { name: ime, path: `C:\\Igre\\${ime}.exe` });
}
const igre = await api("/api/games");
const id = (ime) => igre.find((g) => g.name === ime).id;

await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 500 });
await api("/api/players", "POST", { username: "ana", password: "test1234", balance: 500 });

const comps = await api("/api/computers");
async function sesija(pc, ko, pokreni) {
  const poruke = [];
  const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}`);
  ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  ws.send(JSON.stringify({ t: "login", username: ko, password: "test1234" }));
  await new Promise((r) => setTimeout(r, 600));
  for (const gid of pokreni) { ws.send(JSON.stringify({ t: "game_start", gameId: gid })); await new Promise((r) => setTimeout(r, 120)); }
  await new Promise((r) => setTimeout(r, 300));
  const prijava = poruke.find((m) => m.t === "login_ok");
  ws.send(JSON.stringify({ t: "logout" }));
  await new Promise((r) => setTimeout(r, 300));
  ws.close();
  return prijava;
}

// marko igra CS2 pa GTA V, ana samo CS2
const p1 = await sesija(comps[0], "marko", [id("CS2"), id("GTA V")]);
proveri("prva prijava nema skoro igranih", Array.isArray(p1.skoroIgrane) && p1.skoroIgrane.length === 0, JSON.stringify(p1.skoroIgrane));
await sesija(comps[1], "ana", [id("CS2")]);

// marko se vraca - server mu salje njegov redosled, poslednja igra prva
const p2 = await sesija(comps[0], "marko", []);
proveri("markov redosled je po poslednjem pokretanju",
  JSON.stringify(p2.skoroIgrane) === JSON.stringify([id("GTA V"), id("CS2")]),
  JSON.stringify(p2.skoroIgrane) + " ocekivano " + JSON.stringify([id("GTA V"), id("CS2")]));

const p3 = await sesija(comps[1], "ana", []);
proveri("ana ne vidi markov redosled", JSON.stringify(p3.skoroIgrane) === JSON.stringify([id("CS2")]), JSON.stringify(p3.skoroIgrane));

// statistika vlasnika
const st = await api("/api/stats?period=month");
const top = st.topGames || [];
proveri("CS2 je najigraniji", top[0]?.name === "CS2" && top[0]?.puta === 2, JSON.stringify(top));
proveri("broji razlicite igrace", top[0]?.igraca === 2, JSON.stringify(top[0]));
proveri("GTA V zabelezen jednom", top.find((g) => g.name === "GTA V")?.puta === 1, JSON.stringify(top));
proveri("neigrane igre se ne prikazuju", !top.some((g) => g.name === "Valorant"), JSON.stringify(top.map((g) => g.name)));

// nepostojeca igra ne sme nista da upise ni da sruzi server
const pre = (await api("/api/stats?period=month")).topGames.length;
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[2].token)}`);
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
ws.send(JSON.stringify({ t: "game_start", gameId: 9999 }));
ws.send(JSON.stringify({ t: "game_start" }));
await new Promise((r) => setTimeout(r, 400));
proveri("nepostojeca igra se ignorise", (await api("/api/stats?period=month")).topGames.length === pre);
ws.close();

// pokretanje bez prijavljenog igraca se belezi, ali bez igraca
ws2: {
  const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[2].token)}`);
  await new Promise((res, rej) => { w.once("open", res); w.once("error", rej); });
  w.send(JSON.stringify({ t: "game_start", gameId: id("Valorant") }));
  await new Promise((r) => setTimeout(r, 400));
  const t2 = (await api("/api/stats?period=month")).topGames;
  proveri("pokretanje bez prijave se belezi", t2.some((g) => g.name === "Valorant"), JSON.stringify(t2.map((g) => g.name)));
  w.close();
}

const log = (await api("/api/logs?page=1&per=30&category=igre")).items || [];
proveri("upisano u logove pod kategorijom igre", log.some((l) => /Pokrenuta igra: CS2/.test(l.detail || "")), JSON.stringify(log.slice(0, 2)));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
