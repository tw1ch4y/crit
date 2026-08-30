import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DATA_DIR, getSetting, setSetting } from "./db.js";

// ---------- NADOGRADNJA LAUNCHERA ----------
//
// Do sada je svaka izmena launchera znacila obilazak svih trinaest masina:
// USB, instalacija, cekanje, sledeca. Pola sata posla za ispravku od jednog
// reda, pa se ispravke i odlazu dok se "ne skupi nekoliko" - a to znaci da
// poznata greska nedeljama radi u igraonici.
//
// Ovde server drzi JEDAN instalater, a racunari ga sami preuzimaju. Tri
// pravila drze to bezbednim:
//
//  1. Fajl sam po sebi ne znaci nista. Dok ga covek ne PUSTI U RAD, niko ga
//     ne skida. Losa verzija tako ne moze da se razlije na sve masine samo
//     zato sto je neko prekopirao fajl.
//  2. Racunar na kom neko sedi se ne dira. Nadogradnja gasi launcher; usred
//     placenog sata to je ukradeno vreme.
//  3. Sta se skinulo mora da bude tacno ono sto server ima. Uz najavu ide
//     otisak (sha256), a racunar odbija da pokrene fajl koji se ne poklapa.

export const FOLDER = path.join(DATA_DIR, "nadogradnja");

// Verzije se porede po BROJEVIMA, ne kao tekst.
//
// "2.9.0" i "2.44.0": kao tekst je "2.9" vece, jer je "9" > "4". Po tom
// poredjenju bi cela igraonica ostala na 2.9.0 i nikad ne bi uzela 2.44.0 -
// nadogradnja bi tiho stala, a niko ne bi imao razloga da posumnja.
export function uporediVerzije(a, b) {
  const raspakuj = (v) => String(v || "").trim().split(/[.\-+]/).map((d) => parseInt(d, 10));
  const x = raspakuj(a), y = raspakuj(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = Number.isFinite(x[i]) ? x[i] : 0;
    const q = Number.isFinite(y[i]) ? y[i] : 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// Verzija iz imena fajla: "Crit Launcher Setup 2.45.0.exe" -> "2.45.0".
// Trazi se tri broja odvojena tackama; sve ostalo u imenu je svejedno, pa
// igraonica sme da preimenuje instalater po svom brendu.
export function verzijaIzImena(ime) {
  const m = String(ime || "").match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

// Racunanje otiska je citanje celog instalatera - oko sto megabajta. Panel
// stanje trazi pri svakom osvezavanju, pa bi bez pamcenja server na svakih
// nekoliko sekundi prezvakao ceo fajl. Pamti se po imenu, velicini i vremenu
// izmene: promeni li se bilo sta od toga, racuna se ponovo.
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

// Puštena verzija se pamti kao TEKST verzije, ne kao "da/ne".
//
// Da stoji samo "pusteno: da", prekopiran nov fajl bi nasledio odobrenje
// prethodnog i odmah krenuo na sve masine - bas ono sto pravilo 1 sprecava.
// Ovako svaka nova verzija trazi svoju odluku.
export const pustenaVerzija = () => getSetting("nadogradnja_pustena") || null;

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
  setSetting("nadogradnja_pustena", inst.verzija);
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

// Fajl koji stize preko panela se prvo pise pod privremenim imenom, pa se tek
// na kraju preimenuje. Prekinut prenos tako ostavlja ".deo" fajl koji nijedna
// masina nece uzeti, umesto pola instalatera sa ispravnim imenom - a taj bi
// se skidao na racunare i tamo pucao bez razumljivog razloga.
export function putanjaZaUpis(ime) {
  const cisto = path.basename(String(ime || "")).replace(/[^\w .()\-]/g, "");
  if (!/\.exe$/i.test(cisto)) return { error: "Instalater mora biti .exe fajl" };
  if (!verzijaIzImena(cisto)) return { error: "Ime fajla mora da sadrži verziju, na primer 2.45.0" };
  spremiFolder();
  return { ime: cisto, konacna: path.join(FOLDER, cisto), privremena: path.join(FOLDER, cisto + ".deo") };
}

export function obrisi(ime) {
  const cisto = path.basename(String(ime || ""));
  if (!/\.exe$/i.test(cisto)) return { error: "Neispravno ime fajla" };
  const put = path.join(FOLDER, cisto);
  if (!fs.existsSync(put)) return { error: "Taj fajl ne postoji" };
  // Verzija koja se upravo deli masinama ne sme da nestane ispod njih.
  if (verzijaIzImena(cisto) === pustenaVerzija()) {
    return { error: "Ta verzija je puštena u rad. Prvo je povuci, pa onda obriši." };
  }
  fs.unlinkSync(put);
  otisci.delete(put);
  return { ok: true };
}

export function listaFajlova() {
  let fajlovi = [];
  try { fajlovi = fs.readdirSync(FOLDER); } catch { return []; }
  return fajlovi
    .filter((i) => /\.exe$/i.test(i) && verzijaIzImena(i))
    .map((ime) => {
      const st = fs.statSync(path.join(FOLDER, ime));
      return { ime, verzija: verzijaIzImena(ime), velicina: st.size, vreme: st.mtimeMs };
    })
    .sort((a, b) => uporediVerzije(b.verzija, a.verzija));
}
