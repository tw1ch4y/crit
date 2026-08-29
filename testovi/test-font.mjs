import fs from "node:fs";
import path from "node:path";
import { KOREN, citajIzvor } from "./_okruzenje.mjs";
// Font launchera. Chakra Petch je UGRADJEN u paket - ne skida se sa interneta i
// ne zavisi od toga sta je instalirano na racunaru igraca.
//
// Najveca opasnost ovde nije da nesto pukne, nego da se tiho pokvari: ako font
// nema nasa slova ili ako fajlovi ne udju u instaler, pregledac bez ijedne
// greske uzme sistemski font. Onda u istoj reci stoje dva pisma i sve izgleda
// jeftino - a primeti se tek na ekranu u igraonici.
// Da li font STVARNO ima slova proverava:  node proba-fonta.mjs

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const FONTOVI = path.join(KOREN, "client", "renderer", "fonts");
const css = citajIzvor("client/renderer/css/launcher.css");
const jedanRed = css.replace(/\s+/g, " ");

// ---- fajlovi ----
proveri("folder sa fontovima postoji", fs.existsSync(FONTOVI));
const fajlovi = fs.existsSync(FONTOVI) ? fs.readdirSync(FONTOVI) : [];
const woff = fajlovi.filter((f) => f.endsWith(".woff2"));
proveri("ima osam fajlova fonta (4 debljine x latin i latin-ext)", woff.length === 8, JSON.stringify(woff));

for (const t of [400, 500, 600, 700]) {
  proveri(`debljina ${t} ima oba podskupa`,
    woff.includes(`chakra-petch-${t}-latin.woff2`) && woff.includes(`chakra-petch-${t}-latin-ext.woff2`));
}
// Prazan ili odsecen fajl bi se ucitao bez greske a slova se ne bi pojavila.
for (const f of woff) {
  const vel = fs.statSync(path.join(FONTOVI, f)).size;
  proveri(`${f} nije prazan`, vel > 4000, `${vel} bajtova`);
}
proveri("licenca fonta ide uz paket", fs.existsSync(path.join(FONTOVI, "OFL.txt")),
  "font se distribuira klijentu, licenca mora sa njim");

// ---- deklaracije ----
// Stoje u css/font.css, ne u launcher.css: isti font nose i prozori koji
// iskacu preko igre, pa deklaracije moraju da budu na deljenom mestu.
const deklaracije = citajIzvor("client/renderer/css/font.css");
proveri("ima osam @font-face deklaracija", (deklaracije.match(/@font-face/g) || []).length === 8,
  String((deklaracije.match(/@font-face/g) || []).length));
