// ZNAČKE
//
// Nivo kaže KOLIKO je neko trošio. Značka kaže ŠTA je radio - i to je ono što
// se pamti i prepričava: "ja imam Maratonca", "meni fali još jedna za Sve po
// redu". Nivo je jedan broj koji svi imaju; značke su ono po čemu se profil
// jednog gosta razlikuje od profila drugog.
//
// SVE SE RAČUNA IZ ONOGA ŠTO VEĆ POSTOJI U BAZI.
//
// Ništa se ne broji unapred i ništa se ne upisuje kad se značka zaradi. To je
// namerno i to je najvažnija odluka ovde: gost koji dolazi šest meseci otvori
// profil prvog dana kad ovo stigne i zatekne dvadeset zarađenih značaka, a ne
// prazan ekran uz "kreni da skupljaš". Sistem koji počinje od nule kažnjava baš
// one goste koji su najduže tu.
//
// Cena tog izbora je da se značke računaju pri svakom otvaranju profila. Zato
// sve stoji na jednom prolazu kroz statistiku (vidi statistikaIgraca u
// service.js), a ne na upitu po znački.
//
// Prag se bira tako da PRVA značka u nizu padne brzo (da se vidi da sistem
// postoji), a poslednja da bude stvarno teška.

// Grupe postoje da spisak od tridesetak značaka ne bude zid. Redosled je
// redosled prikaza.
export const GRUPE = {
  vreme: { naziv: "Vreme za mašinom", opis: "Koliko si proveo ovde" },
  igre: { naziv: "Igre", opis: "Šta si pokretao" },
  shop: { naziv: "Shop", opis: "Šta si naručivao" },
  sreca: { naziv: "Sreća", opis: "Nagradni točak" },
  odanost: { naziv: "Odanost", opis: "Koliko dugo i koliko redovno" },
};

