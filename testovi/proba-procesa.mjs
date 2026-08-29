import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder } from "./_okruzenje.mjs";
// DALJINSKI TASK MANAGER
// Pusta pravi launcher, trazi spisak procesa sa panela i gasi PRAVI program
// koji je za tu priliku pokrenut. Ovo se ne moze proveriti iz koda: mora da
// prodje kroz WebSocket, PowerShell popis i taskkill.
//
//   node proba-procesa.mjs
const PORT = 8153;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("procesi-data");
const RADNO = path.join(radniFolder("procesi-klijent"));
fs.mkdirSync(RADNO, { recursive: true });

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server ----
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

await api("/api/computers/bulk", "POST", { count: 1, prefix: "PC-" });
const pc = (await api("/api/computers"))[0];

// ---- launcher (pravi main.js, bez diranja Windows politika) ----
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app } = require("electron");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-procesa", version: "1.0.0", main: "main.js" }), "utf8");

const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const klijent = spawn(electron, [RADNO], { shell: process.platform === "win32", stdio: "ignore" });

// sacekaj da se launcher poveze
let povezan = false;
for (let i = 0; i < 40; i++) {
  const c = (await api("/api/computers")).find((x) => x.id === pc.id);
  if (c?.online) { povezan = true; break; }
  await cekaj(500);
}
proveri("launcher se povezao na server", povezan);

// ---- 1) spisak procesa stize sa racunara ----
const r1 = await api(`/api/computers/${pc.id}/procesi`);
const spisak = r1.spisak || [];
proveri("spisak procesa stize u panel", spisak.length > 5, JSON.stringify(r1).slice(0, 140));
proveri("svaki red ima ime i PID", spisak.every((p) => p.ime && Number.isInteger(p.pid)));
proveri("memorija se prijavljuje", spisak.some((p) => p.memorija > 0));
proveri("sistemski programi su oznaceni", spisak.some((p) => p.zasticen === true));
proveri("spisak je poredjan po memoriji", spisak.length < 2 || spisak[0].memorija >= spisak[spisak.length - 1].memorija);

// ---- 2) sistemski proces se NE gasi odavde ----
const sistemski = spisak.find((p) => p.zasticen);
if (sistemski) {
  const r = await api(`/api/computers/${pc.id}/procesi/${sistemski.pid}/ugasi`, "POST");
  proveri("sistemski program se odbija", !!r.error, JSON.stringify(r).slice(0, 120));
  proveri("poruka objasnjava zasto", /sistemski/i.test(r.error || ""), r.error);
} else { proveri("ima bar jedan sistemski program za probu", false); }

// ---- 3) PRAVI program se gasi ----
// Pokrecemo notepad, nadjemo ga u spisku i ugasimo kroz panel.
const meta = spawn("notepad.exe", { detached: true, stdio: "ignore" });
meta.unref();
await cekaj(1800);
const r2 = await api(`/api/computers/${pc.id}/procesi`);
const nasNotepad = (r2.spisak || []).find((p) => p.ime === "notepad.exe");
proveri("pokrenut program se vidi u spisku", !!nasNotepad, nasNotepad ? `pid ${nasNotepad.pid}` : "nema ga");
if (nasNotepad) {
  proveri("obican program nije oznacen kao sistemski", nasNotepad.zasticen === false);
  const r3 = await api(`/api/computers/${pc.id}/procesi/${nasNotepad.pid}/ugasi`, "POST");
  proveri("gasenje javlja uspeh", r3.ok === true, JSON.stringify(r3).slice(0, 120));
  await cekaj(1200);
  const r4 = await api(`/api/computers/${pc.id}/procesi`);
  proveri("program STVARNO vise ne radi",
    !(r4.spisak || []).some((p) => p.pid === nasNotepad.pid),
    "posle gasenja se i dalje javlja u spisku");
}

// ---- 4) gasenje se belezi ----
const logovi = await api("/api/logs?category=racunar");
const zapisi = (Array.isArray(logovi) ? logovi : logovi.items || []).filter((x) => x.action === "proces_ugasen");
proveri("gasenje ostaje zapisano ko je i sta ugasio", zapisi.length >= 1,
  JSON.stringify(zapisi.map((z) => z.detail)).slice(0, 160));

// ---- 5) racunar koji nije na vezi ----
// Drugi racunar na koji se launcher nikad nije prijavio - to je uvek isti
// slucaj kao ugasena masina, a za razliku od ubijanja procesa je pouzdano.
await api("/api/computers", "POST", { name: "PC-BEZ-VEZE" });
const bezVeze = (await api("/api/computers")).find((x) => x.name === "PC-BEZ-VEZE");
const r5 = await api(`/api/computers/${bezVeze.id}/procesi`);
proveri("racunar bez veze javlja jasnu poruku", /nije povezan/i.test(r5.error || ""), JSON.stringify(r5).slice(0, 120));
const r6 = await api(`/api/computers/${bezVeze.id}/procesi/1234/ugasi`, "POST");
proveri("ni gasenje ne visi kad racunara nema", /nije povezan/i.test(r6.error || ""), JSON.stringify(r6).slice(0, 120));

try { klijent.kill(); } catch {}

try { server.kill(); } catch {}
await cekaj(400);
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
