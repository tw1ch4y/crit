// Pravi folder spreman za prenos na USB i postavljanje u igraonici.
// Pokretanje:  node napravi-paket.mjs
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const ROOT = import.meta.dirname;
// Ime igraonice stoji na jednom mestu (igraonica.json). Ovaj alat pravi i
// UPUTSTVO koje ide u igraonicu, pa ono mora da nosi njeno ime, a ne tudje.
const BREND = JSON.parse(fs.readFileSync(path.join(ROOT, "igraonica.json"), "utf8"));
const IME = BREND.ime, LAUNCHER = BREND.launcher;
const OUT = path.join(path.dirname(ROOT), `${IME.toUpperCase().replace(/\s+/g, "-")}-ZA-IGRAONICU`);
const SRV = path.join(OUT, "1 - SERVER (glavni racunar)");
const CLI = path.join(OUT, "2 - LAUNCHER (racunari igraca)");

// Stari paket se briše pre novog; Windows to odbija ako je folder otvoren
// (Explorer, terminal, OneDrive), pa se to jasno kaže.
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
// _proba je alat za doradu izgleda (testovi/pregled-launchera.mjs) i ne ide u
// paket. crit.db se ne kopira kao fajl (vidi snimiBazu).
const preskoci = new Set(["backups", "crit.db", "crit.db-wal", "crit.db-shm", "_proba"]);
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

// Baza se snima sa VACUUM INTO, ne kopira: u WAL režimu sveže izmene stoje u
// `crit.db-wal`, pa bi kopija samog `crit.db` bila bez njih.
function snimiBazu() {
  const izvor = path.join(ROOT, "server", "data", "crit.db");
  const cilj = path.join(SRV, "data", "crit.db");
  const db = new DatabaseSync(izvor, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${cilj.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  } finally { db.close(); }
}
snimiBazu();
for (const f of ["package.json", "nadzornik.mjs", "Pokreni server.bat", "Otvori port u firewall-u.bat", "Podesi autostart.bat",
  "Ukloni autostart.bat", "podesi-autostart.ps1", "ukloni-autostart.ps1", "VRATI-KOPIJU.bat"]) {
  fs.copyFileSync(path.join(ROOT, "server", f), path.join(SRV, f));
}

// Paket nosi samo slike koje baza koristi; ostale se brišu iz kopije (izvor
// se ne dira).
{
  const pkgDb = new DatabaseSync(path.join(SRV, "data", "crit.db"));
  const referencirano = new Set();
  for (const [tab, kol] of [["games", "image"], ["games", "banner"], ["shop_items", "image"], ["tools", "image"], ["promo", "image"]]) {
    for (const r of pkgDb.prepare(`SELECT ${kol} v FROM ${tab} WHERE ${kol} IS NOT NULL AND ${kol} <> ''`).all()) {
      if (r.v) referencirano.add(path.basename(r.v));
    }
  }
  // Pozadine ekrana su u settings (pozadina_*), ne u tabelama.
  for (const r of pkgDb.prepare("SELECT value v FROM settings WHERE key LIKE 'pozadina_%' AND value <> ''").all()) {
    if (r.v && r.v.startsWith("/uploads/")) referencirano.add(path.basename(r.v));
  }
  pkgDb.close();

  // Slike idu u data/uploads (podaci igraonice, vidi UPLOADS u service.js).
  // Na razvojnom računaru mogu biti i u public/uploads, pa se skupljaju sa oba
  // mesta na jedno, a staro mesto se prazni.
  const cilj = path.join(SRV, "data", "uploads");
  const staro = path.join(SRV, "public", "uploads");
  fs.mkdirSync(cilj, { recursive: true });
  let preneto = 0;
  if (fs.existsSync(staro)) {
    for (const f of fs.readdirSync(staro)) {
      const izvor = path.join(staro, f);
      try {
        if (referencirano.has(f) && !fs.existsSync(path.join(cilj, f))) { fs.copyFileSync(izvor, path.join(cilj, f)); preneto++; }
      } catch {}
    }
    fs.rmSync(staro, { recursive: true, force: true });
  }

  // Sve cega baza ne pominje je orphan (probni baner, slika izbacene igre) i
  // samo bi opterecivalo paket.
  let orphana = 0;
  for (const f of fs.readdirSync(cilj)) {
    if (!referencirano.has(f)) { fs.rmSync(path.join(cilj, f), { force: true, recursive: true }); orphana++; }
  }
  if (orphana) console.log(`  slike: izbaceno ${orphana} orphan (baza ih ne koristi)`);

  // Slike koje baza pominje, a nema ih u paketu, prijavljuju se odmah.
  const uPaketu = fs.readdirSync(cilj).length;
  const fali = [...referencirano].filter((f) => !fs.existsSync(path.join(cilj, f)));
  if (fali.length) {
    console.error(`\nBaza pominje ${fali.length} slika kojih u paketu nema:`);
    for (const f of fali.slice(0, 8)) console.error(`  ${f}`);
    console.error("\nSlike stoje u server/data/uploads. Ako su jos na starom mestu,");
    console.error("pokreni server jednom - prenese ih sam pri pokretanju.");
    process.exit(1);
  }
  console.log(`  slike uz bazu: ${uPaketu}${preneto ? ` (${preneto} preneto sa starog mesta)` : ""}`);
}

// Provera da baza nije prazna ili nepodešena.
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
  // Provera prati ono što launcher prikazuje.
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

// ---- paket za nadogradnju servera sa panela ----
//
// Pravi se od upravo sklopljenog foldera servera, bez baze i slika igraonice
// (vidi server/src/paket-servera.js), i odmah se proverava čitanjem.
const NAD = path.join(OUT, "3 - NADOGRADNJA SA PANELA");
let imePaketaServera = null;
{
  const { napraviPaket, procitajPaket } = await import(pathToFileURL(path.join(ROOT, "server", "src", "paket-servera.js")).href);
  const gz = napraviPaket(SRV);
  const provera = procitajPaket(gz);
  const verzijaServera = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "package.json"), "utf8")).version;
  if (provera.verzija !== verzijaServera) {
    console.error(`\n  STOP - paket servera je ${provera.verzija}, a server/package.json kaže ${verzijaServera}.\n`);
    process.exit(1);
  }
  fs.mkdirSync(NAD, { recursive: true });
  imePaketaServera = `server-v${provera.verzija}.srvpak`;
  fs.writeFileSync(path.join(NAD, imePaketaServera), gz);
  fs.writeFileSync(path.join(NAD, "PROCITAJ.txt"), [
    `NADOGRADNJA SA PANELA - ${IME} ${provera.verzija}`,
    "",
    "Ovo je za igraonicu u kojoj server VEC radi preko nadzornika (verzija v1.0.0 ili novija).",
    "Starija verzija se jos jednom nadogradjuje rucno - vidi UPUTSTVA\\ODRZAVANJE.md.",
    "",
    "SERVER",
    `  1. Panel > Instalacije > Nadogradnja servera > Postavi paket servera > ${imePaketaServera}`,
    "  2. Klik na 'Nadogradi server'.",
    "     Server se gasi na dvadesetak sekundi. Igraci igraju dalje, vreme se obracuna kad se vrati.",
    "     Pre zamene se pravi kopija baze. Ako nova verzija ne proradi, vraca se stara sama.",
    "",
    "LAUNCHER",
    `  3. Panel > Instalacije > Nadogradnja launchera > Postavi instalater`,
    `     (instalater je u folderu '2 - LAUNCHER (racunari igraca)').`,
    "  4. Klik na 'Pusti verziju u rad'. Racunari je preuzimaju sami, cim se oslobode.",
    "",
  ].join("\r\n"), "utf8");
}

