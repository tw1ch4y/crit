import fs from "node:fs";
import path from "node:path";

// ---------- ZAMENA KODA SERVERA ----------
//
// Nadogradnju sa panela izvodi NADZORNIK, ne server: server ne može da zameni
// fajlove iz kojih radi. Server proveri paket i raspakuje ga u
// data\nadogradnja-servera\novi, zamoli nadzornika, i ugasi se uredno. Nadzornik
// onda zameni kod i podigne novu verziju - a ako se ona ne javi, vraća staru.
//
// NESTANAK STRUJE USRED ZAMENE
//
// Zamena je nekoliko preimenovanja, ne jedno. Da računar ostane bez struje
// između njih, na disku bi stajao server pola nov, pola star - i to je jedino
// stanje gore od neuspele nadogradnje, jer ne radi ni stara ni nova verzija.
//
// Zato se PRE prvog pomeranja upiše zapis (zamena.json): šta se menja i gde je
// sklonjeno staro. Nadzornik ga pri svakom pokretanju pogleda; ako zapis stoji,
// zamena nije potvrđena i vraća se staro - bez obzira na kom je koraku stala.
// Zapis se briše tek kad se nova verzija javi sa svojim brojem.
//
// Vraćanje ne zavisi od toga dokle se stiglo:
//   - staro je sklonjeno  -> ono što stoji na mestu se briše, staro se vraća
//   - stavka je nova      -> briše se
//   - staro nije ni takn  -> ostaje gde jeste

// U public\ stoje i stvari koje nisu program: stare otpremljene slike i proba.
const PUBLIC_NIJE_PROGRAM = new Set(["uploads", "_proba"]);
const pun = (koren, rel) => path.join(koren, ...rel.split("/"));
const postoji = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const cekajSinhrono = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Windows ne da da se preimenuje folder u kom neko drži otvoren fajl -
// antivirus koji baš skenira node_modules, Explorer otvoren u src\. To obično
// prođe za sekundu, pa se pokušava ponovo pre nego što se odustane.
function uporno(radnja) {
  for (let i = 0; ; i++) {
    try { return radnja(); }
    catch (e) {
      if (i >= 15 || !["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(e?.code)) throw e;
      cekajSinhrono(200);
    }
  }
}
function premesti(sa, na) {
  fs.mkdirSync(path.dirname(na), { recursive: true });
  uporno(() => fs.renameSync(sa, na));
}
function obrisi(p) { uporno(() => fs.rmSync(p, { recursive: true, force: true })); }

// Šta nova verzija donosi. public\ se menja po delovima, da uploads\ ostane.
export function stavkeZaZamenu(novi) {
  const izlaz = [];
  for (const e of fs.readdirSync(novi, { withFileTypes: true })) {
    if (e.name === "public" && e.isDirectory()) {
      for (const d of fs.readdirSync(path.join(novi, "public"))) {
        if (!PUBLIC_NIJE_PROGRAM.has(d)) izlaz.push(`public/${d}`);
      }
    } else {
      izlaz.push(e.name);
    }
  }
  return izlaz.sort();
}

/**
 * Menja kod servera novom verzijom. Staro ide u `rezerva`.
 * Posle ovoga zapis `marker` STOJI - briše ga `potvrdi` kad se nova verzija javi.
 */
export function zameni({ folderServera, novi, rezerva, marker, _prekiniPosle = Infinity }) {
  const stavke = stavkeZaZamenu(novi);
  if (!stavke.includes("src") || !stavke.includes("package.json")) {
    throw new Error("U novoj verziji nema servera (fale src i package.json)");
  }
  const imaStaro = stavke.filter((s) => postoji(pun(folderServera, s)));
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.mkdirSync(rezerva, { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ rezerva, stavke, imaStaro, pocelo: new Date().toISOString() }), "utf8");
  // `_prekiniPosle` postoji samo zbog provere: glumi nestanak struje posle
  // tačno toliko pomeranja, da se vidi da vraćanje radi sa svakog koraka.
  let koraka = 0;
  const korak = (sa, na) => {
    if (koraka++ >= _prekiniPosle) throw new Error("prekid zamene (proba)");
    premesti(sa, na);
  };
  for (const s of stavke) {
    if (imaStaro.includes(s)) korak(pun(folderServera, s), pun(rezerva, s));
    korak(pun(novi, s), pun(folderServera, s));
  }
  obrisi(novi);
  return { stavke: stavke.length };
}

export function nedovrsena(marker) {
  try { return JSON.parse(fs.readFileSync(marker, "utf8")); } catch { return null; }
}

/** Vraća staro po zapisu, dokle god da je zamena stigla. */
export function vrati({ folderServera, marker }) {
  const z = nedovrsena(marker);
  if (!z || !Array.isArray(z.stavke) || !z.rezerva) {
    fs.rmSync(marker, { force: true });
    return { vraceno: 0 };
  }
  let vraceno = 0;
  for (const s of z.stavke) {
    const cilj = pun(folderServera, s);
    const staro = pun(z.rezerva, s);
    if (postoji(staro)) {
      if (postoji(cilj)) obrisi(cilj);
      premesti(staro, cilj);
      vraceno++;
    } else if (!z.imaStaro.includes(s)) {
      if (postoji(cilj)) obrisi(cilj);
    }
  }
  fs.rmSync(marker, { force: true });
  return { vraceno };
}

export function potvrdi(marker) {
  fs.rmSync(marker, { force: true });
}

// Rezerve prethodnih verzija se čuvaju za ručni povratak, ali ne sve: svaka je
// ceo server sa node_modules.
export function ocistiRezerve(folder, zadrzi = 2) {
  let imena;
  try { imena = fs.readdirSync(folder).filter((i) => i.startsWith("pre-")); } catch { return 0; }
  const poVremenu = imena
    .map((i) => ({ i, t: fs.statSync(path.join(folder, i)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  let obrisano = 0;
  for (const { i } of poVremenu.slice(zadrzi)) {
    try { obrisi(path.join(folder, i)); obrisano++; } catch {}
  }
  return obrisano;
}
