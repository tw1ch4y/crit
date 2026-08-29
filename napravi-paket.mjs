// Pravi folder spreman za prenos na USB i postavljanje u igraonici.
// Pokretanje:  node napravi-paket.mjs
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = import.meta.dirname;
const OUT = path.join(path.dirname(ROOT), "CRIT-ZA-IGRAONICU");
const SRV = path.join(OUT, "1 - SERVER (glavni racunar)");
const CLI = path.join(OUT, "2 - LAUNCHER (racunari igraca)");

// Stari paket se brise pre novog. Windows to odbija ako je folder OTVOREN -
// dovoljno je da stoji u Explorer prozoru, u nekom terminalu ili da ga OneDrive
// bas sinhronizuje. Ranije je odatle letela EPERM greska sa stack trace-om, a
// iz nje se nije videlo ni sta je problem ni sta da se uradi.
try {
  fs.rmSync(OUT, { recursive: true, force: true });
} catch (e) {
  console.error(`\nNe mogu da obrišem stari paket:\n  ${OUT}\n`);
  console.error("Folder je otvoren negde. Zatvori Explorer prozor i terminal koji stoji u njemu,");
  console.error("sačekaj da OneDrive završi sinhronizaciju, pa pokreni ponovo.");
  console.error(`\n(${e.code || e.message})`);
  process.exit(1);
}
fs.mkdirSync(SRV, { recursive: true });
fs.mkdirSync(CLI, { recursive: true });

// ---- server ----
// _proba je alat za doradu izgleda launchera (testovi/pregled-launchera.mjs) -
// ne sme da ode u igraonicu ako ostane zaboravljen u public/.
const preskoci = new Set(["backups", "crit.db-wal", "crit.db-shm", "_proba"]);
function kopiraj(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (preskoci.has(e.name)) continue;
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) kopiraj(s, d);
    else fs.copyFileSync(s, d);
  }
}
for (const dir of ["src", "public", "node_modules", "data"]) {
  kopiraj(path.join(ROOT, "server", dir), path.join(SRV, dir));
}
for (const f of ["package.json", "Pokreni server.bat", "Otvori port u firewall-u.bat", "Podesi autostart.bat", "VRATI-KOPIJU.bat"]) {
  fs.copyFileSync(path.join(ROOT, "server", f), path.join(SRV, f));
}

// Paket nosi TAČNO slike koje baza koristi (koverice, baneri, promo, shop). Sve
// ostalo u uploads je orphan (npr. probni baneri ili slika izbačene igre) i
// samo bi opterećivalo paket - briše se iz kopije, izvor se ne dira.
{
  const pkgDb = new DatabaseSync(path.join(SRV, "data", "crit.db"));
  const referencirano = new Set();
  for (const [tab, kol] of [["games", "image"], ["games", "banner"], ["shop_items", "image"], ["tools", "image"], ["promo", "image"]]) {
    for (const r of pkgDb.prepare(`SELECT ${kol} v FROM ${tab} WHERE ${kol} IS NOT NULL AND ${kol} <> ''`).all()) {
      if (r.v) referencirano.add(path.basename(r.v));
    }
  }
  // Pozadine ekrana NISU u tabelama - stoje u settings kao pozadina_prijava,
  // pozadina_pocetna... Bez ovoga bi ih ciscenje orphana proglasilo za smece i
  // izbacilo iz paketa, pa bi launcher u igraonici ostao bez ijedne pozadine.
  for (const r of pkgDb.prepare("SELECT value v FROM settings WHERE key LIKE 'pozadina_%' AND value <> ''").all()) {
    if (r.v && r.v.startsWith("/uploads/")) referencirano.add(path.basename(r.v));
  }
  pkgDb.close();
  const pkgUploads = path.join(SRV, "public", "uploads");
  let orphana = 0;
  if (fs.existsSync(pkgUploads)) for (const f of fs.readdirSync(pkgUploads)) {
    if (!referencirano.has(f)) { fs.rmSync(path.join(pkgUploads, f), { force: true }); orphana++; }
  }
  if (orphana) console.log(`  uploads: izbaceno ${orphana} orphan slika (baza ih ne koristi)`);
}

