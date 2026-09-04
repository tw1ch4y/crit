import { citajIzvor } from "./_okruzenje.mjs";
// Raspored ekrana u launcheru. Ovo su stvari koje se ne vide dok se ne pogleda
// prava slika na pravoj rezoluciji - zato uz svaku stoji sta je konkretno bilo
// pokvareno, da se ne "sredi" nazad.
// Slike se prave sa:  node pregled-electron.mjs

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const css = citajIzvor("client/renderer/css/launcher.css");
const launcher = citajIzvor("client/renderer/js/launcher.js");
const pregled = citajIzvor("testovi/pregled-electron.mjs");
const jedanRed = css.replace(/\s+/g, " ");

// ---- SHOP: jedan spisak, kategorije u traci iznad ----
// Svaka kategorija je imala svoj red kartica. Sa sedam artikala je svaki red
// bio popunjen do pola i pola ekrana je zjapilo prazno, a "Energetsko" i "Vode"
// su delile istu traku pa je izgledalo kao da su kartice nabacane gde je bilo
// mesta. Sada su sva pica u jednoj mrezi, a kategorija se bira trakom.
proveri("shop ima jedan spisak, ne red po kategoriji", !launcher.includes("shop-sekcija"));
proveri("kategorija se bira trakom iznad spiska", launcher.includes('class="shop-filter"') && launcher.includes("shop-cip"));
proveri("prazna vrednost u traci znaci sve", /S\.shopFilter = katEl\.dataset\.kat \|\| null/.test(launcher));
proveri("traka se ne prikazuje kad je kategorija jedna", /kategorije\.length > 1/.test(launcher));
proveri("kolone su svuda iste sirine", /\.shop-grid \{[^}]*repeat\(auto-fill, minmax\(/.test(jedanRed),
  "inace kategorija sa jednim picem daje karticu razvucenu preko celog reda");
proveri("spisak se ne razvlaci u visinu", /\.shop-grid \{[^}]*align-content: start/.test(jedanRed));

// ---- SHOP: kartica nema punu traku u boji kuce ----
// Sedam punih dugmadi "Dodaj" u boji kuce, jedno do drugog, bilo je prvo sto se
// vidi na ekranu. Punu boju sada nosi samo "Poruci"; na kartici stoji mali krug.
proveri("kartica pica nema puno crveno dugme", !launcher.includes("pice-dodaj"));
proveri("dodavanje ide malim okruglim dugmetom", launcher.includes('class="pice-plus"'));
proveri("krug dobija boju kuce tek pod misem", /\.pice-plus:hover \{[^}]*background: var\(--brend\)/.test(jedanRed));

// ---- SHOP: samo jedna linija dok nesto stize ----
// Ceo spisak je ranije stajao i ovde i na nalogu. Igracu u Shop-u treba samo
// odgovor na to da li stize; istorija mu treba na nalogu.
proveri("shop javlja da porudzbina stize", launcher.includes("shopPorudzbine()"));
proveri("to je jedna traka, ne spisak", /\.shop-traka \{/.test(jedanRed));
proveri("traka se vidi kao nesto na sta se klikce", /\.shop-traka \{[^}]*cursor: pointer/.test(jedanRed));
proveri("tacka na traci kuca dok se sprema", /\.st-tacka \{[^}]*animation: st-kuc/.test(jedanRed),
  "mirna tacka izgleda kao oznaka, a ne kao nesto sto je u toku");
// Mreza artikala se skroluje. Traka ispod nje je bila van vidnog polja, a
// postoji bas zato da se odgovor vidi na prvi pogled.
proveri("traka stoji IZNAD mreze artikala",
  /\$\{traka\}\$\{shopPorudzbine\(\)\}<div class="shop-grid">/.test(launcher),
  "ispod mreze je igrac mora skrolovati da bi saznao stize li mu pice");

// ---- BANER JE BANER: IGRE NE IDU U NJEGA ----
//
// U gornjoj traci je nekad stajala traka "Nastavi gde si stao" - tri poslednje
// igre kao sitna dugmad. Bilo je pogresno dvaput: baner je mesto za promo
// materijal osoblja ili znak igraonice (jedna mirna slika preko cele sirine), a
// zbog te trake se polica NAMERNO nije sortirala, da se iste igre ne ponove -
// pa je pokvareno ono sto je zaista korisno.
proveri("u baneru nema igara", !/hero-nastavi|hn-igra/.test(launcher),
  "baner nosi promo ili znak, ne pločice sa imenima igara");
proveri("promo baner osoblja ima prednost nad znakom", /const lista = S\.promo \|\| \[\];/.test(launcher));
proveri("kad promo nema, stoji znak igraonice", /: `<div class="hero-brend">/.test(launcher));
proveri("znak u baneru prati brend igraonice", /class="hb-logo brand-logo"/.test(launcher),
  "inace svaka igraonica gleda tudji logo usred svog banera");

// ---- MREZE NE SMEJU DA SIRE EKRAN ----
// "minmax(196px, 1fr)" na uskom ekranu daje kolonu siru od raspolozivog
// prostora i sadrzaj izadje iz ekrana. Sa min(...) se kolona skupi umesto da
// probije okvir - vazi na svakoj rezoluciji, bez media upita.
{
  // Vazi i za auto-fill i za auto-fit.
  const gole = [...jedanRed.matchAll(/minmax\((\d+)px, 1fr\)/g)].map((m) => m[0]);
  proveri("nijedna mreza ne tera kolonu siru od ekrana", gole.length === 0, gole.join(", "));
}

// ---- PRECICE: ime sme u dva reda ----
// Na 1366x768 osam precica deli 1306px, pa je na ime ostajalo oko 64px.
// "TEAM SPEAK", "BATTLENET" i "EPIC GAMES" su se secli na "TEAM S...".
proveri("ime precice sme da predje u dva reda", /\.site-name \{[^}]*-webkit-line-clamp: 2/.test(jedanRed));
proveri("ime precice se ne drzi u jednom redu", !/\.site-name \{[^}]*white-space: nowrap/.test(jedanRed),
  "nowrap bi vratio secenje na uskom ekranu");
proveri("logo precice se smanjuje na uskom ekranu", /\.site-logo \{[^}]*clamp\(38px/.test(jedanRed));
proveri("slika precice prati velicinu logotipa", /\.site-card\.cover \.site-cover \{[^}]*clamp\(38px/.test(jedanRed),
  "inace kartica sa slikom ispada iz stroja");

// ---- NALOG JE MENI, NE SPISAK PANELA ----
//
// Porudzbine, pozadina i lozinka su ranije stajale jedna ispod druge na istom
// ekranu. Sve se videlo odjednom, nista nije imalo prednost, strana je izgledala
// pretrpano i rasla je sa svakom novom stvari. Sada je levo meni, desno jedan
// odeljak.
proveri("nalog ima meni i sadrzaj", /\.acc-telo \{[^}]*grid-template-columns: 216px minmax\(0, 1fr\)/.test(jedanRed));
proveri("meni ima svoje stavke", /\.acc-mi \{/.test(jedanRed));
proveri("izabrana stavka se jasno vidi", /\.acc-mi\.aktivna \{[^}]*box-shadow: inset 2px 0 0 var\(--brend\)/.test(jedanRed),
  "bez oznake igrac ne zna gde je");
proveri("skroluje se SADRZAJ, ne cela strana", /\.acc-sadrzaj \{[^}]*overflow-y: auto/.test(jedanRed) && !/\.account \{[^}]*overflow-y: auto/.test(jedanRed),
  "kad skroluje cela strana, zaglavlje sa kreditom odlazi sa ekrana");
proveri("zaglavlje ostaje na mestu", /\.account \{[^}]*display: flex; flex-direction: column/.test(jedanRed));
proveri("na uzem ekranu meni ide vodoravno", /max-width: 1100px\)/.test(jedanRed) && /\.acc-meni \{ flex-direction: row/.test(jedanRed),
  "uspravni meni od 216px na uzem ekranu pojede pola sadrzaja");
// Odeljci moraju da izgledaju isto - inace meni vodi na cetiri razlicita ekrana.
proveri("svi odeljci imaju isti oblik", (launcher.match(/class="acc-sek"/g) || []).length >= 4);
proveri("svaki odeljak ima naslov i objasnjenje", /\.acc-sek-h h3 \{/.test(jedanRed) && /\.acc-sek-h p \{/.test(jedanRed));
proveri("prazan odeljak kaze sta da se uradi", /\.acc-prazno \.ap-o \{/.test(jedanRed),
  "samo 'nema nicega' ostavlja igraca da se pita da li je nesto puklo");

// ---- ZNACKA NA TABU ----
// Aktivan tab vec koristi ::after za crvenu liniju ispod sebe. Kad je i znacka
// isla kroz ::after, dva pravila su se stopila u crveni blok koji je progutao
// ceo tab - rec "NALOG" se nije videla.
proveri("znacka je pravi element, ne ::after", css.includes(".tab-znacka") && !/\.tab\.ima-znacku::after/.test(css),
  "::after je zauzet crvenom linijom aktivnog taba");
proveri("launcher pravi znacku kao element", launcher.includes('z.className = "tab-znacka"'));
proveri("znacka nestaje kad nema porudzbina", /if \(!cekaju\) \{ if \(z\) z\.remove\(\); return; \}/.test(launcher));

// ---- OZNAKA KATEGORIJE NA KORICI ----
proveri("oznaka kategorije stoji dole, ne preko logotipa", /\.tile-badge \{[^}]*bottom: 46px/.test(jedanRed));

// ---- PUKLA VEZA USRED IGRANJA ----
// Igracu nestane ceo ekran i ostane na "Povezivanje sa serverom...". Bez ijedne
// reci o vremenu prvo pomisli da mu kredit curi dok gleda spiner, pa zove
// osoblje. Server naplatu pauzira dok racunar nije na vezi, tako da poruka nije
// teha nego tacna informacija.
const html = citajIzvor("client/renderer/index.html");
proveri("ekran bez veze objasnjava sta je sa vremenom", html.includes("connSesija"));
proveri("poruka kaze da se vreme ne trosi", /Vreme ti se ne troši dok nema veze/.test(html));
proveri("poruka se prikazuje samo ako je igrac bio prijavljen",
  /connSesija"\)\.classList\.toggle\("hidden", !S\.player\)/.test(launcher),
  "pri paljenju racunara nema sta da se cuva, poruka bi samo zbunjivala");
proveri("poruka nestaje kad se veza vrati", /if \(connected\) \$\("#connSesija"\)\.classList\.add\("hidden"\)/.test(launcher));

// ---- PRAZNA STANJA I PORUKE ----
// Prazan shop je bio sitan sivi tekst zalepljen uz vrh ogromne praznine -
// izgledalo je kao da je nesto puklo. Ostala prazna stanja imaju ikonu i
// objasnjenje, pa mora i ovo.
proveri("prazan shop ima ikonu i objasnjenje", launcher.includes("Shop je prazan"));
proveri("poruka praznog shopa stoji u sredini",
  /\.shop-products \.empty-view \{[^}]*flex: 1/.test(jedanRed),
  "bez toga bi se zalepila uz vrh prazne strane");
proveri("korpa ne salje igraca na praznu stranu", launcher.includes("Trenutno nema šta da se poruči"),
  'inace bi pisalo "izaberi sa leve strane" a tamo nema niceg');

// Poruke su stajale 28 px od dna, a donja traka je 38 px - preklapale su se.
// Bas poruka o gresci zavrsavala je poluprekrivena.
proveri("poruke stoje iznad donje trake", /\.toasts \{[^}]*bottom: 56px/.test(jedanRed));
proveri("greska je vidljivija od obicne poruke", /\.toast\.error \{[^}]*border-left-width: 4px/.test(jedanRed));

// ---- RASPORED POCETNE ----
// Vrh nosi znak kuce levo i tocak desno; traka je niska da bi ostalo mesta
// koricama. Polica je na 1080p gubila 163 px izmedju imena igara i alata.
// Znak nosi i klasu "brand-logo", da ga primeniBrend zameni znakom te
// igraonice - inace bi svaka gledala tudji logo usred svog banera.
proveri("vrh pocetne nosi znak kuce", launcher.includes('class="hb-logo brand-logo" src="img/crit-logo.png"'));
proveri("tocak stoji u vrhu, kao deo trake", launcher.includes("heroTocakHtml()") && /\.hero-tocak \{[^}]*flex: 0 0 auto/.test(jedanRed));
proveri("traka ima svoju visinu, ne odnos strana", /\.hero \{[^}]*height: clamp\(/.test(jedanRed));
proveri("korice popunjavaju policu", /\.games-shelf \.tile \{[^}]*max-height: 505px/.test(jedanRed));
// Sredina trake je izmedju znaka i tocka ostajala prazna ploha.
proveri("sredina trake ima dubinu", /\.hero::before \{/.test(jedanRed));
proveri("znak i tocak stoje IZNAD sare", /\.hero-brend \{ position: relative; z-index: 1/.test(jedanRed) && /\.hero-tocak \{ position: relative; z-index: 1/.test(jedanRed));

// ---- ALAT ZA PREGLED ----
// Bez ovoga se raspored "proverava" na jednom ekranu i jednoj rezoluciji, pa
// se ovakve stvari otkriju tek u igraonici.
proveri("pregled slika svih pet ekrana",
  ["1-prijava", "2-pocetna", "3-shop", "4-nalog", "5-zakljucan"].every((e) => pregled.includes(e)));
proveri("pregled gleda i slabiji racunar", pregled.includes("1366x768"));
proveri("pregled ceka da pozdravna animacija prodje", pregled.includes("sacekajPozdrav"),
  "inace se slika uhvati pozdrav preko celog ekrana umesto ekrana koji se gleda");
proveri("pregled meri sta stvarno izlazi iz ekrana", pregled.includes("seckaGa"),
  "bez toga police koje se pomeraju vodoravno prijavljuju laznu gresku");
proveri("pregled trazi odsecen tekst", pregled.includes("scrollWidth > e.clientWidth"));
proveri("pregled slika i prazna stanja i kvarove",
  ["6-prazno", "7-prazan-shop", "8-nema-veze", "9-igra-nece"].every((e) => pregled.includes(e)),
  "to igrac vidi u najgorem trenutku");
proveri("pregled slika i obavestenja preko igre", pregled.includes("OBAVESTENJA") && pregled.includes("overlay.html"),
  "odbrojavanje pred odjavu je poseban prozor, ne deo launchera");
proveri("pregled ne gasi sam sebe izmedju prozora", pregled.includes('app.on("window-all-closed"'),
  "Electron podrazumevano gasi aplikaciju kad se zatvori poslednji prozor - pregled je tako umirao bez ijedne poruke");

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
