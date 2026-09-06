import { citajIzvor } from "./_okruzenje.mjs";
// Launcher se predaje klijentu i ne sme da odaje da je radjen uz pomoc AI.
// Ovde se hvataju konkretni tragovi koje je vlasnik prepoznao i trazio da nestanu:
// duge crte kao separator, ukrasne strelice/kvacice, tackice izmedju reci, i
// plutajuce "debug" oznake preko ekrana prijave.
//
// Provera gleda SAMO tekst koji igrac vidi (HTML i sablonske niske u JS-u),
// ne i kod - minus u racunu i crtica u komentaru su normalni.

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const html = citajIzvor("client/renderer/index.html");
const js = citajIzvor("client/renderer/js/launcher.js");
// Ceo interfejs je latinica. Locale "sr-RS" datume ispisuje ĆIRILICOM
// ("субота, 22. 8. 2026."), pa je u spisku logova usred latiničnog panela
// stajao ćirilični naziv dana - izgleda kao da je nešto ostalo nedovršeno.
// "sr-Latn-RS" daje isto formatiranje brojeva, samo latinicom.
for (const [gde, izvor] of [
  ["launcher", citajIzvor("client/renderer/js/launcher.js")],
  ["panel", citajIzvor("server/public/js/app.js")],
  ["server", citajIzvor("server/src/service.js")],
]) {
  const gole = (izvor.match(/"sr-RS"/g) || []).length;
  proveri(`${gde}: datumi i brojevi idu latinicom`, gole === 0, `${gole} mesta sa "sr-RS"`);
}

const css = citajIzvor("client/renderer/css/launcher.css");
const overlay = citajIzvor("client/renderer/overlay.html");

// Komentari nisu ono sto igrac vidi - izbaci ih pre provere teksta.
const bezKomentara = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ")
  .replace(/<!--[\s\S]*?-->/g, " ");

const jsTekst = bezKomentara(js);
const htmlTekst = bezKomentara(html);
const cssTekst = bezKomentara(css);

// ---- duge crte kao stilski separator ----
// "—" i "–" su najprepoznatljiviji AI potpis u tekstu.
for (const [ime, izvor] of [["launcher.js", jsTekst], ["index.html", htmlTekst], ["overlay.html", bezKomentara(overlay)]]) {
  const nadjeno = (izvor.match(/[—–]/g) || []).length;
  proveri(`${ime}: nema dugih crta (— –)`, nadjeno === 0, `${nadjeno} komada`);
}

