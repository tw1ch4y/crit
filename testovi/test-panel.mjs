import { citajIzvor } from "./_okruzenje.mjs";
// Raspored PANELA - strane koje osoblje gleda po ceo dan. Isto kao kod
// launchera: uz svaku proveru stoji sta je konkretno bilo pokvareno, da se ne
// "sredi" nazad. Slike se prave sa:  node pregled-panela.mjs
//
// Ovo su nalazi sa prave baze (8 igara, 8 precica, 7 artikala), ne sa prazne -
// na praznoj bazi se meri prazno stanje umesto pravog rasporeda.

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const css = citajIzvor("server/public/css/style.css");
const app = citajIzvor("server/public/js/app.js");
const pregled = citajIzvor("testovi/pregled-panela.mjs");
const jedanRed = css.replace(/\s+/g, " ");

// ---- IGRE I INTERNET ALATI: putanja mora da se procita ----
// Kolona je bila 300px: ikona 46 + razmaci + tri dugmeta ~96 = na ime i putanju
// ostajalo ~134px. Svaka putanja je zavrsavala kao "C:/igre/Fort...", a bas
// putanja je ono zbog cega se ova strana i otvara.
proveri("kolona kartice je dovoljno siroka za putanju", /\.game-grid \{[^}]*minmax\(min\(384px, 100%\)/.test(jedanRed),
  "na 300px se putanja secla kod svake igre; min() cuva da se na telefonu kolona skupi umesto da probije ekran");
proveri("putanja sme u dva reda", /\.game-path \{[^}]*-webkit-line-clamp: 2/.test(jedanRed));
proveri("putanja se ne drzi u jednom redu", !/\.game-path \{[^}]*white-space: nowrap/.test(jedanRed),
  "nowrap vraca secenje");
proveri("duga putanja se lomi gde stigne", /\.game-path \{[^}]*word-break: break-all/.test(jedanRed),
  "steam://rungameid/1172470 nema razmaka, bez ovoga bi izasla iz kartice");

// Dugmad su stajala u istom redu sa ikonom i tekstom, pa su otimala ~96px bas
// od putanje. Sada su u redu sa imenom, a putanja ima celu sirinu kartice.
proveri("dugmad stoje u redu sa imenom", css.includes(".game-top"));
for (const [sta, pocetak] of [["igre", "const card = (g) =>"], ["alati", "const card = (t) =>"]]) {
  const k = app.slice(app.indexOf(pocetak), app.indexOf(pocetak) + 1600);
  proveri(`${sta}: dugmad stoje iznad putanje, ne pored nje`,
    k.includes("game-top") && k.indexOf("game-acts") > 0 && k.indexOf("game-acts") < k.indexOf("game-path"),
    "pored putanje otimaju ~96px bas onome sto se cita");
}

// Omot je 3:4. U kvadratnom okviru se secao sa obe strane, pa je panel
// pokazivao drugi kadar nego launcher - a ovde se bas proverava da li omot valja.
proveri("omot igre stoji u odnosu 3:4", /\.game-emoji\.omot \{[^}]*height: 61px/.test(jedanRed));
proveri("igre koriste omot okvir", app.includes('class="game-emoji omot"'));
proveri("alati ostaju kvadratni", /const card = \(t\) => `<div class="game-card[\s\S]{0,120}?class="game-emoji">/.test(app),
  "ikone programa jesu kvadratne, ne treba im 3:4");

// Znacka "ikona programa" se lomila na dva reda usred pilule.
proveri("znacka se ne lomi na dva reda", /\.ss \{[^}]*white-space: nowrap/.test(jedanRed));

// ---- PRAZNE TABELE ----
// Svaka je pisala jedan sivi red teksta usred praznog polja - izgledalo je kao
// da se strana nije ucitala.
proveri("postoji zajednicki oblik prazne tabele", app.includes("function praznaTabela"));
proveri("prazna tabela ima ikonu, naslov i objasnjenje",
  /praznaTabela\(kolona, ikona, naslov, opis[\s\S]{0,200}class="e-t"[\s\S]{0,120}class="e-s"/.test(app));
for (const [strana, tekst] of [["smene", "Još nema smena"], ["igraci", "Još nema naloga"],
  ["porudzbine", "Još nema završenih porudžbina"], ["racunari", "Još nema računara"], ["instalacije", "Nema sačuvanih programa"]]) {
  proveri(`${strana}: prazna tabela ide kroz zajednicki oblik`,
    new RegExp(`praznaTabela\\([^)]*"${tekst}"`).test(app), "ostao je goli sivi red");
}
proveri("prazno mesto ima stil za naslov i objasnjenje",
  /\.empty \.e-t \{/.test(jedanRed) && /\.empty \.e-s \{/.test(jedanRed));

// ---- TRAKA SLOBODNIH RACUNARA ----
// Pri zatvorenoj igraonici traka je nabrajala svih 13 racunara pod naslovom
// "SLOBODNO", tacno ispod brojaca na kom pise "SLOBODNO 0".
proveri("ugaseni racunari imaju svoj naslov", app.includes('slobodni-naslov">Ugašeno'));
proveri("naslov 'Slobodno' stoji samo kad ima spremnih", /if \(spremni\.length\) delovi\.push/.test(app));
proveri("kad su svi ugaseni pise se sta da se radi", app.includes("klikni da upališ"));
proveri("drugi naslov u traci ima razmak", /\.slobodni-naslov:not\(:first-child\) \{[^}]*margin-left/.test(jedanRed));
// Daljinsko paljenje radi samo za racunar sa upisanom MAC adresom. Ranije su
// svi ugaseni stajali kao dugme "klikni da upalis", pa je klik na dvanaest od
// trinaest davao samo poruku o gresci.
proveri("bez MAC adrese nema obecanja da ce se upaliti", /const moze = !ugasen \|\| !!c\.mac/.test(app));
proveri("takav racunar je vidno prigusen", /\.slobodan-pc\.bez-mac \{[^}]*cursor: default/.test(jedanRed));
proveri("naslov trake obecava paljenje samo ako neko moze", /const imaMac = ugaseni\.some\(\(c\) => c\.mac\)/.test(app));

// ---- MREZE NE SMEJU DA SIRE STRANU ----
// "minmax(384px, 1fr)" na telefonu od 375px daje kolonu od 384px: kartica
// izadje iz ekrana i CELA strana se pomera u stranu. Osoblje panel gleda i sa
// telefona, pa je to bilo vidljivo na stranama Igre i Internet alati.
// "minmax(min(384px, 100%), 1fr)" resava to na svakoj sirini, bez media upita.
{
  // Vazi i za auto-fill i za auto-fit - obe vrste su umele da naprave kolonu
  // siru od ekrana.
  const gole = [...jedanRed.matchAll(/minmax\((\d+)px, 1fr\)/g)].map((m) => m[0]);
  proveri("nijedna mreza ne tera kolonu siru od ekrana", gole.length === 0, gole.join(", "));
  proveri("mreze koriste min() zastitu", /minmax\(min\(\d+px, 100%\), 1fr\)/.test(jedanRed));
}

// ---- KASA ----
// Svaka kategorija je imala svoj red plocica, pa su se dve delile istu traku i
// radnik je pred gostom trazio po ekranu ono sto staje u jedan red. Sada je sve
// u jednoj mrezi, a kategorija se bira trakom iznad.
proveri("kasa ima jedan spisak, ne red po kategoriji", !app.includes("pos-sekcija"));
proveri("kategorija na kasi se bira trakom", app.includes('class="pos-filter"') && app.includes("data-pos-kat"));
proveri("prazna vrednost u traci znaci sve", /state\.posFilter = b\.dataset\.posKat \|\| null/.test(app));
proveri("traka se ne prikazuje kad je kategorija jedna", /kategorije\.length > 1/.test(app));
proveri("plocice kase su krupne za brzo kucanje", /\.pos-stavke \{[^}]*minmax\(min\(224px, 100%\)/.test(jedanRed));
proveri("racun je puna kolona uz spisak", /\.pos-layout \.cart \{[^}]*flex-direction: column/.test(jedanRed),
  "dok je bio visok koliko sadrzaj, prazan racun je bio kvadratic u praznom uglu");
proveri("prazan racun ima ikonu", /cart-empty">\$\{icon\("cash"\)\}/.test(app));

// ---- SHOP ----
// Isti kvar kao na Kasi: svaka kategorija je uzimala ceo red, a kartica je
// visoka 330px - jedan Red Bull je trosio celu traku i osam artikala se
// razvuklo na skoro dva ekrana skrolovanja (mereno 186% ekrana).
proveri("shop ima jedan spisak, ne red po kategoriji", !app.includes("prod-sekcija"));
proveri("kategorija u shopu se bira trakom", app.includes("data-shop-kat"));
proveri("kolone su svuda iste sirine", /\.prod-grid \{[^}]*repeat\(auto-fill, minmax\(min\(196px, 100%\)/.test(jedanRed),
  "inace kategorija sa jednim artiklom daje karticu razvucenu preko celog reda");
// Na kartici je pisalo "PIĆA" iako naslov iznad grupe vec kaze "PIĆA".
proveri("kategorija se ne ponavlja na kartici", !app.includes('<span class="prod-cat">'),
  "naslov grupe iznad kartica vec kaze koja je kategorija");
proveri("neograničena zaliha staje u jedan red", app.includes('prod-stock inf">Neograničeno'),
  '"Zaliha: bez limita" se lomilo na dva reda pored dugmeta');
// Naslovi grupa vise ne postoje u shopu - kategoriju kaze traka iznad spiska.
proveri("nema naslova grupe iznad kartica", !app.includes("prod-cat-title"));
// Na strani Igre naslov kategorije se pise samo kad ih ima vise od jedne;
// inace je iznad spiska stajalo "IGRE" a strana se vec zove "Igre".
proveri("kategorija se ne ponavlja ispod naslova strane", /const viseKategorija = Object\.keys\(cats\)\.length > 1/.test(app));
proveri("prazan shop objasnjava sta da se radi", app.includes("Shop je prazan"));
proveri("broj artikala se sklanja po srpskom", /oblik\(items\.length, "artikal"/.test(app));

// ---- LOGOVI ----
// Vreme i kategorija su stajali ispod teksta, pa je svaki zapis uzimao dva reda
// dok je desnih 60% reda ostajalo prazno. Vremena se nisu poredjala jedno ispod
// drugog, pa se lista nije mogla prelistati pogledom.
proveri("vreme stoji u svojoj koloni desno", /\.log-vreme \{[^}]*text-align: right/.test(jedanRed));
proveri("vremena se poredjaju jedno ispod drugog", /\.log-vreme \{[^}]*font-variant-numeric: tabular-nums/.test(jedanRed));
proveri("zapis staje u jedan red", !css.includes(".log-body"), "log-body je bio kolona koja je lomila red na dva");
proveri("kategorija se pise samo dok se gleda 'Sve'",
  /state\.logFilter \|\| "sve"\) === "sve"/.test(app),
  'kad je filter na "Prijave", oznaka "Prijave" uz svaki red ne kaze nista');
proveri("prazni logovi objasnjavaju sta ce ovde pisati", app.includes("Ovde se sam upisuje svaka prijava"));
proveri("broj zapisa se sklanja po srpskom", /oblik\(d\.total, "zapis"/.test(app), 'pisalo je "41 zapisa"');

// ---- DUGE STRANE ----
// Podesavanja su bila jedna kolona siroka 760px, a desnih 700px prazno - strana
// se skrolovala preko puna dva ekrana bez ikakvog razloga.
proveri("podesavanja se na sirokom ekranu dele u dve kolone",
  /@media \(min-width: 1500px\) \{[^@]*\.settings-col \{[^}]*grid-template-columns: 1fr 1fr/.test(jedanRed));
proveri("cene ostaju levo preko oba reda",
  /\.settings-col > \.card:first-child \{[^}]*grid-row: span 2/.test(jedanRed),
  "inace Kopije padnu nazad u levu kolonu i desno opet zjapi praznina");
// Uputstvo o slikama je stajalo otvoreno na vrhu i guralo sve sto se menja 181px nize.
proveri("uputstvo o slikama se skuplja", app.includes('<details class="card poz-pomoc"'));
proveri("zatvoreno uputstvo kaze sta je unutra", app.includes("dimenzija, format, svetlina"));
proveri("skupljeno uputstvo ima svoj izgled", /\.poz-pomoc > summary \{/.test(jedanRed));

// ---- BOCNI MENI NA NISKOM EKRANU ----
// Na 1366x768 je 184px menija ispadalo ispod ivice. Do "Radnika" i
// "Podešavanja" se stizalo samo skrolovanjem bocne trake, sto se ne primeti
// dok se ne potrazi - a 1366x768 je sasvim obican ekran za pult.
proveri("meni ima poseban raspored za niske ekrane", /@media \(max-height: 860px\)/.test(jedanRed));
proveri("naslovi grupa postaju crta kad je tesno",
  /@media \(max-height: 860px\) \{[^@]*\.nav-sec \{[^}]*height: 1px/.test(jedanRed),
  "cetiri naslova grupa trose 140px koje meni nema");
proveri("imena stavki se ne smanjuju",
  !/@media \(max-height: 860px\) \{[^@]*\.nav-item \{[^}]*font-size/.test(jedanRed),
  "sitniji tekst se tesko cita u zurbi, bolje uzeti razmak");

// ---- SITNICE KOJE SE VIDE SVAKI DAN ----
proveri("pretraga igraca se krije dok nema naloga", app.includes('$("#plTraka")'),
  "polje za pretragu nad praznim spiskom nema sta da trazi");
proveri("broj naloga se sklanja po srpskom", /oblik\(d\.total, "nalog"/.test(app),
  'pisalo je "1 naloga"');
proveri("broj porudzbina se sklanja po srpskom", /oblik\(active\.length, "aktivna"/.test(app));

// ---- PROFIL NA TELEFONU ----
// Bocni meni se na uskom ekranu pretvara u traku sa ikonama na dnu. Njegovo
// podnozje - smena, "Promeni lozinku", "Odjavi se" - se prosto SAKRIVALO, pa se
// sa telefona nije mogla otvoriti smena ni promeniti lozinka. A radnik smenu
// otvara bas sa telefona.
proveri("podnozje menija se na telefonu ne sakriva", !/\.side-logo, \.nav-sec, \.side-foot \{ display: none/.test(css),
  "tako su smena, promena lozinke i odjava bili nedostupni sa telefona");
proveri("podnozje se premesta u gornju traku", /function smestiProfil/.test(app));
proveri("premesta se cvor, ne kopija", /gde\.appendChild\(foot\)/.test(app),
  "kopija bi udvostrucila id-jeve i osluskivace");
proveri("prati promenu sirine ekrana", /USKO\.addEventListener\("change", smestiProfil\)/.test(app),
  "okretanje telefona menja sirinu bez ponovnog ucitavanja");
proveri("meni se u gornjoj traci otvara nanize", /\.pf-menu \{\s*top: calc\(100% \+ 8px\); bottom: auto/.test(css),
  "u bocnom meniju je isao navise, u gornjoj traci bi izasao iznad ekrana");

// ---- ALAT ZA PREGLED ----
proveri("pregled panela postoji", pregled.includes("PREGLED PANELA"));
proveri("pregled ne prijavljuje namerno skracen tekst", pregled.includes("textOverflow === \"ellipsis\""),
  "alat koji vice na isto pri svakom pokretanju prestane da se cita");
proveri("pregled meri koliko je strana popunjena", pregled.includes("popunjeno"),
  "skoro prazna strana je znak da nesto fali");
proveri("pregled trazi odsecen tekst", pregled.includes("scrollWidth > e.clientWidth"));
proveri("kod koji se izvrsava u strani stoji u zasebnim fajlovima", pregled.includes("u-strani"),
  "ugnjezden u tekst se escape lomio na svakoj izmeni i alat je tiho visio");

// ---- DUPLI KLIK NE SME DA NAPLATI DVAPUT ----
//
// Radnik na kasi radi u zurbi i pred gostom. Dok se dugme nije zakljucavalo,
// tri brza klika na "Naplati" pravila su TRI racuna: izmereno u pravom
// pregledacu, 390 dinara umesto 130. Dupli klik na "Dodaj" je isto tako
// dopunjavao kredit dvaput.
//
// Oba se otkriju tek na kraju smene, kao razlika u kasi koju niko ne ume da
// objasni - a razlika u kasi mora da ima ime.
//
// U launcheru je ta zastita postojala od ranije ("Poruci" se zakljucava do
// odgovora servera); u panelu je nije bilo, a bas se on koristi u guzvi.
proveri("postoji jedno mesto koje zakljucava dugme", /async function jednomKlik\(btn, posao/.test(app));
proveri("dugme se vraca bez obzira na ishod", /finally \{[\s\S]{0,200}btn\.disabled = false/.test(app),
  "neuspeo zahtev ne sme da ostavi radnika sa zakljucanim dugmetom");
proveri("ponovljen klik se odbija i ako stigne", /if \(!btn \|\| btn\.disabled\) return;/.test(app));

// Svako dugme koje pomera novac ili pravi naloge mora kroz njega.
for (const [sta, id] of [
  ["Naplati na kasi", "posSubmit"],
  ["Naplati u pop-upu", "omSubmit"],
  ["dopuna/skidanje kredita", "tuSave"],
  ["novi nalog igraca", "npSave"],
  ["brzi gosti", "gbSave"],
  ["otvaranje smene", "osOpen"],
  ["zatvaranje smene", "csClose"],
]) {
  const red = app.split("\n").find((l) => l.includes(`#${id}`) && l.includes("addEventListener"));
  proveri(`${sta} se zakljucava do odgovora`, !!red && red.includes("jednomKlik"), red?.trim().slice(0, 90));
}

// I da se sutra ne doda novo dugme bez zastite: nijedan klik-rukovalac ne sme
// SAM da zove rutu koja menja novac.
const nezasticeni = [];
for (const ruta of ['api\\("/pos"', "api\\(`/players/\\$\\{[^}]+\\}/topup`", "api\\(`/players/\\$\\{[^}]+\\}/paket`", 'api\\("/players/guests"', 'api\\("/shift/open"', 'api\\("/shift/close"']) {
  const re = new RegExp(ruta);
  app.split("\n").forEach((l, i) => {
    if (!re.test(l)) return;
    // Gleda se 12 redova unazad do pocetka rukovaoca klika.
    const okolina = app.split("\n").slice(Math.max(0, i - 12), i + 1).join("\n");
    const uKliku = /addEventListener\("click"/.test(okolina);
    if (!uKliku) return;
    if (/jednomKlik|b\.disabled = true/.test(okolina)) return;
    nezasticeni.push(`red ${i + 1}: ${l.trim().slice(0, 60)}`);
  });
}
proveri("nijedno dugme koje menja novac nije ostalo bez zastite", nezasticeni.length === 0, nezasticeni.join(" | "));

// ---- GRUPNA AKCIJA KOJA GASI IGRU MORA DA PITA ----
//
// "Zakljucaj" i "Odjavi" na racunaru sa igracem zatvaraju sesiju i GASE MU
// IGRU - isto kao "Ugasi", samo sto su "Ugasi" i "Restart" imali potvrdu a ova
// dva nisu. Jedan promasen klik na punoj igraonici prekida mec svima odjednom,
// a gost koji tako izgubi partiju sledeci put ide preko puta.
//
// Potvrda pri tom mora da kaze KOLIKO IH TRENUTNO IGRA - to je jedini broj koji
// tu nesto znaci. "Zakljucace se 5 racunara" ne govori nista.
proveri("grupna akcija broji koliko ih trenutno igra",
  /const igraju = ids\.filter\(\(id\) => state\.computers\.find\(\(c\) => c\.id === id\)\?\.player\)\.length/.test(app));
for (const akcija of ["lock", "logout"]) {
  proveri(`grupno "${akcija}" pita kad neko igra`, new RegExp(`${akcija}: igraju \\?`).test(app),
    "zatvara sesiju i gasi igru isto kao gasenje racunara");
}
proveri("prazni racunari se ne pitaju", /igraju \? \{ text: `Zaključaće se/.test(app),
  "pitanje bez sadrzaja se nauci da se preskace, pa se onda preskoci i ono pravo");
proveri("i 'Ugasi sve' kaze koliko ih igra", /const igraju = state\.computers\.filter\(\(c\) => c\.player\)\.length/.test(app));
proveri("grupno otkljucavanje kaze da ne dira sesije",
  /Sesije koje su u toku se ne diraju/.test(app),
  "radnik inace ne zna sme li da ga pusti dok je igraonica puna");

// ---- BLOKIRANJE NALOGA TAKODJE PREKIDA SESIJU ----
//
// Nije samo oznaka na nalogu: ako gost trenutno igra, blokiranje mu zatvara
// sesiju i gasi igru na licu mesta. Islo je bez ijednog pitanja, i bez hvatanja
// greske - kad zahtev padne, radnik ne vidi nista i misli da je nalog blokiran.
proveri("blokiranje pita ako igrac trenutno igra",
  /const zaRacunarom = !p\.banned && state\.computers\.find\(\(c\) => c\.player\?\.id === p\.id\)/.test(app));
proveri("potvrda kaze na kom racunaru igra", /Igrač trenutno igra na \$\{zaRacunarom\.name\}/.test(app));
proveri("neuspelo blokiranje se vidi", /api\(`\/players\/\$\{p\.id\}\/ban`[\s\S]{0,220}catch \(e\) \{ \$\("#epErr"/.test(app),
  "bez toga radnik misli da je nalog blokiran, a nije");

// Dupla instalacija na istu masinu: dva preuzimanja i dva instalatera istog
// programa u isto vreme, koji smetaju jedan drugom i oba padnu.
proveri("slanje instalacije se zakljucava", /#itSend[\s\S]{0,60}jednomKlik/.test(app));

// Istaknuta recenica ide kao svoje polje, ne kao HTML u tekstu: tekst se BEZI
// jer u njemu stoje imena racunara i naloga.
proveri("istaknuto upozorenje ima svoje polje", /opts\.istaknuto \? `<div class="confirm-hi">\$\{esc\(opts\.istaknuto\)\}/.test(app));
proveri("istaknuto upozorenje ima svoj stil", /\.confirm-hi \{/.test(css));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
