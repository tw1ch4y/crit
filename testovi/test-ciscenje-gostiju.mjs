import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Ciscenje potrosenih gostiju ne sme da dira redovne igrace, goste sa kreditom,
// one koji sede za racunarom, ni naloge otvorene danas.
// Radi nad SVOJOM bazom, ne nad zajednickom test bazom, da ne zavisi od zatecenog stanja.
import { DatabaseSync } from "node:sqlite";

const BASE = "http://127.0.0.1:8097";
const WSB = "ws://127.0.0.1:8097";
const DATA = radniFolder("gosti-data");

import fs from "node:fs";
await podigniServer(DATA, 8097);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/computers/bulk", "POST", { count: 4, prefix: "PC-" });
const svi = async () => (await api("/api/players?page=1&per=200")).items.map((p) => p.username);
const spremniZa = async () => (await api("/api/players/guests/spremni")).map((g) => g.username);

// --- danasnji nalozi se NE diraju, ma kakvi bili ---
const danasnji = await api("/api/players/guests", "POST", { count: 2, balance: 0 });
proveri("nalog otvoren danas se ne nudi za brisanje", (await spremniZa()).length === 0, JSON.stringify(await spremniZa()));

// --- ostarimo ih rucno, kao da je proslo dva dana ---
const dbPath = path.join(DATA, "crit.db");
const ostari = (username) => {
  const d = new DatabaseSync(dbPath);
  d.prepare("UPDATE players SET created_at = created_at - ? WHERE username = ?").run(2 * 86400000, username);
  d.close();
};
danasnji.players.forEach((p) => ostari(p.username));
proveri("stari nalog bez kredita se nudi", (await spremniZa()).length === 2, JSON.stringify(await spremniZa()));

// --- gost sa kreditom i redovan igrac ostaju ---
const saKreditom = await api("/api/players/guests", "POST", { count: 1, balance: 300 });
ostari(saKreditom.players[0].username);
await api("/api/players", "POST", { username: "pera-redovni", password: "test1234" });
const sp1 = await spremniZa();
proveri("gost sa kreditom se ne nudi", !sp1.includes(saKreditom.players[0].username), JSON.stringify(sp1));
proveri("redovan igrac se ne nudi", !sp1.includes("pera-redovni"), JSON.stringify(sp1));

// --- gost koji sedi za racunarom se ne dira, i kad potrosi sve ---
const sedi = (await api("/api/players/guests", "POST", { count: 1, balance: 60 })).players[0];
ostari(sedi.username);
const slobodan = (await api("/api/computers")).find((c) => c.status !== "locked");
const poruke = [];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(slobodan.token)}`);
ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
ws.send(JSON.stringify({ t: "login", username: sedi.username, password: sedi.password }));
await new Promise((r) => setTimeout(r, 800));
proveri("gost se stvarno prijavio", poruke.some((m) => m.t === "login_ok"),
  JSON.stringify(poruke.filter((m) => m.t === "login_err").map((m) => m.message)));
proveri("prijavljen gost se ne nudi", !(await spremniZa()).includes(sedi.username), JSON.stringify(await spremniZa()));

// --- i kad mu kredit padne na nulu, danas je bio ovde: ne dira se ---
await api(`/api/players/${sedi.id}/topup`, "POST", { amount: -60 });
await new Promise((r) => setTimeout(r, 4000));
proveri("gost koji je danas igrao se ne nudi ni kad ostane bez kredita",
  !(await spremniZa()).includes(sedi.username), JSON.stringify(await spremniZa()));

// --- samo ciscenje ---
const r = await api("/api/players/guests/ocisti", "POST");
const posle = await svi();
proveri("obrisao tacno dva stara prazna naloga", r.obrisano === 2, String(r.obrisano));
proveri("gost sa kreditom ostao", posle.includes(saKreditom.players[0].username));
proveri("gost koji je igrao ostao", posle.includes(sedi.username));
proveri("redovan igrac ostao", posle.includes("pera-redovni"));

const log = (await api("/api/logs?page=1&per=5&cat=nalozi")).items || [];
proveri("ciscenje upisano u logove", log.some((l) => /Očišćeni/i.test(l.detail || "")), JSON.stringify(log[0]?.detail));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