// ---- tackica kao separator izmedju reci ----
// "18:53 · sa kredita · 210 RSD" - razdvaja se razmakom, ne interpunkcijom.
//
// Gleda se i HTML zapis (&middot;, &bull;, &mdash;): u profilu je stajalo
// "Srebro &middot; nivo 3" - na ekranu tackica, u fajlu nije, pa je proslo
// pored pravila. Pravilo je o onome sto igrac VIDI.
//
// PANEL SE PROVERAVA ISTO. Isti covek gleda oba ekrana, cesto jedan pored
// drugog; pravilo koje vazi samo za launcher deli program na dve kuce.
const panelJs = bezKomentara(citajIzvor("server/public/js/app.js"));
const panelHtml = bezKomentara(citajIzvor("server/public/index.html"));
const ZNAKOVI = [["·", /·/g], ["&middot;", /&middot;|&bull;|&#183;|&#8226;/gi], ["— –", /[—–]|&mdash;|&ndash;/gi]];
// GLAVNI PROCES TAKODJE PRICA SA IGRACEM.
// Poruke o pokretanju igre, o programu iz Preuzimanja i o podesavanjima nastaju
// u client/main.js, a ne u launcher.js - pa je pravilo do sada preskakalo bas
// ono sto igrac procita kad nesto ne radi.
const glavni = bezKomentara(citajIzvor("client/main.js"));
for (const [ime, izvor] of [["launcher.js", jsTekst], ["index.html", htmlTekst],
                           ["panel app.js", panelJs], ["panel index.html", panelHtml],
                           ["main.js", glavni]]) {
  for (const [sta, uzorak] of ZNAKOVI) {
    const nadjeno = (izvor.match(uzorak) || []).length;
    proveri(`${ime}: nema "${sta}" kao separatora`, nadjeno === 0, `${nadjeno} komada`);
  }
}

// ---- ukrasne strelice i kvacice u tekstu ----
const ukrasi = /[→←↑↓✓✗✔✖✨★☆➜⟶»›▸►•]/g;
for (const [ime, izvor] of [["launcher.js", jsTekst], ["index.html", htmlTekst]]) {
  const nadjeno = izvor.match(ukrasi) || [];
  proveri(`${ime}: nema ukrasnih simbola`, nadjeno.length === 0, nadjeno.join(" "));
}

// ---- plutajuce oznake preko ekrana prijave ----
// Gore levo je stajalo "PC-07", gore desno pilula "POVEZANO". To je izgledalo
// kao razvojni HUD nalepljen preko dizajna, ne kao deo proizvoda.
proveri("nema plutajuce oznake racunara (pc-tag)", !html.includes('id="pcTag"') && !css.includes(".pc-tag"),
  "oznaka racunara stoji u dnu kartice za prijavu, tiho");
proveri("nema plutajuce trake sa stanjem veze", !html.includes('id="wsDot"') && !html.includes('class="status-line"'),
  "stanje veze se vidi u donjoj traci i na ekranu 'Povezivanje'");
proveri("oznaka racunara postoji u kartici", html.includes('id="loginPc"'),
  "gost mora da zna za kojim racunarom sedi kad zove osoblje");

// ---- duge linije koje blede u prazno ----
// Linija koja "vodi pogled" od naslova ka kraju reda je ukras bez funkcije i
// najvise je odavala generisan izgled.
proveri("naslov police nema ukrasnu liniju", !/\.shelf-head::after\s*\{[^}]*linear-gradient/.test(cssTekst));
proveri("kategorija u shopu nema ukrasnu liniju", !/\.shop-cat i\s*\{[^}]*linear-gradient/.test(cssTekst));
proveri("nema praznog <i> u naslovu kategorije", !jsTekst.includes("</span><i></i>"));

// ---- strelica kao tacka u spisku ----
proveri("spisak nema strelicu kao tacku", !/\.acc-info li::before[\s\S]{0,160}polygon\(0 0, 100% 50%, 0 100%\)/.test(cssTekst),
  "trougao kao bullet je ukras, ne informacija");

// ---- AI fraze i objasnjavacki tekst ----
// "Kako to radi" spisak na profilu igraca je klasican AI dodatak: proizvod ne
// drzi predavanje korisniku na njegovoj stranici.
proveri("profil nema spisak 'Kako to radi'", !jsTekst.includes("Kako to radi"));
for (const fraza of ["bilo da ", "kada je reč o", "savršen spoj", "u svetu ", "Srećno!"]) {
  proveri(`nema fraze "${fraza.trim()}"`, !jsTekst.includes(fraza) && !htmlTekst.includes(fraza));
}

// ---- promo baner bez engleskog slogana ----
const baner = citajIzvor("server/src/banner.js");
proveri("promo baner nema engleski slogan sa tackicama", !baner.includes("PLAY · WIN · REPEAT"));

// ---- pozadine ekrana postoje (da se ne razvlaci baner) ----
const { pozadinaEkrana, POZADINE_EKRANI } = await import("../server/src/banner.js");
proveri("pozadine postoje za svih pet ekrana",
  POZADINE_EKRANI.length === 5 && POZADINE_EKRANI.every((k) => (pozadinaEkrana(k) || "").startsWith("<svg")),
  JSON.stringify(POZADINE_EKRANI));
proveri("pozadine su u odnosu 16:9 (2560x1440)",
  /width="2560" height="1440"/.test(pozadinaEkrana("prijava") || ""),
  "bez toga se na prijavi razvlacio baner 2800x400 i pozadina je skakala");

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
