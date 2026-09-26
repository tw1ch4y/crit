// Privremeni baneri i pozadine, kao SVG (oštri na svakoj rezoluciji, par KB).
// SVG kao pozadina ne vidi @font-face stranice, pa se koristi sistemski bold.

// Paleta iz znaka kuće: plava podloga, zlatna za nagradu, a crvena samo tamo
// gde nosi značenje (zaključan ekran, vreme ističe).
const PALETA = {
  bgGore: "#131c3c", bgDole: "#070b1a",
  brend: "#2f6ae8", brendTamna: "#2454c4",
  ljubicasta: "#7a45c8",
  zlatna: "#ffb527",
  tekst: "#eef1f8", tiho: "#7d87a6", linija: "#20294a",
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// d20 (ikosaedar) - znak kritičnog pogotka, odatle i ime kuće. Isti oblik kao
// tekstura "kockice", uvelican. Crta se kao ukras u pozadini.
function d20(cx, cy, r, boja, prozirnost, sirinaLinije = 2.4) {
  // jedinicni oblik u koordinatama 0..32, pa se skalira i pomera
  const s = r / 16;
  return `<g transform="translate(${cx} ${cy}) scale(${s})" fill="none" stroke="${boja}" stroke-opacity="${prozirnost}" stroke-width="${sirinaLinije / s}" stroke-linejoin="round">
    <path d="M0 -13L11.3 -6.5L11.3 6.5L0 13L-11.3 6.5L-11.3 -6.5Z"/>
    <path d="M0 -6.5L5.6 3.3L-5.6 3.3Z"/>
    <path d="M0 -13L0 -6.5M11.3 6.5L5.6 3.3M-11.3 6.5L-5.6 3.3"/>
  </g>`;
}

// Zajednicka podloga: tamni preliv, tanka mreza, d20 znaci koji vire sa desne
// strane, nit u boji kuce uz donju ivicu.
function podloga(w, h, akcenat) {
  return `<defs>
    <linearGradient id="poz" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${PALETA.bgGore}"/>
      <stop offset="1" stop-color="${PALETA.bgDole}"/>
    </linearGradient>
    <radialGradient id="sjaj" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${akcenat}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${akcenat}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#poz)"/>
  <g stroke="${PALETA.linija}" stroke-width="1" stroke-opacity="0.5">
    <line x1="0" y1="${h / 3}" x2="${w}" y2="${h / 3}"/>
    <line x1="0" y1="${(h / 3) * 2}" x2="${w}" y2="${(h / 3) * 2}"/>
  </g>
  <g>
    ${d20(w - 240, h * 0.42, 220, akcenat, 0.14)}
    ${d20(w - 620, h * 0.78, 120, akcenat, 0.09)}
    ${d20(w - 70, h * 0.9, 90, PALETA.tekst, 0.05)}
  </g>
  <rect x="0" y="${h - 5}" width="${w}" height="5" fill="${akcenat}" opacity="0.85"/>`;
}

// Baner izdvojene igre (2800 x 400), bez naziva: launcher ime ispisuje sam,
// levo. Znaci su gušći desno, gde nema teksta.
export function banerIgre(_naziv) {
  const w = 2800, h = 400;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${podloga(w, h, PALETA.brend)}
  <ellipse cx="${w - 560}" cy="${h / 2}" rx="900" ry="360" fill="url(#sjaj)" opacity="0.55"/>
  ${d20(w - 900, h * 0.32, 70, PALETA.brend, 0.12)}
  ${d20(w - 1180, h * 0.7, 46, PALETA.tekst, 0.06)}
  <text x="${w - 150}" y="${h - 54}" fill="${PALETA.tekst}" text-anchor="end" font-family="'Segoe UI', Arial, sans-serif"
    font-size="30" font-weight="800" letter-spacing="8" dominant-baseline="middle" opacity="0.14">CRIT</text>
</svg>`;
}

// Pozadine ekrana (2560 x 1440), 16:9 i mirne, jer preko njih ide sadržaj.
// Svaki ekran ima svoja svetla: [x%, y%, prečnik%, boja, jačina]. Pozadina je
// samo svetlo i senka; šara odozgo nosi oblike.
const EKRANI = {
  // Prijava i zaključan ekran imaju jedno polje preko sebe, pa svetlo sme da
  // bude jače; ekrani sa sadržajem ga drže nisko. Dve suprotne boje svetla daju
  // dubinu; zlatna samo u shopu. `trake` su kose pruge svetla.
  prijava:   { svetla: [[28, 56, 64, "#3d7cf0", 0.38], [80, 14, 52, "#a63fd6", 0.24], [58, 98, 44, "#2fd4e8", 0.13]], trake: 0.055, prelaz: 0.075, vinjeta: 0.62 },
  pocetna:   { svetla: [[18, 14, 54, "#2f6ae8", 0.22], [90, 88, 48, "#8b3fd6", 0.15], [62, 6, 34, "#2fd4e8", 0.07]], trake: 0.030, prelaz: 0.045, vinjeta: 0.52 },
  shop:      { svetla: [[80, 18, 50, "#ffb527", 0.17], [14, 82, 50, "#2f6ae8", 0.17], [46, 8, 34, "#a63fd6", 0.09]], trake: 0.032, prelaz: 0.040, vinjeta: 0.52 },
  nalog:     { svetla: [[16, 72, 52, "#8b3fd6", 0.21], [86, 16, 48, "#2f6ae8", 0.16], [52, 100, 36, "#2fd4e8", 0.08]], trake: 0.030, prelaz: 0.040, vinjeta: 0.52 },
  // Zakljucan ekran je upozorenje: duboko crveno svetlo i jaka vinjeta. Bez
  // traka - upozorenje ne treba da izgleda zivo.
  zakljucan: { svetla: [[50, 44, 70, "#d81f24", 0.34], [50, 100, 50, "#7a1418", 0.16]], trake: 0, prelaz: 0.030, vinjeta: 0.74 },
};

export function pozadinaEkrana(kljuc) {
  const o = EKRANI[kljuc];
  if (!o) return null;
  const w = 2560, h = 1440;
  const defs = o.svetla.map(([x, y, r, boja, jacina], i) => `
    <radialGradient id="sv${i}" cx="${x}%" cy="${y}%" r="${r}%">
      <stop offset="0" stop-color="${boja}" stop-opacity="${jacina}"/>
      <stop offset="0.42" stop-color="${boja}" stop-opacity="${(jacina * 0.36).toFixed(3)}"/>
      <stop offset="1" stop-color="${boja}" stop-opacity="0"/>
    </radialGradient>`).join("");
  const slojevi = o.svetla.map((_, i) => `<rect width="${w}" height="${h}" fill="url(#sv${i})"/>`).join("\n  ");
  // Kose pruge svetla: krajevi se gase, a širine su različite.
  const trake = !o.trake ? "" : `<g transform="rotate(-19 ${w / 2} ${h / 2})" opacity="${o.trake}" mask="url(#maskaTrake)">
    ${[[-0.06, 190], [0.20, 64], [0.34, 260], [0.61, 40], [0.78, 150]]
      .map(([y, d]) => `<rect x="${-w * 0.3}" y="${h * y}" width="${w * 1.6}" height="${d}" fill="url(#trakaY)"/>`).join("")}
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${/* SVETLA SU SE RAČUNALA, PA SE BACALA.
    `defs` je bio izračunat i nigde ubačen, pa su `url(#sv0)` i ostali pokazivali
    na gradijente kojih nema - a takva referenca u SVG-u ne puca nego se tiho
    crta kao ništa. Rezultat: svaki ekran u launcheru je bio ravna skoro crna
    ploča sa vinjetom, bez ijedne boje, iako je ovde pisalo drugačije.
    To je i bio glavni razlog što je ceo program delovao sumorno. */""}
    ${defs}
    <linearGradient id="baza" x1="0" y1="0" x2="0.22" y2="1">
      <stop offset="0" stop-color="${PALETA.bgGore}"/>
      <stop offset="0.5" stop-color="#0c1329"/>
      <stop offset="1" stop-color="${PALETA.bgDole}"/>
    </linearGradient>
    ${/* Pruge se gase na SVE cetiri strane. Prvo su imale mek pocetak i kraj,
        ali ostre gornje i donje ivice - i onda su izgledale kao dijagonalne
        sipke nalepljene na ekran, kao greska u slici. Sada `trakaX` gasi
        krajeve, a `trakaY` debljinu, pa od pruge ostane samo trag svetla. */""}
    <linearGradient id="trakaX" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.35" stop-color="#fff" stop-opacity="1"/>
      <stop offset="0.65" stop-color="#fff" stop-opacity="1"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="trakaY" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <mask id="maskaTrake">
      <rect x="${-w}" y="${-h}" width="${w * 3}" height="${h * 3}" fill="url(#trakaX)"/>
    </mask>
    <linearGradient id="prelaz" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="${o.prelaz}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vinjeta" cx="50%" cy="50%" r="76%">
      <stop offset="0.42" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="${o.vinjeta}"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#baza)"/>
  ${slojevi}
  ${trake}
  <rect width="${w}" height="${h}" fill="url(#prelaz)"/>
  <rect width="${w}" height="${h}" fill="url(#vinjeta)"/>
</svg>`;
}

export const POZADINE_EKRANI = Object.keys(EKRANI);

// Promo baner kuće (2200 x 200): naziv igraonice iz Podešavanja i kratka
// poruka, dok se ne okači pravi promo materijal.
export function promoCrit(nazivKuce) {
  // 11:1 je odnos trake na vrhu početne (levo od nagradnog točka).
  const w = 2200, h = 200;
  const kuca = String(nazivKuce || "").trim().toUpperCase().slice(0, 18);
  // Dugo ime dobija manja slova, da stane u traku.
  const veliko = kuca.length <= 6 ? 104 : Math.max(52, Math.round(104 * 6 / kuca.length));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${podloga(w, h, PALETA.brend)}
  <ellipse cx="540" cy="${h / 2}" rx="700" ry="170" fill="url(#sjaj)" opacity="0.8"/>
  <rect x="104" y="${h / 2 - 48}" width="8" height="96" rx="4" fill="${PALETA.brend}"/>
  <text x="150" y="${h / 2 - 8}" fill="${PALETA.brend}" font-family="'Segoe UI', Arial, sans-serif"
    font-size="${veliko}" font-weight="800" letter-spacing="4" dominant-baseline="middle"
    style="paint-order:stroke" stroke="${PALETA.brendTamna}" stroke-width="1.5">${esc(kuca || "IGRAONICA")}</text>
  <text x="156" y="${h / 2 + 56}" fill="${PALETA.tiho}" font-family="'Segoe UI', Arial, sans-serif"
    font-size="21" font-weight="700" letter-spacing="8" dominant-baseline="middle">GAMING CENTAR</text>
</svg>`;
}
