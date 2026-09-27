import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ugasiLaunchere } from "./_okruzenje.mjs";
// POVRATAK VEZE USRED SESIJE NIJE NOVA PRIJAVA
//
// Server se restartuje (nadogradnja, nestanak struje na glavnom racunaru) ili
// ruter trepne - a igrac za to vreme igra. Kad se veza vrati, server salje
// "login_ok" za ISTU sesiju. Launcher je to ranije shvatao kao novu prijavu:
// igrac je usred meca dobijao pozdravnu animaciju "Dobrodosao", korpa mu se
// praznila, a ekran se vracao na pocetnu.
//
// Ovde se to meri na PRAVOM launcheru: prijava, stavka u korpi, otvoren shop -
// pa server gine i vraca se.
//
//   node proba-povratak-veze.mjs
const PORT = 8217;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("povratak-veze-data");
const RADNO = radniFolder("povratak-veze-klijent");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const digniServer = () => spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
  env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: "ignore",
});
const cekajServer = async () => {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status) return true; } catch {}
    await cekaj(200);
  }
  return false;
};

let server = digniServer();
await cekajServer();
const prijava = async () => (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
let token = await prijava();
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "zika", password: "zika1234", displayName: "Žika", balance: 2000 });
const artikal = (await api("/api/shop"))[0];

const IZLAZ = path.join(RADNO, "nalaz.jsonl");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});

const IZLAZ = ${JSON.stringify(IZLAZ.replace(/\\/g, "/"))};
const upisi = (o) => { try { fs.appendFileSync(IZLAZ, JSON.stringify(o) + "\\n"); } catch {} };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let w = null;
  for (let i = 0; i < 80 && !w; i++) {
    w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !(x.webContents.getURL() || "").includes("overlay"));
    if (w && w.webContents.isLoading()) w = null;
    if (!w) await cekaj(300);
  }
  const js = (izraz) => w.webContents.executeJavaScript(izraz).catch((e) => "GRESKA: " + e.message);
  const ekran = () => js('[...document.querySelectorAll(".screen")].find(s => s.classList.contains("active"))?.id');

  for (let i = 0; i < 60; i++) { if ((await ekran()) === "loginScreen") break; await cekaj(500); }
  // Broji se svako puštanje pozdravne animacije.
  await js('window.__pozdrava = 0; const __stari = playBoot; playBoot = function () { window.__pozdrava++; return __stari.apply(this, arguments); }; 1');
  await js('(() => { document.querySelector("#pUser").value = "zika"; document.querySelector("#pPass").value = "zika1234";'
    + ' document.querySelector("#loginForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); return 1; })()');
  await cekaj(3500);
  upisi({ korak: "prijava", ekran: await ekran(), pozdrava: await js("window.__pozdrava") });

  // Igrac je u shopu i ima nesto u korpi.
  await js('(() => { const t = [...document.querySelectorAll(".tab")].find(x => x.dataset.tab === "shop"); t.click(); return 1; })()');
  await cekaj(600);
  await js("S.cart.set(${artikal.id}, 2); S.nacinPlacanja = 'cash'; S.nacinRucno = true; renderContent(); 1");
  await cekaj(300);
  upisi({ korak: "pre-prekida", tab: await js("S.tab"), korpa: await js("S.cart.get(${artikal.id}) || 0") });

  // ---- SERVER GINE ----
  fs.writeFileSync(IZLAZ + ".ubij", "1");
  for (let i = 0; i < 100; i++) { if (!fs.existsSync(IZLAZ + ".ubij")) break; await cekaj(200); }
  for (let i = 0; i < 60; i++) { if ((await js("S.wsOk")) === false) break; await cekaj(250); }
  await cekaj(500);
  upisi({ korak: "bez-veze", ekran: await ekran() });

  // ---- SERVER SE VRAĆA ----
  fs.writeFileSync(IZLAZ + ".digni", "1");
  for (let i = 0; i < 200; i++) { if ((await js("S.wsOk")) === true) break; await cekaj(300); }
  await cekaj(2500);
  upisi({ korak: "posle-povratka",
    ekran: await ekran(),
    pozdrava: await js("window.__pozdrava"),
    tab: await js("S.tab"),
    korpa: await js("S.cart.get(${artikal.id}) || 0"),
    nacin: await js("S.nacinPlacanja"),
    tajmer: await js("!!S.timer"),
    igrac: await js("S.player && S.player.username"),
  });
  app.exit(0);
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-povratak-veze", version: "1.0.0", main: "main.js" }), "utf8");

const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const klijent = spawn(electron, [RADNO], { shell: process.platform === "win32", stdio: "ignore" });

const gotov = () => fs.existsSync(IZLAZ) && fs.readFileSync(IZLAZ, "utf8").includes("posle-povratka");
for (let i = 0; i < 400; i++) {
  if (fs.existsSync(IZLAZ + ".ubij")) {
    try { server.kill(); } catch {}
    await cekaj(1200);
    fs.rmSync(IZLAZ + ".ubij", { force: true });
  }
  if (fs.existsSync(IZLAZ + ".digni")) {
    server = digniServer();
    await cekajServer();
    token = await prijava();
    fs.rmSync(IZLAZ + ".digni", { force: true });
  }
  if (gotov()) break;
  await cekaj(300);
}
await cekaj(500);
try { klijent.kill(); } catch {}
ugasiLaunchere();

const redovi = (() => {
  try { return fs.readFileSync(IZLAZ, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
})();
const korak = (ime) => redovi.find((r) => r.korak === ime);

proveri("launcher se prijavio", korak("prijava")?.ekran === "desktopScreen", JSON.stringify(korak("prijava")));
proveri("pozdrav je pušten jednom, pri prijavi", korak("prijava")?.pozdrava === 1, JSON.stringify(korak("prijava")));
proveri("igrač je u shopu sa korpom", korak("pre-prekida")?.tab === "shop" && korak("pre-prekida")?.korpa === 2, JSON.stringify(korak("pre-prekida")));
proveri("bez veze se vidi ekran povezivanja", korak("bez-veze")?.ekran === "connScreen", JSON.stringify(korak("bez-veze")));

const p = korak("posle-povratka");
proveri("posle povratka veze igrač je opet na svom ekranu", p?.ekran === "desktopScreen", JSON.stringify(p));
proveri("pozdrav se NE ponavlja usred igre", p?.pozdrava === 1, `pušten ${p?.pozdrava} puta`);
proveri("ostaje na istoj kartici (shop)", p?.tab === "shop", p?.tab);
proveri("korpa je sačuvana", p?.korpa === 2, String(p?.korpa));
proveri("izabran način plaćanja je sačuvan", p?.nacin === "cash", p?.nacin);
proveri("odbrojavanje ponovo teče", p?.tajmer === true);
proveri("igrač je i dalje prijavljen", p?.igrac === "zika", p?.igrac);

try { server.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
