// Postavlja ili menja SERVISERSKI nalog.
//
//   node alati/serviser.mjs                    pokaže ko su serviseri
//   node alati/serviser.mjs <ime> <lozinka>    napravi ili promeni lozinku
//   node alati/serviser.mjs --ukloni <ime>     ukloni serviserski nalog
//
// ZAŠTO SE OVO RADI SKRIPTOM, A NE IZ PANELA
//
// Serviserski nalog stoji IZNAD vlasnika: vlasnik ga ne pravi i ne uklanja. Zato
// prvi takav nalog ne može da nastane kroz panel - neko bi morao da bude
// serviser da bi ga napravio, a na svežoj instalaciji servisera nema.
//
// Koren poverenja je pristup samom računaru na kom server radi. Ko može da
// pokrene ovu skriptu, taj već ima i bazu i sve u njoj - ništa se novo ne
// otvara. Zato je ovo i jedino pošteno mesto za takav nalog.
//
// Budimo iskreni do kraja: na računaru koji vlasnik fizički drži nijedna uloga
// nije neprobojna. Vlasnik može da otvori bazu i doda šta hoće. Ova podela
// postoji da bi uloge bile JASNE i da bi svaki potez bio ZAPISAN - ne da bi
// vlasnika zaključala iz sopstvenog računara.
//
// Pokreće se na glavnom računaru, iz korena projekta. Server sme da radi.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KOREN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Ista baza koju koristi i server (poštuje CRIT_DATA_DIR za probne instance).
const uvoz = (p) => import(pathToFileURL(path.join(KOREN, "server", "src", p)).href);
const { db } = await uvoz("db.js");
const { hashPassword } = await uvoz("auth.js");

const arg = process.argv.slice(2);
const spisak = () => db.prepare("SELECT username, active, created_at FROM admins WHERE role='serviser' ORDER BY username").all();

const pokazi = () => {
  const s = spisak();
  if (!s.length) {
    console.log("\nNema serviserskog naloga.\n");
    console.log("Napravi ga sa:  node alati/serviser.mjs <ime> <lozinka>\n");
    return;
  }
  console.log(`\nServiserski nalozi (${s.length}):\n`);
  for (const a of s) {
    console.log(`  ${a.username.padEnd(20)} ${a.active ? "aktivan" : "UGAŠEN "}  od ${new Date(a.created_at).toLocaleDateString("sr-Latn-RS")}`);
  }
  console.log("");
};

if (!arg.length) { pokazi(); process.exit(0); }

if (arg[0] === "--ukloni") {
  const ime = String(arg[1] || "").trim();
  if (!ime) { console.error("\nKoje ime?  node alati/serviser.mjs --ukloni <ime>\n"); process.exit(1); }
  const a = db.prepare("SELECT id, role FROM admins WHERE username=?").get(ime);
  if (!a) { console.error(`\nNalog "${ime}" ne postoji.\n`); process.exit(1); }
  if (a.role !== "serviser") { console.error(`\n"${ime}" nije serviserski nalog - ovom skriptom se dira samo serviser.\n`); process.exit(1); }
  // Poslednji serviser se ne uklanja u tišini: bez ijednog takvog naloga
  // podrška više ne može da uđe, a novi se pravi samo sa ovog računara.
  if (spisak().length <= 1) {
    console.error(`\nOvo je poslednji serviserski nalog. Ako ga ukloniš, podrška više ne može`);
    console.error(`da uđe dok ne dođeš na ovaj računar i ne napraviš nov.\n`);
    console.error(`Ako to stvarno hoćeš, prvo napravi drugi pa ukloni ovaj.\n`);
    process.exit(1);
  }
  db.prepare("DELETE FROM admin_tokens WHERE admin_id=?").run(a.id);
  db.prepare("UPDATE admins SET active=0 WHERE id=?").run(a.id);
  console.log(`\nNalog "${ime}" je ugašen. Prijava više ne radi.`);
  console.log("(Nalog se ne briše - smene i dopune moraju da ostanu potpisane.)\n");
  process.exit(0);
}

const ime = String(arg[0] || "").trim();
const lozinka = String(arg[1] || "");
if (!ime || !lozinka) {
  console.error("\nTreba i ime i lozinka:  node alati/serviser.mjs <ime> <lozinka>\n");
  process.exit(1);
}
if (lozinka.length < 8) {
  // Serviserski nalog vidi sve igraonice u kojima je postavljen. Ovde se ne
  // popušta kao kod PIN-a na kasi.
  console.error("\nLozinka servisera mora imati bar 8 znakova.\n");
  process.exit(1);
}

const postoji = db.prepare("SELECT id, role FROM admins WHERE username=?").get(ime);
if (postoji && postoji.role !== "serviser") {
  console.error(`\nNalog "${ime}" već postoji kao ${postoji.role === "owner" ? "vlasnik" : "radnik"}.`);
  console.error("Izaberi drugo ime - uloga se ne menja ovim putem.\n");
  process.exit(1);
}

if (postoji) {
  db.prepare("UPDATE admins SET password_hash=?, active=1 WHERE id=?").run(hashPassword(lozinka), postoji.id);
  // Nova lozinka odjavljuje stare prijave, isto kao i u panelu.
  db.prepare("DELETE FROM admin_tokens WHERE admin_id=?").run(postoji.id);
  console.log(`\nServiserskom nalogu "${ime}" je promenjena lozinka.\n`);
} else {
  db.prepare("INSERT INTO admins (username, password_hash, role, created_at) VALUES (?,?, 'serviser', ?)")
    .run(ime, hashPassword(lozinka), Date.now());
  console.log(`\nNapravljen serviserski nalog "${ime}".\n`);
}
db.prepare("INSERT INTO logs (ts, category, action, actor, target, detail) VALUES (?,?,?,?,?,?)")
  .run(Date.now(), "nalozi", "serviser", "sistem", ime,
    postoji ? "Promenjena lozinka serviserskog naloga (sa glavnog računara)" : "Napravljen serviserski nalog (sa glavnog računara)");

pokazi();
console.log("Prijava ide na isti panel, istim putem kao i vlasnik.\n");
