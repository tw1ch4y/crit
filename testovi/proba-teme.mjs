// PROBA TEMA na pravom launcheru.
//
// Tema menja ceo launcher: podlogu, ploce, dugmad i pozadinu. Suite proveravaju
// da server pusti samo otkljucanu temu, ali ne i da launcher tu temu stvarno
// nacrta, da je skine kad se igrac odjavi, i da kucna tema iz panela stigne na
// racunar bez restarta. Ovde se to meri na pravom prozoru, a usput se slika
// svaka tema (testovi/.slike-teme/) da se izgled vidi golim okom.
//
//   node proba-teme.mjs
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { KOREN, radniFolder, ugasiLaunchere } from "./_okruzenje.mjs";
import { TEME } from "../server/src/nivoi.js";

const PORT = 8224;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("proba-teme-data");
const RADNO = radniFolder("proba-teme-klijent");
const SLIKE = path.join(KOREN, "testovi", ".slike-teme");
fs.rmSync(SLIKE, { recursive: true, force: true });
fs.mkdirSync(SLIKE, { recursive: true });
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
  body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());

for (const [ime, kat] of [["Counter-Strike 2", "Pucačine"], ["Valorant", "Pucačine"], ["League of Legends", "MOBA"], ["Fortnite", "Battle Royale"]]) {
  await api("/api/games", "POST", { name: ime, path: "C:\\igre\\" + ime + ".exe", category: kat });
}
const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "stefan", password: "stefan1234", displayName: "Stefan", balance: 1500 });
const igrac = (await api("/api/players")).find((p) => p.username === "stefan");
const postaviXp = (xp) => {
  const db = new DatabaseSync(path.join(DATA, "crit.db"));
  db.prepare("UPDATE players SET xp=?, profil=NULL WHERE id=?").run(xp, igrac.id);
  db.close();
};
postaviXp(1500); // drugi nivo: grafit sme, sve ostalo ne

