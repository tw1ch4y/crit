import { citajIzvor } from "./_okruzenje.mjs";
// Šta korisnik vidi kad nešto pukne. Ovo su mesta na kojima je sistemska ili
// engleska poruka izlazila pred radnika i igrača - a oni od nje nemaju ništa.
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
proveri("obe putanje pokretanja idu kroz prevod",
  (main.match(/message: objasniGresku\(/g) || []).length === 2,
  `nadjeno ${(main.match(/message: objasniGresku\(/g) || []).length}`);
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
proveri("server ne gasi proces posle pada",
  !/process\.exit/.test(idx.slice(idx.indexOf("uncaughtException"))),
  "gasenje bi ostavilo 13 racunara bez naplate usred smene");

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
