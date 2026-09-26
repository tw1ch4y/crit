import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./db.js";
import { procitajPaket, raspakuj } from "./paket-servera.js";
import { uporediVerzije } from "./nadogradnja.js";

// ---------- NADOGRADNJA SERVERA SA PANELA ----------
//
//   1. serviser otpremi paket (pravi ga napravi-paket.mjs);
//   2. server proveri svaki fajl i putanju (paket-servera.js);
//   3. na "Nadogradi" server pravi kopiju baze, raspakuje paket, javi
//      nadzorniku i ugasi se;
//   4. nadzornik menja kod i diže novu verziju; ako se ne javi svojim brojem
//      za minut i po, vraća staru (zamena-servera.js).
//
// Launcheri za to vreme rade bez servera. Radi samo kad server drži
// nadzornik; inače panel to kaže.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FOLDER = path.join(DATA_DIR, "nadogradnja-servera");
export const PAKET = path.join(FOLDER, "server.srvpak");
export const NOVI = path.join(FOLDER, "novi");
export const ISHOD = path.join(FOLDER, "ishod.json");

export const trenutnaVerzija = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version); }
  catch { return "0.0.0"; }
})();

export const podNadzorom = () => process.env.POD_NADZOROM === "1" && typeof process.send === "function";

// Čitanje paketa je raspakivanje nekoliko megabajta i otisak svakog fajla.
// Panel stanje traži pri svakom otvaranju strane, pa se pamti dok se fajl ne promeni.
let kes = null;
export function stanjePaketa() {
  let st;
  try { st = fs.statSync(PAKET); } catch { return null; }
  if (kes && kes.velicina === st.size && kes.mtime === st.mtimeMs) return kes.rezultat;
  let rezultat;
  try {
    const p = procitajPaket(fs.readFileSync(PAKET));
    rezultat = {
      ispravan: true, verzija: p.verzija, napravljen: p.napravljen, fajlova: p.fajlovi.length,
      velicina: st.size, otisak: p.otisak, noviji: uporediVerzije(p.verzija, trenutnaVerzija) > 0,
    };
  } catch (e) {
    rezultat = { ispravan: false, velicina: st.size, greska: e?.paket ? e.message : "Paket ne može da se pročita" };
  }
  kes = { velicina: st.size, mtime: st.mtimeMs, rezultat };
  return rezultat;
}

export function procitajIshod() {
  try { return JSON.parse(fs.readFileSync(ISHOD, "utf8")); } catch { return null; }
}

// Ishod neuspele nadogradnje (upisao ga nadzornik). Stara verzija ga upisuje
// u Logove jednom, a panel ga prikazuje dok se ne postavi sledeći paket.
export function preuzmiIshod() {
  const i = procitajIshod();
  if (!i || i.zabelezeno) return null;
  try { fs.writeFileSync(ISHOD, JSON.stringify({ ...i, zabelezeno: true }), "utf8"); } catch {}
  return i;
}

export function obrisiIshod() {
  fs.rmSync(ISHOD, { force: true });
}

export function stanje() {
  return { trenutna: trenutnaVerzija, podNadzorom: podNadzorom(), paket: stanjePaketa(), poslednjiIshod: procitajIshod() };
}

export function putanjaZaUpis() {
  fs.mkdirSync(FOLDER, { recursive: true });
  return { konacna: PAKET, privremena: PAKET + ".deo" };
}

export function obrisiPaket() {
  fs.rmSync(PAKET, { force: true });
  kes = null;
  return { ok: true };
}

/** Proverava paket i raspakuje ga sa strane. Ne dira kod koji radi. */
export function pripremi() {
  if (!podNadzorom()) {
    return { error: "Server nije pokrenut preko nadzornika, pa nema ko da zameni kod. Pokreni ga sa 'Pokreni server.bat' iz nove verzije ili podesi autostart, pa probaj ponovo." };
  }
  let paket;
  try { paket = procitajPaket(fs.readFileSync(PAKET)); }
  catch (e) {
    if (e?.code === "ENOENT") return { error: "Na serveru nema paketa za nadogradnju." };
    return { error: e?.paket ? e.message : "Paket ne može da se pročita." };
  }
  if (uporediVerzije(paket.verzija, trenutnaVerzija) <= 0) {
    return { error: `Paket je verzija ${paket.verzija}, a server je već ${trenutnaVerzija}.` };
  }
  try { raspakuj(paket, NOVI); }
  catch (e) { return { error: `Raspakivanje nije uspelo: ${String(e?.message || e).slice(0, 200)}` }; }
  return { ok: true, verzija: paket.verzija, fajlova: paket.fajlovi.length };
}
