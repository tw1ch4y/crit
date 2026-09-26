import { citajIzvor, brojac } from "./_okruzenje.mjs";
// Upozorenje pre isteka vremena.
//
// Pusta se prava funkcija iz client/main.js (izvucena iz izvora) sa laznim
// prozorom i zvukom:
//
//   1. pri prijavi se tiho obelezavaju samo pragovi koji su vec prosli; prag u
//      kom je igrac bas tada (npr. poslednji minut) se javlja
//   2. uz svako upozorenje ide i zvuk, jer se prozor preko ekskluzivnog punog
//      ekrana ne iscrta uvek
const { proveri, kraj } = brojac();
const izvor = citajIzvor("client/main.js");

const pocetak = izvor.indexOf("const PRAGOVI = [");
const kraj_ = izvor.indexOf("\n}", izvor.indexOf("function proveriVreme")) + 2;
if (pocetak < 0 || kraj_ < 2) { console.error("nisam nasao pragove u main.js"); process.exit(1); }
const kod = izvor.slice(pocetak, kraj_);

// Lazni prozor i lazni zvuk. `sesijaAktivna` je u main.js van ovog bloka, pa se
// ovde uvodi kao lokalna - zato i postoji setter.
const napravi = () => {
  const prikazano = [];
  const zvuk = [];
  const f = new Function("prikaziObavestenje", "sendToRenderer",
    "let sesijaAktivna = true;\n" + kod +
    "\nreturn { proveriVreme, sesija: (v) => { sesijaAktivna = v; }, zaboravi: () => { javljeniPragovi = new Set(); } };");
  const api = f(
    (o) => prikazano.push(o),
    (kanal, d) => { if (kanal === "vreme-istice") zvuk.push(d); },
  );
  return { ...api, prikazano, zvuk };
};

// ---- 1) PRIJAVA SA PUNO VREMENA: nista se ne javlja odmah ----
{
  const t = napravi();
  t.proveriVreme(3600, true);           // prijava sa sat vremena
  proveri("prijava sa sat vremena ne javlja nista", t.prikazano.length === 0);
  t.proveriVreme(3595);                 // prvo osvezavanje stanja
  proveri("ni prvo osvezavanje ne javlja nista", t.prikazano.length === 0);

  t.proveriVreme(30 * 60);
  proveri("na 30 minuta stize prvo upozorenje", t.prikazano.length === 1,
    JSON.stringify(t.prikazano.map((x) => x.naslov)));
  proveri("i kaze tacno koliko je ostalo", /30 minuta/.test(t.prikazano[0].naslov), t.prikazano[0].naslov);

  t.proveriVreme(30 * 60 - 5);
  proveri("isti prag se ne ponavlja", t.prikazano.length === 1);

  for (const sek of [15 * 60, 10 * 60, 5 * 60, 2 * 60, 60]) t.proveriVreme(sek);
  proveri("svih sest pragova se javi jednom", t.prikazano.length === 6,
    t.prikazano.map((x) => x.naslov).join(" | "));
  proveri("poslednje je 'jos 1 minut'", /1 minut$/.test(t.prikazano[5].naslov), t.prikazano[5].naslov);
}

// ---- 2) PRIJAVA SA MALO VREMENA ----
//
// Gost koji se prijavi sa 45 sekundi mora da dobije upozorenje pre nego sto se
// ekran zakljuca.
{
  const t = napravi();
  t.proveriVreme(45, true);             // prijava sa 45 sekundi
  proveri("prijava sa 45 s ne laze da ima 30 minuta",
    !t.prikazano.some((x) => /30|15|10|5 minut/.test(x.naslov)),
    t.prikazano.map((x) => x.naslov).join(" | "));
  t.proveriVreme(40);                   // sledece osvezavanje, pet sekundi kasnije
  proveri("ALI UPOZORENJE STIZE", t.prikazano.length === 1,
    "gost sa 45 sekundi je ranije bio zakljucan bez ijedne reci");
  proveri("i to ono pravo", /1 minut/.test(t.prikazano[0]?.naslov || ""), t.prikazano[0]?.naslov);
}

// ---- 3) VEZA PUKNE I VRATI SE PRED KRAJ ----
//
// Pri svakom vracanju veze server ponovo posalje stanje, pa se pragovi ponovo
// pamte "tiho". Ako to proguta i tekuci prag, igrac ostaje bez upozorenja.
{
  const t = napravi();
  t.proveriVreme(20 * 60, true);        // prijava sa 20 minuta
  t.proveriVreme(15 * 60);              // javi se prag od 15
  const preKida = t.prikazano.length;
  t.zaboravi();                          // veza pukla: launcher se ponovo prijavio
  t.proveriVreme(50, true);             // i vratio se sa 50 sekundi
  t.proveriVreme(45);
  proveri("posle vracene veze upozorenje i dalje stize", t.prikazano.length > preKida,
    "tiho pamcenje je gutalo i prag u kom je igrac bas tada bio");
}