// Launcher i alat razgovaraju preko fajlova: launcher upise zahtev, alat ga
// izvrsi na serveru (koji launcher ne sme da dira) i obrise fajl.
const ZAHTEV = path.join(RADNO, "zahtev.json");
const IZLAZ = path.join(RADNO, "nalazi.json");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const SLIKE = ${JSON.stringify(SLIKE.replace(/\\/g, "/"))};
const ZAHTEV = ${JSON.stringify(ZAHTEV.replace(/\\/g, "/"))};
const TEME = ${JSON.stringify(Object.keys(TEME))};
app.whenReady().then(async () => {
  const nalazi = {};
  let w = null;
  for (let i = 0; i < 80 && !w; i++) {
    w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !(x.webContents.getURL() || "").includes("overlay"));
    if (w && w.webContents.isLoading()) w = null;
    if (!w) await cekaj(300);
  }
  const js = (izraz) => w.webContents.executeJavaScript(izraz).catch((e) => "GRESKA: " + e.message);
  const ekran = () => js('[...document.querySelectorAll(".screen")].find(s => s.classList.contains("active"))?.id');
  const trazi = async (z) => {
    fs.writeFileSync(ZAHTEV, JSON.stringify(z));
    for (let i = 0; i < 50; i++) { if (!fs.existsSync(ZAHTEV)) break; await cekaj(200); }
    await cekaj(700);
  };
  const slikaj = async (ime) => fs.writeFileSync(path.join(SLIKE, ime + ".png"), (await w.webContents.capturePage()).toPNG());
  const stanje = () => js(\`({
    tema: document.body.dataset.tema, pokret: document.body.dataset.pokret,
    brend: getComputedStyle(document.body).getPropertyValue("--brend").trim().toLowerCase(),
    bg: getComputedStyle(document.body).getPropertyValue("--bg").trim().toLowerCase(),
    moja: S.profil && S.profil.izgled ? S.profil.izgled.tema : null,
    anim: getComputedStyle(document.querySelector(".ambijent i")).animationName,
    tabovi: [...document.querySelectorAll(".tab")].map((t) => [t.dataset.tab, t.classList.contains("active"), getComputedStyle(t).backgroundColor]),
  })\`);
  const prijavi = async () => {
    for (let i = 0; i < 60; i++) { if ((await ekran()) === "loginScreen") break; await cekaj(400); }
    await js('(() => { document.querySelector("#pUser").value = "stefan"; document.querySelector("#pPass").value = "stefan1234";'
      + ' document.querySelector("#loginForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); return 1; })()');
    for (let i = 0; i < 40; i++) { if ((await ekran()) === "desktopScreen") break; await cekaj(300); }
    await cekaj(3500);
  };
  const uTeme = async () => {
    await js('(() => { [...document.querySelectorAll(".tab")].find(x => x.dataset.tab === "account").click(); return 1; })()');
    await cekaj(400);
    await js('(() => { document.querySelector(\\'[data-acc-sekcija="teme"]\\').click(); return 1; })()');
    await cekaj(500);
  };
  const izaberi = async (k) => { await js('(() => { const b = document.querySelector(\\'[data-tema="' + k + '"]\\'); if (b) b.click(); return !!b; })()'); await cekaj(700); };
  const pocetna = async () => { await js('(() => { [...document.querySelectorAll(".tab")].find(x => x.dataset.tab === "home").click(); return 1; })()'); await cekaj(900); };

  w.setFullScreen(false); w.setKiosk(false); w.setContentSize(1920, 1080);
  for (let i = 0; i < 60; i++) { if ((await ekran()) === "loginScreen") break; await cekaj(400); }
  await cekaj(1200);
  nalazi.prijavaKuca = await stanje();
  await slikaj("0-prijava-kuca");

  // Pozadina se stvarno krece: polozaj prve mrlje se promeni za dve sekunde.
  const polozaj = () => js('getComputedStyle(document.querySelector(".ambijent i")).transform');
  const p1 = await polozaj(); await cekaj(2500); const p2 = await polozaj();
  nalazi.krece = { p1, p2 };

  // Kucnu temu vlasnik menja iz panela - launcher je dobija uzivo.
  await trazi({ kuca: { tema: "arktik", pokret: "iskljuceno" } });
  nalazi.kucaUzivo = await stanje();
  await slikaj("0-prijava-arktik-mirno");
  await trazi({ kuca: { tema: "kuca", pokret: "lagano" } });

  // ---- drugi nivo ----
  await prijavi();
  await uTeme();
  await slikaj("1-teme-nivo2");
  await izaberi("mit");
  nalazi.zakljucana = await stanje();
  await izaberi("grafit");
  nalazi.grafit = await stanje();

  // Odjava vraca kucnu temu - sledeci igrac ne sme da sedne u tudju.
  await trazi({ odjavi: true, xp: 33000 });
  for (let i = 0; i < 30; i++) { if ((await ekran()) === "loginScreen") break; await cekaj(300); }
  await cekaj(600);
  nalazi.posleOdjave = await stanje();

  // ---- deseti nivo: svaka tema ----
  await prijavi();
  nalazi.teme = {};
  for (const k of TEME) {
    await uTeme();
    await izaberi(k);
    nalazi.teme[k] = await stanje();
    if (k === TEME[TEME.length - 1]) await slikaj("2-teme-sve-otkljucane");
    await pocetna();
    nalazi.teme[k].naPocetnoj = await stanje();
    await slikaj("tema-" + k + "-1920");
  }
  w.setContentSize(1366, 768); await cekaj(800);
  for (const k of ["kuca", "zlato", "obsidijan"]) {
    await uTeme(); await izaberi(k); await pocetna();
    await slikaj("tema-" + k + "-1366");
  }
  await uTeme(); await slikaj("2-teme-1366");
  fs.writeFileSync(${JSON.stringify(IZLAZ.replace(/\\/g, "/"))}, JSON.stringify(nalazi));
  app.exit(0);
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-teme", version: "1.0.0", main: "main.js" }), "utf8");

const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const klijent = spawn(electron, [RADNO], { shell: process.platform === "win32", stdio: "ignore" });
for (let i = 0; i < 1200; i++) {
  if (fs.existsSync(ZAHTEV)) {
    let z = {};
    try { z = JSON.parse(fs.readFileSync(ZAHTEV, "utf8")); } catch {}
    if (z.kuca) await api("/api/izgled-kuce", "POST", z.kuca);
    if (z.odjavi) await api(`/api/computers/${pc.id}/logout`, "POST").catch(() => {});
    if (z.xp != null) postaviXp(z.xp);
    fs.rmSync(ZAHTEV, { force: true });
  }
  if (fs.existsSync(IZLAZ)) break;
  await cekaj(300);
}
try { klijent.kill(); } catch {}
ugasiLaunchere();
try { server.kill(); } catch {}

let pao = 0;
const proveri = (n, u, d = "") => { console.log((u ? "  OK   " : "  PAO  ") + n + (u ? "" : "  -> " + d)); if (!u) pao++; };
let n = null;
try { n = JSON.parse(fs.readFileSync(IZLAZ, "utf8")); } catch {}
proveri("launcher je prosao ceo tok", !!n, "nema nalaza - prozor se zaglavio");
if (n) {
  const J = JSON.stringify;
  proveri("na prijavi stoji kucna tema", n.prijavaKuca?.tema === "kuca", J(n.prijavaKuca));
  proveri("pozadina se lagano krece", n.prijavaKuca?.anim !== "none" && n.krece.p1 !== n.krece.p2, J(n.krece));
  proveri("kucna tema iz panela stize uzivo", n.kucaUzivo?.tema === "arktik" && n.kucaUzivo?.brend === TEME.arktik.boje.akcenat, J(n.kucaUzivo));
  proveri("iskljucen pokret zaustavlja pozadinu", n.kucaUzivo?.pokret === "iskljuceno" && n.kucaUzivo?.anim === "none", J(n.kucaUzivo));
  proveri("zakljucana tema se ne primeni", n.zakljucana?.tema === "kuca" && !n.zakljucana?.moja, J(n.zakljucana));
  proveri("otkljucana tema se primeni klikom", n.grafit?.tema === "grafit" && n.grafit?.moja === "grafit" &&
    n.grafit?.brend === TEME.grafit.boje.akcenat && n.grafit?.bg === TEME.grafit.boje.bg, J(n.grafit));
  proveri("odjava vraca kucnu temu", n.posleOdjave?.tema === "kuca", J(n.posleOdjave));
  for (const [k, t] of Object.entries(TEME)) {
    const s = n.teme?.[k];
    const ak = t.boje.akcenat || "#2f6ae8";
    const rgb = [1, 3, 5].map((i) => parseInt(ak.slice(i, i + 2), 16)).join(", ");
    proveri(`tema ${k}: aktivni tab odmah nosi boju teme`, s?.tabovi?.find((x) => x[1])?.[2] === `rgba(${rgb}, 0.15)`, J(s?.tabovi));
    proveri(`tema ${k} se crta`, s?.tema === k && s?.bg === t.boje.bg && (!t.boje.akcenat || s?.brend === t.boje.akcenat), J(s));
  }
}
console.log("Slike: " + SLIKE);
process.exit(pao ? 1 : 0);
