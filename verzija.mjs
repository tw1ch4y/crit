// Verzija projekta na svim mestima odjednom.
//
//   node verzija.mjs           ispiše gde koja stoji
//   node verzija.mjs 1.0.1     upiše svuda
//
// Verzija stoji u server/package.json (panel njome verzioniše CSS i JS) i u
// client/package.json (ime instalera; launcher je javlja serveru), i mora da
// se poklapa, inače napravi-paket.mjs odbija da napravi paket.
import fs from "node:fs";
import path from "node:path";

const KOREN = import.meta.dirname;
const MESTA = [
  { put: path.join(KOREN, "server", "package.json"), opis: "server + panel (verzija u adresama CSS/JS)" },
  { put: path.join(KOREN, "client", "package.json"), opis: "launcher + ime instalera" },
];

const procitaj = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const nova = (process.argv[2] || "").trim();

// Bez argumenta samo ispiše stanje.
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

// Format se proverava; electron-builder od neispravne verzije pravi instaler
// neispravnog imena.
if (!/^\d+\.\d+\.\d+$/.test(nova)) {
  console.error(`\nNeispravna verzija: "${nova}". Očekuje se oblik 1.0.1 (tri broja).\n`);
  process.exit(1);
}

const stara = procitaj(MESTA[0].put).version;
for (const m of MESTA) {
  // JSON.parse/stringify sa dva razmaka i završnim redom, kao što ga piše npm.
  const o = procitaj(m.put);
  o.version = nova;
  fs.writeFileSync(m.put, JSON.stringify(o, null, 2) + "\n");
  console.log(`  ${path.relative(KOREN, m.put)} -> ${nova}`);
}

console.log(`\nVerzija: ${stara} -> ${nova}\n`);
console.log("Dalje:");
console.log("  1. CHANGELOG.md: [Neobjavljeno] postaje [" + nova + "] sa današnjim datumom");
console.log("  2. cd client && npm run build      (instaler)");
console.log("  3. node napravi-paket.mjs          (paket za USB)\n");
