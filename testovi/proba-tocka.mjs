import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, ugasiLaunchere, putanjaElektrona } from "./_okruzenje.mjs";
// NAGRADNI TOCAK: DA SE VIDI DA JE NAGRADA STIGLA NA NALOG
//
// Vlasnik je pri probi zavrteo tocak i javio da NE VIDI da mu je nagrada
// dodata. Kredit jeste bio dodat - server ga upisuje ispravno - ali se to nije
// videlo, i to iz preciznog razloga:
//
// server posalje novo stanje ODMAH, a tocak se vrti pet sekundi. Kredit se
// zato menjao usred vrtnje, pre nego sto igrac sazna sta je dobio. Kad se
// nagrada konacno objavi, brojka se vise ne pomera - pa deluje da nista nije
// dodato.
//
// Ovo se ne moze proveriti iz koda: trazi pravi Electron, pravu animaciju i
// merenje KADA se brojka promenila u odnosu na trenutak objave nagrade.
//
//   node proba-tocka.mjs
const PORT = 8197;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("tocak-data");
const RADNO = radniFolder("tocak-klijent");

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

// Tocak sa nagradama koje SVE nose kredit - da ishod ne zavisi od srece.
await api("/api/tocak", "POST", { ukljucen: true, prag: 0 });
const cfg = await api("/api/tocak");
for (const n of cfg.nagrade || []) await api(`/api/tocak/nagrade/${n.id}`, "DELETE");
const NAGRADA = 250;
await api("/api/tocak/nagrade", "POST", { naziv: `${NAGRADA} din`, kredit: NAGRADA, tezina: 1 });

const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");
const POCETNO = 1000;
await api(`/api/players/${mile.id}/topup`, "POST", { amount: POCETNO, note: "keš" });

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

  const nalaz = { ekran: await ekran() };

  // Prati kredit u HUD-u kroz vreme, sa vremenskom oznakom svake promene.
  await js(\`(() => {
    window.__trag = [];
    const el = document.querySelector("#hudBal");
    window.__t0 = performance.now();
    window.__pratilac = setInterval(() => {
      const v = (el.textContent || "").replace(/[^0-9]/g, "");
      const z = window.__trag[window.__trag.length - 1];
      if (!z || z.v !== v) window.__trag.push({ v, t: Math.round(performance.now() - window.__t0) });
    }, 40);
    return 1;
  })()\`);

  // Do tocka se ide onako kako ide i igrac: Nalog > Nagrade > Zavrti tocak.
  await js('(() => { const t = [...document.querySelectorAll(".tab")].find(x => x.dataset.tab === "account"); t.click(); return 1; })()');
  await new Promise((r) => setTimeout(r, 700));
  nalaz.meni = await js('[...document.querySelectorAll(".acc-mi")].map(b => b.textContent.trim()).join("|")');
  await js('(() => { const b = document.querySelector(\\'[data-acc-sekcija="nagrade"]\\'); if (b) b.click(); return 1; })()');
  await new Promise((r) => setTimeout(r, 700));
  nalaz.otvaranje = await js('(() => { const b = document.querySelector("#nagZavrti"); if (!b) return "nema dugmeta u odeljku";'
    + ' b.click(); return "kliknuto"; })()');
  await new Promise((r) => setTimeout(r, 800));

  nalaz.imaSpin = await js('!!document.querySelector("#tocakSpin")');
  await js('(() => { const b = document.querySelector("#tocakSpin"); if (b) b.click(); return 1; })()');

  // Zabelezi kada se nagrada OBJAVILA (tekst o dobitku se pojavi).
  await js(\`(() => {
    window.__objava = null;
    window.__cekac = setInterval(() => {
      const d = document.querySelector(".tocak-dobitak");
      if (d && !window.__objava) window.__objava = Math.round(performance.now() - window.__t0);
    }, 40);
    return 1;
  })()\`);

  await new Promise((r) => setTimeout(r, 9000));
  nalaz.trag = await js("JSON.stringify(window.__trag)");
  nalaz.objava = await js("window.__objava");
  nalaz.tekstDobitka = await js('(document.querySelector(".tocak-dobitak") || {}).textContent || ""');
  nalaz.hud = await js('(document.querySelector("#hudBal") || {}).textContent || ""');
  nalaz.letelo = await js('!!window.__letelo');
  try { fs.writeFileSync(${JSON.stringify(IZLAZ.replace(/\\/g, "/"))}, JSON.stringify(nalaz)); } catch {}
  app.exit(0);
});
`, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-tocka", version: "1.0.0", main: "main.js" }), "utf8");

const electron = putanjaElektrona();
const klijent = spawn(electron, [RADNO], { stdio: "ignore" });
for (let i = 0; i < 120; i++) { if (fs.existsSync(IZLAZ)) break; await cekaj(500); }
const nalaz = (() => { try { return JSON.parse(fs.readFileSync(IZLAZ, "utf8")); } catch { return null; } })();

proveri("launcher se prijavio", nalaz?.ekran === "desktopScreen", JSON.stringify(nalaz)?.slice(0, 160));
proveri("točak se otvorio", !!nalaz?.imaSpin, `otvaranje: ${nalaz?.otvaranje}`);

const trag = (() => { try { return JSON.parse(nalaz.trag); } catch { return []; } })();
const objava = Number(nalaz?.objava);
proveri("nagrada je objavljena", Number.isFinite(objava) && objava > 0, String(nalaz?.objava));
proveri("piše koliko je osvojeno", /250/.test(nalaz?.tekstDobitka || ""), nalaz?.tekstDobitka);

// SUSTINA: kredit se sme promeniti TEK kad se nagrada objavi.
const promene = trag.filter((x) => Number(x.v) >= POCETNO + NAGRADA);
const prvaSaNagradom = promene.length ? promene[0].t : null;
proveri("kredit je stvarno narastao za nagradu", prvaSaNagradom != null,
  `HUD: ${nalaz?.hud}, trag: ${(nalaz?.trag || "").slice(0, 200)}`);
proveri("kredit se NIJE promenio pre objave nagrade", prvaSaNagradom == null || prvaSaNagradom >= objava - 300,
  `kredit skočio u ${prvaSaNagradom} ms, a nagrada objavljena u ${objava} ms - igrač je promenu video pre nego što je saznao šta je dobio`);

// I server mora da se slaze sa onim sto HUD pokazuje.
const stanje = (await api("/api/players")).find((p) => p.id === mile.id).balance;
proveri("server je zaista dodao nagradu", stanje >= POCETNO + NAGRADA - 20, `stanje ${stanje}`);

const src = fs.readFileSync(path.join(KOREN, "client", "renderer", "js", "launcher.js"), "utf8");
proveri("stanje se zadržava dok se točak vrti", /if \(S\.tocakVrti\) \{ S\.tocakStanje = /.test(src));
proveri("iznos odleti sa točka na kredit", /function letiNaKredit/.test(src),
  "bez toga su nagrada i stanje dve nepovezane stvari na ekranu");
proveri("točak ima zalet pre vrtnje", /_tocakUgao - 14/.test(src),
  "start iz mesta izgleda kao da je ishod unapred izabran");

try { klijent.kill(); } catch {}
ugasiLaunchere();
try { server.kill(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(600);
process.exit(pao ? 1 : 0);
