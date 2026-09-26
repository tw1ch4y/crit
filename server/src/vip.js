// VIP članarina.
//
// Rang (nivoi.js) se zarađuje igranjem i besplatan je; VIP se kupuje i nosi
// pogodnosti:
//
//   dvostruk XP          brže napredovanje u rangu
//   izgled               boje, okviri i šare koje ne daje nijedan nivo
//   oznaka VIP           pored imena
//   niži prag za točak   jedina pogodnost koja košta; podesiva
//   prednost na kasi     VIP porudžbina ide na vrh spiska
//
// Plaća se kreditom (gost ga je već uplatio na kasi), samouslužno iz
// launchera. Svaka pogodnost se proverava na serveru.

export const PODRAZUMEVANO = {
  ukljucen: false,
  cena: 1500,      // dinara za jedan period
  dana: 30,        // koliko traje
  xpMnozilac: 2,   // dvostruko iskustvo
  tocakPrag: 700,  // prag za spin dok je VIP (svima je 1200)
};

// Šta gost dobija, onako kako mu se i prikazuje. Redosled je redosled prikaza:
// prvo ono što se najviše oseti.
export const POGODNOSTI = [
  { kljuc: "xp", naziv: "Dvostruko iskustvo",
    opis: "Svaki dinar nosi duplo. Do sledećeg ranga stižeš upola brže." },
  { kljuc: "tocak", naziv: "Niži prag za točak",
    opis: "Besplatan spin ti stiže ranije nego ostalima." },
  { kljuc: "izgled", naziv: "VIP boje i okviri",
    opis: "Boje imena i okviri koje nijedan nivo ne otključava." },
  { kljuc: "oznaka", naziv: "VIP oznaka",
    opis: "Stoji uz tvoje ime, i na rang listi igraonice." },
  { kljuc: "kasa", naziv: "Prednost na kasi",
    opis: "Tvoja porudžbina ide na vrh spiska kod osoblja." },
];

// Boje i okviri koje ne otključava nijedan nivo, samo VIP.
export const VIP_BOJE = {
  plamen:  { naziv: "Plamen",  heks: "#ff6a3d", vip: true },
  led:     { naziv: "Led",     heks: "#7ad7ff", vip: true },
  otrov:   { naziv: "Otrov",   heks: "#a6ff4d", vip: true },
  ametist: { naziv: "Ametist", heks: "#c77dff", vip: true },
};
export const VIP_OKVIRI = {
  krit:   { naziv: "Krit", vip: true },
  zlatni_puls: { naziv: "Zlatni puls", vip: true },
};

const broj = (v, ako) => (Number.isFinite(Number(v)) ? Number(v) : ako);

// Da li je članarina još u važnosti. Prošlo vreme = nije VIP, bez izuzetka i
// bez "još malo": rok koji se tiho produžava nije rok.
export function vaziVip(vipDo, sada = Date.now()) {
  const do_ = broj(vipDo, 0);
  return do_ > 0 && do_ > sada;
}

// Koliko je još ostalo, u danima naviše. Prikazuje se gostu, pa se zaokružuje
// NAGORE: ko ima još pola dana ima "još 1 dan", ne "još 0".
export function danaOstalo(vipDo, sada = Date.now()) {
  if (!vaziVip(vipDo, sada)) return 0;
  return Math.ceil((broj(vipDo, 0) - sada) / 86400000);
}

// Novi rok: kupovina dok VIP još traje nadovezuje se na postojeći rok.
export function novRok(vipDo, dana, sada = Date.now()) {
  const d = Math.max(1, Math.floor(broj(dana, PODRAZUMEVANO.dana)));
  const od = vaziVip(vipDo, sada) ? broj(vipDo, sada) : sada;
  return od + d * 86400000;
}

// Množilac iskustva. Ne-VIP je uvek 1 - množilac manji od 1 bi značio kaznu za
// one koji nisu kupili, a to nije isto što i nagrada za one koji jesu.
export function xpMnozilac(jeVip, podesen) {
  if (!jeVip) return 1;
  const m = broj(podesen, PODRAZUMEVANO.xpMnozilac);
  return m >= 1 ? m : 1;
}

// Prag za besplatan spin. VIP prag nikad nije viši od običnog: kad bi vlasnik
// greškom upisao veći broj, VIP bi postao kazna.
export function pragZaSpin({ jeVip, prag, vipPrag }) {
  const obican = Math.max(0, broj(prag, 1200));
  if (!jeVip) return obican;
  const v = Math.max(0, broj(vipPrag, PODRAZUMEVANO.tocakPrag));
  return Math.min(obican, v);
}