// Provera da baza NIJE prazna/nepodesena. Jednom se desilo da je paket otisao
// sa svim funkcijama u kodu, ali baza bez banera/promo/upaljenog tocka - pa je
// launcher izgledao isto kao pre. Ovde se to uhvati pre nego sto ode na USB.
{
  const pdb = new DatabaseSync(path.join(SRV, "data", "crit.db"));
  const jedan = (sql) => pdb.prepare(sql).get().c;
  const post = (k) => pdb.prepare("SELECT value v FROM settings WHERE key=?").get(k)?.v;
  const brGames = jedan("SELECT COUNT(*) c FROM games");
  const brAlata = jedan("SELECT COUNT(*) c FROM tools WHERE available=1");
  const brShop = jedan("SELECT COUNT(*) c FROM shop_items WHERE available=1");
  const brPozadina = jedan("SELECT COUNT(*) c FROM settings WHERE key LIKE 'pozadina_%' AND value <> ''");
  const brNagrada = jedan("SELECT COUNT(*) c FROM tocak_nagrade");
  const brPaketa = jedan("SELECT COUNT(*) c FROM paketi WHERE available=1");
  const tekstura = post("tekstura");
  const tocak = post("tocak_ukljucen");
  pdb.close();
  // Provera prati ono sto launcher STVARNO prikazuje. Ranije je trazila promo
  // baner na vrhu pocetne - a vrh sada nosi znak kuce i nagradni tocak, pa je
  // svaki paket ispisivao upozorenje zbog necega sto je namerno izbaceno.
  const upozorenja = [];
  if (brGames === 0) upozorenja.push("nema nijedne igre");
  if (brAlata === 0) upozorenja.push("nema nijednog internet alata");
  if (brShop === 0) upozorenja.push("nijedan artikal u shopu nije vidljiv");
  if (brPozadina < 5) upozorenja.push(`samo ${brPozadina} od 5 pozadina ekrana (login bi razvlacio tudju sliku)`);
  if (!tekstura || tekstura === "nema") upozorenja.push("tekstura pozadine je iskljucena");
  if (tocak !== "1") upozorenja.push("nagradni tocak je iskljucen");
  else if (brNagrada === 0) upozorenja.push("tocak je upaljen ali nema nijednu nagradu");
  if (brPaketa === 0) upozorenja.push("nema nijednog vremenskog paketa (5h za 500)");
  if (upozorenja.length) {
    console.log("\n  PAZI - baza mozda nije spremna za rad:");
    for (const u of upozorenja) console.log("    - " + u);
    console.log("  Pokreni prvo:  node postavi-bazu.mjs   pa opet napravi paket.\n");
  }
}

// ---- launcher ----
const dist = path.join(path.dirname(ROOT), "crit", "dist");
// U dist-u ostaju i stariji instaleri, pa uzimamo najskorije napravljen -
// inace bi paket tiho poneo prethodnu verziju launchera.
const setup = fs.readdirSync(dist)
  .filter((f) => f.startsWith("Crit Launcher Setup") && f.endsWith(".exe"))
  .map((f) => ({ f, vreme: fs.statSync(path.join(dist, f)).mtimeMs }))
  .sort((a, b) => b.vreme - a.vreme)[0]?.f;
if (!setup) { console.error("Nema instalera u dist/ - pokreni prvo build launchera."); process.exit(1); }

// Instaler MORA da bude one verzije koja pise u client/package.json.
// Ako build pukne (npr. zakljucan fajl dok OneDrive sinhronizuje dist/), u
// dist/ ostane prethodni instaler - a ovaj bi ga tiho spakovao i poslao u
// igraonicu. Tako je vec dvaput ispalo da se "nista nije promenilo": paket je
// nosio staru verziju launchera, a niko to nije video dok se ne instalira.
{
  const verzija = JSON.parse(fs.readFileSync(path.join(ROOT, "client", "package.json"), "utf8")).version;
  const uImenu = /Crit Launcher Setup ([\d.]+)\.exe$/.exec(setup)?.[1];
  if (uImenu !== verzija) {
    console.error(`\n  STOP - instaler ne odgovara verziji projekta.`);
    console.error(`    client/package.json:  ${verzija}`);
    console.error(`    najnoviji u dist/:    ${uImenu || setup}`);
    console.error(`  Build launchera nije prosao. Pokreni:  cd client && npm run build`);
    console.error(`  Paket NIJE napravljen - da u igraonicu ne ode stara verzija.\n`);
    process.exit(1);
  }
}
fs.copyFileSync(path.join(dist, setup), path.join(CLI, setup));

