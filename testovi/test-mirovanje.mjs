import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Provera odjave zbog mirovanja: prag, odbrojavanje, otkazivanje i zatvaranje.

const BASE = "http://127.0.0.1:8107";
const WSB = "ws://127.0.0.1:8107";
const DATA = radniFolder("mirovanje-data");
await podigniServer(DATA, 8107);
let pao = 0, prosao = 0;
const proveri = (naziv, uslov, detalj = "") => {
  if (uslov) { prosao++; console.log("  OK   " + naziv); }
  else { pao++; console.log("  PAO  " + naziv + (detalj ? "  -> " + detalj : "")); }
};

const token = (await fetch(BASE + "/api/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }),
}).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, {
  method: m, headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

// prag na 1 minut da test ne traje 15
await api("/api/settings", "POST", { idleMinutes: 1 });
const s = await api("/api/settings");
proveri("podesavanje se cuva", s.idleMinutes === 1, JSON.stringify(s.idleMinutes));

await api("/api/computers/bulk", "POST", { count: 2, prefix: "PC-" });
await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 600 });
const comps = await api("/api/computers");
const c = comps[0];
const poruke = [];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(c.token)}`);
ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
ws.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await new Promise((r) => setTimeout(r, 700));
proveri("igrac prijavljen", poruke.some((m) => m.t === "login_ok"));

const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const zadnjeMirovanje = () => [...poruke].reverse().find((m) => m.t === "mirovanje");
const stanje = async () => (await api("/api/computers")).find((x) => x.id === c.id);

// ispod praga (30 s < 60 s) -> nista
poruke.length = 0;
ws.send(JSON.stringify({ t: "heartbeat", mirovanje: 30 }));
await cekaj(400);
proveri("ispod praga nema upozorenja", !zadnjeMirovanje());

// preko praga -> odbrojavanje
ws.send(JSON.stringify({ t: "heartbeat", mirovanje: 70 }));
await cekaj(400);
const u1 = zadnjeMirovanje();
proveri("preko praga stize odbrojavanje", u1 && u1.preostalo === 50, JSON.stringify(u1));
proveri("sesija jos traje", (await stanje()).status === "in_use");

// igrac se vratio -> otkazivanje
poruke.length = 0;
ws.send(JSON.stringify({ t: "heartbeat", mirovanje: 0 }));
await cekaj(400);
const u2 = zadnjeMirovanje();
proveri("povratak otkazuje odbrojavanje", u2 && u2.preostalo === null, JSON.stringify(u2));

// ponovo preko praga pa preko granice -> odjava
ws.send(JSON.stringify({ t: "heartbeat", mirovanje: 80 }));
await cekaj(300);
poruke.length = 0;
ws.send(JSON.stringify({ t: "heartbeat", mirovanje: 125 }));
await cekaj(600);
const st = await stanje();
proveri("sesija zatvorena", st.status !== "in_use" && !st.player, JSON.stringify({ status: st.status, player: st.player }));
proveri("racunar nije zakljucan (slobodan za sledeceg)", st.status === "idle", st.status);
proveri("klijent dobio to_login", poruke.some((m) => m.t === "to_login"));

const log = (await api("/api/logs?page=1&per=5&cat=sesija")).items || [];
proveri("upisano u logove", log.some((l) => (l.detail || "").includes("Nije bilo aktivnosti")), JSON.stringify(log[0]));

// iskljuceno (0) -> nista se ne desava
await api("/api/settings", "POST", { idleMinutes: 0 });
ws.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(600);
poruke.length = 0;
ws.send(JSON.stringify({ t: "heartbeat", mirovanje: 9999 }));
await cekaj(500);
const st2 = await stanje();
proveri("sa 0 minuta se ne odjavljuje", st2.status === "in_use" && !zadnjeMirovanje(), JSON.stringify(st2.status));

await api("/api/settings", "POST", { idleMinutes: 15 });
ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
