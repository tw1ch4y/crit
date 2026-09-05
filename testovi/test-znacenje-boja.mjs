import { citajIzvor, brojac } from "./_okruzenje.mjs";
// BOJE KOJE NEŠTO ZNAČE
//
// Igrac ne cita launcher, nego ga POGLEDA: koliko mu je ostalo, ima li kredita,
// ima li nesto da se dobije. Zato cetiri boje nose znacenje i ne koriste se za
// ukras:
//
//   zlatna  nagrada (tocak, VIP, prelazak nivoa, otkljucano)
//   zelena  ima kredita
//   zuta    paznja (malo na stanju, uskoro istice)
//   crvena  istice vreme, zakljucano, nema na stanju
//
// Jezik se kvari na dva nacina, i oba su se vec desila:
//
//   1. ISTA BOJA NA DVA MESTA SA RAZLICITIM ZNACENJEM. Oznaka kategorije igre
//      bila je zlatna, pa je na polici stajalo dvanaest zlatnih natpisa odmah
//      ispod zlatne VIP trake. Oko je vukla kategorija igre - podatak koji nista
//      ne znaci - umesto onoga sto se stvarno dobija.
//
//   2. DVA IMENA, JEDNA VREDNOST. `--amber` i `--gold` su bile isti heks, pa je
//      "malo na stanju" izgledalo kao nagrada. Razlika je postojala samo u
//      imenu, a ime igrac ne vidi.
const { proveri, kraj } = brojac();
const css = citajIzvor("client/renderer/css/launcher.css");

const token = (ime) => {
  const m = new RegExp(`--${ime}:\\s*(#[0-9a-f]{6})\\s*;`, "i").exec(css);
  return m ? m[1].toLowerCase() : null;
};
const ton = (heks) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(heks.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const razlikaTona = (a, b) => { const x = Math.abs(ton(a) - ton(b)); return Math.min(x, 360 - x); };

const ZNACENJA = { gold: "nagrada", green: "ima kredita", amber: "pažnja", "red-status": "ističe vreme" };

// ---- 1) SVAKA POSTOJI ----
for (const [ime, sta] of Object.entries(ZNACENJA)) {
  proveri(`--${ime} postoji (${sta})`, !!token(ime), String(token(ime)));
}

// ---- 2) NIJEDNE DVE NISU ISTA BOJA ----
const imena = Object.keys(ZNACENJA);
for (let i = 0; i < imena.length; i++) {
  for (let j = i + 1; j < imena.length; j++) {
    const [a, b] = [token(imena[i]), token(imena[j])];
    if (!a || !b) continue;
    proveri(`--${imena[i]} i --${imena[j]} nisu ista vrednost`, a !== b,
      `oba su ${a}; dva imena za istu boju znace da razlika postoji samo u kodu, a igrac vidi jednu stvar`);
  }
}

// ---- 3) I RAZLIKUJU SE NA EKRANU, NE SAMO U BROJU ----
//
// #ffb527 i #ffb428 su razlicite vrednosti a ista boja. Poredi se TON, jer se
// po njemu boje razlikuju na prvi pogled.
for (let i = 0; i < imena.length; i++) {
  for (let j = i + 1; j < imena.length; j++) {
    const [a, b] = [token(imena[i]), token(imena[j])];
    if (!a || !b || ton(a) == null || ton(b) == null) continue;
    const d = razlikaTona(a, b);
    proveri(`--${imena[i]} i --${imena[j]} se razlikuju na ekranu (${Math.round(d)}°)`, d >= 15,
      `${a} i ${b} su ${Math.round(d)}° razmaknuti - igrac ih vidi kao istu boju`);
  }
}

// ---- 4) ZLATNA SE NE TROŠI NA UKRAS ----
const red = (uzorak) => css.split("\n").find((r) => r.includes(uzorak)) || "";
proveri("oznaka kategorije igre nije zlatna",
  !/var\(--gold\)/.test(red("background: rgba(var(--bg-rgb), 0.72); padding: 4px 8px;")),
  "dvanaest zlatnih natpisa na polici, tacno ispod zlatne VIP trake");
proveri("broj na izabranom čipu nije zlatan",
  !/var\(--gold\)/.test(red(".shop-cip.aktivan span")),
  "cip je vec osvetljen; druga oznaka na istom mestu je sum, a zlatna tu nista ne znaci");

// ---- 5) BOJA KUĆE IM SE NE PRIBLIŽAVA ----
//
// Ovo je isti racun kao u `zamerkeNaBoju`, ali sa druge strane: tamo se pita da
// li izabrana boja kuce upada u znacenje, ovde da fabricka vec ne upada.
const brend = token("brend");
for (const ime of imena) {
  const z = token(ime);
  if (!z || ton(z) == null || ton(brend) == null) continue;
  proveri(`fabrička boja kuće se ne meša sa --${ime}`, razlikaTona(brend, z) >= 22,
    `${brend} i ${z} su ${Math.round(razlikaTona(brend, z))}° razmaknuti`);
}

kraj();
