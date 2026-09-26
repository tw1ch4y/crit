// Iskustvo i nivoi igrača.
//
// Jedan potrošen dinar = jedan XP (vreme za računarom i piće). Dopuna,
// poklonjen kredit i nagrada sa točka ne daju iskustvo.
//
// Ovde je samo račun (iz iskustva nivo, naziv i koliko fali), bez baze;
// kada se iskustvo dodaje i šta otključava je u service.js.

// Prag je ukupan XP potreban za ulazak u nivo. Razmak raste: pri 120 din/sat
// drugi nivo je posle nekoliko sati, a poslednji za stalnog gosta. Imena
// nivoa prate ime igraonice.
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

// Šta se otključava kojim nivoom; isti spisak koriste launcher i provera na
// serveru. VIP pogodnosti nisu ovde (vip.js).
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

  // Na poslednjem nivou traka je puna i nema "koliko fali".
  const uNivou = xp - tekuci.prag;
  const zaSledeci = sledeci ? sledeci.prag - tekuci.prag : 0;

  return {
    nivo: tekuci.nivo,
    naziv: tekuci.naziv,
    xp,
    // xpOd/xpDo su granice tekućeg nivoa, ne ukupne - traka meri napredak
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

// Boje imena i okviri (nagrade po nivou). Ovde su, ne uz bazu, da ih koristi
// i alat koji ne otvara bazu.
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