// ---- launcher ----
// dist/ je u projektu (client/package.json: output "../dist").
const dist = path.join(ROOT, "dist");
// U dist-u ostaju i stariji instaleri; uzima se najskorije napravljen.
const setup = fs.readdirSync(dist)
  .filter((f) => f.startsWith(`${LAUNCHER} Setup`) && f.endsWith(".exe"))
  .map((f) => ({ f, vreme: fs.statSync(path.join(dist, f)).mtimeMs }))
  .sort((a, b) => b.vreme - a.vreme)[0]?.f;
if (!setup) { console.error("Nema instalera u dist/ - pokreni prvo build launchera."); process.exit(1); }

// Instaler mora da bude verzije iz client/package.json; ako build pukne, u
// dist/ ostaje prethodni instaler.
{
  const verzija = JSON.parse(fs.readFileSync(path.join(ROOT, "client", "package.json"), "utf8")).version;
  const uImenu = new RegExp("^" + LAUNCHER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " Setup v([\\d.]+)\\.exe$").exec(setup)?.[1];
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

// Čuvaju se dva poslednja instalera (oko 100 MB svaki); instaleri iz stare
// numeracije (bez "v" u imenu, vidi server/src/verzije.js) brišu se svi.
const CUVA_SE = 2;
const jeNov = (f) => / Setup v\d+\.\d+\.\d+\.exe$/.test(f);
const sviInstaleri = fs.readdirSync(dist)
  .filter((f) => f.startsWith(`${LAUNCHER} Setup`) && f.endsWith(".exe"))
  .map((f) => ({ f, vreme: fs.statSync(path.join(dist, f)).mtimeMs }))
  .sort((a, b) => b.vreme - a.vreme);
let oslobodjeno = 0, obrisano = 0;
for (const { f } of [...sviInstaleri.filter((x) => !jeNov(x.f)), ...sviInstaleri.filter((x) => jeNov(x.f)).slice(CUVA_SE)]) {
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

// Šara i animacija se uključuju u serveru (seed u db.js).

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
fs.copyFileSync(path.join(ROOT, "README.md"), path.join(OUT, "README.md"));
fs.copyFileSync(path.join(ROOT, "CHANGELOG.md"), path.join(OUT, "CHANGELOG.md"));
const UPUTSTVA = path.join(OUT, "UPUTSTVA");
fs.mkdirSync(UPUTSTVA, { recursive: true });
for (const f of ["INSTALACIJA.md", "ODRZAVANJE.md", "PROVERA.md"]) {
  fs.copyFileSync(path.join(ROOT, "docs", f), path.join(UPUTSTVA, f));
}

// ---- sabloni za dizajn slika ----
kopiraj(path.join(ROOT, "assets", "sabloni"), path.join(OUT, "SABLONI ZA DIZAJN"));

const readme = [
  `${IME.toUpperCase()} - postavljanje u igraonici`,
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
  `4. Instaliraj '${LAUNCHER} Setup' i pokreni ga.`,
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
  `2. Prekopiraj folder "1 - SERVER" na taj racunar, npr. u C:\\${IME.replace(/\s+/g, "")}\\server`,
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
  `2. Prijavi se na nalog igraca i odatle instaliraj "${LAUNCHER} Setup"`,
  "   (instalacija ide u profil tog naloga i ne trazi administratora).",
  "3. Pokreni launcher. Adresa servera je vec popunjena - unesi samo TOKEN",
  "   za taj racunar (spisak je u TOKENI.txt).",
  "4. U panelu ce taj racunar preci iz Offline u Standby.",
  "5. Kad sve radi, ukljuci zastitu: u instalacionom folderu, podfolder",
  "   \"resources\", DVOKLIK na \"zastita-ukljuci.bat\", prijavljen kao igrac",
  "   (NE \"Run as administrator\"). Administratora trazi sama, za deo koji",
  "   vazi za ceo racunar. Zatim odjava i ponovna prijava.",
  "",
  "",
  "OBAVEZNO PRE OTVARANJA - TRI FABRICKE LOZINKE",
  "---------------------------------------------",
  "1. Panel:  admin / admin",
  "     Promeni odmah - panel se otvara sa svakog telefona na mrezi, a preko",
  "     njega se dopunjuje kredit. Klikni na svoje ime dole levo.",
  "2. PIN osoblja:  1234   (panel > Podesavanja)",
  "     Njime se otkljucava racunar i izlazi iz launchera.",
  "3. Servisni PIN:  1234   (panel > Podesavanja > Servisni PIN launchera)",
  "     Trazi se za ulaz u podesavanja launchera i za izlaz KAD SERVER NE RADI.",
  "     Upisuje se jednom u panelu i odmah stize na sve racunare. Bez promene,",
  "     igrac koji iscupa mrezni kabl moze da preusmeri racunar na svoj server.",
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
  "    -> POPRAVI-RACUNAR.bat (kao administrator)",
  "    -> DEINSTALIRAJ-LAUNCHER.bat (dvoklik sa naloga igraca)",
  "",
  "Detaljno uputstvo: UPUTSTVA\\INSTALACIJA.md i UPUTSTVA\\ODRZAVANJE.md",
  "Spisak sta da proveris pre otvaranja: UPUTSTVA\\PROVERA.md",
].join("\r\n");
fs.writeFileSync(path.join(OUT, "PROCITAJ ME.txt"), readme, "utf8");

// ---- folder za probu na jednom računaru ----
// Uz probu idu skripte koje isključe čišćenje sesije (na računaru za probu bi
// obrisalo tuđe prijave) i vrate ga posle probe.
const PROBA = path.join(OUT, "0 - PROBA NA JEDNOM RACUNARU");
kopiraj(path.join(ROOT, "assets", "proba"), PROBA);

const igre = db.prepare("SELECT name, path, image, banner FROM games ORDER BY id").all();
const alati = db.prepare("SELECT name, kind, target FROM tools ORDER BY id").all();
const artikli = db.prepare("SELECT COUNT(*) n FROM shop_items").get().n;
const igraca = db.prepare("SELECT COUNT(*) n FROM players").get().n;
// Igru cija putanja ne pocinje diskom, UNC putanjom ili protokolom launcher ne
// moze da pokrene.
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
  `7. Pokreni ${LAUNCHER}. Adresa je vec popunjena, unesi samo token:`,
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
  `  - Izgled launchera -> promeni teksturu / napravi ${IME.toUpperCase()} baner`,
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
console.log("  paket servera za panel:", imePaketaServera);
if (obrisano) {
  console.log(`  ociscen dist: obrisano ${obrisano} starih instalera, oslobodjeno ${(oslobodjeno / 1073741824).toFixed(2)} GB`);
}
