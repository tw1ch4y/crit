import { citajIzvor, brojac } from "./_okruzenje.mjs";
// VIP TRAKA NA VRHU POCETNE
//
// Zamisljena je kao napredak iz igara: znak, nivo, traka koja se puni, nagrada
// na kraju. Sam XP sistem jos ne postoji - pravila (sta daje iskustvo, koliko,
// sta se otkljucava) tek treba da se osmisle.
//
// Zato ovde stoji ZAKLJUCANO stanje sa pecatom "Uskoro!". Ono sto se ovde cuva
// je da traka NIKAD ne izmisli napredak: prazna traka bez objasnjenja je
// obecanje koje program ne ispunjava, a lazno popunjena je gore od toga.
//
// Druga stvar koja se cuva je UGOVOR sa serverom. Kad XP sistem stigne, server
// salje `vip: { nivo, naziv, xp, xpDo }` i traka se sama popuni - izgled se ne
// prepravlja. Da ugovor nije zapisan ovde, prvi ko bude pravio XP ne bi znao
// kako da ga ukljuci.
const { proveri, kraj } = brojac();
const rend = citajIzvor("client/renderer/js/launcher.js");
const css = citajIzvor("client/renderer/css/launcher.css");

// ---- 1) bez podataka: zakljucano, i to se VIDI ----
proveri("VIP traka postoji", /function rangTrakaHtml\(\)/.test(rend));
// Tri stanja, ne dva: nema podataka (stariji server ili neprijavljen igrac),
// poslednji nivo (traka puna, nema sta da se trazi) i sve ostalo.
proveri("bez podataka je zakljucana", /const ima = !!v && Number\.isFinite\(v\.nivo\);/.test(rend),
  "traka se crta tek kad server posalje nivo");
proveri("poslednji nivo nema laznu granicu", /const naKraju = ima && v\.poslednji;/.test(rend),
  "inace bi svaki sledeci dinar izgledao kao napredak ka necemu cega nema");
proveri("zakljucano stanje nosi pecat", /rang-pecat[\s\S]{0,120}Uskoro!/.test(rend),
  "prazna traka bez objasnjenja izgleda kao kvar, ne kao najava");
proveri("pecat se sklanja cim podaci stignu", /\$\{ima \? "" : `<div class="rang-pecat"/.test(rend));
proveri("bez podataka napredak je NULA", /: merljiv \? Math\.max\(0, Math\.min\(100,[\s\S]{0,40}: 0;/.test(rend),
  "izmisljen napredak je gori od nikakvog - igrac bi cekao nagradu koje nema");
proveri("bez podataka se ne izmislja ni nivo", /: "Nivo -"/.test(rend));

// ---- 2) sa podacima: racun je ogranicen ----
//
// Server je tudja strana. Pokvaren ili stariji server sme da posalje xp veci od
// granice ili negativan; traka tada ne sme da izadje iz svog okvira.
proveri("napredak se ograničava na 0-100", /Math\.max\(0, Math\.min\(100,/.test(rend),
  "xp veci od granice bi razvukao traku van okvira");
proveri("prikazuje se koliko fali i do kog nivoa", /XP do nivoa \$\{esc\(v\.sledeci/.test(rend),
  "broj bez imena nivoa ne kaze igracu sta dobija");

// ---- 3) ugovor sa serverom je zapisan ----
proveri("zapisano je sta server treba da posalje",
  /vip: \{ nivo: \d+, naziv: "[^"]+", xp: \d+, xpDo: \d+/.test(rend),
  "bez zapisanog oblika, onaj ko bude pravio XP ne zna kako da ga ukljuci");

// ---- 4) boja nosi znacenje, nije ukras ----
//
// Zlatna u celom programu znaci NAGRADU (nagradni tocak). VIP je nagrada, pa
// nosi istu boju. Boja kuce se ovde ne koristi - VIP bi se izgubio medju
// dugmadima, a ovo mora da se izdvoji.
proveri("VIP nosi zlatnu, ne boju kuce", /\.rang-ime \{[^}]*color: var\(--gold\)/.test(css),
  "zlatna znaci nagradu; boja kuce bi VIP izjednacila sa obicnim dugmetom");
proveri("traka se puni zlatnom", /\.rang-traka i \{[^}]*var\(--gold\)/.test(css));
proveri("zupci dele traku na nivoe", /\.rang-zub \{/.test(css),
  "bez njih je to linija koja raste, a ne napredak kroz nivoe");

// ---- 5) placeni prostor ima prednost ----
//
// Ako je vlasnik okacio promo banere, taj prostor je njegov. VIP traka se tada
// sklanja - inace bi nova funkcija pojela oglasni prostor koji neko placa.
proveri("promo baneri imaju prednost nad VIP trakom",
  /const levo = lista\.length[\s\S]{0,600}: rangTrakaHtml\(\);/.test(rend),
  "prostor koji je vlasnik platio ne sme da pojede nova funkcija");

// ---- REC "VIP" NE STOJI ONOME KO JE NIJE PLATIO ----
//
// Dok je VIP bio nagrada za peti nivo, na traci je pisalo "VIP" i to je imalo
// smisla. Cim je VIP poceo da se KUPUJE, isti natpis je postao greska na
// najvidljivijem mestu u programu: gost koji nije platio nista gledao je
// ogromno zlatno VIP iznad svoje trake. Citalo se kao da ga vec ima - a stvar
// koju vec imas se ne kupuje.
//
// Naslov trake je zato IME RANGA, a rec VIP se pojavljuje samo clanu.
proveri("naslov trake je ime ranga, ne rec VIP",
  /class="rang-ime">\$\{ima \? esc\(\(v\.naziv \|\| ""\)\.toUpperCase\(\)\)/.test(rend),
  "upisan natpis VIP je reklamirao clanarinu bas onome ko je nije kupio");
proveri("oznaka VIP zavisi od placene clanarine",
  /const jeClan = ima && !!v\.vip;/.test(rend) && /\$\{jeClan \? `<span class="rang-clan"/.test(rend));
proveri("i kaze koliko jos traje", /još \$\{v\.vipDana\}/.test(rend),
  "ko ne zna dokle mu vazi, ne obnavlja - obnavlja onaj koji vidi da mu istice");
// Zvezda je bila znak VIP-a. Na traci svakog gosta znacila bi da ga svi imaju.
proveri("u stitu je broj nivoa, ne zvezda",
  /class="rang-broj"/.test(rend) && !/vip-zvezda/.test(rend), "zvezda je znak clanarine");
proveri("broj u stitu ima svoj stil", /\.rang-broj \{/.test(css));
proveri("oznaka clana je zlatna", /\.rang-clan \{[\s\S]{0,220}color: var\(--gold\)/.test(css),
  "clanarina je nagrada - zlatna je tu na mestu");

kraj();
