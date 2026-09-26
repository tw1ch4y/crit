import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// WebSocket je kicma sistema. Ako ga sruse pokvarena poruka, tudji token ili
// brzo prekidanje veze, cela igraonica staje. Ovde se namerno gadja.
const BASE = "http://127.0.0.1:8109", WSB = "ws://127.0.0.1:8109";
const DATA = radniFolder("veza-data");
await podigniServer(DATA, 8109);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/computers/bulk", "POST", { count: 3, prefix: "PC-" });
await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 500 });
const comps = await api("/api/computers");
// baza pri prvom pokretanju vec ima 13 racunara, pa se ne broji tacan broj
const ziv = async () => Array.isArray(await api("/api/computers"));

const spoji = (kind, t) => new Promise((res) => {
  const w = new WebSocket(`${WSB}/ws?kind=${kind}&token=${encodeURIComponent(t)}`);
  const poruke = [];
  w.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch { poruke.push({ t: "necitljivo" }); } });
  w.once("open", () => res({ w, poruke, otvoren: true }));
  w.once("error", () => res({ w: null, poruke, otvoren: false }));
  setTimeout(() => res({ w: null, poruke, otvoren: false }), 2500);
});

// ---- pokvarene poruke ne smeju da obore server ----
const k = await spoji("client", comps[0].token);
proveri("klijent se povezao", k.otvoren);
const smece = [
  "ovo nije json",
  "{nezatvoren",
  "[]",
  "null",
  '{"t":null}',
  '{"t":123}',
  '{"t":"nepoznato","x":1}',
  '{"t":"login"}',
  '{"t":"login","username":null,"password":null}',
  '{"t":"order"}',
  '{"t":"order","items":"nije niz"}',
  '{"t":"order","items":[{"id":"abc","qty":"puno"}]}',
  '{"t":"unlock_pin"}',
  '{"t":"game_start","gameId":"ne-broj"}',
  '{"t":"heartbeat","mirovanje":"tekst"}',
  '{"t":"heartbeat","mirovanje":-999}',
  '{"t":"sys_info","nics":"nije niz"}',
  JSON.stringify({ t: "order", items: Array.from({ length: 500 }, () => ({ id: 1, qty: 99 })) }),
  JSON.stringify({ t: "login", username: "x".repeat(50000), password: "y".repeat(50000) }),
];
for (const s of smece) { try { k.w.send(s); } catch {} }
await cekaj(1200);
proveri("server preziveo pokvarene poruke", await ziv());
proveri("veza nije prekinuta zbog smeca", k.w.readyState === 1, String(k.w.readyState));

// ---- posle smeca normalan rad mora da radi ----
k.poruke.length = 0;
k.w.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(700);
proveri("prijava radi posle smeca", k.poruke.some((m) => m.t === "login_ok"), JSON.stringify(k.poruke.map((m) => m.t)));

// ---- tudji i neispravni tokeni ----
const losi = [
  ["prazan token", ""],
  ["izmisljen token", "nepostojeci-token-123"],
  ["panel token kao klijent", token],
  ["token drugog racunara kao panel", comps[1].token],
];
for (const [naziv, t] of losi) {
  const kind = naziv.includes("panel token") ? "client" : naziv.includes("kao panel") ? "panel" : "client";
  const v = await spoji(kind, t);
  proveri(`odbija: ${naziv}`, !v.otvoren || v.poruke.some((m) => m.t === "error") || v.w?.readyState !== 1,
    `otvoren=${v.otvoren} poruke=${JSON.stringify(v.poruke.map((m) => m.t))}`);
  try { v.w?.close(); } catch {}
}
proveri("server ziv posle losih tokena", await ziv());

// ---- brzo spajanje i prekidanje ----
for (let i = 0; i < 25; i++) {
  const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[2].token)}`);
  w.on("error", () => {});
  setTimeout(() => { try { w.close(); } catch {} }, i % 3 === 0 ? 0 : 40);
}
await cekaj(2500);
proveri("server preziveo brzo spajanje/prekidanje", await ziv());

// ---- dve veze za isti racunar: stara se zatvara, nova radi ----
const a = await spoji("client", comps[1].token);
const b = await spoji("client", comps[1].token);
await cekaj(700);
proveri("druga veza za isti racunar je preuzela", b.otvoren && b.w.readyState === 1, String(b.w?.readyState));
proveri("prva veza je zatvorena", a.w == null || a.w.readyState !== 1, String(a.w?.readyState));

b.poruke.length = 0;
b.w.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(700);
proveri("igrac ne moze na dva racunara odjednom",
  b.poruke.some((m) => m.t === "login_err"), JSON.stringify(b.poruke.map((m) => m.t)));

// ---- sesija prezivi sve ovo ----
const snap = await api("/api/snapshot");
const zauzet = snap.computers.find((c) => c.id === comps[0].id);
proveri("sesija na prvom racunaru je netaknuta", zauzet?.player?.username === "marko", JSON.stringify(zauzet?.player));
proveri("nema duplih sesija", snap.computers.filter((c) => c.player?.username === "marko").length === 1,
  JSON.stringify(snap.computers.filter((c) => c.player).map((c) => c.name)));

// ---- server i dalje normalno odgovara ----
proveri("panel i dalje radi", (await api("/api/snapshot")).computers.length > 0);
proveri("naplata nije stala", typeof (await api("/api/shift")) !== "undefined");

// ---- zapis sa racunara stize u Logove ----
// Launcher javlja blokirano pokretanje skinutog programa, a server to upisuje u
// Logove.
k.w.send(JSON.stringify({ t: "log_klijent", tekst: "Blokirano pokretanje preuzetog programa: zlo.exe" }));
k.w.send(JSON.stringify({ t: "log_klijent", tekst: "Blokirano pokretanje preuzetog programa: zlo.exe" }));
k.w.send(JSON.stringify({ t: "log_klijent", tekst: "x".repeat(5000) }));
await cekaj(500);
const zapisi = (await api("/api/logs?limit=100")).filter((l) => l.action === "klijent_zapis");
proveri("blokiran program sa racunara stize u Logove", zapisi.some((l) => /zlo\.exe/.test(l.detail || "")), JSON.stringify(zapisi));
proveri("isti zapis se ne ponavlja odmah", zapisi.filter((l) => /zlo\.exe/.test(l.detail || "")).length === 1);
proveri("predugacak tekst se skracuje", zapisi.every((l) => (l.detail || "").length <= 200));

// ---- prevelika poruka zatvara samo tu vezu ----
// Podrazumevana granica biblioteke je 100 MB; toliko bi jedan klijent drzao u
// memoriji servera.
const velika = await spoji("client", comps[comps.length - 1].token);
let zatvorena = false;
velika.w?.on("close", () => { zatvorena = true; });
try { velika.w?.send("x".repeat(3 * 1024 * 1024)); } catch {}
for (let i = 0; i < 50 && !zatvorena; i++) await cekaj(100);
proveri("prevelika poruka zatvara tu vezu", velika.otvoren && zatvorena);
proveri("a server radi dalje", await ziv());

try { k.w.close(); b.w?.close(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
