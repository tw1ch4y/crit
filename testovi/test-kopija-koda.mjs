import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { KOREN, radniFolder, brojac, citajIzvor } from "./_okruzenje.mjs";
// Kopija koda van razvojnog racunara (`git bundle`: sve grane i commitovi).
// Proverava se da se iz kopije moze vratiti ceo projekat, ne samo da fajl
// nastane.
const { proveri, kraj } = brojac();

const RADNO = radniFolder("kopija-koda");
const ALAT = path.join(KOREN, "alati", "kopija-koda.mjs");
const pusti = (...args) => spawnSync(process.execPath, [ALAT, ...args],
  { cwd: KOREN, encoding: "utf8" });

// ---- 1) ODREDISTE KOJE NE POSTOJI JE GRESKA ----
//
// Kad se USB iscupa, njegova putanja izgleda kao "folder koji samo treba
// napraviti". Napraviti ga znaci upisati kopiju na LOKALNI disk i javiti da je
// sve u redu - a to je tacno ono stanje od kog ova kopija stiti. Ista greska je
// vec jednom napravljena kod kopije baze van racunara.
const nema = path.join(RADNO, "nema-ovog-foldera");
const r1 = pusti(nema);
proveri("odrediste koje ne postoji se ODBIJA", r1.status !== 0, `izlazni kod ${r1.status}`);
proveri("i NE pravi se samo", !fs.existsSync(nema),
  "napravljen na lokalnom disku, izgledao bi kao uspela kopija");
proveri("greska kaze sta da se proveri", /USB|priključen/i.test(r1.stderr + r1.stdout), r1.stderr.slice(0, 100));

// Fajl umesto foldera se isto odbija.
const fajl = path.join(RADNO, "ovo-je-fajl.txt");
fs.writeFileSync(fajl, "x");
const r2 = pusti(fajl);
proveri("fajl umesto foldera se odbija", r2.status !== 0);

// ---- 2) KOPIJA SE PRAVI I MOZE DA SE VRATI ----
const usb = path.join(RADNO, "usb");
fs.mkdirSync(usb, { recursive: true });
const r3 = pusti(usb);
proveri("kopija se pravi", r3.status === 0, (r3.stderr || r3.stdout).slice(0, 150));

const kopije = fs.readdirSync(usb).filter((f) => f.endsWith(".bundle"));
proveri("nastao je jedan fajl", kopije.length === 1, kopije.join(", "));
proveri("ime nosi verziju i datum", /^crit-kod-\d+\.\d+\.\d+-\d{4}-\d{2}-\d{2}\.bundle$/.test(kopije[0] || ""),
  kopije[0]);

// Datum u imenu je po LOKALNOM vremenu. Po UTC-u bi kopija napravljena uvece
// nosila juceresnji datum, pa bi onaj ko je trazi gledao pogresan fajl.
const d = new Date();
const danas = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
proveri("datum je danasnji, po lokalnom vremenu", (kopije[0] || "").includes(danas), `${kopije[0]} vs ${danas}`);

// Iz kopije se vraca ceo projekat.
const vraceno = path.join(RADNO, "vraceno");
const klon = spawnSync("git", ["clone", "-q", path.join(usb, kopije[0]), vraceno], { encoding: "utf8" });
proveri("IZ KOPIJE SE KLONIRA CEO PROJEKAT", klon.status === 0, (klon.stderr || "").slice(0, 150));

const brojCommita = (dir) => execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
proveri("vracena je cela istorija", brojCommita(vraceno) === brojCommita(KOREN),
  `${brojCommita(vraceno)} od ${brojCommita(KOREN)} commita`);
proveri("vraceni projekat ima izvorni kod",
  fs.existsSync(path.join(vraceno, "server", "src", "service.js")) &&
  fs.existsSync(path.join(vraceno, "client", "main.js")) &&
  fs.existsSync(path.join(vraceno, "testovi", "pokreni-sve.mjs")));

// ---- 3) STARE KOPIJE SE PROREDJUJU ----
//
// Svaka je nekoliko megabajta, a odrediste je najcesce USB koji niko ne cisti.
for (let i = 1; i <= 6; i++) {
  const p = path.join(usb, `crit-kod-1.0.${i}-2020-01-0${i}.bundle`);
  fs.writeFileSync(p, "stara");
  const kada = new Date(2020, 0, i);
  fs.utimesSync(p, kada, kada);
}
const r4 = pusti(usb);
proveri("i drugi put prolazi", r4.status === 0, (r4.stderr || "").slice(0, 120));
const posle = fs.readdirSync(usb).filter((f) => f.endsWith(".bundle"));
proveri("cuva se poslednjih pet", posle.length === 5, `${posle.length}: ${posle.join(", ")}`);
proveri("najstarije su obrisane, nova je ostala",
  posle.some((f) => f.includes(danas)) && !posle.includes("crit-kod-1.0.1-2020-01-01.bundle"),
  posle.join(", "));

// ---- 4) upozorava na ono sto NE ulazi u kopiju ----
//
// Bundle nosi commitove, ne radni folder. Bolje da se to kaze odmah nego da se
// otkrije pri vracanju.
const alat = citajIzvor("alati/kopija-koda.mjs");
proveri("upozorava na necommitovane izmene", /status", "--porcelain/.test(alat) && /NEĆE ući u kopiju/.test(alat));
proveri("kopija se proverava pre nego sto se prijavi kao uspela",
  /bundle", "verify/.test(alat),
  "prekinut upis ostavlja fajl koji izgleda kao kopija, a otkrije se tek kad zatreba");
proveri("neispravna kopija se brise", /unlinkSync\(cilj\)/.test(alat),
  "inace bi pola fajla stajalo na USB-u kao da je kopija");
proveri("uzima SVE grane, ne samo tekucu", /"--all"/.test(alat));

kraj();
