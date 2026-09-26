import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, citajIzvor } from "./_okruzenje.mjs";
// Vracanje rezervne kopije, ceo krug: podaci -> kopija -> nove izmene ->
// vracanje -> server ponovo -> stanje je ono iz kopije. Vracanje ide istim
// koracima kao VRATI-KOPIJU.bat (obrisi WAL i SHM, prepisi bazu).
const BASE = "http://127.0.0.1:8143";
const DATA = radniFolder("vracanje-data");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

let proces = null;
function pokreni() {
  proces = spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
    env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: "8143" }, stdio: "ignore",
  });
}
async function cekajServer(sekundi = 15) {
  for (let i = 0; i < sekundi * 5; i++) {
    try { const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status) return true; } catch {}
    await cekaj(200);
  }
  return false;
}
async function ugasi() {
  if (!proces) return;
  const p = proces; proces = null;
  await new Promise((res) => { p.once("exit", res); p.kill(); setTimeout(res, 3000); });
  await cekaj(500);
}

let token = "";
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });
const prijaviSe = async () => {
  token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
};

pokreni();
proveri("server se podigao", await cekajServer());
await prijaviSe();

// ---- 1) stanje koje mora da prezivi vracanje ----
await api("/api/players", "POST", { username: "pre", password: "pre12345", displayName: "Pre kopije" });
const pre = (await api("/api/players")).find((p) => p.username === "pre");
await api(`/api/players/${pre.id}/topup`, "POST", { amount: 1000, note: "pre kopije" });
proveri("igrac pre kopije postoji sa 1000", (await api("/api/players")).find((p) => p.id === pre.id).balance === 1000);

// ---- 2) napravi kopiju kroz panel (isti put koji koristi vlasnik) ----
const napravljena = await api("/api/backup", "POST");
await cekaj(600);
const dirKopija = path.join(DATA, "backups");
const kopije = fs.existsSync(dirKopija)
  ? fs.readdirSync(dirKopija).filter((f) => f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(dirKopija, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t).map((x) => x.f)
  : [];
proveri("kopija je napravljena", kopije.length > 0, JSON.stringify(napravljena).slice(0, 120));
const kopija = kopije[kopije.length - 1];
const velicina = kopije.length ? fs.statSync(path.join(dirKopija, kopija)).size : 0;
proveri("kopija nije prazan fajl", velicina > 10000, `${velicina} B`);

// ---- 3) izmene POSLE kopije (one moraju da nestanu) ----
await api(`/api/players/${pre.id}/topup`, "POST", { amount: 5000, note: "posle kopije" });
await api("/api/players", "POST", { username: "posle", password: "posle123", displayName: "Posle kopije" });
proveri("posle kopije: kredit je 6000", (await api("/api/players")).find((p) => p.id === pre.id).balance === 6000);
proveri("posle kopije: novi igrac postoji", !!(await api("/api/players")).find((p) => p.username === "posle"));

// ---- 4) vracanje, tacno kao VRATI-KOPIJU.bat ----
await ugasi();
// Bez brisanja WAL/SHM bi se izmene POSLE kopije vratile preko vracene baze.
for (const f of ["crit.db-wal", "crit.db-shm"]) { try { fs.unlinkSync(path.join(DATA, f)); } catch {} }
fs.copyFileSync(path.join(dirKopija, kopija), path.join(DATA, "crit.db"));

pokreni();
proveri("server radi nad vracenom bazom", await cekajServer());
await prijaviSe();
proveri("prijava na panel radi posle vracanja", !!token);

// ---- 5) stanje je bas ono iz kopije ----
const igraci = await api("/api/players");
const vracen = igraci.find((p) => p.username === "pre");
proveri("igrac iz kopije je tu", !!vracen);
proveri("kredit je vracen na 1000, ne 6000", vracen?.balance === 1000, `kredit ${vracen?.balance}`);
proveri("igrac napravljen POSLE kopije je nestao", !igraci.find((p) => p.username === "posle"),
  "to je i smisao vracanja - sve posle kopije se gubi");

// ---- 6) sistem je i dalje upotrebljiv, ne samo citljiv ----
await api(`/api/players/${vracen.id}/topup`, "POST", { amount: 250, note: "posle vracanja" });
proveri("moze da se radi dalje nad vracenom bazom",
  (await api("/api/players")).find((p) => p.id === vracen.id).balance === 1250);
const kop2 = await api("/api/backup", "POST");
proveri("nova kopija moze da se napravi", !kop2?.error, JSON.stringify(kop2).slice(0, 120));

// Dok je ime imalo tacnost od sekunde, druga kopija u istoj sekundi je pucala
// uz "Backup nije uspeo" - a to se desava kad vlasnik pritisne dugme bas dok
// krece automatska (na 15 min), ili dvaput zaredom.
const brzo = [];
for (let i = 0; i < 4; i++) brzo.push(await api("/api/backup", "POST"));
proveri("cetiri kopije zaredom sve prolaze", brzo.every((r) => !r?.error),
  JSON.stringify(brzo.map((r) => r?.error || "ok")));
const svePosle = fs.readdirSync(dirKopija).filter((f) => f.endsWith(".db"));
proveri("svaka kopija je dobila svoje ime", new Set(svePosle).size === svePosle.length);

// ---- 7) skripta za vracanje ----
const bat = citajIzvor("server/VRATI-KOPIJU.bat");
proveri("skripta ne radi dok server radi", /imagename eq node\.exe/.test(bat),
  "inace bi server pisao preko tek vracene baze");
proveri("skripta cuva trenutnu bazu pre nego sto je pregazi", /pre-vracanja/.test(bat));
proveri("skripta brise WAL i SHM", /crit\.db-wal/.test(bat) && /crit\.db-shm/.test(bat));
proveri("skripta trazi potvrdu", /DA/.test(bat));

// ---- 8) kopije se ne gomilaju bez kraja ----
//
// I rucno napravljena kopija pokrece sredjivanje starih (pravila cuvanja su u
// test-skladiste). Ide kroz pravi server: ovaj proces nema CRIT_DATA_DIR, pa bi
// uvoz modula radio nad server/data.
{
  const dir = path.join(DATA, "backups");
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 40; i++) {
    const kada = Date.now() - (3 * 3600000 + i * 900000); // starije od 3 sata, isti dan
    const p = path.join(dir, `crit-${new Date(kada).toISOString().replace(/[:.]/g, "-").slice(0, 23)}.db`);
    fs.writeFileSync(p, Buffer.alloc(512));
    fs.utimesSync(p, kada / 1000, kada / 1000);
  }
  const nagomilano = fs.readdirSync(dir).length;
  proveri("kopije su se nagomilale za probu", nagomilano >= 40, String(nagomilano));
  await api("/api/backup", "POST");
  const posle = fs.readdirSync(dir).length;
  proveri("pravljenje kopije samo sredi visak", posle < nagomilano,
    `${nagomilano} -> ${posle}; bez toga bi se gomilalo dok disk ne stane`);
}

await ugasi();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
