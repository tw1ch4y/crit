import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ugasiLaunchere, putanjaElektrona } from "./_okruzenje.mjs";
// KLIK NA IGRU MORA DA STIGNE DO BAZE
//
// Kad igrac pokrene igru, launcher javi serveru { t: "game_start", gameId }.
// Taj jedan podatak nosi tri stvari:
//
//   - igracu se skoro igrane igre vracaju na pocetak police
//   - vlasnik u izvestaju vidi sta se stvarno igra
//   - u Logovima stoji ko je sta pokrenuo i kada
//
// Sve troje je bilo mrtvo, i to tiho: plocica igre je u sebe upisivala samo
// putanju, argumente i naziv - BEZ id-a. Slalo se gameId: undefined, server ne
// bi nasao igru i vratio bi se bez ijedne greske. Tabela pokretanja je ostajala
// prazna zauvek, a nista u programu to nije prijavljivalo.
//
// Ovo se ne vidi iz koda: trazi pravi klik na pravu plocicu i pogled u bazu.
//
//   node proba-pokretanje-igre.mjs
const PORT = 8201;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("pokretanje-data");
const RADNO = radniFolder("pokretanje-klijent");

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

const IGRA = "Counter-Strike 2";
await api("/api/games", "POST", { name: IGRA, path: "C:\\games\\cs2.exe", category: "Pucačine" });
await api("/api/games", "POST", { name: "Valorant", path: "C:\\games\\valorant.exe", category: "Pucačine" });
const igre = await api("/api/games");
const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 1000, note: "keš" });

const IZLAZ = path.join(RADNO, "nalaz.json");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
// Igra se ne pokrece stvarno - ovde je bitno samo da launcher misli da jeste,
// pa da posalje serveru sta je pokrenuo.
require("electron").app.whenReady().then(() => {
  try { ipcMain.removeHandler("launch-game"); } catch {}
  ipcMain.handle("launch-game", () => ({ ok: true }));
});
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});

app.whenReady().then(async () => {
  let w = null;
  for (let i = 0; i < 80 && !w; i++) {
    w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !(x.webContents.getURL() || "").includes("overlay"));
    if (w && w.webContents.isLoading()) w = null;
    if (!w) await new Promise((r) => setTimeout(r, 300));
  }
  const js = (izraz) => w.webContents.executeJavaScript(izraz).catch((e) => "GRESKA: " + e.message);
  const ekran = () => js('[...document.querySelectorAll(".screen")].find(s => s.classList.contains("active"))?.id');

  for (let i = 0; i < 60; i++) { if ((await ekran()) === "loginScreen") break; await new Promise((r) => setTimeout(r, 500)); }
  await js('(() => { document.querySelector("#pUser").value = "mile"; document.querySelector("#pPass").value = "mile1234";'
    + ' document.querySelector("#loginForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); return 1; })()');
  await new Promise((r) => setTimeout(r, 3500));

  const nalaz = { ekran: await ekran() };
  // Sta plocica nosi u sebi - odatle se cita id pri pokretanju.
  nalaz.podaci = await js('(() => { const t = document.querySelector("[data-game]"); return t ? t.dataset.game : "nema plocice"; })()');
  const trazi = ${JSON.stringify(IGRA)};
  nalaz.klik = await js('(() => { const t = [...document.querySelectorAll("[data-game]")]'
    + '.find(x => (x.dataset.game || "").includes(' + JSON.stringify(trazi) + '));'
    + ' if (!t) return "nema te igre"; t.click(); return "kliknuto"; })()');
  await new Promise((r) => setTimeout(r, 2500));
  try { fs.writeFileSync(${JSON.stringify(IZLAZ.replace(/\\/g, "/"))}, JSON.stringify(nalaz)); } catch {}
  app.exit(0);
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-pokretanje", version: "1.0.0", main: "main.js" }), "utf8");

const electron = putanjaElektrona();
const klijent = spawn(electron, [RADNO], { stdio: "ignore" });
for (let i = 0; i < 120; i++) { if (fs.existsSync(IZLAZ)) break; await cekaj(500); }
const nalaz = (() => { try { return JSON.parse(fs.readFileSync(IZLAZ, "utf8")); } catch { return null; } })();

proveri("launcher se prijavio", nalaz?.ekran === "desktopScreen", JSON.stringify(nalaz)?.slice(0, 140));
proveri("pločica igre nosi id", /"id":\s*\d+/.test(nalaz?.podaci || ""),
  `podaci pločice: ${nalaz?.podaci} - bez id-a se serveru šalje undefined`);
proveri("igra je kliknuta", nalaz?.klik === "kliknuto", String(nalaz?.klik));

// ---- SUSTINA: da li je pokretanje stiglo u bazu ----
const izvestaj = await api("/api/stats?period=today");
const najigranije = izvestaj?.igre || izvestaj?.topGames || [];
proveri("izveštaj vidi pokrenutu igru", Array.isArray(najigranije) && najigranije.length > 0,
  `izveštaj: ${JSON.stringify(najigranije).slice(0, 160)}`);
if (najigranije.length) {
  proveri("i to baš onu koja je kliknuta", JSON.stringify(najigranije).includes(IGRA),
    JSON.stringify(najigranije).slice(0, 160));
}

const logovi = await api("/api/logs?limit=40");
const zapis = (Array.isArray(logovi) ? logovi : logovi.rows || []).find((l) => l.action === "launch");
proveri("pokretanje je zapisano u Logovima", !!zapis, "bez toga vlasnik ne vidi ko je šta pokretao");
proveri("u zapisu piše koja igra", zapis && zapis.detail.includes(IGRA), zapis?.detail);
proveri("zna se i ko je pokrenuo", zapis && zapis.actor === "mile", zapis?.actor);

try { klijent.kill(); } catch {}
ugasiLaunchere();
try { server.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(600);
process.exit(pao ? 1 : 0);
