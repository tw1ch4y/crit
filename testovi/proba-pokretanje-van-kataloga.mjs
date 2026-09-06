import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ugasiLaunchere, putanjaElektrona } from "./_okruzenje.mjs";
// POKRECE SE SAMO ONO STO JE SERVER POSLAO
//
// Ekran launchera trazi pokretanje preko mosta (`launch-game`), a most do sada
// nije proveravao STA se trazi - prosledjivao je svaku putanju. Dok je ekran
// ispravan, tu nema problema: on nudi samo ono sto je stiglo sa servera, a sve
// sto ulazi u stranu prolazi kroz bekstvo teksta.
//
// Ali to znaci da izmedju igraca i "pokreni bilo sta na ovom racunaru" stoji
// JEDNA JEDINA pretpostavka - da se u ekran nikad nista ne ubaci. Ovo je kiosk
// na masini za kojom sedi tinejdzer koji ima vremena; takva pretpostavka ne sme
// da bude jedina brava.
//
// Ovde se most gadja direktno, bas kao sto bi ga gadjao ubacen kod: trazi se
// pokretanje programa koji NIJE u katalogu. Mora da bude odbijen, i mora da
// ostane zapis - pokusaj pokretanja necega van spiska nije greska u kucanju.
//
//   node proba-pokretanje-van-kataloga.mjs
const PORT = 8207;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("van-kataloga-data");
const RADNO = radniFolder("van-kataloga-klijent");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
  env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: "ignore",
});
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status) break; } catch {}
  await cekaj(200);
}
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

// Katalog: jedna igra sa poznatom putanjom.
const IGRA = "C:\\igre\\dozvoljena\\igra.exe";
await api("/api/games", "POST", { name: "Dozvoljena igra", path: IGRA, category: "Igre" });
const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 1000, note: "keš" });

const IZLAZ = path.join(RADNO, "nalaz.json");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
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

  // Most se gadja direktno, isto kao sto bi ga gadjao ubacen kod u strani.
  const trazi = (put) => js('window.crit.launchGame(' + JSON.stringify({ path: put, args: "", name: "proba" }) + ')');
  const nalaz = {
    ekran: await ekran(),
    // 1) van kataloga - mora da bude odbijeno
    cmd: await trazi("C:\\\\\\\\Windows\\\\\\\\System32\\\\\\\\cmd.exe"),
    powershell: await trazi("powershell.exe"),
    // 2) i kad se prilepe navodnici ili se promeni velicina slova
    trik: await trazi('"C:\\\\\\\\Windows\\\\\\\\System32\\\\\\\\cmd.exe"'),
    // 3) ono iz kataloga NE SME da bude odbijeno zbog ove zastite
    //    (igra ne postoji na disku, pa se ocekuje poruka "nije instalirana" -
    //     bitno je da NIJE odbijena kao "van kataloga")
    izKataloga: await trazi(${JSON.stringify(IGRA)}),
    izKatalogaDrugaVelicina: await trazi(${JSON.stringify(IGRA.toUpperCase())}),
  };
  try { fs.writeFileSync(${JSON.stringify(IZLAZ.replace(/\\/g, "/"))}, JSON.stringify(nalaz)); } catch {}
  app.exit(0);
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-van-kataloga", version: "1.0.0", main: "main.js" }), "utf8");

const electron = putanjaElektrona();
const klijent = spawn(electron, [RADNO], { stdio: "ignore" });
for (let i = 0; i < 200; i++) { if (fs.existsSync(IZLAZ)) break; await cekaj(400); }
await cekaj(500);
try { klijent.kill(); } catch {}
ugasiLaunchere();

const n = (() => { try { return JSON.parse(fs.readFileSync(IZLAZ, "utf8")); } catch { return null; } })();
proveri("launcher se prijavio", n?.ekran === "desktopScreen", JSON.stringify(n?.ekran));

const odbijeno = (r) => r && r.ok === false && /nije u katalogu/i.test(r.error || "");
proveri("cmd.exe se ODBIJA", odbijeno(n?.cmd), JSON.stringify(n?.cmd));
proveri("powershell.exe se ODBIJA", odbijeno(n?.powershell), JSON.stringify(n?.powershell));
proveri("navodnici oko putanje ne pomazu", odbijeno(n?.trik), JSON.stringify(n?.trik));

// Zastita ne sme da bude prestroga: igraonica u kojoj se igre ne pokrecu je gora
// od one bez ove provere.
const nijeOdbijeno = (r) => r && !/nije u katalogu/i.test(r.error || "");
proveri("igra IZ kataloga nije odbijena", nijeOdbijeno(n?.izKataloga), JSON.stringify(n?.izKataloga));
proveri("velika i mala slova u putanji su isto", nijeOdbijeno(n?.izKatalogaDrugaVelicina), JSON.stringify(n?.izKatalogaDrugaVelicina));

// Pokusaj mora da ostane zapisan - to nije greska u kucanju nego znak da nesto
// nije u redu na toj masini.
await cekaj(600);
const logovi = (await api("/api/logs?category=sistem")).items || (await api("/api/logs?category=sistem"));
proveri("odbijeno pokretanje ide u Logove",
  (Array.isArray(logovi) ? logovi : []).some((l) => /pokretanje_odbijeno|van kataloga/i.test(l.action + " " + l.detail)),
  "bez zapisa se nikad ne sazna da je neko pokusavao");

try { server.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