// Stari instaleri se brisu. Svaki je oko 100 MB, a build ih ostavlja sve -
// posle petnaestak verzija to je vise od gigabajta. Projekat stoji u OneDrive
// folderu, pa se sve to jos i sinhronizuje u oblak.
// Cuvaju se poslednja DVA: tekuci i prethodni, da moze da se vrati unazad.
const CUVA_SE = 2;
const sviInstaleri = fs.readdirSync(dist)
  .filter((f) => f.startsWith("Crit Launcher Setup") && f.endsWith(".exe"))
  .map((f) => ({ f, vreme: fs.statSync(path.join(dist, f)).mtimeMs }))
  .sort((a, b) => b.vreme - a.vreme);
let oslobodjeno = 0, obrisano = 0;
for (const { f } of sviInstaleri.slice(CUVA_SE)) {
  try {
    oslobodjeno += fs.statSync(path.join(dist, f)).size;
    fs.rmSync(path.join(dist, f), { force: true });
    fs.rmSync(path.join(dist, f + ".blockmap"), { force: true });
    obrisano++;
  } catch {}
}
for (const f of ["POPRAVI-RACUNAR.bat", "DEINSTALIRAJ-LAUNCHER.bat"]) {
  fs.copyFileSync(path.join(ROOT, f), path.join(CLI, f));
}

// Sara i animacija se ukljucuju u samom serveru (seed u db.js, samo ako nikad
// nisu birani), pa ovde nema sta da se dira - vazi i za svezu instalaciju i za
// vec postojecu bazu koja se nadogradjuje.

// ---- spisak tokena (da se ne prepisuju iz panela jedan po jedan) ----
const db = new DatabaseSync(path.join(ROOT, "server", "data", "crit.db"));
const pcs = db.prepare("SELECT name, token FROM computers ORDER BY name").all();
const tokeni = [
  "TOKENI RACUNARA",
  "=================",
  "",
  "Svaki racunar dobija SVOJ token. Unosi se u launcher pri prvom pokretanju.",
  "",
  "Adresa servera koja se nudi je PRIMER: http://192.168.1.100:8095",
  "Ako glavni racunar ima drugu IP adresu, prekucaj je na tom ekranu.",
  "Za probu na istom racunaru gde je server:  http://127.0.0.1:8095",
  "",
  ...pcs.map((p) => `${p.name}   ${p.token}`),
  "",
  "Ako promenis broj racunara, tokeni se vide u panelu: Racunari.",
].join("\r\n");
fs.writeFileSync(path.join(CLI, "TOKENI.txt"), tokeni, "utf8");

// ---- uputstva ----
for (const f of ["POKRETANJE.md", "DEPLOY.md", "README.md", "PROVERI.md"]) {
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
}

// ---- sabloni za dizajn slika ----
kopiraj(path.join(ROOT, "assets", "sabloni"), path.join(OUT, "SABLONI ZA DIZAJN"));

