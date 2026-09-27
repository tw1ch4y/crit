// PREGLED PROFILA IGRAČA na pravom launcheru.
//
// Pregled svih ekrana (pregled-electron.mjs) ulazi u Nalog sa igračem bez
// istorije, pa se profil nikad ne vidi onakav kakav je posle meseca dolazaka.
// Ovde igrač ima iskustvo, sesije, porudžbine i omiljenu igru, pa se slika ono
// što stalni gost stvarno gleda - na 1920x1080 i 1366x768, i za tri nivoa.
//
//   node pregled-profila.mjs            slike u .slike-profil/
//   node pregled-profila.mjs --xp 9000  samo jedan nivo
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { KOREN, radniFolder, ugasiLaunchere } from "./_okruzenje.mjs";

const arg = (ime, p) => { const i = process.argv.indexOf("--" + ime); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : p; };
const PORT = 8223;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("pregled-profila-data");
const RADNO = radniFolder("pregled-profila-klijent");
const SLIKE = path.join(KOREN, "testovi", ".slike-profil");
fs.rmSync(SLIKE, { recursive: true, force: true });
fs.mkdirSync(SLIKE, { recursive: true });
const NIVOI = arg("xp", "300,4200,33000").split(",").map(Number);
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
const igre = await api("/api/games");

// Istorija kakvu ima stalni gost: upisuje se pravo u bazu, jer se kroz launcher
// mesec dolazaka ne može odigrati za minut.
{
  const db = new DatabaseSync(path.join(DATA, "crit.db"));
  const sad = Date.now(), D = 86400000;
  const ins = db.prepare("INSERT INTO sessions (player_id, computer_id, started_at, ended_at, cost, status) VALUES (?,?,?,?,?, 'ended')");
  for (let i = 0; i < 23; i++) ins.run(igrac.id, pc.id, sad - (i + 1) * D, sad - (i + 1) * D + 7200000, 240);
  const gl = db.prepare("INSERT INTO game_launches (game_id, player_id, computer_id, at) VALUES (?,?,?,?)");
  for (let i = 0; i < 30; i++) gl.run(igre[i % 5 === 0 ? 1 : 0].id, igrac.id, pc.id, sad - i * D);
  const o = db.prepare("INSERT INTO orders (player_id, computer_id, total, status, payment, source, created_at) VALUES (?,?,?,?,?,?,?)");
  for (let i = 0; i < 17; i++) o.run(igrac.id, pc.id, 130, "delivered", "credit", "client", sad - i * D);
  db.prepare("UPDATE players SET created_at=? WHERE id=?").run(sad - 70 * D, igrac.id);
  db.close();
}

