import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { KOREN, radniFolder, brojac } from "./_okruzenje.mjs";
// NADZORNIK SA PRAVIM SERVEROM
//
// test-nadzornik.mjs proverava odluke nadzornika na lažnom satu. Ovde se pušta
// pravi nadzornik nad pravim serverom, u posebnoj fascikli, i gleda se ono što
// se samo tako vidi:
//
//   - server koji se ubije (pad, nestanak procesa) nadzornik diže sam
//   - pad stiže u Logove, gde vlasnik gleda
//   - drugi nadzornik na istom portu ne diže drugi server
//   - zahtev za gašenje (fajl nadzor-stani) gasi sve uredno: baza prepisana i
//     zatvorena, bez WAL ostatka koji bi VRATI-KOPIJU obrisao
//   - zauzet port ne diže server u krug
//   - nadzornik ubijen silom povuče i server, a provera (--provera) ih diže -
//     ali ne i server koji je ugašen namerno
//
// Zakazani zadatak se ovde ne pravi - on menja Windows razvojnog računara.
const { proveri, kraj } = brojac();
const PORT = 8219;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = radniFolder("nadzornik-data");
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const radi = (p) => !!p && p.exitCode === null && p.signalCode === null;
const ziv = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const zdrav = async () => {
  try {
    const r = await fetch(BASE + "/api/zdravlje", { signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.json()).ok === true;
  } catch { return false; }
};
async function sacekaj(fn, ms) {
  const doKad = Date.now() + ms;
  while (Date.now() < doKad) { if (await fn()) return true; await cekaj(250); }
  return false;
}
const zapis = () => { try { return fs.readFileSync(path.join(DATA, "nadzor.log"), "utf8"); } catch { return ""; } };
const stanje = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "nadzor.json"), "utf8")); } catch { return null; } };
const zatraziGasenje = () => fs.writeFileSync(path.join(DATA, "nadzor-stani"), "");
const izlaz = (p, ms) => Promise.race([p.gotov, cekaj(ms).then(() => "visi")]);

