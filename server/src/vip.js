// VIP - ČLANARINA KOJA SE KUPUJE
//
// RANG SE ZARAĐUJE, VIP SE KUPUJE. To su dve odvojene stvari i to je cela
// zamisao:
//
//   Rang (nivoi.js) dolazi od igranja. Besplatan je i on je STATUS - ono čime
//   se gost hvali. Ne košta kuću ništa.
//
//   VIP se plaća. Nosi POGODNOSTI, i on je PRIHOD. Dok je VIP bio nagrada za
//   peti nivo, bio je trošak, i to baš na najboljim gostima - kuća je davala
//   popust onima koji bi ionako došli.
//
// ŠTA VIP SME DA NOSI
//
// Pravilo pri biranju pogodnosti: mora da bude nešto što je gostu OČIGLEDNO
// vredno, a kuću košta malo ili nimalo. Zato je od pet pogodnosti samo jedna
// (niži prag za točak) stvarni trošak, i taj je ograničen i podesiv.
//
//   dvostruk XP        Ne košta ništa. Rang je ono do čega je stalo baš onima
//                      koji bi VIP i kupili - a brže napredovanje ne uzima
//                      kući ni dinar.
//   izgled             Boje, okviri i šare koje se ne mogu dobiti nijednim
//                      nivoom. Nula dinara, a vidi se svima na rang listi.
//   oznaka VIP         Status pored imena. Nula dinara.
//   niži prag za točak Jedina stavka koja košta. Svima je prag 1200 nedeljno;
//                      VIP-u je niži (podesivo). Trošak je ograničen tablom
//                      nagrada, koju vlasnik i inače podešava.
//   prednost na kasi   VIP porudžbina ide na vrh spiska radniku. Nula dinara,
//                      a gost to oseti odmah.
//
// ZAŠTO SE PLAĆA KREDITOM
//
// Kredit je gost već platio kešom na kasi. Kad njime kupi VIP, taj novac je već
// u kasi - ovo ne uzima ništa, nego pretvara stajaći kredit u prihod. Uz to je
// samousluga: ne traži radnika, radi u tri ujutru, i gost ne mora da ustane.
//
// SVE SE PROVERAVA NA SERVERU
//
// Launcher zaključane stvari prikazuje sivo, ali launcher stoji na računaru
// igrača. Svaka pogodnost se proverava ovde, pri svakoj upotrebi.

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

// Boje i okviri koje NIJEDAN nivo ne otključava - samo VIP. Odvojeni su od
// spiska u nivoi.js baš zato da se ne mogu zaraditi igranjem: kad bi se mogli,
// VIP bi bio samo prečica, a prečica se ne kupuje.
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

// Novi rok. Kupovina dok VIP JOŠ TRAJE se nadovezuje na postojeći rok, ne
// počinje ispočetka - inače bi gost koji obnovi dan ranije izgubio taj dan, i
// to bi naučio da čeka da mu istekne. Čekanje je tačno ono što se ne želi.
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

// Prag za besplatan spin. VIP prag NIKAD nije viši od običnog: kad bi vlasnik
// greškom upisao veći broj, VIP bi postao kazna.
export function pragZaSpin({ jeVip, prag, vipPrag }) {
  const obican = Math.max(0, broj(prag, 1200));
  if (!jeVip) return obican;
  const v = Math.max(0, broj(vipPrag, PODRAZUMEVANO.tocakPrag));
  return Math.min(obican, v);
}
