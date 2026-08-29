import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// NIJEDAN TEST NE SME DA DIRA PRAVU BAZU
//
// Serverski moduli uzimaju folder sa podacima iz CRIT_DATA_DIR, a ako ga nema,
// padaju na server/data - pravu bazu igraonice. Test koji uveze db.js ili
// odrzavanje.js bez toga radi nad pravim podacima: pravi rezervne kopije,
// brise stare, upisuje redove. To se ne vidi u ispisu testa, jer test i dalje
// prolazi - vidi se tek kad neko otvori pravi panel i nadje tudje podatke.
//
// Desilo se tacno to: test za rezervne kopije je uvezao odrzavanje.js da bi
// proverio sredjivanje, a posto je server bio u ZASEBNOM procesu, ovaj proces
// nije imao CRIT_DATA_DIR. Napravio je kopiju u pravom server/data/backups.
//
// Zato se ovde cita svaki test i proverava da izolacija dolazi PRE uvoza.
const OVDE = path.dirname(fileURLToPath(import.meta.url));

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const fajlovi = fs.readdirSync(OVDE)
  .filter((f) => (f.startsWith("test-") || f.startsWith("proba-") || f.startsWith("pregled-") || f.startsWith("godina-") || f.startsWith("server-za-")) && f.endsWith(".mjs"))
  .filter((f) => f !== "test-izolacija.mjs");

proveri("ima šta da se proveri", fajlovi.length > 10, String(fajlovi.length));

// Ne smeta svaki serverski modul, nego samo onaj koji otvara bazu. banner.js
// nema nijedan uvoz i ne dira ništa, pa nema razloga da se na njega viče.
const SRC = path.join(OVDE, "..", "server", "src");
const doBaze = new Map();
function stizeDoBaze(ime, dubina = 0) {
  if (ime === "db.js") return true;
  if (doBaze.has(ime)) return doBaze.get(ime);
  if (dubina > 6) return false;
  doBaze.set(ime, false); // protiv kružnih uvoza
  let s;
  try { s = fs.readFileSync(path.join(SRC, ime), "utf8"); } catch { return false; }
  let rez = false;
  for (const m of s.matchAll(/from\s+["'`]\.\/([\w.-]+\.js)["'`]/g)) {
    if (stizeDoBaze(m[1], dubina + 1)) { rez = true; break; }
  }
  doBaze.set(ime, rez);
  return rez;
}

// Uvoz serverskog modula iz samog testa (ne pominjanje u tekstu ili spawn-u).
const UVOZ = /(?:^|[^/\w])(?:import|await import)\s*\(?\s*(?:new URL\(\s*)?["'`][^"'`]*server\/src\/([\w.-]+\.js)["'`]/;
// Izolacija vazi samo ako menja OVAJ proces.
//
// "CRIT_DATA_DIR: DATA" unutar spawn({env}) se NE racuna: to podesava folder
// detetu-procesu, a modul uvezen ovde i dalje otvara pravu bazu. Bas to je i
// prevarilo prvi put - test je spawn-ovao server sa svojim folderom, pa uvezao
// modul i mislio da je izolovan.
const IZOLACIJA = /podigniServer\s*\(|process\.env\.CRIT_DATA_DIR\s*=[^=]/;

const problemi = [];
for (const f of fajlovi) {
  const s = fs.readFileSync(path.join(OVDE, f), "utf8");
  const linije = s.split("\n");
  let redUvoza = -1, redIzolacije = -1;
  for (let i = 0; i < linije.length; i++) {
    const l = linije[i];
    if (l.trim().startsWith("//")) continue;         // objašnjenja se ne broje
    if (redIzolacije < 0 && IZOLACIJA.test(l)) redIzolacije = i;
    if (redUvoza < 0) {
      const m = UVOZ.exec(l);
      if (m && stizeDoBaze(m[1])) redUvoza = i;
    }
  }
  if (redUvoza < 0) continue;                        // ne dira serverske module
  if (redIzolacije < 0) problemi.push(`${f}: uvozi server/src bez CRIT_DATA_DIR`);
  else if (redIzolacije > redUvoza) problemi.push(`${f}: izolacija u redu ${redIzolacije + 1}, a uvoz već u ${redUvoza + 1}`);
}

proveri("nijedan test ne uvozi serverski modul nad pravom bazom", problemi.length === 0,
  problemi.join(" | "));

// ---- PROBE MORAJU DA POKRIJU SVAKI IPC KANAL ----
//
// Probe koje ne pustaju pravi main.js same odgovaraju na IPC pozive iz
// launchera. Kanal koji nedostaje ne pukne odmah nego odbije obecanje, a to
// pada u "unhandledRejection" i gasi probu porukom koja nema veze sa onim sto
// se merilo. Desilo se sa kanalom "verzija": proba za animacije se nekad gasila
// u cetvrtoj sekundi, a izgledalo je kao da animacije ne rade.
const preload = fs.readFileSync(path.join(OVDE, "..", "client", "preload.js"), "utf8");
const kanali = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]);
proveri("preload nudi kanale koji se mogu proveriti", kanali.length > 5, String(kanali.length));

const nepokriveni = [];
for (const f of fajlovi) {
  // Samo alati koji SAMI glume Electron main. Suite testovi (test-*) ne pustaju
  // prozor; oni kanale samo pominju u tvrdnjama, pa bi ih obicna pretraga
  // pogresno prijavila.
  if (f.startsWith("test-")) continue;
  const s = fs.readFileSync(path.join(OVDE, f), "utf8");
  // Proba koja pusta PRAVI client/main.js dobija sve kanale od njega; ona sme da
  // dodefinise poneki (npr. da igra ne krene stvarno) i to nije rupa.
  // Putanja se gradi kao path.join(KOREN, "client", "main.js"), pa doslovnog
  // "client/main.js" nigde nema - traze se oba oblika.
  if (/client[\/\\]+main\.js/.test(s) || /"client",\s*"main\.js"/.test(s)) continue;
  if (!/^\s*ipcMain\.handle\(/m.test(s)) continue;   // ne glumi Electron main
  for (const k of kanali) if (!s.includes(`"${k}"`)) nepokriveni.push(`${f}: ${k}`);
}
proveri("svaka proba odgovara na sve kanale iz preload-a", nepokriveni.length === 0,
  nepokriveni.join(" | "));

// I obrnuta strana: pokretač briše .radno, pa tamo ne sme da završi prava baza.
const pokretac = fs.readFileSync(path.join(OVDE, "pokreni-sve.mjs"), "utf8");
proveri("pokretač briše samo svoj radni folder", /\.radno/.test(pokretac) && !/server[\/\\]data/.test(pokretac));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
