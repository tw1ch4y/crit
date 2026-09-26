import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DATA_DIR, getSetting, setSetting } from "./db.js";
import { NUMERACIJA, uporediVerzije, verzijaIzImena, izStareNumeracije, brojIzImena } from "./verzije.js";

// ---------- NADOGRADNJA LAUNCHERA ----------
//
// Server drži jedan instalater, a računari ga preuzimaju sami:
//   1. instalater se ne preuzima dok ga serviser ne pusti u rad;
//   2. računar na kom neko igra se ne nadograđuje;
//   3. uz najavu ide sha256, a računar ne pokreće fajl koji se ne poklapa.

export const FOLDER = path.join(DATA_DIR, "nadogradnja");

// Poređenje verzija i numeracija stoje u verzije.js (bez baze, pa ih koriste i
// alati za pakovanje). Ovde se samo prosleđuju dalje.
export { NUMERACIJA, uporediVerzije, verzijaIzImena, izStareNumeracije };

// Otisak se pamti po imenu, veličini i vremenu izmene, da se instalater od
// 100 MB ne čita pri svakom osvežavanju panela.
const otisci = new Map(); // putanja -> { velicina, mtime, sha256 }
function otisak(put, st) {
  const stari = otisci.get(put);
  if (stari && stari.velicina === st.size && stari.mtime === st.mtimeMs) return stari.sha256;
  const h = createHash("sha256");
  const fd = fs.openSync(put, "r");
  try {
    const bafer = Buffer.alloc(1024 * 1024);
    let procitano;
    while ((procitano = fs.readSync(fd, bafer, 0, bafer.length, null)) > 0) h.update(bafer.subarray(0, procitano));
  } finally { fs.closeSync(fd); }
  const sha256 = h.digest("hex");
  otisci.set(put, { velicina: st.size, mtime: st.mtimeMs, sha256 });
  return sha256;
}

// Najveca verzija koja se nalazi u folderu. Vise fajlova nije greska - posle
// nekoliko nadogradnji ih se nakupi, a stari se drze kao mogucnost povratka.
export function nadjiInstalater() {
  let nadjeno = null;
  let fajlovi;
  try { fajlovi = fs.readdirSync(FOLDER); } catch { return null; }
  for (const ime of fajlovi) {
    if (!/\.exe$/i.test(ime)) continue;
    const verzija = verzijaIzImena(ime);
    if (!verzija) continue;
    const put = path.join(FOLDER, ime);
    let st;
    try { st = fs.statSync(put); } catch { continue; }
    if (!st.isFile() || st.size === 0) continue;
    if (!nadjeno || uporediVerzije(verzija, nadjeno.verzija) > 0) nadjeno = { ime, put, verzija, velicina: st.size, st };
  }
  return nadjeno;
}

// Puštena verzija se pamti kao broj verzije, ne kao "da/ne", pa svaki nov
// instalater traži svoju odluku. Uz broj ide oznaka numeracije (verzije.js).
const OZNAKA_PUSTENE = `n${NUMERACIJA}:`;
export const pustenaVerzija = () => {
  const v = String(getSetting("nadogradnja_pustena") || "");
  return v.startsWith(OZNAKA_PUSTENE) ? v.slice(OZNAKA_PUSTENE.length) || null : null;
};

export function stanje() {
  const inst = nadjiInstalater();
  const pustena = pustenaVerzija();
  if (!inst) return { ima: false, verzija: null, pustena, pusteno: false };
  return {
    ima: true,
    fajl: inst.ime,
    verzija: inst.verzija,
    velicina: inst.velicina,
    sha256: otisak(inst.put, inst.st),
    pustena,
    pusteno: pustena === inst.verzija,
  };
}

export function pusti(verzija) {
  const inst = nadjiInstalater();
  if (!inst) return { error: "Nema instalatera u folderu za nadogradnju" };
  if (verzija && verzija !== inst.verzija) {
    return { error: `Na serveru je verzija ${inst.verzija}, a puštena je tražena ${verzija}` };
  }
  setSetting("nadogradnja_pustena", OZNAKA_PUSTENE + inst.verzija);
  return { ok: true, verzija: inst.verzija };
}

export function povuci() {
  setSetting("nadogradnja_pustena", "");
  return { ok: true };
}

// Folder se pravi tek kad zatreba - prazan folder u podacima samo zbunjuje.
export function spremiFolder() {
  fs.mkdirSync(FOLDER, { recursive: true });
  return FOLDER;
}

// Fajl iz panela se piše kao ".deo" i preimenuje na kraju, pa prekinut
// prenos ne ostavlja pola instalatera sa ispravnim imenom.
export function putanjaZaUpis(ime) {
  const cisto = path.basename(String(ime || "")).replace(/[^\w .()\-]/g, "");
  if (!/\.exe$/i.test(cisto)) return { error: "Instalater mora biti .exe fajl" };
  if (izStareNumeracije(cisto)) {
    return { error: "Ovo je instalater iz stare numeracije (pre v1.0.0) i ne može da se pusti. Napravi nov - njegovo ime ima \"v\" ispred broja." };
  }
  if (!verzijaIzImena(cisto)) return { error: "Ime fajla mora da sadrži verziju, na primer Setup v1.0.1.exe" };
  spremiFolder();
  return { ime: cisto, konacna: path.join(FOLDER, cisto), privremena: path.join(FOLDER, cisto + ".deo") };
}

export function obrisi(ime) {
  const cisto = path.basename(String(ime || ""));
  if (!/\.exe$/i.test(cisto)) return { error: "Neispravno ime fajla" };
  const put = path.join(FOLDER, cisto);
  if (!fs.existsSync(put)) return { error: "Taj fajl ne postoji" };
  // Verzija koja se upravo deli masinama ne sme da nestane ispod njih. Stari
  // instaler nema verziju, a ni pustena ne mora da postoji - null nije jednako null.
  const verzija = verzijaIzImena(cisto);
  if (verzija && verzija === pustenaVerzija()) {
    return { error: "Ta verzija je puštena u rad. Prvo je povuci, pa onda obriši." };
  }
  fs.unlinkSync(put);
  otisci.delete(put);
  return { ok: true };
}

export function listaFajlova() {
  let fajlovi = [];
  try { fajlovi = fs.readdirSync(FOLDER); } catch { return []; }
  // Stari instaleri se prikazuju posle novih (da mogu da se obrišu). Fajl koji
  // nestane u međuvremenu se preskače.
  return fajlovi
    .filter((i) => /\.exe$/i.test(i) && (verzijaIzImena(i) || izStareNumeracije(i)))
    .map((ime) => {
      let st;
      try { st = fs.statSync(path.join(FOLDER, ime)); } catch { return null; }
      const stara = !verzijaIzImena(ime);
      return { ime, verzija: stara ? brojIzImena(ime) : verzijaIzImena(ime), stara, velicina: st.size, vreme: st.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => (a.stara - b.stara) || uporediVerzije(b.verzija, a.verzija));
}
