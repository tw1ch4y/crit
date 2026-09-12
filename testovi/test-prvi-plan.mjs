import { citajIzvor, brojac } from "./_okruzenje.mjs";
// LAUNCHER NE SME DA UPADNE PREKO ZIVE IGRE
//
// Povod je prijava sa masine: "imao sam problem sa rezolucijom kao da je
// zabagovao par puta launcher".
//
// STA SE DESAVALO
//
// Dok igra radi, launcher se sklanja a iza njega stoji zastor (pun ekran crne
// pozadine) da igrac nikad ne vidi Windows desktop. Kad se igra zatvori,
// Windows dodeli fokus sledecem prozoru - a to je bas zastor. To je bio znak
// "igra je gotova", pa je posle 400 ms launcher ulazio napred: pun ekran, iznad
// svega, sa fokusom.
//
// Ali igra u punom ekranu izgubi prvi plan i kad je ziva: pri ucitavanju mape,
// uz Windows obavestenje, uz alt-tab, pa i zbog NASEG obavestenja o vremenu.
// Launcher bi tada uleteo preko nje, igra bi ispala iz ekskluzivnog punog
// ekrana i EKRAN BI PROMENIO REZOLUCIJU. Igrac se vrati u igru - rezolucija se
// promeni opet. Iz stolice: "launcher bagira".
//
// STA SE OVDE CUVA
//
//   1. da fokus zastora vise nije dokaz nego nagovestaj
//   2. da se pre preuzimanja prvog plana PITA sistem radi li igra jos
//   3. da prozori prate promenu rezolucije - obavestenje koje ostane na staroj
//      koordinati zavrsi van ekrana, pa upozorenje o vremenu niko ne vidi
const { proveri, kraj } = brojac();
const main = citajIzvor("client/main.js");

// ---- 1) FOKUS ZASTORA SE PROVERAVA, NE UZIMA ZDRAVO ZA GOTOVO ----
proveri("zastor ne vraca launcher odmah",
  !/backdrop\.on\("focus"[\s\S]{0,200}isFocused\(\)\) focusLauncher\(\)/.test(main),
  "posle 400 ms je launcher ulazio preko igre koja je samo na tren izgubila prvi plan");
proveri("umesto toga se trazi potvrda", /backdrop\.on\("focus"[\s\S]{0,240}potvrdiDaJeIgraGotova/.test(main));
proveri("gubitak fokusa ponistava odbrojavanje",
  /backdrop\.on\("blur", \(\) => \{ zastorFokusOd = 0; \}\)/.test(main),
  "igra koja vrati prvi plan mora da prekine potvrdu");

const blok = main.slice(main.indexOf("function potvrdiDaJeIgraGotova"),
  main.indexOf("function potvrdiDaJeIgraGotova") + 1200);
proveri("potvrda trazi da fokus traje bez prekida", /Date\.now\(\) - zastorFokusOd < POTVRDA_MS/.test(blok));
proveri("potvrda pita sistem da li igra jos radi", /anyRunning\(images, \(running\) =>/.test(blok));
proveri("i ne dira igru koja jos radi", /if \(running\) return;/.test(blok),
  "ovo je ceo smisao ispravke");
proveri("gard se i dalje postuje", (blok.match(/launchGuardUntil/g) || []).length >= 2,
  "prvih 25 s posle pokretanja se prvi plan ne dira ni u kom slucaju");

// Isti precac je stajao i u checkGameGone.
const kg = main.slice(main.indexOf("function checkGameGone"), main.indexOf("function checkGameGone") + 900);
proveri("checkGameGone ne veruje golom fokusu",
  !/isFocused\(\)\) \{\s*clearExternal\(\);\s*focusLauncher\(\);/.test(kg.replace(/\r\n/g, "\n")),
  "ista pretpostavka je stajala na dva mesta");
proveri("i on trazi da fokus potraje", /Date\.now\(\) - zastorFokusOd >= POTVRDA_MS/.test(kg));

// ---- 2) PROZORI PRATE PROMENU REZOLUCIJE ----
//
// Igre menjaju rezoluciju. Mera je ranije uzeta jednom, pri pravljenju prozora.
proveri("obavestenje racuna meru pri svakom prikazu",
  /function overlayMere\(\)/.test(main) && /o\.setBounds\(overlayMere\(\)\)/.test(main),
  "na ekranu od 2560 obavestenje stoji na x=950; kad igra spusti na 1280, ono je van ekrana");
proveri("mera se cita iz TRENUTNE rezolucije",
  /function overlayMere\(\)[\s\S]{0,200}getPrimaryDisplay\(\)\.workAreaSize/.test(main));
proveri("obavestenje ne moze da bude sire od ekrana",
  /Math\.min\(660, width - 40\)/.test(main));
proveri("zastor se razvlaci na ceo ekran pri svakom prikazu",
  /function showBackdrop\(\)[\s\S]{0,1200}setBounds\(\{ x: 0, y: 0, width, height \}\)/.test(main),
  "posle promene rezolucije zastor ostane manji od ekrana i po ivicama se vidi desktop");
proveri("ali samo kad se mera stvarno razlikuje",
  /if \(t\.width !== width \|\| t\.height !== height/.test(main),
  "nepotreban setBounds nad punim ekranom ume da trgne igru");
proveri("zastor se ne prikazuje ponovo ako je vec vidljiv",
  /if \(!b\.isVisible\(\)\) b\.showInactive\(\)/.test(main),
  "nadzor ga zove svake sekunde; showInactive nad vidljivim prozorom je uzalud");

// ---- 3) DOK SESIJA TRAJE, NADZOR NE DIRA PRVI PLAN ----
//
// To je vec bilo ispravno i mora tako da ostane: igrac sme da drzi igru,
// Discord i muziku i da se prebacuje kako hoce.
const nadzor = main.slice(main.indexOf("function startWatchdog"), main.indexOf("function startWatchdog") + 1400);
proveri("dok igrac igra, nadzor ne poziva focus()",
  /if \(sesijaAktivna\) \{[\s\S]{0,400}\} else if/.test(nadzor)
  && !/if \(sesijaAktivna\) \{[\s\S]{0,400}win\.focus\(\)/.test(nadzor),
  "otimanje prvog plana usred igre je tacno ono na sta se igrac zalio");

kraj();
