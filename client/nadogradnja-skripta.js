// Pomoćne skripte koje instaliraju nadogradnju i vraćaju launcher.
//
// Instalater gasi launcher da bi prepisao njegove fajlove, pa instalaciju
// vode dve kratke skripte koje rade i kad launchera nema. Fajl je odvojen da
// bi se skripte pokretale u testu (test-pomocnik-nadogradnje.mjs).
//
// Posle koliko sekundi osigurač vraća launcher ako glavna skripta nije.
const OSIGURAC_SEK = 300;

// Izlazni kod koji ne daje nijedan instalater: znači da je launcher vratio
// osigurač.
const KOD_OSIGURAC = "9999";

// Isti broj kao NUMERACIJA u server/src/verzije.js. Upisuje se u ishod, da
// ishod stare numeracije ne izgleda kao neuspela nadogradnja.
const NUMERACIJA = 1;
const ZNAK = "N" + NUMERACIJA;

// Skripta radi bez konzole (detached, windowsHide, stdio ignore), da igraču
// ne bljesne prozor. U tom okruženju `tasklist` ne radi, a `start /wait` se
// nikad ne vrati, pa se instalater poziva sa `call`: batch čeka kraj programa
// i dobija njegov izlazni kod. `call` i za instalater koji je .cmd ili .bat
// vraća kontrolu skripti. Launcher se vraća sa `start` bez `/wait`.
//
// Osigurač je odvojena skripta: posle pet minuta vraća launcher ma šta se
// desilo. Ako launcher već radi, drugi primerak izlazi odmah.
//
//   instalacija prošla   -> glavna skripta vraća nov launcher
//   instalacija pukla    -> glavna skripta vraća stari i upisuje kod greške
//   instalater je stao   -> osigurač vraća stari launcher posle pet minuta
function napraviSkriptu({ instalater, launcher, ishod, verzija }) {
  return [
    "@echo off",
    // Čeka se da se launcher ugasi; instalater ne može da prepiše fajl u upotrebi.
    "ping -n 4 127.0.0.1 >nul",
    `call "${instalater}" /S`,
    // Ishod ide u fajl, a čita ga launcher po povratku (javiIshodNadogradnje).
    `echo %ERRORLEVEL% ${ZNAK} ${verzija}> "${ishod}"`,
    `del "${instalater}"`,
    `start "" "${launcher}"`,
    'del "%~f0"',
  ].join("\r\n");
}

// Osigurač ne zna ništa o instalaciji; posao mu je samo da vrati launcher.
// Ishod glavne skripte ne prepisuje.
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
