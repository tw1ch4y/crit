// Tok porudzbine kroz launcher, od klika do "poruceno" - u pravom Electronu i
// preko PRAVOG WebSocketa ka serveru, ne kroz lazni most.
//
// Do sada je porudzbina bila proverena samo sa strane servera. Ovde se klikce
// ono sto igrac stvarno klikce: dugme "Dodaj", izbor kes/kredit, "Poruci" -
// i onda se gleda sta je stiglo u bazu i sta je igrac video na ekranu.
//
//   node proba-porudzbine.mjs            (server na 8096)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { putanjaElektrona } from "./_okruzenje.mjs";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const PORT = process.argv[2] || "8096";
const RADNO = path.join(OVDE, ".radno", "proba-porudzbine");
const SLIKE = path.join(OVDE, ".slike-porudzbina");

fs.rmSync(RADNO, { recursive: true, force: true });
fs.mkdirSync(RADNO, { recursive: true });
fs.rmSync(SLIKE, { recursive: true, force: true });
fs.mkdirSync(SLIKE, { recursive: true });

const MAIN = `
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const WebSocket = require(${JSON.stringify(path.join(KOREN, "server", "node_modules", "ws"))});

const RENDERER = ${JSON.stringify(path.join(KOREN, "client", "renderer"))};
const IZLAZ = ${JSON.stringify(SLIKE)};
const BAZA = "http://127.0.0.1:${PORT}";
const WSB = "ws://127.0.0.1:${PORT}";

process.on("uncaughtException", (e) => { console.log("PUKLO: " + (e && e.stack || e)); app.exit(1); });
process.on("unhandledRejection", (e) => { console.log("ODBIJENO: " + (e && e.stack || e)); app.exit(1); });
app.on("window-all-closed", () => {});
app.disableHardwareAcceleration();

const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

// Most ka serveru je PRAVI: sve sto launcher posalje ide na WebSocket, i sve
// sto server vrati stize u prozor. Tako se meri pravi tok, ne simulacija.
let ws = null, win = null;
const stigle = [];
ipcMain.handle("to-server", (e, poruka) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(poruka)); return true; });
ipcMain.handle("program-icon", async () => null);
ipcMain.handle("get-config", () => ({ host: BAZA, token: "x", configured: true }));
ipcMain.handle("sys-stats", () => ({ cpu: 23, ramUsedPct: 46, ramGb: "16", temp: 41, uptime: 7200 }));
for (const k of ["save-config", "reset-config", "launch-game", "open-browser", "focus-launcher",
  "admin-exit", "renderer-ready", "podesavanja-citaj", "podesavanja-primeni", "verzija", "proveri-servisni-pin", "otkljucaj-bez-servera"])
  ipcMain.handle(k, () => true);

const klik = (sel) => win.webContents.executeJavaScript(
  \`(() => { const e = document.querySelector(\\\`\${sel}\\\`); if (!e) return false; e.click(); return true; })()\`);
const vidi = (izraz) => win.webContents.executeJavaScript(izraz);
const slikaj = async (ime) => {
  try { fs.writeFileSync(path.join(IZLAZ, ime + ".png"), (await win.webContents.capturePage()).toPNG()); } catch {}
};

app.whenReady().then(async () => {
  const prijava = await fetch(BAZA + "/api/login", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json());
  const H = { "content-type": "application/json", authorization: "Bearer " + prijava.token };
  const api = (p, m = "GET", b) => fetch(BAZA + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());

  const racunari = await api("/api/computers");
  const racunar = racunari[0];

  // Racunar se PRVO oslobadja. Ako je na njemu ostala sesija od ranije probe,
  // server na prijavu novog igraca vrati staru sesiju (zastita od duple
  // prijave) - pa bi ceo test merio tudje porudzbine i delovalo bi da kredit
  // ne radi. Tako je i palo prvi put.
  await api(\`/api/computers/\${racunar.id}/logout\`, "POST").catch(() => null);
  await cekaj(400);

  // Igraci iz ranijih proba se ciste, da se ne gomilaju u bazi.
  const stari = (await api("/api/players?page=1&per=200")).items.filter((p) => /^proba\\d+$/.test(p.username));
  for (const p of stari) await api(\`/api/players/\${p.id}\`, "DELETE").catch(() => null);

  // Igrac sa tacno odredjenim kreditom, da se moze proveriti koliko je skinuto.
  const ime = "proba" + Date.now().toString().slice(-6);
  const igrac = await api("/api/players", "POST", { username: ime, password: "proba1234", balance: 1000 });

  win = new BrowserWindow({ width: 1600, height: 900, show: true, frame: false,
    webPreferences: { preload: path.join(RENDERER, "..", "preload.js"), contextIsolation: true } });
  await win.loadFile(path.join(RENDERER, "index.html"));
  win.setContentSize(1600, 900);

  ws = new WebSocket(WSB + "/ws?kind=client&token=" + encodeURIComponent(racunar.token));
  ws.on("message", (b) => {
    let m; try { m = JSON.parse(b.toString()); } catch { return; }
    stigle.push(m);
    win.webContents.send("server-msg", m);
  });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  win.webContents.send("ws-status", { connected: true });
  await cekaj(700);

  const nalazi = [];
  const beleska = (korak, ok, detalj) => nalazi.push({ korak, ok, detalj });

  // ---- prijava igraca, kroz sam launcher ----
  await win.webContents.executeJavaScript(
    \`(() => { document.querySelector("#pUser").value = "\${ime}";
       document.querySelector("#pPass").value = "proba1234";
       document.querySelector("#loginForm2, #pForm, form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
       return true; })()\`).catch(() => null);
  await cekaj(2500);
  const naPocetnoj = await vidi(\`[...document.querySelectorAll(".screen")].find(s => s.classList.contains("active"))?.id\`);
  beleska("igrac se prijavio kroz launcher", naPocetnoj === "desktopScreen", naPocetnoj);
  if (naPocetnoj !== "desktopScreen") { console.log("NALAZI " + JSON.stringify(nalazi)); return app.quit(); }

  // ---- shop ----
  await klik('.tab[data-tab="shop"]');
  await cekaj(800);
  await slikaj("1-shop-prazna-korpa");

  const prvoPice = await vidi(\`(() => { const b = document.querySelector("[data-add]");
    if (!b) return null; const k = b.closest(".pice"); return { id: b.dataset.add, ime: k?.querySelector(".pice-ime")?.textContent }; })()\`);
  beleska("shop ima dugme za dodavanje", !!prvoPice, JSON.stringify(prvoPice));

  // ---- dodavanje u korpu ----
  await klik("[data-add]");
  await cekaj(400);
  await cekaj(500);
  // Kad pice udje u korpu, kartica zameni dugme "Dodaj" brojacem -/1/+.
  // Zato se druga kolicina dodaje PLUSOM, ne ponovnim "Dodaj" - prvi pokusaj
  // ovog testa je klikao "Dodaj" dvaput i dobio dva RAZLICITA pica, jer je
  // prvi [data-add] u redosledu vec bio zamenjen brojacem.
  const posleDodavanja = await vidi(\`(() => ({
    imaBrojac: !!document.querySelector(".pice.izabrano [data-inc]"),
    imaDodaj: !!document.querySelector(".pice.izabrano [data-add]"),
    znacka: document.querySelector(".pice.izabrano .pice-broj")?.textContent,
  }))()\`);
  beleska("kartica pica pokazuje brojac kad je u korpi",
    posleDodavanja.imaBrojac && !posleDodavanja.imaDodaj, JSON.stringify(posleDodavanja));

  await klik(".pice.izabrano [data-inc]");
  await cekaj(500);
  const korpa = await vidi(\`(() => ({
    redova: document.querySelectorAll(".cart-row").length,
    kolicina: document.querySelector(".cart-qty b")?.textContent,
    ukupno: document.querySelector(".cart-total span:last-child")?.textContent,
    dugme: !!document.querySelector("#orderBtn"),
  }))()\`);
  beleska("plus daje kolicinu 2 u istom redu", korpa.redova === 1 && korpa.kolicina === "2", JSON.stringify(korpa));
  await slikaj("2-korpa-sa-picem");

  // ---- izbor nacina placanja ----
  const nacini = await vidi(\`(() => [...document.querySelectorAll("[data-nacin]")].map(b => ({
    nacin: b.dataset.nacin, aktivan: b.classList.contains("aktivan"), ugasen: b.disabled })))()\`);
  beleska("nude se oba nacina placanja", nacini.length === 2, JSON.stringify(nacini));
  beleska("kredit je ponudjen jer igrac ima para", nacini.find(n => n.nacin === "credit" && !n.ugasen) != null, JSON.stringify(nacini));

  await klik('[data-nacin="cash"]');
  await cekaj(300);
  const posleKes = await vidi(\`document.querySelector('[data-nacin="cash"]')?.classList.contains("aktivan")\`);
  beleska("izbor kesa se vidi na dugmetu", posleKes === true, String(posleKes));
  await slikaj("3-izabran-kes");

  await klik('[data-nacin="credit"]');
  await cekaj(300);

  // ---- slanje ----
  stigle.length = 0;
  await klik("#orderBtn");
  await cekaj(1500);
  const odgovor = stigle.find((m) => m.t === "order_ok" || m.t === "order_err");
  beleska("server je primio porudzbinu", odgovor?.t === "order_ok", JSON.stringify(odgovor));
  await slikaj("4-poruceno");

  // ---- sta je stvarno upisano ----
  const porudzbine = await api("/api/orders?all=1");
  const moja = porudzbine.find((o) => o.player === ime);
  beleska("porudzbina je upisana u bazu", !!moja, JSON.stringify(moja && { id: moja.id, total: moja.total, payment: moja.payment }));
  beleska("nacin placanja je zapamcen kao kredit", moja?.payment === "credit", moja?.payment);

  const igracPosle = (await api("/api/players?page=1&per=200")).items.find((p) => p.id === igrac.id);
  const skinuto = 1000 - (igracPosle?.balance ?? 1000);
  // Uz porudzbinu se skida i vreme sesije - igrac je prijavljen dok test traje,
  // pa se naplacuje po satu. Na par sekundi to je nekoliko para. Zato se gleda
  // da je skinut CEO iznos porudzbine i da visak nije veci od te sitnine.
  const visak = skinuto - (moja?.total ?? 0);
  beleska("kredit je skinut za ceo iznos porudzbine", moja != null && visak >= -0.01 && visak < 5,
    \`skinuto \${skinuto.toFixed(2)}, porudzbina \${moja?.total}, razlika \${visak.toFixed(2)} (vreme sesije)\`);

  // ---- korpa se prazni, igrac vidi porudzbinu na nalogu ----
  const korpaPosle = await vidi(\`document.querySelectorAll(".cart-row").length\`);
  beleska("korpa se ispraznila posle slanja", korpaPosle === 0, String(korpaPosle));

  // ---- TRAKA U SHOP-U PRATI STVARNO STANJE ----
  //
  // Igrac koji poruci obicno OSTANE u Shop-u. Dok se na promenu statusa crtao
  // samo Nalog, traka je i posle donetog pica pisala "sprema se", a ispravila bi
  // se tek kad igrac izadje sa strane i vrati se. Ekran koji lazi o necemu sto
  // igrac ceka je gori od ekrana bez podatka.
  const trakaPosle = await vidi(\`document.querySelector(".shop-traka")?.textContent?.replace(/\\\\s+/g," ").trim()\`);
  beleska("traka u Shop-u se pojavila posle porudzbine", /primljena|sprema/i.test(trakaPosle || ""), String(trakaPosle));
  if (moja) {
    await api(\`/api/orders/\${moja.id}/status\`, "POST", { status: "preparing" });
    await cekaj(900);
    const uToku = await vidi(\`document.querySelector(".shop-traka")?.textContent?.replace(/\\\\s+/g," ").trim()\`);
    beleska("traka prati promenu statusa BEZ izlaska sa strane", /sprema/i.test(uToku || ""), String(uToku));
  }

  await klik('.tab[data-tab="account"]');
  await cekaj(900);
  const naNalogu = await vidi(\`(() => ({
    redova: document.querySelectorAll(".por-red").length,
    tekst: document.querySelector(".por-red")?.textContent?.replace(/\\\\s+/g, " ").trim().slice(0, 70),
    znacka: document.querySelector(".tab-znacka")?.textContent,
  }))()\`);
  beleska("porudzbina se vidi na Nalogu", naNalogu.redova > 0, JSON.stringify(naNalogu));
  beleska("znacka na tabu broji porudzbinu", naNalogu.znacka === "1", String(naNalogu.znacka));
  await slikaj("5-nalog-sa-porudzbinom");

  // ---- osoblje menja status, igrac to vidi ----
  if (moja) {
    stigle.length = 0;
    await api(\`/api/orders/\${moja.id}/status\`, "POST", { status: "delivered" });
    await cekaj(1200);
    const javljeno = stigle.find((m) => m.t === "order_status" || m.t === "moje_porudzbine");
    beleska("promena statusa stize igracu", !!javljeno, JSON.stringify(stigle.map(m => m.t)));
    const statusNaEkranu = await vidi(\`document.querySelector(".por-status")?.textContent?.trim()\`);
    beleska("novi status se vidi na ekranu", /Doneto/i.test(statusNaEkranu || ""), String(statusNaEkranu));
    await slikaj("6-status-doneto");
  }

  // ---- placanje kesom ne dira kredit ----
  const preKesa = (await api("/api/players?page=1&per=200")).items.find((p) => p.id === igrac.id).balance;
  await klik('.tab[data-tab="shop"]');
  await cekaj(700);
  await klik("[data-add]");
  await cekaj(300);
  await klik('[data-nacin="cash"]');
  await cekaj(300);
  stigle.length = 0;
  await klik("#orderBtn");
  await cekaj(1500);
  const posleKesa = (await api("/api/players?page=1&per=200")).items.find((p) => p.id === igrac.id).balance;
  // I ovde se u medjuvremenu naplati vreme sesije, pa se gleda da NIJE skinut
  // iznos porudzbine (najjeftinije pice je nekoliko desetina dinara).
  beleska("kesom se kredit NE skida", preKesa - posleKesa < 5, \`pre \${preKesa}, posle \${posleKesa}\`);
  const sve = await api("/api/orders?all=1");
  const kesPorudzbina = sve.filter((o) => o.player === ime).find((o) => o.payment === "cash");
  beleska("kes porudzbina je upisana kao kes", !!kesPorudzbina, JSON.stringify(kesPorudzbina && { id: kesPorudzbina.id, payment: kesPorudzbina.payment }));

  // ---- pociscenje ----
  // Prvo odjava sa racunara: igrac sa aktivnom sesijom ne moze da se obrise,
  // pa bi inace ostajao u bazi i sledeca proba bi se prijavila kao on.
  await api(\`/api/computers/\${racunar.id}/logout\`, "POST").catch(() => null);
  await cekaj(500);
  await api(\`/api/players/\${igrac.id}\`, "DELETE").catch(() => null);

  win.destroy();
  console.log("NALAZI " + JSON.stringify(nalazi));
  app.quit();
});
`;

