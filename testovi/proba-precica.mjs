// Provera da launcher nalazi PRAVI fajl kad je u panel upisana putanja bez
// nastavka. Osoblje drzi precice u C:\games i cesto upise samo "C:\games\cs2",
// a na disku stoji "cs2.lnk".
//
// Bez ovoga igrac dobije "nije instalirana na ovom racunaru", iako jeste - i to
// se ne vidi ni iz koda ni iz testova nad serverom.
//
//   node proba-precica.mjs <folder sa .lnk fajlovima>
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { putanjaElektrona } from "./_okruzenje.mjs";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const FOLDER = process.argv[2];
if (!FOLDER || !fs.existsSync(FOLDER)) {
  console.error("Daj folder sa probnim .lnk fajlovima:  node proba-precica.mjs C:/putanja");
  process.exit(1);
}
const RADNO = path.join(OVDE, ".radno", "proba-precica");
fs.rmSync(RADNO, { recursive: true, force: true });
fs.mkdirSync(RADNO, { recursive: true });

const MAIN = `
const { app, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const FOLDER = ${JSON.stringify(FOLDER)};
process.on("uncaughtException", (e) => { console.log("PUKLO: " + (e && e.stack || e)); app.exit(1); });
app.on("window-all-closed", () => {});

// Ista funkcija kao u client/main.js. Ako se tamo promeni, ovde se vidi.
const NASTAVCI = [".lnk", ".exe", ".url", ".bat", ".cmd"];
function nadjiPutanju(p) {
  try {
    if (fs.existsSync(p)) {
      return fs.statSync(p).isDirectory() ? { folder: true } : { put: p };
    }
    if (!path.extname(p)) {
      for (const n of NASTAVCI) {
        if (fs.existsSync(p + n)) return { put: p + n };
      }
    }
  } catch {}
  return null;
}

app.whenReady().then(async () => {
  const slucajevi = [
    { opis: "precica bez nastavka (kako osoblje najcesce upise)", ulaz: path.join(FOLDER, "cs2"), ocekivano: "lnk" },
    { opis: "precica sa nastavkom", ulaz: path.join(FOLDER, "cs2.lnk"), ocekivano: "lnk" },
    { opis: "precica u navodnicima i sa razmakom", ulaz: '  "' + path.join(FOLDER, "dota") + '"  ', ocekivano: "lnk" },
    { opis: "folder umesto fajla", ulaz: path.join(FOLDER, "folder-igra"), ocekivano: "folder" },
    { opis: "ne postoji nista", ulaz: path.join(FOLDER, "nema-ovoga"), ocekivano: "nista" },
  ];

  const nalazi = [];
  for (const s of slucajevi) {
    const cist = String(s.ulaz).trim().replace(/^"|"$/g, "").trim();
    const r = nadjiPutanju(cist);
    const ishod = r?.folder ? "folder" : r?.put ? path.extname(r.put).slice(1).toLowerCase() : "nista";
    // Ikona se vadi iz onoga sto je pronadjeno, ne iz upisanog. Za precicu se
    // prvo procita na sta pokazuje - sama precica daje sicusnu genericku sliku.
    let ikona = null, izPrecice = null, sirova = null;
    if (r?.put && /\\.(exe|lnk)$/i.test(r.put)) {
      try {
        const s0 = await app.getFileIcon(r.put, { size: "large" });
        if (s0 && !s0.isEmpty()) sirova = s0.toDataURL().length;
      } catch {}
      let izvor = r.put;
      if (/\\.lnk$/i.test(r.put)) {
        try {
          const veza = shell.readShortcutLink(r.put);
          const c = veza.icon || veza.target;
          if (c && fs.existsSync(c)) { izvor = c; izPrecice = path.basename(c); }
        } catch {}
      }
      try { const img = await app.getFileIcon(izvor, { size: "large" }); if (img && !img.isEmpty()) ikona = img.toDataURL().length; } catch {}
    }
    nalazi.push({ ...s, ishod, nadjeno: r?.put ? path.basename(r.put) : null, ikona, sirova, izPrecice });
  }
  console.log("NALAZI " + JSON.stringify(nalazi));
  app.quit();
});
`;

fs.writeFileSync(path.join(RADNO, "main.js"), MAIN, "utf8");
fs.writeFileSync(path.join(RADNO, "package.json"), JSON.stringify({ name: "proba-precica", version: "1.0.0", main: "main.js" }, null, 2), "utf8");

const electron = putanjaElektrona();
const p = spawn(electron, [RADNO]);
let izlaz = "";
p.stdout.on("data", (d) => (izlaz += d));
p.stderr.on("data", (d) => (izlaz += d));
p.on("close", (kod) => {
  const m = /NALAZI (\[.*\])/s.exec(izlaz);
  if (!m) {
    console.error(izlaz.split("\n").filter((l) => l.trim() && !/Deprecation|trace-dep/.test(l)).slice(-12).join("\n"));
    process.exit(kod || 1);
  }
  console.log("PRECICE U C:\\games\n");
  let pao = 0;
  for (const n of JSON.parse(m[1])) {
    let ok = n.ishod === n.ocekivano;
    const greske = [];
    if (!ok) greske.push(`ocekivano "${n.ocekivano}", dobijeno "${n.ishod}"`);
    // Precica koja pokazuje na pravi program mora da da PRAVU ikonu, ne onu
    // sicusnu genericku koju Windows vraca za sam .lnk fajl.
    if (n.ishod === "lnk") {
      if (!n.izPrecice) greske.push("nije procitano na sta precica pokazuje");
      else if (!(n.ikona > n.sirova * 1.5)) {
        greske.push(`ikona nije bolja od genericke (${(n.sirova / 1024).toFixed(1)} -> ${(n.ikona / 1024).toFixed(1)} KB)`);
      }
    }
    if (greske.length) { pao++; ok = false; }
    console.log(`  ${ok ? "OK  " : "PAO "} ${n.opis}`);
    console.log(`         nadjeno: ${n.nadjeno || "(nista)"}   ishod: ${n.ishod}`
      + (n.izPrecice ? `   pokazuje na: ${n.izPrecice}` : "")
      + (n.ikona ? `   ikona: ${(n.sirova / 1024).toFixed(1)} -> ${(n.ikona / 1024).toFixed(1)} KB` : ""));
    for (const g of greske) console.log(`         -> ${g}`);
  }
  console.log(pao ? `\n${pao} slucaja ne radi` : "\nsvi slucajevi rade");
  process.exit(pao ? 1 : 0);
});
