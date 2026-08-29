// Pusta sve suite jednu za drugom i na kraju kaze da li sistem drzi.
// Svaka suita dize svoj server na svom portu i svoju bazu, prava baza se ne dira.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const suite = fs.readdirSync(OVDE)
  .filter((f) => f.startsWith("test-") && f.endsWith(".mjs"))
  .sort();

const pokreni = (f) => new Promise((res) => {
  const p = spawn(process.execPath, [path.join(OVDE, f)], { cwd: OVDE });
  let izlaz = "";
  p.stdout.on("data", (d) => (izlaz += d));
  p.stderr.on("data", (d) => (izlaz += d));
  p.on("close", (kod) => res({ kod, izlaz }));
});

console.log("CRIT - provera sistema\n");
let ukupnoProslo = 0, ukupnoPalo = 0;
const palo = [];

for (const f of suite) {
  const { kod, izlaz } = await pokreni(f);
  const rez = izlaz.match(/(\d+)\/(\d+) proslo/);
  const naziv = f.replace(/^test-|\.mjs$/g, "");
  if (rez) {
    const [, a, b] = rez.map(Number);
    ukupnoProslo += a;
    ukupnoPalo += b - a;
    console.log(`  ${kod === 0 ? "OK  " : "PAO "} ${naziv.padEnd(20)} ${a}/${b}`);
    if (kod !== 0) palo.push({ naziv, izlaz });
  } else {
    console.log(`  PAO  ${naziv.padEnd(20)} nije se ni pokrenuo`);
    ukupnoPalo++;
    palo.push({ naziv, izlaz });
  }
}

for (const { naziv, izlaz } of palo) {
  console.log(`\n--- ${naziv} ---`);
  console.log(izlaz.split("\n").filter((l) => l.includes("PAO") || l.includes("Error")).join("\n"));
}

console.log(`\nukupno: ${ukupnoProslo} proslo, ${ukupnoPalo} palo`);
if (!ukupnoPalo) {
  // Radne baze ostaju samo kad ima sta da se gleda, da ne stoje u folderu bez potrebe.
  //
  // Brisanje ne sme da obori pokretac: ako je server za pregled jos upaljen, on
  // drzi svoju bazu otvorenom i Windows ne da da se folder obrise. Ranije je tu
  // letela EPERM greska sa stack trace-om POSLE sto su svi testovi prosli - pa
  // je izlazni kod govorio da je palo, a nista nije palo.
  try {
    fs.rmSync(path.join(OVDE, ".radno"), { recursive: true, force: true });
  } catch {
    console.log("(radne baze nisu obrisane - verovatno je server za pregled jos upaljen)");
  }
  console.log("Sistem je ispravan.");
} else {
  console.log("Radne baze su ostale u testovi/.radno za pregled.");
}
process.exit(ukupnoPalo ? 1 : 0);