fs.writeFileSync(path.join(RADNO, "main.js"), MAIN, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-porudzbine", version: "1.0.0", main: "main.js" }, null, 2), "utf8");

const electron = putanjaElektrona();
const p = spawn(electron, [RADNO]);
let izlaz = "";
p.stdout.on("data", (d) => (izlaz += d));
p.stderr.on("data", (d) => (izlaz += d));
p.on("close", (kod) => {
  const m = /NALAZI (\[.*\])/s.exec(izlaz);
  if (!m) {
    console.error(izlaz.split("\n").filter((l) => l.trim() && !/Deprecation|trace-dep/.test(l)).slice(-14).join("\n"));
    process.exit(kod || 1);
  }
  const nalazi = JSON.parse(m[1]);
  console.log("TOK PORUDZBINE KROZ LAUNCHER\n");
  let pao = 0;
  for (const n of nalazi) {
    if (!n.ok) pao++;
    console.log(`  ${n.ok ? "OK  " : "PAO "} ${n.korak}`);
    if (!n.ok) console.log(`         -> ${n.detalj}`);
  }
  console.log(`\nslike: testovi/.slike-porudzbina/`);
  console.log(pao ? `${pao} od ${nalazi.length} koraka ne radi` : `svih ${nalazi.length} koraka radi`);
  process.exit(pao ? 1 : 0);
});
