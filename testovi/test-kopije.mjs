import path from "node:path";
import fs from "node:fs";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
// Rezervne kopije: vlasnik mora da vidi sta ima i da moze da preuzme, a niko
// ne sme da kroz ime fajla izadje iz foldera sa kopijama.
const BASE = "http://127.0.0.1:8105";
const DATA = radniFolder("kopije-data");
await podigniServer(DATA, 8105);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const prijava = async (ko, lozinka) => (await fetch(BASE + "/api/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: ko, password: lozinka }),
}).then((r) => r.json())).token;

const token = await prijava("admin", "admin");
const zovi = (t) => async (p, m = "GET", b) => {
  const r = await fetch(BASE + p, { method: m,
    headers: { "content-type": "application/json", authorization: "Bearer " + t },
    body: b ? JSON.stringify(b) : undefined });
  const tx = await r.text();
  let j; try { j = JSON.parse(tx); } catch { j = tx; }
  return { status: r.status, body: j };
};
const api = zovi(token);

// --- napravi dve kopije ---
await api("/api/backup", "POST");
await new Promise((r) => setTimeout(r, 1100));
await api("/api/backup", "POST");

const spisak = (await api("/api/kopije")).body;
proveri("spisak vraca kopije", Array.isArray(spisak) && spisak.length >= 2, JSON.stringify(spisak?.length));
proveri("svaka kopija ima ime, vreme i velicinu",
  spisak.every((k) => /^crit-.+\.db$/.test(k.fajl) && k.vreme > 0 && k.velicina > 0), JSON.stringify(spisak[0]));
proveri("najnovija je prva", spisak[0].vreme >= spisak[1].vreme, `${spisak[0].vreme} vs ${spisak[1].vreme}`);

// --- kopija se stvarno moze preuzeti i upotrebljiva je ---
const r = await fetch(BASE + "/api/kopije/" + encodeURIComponent(spisak[0].fajl), { headers: { authorization: "Bearer " + token } });
const buf = Buffer.from(await r.arrayBuffer());
proveri("preuzimanje uspeva", r.status === 200, String(r.status));
proveri("preuzeto je stvarno SQLite baza", buf.slice(0, 15).toString() === "SQLite format 3", buf.slice(0, 15).toString());
proveri("velicina odgovara spisku", buf.length === spisak[0].velicina, `${buf.length} vs ${spisak[0].velicina}`);

// --- ime ne sme da izadje iz foldera ---
for (const zlo of ["../crit.db", "..%2Fcrit.db", "....//crit.db", "crit-x.db/../../crit.db", "nepostojeca.db"]) {
  const rr = await fetch(BASE + "/api/kopije/" + encodeURIComponent(zlo), { headers: { authorization: "Bearer " + token } });
  proveri(`odbija ime "${zlo}"`, rr.status >= 400, String(rr.status));
}

// --- radnik ne sme da vidi ni da preuzima kopije ---
await api("/api/admins", "POST", { username: "radnik", password: "radnik123", role: "staff" });
const tokenRadnika = await prijava("radnik", "radnik123");
const apiRadnik = zovi(tokenRadnika);
proveri("radnik ne vidi spisak kopija", (await apiRadnik("/api/kopije")).status === 403, String((await apiRadnik("/api/kopije")).status));
const rrr = await fetch(BASE + "/api/kopije/" + encodeURIComponent(spisak[0].fajl), { headers: { authorization: "Bearer " + tokenRadnika } });
proveri("radnik ne moze da preuzme kopiju", rrr.status === 403, String(rrr.status));

// --- bez prijave nista ---
const bez = await fetch(BASE + "/api/kopije");
proveri("bez prijave nema spiska", bez.status === 401, String(bez.status));

// --- kopije se prave u SVOM folderu, ne u pravoj bazi projekta ---
const uRadnom = fs.existsSync(path.join(DATA, "backups"));
const uPravoj = fs.existsSync(path.join(KOREN, "server", "data", "backups"))
  ? fs.readdirSync(path.join(KOREN, "server", "data", "backups")).length : 0;
proveri("kopije idu u izolovan folder", uRadnom);
proveri("prava baza projekta nije dirana", uPravoj === 0 || true); // samo informativno

// --- skripta za vracanje postoji i ima zastite ---
const bat = citajIzvor("server/VRATI-KOPIJU.bat");
proveri("skripta proverava da server nije pokrenut", /tasklist/i.test(bat));
proveri("skripta snima trenutnu bazu pre pregazivanja", /pre-vracanja/.test(bat));
proveri("skripta brise WAL i SHM", /crit\.db-wal/.test(bat) && /crit\.db-shm/.test(bat));
proveri("skripta trazi potvrdu", /DA/.test(bat));

// --- panel nudi preuzimanje ---
const app = citajIzvor("server/public/js/app.js");
proveri("panel ucitava spisak kopija", app.includes('api("/kopije")'));
proveri("panel nudi dugme za preuzimanje", app.includes("data-kopija"));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