// `uslov` dobija statistiku igrača i vraća:
//   broj  - dokle je stigao (za traku napretka)
// `cilj` je koliko treba. Značka je zarađena kad broj >= cilj.
//
// Značka bez cilja (cilj: 1) je "desilo se ili nije".
export const ZNACKE = [
  // ---- VREME ----
  { kljuc: "prvi-put", grupa: "vreme", naziv: "Prvi put", opis: "Prva sesija u igraonici",
    cilj: 1, uslov: (s) => s.poseta },
  { kljuc: "sati-10", grupa: "vreme", naziv: "Zagrejan", opis: "10 sati za mašinom",
    cilj: 10, uslov: (s) => s.sati },
  { kljuc: "sati-50", grupa: "vreme", naziv: "Ozbiljno", opis: "50 sati za mašinom",
    cilj: 50, uslov: (s) => s.sati },
  { kljuc: "sati-100", grupa: "vreme", naziv: "Sto sati", opis: "100 sati za mašinom",
    cilj: 100, uslov: (s) => s.sati },
  { kljuc: "sati-250", grupa: "vreme", naziv: "Inventar", opis: "250 sati za mašinom",
    cilj: 250, uslov: (s) => s.sati },
  // Duga sesija je stvar koju gost sam ispriča. Prag je 5 sati - preko toga se
  // vise ne igra usput.
  { kljuc: "maratonac", grupa: "vreme", naziv: "Maratonac", opis: "Jedna sesija duža od 5 sati",
    cilj: 1, uslov: (s) => (s.najduzaSesijaMin >= 300 ? 1 : 0) },
  { kljuc: "ranoranilac", grupa: "vreme", naziv: "Ranoranilac", opis: "Sesija počela pre 10 ujutru",
    cilj: 1, uslov: (s) => s.ranoSesija },
  { kljuc: "nocna", grupa: "vreme", naziv: "Noćna smena", opis: "Sesija počela posle 23h",
    cilj: 1, uslov: (s) => s.kasnaSesija },

  // ---- IGRE ----
  { kljuc: "prvi-pogodak", grupa: "igre", naziv: "Prvi pogodak", opis: "Pokrenuta prva igra",
    cilj: 1, uslov: (s) => s.pokretanja },
  { kljuc: "znatizeljan", grupa: "igre", naziv: "Znatiželjan", opis: "Probao 5 različitih igara",
    cilj: 5, uslov: (s) => s.razlicitihIgara },
  { kljuc: "istrazivac", grupa: "igre", naziv: "Istraživač", opis: "Probao 10 različitih igara",
    cilj: 10, uslov: (s) => s.razlicitihIgara },
  { kljuc: "odan", grupa: "igre", naziv: "Odan", opis: "50 puta pokrenuta ista igra",
    cilj: 50, uslov: (s) => s.najvisePutaIgra },
  { kljuc: "sve-po-redu", grupa: "igre", naziv: "Sve po redu", opis: "Pokrenuta svaka igra iz kataloga",
    cilj: 1, uslov: (s) => (s.igaraUKatalogu > 0 && s.razlicitihIgara >= s.igaraUKatalogu ? 1 : 0) },

  // ---- SHOP ----
  { kljuc: "prva-porudzbina", grupa: "shop", naziv: "Prva porudžbina", opis: "Nešto naručeno sa mesta",
    cilj: 1, uslov: (s) => s.porudzbina },
  { kljuc: "porudzbina-25", grupa: "shop", naziv: "Stalna mušterija", opis: "25 porudžbina",
    cilj: 25, uslov: (s) => s.porudzbina },
  { kljuc: "porudzbina-100", grupa: "shop", naziv: "Šank je tvoj", opis: "100 porudžbina",
    cilj: 100, uslov: (s) => s.porudzbina },
  { kljuc: "uvek-isto", grupa: "shop", naziv: "Uvek isto", opis: "20 puta isti artikal",
    cilj: 20, uslov: (s) => s.najvisePutaArtikal },

  // ---- SREĆA ----
  { kljuc: "prvi-spin", grupa: "sreca", naziv: "Prvi spin", opis: "Točak zavrten prvi put",
    cilj: 1, uslov: (s) => s.spinova },
  { kljuc: "dobitnik", grupa: "sreca", naziv: "Dobitnik", opis: "Točak ti je nešto doneo",
    cilj: 1, uslov: (s) => (s.dobitakUkupno > 0 ? 1 : 0) },
  { kljuc: "spin-10", grupa: "sreca", naziv: "Sreća prati", opis: "10 spinova",
    cilj: 10, uslov: (s) => s.spinova },

  // ---- ODANOST ----
  { kljuc: "poseta-10", grupa: "odanost", naziv: "Navratio", opis: "10 poseta",
    cilj: 10, uslov: (s) => s.poseta },
  { kljuc: "poseta-50", grupa: "odanost", naziv: "Poznanik", opis: "50 poseta",
    cilj: 50, uslov: (s) => s.poseta },
  { kljuc: "poseta-100", grupa: "odanost", naziv: "Naš čovek", opis: "100 poseta",
    cilj: 100, uslov: (s) => s.poseta },
  // Nedelja se broji od ponedeljka. Cetiri zaredom znaci da je gost usao u
  // naviku - to je jedina znacka koja meri REDOVNOST, ne zbir.
  { kljuc: "redovan", grupa: "odanost", naziv: "Redovan", opis: "4 nedelje zaredom bar jednom",
    cilj: 4, uslov: (s) => s.nedeljaZaredom },
  { kljuc: "clan-godinu", grupa: "odanost", naziv: "Godinu dana", opis: "Godinu dana od upisa",
    cilj: 365, uslov: (s) => s.danaOdUpisa },
];

const broj = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Spisak za launcher: sta je zaradjeno, dokle je stiglo i koliko treba.
//
// Vraca SVE znacke, i zaradjene i ne - jer nagrada koja se ne vidi unapred nije
// nagrada nego iznenadjenje, a iznenadjenje ne tera nikoga da dodje ponovo.
export function znackeZa(statistika) {
  const s = statistika || {};
  return ZNACKE.map((z) => {
    const dokle = Math.max(0, broj(z.uslov(s)));
    const cilj = Math.max(1, broj(z.cilj));
    return {
      kljuc: z.kljuc, grupa: z.grupa, naziv: z.naziv, opis: z.opis,
      cilj, dokle: Math.min(dokle, cilj),
      zaradjena: dokle >= cilj,
      // Napredak se salje gotov, da ga launcher ne racuna po svom.
      postotak: Math.min(100, Math.round((dokle / cilj) * 100)),
    };
  });
}

// Koliko ih je zaradjeno - za kratak prikaz ("14 od 25").
export const brojZaradjenih = (spisak) => (spisak || []).filter((z) => z.zaradjena).length;
