// Menja verziju projekta na SVA mesta odjednom.
//
//   node verzija.mjs           samo ispiše gde koja stoji
//   node verzija.mjs 1.0.1    upiše svuda
//
// ZAŠTO POSTOJI
//
// Verzija stoji na dva mesta koja moraju da se poklapaju: `server/package.json`
// (odatle je čita panel i njome verzionira CSS i JS, da pregledač posle
// nadogradnje ne servira staru stranu) i `client/package.json` (odatle je čita
// electron-builder i njome imenuje instaler, a launcher je šalje serveru pa se
// u panelu vidi koji računar ima koju).
//
// Dok se to radilo ručno, promašaj se dešavao redovno: podigne se server,
// zaboravi klijent, i onda `napravi-paket.mjs` odbije da napravi paket jer se
// ime instalera ne poklapa sa projektom. Greška se pri tom vidi tek na kraju,
// posle celog build-a - a to je nekoliko minuta izgubljenih na prekucavanje
// jednog broja.
import fs from "node:fs";
import path from "node:path";

const KOREN = import.meta.dirname;
const MESTA = [
  { put: path.join(KOREN, "server", "package.json"), opis: "server + panel (verzija u adresama CSS/JS)" },
  { put: path.join(KOREN, "client", "package.json"), opis: "launcher + ime instalera" },
];

const procitaj = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const nova = (process.argv[2] || "").trim();

// Bez argumenta samo pokaži stanje - da se "gde ono beše stoji verzija" ne
// pretvara u pretragu po projektu.
if (!nova) {
  console.log("\nVerzija po mestima:\n");
  const vrednosti = new Set();
  for (const m of MESTA) {
    const v = procitaj(m.put).version;
    vrednosti.add(v);
    console.log(`  ${v.padEnd(10)} ${path.relative(KOREN, m.put).padEnd(22)} ${m.opis}`);
  }
  console.log(vrednosti.size === 1
    ? `\nSve se poklapa (${[...vrednosti][0]}).\n\nZa novu verziju:  node verzija.mjs 1.0.1\n`
    : `\nNE POKLAPA SE. Paket neće moći da se napravi dok je ovako.\nIspravi sa:  node verzija.mjs <verzija>\n`);
  process.exit(vrednosti.size === 1 ? 0 : 1);
}

// Format se proverava, jer electron-builder od neispravne verzije pravi
// instaler čudnog imena i to se otkrije tek pri pakovanju.
if (!/^\d+\.\d+\.\d+$/.test(nova)) {
  console.error(`\nNeispravna verzija: "${nova}". Očekuje se oblik 1.0.1 (tri broja).\n`);
  process.exit(1);
}

const stara = procitaj(MESTA[0].put).version;
for (const m of MESTA) {
  // Fajl se prepisuje kroz JSON.parse/stringify sa dva razmaka i završnim redom
  // - tačno onako kako ga npm i sam piše, pa razlika u git-u ostaje jedna linija.
  const o = procitaj(m.put);
  o.version = nova;
  fs.writeFileSync(m.put, JSON.stringify(o, null, 2) + "\n");
  console.log(`  ${path.relative(KOREN, m.put)} -> ${nova}`);
}

// UPUTSTVO ZA OBILAZAK TAKOĐE NOSI VERZIJU, I TO NA PET MESTA.
//
// `SLEDECI-KORACI.md` se čita rukom, pred trinaest mašina: u njemu piše koji se
// instaler pokreće i koja verzija mora da stoji u panelu posle toga. Dok se
// menjao ručno, zaostajao je iza koda - pa je uputstvo tražilo 1.0.1, a u
// paketu je stajao 2.49.0. Čovek koji to zatekne ili prekuca pogrešno ili
// pomisli da je uzeo pogrešan paket, i to usred obilaska.
//
// Menja se SAMO puna verzija u tekstu; sve ostalo se ne dira.
{
  const put = path.join(KOREN, "SLEDECI-KORACI.md");
  try {
    const pre = fs.readFileSync(put, "utf8");
    const posle = pre.replaceAll(stara, nova);
    if (posle !== pre) {
      fs.writeFileSync(put, posle);
      const koliko = pre.split(stara).length - 1;
      console.log(`  SLEDECI-KORACI.md -> ${nova} (${koliko} ${koliko === 1 ? "mesto" : "mesta"})`);
    }
  } catch {}
}

console.log(`\nVerzija: ${stara} -> ${nova}\n`);
console.log("Dalje:");
console.log("  1. cd client && npm run build      (instaler)");
console.log("  2. node napravi-paket.mjs          (paket za USB)");
console.log("  3. upiši šta je novo u PLAN.md\n");
