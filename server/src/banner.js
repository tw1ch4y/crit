// Privremeni baneri dok pravi dizajn ne stigne. Crtaju se kao SVG jer launcher
// banere prikazuje kao background-image, gde SVG ostaje ostar na svakoj
// rezoluciji i tezak je par kilobajta. Nije zamena za dizajnera - samo da vrh
// pocetne i izdvojena igra ne budu prazni.
//
// Font se NE oslanja na Chakra Petch: SVG kao pozadina se crta u zasebnom
// kontekstu koji ne vidi @font-face sa strane. Zato ide sistemski bold, a
// "gaming" osecaj nose velika slova, razmak medju slovima i d20 znak.

const PALETA = {
  bgGore: "#14151c", bgDole: "#08080b",
  crvena: "#ff2b2b", crvenaTamna: "#d81f24",
  zlatna: "#ffb527",
  tekst: "#eef0f6", tiho: "#7f8696", linija: "#242a35",
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
// strane, crvena nit uz donju ivicu.
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

// BANER IZDVOJENE IGRE (2800 x 400)
// NAMERNO bez naziva igre. Launcher preko ovog banera, kad je igra izdvojena na
// vrhu početne, ispisuje ime igre svojim slovima (levo). Kad bi i baner nosio
// ime, dobila bi se ista reč dvaput jedna preko druge. Zato je ovo samo čista
// CRIT atmosfera: preliv, d20 znaci gušće desno (gde natpis launchera ne ide),
// i tanka crvena nit dole. Levo ostaje mirno da natpis bude čitljiv.
export function banerIgre(_naziv) {
  const w = 2800, h = 400;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${podloga(w, h, PALETA.crvena)}
  <ellipse cx="${w - 560}" cy="${h / 2}" rx="900" ry="360" fill="url(#sjaj)" opacity="0.55"/>
  ${d20(w - 900, h * 0.32, 70, PALETA.crvena, 0.12)}
  ${d20(w - 1180, h * 0.7, 46, PALETA.tekst, 0.06)}
  <text x="${w - 150}" y="${h - 54}" fill="${PALETA.tekst}" text-anchor="end" font-family="'Segoe UI', Arial, sans-serif"
    font-size="30" font-weight="800" letter-spacing="8" dominant-baseline="middle" opacity="0.14">CRIT</text>
</svg>`;
}

// POZADINE EKRANA (2560 x 1440)
// Bez ovih slika ekran prijave je uzimao baner izdvojene igre (2800x400) i
// razvlačio ga preko celog ekrana: slika se uvećavala skoro tri puta, mutila, i
// menjala se kad god bi se katalog osvežio - to je ono "skakanje" pozadine.
// Ove su u pravom odnosu 16:9 i namerno MIRNE, jer preko njih ide sav sadržaj.
// Svaki ekran ima svoja svetla, da se ne cine kao ista slika. Zapis jednog
// svetla: [x%, y%, precnik%, boja, jacina].
//
// Ranije su ovde stajale kose hairline linije i tri krupne kockice preko cele
// slike. Linije su se na ekranu videle kao sitne pruge - izgledale su kao
// greska u slici, ne kao dubina. Kockice su se bile sa sarom, koja je i sama
// mreza kockica, pa je isti oblik stajao u dve velicine preko istog ekrana.
// Sada je pozadina samo SVETLO I SENKA: nema nijedne ivice koja se moze
// primetiti, a sara odozgo nosi celu figuru.
const EKRANI = {
  // Prijava i zakljucan ekran su PRAZNI - preko njih ide samo jedna kartica, pa
  // svetlo sme da bude jako i tu se i vidi. Ekrani sa sadrzajem (pocetna, shop,
  // nalog) drze svetlo nisko, da korice i fotografije ostanu glavna stvar.
  prijava:   { svetla: [[30, 58, 66, "#ff2b2b", 0.30], [78, 16, 54, "#2c3a58", 0.17], [56, 96, 46, "#ff8a2b", 0.09]], prelaz: 0.075, vinjeta: 0.60 },
  pocetna:   { svetla: [[20, 16, 56, "#ff2b2b", 0.16], [88, 86, 46, "#26334d", 0.10]], prelaz: 0.045, vinjeta: 0.50 },
  shop:      { svetla: [[80, 20, 52, "#ffb527", 0.13], [15, 80, 48, "#ff2b2b", 0.11]], prelaz: 0.040, vinjeta: 0.50 },
  nalog:     { svetla: [[18, 74, 54, "#ff2b2b", 0.14], [84, 18, 46, "#26334d", 0.10]], prelaz: 0.040, vinjeta: 0.50 },
  // Zakljucan ekran je upozorenje: duboko crveno svetlo i jaka vinjeta.
  zakljucan: { svetla: [[50, 44, 70, "#d81f24", 0.34], [50, 100, 50, "#7a1418", 0.16]], prelaz: 0.030, vinjeta: 0.74 },
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="baza" x1="0" y1="0" x2="0.22" y2="1">
      <stop offset="0" stop-color="#101119"/>
      <stop offset="0.5" stop-color="#0a0a10"/>
      <stop offset="1" stop-color="#06060a"/>
    </linearGradient>
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
  <rect width="${w}" height="${h}" fill="url(#prelaz)"/>
  <rect width="${w}" height="${h}" fill="url(#vinjeta)"/>
</svg>`;
}

export const POZADINE_EKRANI = Object.keys(EKRANI);

// PROMO BANER KUĆE (2800 x 400)
// Veliko CRIT u crvenom sa sjajem, ispod naziv igraonice i kratka parola. Ovo
// stoji na vrhu pocetne dok se ne okaci pravi promo materijal.
export function promoCrit(nazivKuce) {
  // 11:1 je odnos trake u vrhu pocetne (levo od nagradnog tocka), pa baner
  // popuni traku bez tamnih ivica. Ranije je bio 7:1 - to je bio odnos starog
  // vrha, koji je isao preko cele sirine, pre nego sto je tocak dobio svoje
  // mesto sa desne strane.
  const w = 2200, h = 200;
  const kuca = String(nazivKuce || "").trim().toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${podloga(w, h, PALETA.crvena)}
  <ellipse cx="540" cy="${h / 2}" rx="700" ry="170" fill="url(#sjaj)" opacity="0.8"/>
  <rect x="104" y="${h / 2 - 48}" width="8" height="96" rx="4" fill="${PALETA.crvena}"/>
  <text x="150" y="${h / 2 - 8}" fill="${PALETA.crvena}" font-family="'Segoe UI', Arial, sans-serif"
    font-size="104" font-weight="800" letter-spacing="4" dominant-baseline="middle"
    style="paint-order:stroke" stroke="${PALETA.crvenaTamna}" stroke-width="1.5">CRIT</text>
  <text x="156" y="${h / 2 + 56}" fill="${PALETA.tiho}" font-family="'Segoe UI', Arial, sans-serif"
    font-size="21" font-weight="700" letter-spacing="8" dominant-baseline="middle">${esc(kuca && kuca !== "CRIT" ? kuca : "GAMING CENTAR")}</text>
</svg>`;
}
