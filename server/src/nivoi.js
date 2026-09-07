// ISKUSTVO I NIVOI IGRAČA
//
// ODAKLE DOLAZI ISKUSTVO
//
// Jedan dinar koji je igrač POTROŠIO = jedan XP. Ne dinar koji je uplatio -
// potrošen. Razlika nije sitnica: dopuna je obećanje, a potrošnja je ono što se
// stvarno desilo. Ko dopuni 5000 i ode kući nije igrao, i nema šta da mu se
// računa.
//
// Troši se na dva načina i oba daju iskustvo: vreme za računarom (naplata teče
// dok igra) i piće iz shopa. Nagrada sa točka i poklonjen kredit NE daju XP -
// to je kuća dala, nije igrač zaradio, a inače bi točak bio prečica do nivoa.
//
// ZAŠTO OVDE, A NE U service.js
//
// Ovo je čist račun: iz jednog broja izlazi nivo, naziv i koliko fali. Nema
// bazu, nema mrežu, ništa se ne pamti - pa se može proveriti do kraja, bez
// podizanja servera. Sve što je oko toga (kad se dodaje, kome, i šta se
// otključava) stoji u service.js.

// Prag je UKUPAN XP potreban da se uđe u nivo.
//
// Razmak raste: prvi nivo dođe posle jedne duže posete, deseti tek posle mnogo
// njih. Sa cenom od 120 din/sat, jedan sat igre je 120 XP - pa je Bronza posle
// desetak sati, a Mit tek za stalnog gosta. Kriva se namerno ne diže brže:
// nivo koji se ne može dostići prestaje da bude cilj i postaje ukras.
// Imena su vezana za samo ime igraonice: CRIT je kritican pogodak. Bronza i
// Srebro ima svaka druga igraonica; ovo ima samo ova.
export const NIVOI = [
  { nivo: 1,  prag: 0,     naziv: "Prvi ulazak" },
  { nivo: 2,  prag: 1200,  naziv: "Zagrevanje",     otkljucava: "sara" },
  { nivo: 3,  prag: 3000,  naziv: "Pogodak",        otkljucava: "boja" },
  { nivo: 4,  prag: 5400,  naziv: "Serija",         otkljucava: "okvir" },
  { nivo: 5,  prag: 8400,  naziv: "Kritičan" },
  { nivo: 6,  prag: 12000, naziv: "Dupli krit" },
  { nivo: 7,  prag: 16200, naziv: "Trostruki krit" },
  { nivo: 8,  prag: 21000, naziv: "Nezaustavljiv" },
  { nivo: 9,  prag: 26400, naziv: "Legenda kuće" },
  { nivo: 10, prag: 32400, naziv: "Savršen krit" },
];

// Šta se otključava kojim nivoom - jedno mesto za tvrdnju, da se spisak u
// launcheru i provera na serveru ne raziđu.
//
// VIP VIŠE NIJE OVDE, I TO JE NAJVAŽNIJA ODLUKA U CELOM SISTEMU.
//
// Dok je VIP bio nagrada za peti nivo, bio je nešto što kuća DAJE - dakle
// trošak, i to baš najboljim gostima. Sada su to dve odvojene stvari:
//
//   RANG se ZARAĐUJE igranjem. Besplatan je, i on je status.
//   VIP se KUPUJE. Nosi pogodnosti, i on je prihod.
//
// Zato ovde ostaje samo ono što se zarađuje. Šta VIP nosi stoji u vip.js.
export const OTKLJUCAVANJA = {
  sara:  { nivo: 2, naziv: "Svoja šara",      opis: "Biraš pozadinsku šaru svog naloga" },
  boja:  { nivo: 3, naziv: "Boja imena",      opis: "Tvoje ime dobija boju koju izabereš" },
  okvir: { nivo: 4, naziv: "Okvir oko znaka", opis: "Znak na profilu dobija okvir" },
};

// Pokvaren ili nepostojeći XP se ponaša kao nula, ne kao greška: igrač bez
// iskustva je nov igrač, a ne kvar koji ruši ekran.
const ceo = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);

export function nivoZa(xpSirovo) {
  const xp = ceo(xpSirovo);
  let tekuci = NIVOI[0];
  for (const n of NIVOI) if (xp >= n.prag) tekuci = n;
  const sledeci = NIVOI.find((n) => n.nivo === tekuci.nivo + 1) || null;

  // Na poslednjem nivou nema "koliko fali". Traka se tada prikazuje punom -
  // ali se NE pravi lažna granica, jer bi svaki sledeći dinar izgledao kao
  // napredak ka nečemu čega nema.
  const uNivou = xp - tekuci.prag;
  const zaSledeci = sledeci ? sledeci.prag - tekuci.prag : 0;

  return {
    nivo: tekuci.nivo,
    naziv: tekuci.naziv,
    xp,
    // xpOd/xpDo su granice TEKUĆEG nivoa, ne ukupne - traka meri napredak
    // unutar nivoa, a ne od nule do kraja sveta.
    xpOd: tekuci.prag,
    xpDo: sledeci ? sledeci.prag : null,
    uNivou,
    zaSledeci,
    doSledeceg: sledeci ? sledeci.prag - xp : 0,
    poslednji: !sledeci,
    sledeciNaziv: sledeci ? sledeci.naziv : null,
  };
}

// Da li igrač sa tim iskustvom sme da koristi neku od stvari sa profila.
export function smeDa(xpSirovo, sta) {
  const o = OTKLJUCAVANJA[sta];
  if (!o) return false;
  return nivoZa(xpSirovo).nivo >= o.nivo;
}

// Spisak za launcher: šta je otključano, šta tek dolazi i na kom nivou.
export function otkljucanoZa(xpSirovo) {
  const n = nivoZa(xpSirovo).nivo;
  return Object.entries(OTKLJUCAVANJA).map(([kljuc, o]) => ({
    kljuc, naziv: o.naziv, opis: o.opis, nivo: o.nivo, otkljucano: n >= o.nivo,
  }));
}

// ŠTA SE OTKLJUČAVA: BOJA IMENA I OKVIR
//
// Stoji ovde, uz nivoe, a ne uz bazu - to su same nagrade, ne podaci o igraču.
// Tako do njih može i alat koji ne sme da otvori bazu (pregled izgleda), pa
// pregled ne mora da drži svoju kopiju spiska koja bi se s vremenom razišla.
export const BOJE_IMENA = {
  bela:     { naziv: "Bela",     heks: "#eef1f8" },
  plava:    { naziv: "Plava",    heks: "#4da3ff" },
  tirkizna: { naziv: "Tirkizna", heks: "#3fd0e0" },
  zelena:   { naziv: "Zelena",   heks: "#3dc97e" },
  zlatna:   { naziv: "Zlatna",   heks: "#ffb527" },
  narandzasta: { naziv: "Narandžasta", heks: "#ff8a3c" },
  ljubicasta: { naziv: "Ljubičasta", heks: "#a97bff" },
  roze:     { naziv: "Roze",     heks: "#ff7ac0" },
};
export const OKVIRI = {
  nema:   { naziv: "Bez okvira" },
  tanki:  { naziv: "Tanki" },
  dvojni: { naziv: "Dvojni" },
  zlatni: { naziv: "Zlatni" },
  puls:   { naziv: "Pulsirajući" },
};
