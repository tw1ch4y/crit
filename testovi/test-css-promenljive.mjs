import { citajIzvor, brojac } from "./_okruzenje.mjs";
// PROMENLJIVA KOJE NEMA OBARA CELO PRAVILO, I TO BEZ IJEDNE GRESKE
//
// `transition: background var(--t-brzo)` izgleda ispravno. Ako `--t-brzo` nigde
// nije definisano, CSS ne prijavi nista - samo odbaci celo pravilo. Prelaz onda
// ne radi. Ni konzola, ni pregledac, ni test nista ne kazu; covek koji gleda
// ekran vidi da je "nekako suvo" i ne zna zasto.
//
// Tako je u launcheru bilo DESET animacija i PET prelaza koji nisu radili
// (`--ease-out`, `--t-brzo`), naslov nagradnog tocka nije bio u gaming fontu
// (`--font-naslov`), a u panelu izabrana sara nije imala vidljiv okvir jer je
// pisalo `var(--brand)` umesto `var(--accent)`.
//
// Ovde se proverava samo ono sto je STVARNO opasno: upotreba BEZ rezerve.
// `var(--mono, monospace)` je u redu i kad `--mono` ne postoji - rezerva je tu
// bas za to.
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
