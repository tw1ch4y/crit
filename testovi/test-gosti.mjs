import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Provera brzog otvaranja gostujucih naloga.
import fs from "node:fs";
const BASE = "http://127.0.0.1:8098";
const WSB = "ws://127.0.0.1:8098";
const DATA = radniFolder("gosti2-data");
await podigniServer(DATA, 8098);
let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const r1 = await api("/api/players/guests", "POST", { count: 3, balance: 240 });
proveri("otvara trazeni broj naloga", r1.players?.length === 3, JSON.stringify(r1).slice(0, 120));
proveri("imena idu redom", r1.players.map((p) => p.username).join(",") === "gost-01,gost-02,gost-03", r1.players?.map((p) => p.username).join(","));
proveri("lozinka je cetvorocifrena", r1.players.every((p) => /^\d{4}$/.test(p.password)), JSON.stringify(r1.players.map((p) => p.password)));
proveri("lozinke nisu iste", new Set(r1.players.map((p) => p.password)).size >= 2 || r1.players.length < 2);
proveri("kredit upisan", r1.players.every((p) => p.balance === 240));

const spisak = await api("/api/players?page=1&per=50&search=gost");
const nadjen = spisak.items.find((p) => p.username === "gost-02");
proveri("nalog stvarno u bazi sa kreditom", nadjen && nadjen.balance === 240, JSON.stringify(nadjen));
proveri("napomena oznacava gosta", /gost/i.test(nadjen?.note || ""), nadjen?.note);

// drugi krug ne sme da pregazi postojece
const r2 = await api("/api/players/guests", "POST", { count: 2, balance: 0 });
proveri("preskace zauzeta imena", r2.players.map((p) => p.username).join(",") === "gost-04,gost-05", r2.players?.map((p) => p.username).join(","));

// posle brisanja popunjava rupu
const zaBrisanje = spisak.items.find((p) => p.username === "gost-02");
await api(`/api/players/${zaBrisanje.id}`, "DELETE");
const r3 = await api("/api/players/guests", "POST", { count: 1, balance: 0 });
proveri("popunjava oslobodjeno ime", r3.players[0].username === "gost-02", r3.players?.[0]?.username);

// lozinka stvarno radi za prijavu na racunar
const comps = await api("/api/computers");
const slobodan = comps.find((c) => !c.player);
const g = r1.players[0];
const poruke = [];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(slobodan.token)}`);
ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
ws.send(JSON.stringify({ t: "login", username: g.username, password: g.password }));
await new Promise((r) => setTimeout(r, 700));
proveri("gost moze da se prijavi izdiktiranom lozinkom", poruke.some((m) => m.t === "login_ok"), JSON.stringify(poruke.map((m) => m.t)));

// granice
const r4 = await api("/api/players/guests", "POST", { count: 99, balance: 0 });
proveri("ogranicava na 10 odjednom", r4.players?.length === 10, String(r4.players?.length));
const r5 = await api("/api/players/guests", "POST", { count: 0, balance: 0 });
proveri("nula se svodi na jedan", r5.players?.length === 1, String(r5.players?.length));

const log = (await api("/api/logs?page=1&per=5&cat=nalozi")).items || [];
proveri("upisano u logove", log.some((l) => /gostuju/i.test(l.detail || "")), JSON.stringify(log[0]));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