const readme = [
  "CRIT - postavljanje u igraonici",
  "================================",
  "",
  "Panel prijava:  admin / admin  (promeni odmah u Podesavanjima)",
  "",
  "PAZNJA: adresa http://192.168.1.100:8095 je SAMO PRIMER, upisana unapred.",
  "Ako glavni racunar ima drugu IP adresu, launcher se nece povezati dok je",
  "ne promenis - vidi 'Ako nesto zapne' na dnu.",
  "",
  "",
  "BRZA PROBA NA JEDNOM RACUNARU",
  "-----------------------------",
  "Da vidis kako sve radi pre nego sto krenes po svih 13 racunara. Server i",
  "launcher idu na ISTOM racunaru, ne dira se ni firewall ni autostart.",
  "",
  "1. Instaliraj Node.js sa https://nodejs.org (dugme LTS, sve dalje-dalje).",
  "2. Iz foldera '1 - SERVER' pokreni 'Pokreni server.bat'. Ostavi taj prozor",
  "   otvoren - dok je otvoren, server radi.",
  "3. Otvori http://localhost:8095 u pregledacu i prijavi se sa admin / admin.",
  "   Ovo je panel - odavde se sve podesava.",
  "4. Instaliraj 'Crit Launcher Setup' i pokreni ga.",
  "5. Na prvom ekranu OBRISI ponudjenu adresu i upisi:  http://127.0.0.1:8095",
  "   Token uzmi iz TOKENI.txt (bilo koji red, npr. za PC-01).",
  "6. Launcher se povezuje i staje na ekran za prijavu.",
  "7. U panelu (Igraci) napravi igraca, dopuni mu kredit, pa se tim nalogom",
  "   prijavi u launcheru.",
  "",
  "Sta vredi probati:",
  "  - dodaj igru i internet precicu u panelu, pa pogledaj kako izgledaju",
  "  - poruci pice iz launchera i vidi kako stize u panel (Porudzbine)",
  "  - zakljucaj i otkljucaj racunar iz panela",
  "  - ugasi server (zatvori prozor) i vidi sta launcher pise igracu",
  "  - vrati server i vidi da se sesija nastavlja",
  "",
  "Izlaz iz launchera dok probas:  Ctrl+Alt+Shift+Q, pa PIN (podrazumevano 1234).",
  "Otkljucavanje zakljucanog racunara:  Ctrl+Alt+U, pa isti PIN.",
  "Zastitu (korak 5 u delu za racunare igraca) NE ukljucuj dok samo probas.",
  "",
  "",
  "GLAVNI RACUNAR (server)",
  "-----------------------",
  "1. Instaliraj Node.js sa https://nodejs.org (dugme LTS, sve dalje-dalje).",
  "2. Prekopiraj folder \"1 - SERVER\" na taj racunar, npr. u C:\\Crit\\server",
  "3. Proveri da racunar ima IP adresu 192.168.1.100.",
  "   (Najbolje je zakucati je u ruteru - DHCP rezervacija.)",
  "4. Pokreni \"Otvori port u firewall-u.bat\"  (desni klik - Run as administrator)",
  "5. Pokreni \"Pokreni server.bat\"",
  "6. Pokreni \"Podesi autostart.bat\"",
  "7. Otvori http://localhost:8095 i prijavi se.",
  "",
  "",
  "RACUNARI IGRACA (launcher)",
  "--------------------------",
  "1. Na svakom racunaru napravi POSEBAN Windows nalog za igrace - STANDARDNI,",
  "   ne administrator. Program se pokrece na tom nalogu.",
  "2. Instaliraj \"Crit Launcher Setup\".",
  "3. Pokreni launcher. Adresa servera je vec popunjena - unesi samo TOKEN",
  "   za taj racunar (spisak je u TOKENI.txt).",
  "4. U panelu ce taj racunar preci iz Offline u Standby.",
  "5. Kad sve radi, ukljuci zastitu: u instalacionom folderu, podfolder",
  "   \"resources\", desni klik na \"zastita-ukljuci.bat\" - Run as administrator.",
  "",
  "",
  "OBAVEZNO PRE OTVARANJA - TRI FABRICKE LOZINKE",
  "---------------------------------------------",
  "1. Panel:  admin / admin",
  "     Promeni odmah - panel se otvara sa svakog telefona na mrezi, a preko",
  "     njega se dopunjuje kredit. Klikni na svoje ime dole levo.",
  "2. PIN osoblja:  1234   (panel > Podesavanja)",
  "     Njime se otkljucava racunar i izlazi iz launchera.",
  "3. Servisni PIN:  1234   (\"servisniPin\" u podesavanja.json, pored programa)",
  "     Trazi se za ulaz u podesavanja launchera i za izlaz KAD SERVER NE RADI.",
  "     Proverava se lokalno. Bez promene, igrac koji iscupa mrezni kabl moze",
  "     posle par sekundi da preusmeri racunar na svoj server.",
  "",
  "",
  "AKO NESTO ZAPNE",
  "---------------",
  "- Launcher stoji na \"Povezivanje...\"",
  "    -> nije otvoren port na serveru (korak 4) ili server nije pokrenut",
  "    -> proveri da je adresa servera bas 192.168.1.100",
  "- Treba promeniti adresu servera na svim racunarima",
  "    -> izmeni \"podesavanja.json\" u podfolderu resources i reinstaliraj",
  "    -> na jednom racunaru, bez reinstalacije: sacekaj da se pojavi",
  "       \"Promeni adresu servera\" pa ukucaj SERVISNI PIN",
  "- Server ne radi, a treba izaci iz launchera",
  "    -> Ctrl+Alt+Shift+Q pa SERVISNI PIN (radi i bez servera)",
  "- Racunar se zakljucao, ne mozes do Windows-a",
  "    -> POPRAVI-RACUNAR.bat  ili  DEINSTALIRAJ-LAUNCHER.bat (kao administrator)",
  "",
  "Detaljno uputstvo: POKRETANJE.md i DEPLOY.md",
  "Spisak sta da proveris pre otvaranja: PROVERI.md",
].join("\r\n");
fs.writeFileSync(path.join(OUT, "PROCITAJ ME.txt"), readme, "utf8");

