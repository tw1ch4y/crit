// POMOCNIK KOJI VRACA LAUNCHER POSLE NADOGRADNJE
//
// Instalater gasi launcher da bi mogao da prepise njegove fajlove - a ugasen
// launcher ne moze ni da saceka kraj instalacije ni da se sam vrati. Zato posao
// preuzimaju dve kratke skripte koje zive duze od nas.
//
// Stoji kao zaseban fajl da bi moglo da se POKRENE u probi (test-pomocnik-
// nadogradnje.mjs). Batch je jezik u kom se greske ne vide dok se ne desi ono
// najgore, a najgore je ovde racunar bez launchera: otvoren Windows, bez kioska
// i bez naplate, na masini za kojom sedi gost.
// Posle koliko sekundi osigurac vraca launcher ako glavna skripta nije. Pet
// minuta je preko svake mere za instalaciju od sto megabajta sa lokalnog diska,
// a dovoljno kratko da racunar ne ostane otvoren celu smenu.
const OSIGURAC_SEK = 300;

// Izlazni kod koji ne moze da dodje ni od jednog instalatera - po njemu se
// prepoznaje da je launcher vratio osigurac, a ne instalacija.
const KOD_OSIGURAC = "9999";

// Numeracija verzija - isti broj kao NUMERACIJA u server/src/verzije.js, gde
// piše i zašto postoji. Ide u ishod, da ishod ostao od stare numeracije ne bi
// posle reinstalacije izgledao kao neuspela nadogradnja.
const NUMERACIJA = 1;
const ZNAK = "N" + NUMERACIJA;

// SKRIPTA RADI BEZ KONZOLE - I TO OBARA DVA OBICNA NACINA DA SE NESTO SACEKA.
//
// Launcher je pokrece odvojeno, sakriveno i bez izlaza (detached, windowsHide,
// stdio ignore), jer na ekranu igraca ne sme da bljesne crni prozor. U takvom
// okruzenju dve stvari koje svako prvo napise NE RADE, a obe cute o tome:
//
//   1. `tasklist` (prva verzija): ne moze da se izvrsi, greska ode u `2>nul`,
//      a odgovor ispadne "instalatera nema vise". Launcher bi se vratio posle
//      cetiri sekunde, NASRED instalacije, dok instalater prepisuje njegove
//      fajlove.
//   2. `start /wait` (druga verzija): nikad se ne vrati. `start` trazi konzolu
//      koje nema, pa skripta stane na toj liniji zauvek - a racunar ostane bez
//      launchera do kraja smene.
//
// Obe je nasla proba (test-pomocnik-nadogradnje.mjs), i nijedna se ne bi videla
// dok se skripta pokrece rucno, iz otvorenog prozora - tamo rade obe.
//
// Ono sto radi: instalater se poziva sa `call`. Batch tada ceka da se program
// zavrsi, bez konzole i bez `start`-a, i uredno dobije njegov izlazni kod.
// `start` bez `/wait` i dalje radi, pa se launcher njime vraca - njega ne
// treba cekati.
//
// `call` je tu i kad se cini suvisnim (za .exe je isto kao poziv bez njega):
// bez njega, instalater koji ispadne .cmd ili .bat NE VRACA kontrolu - preuzme
// je i skripta se zavrsi na toj liniji, pa se launcher nikad ne vrati. Kosta
// nista, a sklanja ceo taj razred kvara.
//
// Granicu drzi ODVOJENA skripta (osigurac) koja ne zavisi ni od cega: odbroji i
// vrati launcher. Ako je glavna vec zavrsila svoje, drugo pokretanje ne radi
// nista - launcher drzi bravu jedne instance (`requestSingleInstanceLock`).
//
// Tako svaki ishod ima izlaz:
//   instalacija prosla     -> glavna skripta vrati NOV launcher za nekoliko sekundi
//   instalacija pukla      -> glavna skripta vrati STARI launcher i zapise kod greske
//   niko nije odobrio UAC  -> osigurac vrati stari launcher posle pet minuta
function napraviSkriptu({ instalater, launcher, ishod, verzija }) {
  return [
    "@echo off",
    // Sacekaj da se launcher stvarno ugasi; instalater ne moze da prepise fajl
    // koji jos radi.
    "ping -n 4 127.0.0.1 >nul",
    `call "${instalater}" /S`,
    // Ishod se upisuje u fajl jer ga u tom trenutku nema ko prijaviti: ako
    // instalacija pukne, vrati se STARA verzija, procita ovaj fajl i javi sta
    // je bilo. Bez toga bi neuspela nadogradnja izgledala isto kao da se nista
    // nije ni desilo.
    `echo %ERRORLEVEL% ${ZNAK} ${verzija}> "${ishod}"`,
    `del "${instalater}"`,
    `start "" "${launcher}"`,
    'del "%~f0"',
  ].join("\r\n");
}

// Osigurac ne zna nista o instalaciji i namerno je tako - jedini mu je posao da
// se racunar ne zadrzi bez launchera. Ne pise preko tudjeg ishoda: ako glavna
// skripta vec javila sta je bilo, ta poruka je tacnija od ove.
function napraviOsigurac({ launcher, ishod, verzija, sekundi = OSIGURAC_SEK }) {
  return [
    "@echo off",
    `ping -n ${sekundi + 1} 127.0.0.1 >nul`,
    `if not exist "${ishod}" echo ${KOD_OSIGURAC} ${ZNAK} ${verzija}> "${ishod}"`,
    `start "" "${launcher}"`,
    'del "%~f0"',
  ].join("\r\n");
}

module.exports = { napraviSkriptu, napraviOsigurac, OSIGURAC_SEK, KOD_OSIGURAC, NUMERACIJA };
