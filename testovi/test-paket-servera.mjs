import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { radniFolder, brojac, KOREN } from "./_okruzenje.mjs";
import * as P from "../server/src/paket-servera.js";
// PAKET ZA NADOGRADNJU SERVERA - ŠTA SME DA UĐE
//
// Paket se otpremi u panelu i posle toga zameni kod servera. To je najkraći put
// od jednog fajla do svega što igraonica ima, pa se ovde proverava šta sme da
// prođe:
//
//   - nosi kod servera, a NE bazu, slike igraonice ni probe
//   - pokvaren bajt, prekinut prenos i fajl koji nije paket se hvataju
//   - putanja van src\, public\, node_modules\ ne prolazi - ni "..", ni
//     apsolutna, ni data\ - pa paket ne može da piše po bazi ni van servera
//   - verzija u opisu je ista kao u package.json
//   - mali fajl koji se raspakuje u ogroman ne puni disk
const { proveri, kraj } = brojac();
const DIR = radniFolder("paket-servera");
const otisak = (b) => createHash("sha256").update(b).digest("hex");
const baca = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ---- lažan server ----
const SRV = path.join(DIR, "server");
const pisi = (rel, sadrzaj) => {
  const p = path.join(SRV, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, sadrzaj);
};
pisi("package.json", JSON.stringify({ name: "server", version: "9.1.0" }));
pisi("nadzornik.mjs", "// nadzornik");
pisi("src/index.js", "console.log('server');");
pisi("src/deo/modul.js", "export const x = 1;");
pisi("public/index.html", "<html></html>");
pisi("public/uploads/slika.png", "SLIKA-IGRAONICE");
pisi("public/_proba/x.html", "proba");
pisi("node_modules/ws/index.js", "module.exports = 1;");
pisi("data/crit.db", "BAZA");
pisi("Pokreni server.bat", "@echo off");
pisi("podesi-autostart.ps1", "# ps");
pisi("src/prekinut.exe.deo", "pola");

// ---- 1) ŠTA PAKET NOSI ----
const gz = P.napraviPaket(SRV);
const p = P.procitajPaket(gz);
const putevi = p.fajlovi.map((f) => f.put);
proveri("paket se čita i nosi verziju iz package.json", p.verzija === "9.1.0");
proveri("nosi kod servera", ["package.json", "nadzornik.mjs", "src/index.js", "src/deo/modul.js", "public/index.html",
  "node_modules/ws/index.js", "Pokreni server.bat", "podesi-autostart.ps1"].every((x) => putevi.includes(x)), putevi.join(", "));
proveri("ne nosi bazu", !putevi.some((x) => x.startsWith("data/")));
proveri("ne nosi slike igraonice iz public/uploads", !putevi.some((x) => x.startsWith("public/uploads")));
proveri("ne nosi probu iz public/_proba", !putevi.some((x) => x.startsWith("public/_proba")));
proveri("ne nosi prekinute prenose", !putevi.some((x) => x.endsWith(".deo")));
proveri("otisak paketa je otisak fajla", p.otisak === otisak(gz));

const CILJ = path.join(DIR, "novi");
fs.mkdirSync(CILJ, { recursive: true });
fs.writeFileSync(path.join(CILJ, "otpadak.txt"), "x");
P.raspakuj(p, CILJ);
proveri("raspakuje se tačno ono što je u paketu", fs.readFileSync(path.join(CILJ, "src", "deo", "modul.js"), "utf8") === "export const x = 1;");
proveri("i to u prazan folder", !fs.existsSync(path.join(CILJ, "otpadak.txt")));

// ---- 2) POKVAREN ILI NIJE PAKET ----
const telo = zlib.gunzipSync(gz);
const pokvaren = Buffer.from(telo);
pokvaren[pokvaren.length - 3] ^= 0xff;
let e = baca(() => P.procitajPaket(zlib.gzipSync(pokvaren)));
proveri("pokvaren bajt u fajlu se hvata", e?.paket && /oštećen/.test(e.message), e?.message);
e = baca(() => P.procitajPaket(zlib.gzipSync(telo.subarray(0, telo.length - 10))));
proveri("prekinut prenos se hvata", e?.paket && /nepotpun|oštećen/.test(e.message), e?.message);
e = baca(() => P.procitajPaket(Buffer.from("ovo nije gzip")));
proveri("fajl koji nije paket se odbija", !!e?.paket, e?.message);
e = baca(() => P.procitajPaket(zlib.gzipSync(Buffer.from("DRUGIPAK" + "x".repeat(40)))));
proveri("fajl sa drugom oznakom se odbija", !!e?.paket, e?.message);