// ---- folder za probu na jednom racunaru ----
// Launcher je za igraonicu, pa mu je ciscenje sesije upaljeno: kad se igrac
// odjavi, odjavljuje Steam, Epic, Riot, Battle.net i pregledace. Na racunaru na
// kome se samo proba to obrise TUDJE prijave, i to se ne moze vratiti. Zato uz
// probu ide skripta koja to iskljuci, i druga koja vrati kad proba prodje.
const PROBA = path.join(OUT, "0 - PROBA NA JEDNOM RACUNARU");
kopiraj(path.join(ROOT, "assets", "proba"), PROBA);

const igre = db.prepare("SELECT name, path, image, banner FROM games ORDER BY id").all();
const alati = db.prepare("SELECT name, kind, target FROM tools ORDER BY id").all();
const artikli = db.prepare("SELECT COUNT(*) n FROM shop_items").get().n;
const igraca = db.prepare("SELECT COUNT(*) n FROM players").get().n;
// Putanja koja ne pocinje diskom ili protokolom nije putanja - takvu igru
// launcher nece pokrenuti, a to je najcesci uzrok "ne radi mi nista".
const sumnjive = igre.filter((g) => !/^([a-z]:[\\/]|[a-z][a-z0-9+.-]*:\/\/|\\\\)/i.test(String(g.path || "").trim()));

