import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, putanjaElektrona } from "./_okruzenje.mjs";
// PRAVI LAUNCHER I OTKUCAJ SERVERA
//
// Server od sada pinguje svaku vezu i GASI onu koja ne odgovori do sledeceg
// ping-a. To resava racunar kome je iscupan kabl (vidi test-mrtva-veza), ali
// nosi i rizik: ako pravi launcher iz bilo kog razloga ne odgovori na ping,
// svih trinaest racunara bi ispadalo sa mreze svakih trideset sekundi. To bi
// bilo gore od greske koja se popravlja.
//
// Zato se ovde pusta PRAVI launcher i gleda se dva puna kruga ping-a. Nista od
// ovoga se ne vidi iz koda: odgovor na ping salje sama biblioteka, duboko ispod
// nase logike.
//
//   node proba-veza.mjs
const PORT = 8189;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("veza-data");
const RADNO = radniFolder("veza-klijent");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
  env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: "ignore",
});
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status) break; } catch {}
  await cekaj(200);
}
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const pc = (await api("/api/computers"))[0];

fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app } = require("electron");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-veza", version: "1.0.0", main: "main.js" }), "utf8");

const electron = putanjaElektrona();
const klijent = spawn(electron, [RADNO], { stdio: "ignore" });

const online = async () => (await api("/api/computers")).find((c) => c.id === pc.id)?.online === true;

let povezan = false;
for (let i = 0; i < 40; i++) { if (await online()) { povezan = true; break; } await cekaj(500); }
proveri("launcher se povezao", povezan);

// ---- DVA PUNA KRUGA PING-A ----
// Server pinguje na 15 s i gasi vezu koja je propustila prethodni ping. Ako
// launcher ne odgovara, ispao bi najkasnije u 30. sekundi.
console.log("  ...gledam vezu 45 sekundi (tri kruga ping-a)");
let ispao = 0;
for (let i = 0; i < 45; i++) {
  await cekaj(1000);
  if (!(await online())) ispao++;
}
proveri("launcher NIJE ispao zbog ping-a", ispao === 0,
  `bio je van mreze ${ispao} od 45 provera - server bi izbacivao sve racunare svakih 30 s`);

// ---- kad server ipak prekine vezu, launcher se sam vrati ----
// Isto se desi i kad se ruter resetuje: veza padne, launcher mora sam nazad.
await api(`/api/computers/${pc.id}/message`, "POST", { text: "proba" }).catch(() => {});
const preRestarta = await online();
proveri("veza je ziva pre prekida", preRestarta);

server.kill();
await cekaj(2500);
const server2 = spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
  env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: "ignore",
});
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status) break; } catch {}
  await cekaj(200);
}
let vratio = false;
for (let i = 0; i < 30; i++) { if (await online()) { vratio = true; break; } await cekaj(1000); }
proveri("launcher se sam vratio posle restarta servera", vratio,
  "bez toga bi radnik morao rucno da obilazi masine");

try { klijent.kill(); } catch {}
try { server2.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(600);
process.exit(pao ? 1 : 0);
