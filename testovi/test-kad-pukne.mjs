import { citajIzvor } from "./_okruzenje.mjs";
// Šta korisnik vidi kad nešto pukne: poruke na srpskom, bez sistemskog teksta.
//
// Uživo se proverava tako što se serveru prekine rad usred rada u panelu:
//   1. podigni server, prijavi se u panel
//   2. ugasi server
//   3. klikni bilo koju stranu

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const panel = citajIzvor("server/public/js/app.js");
const panelCss = citajIzvor("server/public/css/style.css").replace(/\s+/g, " ");
const main = citajIzvor("client/main.js");
const launcher = citajIzvor("client/renderer/js/launcher.js");
const pregled = citajIzvor("testovi/pregled-electron.mjs");

// ---- 1) PANEL: server nedostupan ----
// fetch koji ne uspe baca pregledacevu poruku "Failed to fetch". Radnik je
// dobijao bas taj tekst - engleski, i bez ijedne informacije sta da uradi.
proveri("neuspeo zahtev se hvata", /try \{\s*res = await fetch/.test(panel),
  "bez toga pregledac baca svoje 'Failed to fetch'");
proveri("poruka je na srpskom i kaze sta da se radi",
  panel.includes("Nema veze sa serverom. Proveri da li je glavni računar upaljen"));
proveri("greska se prepoznaje kao prekid veze", /e\.veza = true/.test(panel),
  "da strana moze da razlikuje 'nema podataka' od 'nema veze'");
proveri("traka o prekidu veze se pali odmah", /setConn\(false, true\)/.test(panel),
  "radnik je bas tada kliknuo, mora odmah da vidi zasto se nista nije desilo");
proveri("setConn zna za hitan slucaj", /function setConn\(ok, odmah = false\)/.test(panel));

// ---- 2) PANEL: spisak ne sme da laze da je prazan ----
// Kad podaci nisu stigli, spisak igraca je pisao "Jos nema naloga". Radnik bi
// pomislio da nalog ne postoji i napravio isti jos jednom.
proveri("spisak igraca razlikuje prazno od neucitanog", /pukla = !!e\.veza/.test(panel));
proveri("poruka kaze da to NE znaci da naloga nema",
  panel.includes("Ovo ne znači da naloga nema"));
proveri("nudi se ponovni pokusaj", panel.includes('id="plPonovo"'));
proveri("poruka stoji umesto tabele, ne u celiji", /closest\("\.card"\)/.test(panel),
  "u celiji je sirina vezana za kolone, pa se na telefonu tekst lomio po jednu rec");
proveri("poruka ima svoj stil", /\.ucitavanje-palo \{/.test(panelCss));

// ---- 3) LAUNCHER: igra nece da se pokrene ----
// Windows javlja "spawn C:\\games\\cs2.lnk ENOENT" ili "Access is denied".
// Igracu to ne znaci nista; osoblje i dalje dobija tacan razlog kroz
// "igra_ne_radi", pa se prevodom ne gubi nista.
proveri("sistemska greska se prevodi", /function objasniGresku/.test(main));
for (const [slucaj, tekst] of [
  ["fajl ne postoji", "Igra nije pronađena na ovom računaru."],
  ["nema dozvole", "Windows nije dozvolio pokretanje."],
  ["zauzeto", "Igra je trenutno zauzeta."],
  ["nepoznato", "Igra ne može da se pokrene."],
]) proveri(`prevod postoji: ${slucaj}`, main.includes(tekst));
proveri("nijedna sirova poruka ne ide igracu", !/game-error", \{ name: [^}]*message: (e|greska)\.message/.test(main)
  && !/game-error", \{ name: [^}]*message: greska \}/.test(main));
// Igra se pokrece na dva nacina i oba moraju da prevode gresku: precica
// (.lnk/.url/.bat) ide kroz shell.openPath, a .exe kroz spawn. Gleda se svaka
// putanja za sebe.
const lnkOd = main.indexOf("shell.openPath(gamePath)");
const lnkBlok = main.slice(Math.max(0, lnkOd - 700), lnkOd + 300);
// Trazi se child.on("error") IZ POKRETANJA IGRE, ne prvi u fajlu - prvi
// pripada instalateru, koji svoju gresku uredno salje osoblju, ne igracu.
const spawnOd = main.indexOf('child.on("error"', main.indexOf("function launchGameStvarno"));
const spawnBlok = main.slice(spawnOd, spawnOd + 400);
proveri("precica ide kroz prevod", /objasniGresku\(/.test(lnkBlok), "shell.openPath");
proveri("spawn ide kroz prevod", /objasniGresku\(/.test(spawnBlok), "child.on(error)");
// I odbijeno obecanje, ne samo vracena poruka: shell.openPath obicno VRATI
// gresku, ali kad odbije, neobradjeno odbijanje ruši ceo launcher.
proveri("i odbijeno obecanje ide kroz prevod",
  /\.catch\(\(e\) => javiKvar\(objasniGresku\(e\)\)\)/.test(main),
  "jedan pokvaren .lnk bi inace ostavio racunar na golom Windowsu");
// Svaka poruka o neuspelom pokretanju kaze i sta dalje ("Pozovite osoblje"),
// kao i provere pre pokretanja.
for (const [slucaj, tekst] of [
  ["fajl ne postoji", "Igra nije pronađena na ovom računaru. Pozovite osoblje."],
  ["nema dozvole", "Windows nije dozvolio pokretanje. Pozovite osoblje."],
  ["nepoznato", "Igra ne može da se pokrene. Pozovite osoblje."],
]) proveri(`poruka kaze i sta sad: ${slucaj}`, main.includes(tekst), tekst);
// Zauzeta igra je izuzetak: tu osoblje ne treba, treba sacekati.
proveri("zauzeta igra ne salje po osoblje",
  main.includes("Igra je trenutno zauzeta. Sačekaj koji trenutak pa probaj ponovo."),
  "zvati radnika zbog necega sto prodje samo od sebe je gubljenje i njegovog i igracevog vremena");

// ISTO PRAVILO VAZI I ZA MIS I ZVUK.
//
// Kad podesavanje ne prodje, igracu je stizalo sirovo "Miš: " plus 300 znakova
// PowerShell greske na engleskom - u istom fajlu koji za igre izricito kaze da
// sistemska poruka igracu ne ide.
proveri("greska podesavanja ne ide igracu sirova",
  !/error: "Miš: " \+ r\.greska/.test(main) && !/error: "Zvuk: " \+ r\.greska/.test(main),
  "igracu to ne kaze ni sta se desilo ni sta da radi");
proveri("umesto nje ide poruka na srpskom",
  /nije mogao da se podesi na ovom računaru/.test(main));
proveri("tacan razlog i dalje ide osoblju",
  /javiProblem\("podesavanja"/.test(main),
  "bez toga vlasnik ne bi znao da se na nekoj masini podesavanja ne primaju");

// IZMISLJENA VREDNOST JE GORA OD PORUKE.
//
// Citanje koje vrati gresku i dalje vraca objekat, pa se smatralo uspehom -
// igracu bi se prikazao klizac na vrednosti 10 kao da je to stanje njegovog
// misa. Pomeri ga, nista se ne desi, i ne zna je li do njega ili do racunara.
// A kad citanje pukne, ekran je zauvek stajao na "Ucitavam podesavanja...".
proveri("procitana greska se ne prikazuje kao stanje",
  // Zvuk bez jacine se ne racuna: sam objekat zvuka stize i kad nista nije procitano.
  /if \(r && !r\.greska && \(r\.mis \|\| r\.zvuk\?\.jacina != null\)\)/.test(launcher));
proveri("neuspelo citanje ne visi na 'Ucitavam'",
  /podesavanjaStanje === "palo"/.test(launcher),
  "ekran koji zauvek nesto ucitava je gori od poruke o gresci");

proveri("osoblje i dalje dobija tacan razlog",
  main.includes('javiDaNeRadi(') && /razlog/.test(main));

// ---- 4) Maketa ne sme da bude lepsa od stvarnosti ----
// U alatu za pregled je stajala rucno napisana, lepsa poruka nego sto je
// launcher stvarno slao - pa je slika krila da igrac dobija Windows gresku.
proveri("pregled koristi isti tekst kao pravi kod",
  pregled.includes("Igra nije pronađena na ovom računaru."));

// ---- 5) Igrac vidi poruku, ne sifru ----
proveri("greska pokretanja se prikazuje igracu", launcher.includes("Ne mogu da pokrenem"));

// ---- 6) SERVER: pad usred smene ----
// Server radi bez nadzora, u prozoru koji niko ne gleda i koji je najcesce
// minimizovan. Kad nesto pukne u devet uvece, vlasnik to sutra mora negde da
// vidi - inace ostaje samo "nesto se cudno ponasalo".
// NAPOMENA: ovde se proverava mehanizam u kodu, ne pravi pad. Pravi pad se
// izaziva rucno, a zapis se onda vidi u panelu pod Logovi > Sistem.
const idx = citajIzvor("server/src/index.js");
proveri("pad se hvata", /process\.on\("uncaughtException"/.test(idx) && /process\.on\("unhandledRejection"/.test(idx));
proveri("pad se ZAPISUJE u logove, ne samo u konzolu",
  /category: "sistem", action: "greska"/.test(idx),
  "bez ovoga greska ostane samo u prozoru koji niko ne gleda");
proveri("ista greska ne zatrpava log", /skoroZapisano/.test(idx));
proveri("i sam upis je zasticen", /try \{\s*svc\.logEvent/.test(idx),
  "ako je baza uzrok pada, upis ne sme da napravi drugi pad");
// Gleda se samo ono sto se izvrsi POSLE pada: zapisiPad i dva rukovaoca.
// Uredno gasenje na zahtev (Ctrl+C, nadzornik, nadogradnja) sme da izadje - to
// nije pad, i baza se pre toga upise.
const posle = idx.slice(idx.indexOf("function zapisiPad"), idx.indexOf("\n", idx.indexOf('process.on("unhandledRejection"')));
proveri("server ne gasi proces posle pada",
  posle.includes('process.on("uncaughtException"') && !/process\.exit/.test(posle),
  "gasenje bi ostavilo 13 racunara bez naplate usred smene");

// ---- STANJE "CEKAM ODGOVOR" MORA DA SE SAMO OTPUSTI ----
//
// Prijava, porudzbina i nagradni tocak cekaju odgovor servera. Ako odgovor ne
// stigne (pukla veza, restart servera), stanje cekanja mora samo da istekne; kod
// tocka bi inace HUD ostao zamrznut.
for (const [sta, sablon] of [
  ["prijava", /clearLoginPending\._t = setTimeout\(clearLoginPending/],
  ["porudzbina", /sendOrder\._t = setTimeout\(clearOrderPending/],
  ["nagradni tocak", /tocakRokTajmer = setTimeout\(/],
]) proveri(`${sta} ne ceka odgovor zauvek`, sablon.test(launcher),
  "bez roka dugme ostaje zakljucano do kraja smene");

proveri("tocak se otpusta i kad veza padne", /otpustiTocak\("Veza je pukla usred vrtnje/.test(launcher),
  "preko puknute veze ishod ionako ne moze da stigne");
proveri("otpusten tocak upisuje zadrzano stanje", /function otpustiTocak[\s\S]{0,600}S\.tocakStanje/.test(launcher),
  "inace kredit koji je stigao tokom vrtnje ostaje zarobljen");
proveri("igracu pise da spin NIJE potrosen", /Spin nije potrošen/.test(launcher),
  "inace misli da je izgubio nedeljni spin ni za sta");

// ---- ODUSTAJANJE OD PIN-A OSTAVLJA ISTO STANJE, BEZ OBZIRA KAKO ----
proveri("Escape i dugme 'Odustani' rade istu stvar", /function odustaniOdPina\(/.test(launcher));
proveri("odustajanje brise svrhu PIN-a", /function odustaniOdPina[\s\S]{0,200}S\.pinSvrha = null/.test(launcher),
  "svrha koja prezivi odustajanje bi pri sledecoj upotrebi obrisala adresu servera umesto da izadje iz kioska");

// ---- NACIN PLACANJA KOJI JE PROGRAM SAM PROMENIO SE I SAM VRACA ----
//
// Igrac sa 100 dinara doda kolu od 130 - program prebaci na kes jer kredita
// nema. Predomisli se i uzme vodu od 80: kredit sad ima, a i dalje pise "Kes".
// Isto i kad ga radnik u medjuvremenu dopuni. Gost onda placa kesom nesto sto je
// vec platio, a radnik ustaje da naplati bez potrebe.
proveri("pamti se da li je kes bio IGRACEV izbor", /S\.nacinRucno = true/.test(launcher));
proveri("kad kredit bude dovoljan, izbor se vraca",
  /S\.nacinPlacanja === "cash" && !S\.nacinRucno\) S\.nacinPlacanja = "credit"/.test(launcher));
proveri("nova porudzbina krece sa cistim izborom",
  (launcher.match(/S\.nacinRucno = false/g) || []).length >= 2,
  "i pri prijavi i posle poslate porudzbine");

// ---- TOCAK: ZAKASNEO ISHOD I POKIDANA VEZA ----
//
// Server upise spin PRE nego sto posalje ishod. Kad ishod zakasni preko roka,
// ili veza pukne posle upisa, launcher ne sme da tvrdi nesto sto ne zna.
proveri("zakasneo ishod tocka se prikaze, ne baca se", /if \(!S\.tocakVrti\) \{ zakasneliSpin\(/.test(launcher),
  "igrac ne bi saznao sta je dobio, a tocak bi nudio spin koji je vec iskoriscen");
proveri("zakasneo ishod zatvara nedeljni spin", /function zakasneliSpin[\s\S]{0,120}S\.tocak\.moze = false/.test(launcher));
proveri("pad veze ne obecava da spin nije potrosen", !/Veza je pukla usred vrtnje\. Spin nije potrošen/.test(launcher),
  "server je mozda vec upisao spin");

// ---- POKRETANJE KAD MOST PUKNE ----
proveri("pokretanje igre i alata ide kroz jedno mesto koje hvata gresku",
  /async function pokreni\(sta\) \{\s*try \{[\s\S]{0,160}\} catch \{ return \{ ok: false \}; \}/.test(launcher) &&
  (launcher.match(/window\.crit\.launchGame\(/g) || []).length === 1,
  "neuhvacena greska ostavlja plocicu na 'Pokrecem...' bez poruke");

// ---- KORPA I ZALIHA ----
proveri("korpa ne prima vise nego sto je na stanju", /function granicaKorpe\(/.test(launcher) &&
  /const granica = granicaKorpe\(S\.shop\.find/.test(launcher),
  "server bi odbio tek na 'Poruci', posle celog izbora");
proveri("nov katalog svodi korpu na zalihu",
  /case "catalog": \{[\s\S]{0,500}if \(kol > granica\) \{ if \(granica > 0\) S\.cart\.set\(id, granica\); else S\.cart\.delete\(id\); \}/.test(launcher));
proveri("VIP ponuda pise cenu sa valutom", /Produži za \$\{money\(c\.cena\)\}/.test(launcher) &&
  /\$\{money\(c\.cena\)\} za \$\{c\.trajanje\} dana/.test(launcher));

// ---- MIS KOJI NIJE PROCITAN ----
const winPod = citajIzvor("client/windows-podesavanja.js");
proveri("neprocitan mis je null, ne fabricka vrednost", /mis: mis\.greska \? null : mis/.test(winPod),
  "odjava bi racunaru nametnula izmisljenu brzinu, a klizac bi pokazao broj koji niko nije procitao");
proveri("prazan izlaz zvuka nije nula", /r\.izlaz === "" \? NaN/.test(winPod));
proveri("ekran ne izmislja mis", /const mis = p\.mis;/.test(launcher) && !/p\.mis \|\| \{ brzina/.test(launcher));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
