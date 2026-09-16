import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { NUMERACIJA } from "./verzije.js";

// ---------- PAKET ZA NADOGRADNJU SERVERA ----------
//
// Server se do sada nadograđivao rukom: ugasi, prekopiraj src\ i public\,
// pokreni. Na jednom računaru to nije mnogo posla - ali se radi pored šanka,
// za vreme rada, i jedan pogrešan folder (data\ umesto src\) briše igraonicu.
//
// Paket je jedan fajl koji se otpremi u panelu. Ovde je samo njegov oblik i
// provera; zamenu radi nadzornik (vidi zamena-servera.js), jer server ne može
// da zameni sam sebe dok radi.
//
// OBLIK (ceo sadržaj je gzip):
//   8 bajtova   OZNAKA
//   4 bajta     dužina opisa (big-endian)
//   opis        JSON: { v, numeracija, verzija, napravljen, fajlovi: [{ put, velicina, sha256 }] }
//   fajlovi     sadržaji, jedan za drugim, redom iz opisa
//
// Bez tar-a i bez zavisnosti: server ima dve biblioteke i ne treba mu treća da
// bi pročitao sopstveni paket.
//
// ŠTA SE PROVERAVA PRE NEGO ŠTO SE IŠTA RASPAKUJE:
//   - svaki fajl ima otisak (sha256) - pokvaren prenos ne prolazi
//   - putanja sme samo u src\, public\ (bez uploads), node_modules\ i u
//     nekoliko fajlova na vrhu. Nikad data\, nikad "..", nikad apsolutna.
//     Paket koji bi pisao po bazi ili van foldera servera se ne otvara.
//   - veličina posle raspakivanja je ograničena - fajl od par megabajta koji
//     se raspakuje u desetine gigabajta ne sme da napuni disk servera
//   - paket nosi package.json i src/index.js, i verzija u opisu je ista kao u
//     package.json - inače bi panel pokazivao jednu verziju a radila bi druga
//   - paket je iz tekuće numeracije (vidi verzije.js) - stari 2.58.0 je po
//     broju "noviji" od v1.0.0, a nije

export const OZNAKA = Buffer.from("SRVPAK01", "ascii");
export const NAJVECI_RASPAKOVAN = 300 * 1024 * 1024;
export const NAJVISE_FAJLOVA = 30000;
const NA_VRHU = new Set(["package.json", "package-lock.json", "nadzornik.mjs"]);
const SKRIPTE_NA_VRHU = /^[\w .()-]+\.(bat|ps1)$/i;
const FOLDERI = new Set(["src", "public", "node_modules"]);
// U public\ stoje i stvari koje nisu program: stare otpremljene slike i proba.
const PUBLIC_NIJE_PROGRAM = new Set(["uploads", "_proba"]);

export function dozvoljenaPutanja(put) {
  const p = String(put ?? "");
  if (!p || p.length > 400 || p.includes("\\") || p.includes("\0") || p.startsWith("/") || /^[a-z]:/i.test(p)) return false;
  const delovi = p.split("/");
  if (delovi.some((d) => !d || d === "." || d === "..")) return false;
  if (delovi.length === 1) return NA_VRHU.has(p) || SKRIPTE_NA_VRHU.test(p);
  if (!FOLDERI.has(delovi[0])) return false;
  if (delovi[0] === "public" && PUBLIC_NIJE_PROGRAM.has(delovi[1])) return false;
  return true;
}

const otisak = (b) => createHash("sha256").update(b).digest("hex");

function sviFajlovi(koren) {
  const izlaz = [];
  const obidji = (rel) => {
    const pun = path.join(koren, rel);
    for (const e of fs.readdirSync(pun, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!rel && !FOLDERI.has(e.name)) continue;
        if (rel === "public" && PUBLIC_NIJE_PROGRAM.has(e.name)) continue;
        obidji(r);
      } else if (e.isFile()) {
        if (/\.deo$/i.test(e.name)) continue;
        if (dozvoljenaPutanja(r)) izlaz.push(r);
      }
    }
  };
  obidji("");
  return izlaz.sort();
}

/** Sklapa paket od foldera servera. Vraća gzip bafer. */
export function napraviPaket(folderServera) {
  const pkg = JSON.parse(fs.readFileSync(path.join(folderServera, "package.json"), "utf8"));
  const putevi = sviFajlovi(folderServera);
  const sadrzaji = putevi.map((p) => fs.readFileSync(path.join(folderServera, ...p.split("/"))));
  const opis = {
    v: 1,
    numeracija: NUMERACIJA,
    verzija: String(pkg.version),
    napravljen: new Date().toISOString(),
    fajlovi: putevi.map((put, i) => ({ put, velicina: sadrzaji[i].length, sha256: otisak(sadrzaji[i]) })),
  };
  const opisBafer = Buffer.from(JSON.stringify(opis), "utf8");
  const duzina = Buffer.alloc(4);
  duzina.writeUInt32BE(opisBafer.length);
  return zlib.gzipSync(Buffer.concat([OZNAKA, duzina, opisBafer, ...sadrzaji]), { level: 9 });
}