// ---- 3) PODMETNUTE PUTANJE ----
const sastavi = (opis, sadrzaji) => {
  const ob = Buffer.from(JSON.stringify({ numeracija: 1, ...opis }));
  const d = Buffer.alloc(4);
  d.writeUInt32BE(ob.length);
  return zlib.gzipSync(Buffer.concat([P.OZNAKA, d, ob, ...sadrzaji]));
};
const pkg = Buffer.from(JSON.stringify({ version: "9.1.0" }));
const idx = Buffer.from("x");
const unos = (put, b) => ({ put, velicina: b.length, sha256: otisak(b) });
const osnova = [unos("package.json", pkg), unos("src/index.js", idx)];
for (const [opis, put] of [
  ["izlazak iz foldera (..)", "src/../../Windows/System32/x.dll"],
  ["apsolutna putanja", "/Windows/x.dll"],
  ["slovo diska", "C:/Windows/x.dll"],
  ["obrnuta kosa crta", "src\\..\\..\\x.js"],
  ["baza", "data/crit.db"],
  ["slike igraonice", "public/uploads/x.png"],
  ["nepoznat folder na vrhu", "alati/x.js"],
  ["izvršni fajl na vrhu", "zlo.exe"],
]) {
  const b = Buffer.from("zlo");
  const r = baca(() => P.procitajPaket(sastavi({ v: 1, verzija: "9.1.0", fajlovi: [...osnova, unos(put, b)] }, [pkg, idx, b])));
  proveri(`odbija: ${opis}`, r?.paket && /van dozvoljenih/.test(r.message), r?.message);
}
e = baca(() => P.procitajPaket(sastavi({ v: 1, verzija: "9.2.0", fajlovi: osnova }, [pkg, idx])));
proveri("verzija u opisu mora da bude ista kao u package.json", e?.paket && /kaže da je 9\.2\.0/.test(e.message), e?.message);
e = baca(() => P.procitajPaket(sastavi({ v: 1, verzija: "9.1.0", fajlovi: [unos("package.json", pkg)] }, [pkg])));
proveri("paket bez servera se odbija", e?.paket && /ne sadrži server/.test(e.message), e?.message);
e = baca(() => P.procitajPaket(sastavi({ v: 1, verzija: "9.1.0", fajlovi: [...osnova, unos("src/index.js", idx)] }, [pkg, idx, idx])));
proveri("isti fajl dvaput se odbija", e?.paket && /dvaput/.test(e.message), e?.message);
e = baca(() => P.procitajPaket(sastavi({ v: 1, verzija: "9.1.0", fajlovi: osnova }, [pkg, idx, Buffer.from("visak")])));
proveri("višak podataka na kraju se odbija", e?.paket && /višak/.test(e.message), e?.message);
e = baca(() => P.procitajPaket(sastavi({ numeracija: undefined, v: 1, verzija: "9.1.0", fajlovi: osnova }, [pkg, idx])));
proveri("paket iz stare numeracije se odbija", e?.paket && /stare numeracije/.test(e.message),
  e?.message || "server-2.58.0.srvpak bi inače bio 'noviji' od v1.0.0");
proveri("paket nosi numeraciju", p.numeracija === 1, String(p.numeracija));

// ---- 4) FAJL KOJI SE RASPAKUJE U OGROMAN ----
const bomba = zlib.gzipSync(Buffer.alloc(2 * 1024 * 1024));
e = baca(() => P.procitajPaket(bomba, { najvise: 1024 * 1024 }));
proveri(`${Math.round(bomba.length / 1024)} KB koji se raspakuju preko granice se odbijaju`, e?.paket && /prevelik/.test(e.message), e?.message);
proveri("granica u programu je razumna za server", P.NAJVECI_RASPAKOVAN >= 50 * 1024 * 1024 && P.NAJVECI_RASPAKOVAN <= 1024 * 1024 * 1024);

// ---- 5) PRAVI SERVER ----
// Paket od pravog foldera servera: da se čita, da nosi sve bitno i ništa iz data\.
const pravi = P.procitajPaket(P.napraviPaket(path.join(KOREN, "server")));
const pp = pravi.fajlovi.map((f) => f.put);
proveri("paket pravog servera se čita", /^\d+\.\d+\.\d+$/.test(pravi.verzija));
proveri("i nosi nadzornika, panel i biblioteke", ["nadzornik.mjs", "src/index.js", "src/nadzor.js", "public/index.html"].every((x) => pp.includes(x)) &&
  pp.some((x) => x.startsWith("node_modules/express/")) && pp.some((x) => x.startsWith("node_modules/ws/")), pp.filter((x) => !x.startsWith("node_modules")).slice(0, 12).join(", "));
proveri("i ništa iz data", !pp.some((x) => x.startsWith("data/")));

await kraj();
