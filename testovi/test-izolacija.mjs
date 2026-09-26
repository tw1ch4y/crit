import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Nijedan test ne sme da dira pravu bazu.
//
// Serverski moduli bez CRIT_DATA_DIR rade nad server/data. Proverava se da
// svaki test postavi izolaciju pre uvoza serverskih modula.
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
// Probe koje ne pustaju pravi main.js same odgovaraju na IPC. Kanal koji
// nedostaje odbije obecanje i ugasi probu kroz "unhandledRejection".
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

// ---- ALAT KOJI MENJA BAZU MORA DA SME DA SE PREUSMERI ----
//
// `postavi-bazu.mjs` upisuje igre, alate, banere i nagrade, pa mora da postuje
// CRIT_DATA_DIR. `napravi-paket.mjs` bazu samo cita (i pakuje pravu), pa nije
// na spisku.
for (const alat of ["postavi-bazu.mjs"]) {
  const t = fs.readFileSync(path.join(OVDE, "..", alat), "utf8");
  const brise = t.includes("DELETE FROM");
  proveri(`${alat}: postuje CRIT_DATA_DIR`,
    !brise || t.includes("process.env.CRIT_DATA_DIR"),
    "alat koji brise iz baze mora da moze da se preusmeri na probnu");
}

// ---- OTPREMLJENE SLIKE SU PODACI, NE DEO PROGRAMA ----
//
// Slike stoje u data/uploads, uz bazu:
//   1. idu u rezervnu kopiju zajedno sa bazom
//   2. CRIT_DATA_DIR izoluje i njih, pa test ne pise u projekat
//   3. nadogradnja servera (src, public) ih ne mesa sa slikama iz paketa
for (const modul of fs.readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
  const t = fs.readFileSync(path.join(SRC, modul), "utf8");
  // Selidba sa starog mesta sme da ga pomene - ona ga bas zato i cita. Zato se
  // ona odseca pre provere, i to bez regexa: trazi se od njenog imena do prve
  // zatvorene zagrade odmah-pozvane funkcije.
  const pocetak = t.indexOf("function preseliStareSlike");
  const kraj = pocetak < 0 ? -1 : t.indexOf("})();", pocetak);
  const bezSelidbe = kraj < 0 ? t : t.slice(0, pocetak) + t.slice(kraj);
  proveri(`${modul}: ne pise slike u sam program`,
    !/"public", "uploads"/.test(bezSelidbe),
    "slike moraju uz bazu (DATA_DIR/uploads) - inace nisu ni u kopiji ni u izolaciji");
}

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
