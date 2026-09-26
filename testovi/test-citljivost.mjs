import { citajIzvor, brojac } from "./_okruzenje.mjs";
// Čitljivost teksta u launcheru i panelu:
//
//   kontrast prema podlozi  najmanje 4.5:1 za sitan tekst
//   velicina                najmanje 11px
//
// Racun je iz WCAG-a (relativna svetlina, pa odnos), isti kao u zamerkeNaBoju
// u service.js.
const { proveri, kraj } = brojac();

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const svetlina = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const odnos = (a, b) => {
  const [x, y] = [svetlina(a), svetlina(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// Vrednost tokena se cita IZ FAJLA, ne prepisuje ovde. Prepisana bi znacila da
// test i dalje prolazi posto neko promeni boju.
const token = (css, ime) => {
  const m = new RegExp(`--${ime}:\\s*(#[0-9a-f]{3,8})\\s*;`, "i").exec(css);
  return m ? m[1] : null;
};

for (const [gde, putanja, podloge] of [
  ["launcher", "client/renderer/css/launcher.css", ["bg", "bg-2", "panel", "panel-2", "panel-3"]],
  ["panel", "server/public/css/style.css", ["bg", "surface", "surface-2", "surface-3", "input"]],
]) {
  const css = citajIzvor(putanja);

  // ---- 1) SVAKI STEPEN TEKSTA NA SVAKOJ PODLOZI ----
  for (const ime of ["text", "text-2", "text-3"]) {
    const boja = token(css, ime);
    proveri(`${gde}: --${ime} postoji`, !!boja, String(boja));
    if (!boja) continue;
    for (const p of podloge) {
      const pod = token(css, p);
      if (!pod) continue;
      const k = odnos(boja, pod);
      proveri(`${gde}: --${ime} na --${p} (${k.toFixed(2)}:1)`, k >= 4.5,
        `${boja} na ${pod} daje ${k.toFixed(2)}:1, a sitan tekst trazi bar 4.5:1`);
    }
  }

  // ---- 2) DONJA GRANICA VELICINE ----
  //
  // Jedini izuzetak je donja navigacija panela na telefonu: petnaest stavki mora
  // da stane u sirinu ekrana, a telefon se gleda iz ruke. Izuzetak je zapisan
  // uz samo pravilo, pa se vidi da je odluka a ne previd.
  const sitno = css.split("\n")
    .map((r, i) => [i + 1, r])
    .filter(([, r]) => /font-size:\s*(\d+(\.\d+)?)px/.test(r))
    .filter(([, r]) => parseFloat(/font-size:\s*(\d+(\.\d+)?)px/.exec(r)[1]) < 11)
    .filter(([, r]) => !/\.nav-item/.test(r));
  proveri(`${gde}: nema teksta ispod 11px`, sitno.length === 0,
    sitno.map(([br, r]) => `linija ${br}: ${r.trim().slice(0, 60)}`).join(" | "));

  // I u clamp() se gleda DONJA granica - ona vazi na uzem ekranu, tamo gde je
  // tekst ionako najsitniji.
  const klampe = [...css.matchAll(/font-size:\s*clamp\(\s*(\d+(?:\.\d+)?)px/g)].map((m) => parseFloat(m[1]));
  proveri(`${gde}: ni clamp ne pada ispod 11px`, klampe.every((v) => v >= 11),
    klampe.filter((v) => v < 11).join(", "));
}

// ---- 3) LESTVICA VELIČINA ----
//
// Lestvica: 11 12 13 14 15 17 19 24 30 36 44 64. Nova vrednost van lestvice se
// dodaje ovde i u komentar u CSS-u, ili se zaokruzi na najblizi korak.
const LESTVICA = [11, 12, 13, 14, 15, 17, 19, 24, 30, 36, 44, 64];
const IZUZECI = [
  // Donja navigacija panela na telefonu: petnaest stavki u sirinu ekrana.
  // Objasnjeno uz samo pravilo u style.css.
  { velicina: 10, gde: /\.nav-item/ },
];
for (const [gde, ...putanje] of [
  ["launcher", "client/renderer/css/launcher.css"],
  ["panel", "server/public/css/style.css", "server/public/js/app.js"],
]) {
  const van = [];
  for (const putanja of putanje) {
    citajIzvor(putanja).split("\n").forEach((r, i) => {
      for (const m of r.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
        const v = parseFloat(m[1]);
        if (LESTVICA.includes(v)) continue;
        if (IZUZECI.some((x) => x.velicina === v && x.gde.test(r))) continue;
        van.push(`${putanja}:${i + 1} ${v}px`);
      }
      // I granice u clamp() moraju da budu sa lestvice - clamp je ista velicina
      // slova, samo zavisi od sirine ekrana.
      for (const m of r.matchAll(/clamp\(\s*(\d+(?:\.\d+)?)px[^)]*?(\d+(?:\.\d+)?)px\s*\)/g)) {
        if (!/font-size/.test(r)) continue;
        for (const v of [parseFloat(m[1]), parseFloat(m[2])]) {
          if (!LESTVICA.includes(v)) van.push(`${putanja}:${i + 1} clamp ${v}px`);
        }
      }
    });
  }
  proveri(`${gde}: sve veličine su sa lestvice`, van.length === 0, van.slice(0, 6).join(" | "));
}

// ---- 4) PANEL I LAUNCHER GOVORE ISTIM JEZIKOM ----
//
// Vlasnik ih gleda jedan pored drugog - panel na telefonu, launcher na masini.
// Dva razlicita siva na istom mestu izgledaju kao greska u stampi.
proveri("treći stepen teksta je isti u panelu i launcheru",
  token(citajIzvor("client/renderer/css/launcher.css"), "text-3") ===
  token(citajIzvor("server/public/css/style.css"), "text-3"));

kraj();
