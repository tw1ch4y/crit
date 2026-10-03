// IME IGRAONICE - MENJA SE NA JEDNOM MESTU, UPISUJE SE NA SVA
//
//   node igraonica.mjs                 pokaže gde koje ime stoji i da li se slaže
//   node igraonica.mjs "Nova Igraonica"  upiše svuda
//
// ZAŠTO POSTOJI
//
// Ime `Crit` je stajalo u instaleru, u prečici na desktopu, u imenu foldera u
// koji se launcher instalira i u alatima za oporavak (`POPRAVI-RACUNAR.bat` i
// ostali ga zovu po imenu procesa). Dok je igraonica jedna, to nikome ne smeta.
// Čim program dobije drugu igraonicu, ona dobija instaler koji se zove tuđim
// imenom - a njeni alati za oporavak gase proces koji na toj mašini ne postoji,
// i pri tom uredno jave da je sve prošlo.
//
// ŠTA SE NE MENJA
//
// Unutrašnja imena ostaju: `crit.db`, `CRIT_DATA_DIR`, imena funkcija u kodu.
// To ne vidi nijedan korisnik, a preimenovanje baze bi ostavilo sve postojeće
// podatke sa strane. Menja se samo ono što se VIDI - na instaleru, u Windows-u i
// u alatima koji zovu launcher po imenu.
import fs from "node:fs";
import path from "node:path";

const KOREN = import.meta.dirname;
const IZVOR = path.join(KOREN, "igraonica.json");

const procitajJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
// Isto kako npm sam piše package.json, pa razlika u git-u ostane čitljiva.
const upisiJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");

// Ime se pretvara u oznaku za appId i za ime paketa: mala slova, bez naših
// slova i razmaka. "Nova Igraonica" -> "nova-igraonica".
export function oznaka(ime) {
  return String(ime).toLowerCase()
    .replace(/[čć]/g, "c").replace(/š/g, "s").replace(/ž/g, "z")
    .replace(/đ/g, "dj").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "igraonica";
}

export function procitajBrend() {
  return procitajJson(IZVOR);
}

// Gde koje ime mora da stoji. Jedno mesto za tvrdnju "ovo nosi ime igraonice" -
// odavde je čita i alat i provera (testovi/test-ime-igraonice.mjs), pa se ne
// može desiti da se doda mesto koje alat menja a provera ne gleda.
export function mesta(b) {
  return [
    { fajl: "client/package.json", polje: "name", vrednost: `${b.oznaka}-launcher`, opis: "ime paketa launchera" },
    { fajl: "client/package.json", polje: "description", vrednost: `${b.ime} igraonica - launcher za racunare igraca`, opis: "opis launchera" },
    { fajl: "client/package.json", polje: "author", vrednost: b.ime, opis: "autor" },
    { fajl: "client/package.json", polje: "build.appId", vrednost: b.appId, opis: "kako Windows prepoznaje program" },
    { fajl: "client/package.json", polje: "build.productName", vrednost: b.launcher, opis: "ime instalera i foldera instalacije" },
    { fajl: "client/package.json", polje: "build.nsis.shortcutName", vrednost: b.launcher, opis: "prečica na desktopu" },
    { fajl: "server/package.json", polje: "name", vrednost: `${b.oznaka}-server`, opis: "ime paketa servera" },
    { fajl: "server/package.json", polje: "description", vrednost: `${b.ime} igraonica - server i admin panel`, opis: "opis servera" },
  ];
}

const uzmi = (o, put) => put.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
const stavi = (o, put, v) => {
  const k = put.split(".");
  const zadnji = k.pop();
  k.reduce((x, i) => (x[i] ??= {}), o)[zadnji] = v;
};

// Tekstualne zamene: ovde ime stoji usred rečenice ili putanje, pa se ne može
// upisati po polju.
//
// PUNO IME LAUNCHERA ("Crit Launcher") menja se SVUDA gde se nađe. Prvo su ovde
// stajali pojedinačni obrasci - "onaj u taskkill-u", "onaj u putanji" - i to je
// odmah promašilo dva mesta. Jedno bezazleno (folder koji se ne obriše), drugo
// opasno: u `POPRAVI-RACUNAR.bat` je `find` bio zamenjen a `tasklist /FI
// "IMAGENAME eq ..."` nije, pa bi alat za oporavak zauvek mislio da launcher
// još radi. Alat koji se pokreće kad je već sve otišlo naopako mora da radi.
//
// BARE IME ("Crit") se NE menja svuda, i to je namerno: pojavljuje se u
// `crit.db`, `CRIT_DATA_DIR`, `promoCrit`, `tekstura: "crit"` i u zaglavljima
// `X-Crit-*`. To su unutrašnja imena - ne vidi ih nijedan korisnik, a
// preimenovanje baze bi ostavilo sve postojeće podatke sa strane. Zato za njega
// ide izričit spisak mesta.
export function zamene(staro, novo) {
  const z = [];
  const par = (a, b) => { if (a !== b && a) z.push([a, b]); };
  // puno ime i oznake paketa - dovoljno su specifični da se menjaju svuda
  par(staro.launcher, novo.launcher);
  par(`${staro.oznaka}-launcher`, `${novo.oznaka}-launcher`);
  par(`${staro.oznaka}-server`, `${novo.oznaka}-server`);
  // bare ime - samo tamo gde je zaista ime igraonice
  par(`Startup\\${staro.ime}*.lnk`, `Startup\\${novo.ime}*.lnk`);
  par(`StartUp\\${staro.ime}*.lnk`, `StartUp\\${novo.ime}*.lnk`);
  par(`title ${staro.ime} -`, `title ${novo.ime} -`);
  par(`REM  ${staro.ime} -`, `REM  ${novo.ime} -`);
  par(`like '%%${staro.ime}%%'`, `like '%%${novo.ime}%%'`);
  par(`cafe_name: "${staro.ime}"`, `cafe_name: "${novo.ime}"`);
  par(`getSetting("cafe_name", "${staro.ime}")`, `getSetting("cafe_name", "${novo.ime}")`);
  // Dva znaka `\n` iz izvornog koda servera, ne pravi novi red.
  par(`\\n${staro.ime} server radi na portu`, `\\n${novo.ime} server radi na portu`);
  return z;
}

