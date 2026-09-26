import { citajIzvor, brojac } from "./_okruzenje.mjs";
// CSS promenljiva koja nije definisana obara celo pravilo bez ikakve greske
// (npr. `transition: background var(--t-brzo)`). Proverava se svaka upotreba
// bez rezerve; `var(--mono, monospace)` je u redu i kad `--mono` ne postoji.
const { proveri, kraj } = brojac();

// Komentari objasnjavaju sta je bilo, pa smeju da pominju imena kojih vise nema.
const bezKomentara = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ");

for (const [gde, cssPut, jsPut] of [
  ["launcher", "client/renderer/css/launcher.css", "client/renderer/js/launcher.js"],
  ["panel", "server/public/css/style.css", "server/public/js/app.js"],
]) {
  const css = bezKomentara(citajIzvor(cssPut));
  const js = citajIzvor(jsPut);

  const definisane = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  // Neke se ne pisu u CSS-u nego ih postavlja JS (setProperty ili inline style):
  // boja korica po igri, pomeraj sare za pokretom misa, izabrana boja u panelu.
  const izJs = new Set([...js.matchAll(/--[a-z0-9-]+/gi)].map((m) => m[0]));

  const bezRezerve = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)]
    .filter((m) => !m[2])
    .map((m) => m[1]);

  const nepoznate = [...new Set(bezRezerve)].filter((v) => !definisane.has(v) && !izJs.has(v));
  proveri(`${gde}: nema promenljive koja nigde ne postoji`, nepoznate.length === 0,
    `${nepoznate.join(", ")} - pravilo sa njom se tiho odbacuje, bez ijedne greske`);
}

// Dve stvari koje su BAS zbog ovoga bile mrtve - da se ne vrate tiho.
const css = citajIzvor("client/renderer/css/launcher.css");
proveri("kriva za animacije postoji", /--ease-out:\s*cubic-bezier/.test(css),
  "bez nje ne radi ni ulazna animacija pocetne ni ulaz odeljka na Nalogu");
proveri("kratko trajanje za prelaze postoji", /--t-brzo:\s*[\d.]+m?s/.test(css),
  "bez njega meni na Nalogu menja boju skokom, bez prelaza");
proveri("naslov nagradnog točka ide u gaming fontu",
  !/var\(--font-naslov\)/.test(css) && /--font-display/.test(css));

kraj();
