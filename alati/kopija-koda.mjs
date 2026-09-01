// CEO PROJEKAT SA ISTORIJOM, U JEDAN FAJL, VAN OVOG RAČUNARA
//
//   node alati/kopija-koda.mjs D:\kopije      napravi kopiju na to odredište
//   node alati/kopija-koda.mjs                pokaži gde su dosadašnje kopije
//
// ZAŠTO POSTOJI
//
// Baza igraonice ide van računara sama (Podešavanja > Kopija van računara), i to
// je rešeno. Ali SAM PROGRAM - izvorni kod i cela istorija izmena - postoji samo
// na jednom disku, na razvojnom laptopu. Otkaz tog diska znači da igraonica
// nastavi da radi (server je na drugoj mašini), a da se program više ne može ni
// ispraviti ni nadograditi.
//
// Pravo rešenje je privatni repozitorijum na tuđem serveru. Ovo nije zamena za
// njega nego ono što radi ODMAH, bez ijednog naloga: `git bundle` je jedan fajl
// koji sadrži sve grane i sve commitove, i iz njega se klonira kao iz pravog
// repozitorijuma.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const KOREN = path.join(import.meta.dirname, "..");
const CUVA_SE = 5; // koliko poslednjih kopija ostaje na odredištu

const git = (...args) => execFileSync("git", args, { cwd: KOREN, encoding: "utf8" }).trim();

let odrediste = (process.argv[2] || "").trim().replace(/^"|"$/g, "");

// ODREDIŠTE KOJE NE POSTOJI JE GREŠKA, NE POZIV DA SE NAPRAVI.
//
// Isto pravilo kao za kopiju baze van računara, i iz istog razloga: kad se USB
// iščupa ili se mrežni disk odjavi, njegova putanja izgleda kao "folder koji
// samo treba napraviti". Napraviti ga znači napisati kopiju na LOKALNI disk i
// javiti da je sve u redu - a to je tačno ono stanje od kog ova kopija štiti.
function proveriOdrediste(p) {
  if (!fs.existsSync(p)) {
    console.error(`\nOdredište ne postoji:\n  ${p}\n`);
    console.error("Ako je USB - proveri da li je priključen i da li je isto slovo diska.");
    console.error("Folder se NAMERNO ne pravi sam: napravljen na lokalnom disku,");
    console.error("izgledao bi kao uspela kopija, a bio bi na istom disku od kog čuva.\n");
    process.exit(1);
  }
  if (!fs.statSync(p).isDirectory()) {
    console.error(`\nOdredište nije folder:\n  ${p}\n`);
    process.exit(1);
  }
}

const IME = /^crit-kod-(.+)\.bundle$/;
const spisak = (p) => fs.readdirSync(p).filter((f) => IME.test(f))
  .map((f) => ({ f, ...fs.statSync(path.join(p, f)) }))
  .sort((a, b) => b.mtimeMs - a.mtimeMs);

if (!odrediste) {
  console.log("\nKopija koda van računara\n");
  console.log("  node alati/kopija-koda.mjs <folder>     npr. D:\\kopije\n");
  const verzija = JSON.parse(fs.readFileSync(path.join(KOREN, "server", "package.json"), "utf8")).version;
  console.log(`  verzija:  ${verzija}`);
  console.log(`  commita:  ${git("rev-list", "--count", "HEAD")}`);
  try {
    const daljinski = git("remote").split("\n").filter(Boolean);
    console.log(daljinski.length
      ? `  daljinski: ${daljinski.join(", ")} - kod je i tamo, ovo je dodatna kopija`
      : "  daljinski: NEMA - kod postoji SAMO na ovom disku");
  } catch {}
  console.log("");
  process.exit(0);
}

odrediste = path.resolve(odrediste);
proveriOdrediste(odrediste);

// Nesačuvane izmene ne ulaze u bundle - on nosi commitove, ne radni folder.
// Bolje da se to kaže sada nego da se otkrije pri vraćanju.
const prljavo = git("status", "--porcelain");
if (prljavo) {
  console.log("\nPAŽNJA: ima izmena koje nisu commitovane. One NEĆE ući u kopiju:");
  for (const red of prljavo.split("\n").slice(0, 10)) console.log("  " + red);
  console.log("");
}

const verzija = JSON.parse(fs.readFileSync(path.join(KOREN, "server", "package.json"), "utf8")).version;
// Datum po LOKALNOM vremenu. `toISOString` je po UTC-u, pa bi kopija napravljena
// uveče nosila jučerašnji datum - i onaj ko je traži gledao bi pogrešan fajl.
const d = new Date();
const datum = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ime = `crit-kod-${verzija}-${datum}.bundle`;
const cilj = path.join(odrediste, ime);

console.log(`\nPravim kopiju: ${ime}`);
// --all: sve grane i oznake, ne samo tekuća.
git("bundle", "create", cilj, "--all");

// KOPIJA KOJA SE NE MOŽE VRATITI NIJE KOPIJA.
//
// `git bundle verify` čita fajl i proverava da je ceo i upotrebljiv. Bez toga bi
// prekinut upis (pun disk, iščupan USB nasred pisanja) ostavio fajl koji izgleda
// kao kopija i otkrije se tek onog dana kad zatreba.
try {
  execFileSync("git", ["bundle", "verify", cilj], { cwd: KOREN, stdio: "pipe" });
} catch (e) {
  try { fs.unlinkSync(cilj); } catch {}
  console.error("\nKopija nije ispravna i obrisana je. Proveri prostor na odredištu.\n");
  console.error(String(e.stderr || e.message).slice(0, 300));
  process.exit(1);
}

const mb = (fs.statSync(cilj).size / 1048576).toFixed(1);
console.log(`  ${cilj}`);
console.log(`  ${mb} MB, ${git("rev-list", "--count", "HEAD")} commita, sve grane\n`);

// Starije kopije se proređuju - svaka je desetak megabajta, a odredište je
// najčešće USB koji niko ne čisti.
const sve = spisak(odrediste);
let obrisano = 0;
for (const { f } of sve.slice(CUVA_SE)) {
  try { fs.unlinkSync(path.join(odrediste, f)); obrisano++; } catch {}
}
if (obrisano) console.log(`  starih kopija obrisano: ${obrisano} (čuva se poslednjih ${CUVA_SE})\n`);

console.log("Vraćanje na bilo kom računaru sa git-om:");
console.log(`  git clone "${cilj}" crit\n`);