proveri("font se ucitava iz paketa, ne sa interneta",
  !/url\(["']?https?:/i.test(deklaracije),
  "racunari u igraonici ne smeju da zavise od interneta za font");
// latin-ext je podskup koji nosi c c s z dj. Bez njega bi srpska slova pala na
// sistemski font i mesala bi se dva pisma u istoj reci.
const latinExt = (deklaracije.match(/U\+0100-02BA/g) || []).length;
proveri("sve cetiri debljine imaju latin-ext (nasa slova)", latinExt === 4, `nadjeno ${latinExt}`);
proveri("opseg latin-ext pokriva Đ (U+0110)", /U\+0100-02BA/.test(deklaracije));

// ---- gde se koristi ----
proveri("naslovi koriste gaming font", /--font-display:\s*"Chakra Petch"/.test(css));
proveri("okvir launchera koristi gaming font", /--font-ui:\s*"Chakra Petch"/.test(css));
proveri("duzi tekst ostaje u sistemskom fontu", /--font:\s*"Segoe UI/.test(css),
  "uputstva i opisi se citaju lakse u sistemskom fontu");

// Trazi se blok koji STVARNO oblikuje element. "input {" se u fajlu pojavljuje
// dvaput - prvi put kao "input { user-select: text; }", sto nije taj blok.
// Ispred selektora cesto stoji komentar, a on ulazi u isti odsecak - zato se
// komentari prvo skinu, pa se onda poredi ime selektora.
const bezKomentara = css.replace(/\/\*[\s\S]*?\*\//g, "");
const blokSa = (sel, mora) => {
  for (const [, s, telo] of bezKomentara.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (s.trim().replace(/\s+/g, " ") !== sel) continue;
    if (telo.includes(mora)) return telo;
  }
  return "";
};
for (const [sta, sel] of [["polja za unos", "input"], ["dugmad", ".btn"], ["tabovi", ".tab"], ["donja traka", ".statusbar"]]) {
  proveri(`${sta} koriste gaming font`, !!blokSa(sel, "var(--font-ui)"), `nijedan blok "${sel}" nema var(--font-ui)`);
}
proveri("tacke u polju za lozinku imaju vazduha", /input\[type="password"\] \{[^}]*letter-spacing/.test(jedanRed),
  "u gaming fontu se stapaju jedna u drugu");

// Nijedna verzalna oznaka ne sme da ostane bez fonta - inace bi na jednom
// ekranu pisalo gaming fontom a na drugom sistemskim, i to bez ijedne greske.
const bezFonta = [];
for (const [, sel, telo] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (!/text-transform:\s*uppercase/.test(telo)) continue;
  if (/font-family/.test(telo)) continue;
  bezFonta.push(sel.trim().replace(/\s+/g, " ").slice(-40));
}
proveri("svaka verzalna oznaka ima svoj font", bezFonta.length === 0, bezFonta.join(" | "));

// Chakra Petch ima najvise debljinu 700. Kad se trazi 800 ili 900, pregledac
// sam "zadebljava" vec masna slova i ona izgledaju razlivena.
const preteske = [];
for (const [, sel, telo] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (!/var\(--font-display\)|var\(--font-ui\)/.test(telo)) continue;
  if (/font-weight:\s*(800|900)/.test(telo)) preteske.push(sel.trim().replace(/\s+/g, " ").slice(-40));
}
proveri("nigde se ne trazi debljina koju font nema", preteske.length === 0, preteske.join(" | "));

// ---- sva tri dokumenta koje igrac vidi ----
// Launcher nije jedini prozor: obavestenje iskace PREKO IGRE (overlay.html), a
// dok se igra pokrece stoji crna podloga (backdrop.html). Oba su svoji
// dokumenti sa svojim CSS-om - najlakse je bas njih zaboraviti pri izmeni
// fonta, a bas ih igrac vidi najvise dok igra.
const fontCss = citajIzvor("client/renderer/css/font.css");
proveri("font je izdvojen u svoj fajl", fontCss.includes("@font-face"),
  "da ga mogu deliti launcher i prozori koji iskacu preko igre");
proveri("launcher.css vise ne nosi deklaracije", !css.includes("@font-face"));

for (const [sta, fajl] of [
  ["launcher", "client/renderer/index.html"],
  ["obavestenje preko igre", "client/renderer/overlay.html"],
  ["podloga dok se igra pokrece", "client/renderer/backdrop.html"],
]) {
  const html = citajIzvor(fajl);
  proveri(`${sta} ucitava font`, html.includes("css/font.css"), fajl);
  if (fajl !== "client/renderer/index.html") {
    proveri(`${sta} koristi gaming font`, /font-family:\s*"Chakra Petch"/.test(html), fajl);
  }
}

// ---- pakovanje ----
const paket = JSON.parse(fs.readFileSync(path.join(KOREN, "client", "package.json"), "utf8"));
proveri("fontovi ulaze u instaler", (paket.build.files || []).some((f) => f.startsWith("renderer/")),
  "bez toga bi launcher u igraonici ostao bez fonta");

// ---- alat za proveru slova ----
const proba = citajIzvor("testovi/proba-fonta.mjs");
proveri("postoji provera da font stvarno ima nasa slova", proba.includes("Nepostojeci Font XYZ"),
  "poredi se sirina slova sa i bez fonta - ako je ista, font je pao na sistemski");
proveri("provera prvo ucitava fontove", proba.includes("f.load()"),
  "bez toga bi ispalo da font nema ni slovo A");

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
