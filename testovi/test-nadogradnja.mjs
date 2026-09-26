import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
// Postojeca baza iz igraonice mora da preziveljava nadogradnju servera:
// nova tabela se sama pravi, a zatecni podaci ostaju netaknuti.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DATA = radniFolder("stara-baza");
const dbPath = path.join(DATA, "crit.db");

// Zatecena baza: prava baza iz igraonice ako postoji (server/data/crit.db),
// inace sveza. Prava baza nije u gitu (nalozi, lozinke, promet), pa je na klonu
// i na CI-ju nema. Put kroz nadogradnju je isti: tabela i kolona se svejedno
// skidaju nize.
const prava = path.join(KOREN, "server", "data", "crit.db");
if (fs.existsSync(prava)) {
  // Sveza kopija pri svakom pokretanju, da test bude ponovljiv.
  fs.copyFileSync(prava, dbPath);
  console.log("  (zatecena baza: prava iz server/data)");
} else {
  // Ucitavanje db.js samo po sebi napravi i popuni bazu. Ide u ZASEBNOM procesu:
  // u ovom bi ostalo kesirano na prvoj putanji, pa bi server ispod dizao drugu
  // bazu od one koju test gleda.
  const url = pathToFileURL(path.join(KOREN, "server", "src", "db.js")).href;
  execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`],
    { env: { ...process.env, CRIT_DATA_DIR: DATA }, stdio: "ignore" });
  console.log("  (zatecena baza: sveza - prave nema, ovo je klon ili CI)");
}

// Staro stanje se pravi ovde (tabela i indeksi se skidaju), jer je baza u
// projektu vec nadogradjena.
const stara = new DatabaseSync(dbPath);
for (const r of stara.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'ix_gl_%'").all())
  stara.exec(`DROP INDEX IF EXISTS ${r.name}`);
stara.exec("DROP TABLE IF EXISTS game_launches");
// Kolona "active" na nalozima je dosla u 2.34. Skida se da bi se glumila baza
// iz igraonice koja je jos na starijoj verziji.
try { stara.exec("ALTER TABLE admins DROP COLUMN active"); } catch {}
stara.close();

const pre = new DatabaseSync(dbPath, { readOnly: true });
const preStanje = {
  racunari: pre.prepare("SELECT COUNT(*) c FROM computers").get().c,
  tokeni: pre.prepare("SELECT token FROM computers ORDER BY name").all().map((r) => r.token).join(","),
  admini: pre.prepare("SELECT COUNT(*) c FROM admins").get().c,
  imaTabelu: !!pre.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_launches'").get(),
};
pre.close();

await podigniServer(DATA, 8100);

const posle = new DatabaseSync(dbPath, { readOnly: true });
const posleStanje = {
  racunari: posle.prepare("SELECT COUNT(*) c FROM computers").get().c,
  tokeni: posle.prepare("SELECT token FROM computers ORDER BY name").all().map((r) => r.token).join(","),
  admini: posle.prepare("SELECT COUNT(*) c FROM admins").get().c,
  imaTabelu: !!posle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_launches'").get(),
  indeksi: posle.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name LIKE 'ix_gl_%'").get().c,
  imaAktivan: posle.prepare("PRAGMA table_info(admins)").all().some((k) => k.name === "active"),
  neaktivnih: posle.prepare("SELECT COUNT(*) c FROM admins WHERE active IS NOT 1").get().c,
};
posle.close();

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

proveri("pre nadogradnje tabele nema", preStanje.imaTabelu === false);
proveri("posle pokretanja tabela postoji", posleStanje.imaTabelu === true);
proveri("indeksi napravljeni", posleStanje.indeksi === 2, String(posleStanje.indeksi));
proveri("broj racunara nepromenjen", preStanje.racunari === posleStanje.racunari, `${preStanje.racunari} -> ${posleStanje.racunari}`);
proveri("tokeni racunara nepromenjeni", preStanje.tokeni === posleStanje.tokeni);
proveri("nalozi osoblja nepromenjeni", preStanje.admini === posleStanje.admini, `${preStanje.admini} -> ${posleStanje.admini}`);

// ---- POSTOJECI NALOZI OSTAJU AKTIVNI ----
// Token se od 2.34 prihvata samo ako je nalog aktivan. Da migracija ne upise
// jedinicu zatecenim redovima, posle nadogradnje se NIKO ne bi mogao prijaviti
// na panel - ni vlasnik. To bi se videlo tek na otvaranju igraonice.
proveri("kolona za ugasen nalog je dodata", posleStanje.imaAktivan, "bez nje prijava puca");
proveri("svi zatecni nalozi ostaju aktivni", posleStanje.neaktivnih === 0,
  `${posleStanje.neaktivnih} naloga bi ostalo zakljucano posle nadogradnje`);

// i prijava stvarno radi kroz pravi API
const odgovor = await fetch("http://127.0.0.1:8100/api/login", { method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
proveri("vlasnik moze da se prijavi posle nadogradnje", !!odgovor.token, JSON.stringify(odgovor).slice(0, 120));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
