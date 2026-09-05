// Pravi SVG sablone za dizajn slika u launcheru.
// Zone su izmerene iz stvarnog UI-ja na 1920x1080 i pretvorene u procente,
// pa vaze na svakoj rezoluciji. Pokretanje:  node napravi-sablone.mjs
import fs from "node:fs";
import path from "node:path";

const OVDE = import.meta.dirname;
const IZLAZ = path.join(OVDE, "sabloni");
fs.mkdirSync(IZLAZ, { recursive: true });

// Iste boje koje nosi launcher (client/renderer/css/launcher.css). Dok je ovde
// stajala stara crvena podloga, dizajner je crtao sliku za jedan program a
// ubacivao je u drugi - pa se tek na ekranu videlo da se ne uklapa.
const BOJA = {
  papir: "#070c1c",
  ivica: "#1f2d54",
  zauzeto: "#2f6ae8",   // boja kuce: tu ide sadrzaj, ne slika
  mirno: "#33e284",     // slobodno
  tekst: "#f1f4fb",
  slabo: "#8c96b7",
};

// zona: procenti u odnosu na platno
const z = (x, y, w, h, naziv, tip = "zauzeto") => ({ x, y, w, h, naziv, tip });

const SABLONI = [
  {
    fajl: "1-pozadina-PRIJAVA",
    w: 2560, h: 1440,
    naslov: "POZADINA - EKRAN ZA PRIJAVU",
    podnaslov: "Stoji ceo dan dok je računar slobodan. Ovo gost prvo vidi.",
    savet: "Preko slike ide srednje tamni sloj. Sredina se zatamnjuje jače (tu je forma), ivice ostaju svetlije.",
    zone: [
      z(39.8, 19.0, 20.3, 62.0, "LOGO I FORMA ZA PRIJAVU - drzi mirno"),
      z(0, 0, 22, 6, "oznaka računara", "slabo"),
      z(78, 0, 22, 6, "status veze", "slabo"),
    ],
  },
  {
    fajl: "2-pozadina-POCETNA",
    w: 2560, h: 1440,
    naslov: "POZADINA - POČETNA",
    podnaslov: "Iza promo banera, police igara i reda sa prečicama.",
    savet: "Skoro ceo ekran je pokriven sadržajem. Najbolje rade mirne tamne teksture, ne fotografije sa detaljima.",
    zone: [
      z(0, 0, 100, 7.2, "gornja traka"),
      z(1.6, 9.3, 96.9, 25.0, "PROMO BANER"),
      z(1.6, 35.9, 96.9, 45.4, "POLICA IGARA"),
      z(1.6, 83.0, 96.9, 11.4, "PREČICE"),
      z(0, 96.5, 100, 3.5, "donja traka"),
    ],
  },
  {
    fajl: "3-pozadina-SHOP",
    w: 2560, h: 1440,
    naslov: "POZADINA - SHOP",
    podnaslov: "Iza kartica pića i korpe.",
    savet: "Vidi se samo u razmacima između kartica. Bira se mirna, tamna slika.",
    zone: [
      z(0, 0, 100, 7.2, "gornja traka"),
      z(1.5, 9.1, 77.2, 85.5, "KARTICE PIĆA"),
      z(79.8, 9.1, 18.8, 85.5, "KORPA"),
      z(0, 96.5, 100, 3.5, "donja traka"),
    ],
  },
  {
    fajl: "4-pozadina-NALOG",
    w: 2560, h: 1440,
    naslov: "POZADINA - NALOG",
    podnaslov: "Podaci igrača, porudžbine, promena lozinke.",
    savet: "Sadržaj je u sredini ekrana. Levo i desno od njega slika se lepo vidi.",
    zone: [
      z(0, 0, 100, 7.2, "gornja traka"),
      z(21.9, 28.5, 56.3, 47.0, "PODACI I PORUDŽBINE"),
      z(0, 96.5, 100, 3.5, "donja traka"),
    ],
  },
  {
    fajl: "5-pozadina-ZAKLJUCAN",
    w: 2560, h: 1440,
    naslov: "POZADINA - ZAKLJUČAN EKRAN",
    podnaslov: "Kad igraču istekne vreme ili osoblje zaključa računar.",
    savet: "Ovde igrač čita poruku. Najmirnija i najtamnija od svih pozadina.",
    zone: [
      z(38.8, 40.2, 22.5, 20.0, "KATANAC I PORUKA - drzi mirno"),
      z(44.7, 94.6, 10.7, 3.0, "napomena za osoblje", "slabo"),
    ],
  },
  {
    fajl: "6-PROMO-BANER",
    w: 2200, h: 200,
    naslov: "PROMO BANER - traka na vrhu početne",
    podnaslov: "Odnos 11:1. Stoji levo od nagradnog točka; više banera se smenjuje samo.",
    savet: "Preko banera NE ide tekst iz launchera, sve piše na samoj slici. Baner se uklapa u traku i nikad se ne seče - drugi odnos radi, samo ostanu tamne ivice.",
    zone: [
      z(84, 62, 16, 38, "tačkice za smenu banera", "slabo"),
    ],
    vodilje: [
      { x: 3, y: 8, w: 94, h: 84, naziv: "SIGURNA ZONA - ovde stavi logo i tekst" },
    ],
  },
  {
    fajl: "7-OMOT-IGRE",
    w: 600, h: 800,
    naslov: "OMOT IGRE - kartica u polici",
    podnaslov: "Uspravan poster, odnos 3:4.",
    savet: "Dno kartice prekriva tamna traka sa imenom igre. Lice igre drži u gornje dve trećine.",
    zone: [
      z(0, 76, 100, 24, "IME IGRE preko slike"),
      z(3, 2, 34, 7, "oznaka kategorije", "slabo"),
    ],
  },
  {
    fajl: "8-BANER-IGRE",
    w: 2800, h: 400,
    naslov: "BANER IGRE - pozadina ekrana prijave",
    podnaslov: "Široka slika koja stoji iza forme za prijavu, ako nije okačena posebna pozadina prijave.",
    savet: "Slika je zamućena i utišana ispod forme, pa sitni detalji ne igraju - važi opšti utisak i boja.",
    zone: [
      z(34, 30, 32, 55, "forma za prijavu preko slike", "slabo"),
    ],
    vodilje: [
      { x: 48, y: 10, w: 48, h: 80, naziv: "SLOBODNO ZA UMETNOST" },
    ],
  },
  {
    fajl: "9-SLIKA-PRECICE",
    w: 256, h: 256,
    naslov: "SLIKA PREČICE - internet alati",
    podnaslov: "Logo aplikacije, odnos 1:1.",
    savet: "U launcheru se crta na 34 px. Samo logo, bez sitnog teksta. Providna pozadina (PNG) izgleda najbolje.",
    zone: [],
    vodilje: [{ x: 15, y: 15, w: 70, h: 70, naziv: "LOGO U OVOM KRUGU" }],
  },
];

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function napravi(s) {
  const { w, h } = s;
  const skala = Math.min(w, h) / 500;
  const f = (n) => +(n * skala).toFixed(1);
  const px = (p) => +(p / 100 * w).toFixed(1);
  const py = (p) => +(p / 100 * h).toFixed(1);

  let telo = "";
  for (const zn of s.zone || []) {
    const boja = zn.tip === "slabo" ? BOJA.slabo : BOJA.zauzeto;
    const prov = zn.tip === "slabo" ? 0.07 : 0.14;
    telo += `
  <g>
    <rect x="${px(zn.x)}" y="${py(zn.y)}" width="${px(zn.w)}" height="${py(zn.h)}"
      fill="${boja}" fill-opacity="${prov}" stroke="${boja}" stroke-opacity="0.55"
      stroke-width="${f(2)}" stroke-dasharray="${f(10)} ${f(7)}"/>
    <text x="${px(zn.x) + f(14)}" y="${py(zn.y) + f(26)}" fill="${boja}" font-family="Segoe UI, sans-serif"
      font-size="${f(17)}" font-weight="700" letter-spacing="${f(1)}">${esc(zn.naziv.toUpperCase())}</text>
  </g>`;
  }
  for (const v of s.vodilje || []) {
    telo += `
  <g>
    <rect x="${px(v.x)}" y="${py(v.y)}" width="${px(v.w)}" height="${py(v.h)}"
      fill="${BOJA.mirno}" fill-opacity="0.06" stroke="${BOJA.mirno}" stroke-opacity="0.6"
      stroke-width="${f(2)}" stroke-dasharray="${f(10)} ${f(7)}"/>
    <text x="${px(v.x) + f(14)}" y="${py(v.y) + f(26)}" fill="${BOJA.mirno}" font-family="Segoe UI, sans-serif"
      font-size="${f(17)}" font-weight="700" letter-spacing="${f(1)}">${esc(v.naziv.toUpperCase())}</text>
  </g>`;
  }

  // mreza trecina, da se lakse komponuje
  let mreza = "";
  for (const p of [33.33, 66.66]) {
    mreza += `<line x1="${px(p)}" y1="0" x2="${px(p)}" y2="${h}" stroke="${BOJA.ivica}" stroke-width="${f(1)}" stroke-opacity="0.7"/>`;
    mreza += `<line x1="0" y1="${py(p)}" x2="${w}" y2="${py(p)}" stroke="${BOJA.ivica}" stroke-width="${f(1)}" stroke-opacity="0.7"/>`;
  }

  // Natpisi idu na svoje neprozirne trake, gore i dole - inace bi se sudarali
  // sa oznakama zona i sablon bi bio necitljiv.
  const trakaG = f(96), trakaD = f(62);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BOJA.papir}"/>
  ${mreza}
  <rect x="${f(1)}" y="${f(1)}" width="${w - f(2)}" height="${h - f(2)}" fill="none" stroke="${BOJA.ivica}" stroke-width="${f(2)}"/>
