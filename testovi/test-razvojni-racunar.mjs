import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { citajIzvor, KOREN } from "./_okruzenje.mjs";
// Računar na kom se program piše ne sme da strada od sopstvenog programa.
//
// Launcher menja Windows: politike u registru, plan napajanja, gašenje procesa
// iz sesije i čišćenje sesije (profili pregledača, prijave na Steam/Epic/Riot/
// Battle.net/EA/Ubisoft, skorašnji dokumenti, korpa). Čišćenje je nepovratno.
// Proverava se da postoji više nezavisnih brava, ne samo zastavica --no-lock.
//
// PAŽNJA: `ocistiSesiju` nikad ne sme da prođe u ovom testu; uzima staze iz
// pravog okruženja (LOCALAPPDATA, APPDATA). Sve provere ispod traže odbijanje
// ili idu kroz `--suvo` uz izmišljeno okruženje.
const OVDE = path.dirname(fileURLToPath(import.meta.url));

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const main = citajIzvor("client/main.js");
const ciscenje = citajIzvor("client/ciscenje.js");

// ---- 1) DRUGA BRAVA: nepakovan launcher ne dira Windows ----
//
// `app.isPackaged` je tačno samo kad launcher radi iz instalacije. `npm start`,
// `electron .` i svaki alat odavde daju netačno - a nijedno od toga nije računar
// u igraonici. Ovu bravu niko ne može da zaboravi, jer se ništa i ne kuca.
proveri("postoji provera da je launcher instaliran", /const PAKOVAN = app\.isPackaged/.test(main));
proveri("nepakovan launcher podrazumevano NE zaključava",
  /\(!PAKOVAN && !IZRICITO_ZAKLJUCAJ\)/.test(main),
  "bez ovoga jedan zaboravljen --no-lock briše profile na razvojnom računaru");
proveri("opasno se traži izričito (--zakljucaj)", /IZRICITO_ZAKLJUCAJ = process\.argv\.includes\("--zakljucaj"\)/.test(main));
proveri("odbijanje se ispisuje, ne prećutkuje",
  /Launcher NE dira Windows/.test(main),
  "tiho preskočeno zaključavanje na mašini u igraonici izgleda isto kao pokvaren launcher");