// ---- 4) GOST SA 12 MINUTA NE DOBIJA "OSTALO TI JE 30" ----
{
  const t = napravi();
  t.proveriVreme(12 * 60, true);
  t.proveriVreme(12 * 60 - 5);
  proveri("nema laznog upozorenja o 30 minuta", t.prikazano.length === 0,
    t.prikazano.map((x) => x.naslov).join(" | "));
  t.proveriVreme(10 * 60);
  proveri("prvo upozorenje je ono koje je istina", /10 minuta/.test(t.prikazano[0]?.naslov || ""),
    t.prikazano[0]?.naslov);
}

// ---- 5) UZ SVAKU SLIKU IDE I ZVUK ----
//
// Igrac je u punom ekranu i prozor cesto ne vidi. Zvuk je jedini kanal koji ga
// sigurno stigne.
{
  const t = napravi();
  t.proveriVreme(3600, true);
  for (const sek of [30 * 60, 15 * 60, 10 * 60, 5 * 60, 2 * 60, 60]) t.proveriVreme(sek);
  proveri("svako upozorenje ima i zvuk", t.zvuk.length === t.prikazano.length,
    `slika ${t.prikazano.length}, zvuk ${t.zvuk.length}`);
  proveri("zvuk nosi koliko je ostalo", t.zvuk[0]?.minuta === 30, JSON.stringify(t.zvuk[0]));
  proveri("poslednja tri su hitna", t.zvuk.slice(3).every((z) => z.hitno === true),
    JSON.stringify(t.zvuk.map((z) => `${z.minuta}:${z.hitno}`)));
  proveri("prva tri nisu", t.zvuk.slice(0, 3).every((z) => z.hitno === false),
    JSON.stringify(t.zvuk.map((z) => `${z.minuta}:${z.hitno}`)));
}

// ---- 6) BEZ SESIJE SE NE JAVLJA NISTA ----
{
  const t = napravi();
  t.sesija(false);
  t.proveriVreme(60);
  proveri("zakljucan racunar ne dobija upozorenja", t.prikazano.length === 0);
}

// ---- 6b) DOPUNA KREDITA VRACA PRAGOVE ----
//
// Gost stigne do dva minuta, radnik mu dopuni na dva sata. Pragovi su svi vec
// potroseni, pa bi sledece upozorenje dobio tek na jedan minut - dva sata
// kasnije. Isto kao da ga nije ni bilo.
{
  const t = napravi();
  t.proveriVreme(3600, true);
  for (const sek of [30 * 60, 15 * 60, 10 * 60, 5 * 60, 2 * 60]) t.proveriVreme(sek);
  const preDopune = t.prikazano.length;
  proveri("pre dopune je javljeno pet pragova", preDopune === 5, String(preDopune));

  t.proveriVreme(2 * 3600);            // radnik dopunio na dva sata
  t.proveriVreme(30 * 60);             // posle dva sata igranja
  proveri("POSLE DOPUNE UPOZORENJA SE VRACAJU", t.prikazano.length === preDopune + 1,
    "pragovi su ostajali potroseni, pa se do jednog minuta nije javljalo nista");
  proveri("i to opet od 30 minuta", /30 minuta/.test(t.prikazano[preDopune]?.naslov || ""),
    t.prikazano[preDopune]?.naslov);
}

// A obicno igranje nadole ne sme da ponavlja isti prag.
{
  const t = napravi();
  t.proveriVreme(3600, true);
  t.proveriVreme(30 * 60);
  for (const sek of [29 * 60, 28 * 60, 20 * 60, 16 * 60]) t.proveriVreme(sek);
  proveri("dok vreme pada, prag se ne ponavlja", t.prikazano.length === 1,
    t.prikazano.map((x) => x.naslov).join(" | "));
}

// ---- 7) ZVUK ZA VREME SE NE MOZE UTISATI ----
//
// Ostali zvuci launchera imaju prekidac (Nalog > Mis i zvuk). Ovaj ga namerno
// zaobilazi: izgubljena sesija je skuplja od jednog nezeljenog tona.
const rend = citajIzvor("client/renderer/js/launcher.js");
proveri("postoji zvuk za istek vremena", /vreme: \(hitno\) =>/.test(rend));
const blok = rend.slice(rend.indexOf("vreme: (hitno) =>"), rend.indexOf("vreme: (hitno) =>") + 900);
proveri("ne prolazi kroz prekidac za zvuke", !/S\.sfxUkljucen/.test(blok),
  "ovo nije zvuk dugmeta nego jedino upozorenje koje stigne u pun ekran");
proveri("launcher slusa kanal za vreme", /onVremeIstice\(\(\{ minuta, hitno \}\)/.test(rend));
proveri("most nudi taj kanal", /onVremeIstice:/.test(citajIzvor("client/preload.js")));

kraj();