const uputstvoProbe = [
  "PROBA NA JEDNOM RACUNARU",
  "========================",
  "",
  "Server i launcher idu na ISTOM racunaru. Ne dira se ni firewall ni",
  "autostart, ni zastita kioska.",
  "",
  "",
  "PRE POCETKA - PROCITAJ",
  "----------------------",
  "Launcher je napravljen za igraonicu, pa mu je CISCENJE SESIJE upaljeno:",
  "kad se igrac odjavi, odjavljuje Steam, Epic, Riot, Battle.net i sve",
  "pregledace na tom Windows nalogu. To se NE MOZE vratiti.",
  "",
  "Ako probas na racunaru na kome imas svoje prijave, obavezno prvo",
  "pokreni \"1 - BEZBEDAN REZIM ZA PROBU.bat\" (kao administrator).",
  "",
  "",
  "KORACI",
  "------",
  "1. Instaliraj Node.js sa https://nodejs.org (dugme LTS, sve dalje-dalje).",
  "",
  "2. Iz foldera \"1 - SERVER\" pokreni \"Pokreni server.bat\".",
  "   Ostavi taj prozor otvoren - dok je otvoren, server radi.",
  "",
  "3. Otvori http://localhost:8095 i prijavi se: admin / admin",
  "   To je panel, odatle se sve podesava.",
  "",
  `4. Instaliraj "${setup}" iz foldera "2 - LAUNCHER".`,
  "",
  "5. Desni klik na \"1 - BEZBEDAN REZIM ZA PROBU.bat\" - Run as administrator.",
  "   Iskljucuje ciscenje i postavlja adresu na 127.0.0.1:8095.",
  "",
  "6. (PREPORUKA) Dupli klik na \"3 - DEMO PODACI (opciono).bat\".",
  "   Napuni server tako da launcher ODMAH izgleda kompletno: baneri,",
  "   promo, pun shop, upaljen tocak, i demo igrac 'test'.",
  "",
  "7. Pokreni Crit Launcher. Adresa je vec popunjena, unesi samo token:",
  `     ${pcs[0]?.name || "PC-01"}   ${pcs[0]?.token || "(vidi TOKENI.txt)"}`,
  "",
  "8. U launcheru se prijavi kao:  test  /  test1234",
  "   (ako nisi pustio demo podatke: u panelu -> Igraci -> Novi nalog,",
  "    dopuni kredit, pa se tim imenom prijavi)",
  "",
  "",
  "PRECICE NA TASTATURI",
  "--------------------",
  "Ctrl+Alt+Shift+Q    izlaz iz launchera (pa PIN, podrazumevano 1234)",
  "Ctrl+Alt+U          otkljucavanje zakljucanog racunara (isti PIN)",
  "Ctrl+Alt+Home       vrati launcher u prvi plan",
  "",
  "",
  "STA VREDI PROBATI",
  "-----------------",
  "  OSNOVNO:",
  "  - pokreni igru iz launchera (vidi spisak putanja nize)",
  "  - poruci pice, pa pogledaj kako stize u panel (Porudzbine)",
  "  - zakljucaj i otkljucaj racunar iz panela",
  "  - zatvori prozor servera i vidi sta launcher pise igracu",
  "  - vrati server i vidi da se sesija nastavlja tamo gde je stala",
  "  - pusti da kredit dodje do nule i vidi sta se desava",
  "",
  "  NAGRADNI TOCAK (igrac 'test' vec ispunjava uslov):",
  "  - u launcheru: NALOG -> Nagradni tocak -> ZAVRTI",
  "  - u panelu: Podesavanja -> Nagradni tocak (prag, nagrade, upali/ugasi)",
  "  - probaj igraca bez potrosnje - vidi traku 'Potroseno X od 1200'",
  "",
  "  VREMENSKI PAKETI (5h za 500):",
  "  - u panelu: Igraci -> 'test' -> Dopuni -> klikni dugme paketa",
  "  - u panelu: Podesavanja -> Vremenski paketi (dodaj npr. 10h)",
  "",
  "  IZGLED I IZVESTAJI:",
  "  - Izvestaji -> promet po satu, kes/kredit podela, Izvoz u CSV",
  "  - Izgled launchera -> promeni teksturu / napravi CRIT baner",
  "  - Igre -> klikni 'baner' na kartici da napravis privremeni baner",
  "  - Internet alati -> svih 9 alata sa originalnim logotipima",
  "",
  "",
  "STA JE VEC U BAZI",
  "-----------------",
  `Racunara: ${pcs.length}     Igara: ${igre.length}     Internet alata: ${alati.length}`,
  `Artikala u shopu: ${artikli}     Naloga igraca: ${igraca}`,
  "",
  "Igre (putanja mora da postoji na ovom racunaru da bi se pokrenula):",
  ...igre.map((g) => `  ${g.name.padEnd(22)} ${g.path}${g.image ? "" : "   [BEZ OMOTA]"}`),
  "",
  "Internet alati:",
  ...alati.map((t) => `  ${t.name.padEnd(22)} ${t.target}`),
  "",
  ...(sumnjive.length ? [
    "PAZI - ove putanje ne izgledaju kao putanje, launcher ih nece pokrenuti:",
    ...sumnjive.map((g) => `  ${g.name} -> ${g.path}`),
    "Popravi ih u panelu, strana Igre.",
    "",
  ] : []),
  "Igre ocekuju precice u C:\\games. Ako ih tamo nema, ili se drugacije",
  "zovu, launcher javlja \"nije instalirana\" - a to nije greska launchera.",
  "Precice se ispravljaju u panelu, strana Igre.",
  "",
  "",
  "KAD PROBA PRODJE",
  "----------------",
  "Pokreni \"2 - VRATI NA IGRAONICU.bat\" (kao administrator) i upisi IP",
  "adresu glavnog racunara. Vraca ciscenje sesije i blokadu preuzetih",
  "programa, i postavlja pravu adresu servera.",
  "",
  "Dalje po uputstvu u \"PROCITAJ ME.txt\" u glavnom folderu.",
].join("\r\n");
fs.writeFileSync(path.join(PROBA, "PROCITAJ PRVO.txt"), uputstvoProbe, "utf8");

// ---- izvestaj ----
function velicina(p) {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    n += e.isDirectory() ? velicina(f) : fs.statSync(f).size;
  }
  return n;
}
console.log("Paket napravljen:", OUT);
console.log("  velicina:", (velicina(OUT) / 1024 / 1024).toFixed(0), "MB");
console.log("  racunara u bazi:", pcs.length);
console.log("  instaler:", setup);
if (obrisano) {
  console.log(`  ociscen dist: obrisano ${obrisano} starih instalera, oslobodjeno ${(oslobodjeno / 1073741824).toFixed(2)} GB`);
}
