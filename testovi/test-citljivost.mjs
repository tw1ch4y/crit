import { citajIzvor, brojac } from "./_okruzenje.mjs";
// TEKST MORA DA SE ČITA
//
// Ovo nije stvar ukusa. Launcher se gleda sa metar udaljenosti, iz stolice, na
// ekranu koji je cele smene upaljen - a panel se gleda i sa telefona, u mraku,
// dok neko drugi ceka za kasom. Dva broja odlucuju da li se sitno slovo cita:
//
//   ODNOS PREMA PODLOZI - koliko je slovo svetlije od onoga na cemu stoji.
//     Ispod 4.5:1 sitan tekst pocinje da se gubi. Trece stepen teksta je bio
//     3.75:1 u launcheru i 4.08:1 u panelu, a na svetlijim plocama 2.6:1 - i
//     bas su njime pisane oznake koje kazu STA je broj pored njih.
//
//   VELICINA - 9px sa razmaknutim velikim slovima izgleda uredno na slici, a
//     iz stolice se ne procita. Donja granica je 11px.
//
// Racun je iz WCAG-a (relativna svetlina, pa odnos), isti onaj po kom se meri
// da li boja kuce upada u tudje znacenje (vidi zamerkeNaBoju u service.js).
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

// ---- 3) PANEL I LAUNCHER GOVORE ISTIM JEZIKOM ----
//
// Vlasnik ih gleda jedan pored drugog - panel na telefonu, launcher na masini.
// Dva razlicita siva na istom mestu izgledaju kao greska u stampi.
proveri("treći stepen teksta je isti u panelu i launcheru",
  token(citajIzvor("client/renderer/css/launcher.css"), "text-3") ===
  token(citajIzvor("server/public/css/style.css"), "text-3"));

kraj();
