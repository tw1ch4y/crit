import { citajIzvor, brojac } from "./_okruzenje.mjs";
// Launcher ne sme da uleti preko igre koja jos radi.
//
// Kad igra u punom ekranu izgubi fokus (ucitavanje mape, obavestenje, alt-tab),
// fokus dobija zastor iza nje. Launcher koji tada izadje napred izbaci igru iz
// ekskluzivnog punog ekrana i promeni rezoluciju.
//
//   1. fokus zastora je nagovestaj, ne dokaz da je igra gotova
//   2. pre preuzimanja prvog plana pita se sistem da li igra jos radi
//   3. prozori prate promenu rezolucije (obavestenje ne ostaje van ekrana)
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
// Igre menjaju rezoluciju, pa se mera ekrana uzima pri svakom prikazu.
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

// ---- 4) PROMENA REZOLUCIJE SE PRATI, NE PRETPOSTAVLJA ----
//
// Igra koja se pokrene u 1280x720 na ekranu od 2560x1440 ostavlja za sobom
// launcher u punom ekranu STARE mere (nadzor ga ne popravlja jer vec jeste
// isFullScreen), zastor manji od ekrana i obavestenje van ekrana.
proveri("launcher slusa promenu rezolucije",
  /screen\.on\("display-metrics-changed"/.test(main) && /function pratiRezoluciju\(\)/.test(main));
proveri("prati i kad se monitor doda ili skloni",
  /screen\.on\("display-added"/.test(main) && /screen\.on\("display-removed"/.test(main));
const pr = main.slice(main.indexOf("function pratiRezoluciju"), main.indexOf("function pratiRezoluciju") + 1400);
proveri("obnavlja sva tri prozora", /backdrop\.setBounds/.test(pr) && /overlay\.setBounds\(overlayMere\(\)\)/.test(pr)
  && /win\.setBounds/.test(pr));
proveri("ne dira launcher dok igra radi", /!gameActive\(\)/.test(pr),
  "diranje prvog plana usred igre je tacno ono na sta se igrac zalio");
proveri("mera se cita i malo kasnije", /setTimeout\(obnovi, 1200\)/.test(pr),
  "Windows javi promenu pre nego sto je stvarno primenjena");

kraj();
