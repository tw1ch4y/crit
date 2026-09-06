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
proveri("naslov odeljka na Nalogu nije zlatan",
  !/var\(--gold\)/.test(red("text-transform: uppercase; letter-spacing: 0.05em; color:")),
  "odeljak se vec vidi izabran u meniju levo, a na istom ekranu stoji i prava zlatna nagrada");
proveri("količina u porudžbini nije zlatna", !/var\(--gold\)/.test(red(".por-st b {")),
  "\"1x\" je podatak, ne nagrada");

// ---- 5) ISTO STANJE, ISTA BOJA NA SVAKOM EKRANU ----
//
// "Porudzbina stize" postoji na dva mesta: kao traka u Shop-u i kao red na
// Nalogu. Dok je jedno bilo zlatno a drugo plavo, isti podatak je na dva ekrana
// izgledao kao dve razlicite stvari.
//
// Zivotni vek porudzbine ima svoje boje, i nijedna nije zlatna:
//   ceka / sprema se  boja kuce (posao je u toku)
//   doneto            zelena (gotovo)
//   otkazano          precrtano i sivo
for (const [sta, uzorak] of [
  ["red \"sprema se\" na Nalogu", ".por-red.sprema .por-status"],
  ["traka \"stize\" u Shop-u", ".st-t {"],
  ["izabran način plaćanja", ".nacin.aktivan svg"],
  ["artikal koji je u korpi", ".pice.izabrano {"],
]) {
  // Boja kuce se pise i kao `var(--brend)` i kao `rgba(var(--brend-rgb), x)`
  // (kad treba providna). Oba su ista boja; zlatne ne sme da bude ni u jednom.
  proveri(`${sta} nosi boju kuće, ne zlatnu`,
    /var\(--brend(-rgb)?\)/.test(red(uzorak)) && !/var\(--gold\)|255, 181, 39/.test(red(uzorak)),
    red(uzorak).trim().slice(0, 90));
}
proveri("doneto ostaje zeleno", /var\(--green\)/.test(red(".por-red.gotovo .por-status")),
  "zelena znaci gotovo; to se ne menja");

// ---- 7) NAGRADNI TOČAK JE IZ ISTE KUĆE ----
//
// Polja tocka su bila crvena, tamnocrvena, dve skoro crne, siva i zlatna - iz
// palete koja je odavno zamenjena. Tocak je zbog toga bio jedino mesto u
// launcheru koje ne lici na ostatak: crven i crn usred plavog i zlatnog
// programa. A crvena tu jos i protivreci sama sebi: u ostatku programa znaci
// "istice vreme" i "zakljucano", dok je tocak jedina prava nagrada.
const rend = citajIzvor("client/renderer/js/launcher.js");
proveri("boje točka se čitaju iz boje kuće, ne upisuju u kod", /function tocakBoje\(\)/.test(rend) &&
  /getPropertyValue\("--brend"\)/.test(rend),
  "vlasnik menja boju iz panela; tocak mora da je prati kao i sve ostalo");
const tocakBlok = rend.slice(rend.indexOf("function tocakBoje()"), rend.indexOf("function tocakBoje()") + 700);
proveri("u točku nema stare crvene", !/#d81f24|#8e1b20|#e23b34/.test(tocakBlok), tocakBlok.match(/#[0-9a-f]{6}/gi)?.join(" "));
proveri("nagrada u točku je zlatna", /#ffb527/.test(tocakBlok));

// ---- 6) PUNE PLOČE NOSE PODLOGU PROGRAMA ----
//
// Podloga je plava sa znaka, ne skoro crna. Ali velovi i ploce iz starije verzije
// ostali su upisani kao crna: rgba(5,5,9,.94) preko imena igre, rgba(16,16,23,.96)
// ispod obavestenja, #16161d na plocici bez korice. Svaka od njih je PUNA (ne
// senka), pa preko plave podloge radi tacno ono sto ne treba - obezbojava je
// nazad ka sivom, i to bas na mestima koja igrac gleda najduze.
//
// Dve stvari NISU ovo pravilo i ostaju:
//   cista crna (rgba(0,0,0,...)) - to su senke, i senka i treba da je crna
//   obojena ploca (npr. tamnocrvena ispod poruke o gresci) - ona nesto ZNACI
const cssKod = css.replace(/\/\*[\s\S]*?\*\//g, " ");
const skoroCrne = [...cssKod.matchAll(/rgba\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3}),\s*([\d.]+)\)/g)]
  .filter((m) => Number(m[4]) >= 0.5)                              // veo, ne senka
  .filter((m) => Math.max(+m[1], +m[2], +m[3]) <= 40)              // tamna
  .filter((m) => Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3]) <= 8) // siva, bez tona
  .filter((m) => !(+m[1] === 0 && +m[2] === 0 && +m[3] === 0))     // ciste senke
  .map((m) => m[0]);
proveri("nema punih ploča u staroj skoro crnoj", skoroCrne.length === 0,
  [...new Set(skoroCrne)].slice(0, 5).join(", "));

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
