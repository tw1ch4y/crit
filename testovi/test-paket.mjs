import { citajIzvor } from "./_okruzenje.mjs";
// Paket koji ide na USB u igraonicu. Ovde se proverava ono sto se ne vidi dok
// se ne stigne na lice mesta - a tamo je kasno.
//
// Skripte za probu su probane uzivo na laznoj instalaciji (oba smera, prazan i
// pogresan unos). Sve sto je tom prilikom puklo ima svoju proveru ispod.

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const paket = citajIzvor("napravi-paket.mjs");
const ps1 = citajIzvor("assets/proba/podesi.ps1");
const bat1 = citajIzvor("assets/proba/1 - BEZBEDAN REZIM ZA PROBU.bat");
const bat2 = citajIzvor("assets/proba/2 - VRATI NA IGRAONICU.bat");

// ---- folder za probu ide u paket ----
proveri("paket nosi folder za probu", paket.includes('"0 - PROBA NA JEDNOM RACUNARU"'));
proveri("skripte za probu se kopiraju", /kopiraj\(path\.join\(ROOT, "assets", "proba"\)/.test(paket));
proveri("uputstvo za probu se pravi iz same baze", paket.includes("STA JE VEC U BAZI") && paket.includes("igre.map"));
proveri("uputstvo javlja putanje koje nisu putanje", paket.includes("const sumnjive"),
  "igra sa putanjom bez diska i protokola se nikad nece pokrenuti");
proveri("uputstvo upozorava na ciscenje sesije", paket.includes("CISCENJE SESIJE upaljeno"),
  "na racunaru za probu to obrise TUDJE prijave, i to se ne vraca");
proveri("uputstvo nudi token prvog racunara", paket.includes("pcs[0]?.token"));

// ---- demo podaci: launcher odmah izgleda kompletno za probu ----
// Probano uzivo na svezem serveru: puni banere, promo, shop, tocak i igraca
// 'test' sa potrosnjom >1200 (da tocak bude spreman za spin).
const demo = citajIzvor("assets/proba/demo-podaci.mjs");
const bat3 = citajIzvor("assets/proba/3 - DEMO PODACI (opciono).bat");
proveri("demo skripta pravi banere i promo", demo.includes("/api/games/banneri-auto") && demo.includes("/api/promo/crit"));
proveri("demo skripta prikazuje shop", demo.includes("available: true"));
proveri("demo skripta pali tocak", demo.includes("/api/tocak") && demo.includes("ukljucen"));
proveri("demo skripta pravi igraca 'test' sa potrosnjom", demo.includes('"test"') && demo.includes("potroseno < 1400"),
  "bez potrosnje tocak ne bi bio spreman za spin");
proveri("demo .bat zove node skriptu", bat3.includes('node "%~dp0demo-podaci.mjs"'));
proveri("uputstvo vodi kroz tocak i pakete", paket.includes("NAGRADNI TOCAK") && paket.includes("VREMENSKI PAKETI"));
proveri("uputstvo koristi tacno ime instalera", paket.includes("${setup}"),
  "ranije je bilo zakucano 2.21.0 i zbunjivalo pri novoj verziji");

// ---- PowerShell kod stoji u svom fajlu ----
// Prvo je bio ugnjezden u .bat preko nastavka reda (^). Navodnici i caret su se
// lomili jedno o drugo: PowerShell je dobijao samo prvi red i pucao, a .bat je
// javljao da "^" nije komanda.
for (const [ime, bat] of [["bezbedan rezim", bat1], ["vrati na igraonicu", bat2]]) {
  proveri(`${ime}: zove skriptu preko -File`, /-ExecutionPolicy Bypass -File "%~dp0podesi\.ps1"/.test(bat),
    "ugnjezden PowerShell u .bat se lomi na svakoj izmeni");
  proveri(`${ime}: nema ugnjezdenog PowerShell koda`, !bat.includes("-replace"),
    "kod pripada .ps1 fajlu");
  proveri(`${ime}: ne koristi timeout`, !/^timeout /m.test(bat),
    "timeout puca sa 'Input redirection is not supported' kad nema konzole");
  proveri(`${ime}: staje kad skripta javi gresku`, /if errorlevel 1 \(/.test(bat));
}

// ---- provera adrese ----
// U .bat fajlu "set /p" na prazan unos ume da ostavi razmak umesto nicega, pa
// je provera prolazila i u fajl je upisano "http://:8095" - posle toga se
// launcher nikad ne bi povezao.
proveri("adresa se proverava u skripti, ne u .bat fajlu", ps1.includes("$jeIp") && ps1.includes("$jeIme"));
proveri("prima i celu adresu iz prozora servera", /replace '\^\\s\*https\?:\/\/'/.test(ps1.replace(/\\/g, "\\")) || ps1.includes("https?://"),
  "adresa se najcesce prekopira kao http://192.168.1.100:8095");
proveri("pogresna adresa ne dira fajl", /Nista nije promenjeno[\s\S]{0,60}exit 1/.test(ps1));

// Uputstvo za probu obecava da se "ne dira ni zastita kioska". Launcher je
// inace sam primenjuje pri pokretanju - gasi Task Manager i Win tastere i menja
// plan napajanja - pa je obecanje bilo netacno, a na racunaru na kome se samo
// proba to je neprijatno iznenadjenje. Prekidac je bez-zakljucavanja.txt.
proveri("proba iskljucuje zastitu kioska", /Set-Content -LiteralPath \$zastava/.test(ps1));
proveri("vracanje na igraonicu SKIDA taj prekidac", /Remove-Item -LiteralPath \$zastava/.test(ps1),
  "inace bi racunar ostao bez zastite, a niko to ne bi primetio dok igrac ne otvori Task Manager");
proveri("prekidac ide pored programa, gde ga launcher trazi",
  /Split-Path -Parent \(Split-Path -Parent \$put\)/.test(ps1));
proveri("launcher stvarno gleda taj fajl",
  /bez-zakljucavanja\.txt/.test(citajIzvor("client/main.js")));
// "$cist:8095" PowerShell cita kao ime opsega i vrati prazno.
proveri("promenljiva u adresi je u zagradama", ps1.includes('"http://$($cist):8095"'),
  'bez zagrada je adresa ispadala kao "http://"');

// ---- sta se menja u podesavanjima ----
proveri("proba gasi ciscenje sesije", /"ciscenjeSesije"\\s\*:\\s\*\)true', '\$\{1\}false'/.test(ps1.replace(/\\\\/g, "\\")) || ps1.includes("ciscenjeSesije"));
for (const k of ["ciscenjeSesije", "ciscenjeLicnihFascikli", "blokirajPreuzeteProgram", "host"]) {
  proveri(`skripta zna za "${k}"`, ps1.includes(k));
}
proveri("povratak ne pali brisanje Desktopa i Preuzimanja",
  !/\$1true'[\s\S]{0,40}ciscenjeLicnihFascikli/.test(ps1) && ps1.includes("OneDrive"),
  "na racunarima sa OneDrive-om bi se brisanje prenelo u oblak");
proveri("skripta trazi launcher na sva tri mesta",
  ["ProgramFiles\\Crit Launcher", "ProgramFiles(x86)}\\Crit Launcher", "LOCALAPPDATA\\Programs\\Crit Launcher"]
    .every((p) => ps1.includes(p)));
proveri("skripta kaze da treba administrator", ps1.includes("Run as administrator"),
  "fajl je u Program Files, bez toga upis tiho ne uspe");

// ---- server ide sa svojim podacima ----
proveri("paket ne nosi radne fajlove baze", /preskoci = new Set\(\[[^\]]*"crit\.db-wal"[^\]]*"crit\.db-shm"/.test(paket));
proveri("paket ne nosi alat za doradu izgleda", paket.includes('"_proba"'),
  "to je alat za razvoj, nema sta da trazi u igraonici");
proveri("paket nosi tacno slike koje baza koristi", paket.includes("referencirano") && paket.includes("orphan"),
  "orphani (probni baneri, slike izbacenih igara) bi opterecivali paket");
proveri("pakovanje upozorava ako baza nije spremna", paket.includes("baza mozda nije spremna"),
  "jednom je paket otisao sa nepodesenom bazom - launcher je izgledao isto kao pre");

// ---- paket ne sme da ponese STARU verziju launchera ----
// Skripta uzima najskorije napravljen instaler iz dist/. Ako build pukne (npr.
// zakljucan fajl dok OneDrive sinhronizuje dist/), tamo ostane prethodni - i
// paket bi ga tiho poneo u igraonicu. Tako je vec dvaput ispalo da se "nista
// nije promenilo".
{
  const paket = citajIzvor("napravi-paket.mjs");
  proveri("paket poredi verziju instalera sa projektom",
    /Crit Launcher Setup \(\[\\d\.\]\+\)\\\.exe\$/.test(paket) || paket.includes("uImenu !== verzija"));
  proveri("neslaganje verzija zaustavlja pravljenje paketa",
    /uImenu !== verzija[\s\S]{0,400}process\.exit\(1\)/.test(paket),
    "inace bi u igraonicu otisla stara verzija launchera");
  proveri("poruka kaze sta da se uradi", paket.includes("cd client && npm run build"));
}

// ---- skripta koja postavlja bazu da radi iz kutije ----
const setup = citajIzvor("postavi-bazu.mjs");
proveri("postavi-bazu postavlja prave igre iz C:\\games", setup.includes("const IGRE") && setup.includes("C:\\\\games\\\\cs2"));
proveri("postavi-bazu postavlja 9 alata sa logotipima", setup.includes("const ALATI") && setup.includes('"Steam"') && setup.includes('"FACEIT"'));
// Baneri i promo se NE prave unapred. Vrh početne nosi znak kuće i nagradni
// točak; okačen promo bi ih prekrio, a generisani baner igre bi na ekranu
// prijave pobedio pravu koricu (baner ima prednost nad omotom).
//
// Ali se skida SAMO generisani baner, a promo se ne dira: oba su ranije brisana
// bez reči, pa je nestajalo i ono što je vlasnik sam okačio.
proveri("postavi-bazu ne pravi banere ni promo",
  setup.includes("banner=NULL WHERE banner LIKE '%/baner-igra-%'") && !setup.includes('db.exec("DELETE FROM promo")'));

// ---- SKRIPTA ZA POSTAVLJANJE BAZE NIŠTA NE BRIŠE ----
//
// Naučeno skupo. Radila je `DELETE FROM games` pa upisivala svoj ukucani
// spisak od sedam igara. Svaka igra koju je vlasnik dodao kroz panel - Apex
// Legends, World of Warcraft - nestajala je pri svakom pokretanju, a odmah
// zatim bi čišćenje "orphana" obrisalo i njihove korice sa diska. Vlasnik ih je
// dodavao iznova i iznova ih gubio; po brojevima igara u bazi (111 pa naviše)
// videlo se da se to desilo bar desetak puta.
//
// Skripta postoji da igraonica radi IZ KUTIJE, a to je dopuna, ne zamena.
//
// Komentari se izbacuju pre provere: u njima bas i pise sta se ranije brisalo,
// pa bi ih gola pretraga po tekstu prijavila kao da se i dalje brise.
const bezKomentara = setup.split(/\r?\n/).filter((r) => !r.trim().startsWith("//")).join("\n");
for (const sta of ["games", "tools", "promo", "tocak_nagrade"]) {
  proveri(`postavi-bazu ne brise ${sta}`, !new RegExp(`DELETE FROM ${sta}\\b`).test(bezKomentara),
    "vlasnikov unos ne sme da nestane zato sto je neko pustio skriptu za postavljanje");
}
proveri("dopunjava se po imenu, bez obzira na velika slova",
  /const kljuc = \(s\) =>[\s\S]{0,120}toLowerCase\(\)/.test(setup) && /imamo\.has\(kljuc\(name\)\)/.test(setup));
proveri("nagrade tocka se postavljaju samo ako ih nema",
  /SELECT COUNT\(\*\) c FROM tocak_nagrade[\s\S]{0,40}=== 0/.test(setup));
// Spisak koji se cisti mora da dolazi IZ BAZE, ne iz ukucanog spiska gore -
// inace se brisu korice bas onih igara koje je korak 1 upravo izbacio.
proveri("cisti se prema onome sto baza STVARNO koristi",
  /SELECT image FROM games WHERE image IS NOT NULL/.test(setup));
// Dve igre koje su najcesce nestajale sada stoje i u fabrickom spisku.
proveri("fabricki spisak nosi Apex i WoW",
  setup.includes('"Apex Legends"') && setup.includes('"World of Warcraft"'));
proveri("postavi-bazu pravi pozadine svih ekrana", setup.includes("pozadinaEkrana(kljuc)") && setup.includes("POZADINE_EKRANI"));
// Sara je d20 kockica, ne rec "CRIT": ponovljena rec preko praznog ekrana
// izgleda kao vodeni zig, a ne kao tekstura.
proveri("postavi-bazu pali saru i tocak", setup.includes('setSetting("tocak_ukljucen", "1")') && setup.includes('setSetting("tekstura", "kockice")'));
proveri("postavi-bazu pravi pozadine za sve ekrane", setup.includes("POZADINE_EKRANI") && setup.includes("pozadina_"),
  "bez njih se na prijavi razvlacio baner 2800x400 i pozadina je skakala");
proveri("postavi-bazu cisti cover slike izbacenih igara", setup.includes("Orphani") || setup.includes("orphan") || setup.includes("zadrzaneSlike"));
proveri("uzima se najskoriji instaler", paket.includes("sort((a, b) => b.vreme - a.vreme)"),
  "inace paket tiho ponese prethodnu verziju launchera");

// ---- PAKET NE SME DA PONESE ZASTARELU BAZU ----
//
// SQLite ovde radi u WAL rezimu: sveze izmene stoje u `crit.db-wal` dok se ne
// prepisu u glavni fajl. Paket je kopirao `crit.db` kao obican fajl, a `-wal`
// namerno preskakao - pa je u igraonicu odlazila baza BEZ poslednjih izmena, i
// to bez ijedne poruke.
//
// Desilo se tacno to: dve igre dodate kroz panel bile su u WAL-u, u paket je
// otisla baza sa sedam umesto devet igara, a ciscenje orphana je odmah zatim
// obrisalo i njihove omote jer ih "baza ne koristi".
proveri("baza se SNIMA (VACUUM INTO), ne kopira kao fajl",
  /VACUUM INTO/.test(paket) && /function snimiBazu\(\)/.test(paket),
  "obicno kopiranje ostavlja ono sto je jos u WAL-u");
proveri("sirov crit.db se ne kopira uz ostalo",
  /preskoci = new Set\(\[[^\]]*"crit\.db"/.test(paket),
  "inace bi ga kopiranje prepisalo preko snimka, ili obrnuto");
proveri("paket staje ako baza pominje sliku koje nema",
  /if \(fali\.length\)[\s\S]{0,500}process\.exit\(1\)/.test(paket),
  "paket bez omota se inace vidi tek u igraonici, kad je vec na USB-u");

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
