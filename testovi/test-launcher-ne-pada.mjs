import { citajIzvor, brojac } from "./_okruzenje.mjs";
// LAUNCHER NE SME DA UMRE OD GRESKE KOJU NISMO PREDVIDELI
//
// Kod servera pad znaci da igraonica stane i to se odmah vidi. Kod launchera je
// gore, jer se NE vidi: neobradjeno odbijanje obecanja u glavnom procesu
// Electrona gasi ceo program, a racunar ostaje na GOLOM WINDOWSU - bez kioska,
// bez zakljucavanja, bez naplate. Gost sedne i igra besplatno, a osoblje to
// primeti samo ako slucajno prodje pored te masine.
//
// Server je globalno hvatanje imao od pocetka; launcher nije.
//
// Uz to, jedno konkretno mesto je bilo bez `.catch`, i to bas na najtoplijoj
// putanji: `shell.openPath` kojim se pokrece SVAKA precica (.lnk). Obicno vraca
// poruku o gresci umesto da odbije, pa je izgledalo da nema sta da se hvata -
// ali kad odbije (pokvarena precica, disk koji je otpao), pada ceo launcher.
const { proveri, kraj } = brojac();
const main = citajIzvor("client/main.js");

// ---- 1) GLOBALNA MREZA POSTOJI ----
proveri("launcher hvata neuhvacene greske",
  /process\.on\(dogadjaj/.test(main) && /"uncaughtException", "neuhvacena-greska"/.test(main));
proveri("i neobradjena odbijanja obecanja",
  /"unhandledRejection", "neobradjeno-odbijanje"/.test(main),
  "ovo je ono sto gasi Electron glavni proces");

const blok = main.slice(main.indexOf('for (const [dogadjaj, vrsta] of [["uncaughtException"'),
  main.indexOf('for (const [dogadjaj, vrsta] of [["uncaughtException"') + 600);
proveri("greska se javlja panelu, ne samo u konzolu", /javiProblem\(vrsta, tekst\)/.test(blok),
  "prozor servera niko ne gleda; u panelu uz gresku stoji ime racunara");
proveri("gasenje na zahtev osoblja ide svojim putem", /if \(app\.isQuitting\) return;/.test(blok),
  "inace bi uredno gasenje izgledalo kao kvar");
proveri("poruka se skracuje", /slice\(0, 2\)\.join\(" "\)/.test(blok),
  "ceo stack trace u logovima igraonice nikom ne pomaze");

// Pre prvog prozora se NE hvata nista: program koji prezivi gresku a nikad nije
// napravio prozor ostaje da visi bez icega na ekranu, a Windows ga i dalje vidi
// kao pokrenutog - pa se precica sa autostarta nece ponovo uhvatiti. Tada je
// bolje da padne, jer ga restart masine vrati.
proveri("pre prvog prozora se pusta da padne", /if \(!prozorPostojao\) \{/.test(blok)
  && /process\.exit\(1\)/.test(blok),
  "zombi proces bez prozora je gori od pada - autostart ga vise ne hvata");
proveri("prozor pali taj prekidac", /prozorPostojao = true;/.test(main));

// ---- 2) POKRETANJE PRECICE NE RUSI LAUNCHER ----
const gp = main.slice(main.indexOf("shell.openPath(gamePath)"), main.indexOf("shell.openPath(gamePath)") + 400);
proveri("shell.openPath ima .catch", /\.catch\(\(e\) => javiKvar\(objasniGresku\(e\)\)\)/.test(gp),
  "bez toga jedan pokvaren .lnk ostavlja racunar na golom Windowsu");
proveri("i uspeh i pad idu kroz istu poruku igracu", /const javiKvar = \(poruka\) =>/.test(main),
  "igrac mora da dobije istu razumljivu recenicu, kako god da je puklo");
// `javiKvar` stoji IZNAD poziva, pa se gleda ceo taj deo, ne samo poziv.
const kvarBlok = main.slice(main.indexOf("const javiKvar = (poruka) =>"),
  main.indexOf("const javiKvar = (poruka) =>") + 400);
proveri("kvar se i dalje javlja serveru",
  /javiDaNeRadi\(name \|\| path\.basename\(gamePath\), "greska", id, vrsta\)/.test(kvarBlok),
  "panel mora da vidi da se ta precica ne pokrece, uz ime masine");

// ---- 3) OSTALA OBECANJA U LAUNCHERU SU POKRIVENA ----
//
// Provereno rucno kroz ceo main.js; ovde se cuva da se ne vrati neko novo bez
// hvatanja. Trazi se `.then(` kome ni u sledecih par redova ne sledi `.catch`.
const redovi = main.split(/\r?\n/);
const bezHvatanja = [];
redovi.forEach((r, i) => {
  if (!/\.then\(/.test(r)) return;
  if (/app\.whenReady\(\)/.test(r)) return;           // Electron ga sam hvata
  const okolina = redovi.slice(i, i + 6).join(" ");
  if (!/\.catch\(/.test(okolina)) bezHvatanja.push(`${i + 1}: ${r.trim().slice(0, 70)}`);
});
proveri("nijedno obecanje nije bez hvatanja", bezHvatanja.length === 0, bezHvatanja.join(" | "));

// ---- 4) SERVER I DALJE IMA SVOJE ----
const srv = citajIzvor("server/src/index.js");
proveri("server i dalje hvata oba slucaja",
  /process\.on\("uncaughtException"/.test(srv) && /process\.on\("unhandledRejection"/.test(srv));

kraj();