function greska(poruka) {
  const e = new Error(poruka);
  e.paket = true;
  return e;
}

/**
 * Čita i proverava paket. Baca grešku sa porukom za panel ako ne valja.
 * @returns {{ verzija: string, napravljen: string, fajlovi: {put: string, velicina: number, sha256: string, podaci: Buffer}[], otisak: string, velicina: number }}
 */
export function procitajPaket(gz, { najvise = NAJVECI_RASPAKOVAN } = {}) {
  let telo;
  try {
    telo = zlib.gunzipSync(gz, { maxOutputLength: najvise });
  } catch (e) {
    if (e?.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|larger than/i.test(String(e?.message))) {
      throw greska("Paket je prevelik posle raspakivanja - to nije paket servera.");
    }
    throw greska("Fajl nije paket servera (ne može da se raspakuje).");
  }
  if (telo.length < 12 || !telo.subarray(0, 8).equals(OZNAKA)) throw greska("Fajl nije paket servera.");
  const duzina = telo.readUInt32BE(8);
  if (12 + duzina > telo.length) throw greska("Paket je oštećen (opis je duži od fajla).");
  let opis;
  try { opis = JSON.parse(telo.subarray(12, 12 + duzina).toString("utf8")); } catch { throw greska("Paket je oštećen (opis nije ispravan)."); }
  if (!opis || opis.v !== 1 || !/^\d+\.\d+\.\d+$/.test(String(opis.verzija)) || !Array.isArray(opis.fajlovi)) {
    throw greska("Paket je napravljen za drugu verziju programa ili je oštećen.");
  }
  if ((Number(opis.numeracija) || 0) < NUMERACIJA) {
    throw greska(`Paket ${opis.verzija} je iz stare numeracije (pre v1.0.0) i ne može da se pusti.`);
  }
  if (opis.fajlovi.length === 0 || opis.fajlovi.length > NAJVISE_FAJLOVA) throw greska("Paket ima nemoguć broj fajlova.");

  const vidjeni = new Set();
  let pomeraj = 12 + duzina;
  const fajlovi = [];
  for (const f of opis.fajlovi) {
    if (!f || !dozvoljenaPutanja(f.put)) throw greska(`Paket sadrži fajl van dozvoljenih foldera: ${String(f?.put).slice(0, 80)}`);
    if (vidjeni.has(f.put)) throw greska(`Paket dvaput sadrži isti fajl: ${f.put}`);
    vidjeni.add(f.put);
    if (!Number.isInteger(f.velicina) || f.velicina < 0 || !/^[0-9a-f]{64}$/.test(String(f.sha256))) {
      throw greska(`Paket je oštećen (opis fajla ${f.put}).`);
    }
    if (pomeraj + f.velicina > telo.length) throw greska("Paket je nepotpun - prenos je verovatno prekinut.");
    const podaci = telo.subarray(pomeraj, pomeraj + f.velicina);
    pomeraj += f.velicina;
    if (otisak(podaci) !== f.sha256) throw greska(`Fajl ${f.put} u paketu je oštećen.`);
    fajlovi.push({ put: f.put, velicina: f.velicina, sha256: f.sha256, podaci });
  }
  if (pomeraj !== telo.length) throw greska("Paket je oštećen (višak podataka na kraju).");

  const pkg = fajlovi.find((f) => f.put === "package.json");
  if (!pkg || !vidjeni.has("src/index.js")) throw greska("Paket ne sadrži server (fale package.json ili src/index.js).");
  let verzijaPkg;
  try { verzijaPkg = JSON.parse(pkg.podaci.toString("utf8")).version; } catch { throw greska("package.json u paketu nije ispravan."); }
  if (String(verzijaPkg) !== String(opis.verzija)) {
    throw greska(`Paket kaže da je ${opis.verzija}, a program u njemu je ${verzijaPkg}.`);
  }

  return {
    verzija: String(opis.verzija),
    numeracija: Number(opis.numeracija),
    napravljen: String(opis.napravljen || ""),
    fajlovi,
    otisak: otisak(gz),
    velicina: telo.length,
  };
}

/** Raspakuje već proveren paket u prazan folder. */
export function raspakuj(paket, cilj) {
  fs.rmSync(cilj, { recursive: true, force: true });
  fs.mkdirSync(cilj, { recursive: true });
  for (const f of paket.fajlovi) {
    // Druga brana posle dozvoljenaPutanja: i da provera ikad propusti nešto,
    // fajl ne sme da završi van cilja.
    const pun = path.resolve(cilj, ...f.put.split("/"));
    if (!pun.startsWith(path.resolve(cilj) + path.sep)) throw greska(`Fajl ${f.put} bi završio van foldera za nadogradnju.`);
    fs.mkdirSync(path.dirname(pun), { recursive: true });
    fs.writeFileSync(pun, f.podaci);
  }
  return paket.fajlovi.length;
}