const IZLAZ = path.join(RADNO, "gotovo.txt");
const ZAHTEV = path.join(RADNO, "xp.txt");
fs.writeFileSync(path.join(RADNO, "podesavanja.json"), JSON.stringify({ host: BASE, servisniPin: "1234" }), "utf8");
fs.writeFileSync(path.join(RADNO, "config.json"), JSON.stringify({ host: BASE, token: pc.token, configured: true }), "utf8");
fs.copyFileSync(path.join(KOREN, "client", "preload.js"), path.join(RADNO, "preload.js"));
fs.writeFileSync(path.join(RADNO, "main.js"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
app.setPath("userData", ${JSON.stringify(RADNO.replace(/\\/g, "/"))});
process.argv.push("--no-lock");
require(${JSON.stringify(path.join(KOREN, "client", "main.js").replace(/\\/g, "/"))});
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const SLIKE = ${JSON.stringify(SLIKE.replace(/\\/g, "/"))};
const NIVOI = ${JSON.stringify(NIVOI)};
app.whenReady().then(async () => {
  let w = null;
  for (let i = 0; i < 80 && !w; i++) {
    w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !(x.webContents.getURL() || "").includes("overlay"));
    if (w && w.webContents.isLoading()) w = null;
    if (!w) await cekaj(300);
  }
  const js = (izraz) => w.webContents.executeJavaScript(izraz).catch((e) => "GRESKA: " + e.message);
  const ekran = () => js('[...document.querySelectorAll(".screen")].find(s => s.classList.contains("active"))?.id');
  for (const xp of NIVOI) {
    // XP postavlja alat (fajl), pa se igrac prijavljuje iznova da dobije svez profil.
    fs.writeFileSync(${JSON.stringify(ZAHTEV.replace(/\\/g, "/"))}, String(xp));
    for (let i = 0; i < 50; i++) { if (!fs.existsSync(${JSON.stringify(ZAHTEV.replace(/\\/g, "/"))})) break; await cekaj(200); }
    for (let i = 0; i < 60; i++) { if ((await ekran()) === "loginScreen") break; await cekaj(400); }
    await js('(() => { document.querySelector("#pUser").value = "stefan"; document.querySelector("#pPass").value = "stefan1234";'
      + ' document.querySelector("#loginForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); return 1; })()');
    await cekaj(3800);
    await js('(() => { const t = [...document.querySelectorAll(".tab")].find(x => x.dataset.tab === "account"); t.click(); return 1; })()');
    await cekaj(500);
    await js('(() => { const b = document.querySelector(\\'[data-acc-sekcija="profil"]\\'); if (b) b.click(); return 1; })()');
    await cekaj(900);
    for (const [sw, sh] of [[1920, 1080], [1366, 768]]) {
      w.setFullScreen(false); w.setKiosk(false); w.setContentSize(sw, sh); await cekaj(700);
      const mere = await js(\`(() => {
        const s = document.querySelector(".acc-sadrzaj"); const r = s ? s.getBoundingClientRect() : null;
        const sb = document.querySelector(".statusbar, .sb, #statusBar");
        return { sadrzaj: r ? { h: Math.round(r.height), sh: s.scrollHeight, ch: s.clientHeight } : null, prozor: innerHeight };
      })()\`);
      const slika = await w.webContents.capturePage();
      fs.writeFileSync(path.join(SLIKE, "profil-xp" + xp + "-" + sw + "x" + sh + ".png"), slika.toPNG());
      fs.appendFileSync(path.join(SLIKE, "mere.jsonl"), JSON.stringify({ xp, rez: sw + "x" + sh, mere }) + "\\n");
    }
    // Klik na boju i okvir, kao igrač. Na niskom nivou mora da ostane odbijeno.
    await js('(() => { document.querySelector(\"[data-pf-boja=roze]\").click(); return 1; })()');
    await cekaj(900);
    await js('(() => { const b = document.querySelector(\"[data-pf-okvir=puls]\"); if (b) b.click(); return 1; })()');
    await cekaj(900);
    const klik = await js(\`({
      boja: S.profil && S.profil.izgled.boja,
      okvir: S.profil && S.profil.izgled.okvir,
      imeGlava: getComputedStyle(document.querySelector(".acc-name")).color,
      imeTraka: getComputedStyle(document.querySelector("#hudName")).color,
      znakOkvir: document.querySelector(".acc-hero .pf-znak").className,
    })\`);
    fs.appendFileSync(path.join(SLIKE, "klik.jsonl"), JSON.stringify({ xp, klik }) + "\\n");
  }
  fs.writeFileSync(${JSON.stringify(IZLAZ.replace(/\\/g, "/"))}, "1");
  app.exit(0);
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "pregled-profila", version: "1.0.0", main: "main.js" }), "utf8");

const electron = path.join(KOREN, "client", "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
const klijent = spawn(electron, [RADNO], { shell: process.platform === "win32", stdio: "ignore" });
for (let i = 0; i < 600; i++) {
  if (fs.existsSync(ZAHTEV)) {
    const xp = Number(fs.readFileSync(ZAHTEV, "utf8"));
    // Odjavi igraca ako je jos prijavljen (da nova prijava donese svez profil).
    await api(`/api/computers/${pc.id}/logout`, "POST").catch(() => {});
    const db = new DatabaseSync(path.join(DATA, "crit.db"));
    db.prepare("UPDATE players SET xp=?, profil=? WHERE id=?").run(xp, xp > 5400 ? JSON.stringify({ boja: "zlatna", okvir: "zlatni" }) : xp > 3000 ? JSON.stringify({ boja: "plava", okvir: "nema" }) : null, igrac.id);
    db.close();
    fs.rmSync(ZAHTEV, { force: true });
  }
  if (fs.existsSync(IZLAZ)) break;
  await cekaj(300);
}
try { klijent.kill(); } catch {}
ugasiLaunchere();
try { server.kill(); } catch {}
console.log("Slike: " + SLIKE);
// ---- provera klikova ----
let pao = 0;
const proveri = (n, u, d = "") => { console.log((u ? "  OK   " : "  PAO  ") + n + (u ? "" : "  -> " + d)); if (!u) pao++; };
const kliknuto = (() => { try { return fs.readFileSync(path.join(SLIKE, "klik.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } })();
const nizak = kliknuto.find((k) => k.xp < 3000);
const visok = kliknuto.find((k) => k.xp >= 5400);
if (nizak) proveri("zaključana boja se ne može izabrati", nizak.klik.boja === "bela", JSON.stringify(nizak.klik));
if (visok) {
  proveri("otključana boja se bira klikom", visok.klik.boja === "roze", JSON.stringify(visok.klik));
  proveri("otključan okvir se bira klikom", visok.klik.okvir === "puls", JSON.stringify(visok.klik));
  proveri("ime u glavi naloga dobija boju", /255, 122, 192/.test(visok.klik.imeGlava), visok.klik.imeGlava);
  proveri("ime u gornjoj traci dobija boju", /255, 122, 192/.test(visok.klik.imeTraka), visok.klik.imeTraka);
  proveri("znak u glavi dobija okvir", /okvir-puls/.test(visok.klik.znakOkvir), visok.klik.znakOkvir);
}
for (const red of fs.readFileSync(path.join(SLIKE, "mere.jsonl"), "utf8").trim().split("\n")) {
  const m = JSON.parse(red);
  const s = m.mere?.sadrzaj;
  proveri(`profil staje bez skrolovanja (${m.rez}, ${m.xp} XP)`, s && s.sh <= s.ch + 2, JSON.stringify(s));
}
process.exit(pao ? 1 : 0);