// Sve četiri opasne radnje moraju da vise o istoj bravi.
for (const [sta, sablon] of [
  ["politike u registru", /function setPolicies\(on\) \{\s*\n\s*if \(NO_LOCK/],
  ["plan napajanja", /function planNapajanja\(ukljuci\) \{\s*\n\s*if \(NO_LOCK/],
  ["gašenje pokrenutih programa", /if \(!NO_LOCK && procesiPreSesije\)/],
  ["čišćenje tragova", /dozvoljeno: !NO_LOCK/],
]) proveri(`${sta} zavisi od brave`, sablon.test(main));

// ---- 2) TREĆA BRAVA: fajl koji ne zavisi ni od čega ----
proveri("postoji zaštita po fajlu", /const STOP_FAJL = "CRIT-NE-DIRAJ\.txt"/.test(ciscenje));
{
  // Redosled u samoj funkciji: zaštita mora da bude prva provera, pre svih
  // ostalih uslova. Sve ispod nje su odluke o TOME KAKO se čisti; ova odlučuje
  // DA LI se uopšte sme.
  const telo = ciscenje.slice(ciscenje.indexOf("function ocistiSesiju("));
  const brava = telo.indexOf("racunarJeZasticen(");
  const prviUslov = telo.indexOf("if (!dozvoljeno)");
  proveri("zaštita se proverava PRE svih ostalih uslova",
    brava > -1 && prviUslov > -1 && brava < prviUslov,
    `brava na ${brava}, prvi uslov na ${prviUslov}`);
}

// A sada ponašanjem, u zasebnom procesu sa IZMIŠLJENIM okruženjem.
const { racunarJeZasticen, STOP_FAJL } = await import(
  "file://" + path.join(KOREN, "client", "ciscenje.js").replace(/\\/g, "/")).then((m) => m.default || m);

const saFajlom = fs.mkdtempSync(path.join(os.tmpdir(), "crit-zasticen-"));
const bezFajla = fs.mkdtempSync(path.join(os.tmpdir(), "crit-obican-"));
fs.writeFileSync(path.join(saFajlom, STOP_FAJL), "razvojni racunar");

proveri("fajl u korisničkom folderu štiti računar", racunarJeZasticen({ USERPROFILE: saFajlom }) === true);
proveri("bez fajla računar nije zaštićen", racunarJeZasticen({ USERPROFILE: bezFajla }) === false);
proveri("prazno okruženje ne prolazi kao zaštićeno", racunarJeZasticen({}) === false,
  "inače bi računar igrača ćutke prestao da se čisti");

// NAJGORI SLUČAJ: sve dozvole date, kao da je svaka druga brava zaboravljena.
// Traži se da fajl svejedno zaustavi brisanje.
const pusti = (userprofile, dodatno = []) => {
  const skripta = path.join(saFajlom, "proba.cjs");
  fs.writeFileSync(skripta, `
    const { ocistiSesiju } = require(${JSON.stringify(path.join(KOREN, "client", "ciscenje.js").replace(/\\/g, "/"))});
    const r = ocistiSesiju({
      dozvoljeno: true,
      resourcesPath: ${JSON.stringify(path.join(KOREN, "client").replace(/\\/g, "/"))},
      execPath: process.execPath,
      dirname: ${JSON.stringify(path.join(KOREN, "client").replace(/\\/g, "/"))},
      log: () => {},
    });
    console.log(JSON.stringify(r));
  `);
  const izlaz = execFileSync(process.execPath, [skripta, ...dodatno], {
    encoding: "utf8",
    env: { ...process.env, USERPROFILE: userprofile },
  });
  return JSON.parse(izlaz.trim().split("\n").pop());
};

const zasticen = pusti(saFajlom);
proveri("sa fajlom se brisanje ODBIJA i kad su sve dozvole date",
  zasticen.radjeno === false && zasticen.razlog === "zasticen", JSON.stringify(zasticen));

// Isto to bez fajla MORA da prođe - inače bi provera gore prolazila iz pogrešnog
// razloga i računari igrača bi ćutke prestali da se čiste. Ide kroz `--suvo`,
// probni rad u kom se ništa ne briše.
const obican = pusti(bezFajla, ["--suvo"]);
proveri("bez fajla čišćenje ide dalje (probni rad)", obican.probni === true && obican.radjeno === false,
  `${JSON.stringify(obican)} - da ovo ne prolazi, gornja provera ne bi značila nista`);

fs.rmSync(saFajlom, { recursive: true, force: true });
fs.rmSync(bezFajla, { recursive: true, force: true });

// ---- 3) NIJEDAN ALAT NE SME DA PUSTI PRAVI LAUNCHER BEZ BRAVE ----
//
// Alati odavde pišu svoj main.js koji učitava pravi client/main.js. Ko to radi,
// mora prvo da postavi --no-lock, i to PRE učitavanja - posle je kasno, jer je
// zaključavanje već odrađeno.
const alati = fs.readdirSync(OVDE).filter((f) => f.endsWith(".mjs") && f !== path.basename(fileURLToPath(import.meta.url)));
const problemi = [];
for (const f of alati) {
  const t = fs.readFileSync(path.join(OVDE, f), "utf8");
  // Da li uopšte učitava pravi launcher?
  const ucitava = /require\(\$\{JSON\.stringify\(path\.join\(KOREN, "client", "main\.js"\)/.test(t);
  if (!ucitava) continue;
  const brava = t.indexOf('process.argv.push("--no-lock")');
  const uvoz = t.indexOf('path.join(KOREN, "client", "main.js")');
  if (brava === -1) problemi.push(`${f}: pušta pravi launcher BEZ --no-lock`);
  else if (brava > uvoz) problemi.push(`${f}: --no-lock stoji POSLE učitavanja, kasno je`);
}
proveri("svaki alat koji pušta pravi launcher postavlja bravu", problemi.length === 0, problemi.join("; "));

const saZakljucaj = alati.filter((f) => /--zakljucaj/.test(fs.readFileSync(path.join(OVDE, f), "utf8")));
proveri("nijedan alat ne traži zaključavanje izričito", saZakljucaj.length === 0, saZakljucaj.join(", "));

// ---- 4) alat koji menja OVU mašinu se na njoj i ne pušta ----
//
// proba-podesavanja.mjs stvarno menja brzinu miša, ubrzanje pokazivača i jačinu
// zvuka na računaru na kom se pušta. Na mašini u igraonici je to u redu - tamo
// se to i proverava. Na računaru na kom se program piše nije: tamo čovek radi, a
// prekinuta proba bi mu ostavila promenjenog miša usred posla.
const podes = path.join(OVDE, "proba-podesavanja.mjs");
proveri("proba koja menja mašinu i dalje postoji", fs.existsSync(podes));
if (fs.existsSync(podes)) {
  const t = fs.readFileSync(podes, "utf8");
  proveri("jasno piše u zaglavlju šta menja",
    /MENJA PODESAVANJA MASINE|MENJA PODEŠAVANJA MAŠINE/i.test(t.slice(0, 2000)),
    "ko je pusti ne sme da bude iznenađen");
  proveri("sama sebe odbija na zaštićenom računaru",
    /CRIT-NE-DIRAJ\.txt[\s\S]{0,120}--ipak/.test(t),
    "inače `node pokreni-probe.mjs` menja miša na razvojnoj mašini");
  proveri("vraća zatečeno i kad se prekine (Ctrl+C)",
    /SIGINT[\s\S]{0,120}vratiSinhrono/.test(t),
    "finally ne hvata prekid, a proba tada stane sa vec promenjenim misem");
  proveri("vraćanje pri prekidu je sinhrono",
    /execFileSync/.test(t),
    "pri gasenju procesa se ne ceka na obecanja - asinhroni poziv bi bio zakazan i nikad izvrsen");

  // Ponašanjem: na OVOJ mašini mora da odbije ako je zaštićena.
  if (fs.existsSync(path.join(os.homedir(), "CRIT-NE-DIRAJ.txt"))) {
    const izlaz = execFileSync(process.execPath, [podes], { encoding: "utf8", cwd: OVDE });
    proveri("na ovom računaru se stvarno preskače", /PRESKOCENO/.test(izlaz), izlaz.slice(0, 200));
  } else {
    console.log("  (ovaj računar nije zaštićen - preskočena provera ponašanja;");
    console.log("   ako je ovo mašina na kojoj razvijaš, napravi ~/CRIT-NE-DIRAJ.txt)");
  }
}

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