${telo}
  <g>
    <rect x="0" y="0" width="${w}" height="${trakaG}" fill="#05060a" fill-opacity="0.93"/>
    <text x="${f(28)}" y="${f(40)}" fill="${BOJA.tekst}" font-family="Segoe UI, sans-serif" font-size="${f(25)}" font-weight="800" letter-spacing="${f(1)}">${esc(s.naslov)}</text>
    <text x="${f(28)}" y="${f(72)}" fill="${BOJA.slabo}" font-family="Segoe UI, sans-serif" font-size="${f(17)}">${esc(s.podnaslov)}</text>
    <text x="${w - f(28)}" y="${f(46)}" fill="${BOJA.tekst}" text-anchor="end" font-family="Segoe UI, sans-serif" font-size="${f(28)}" font-weight="800">${w} x ${h} px</text>

    <rect x="0" y="${h - trakaD}" width="${w}" height="${trakaD}" fill="#05060a" fill-opacity="0.93"/>
    <text x="${f(28)}" y="${h - trakaD + f(26)}" fill="${BOJA.slabo}" font-family="Segoe UI, sans-serif" font-size="${f(16)}">${esc(s.savet)}</text>
    <text x="${f(28)}" y="${h - trakaD + f(50)}" fill="${BOJA.slabo}" font-family="Segoe UI, sans-serif" font-size="${f(15)}">crvena zona = sadrzaj launchera stoji preko slike   ·   zelena zona = tu stavi ono sto mora da se vidi</text>
  </g>
</svg>
`;
}

// Ime fajla nosi dimenziju, pa se pri promeni mere pravi NOVI fajl a stari
// ostaje. Tako su u folderu jednom stajala dva promo sablona sa razlicitim
// odnosom i nije se znalo koji vazi. Zato se stari brisu pre pisanja.
for (const f of fs.readdirSync(IZLAZ)) {
  if (f.endsWith(".svg")) fs.rmSync(path.join(IZLAZ, f), { force: true });
}
for (const s of SABLONI) {
  const p = path.join(IZLAZ, `${s.fajl}-${s.w}x${s.h}.svg`);
  fs.writeFileSync(p, napravi(s), "utf8");
  console.log(`${s.w}x${s.h}`.padEnd(11) + path.basename(p));
}
console.log(`\nGotovo: ${SABLONI.length} sablona u assets/sabloni/`);
