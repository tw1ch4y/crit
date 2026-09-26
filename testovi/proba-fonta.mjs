// Provera da ugradjeni font ima nasa slova (č ć š ž đ) i da se ucitava. Bez
// njih pregledac za ta slova tiho uzme sistemski font.
//
// Ista slova se mere u ugradjenom fontu i u nepostojecem fontu (koji uvek pada
// na sistemski). Iste sirine znace da slova nema.
//
//   node proba-fonta.mjs
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { putanjaElektrona } from "./_okruzenje.mjs";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const RADNO = path.join(OVDE, ".radno", "proba-fonta");
fs.rmSync(RADNO, { recursive: true, force: true });
fs.mkdirSync(RADNO, { recursive: true });

const MAIN = `
const { app, BrowserWindow } = require("electron");
const path = require("path");
const RENDERER = ${JSON.stringify(path.join(KOREN, "client", "renderer"))};
process.on("uncaughtException", (e) => { console.log("PUKLO: " + (e && e.stack || e)); app.exit(1); });
app.on("window-all-closed", () => {});
app.disableHardwareAcceleration();

const PROVERA = \`(async () => {
  // Fontovi se ucitavaju tek kad zatrebaju, a merenje na canvasu ih ne pokrece.
  // Zato se prvo izricito ucitaju, pa se onda meri - inace bi ispalo da font
  // nema ni slovo "A".
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
  await document.fonts.ready;
  const c = document.createElement("canvas").getContext("2d");
  const meri = (tekst, font) => { c.font = font; return c.measureText(tekst).width; };

  // Slova koja moraju da postoje, i po jedno obicno za kontrolu.
  const slova = ["č", "ć", "š", "ž", "đ", "Č", "Ć", "Š", "Ž", "Đ", "A", "8"];
  const nalazi = slova.map((z) => {
    const sa = meri(z, '700 40px "Chakra Petch", "Nepostojeci Font XYZ"');
    const bez = meri(z, '700 40px "Nepostojeci Font XYZ"');
    return { znak: z, sa: +sa.toFixed(2), bez: +bez.toFixed(2), ima: Math.abs(sa - bez) > 0.05 };
  });

  // Da li je font uopste ucitan, po debljinama.
  const debljine = [400, 500, 600, 700].map((w) => ({
    tezina: w, ucitan: document.fonts.check(\\\`\\\${w} 16px "Chakra Petch"\\\`),
  }));

  // Koliko je fajlova fonta stvarno povuceno.
  const ucitani = [...document.fonts].filter((f) => f.family === "Chakra Petch")
    .map((f) => ({ tezina: f.weight, stanje: f.status }));

  return { nalazi, debljine, ucitani };
})()\`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 600, show: false,
    webPreferences: { contextIsolation: true } });
  await win.loadFile(path.join(RENDERER, "index.html"));
  await new Promise((r) => setTimeout(r, 1500));
  const r = await win.webContents.executeJavaScript(PROVERA);

  // Isti font mora da nosi i prozor obavestenja koji iskace PREKO IGRE.
  const ov = new BrowserWindow({ width: 460, height: 160, show: false, webPreferences: { contextIsolation: true } });
  await ov.loadFile(path.join(RENDERER, "overlay.html"));
  await new Promise((x) => setTimeout(x, 900));
  r.obavestenje = await ov.webContents.executeJavaScript(
    \`(async () => { await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
       return { font: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/["']/g, ""),
                fajlova: [...document.fonts].filter((f) => f.family === "Chakra Petch").length }; })()\`);
  ov.destroy();

  console.log("NALAZI " + JSON.stringify(r));
  app.quit();
});
`;

fs.writeFileSync(path.join(RADNO, "main.js"), MAIN, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-fonta", version: "1.0.0", main: "main.js" }, null, 2), "utf8");

const electron = putanjaElektrona();
const p = spawn(electron, [RADNO]);
let izlaz = "";
p.stdout.on("data", (d) => (izlaz += d));
p.stderr.on("data", (d) => (izlaz += d));
p.on("close", (kod) => {
  const m = /NALAZI (\{.*\})/s.exec(izlaz);
  if (!m) {
    console.error(izlaz.split("\n").filter((l) => l.trim() && !/Deprecation|trace-dep/.test(l)).slice(-12).join("\n"));
    process.exit(kod || 1);
  }
  const { nalazi, debljine, ucitani, obavestenje } = JSON.parse(m[1]);
  console.log("PROVERA FONTA (Chakra Petch)\n");

  let fali = 0;
  console.log("  slovo   u fontu   bez fonta   ima ga");
  for (const n of nalazi) {
    if (!n.ima) fali++;
    console.log(`   ${n.znak}      ${String(n.sa).padStart(7)}   ${String(n.bez).padStart(9)}   ${n.ima ? "da" : "NE - pada na sistemski"}`);
  }

  const neucitane = debljine.filter((d) => !d.ucitan);
  console.log(`\n  debljine: ${debljine.map((d) => d.tezina + (d.ucitan ? "" : " (NIJE UCITANA)")).join(", ")}`);
  console.log(`  fajlova fonta u stranici: ${ucitani.length}`);

  // Obavestenje preko igre je svoj dokument - lako se zaboravi pri izmeni CSS-a.
  const obOk = obavestenje?.font === "Chakra Petch" && obavestenje?.fajlova === 8;
  console.log(`\n  obavestenje preko igre: ${obavestenje?.font} (${obavestenje?.fajlova} fajlova)` + (obOk ? "" : "  <- NIJE ISTI FONT"));

  const problema = fali + neucitane.length + (obOk ? 0 : 1);
  console.log(problema
    ? `\n${problema} problema - srpska slova bi se mesala sa sistemskim fontom`
    : "\nfont ima sva nasa slova, sve debljine su ucitane, i obavestenje preko igre nosi isti font");
  process.exit(problema ? 1 : 0);
});