const procesi = [];
function nadzornik(...argumenti) {
  const p = spawn(process.execPath, [path.join(KOREN, "server", "nadzornik.mjs"), ...argumenti], {
    env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  p.izlaz = "";
  p.stdout.on("data", (d) => (p.izlaz += d));
  p.stderr.on("data", (d) => (p.izlaz += d));
  p.gotov = new Promise((r) => p.once("exit", (kod) => r(kod)));
  procesi.push(p);
  return p;
}

let blokada = null;
try {
  // ---- 1) POKRETANJE ----
  const n1 = nadzornik();
  proveri("nadzornik diže server", await sacekaj(zdrav, 30000), n1.izlaz.slice(-400));
  const s1 = stanje();
  proveri("i zapisuje koji je proces server", !!s1?.dete && ziv(s1.dete), JSON.stringify(s1));

  // ---- 2) DRUGI NADZORNIK ----
  const n2 = nadzornik();
  const kod2 = await izlaz(n2, 10000);
  proveri("drugi nadzornik na istom portu ne diže drugi server", kod2 === 0 && /vec radi/i.test(n2.izlaz),
    `${kod2}: ${n2.izlaz.slice(-200)}`);
  proveri("i prvi server i dalje radi", await zdrav());

  // ---- 3) PAD ----
  process.kill(s1.dete);
  proveri("server je stvarno ugašen", await sacekaj(async () => !(await zdrav()), 8000));
  proveri("nadzornik ga diže ponovo, sam", await sacekaj(zdrav, 25000), zapis().slice(-400));
  const s2 = stanje();
  proveri("i to kao novi proces", !!s2?.dete && s2.dete !== s1.dete && ziv(s2.dete), JSON.stringify(s2));
  proveri("pad je u zapisu nadzornika", /izašao/.test(zapis()), zapis().slice(-300));
  const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
  const logovi = JSON.stringify(await fetch(BASE + "/api/logs?limit=100", { headers: { authorization: "Bearer " + token } }).then((r) => r.json()));
  proveri("i vlasnik ga vidi u Logovima", logovi.includes("server_ponovo_pokrenut"));

  // ---- 4) UREDNO GAŠENJE ----
  zatraziGasenje();
  const kod1 = await izlaz(n1, 25000);
  proveri("zahtev za gašenje gasi nadzornika uredno", kod1 === 0, String(kod1));
  proveri("i server sa njim", !(await sacekaj(async () => ziv(s2.dete), 1)) || !ziv(s2.dete));
  proveri("i ne ostavlja zapis o sebi", stanje() === null);
  const wal = path.join(DATA, "crit.db-wal");
  proveri("baza je prepisana i zatvorena, bez WAL ostatka", !fs.existsSync(wal) || fs.statSync(wal).size === 0,
    fs.existsSync(wal) ? `${fs.statSync(wal).size} bajtova u WAL-u` : "");
  const baza = new DatabaseSync(path.join(DATA, "crit.db"), { readOnly: true });
  const ugasen = baza.prepare("SELECT COUNT(*) c FROM logs WHERE action = 'server_ugasen'").get().c;
  baza.close();
  proveri("gašenje je zapisano u Logove", ugasen >= 1);

  // ---- 5) ZAUZET PORT ----
  blokada = net.createServer();
  await new Promise((r) => blokada.listen(PORT, r));
  const n3 = nadzornik();
  await cekaj(9000);
  const odPokretanja = zapis().split("nadzornik je pokrenut").pop();
  const pokretanja = (odPokretanja.match(/pokrećem server/g) || []).length;
  proveri("zauzet port: server se ne diže u krug", pokretanja === 1, `${pokretanja} pokretanja za 9 s`);
  proveri("i zapis kaže zašto", /port je zauzet/.test(odPokretanja), odPokretanja.slice(-300));
  zatraziGasenje();
  const kod3 = await izlaz(n3, 15000);
  proveri("i taj nadzornik se gasi na zahtev", kod3 === 0, String(kod3));

  // ---- 6) NADZORNIK UBIJEN SILOM ----
  // Windows gasi Node dete zajedno sa roditeljem, pa ubijen nadzornik povuče i
  // server. Zakazani zadatak to ne pokriva; diže ih provera na 5 minuta.
  await new Promise((r) => blokada.close(r));
  blokada = null;
  const n4 = nadzornik();
  proveri("nadzornik diže server za probu provere", await sacekaj(zdrav, 30000), zapis().slice(-300));
  const s4 = stanje();
  n4.kill();
  await izlaz(n4, 10000);
  proveri("ubijen nadzornik povuče i server - nema servera bez nadzora",
    await sacekaj(async () => !ziv(s4?.dete) && !(await zdrav()), 8000), JSON.stringify(s4));
  proveri("i ostavi zapis po kom se vidi da je nestao", stanje()?.pid === s4?.pid, JSON.stringify(stanje()));
  const p1 = nadzornik("--provera");
  proveri("provera diže server iza nestalog nadzornika", await sacekaj(zdrav, 30000), p1.izlaz.slice(-300));
  proveri("i to piše u zapisu", /prethodni nadzornik je nestao bez gašenja/.test(zapis()), zapis().slice(-300));
  const p2 = nadzornik("--provera");
  proveri("provera dok nadzornik radi ne diže ništa", (await izlaz(p2, 10000)) === 0 && stanje()?.pid === p1.pid,
    p2.izlaz.slice(-200));
  zatraziGasenje();
  proveri("nadzornik iz provere se gasi uredno", (await izlaz(p1, 25000)) === 0);
  const p3 = nadzornik("--provera");
  proveri("namerno ugašen server provera ne diže", (await izlaz(p3, 10000)) === 0 && !(await zdrav()) && stanje() === null,
    "inače bi ga digla usred vraćanja kopije");
  fs.writeFileSync(path.join(DATA, "nadzor-pokreni"), "");
  const p4 = nadzornik("--provera");
  proveri("ali ga diže kad je ostavljen zahtev za paljenje", await sacekaj(zdrav, 30000), p4.izlaz.slice(-300));
  proveri("i zahtev se briše kad je ispunjen", !fs.existsSync(path.join(DATA, "nadzor-pokreni")));
  zatraziGasenje();
  proveri("i taj se gasi uredno", (await izlaz(p4, 25000)) === 0);
} finally {
  for (const p of procesi) if (radi(p)) { try { p.kill(); } catch {} }
  const s = stanje();
  if (s?.dete && ziv(s.dete)) { try { process.kill(s.dete); } catch {} }
  if (blokada) { try { blokada.close(); } catch {} }
  await cekaj(300);
}
proveri("posle probe ne ostaje nijedan nadzornik", procesi.every((p) => !radi(p)));
await kraj();