// napravi-paket.mjs NIJE ovde: on ime ČITA iz igraonica.json, pa nema šta da
// mu se menja. Tako je i bolje - uputstvo koje pravi ide u samu igraonicu.
export const FAJLOVI_SA_IMENOM = [
  // Kopije u korenu projekta su iste kao u client/ (test-alati-osoblja). Bez
  // njih na spisku bi se posle preimenovanja razisle: alat iz korena bi gasio
  // proces koji na toj masini ne postoji - i javio da je sve proslo.
  "DEINSTALIRAJ-LAUNCHER.bat",
  "POPRAVI-RACUNAR.bat",
  "client/DEINSTALIRAJ-LAUNCHER.bat",
  "client/POPRAVI-RACUNAR.bat",
  "client/resetuj-launcher.bat",
  "client/start-launcher.bat",
  "client/zastita-ukljuci.bat",
  "client/zastita-iskljuci.bat",
  "server/src/db.js",
  "server/src/service.js",
  "server/src/index.js",
];

// ---------- pokretanje ----------
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.slice(1))) {
  const b = procitajBrend();
  const novoIme = (process.argv[2] || "").trim();

  if (!novoIme) {
    console.log(`\nIgraonica: ${b.ime}\n`);
    let sve = true;
    for (const m of mesta(b)) {
      const imaSad = uzmi(procitajJson(path.join(KOREN, m.fajl)), m.polje);
      const ok = imaSad === m.vrednost;
      if (!ok) sve = false;
      console.log(`  ${ok ? "  " : "!!"} ${(m.fajl + " " + m.polje).padEnd(42)} ${imaSad}`);
    }
    console.log(sve
      ? `\nSve nosi ime "${b.ime}".\n\nZa drugu igraonicu:  node igraonica.mjs "Nova Igraonica"\n`
      : `\nNE POKLAPA SE sa igraonica.json. Ispravi sa:  node igraonica.mjs "${b.ime}"\n`);
    process.exit(sve ? 0 : 1);
  }

  if (novoIme.length > 40) {
    console.error("\nIme je predugačko - stoji na prečici i u imenu foldera.\n");
    process.exit(1);
  }

  const novo = {
    ime: novoIme,
    launcher: `${novoIme} Launcher`,
    oznaka: oznaka(novoIme),
    appId: `rs.${oznaka(novoIme)}.launcher`,
  };

  const promenjeni = [];
  // package.json - po poljima, jer su to podaci a ne tekst
  for (const m of mesta(novo)) {
    const put = path.join(KOREN, m.fajl);
    const o = procitajJson(put);
    if (uzmi(o, m.polje) === m.vrednost) continue;
    stavi(o, m.polje, m.vrednost);
    upisiJson(put, o);
    if (!promenjeni.includes(m.fajl)) promenjeni.push(m.fajl);
  }
  // ostalo - ciljanim zamenama
  const z = zamene(b, novo);
  for (const f of FAJLOVI_SA_IMENOM) {
    const put = path.join(KOREN, f);
    let t;
    try { t = fs.readFileSync(put, "utf8"); } catch { continue; }
    let novoT = t;
    for (const [a, c] of z) novoT = novoT.split(a).join(c);
    if (novoT !== t) { fs.writeFileSync(put, novoT); promenjeni.push(f); }
  }
  upisiJson(IZVOR, novo);

  console.log(`\nIgraonica: ${b.ime} -> ${novo.ime}\n`);
  for (const f of promenjeni) console.log(`  ${f}`);
  console.log(`\n  instaler:  ${novo.launcher} Setup X.Y.Z.exe`);
  console.log(`  folder:    %LOCALAPPDATA%\\Programs\\${novo.launcher}`);
  console.log(`  appId:     ${novo.appId}\n`);

  // OVO SE MORA PROČITATI, NE PRESKOČITI.
  //
  // Windows program prepoznaje po appId-u, a launcher svoja podešavanja drži u
  // folderu nazvanom po imenu programa. Oboje se upravo promenilo, pa na mašini
  // na kojoj već stoji stara verzija nova nastaje PORED nje, a launcher ne nađe
  // svoja podešavanja i traži adresu servera i token kao prvi put.
  console.log("PAŽNJA - na mašinama gde je stara verzija već instalirana:");
  console.log("  1. prvo DEINSTALIRAJ-LAUNCHER.bat (stara se ne prepisuje sama - drugo je ime)");
  console.log("  2. posle instalacije se ponovo unose adresa servera i token");
  console.log("     (podešavanja stoje u folderu nazvanom po imenu programa)\n");
  console.log("Dalje:  cd client && npm run build\n");
}
