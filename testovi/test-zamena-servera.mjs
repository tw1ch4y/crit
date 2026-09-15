import fs from "node:fs";
import path from "node:path";
import { radniFolder, brojac } from "./_okruzenje.mjs";
import * as Z from "../server/src/zamena-servera.js";
// ZAMENA KODA SERVERA - I KAD STRUJA NESTANE USRED NJE
//
// Nadzornik menja kod servera novom verzijom (vidi zamena-servera.js). Zamena je
// nekoliko preimenovanja, pa se ovde glumi nestanak struje posle SVAKOG od njih
// i proverava da se posle vraćanja dobije ceo stari server - nikad pola novog.
//
// Uz to: baza i slike igraonice se ne diraju ni u zameni ni u vraćanju.
const { proveri, kraj } = brojac();
const DIR = radniFolder("zamena-servera");
const pisi = (koren, rel, s) => {
  const p = path.join(koren, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};
const citaj = (koren, rel) => { try { return fs.readFileSync(path.join(koren, ...rel.split("/")), "utf8"); } catch { return null; } };

const STARO = {
  "package.json": '{"version":"1.0.0"}', "src/index.js": "STARI", "src/samo-u-starom.js": "S",
  "public/index.html": "STARI HTML", "node_modules/ws/i.js": "WS1", "nadzornik.mjs": "N1",
};
const NOVO = {
  "package.json": '{"version":"2.0.0"}', "src/index.js": "NOVI", "src/samo-u-novom.js": "N",
  "public/index.html": "NOVI HTML", "public/css/novo.css": "CSS", "node_modules/ws/i.js": "WS2", "nadzornik.mjs": "N2",
};

function napravi(ime) {
  const koren = path.join(DIR, ime);
  const srv = path.join(koren, "server");
  const novi = path.join(koren, "novi");
  const nad = path.join(srv, "data", "nadogradnja-servera");
  for (const [rel, s] of Object.entries(STARO)) pisi(srv, rel, s);
  pisi(srv, "public/uploads/slika.png", "SLIKA");
  pisi(srv, "data/crit.db", "BAZA");
  for (const [rel, s] of Object.entries(NOVO)) pisi(novi, rel, s);
  return { folderServera: srv, novi, rezerva: path.join(nad, "pre-1.0.0"), marker: path.join(nad, "zamena.json") };
}
const jeStaro = (t) => Object.entries(STARO).every(([rel, s]) => citaj(t.folderServera, rel) === s) &&
  citaj(t.folderServera, "public/css/novo.css") === null && citaj(t.folderServera, "src/samo-u-novom.js") === null;
const podaciNetaknuti = (t) => citaj(t.folderServera, "data/crit.db") === "BAZA" && citaj(t.folderServera, "public/uploads/slika.png") === "SLIKA";

// ---- 1) ZAMENA ----
let t = napravi("zamena");
proveri("public/uploads nije stavka za zamenu", !Z.stavkeZaZamenu(t.novi).some((s) => s.startsWith("public/uploads")));
Z.zameni(t);
proveri("novi kod je na mestu", Object.entries(NOVO).every(([rel, s]) => citaj(t.folderServera, rel) === s));
proveri("stari fajl koji nova verzija nema otišao je sa starim src", citaj(t.folderServera, "src/samo-u-starom.js") === null);
proveri("baza i slike igraonice nisu ni taknute", podaciNetaknuti(t));
proveri("staro je sklonjeno u rezervu", citaj(t.rezerva, "src/index.js") === "STARI" && citaj(t.rezerva, "public/index.html") === "STARI HTML");
proveri("raspakovana nova verzija je potrošena", !fs.existsSync(t.novi));
proveri("zapis o zameni stoji dok se nova verzija ne javi", !!Z.nedovrsena(t.marker));
Z.potvrdi(t.marker);
proveri("potvrda briše zapis", !Z.nedovrsena(t.marker));

// ---- 2) NOVA VERZIJA SE NIJE JAVILA ----
t = napravi("vracanje");
Z.zameni(t);
const r = Z.vrati(t);
proveri("vraćanje vraća ceo stari server", jeStaro(t) && r.vraceno > 0);
proveri("baza i slike i dalje stoje", podaciNetaknuti(t));
proveri("zapis je obrisan", !Z.nedovrsena(t.marker));

// ---- 3) NESTANAK STRUJE POSLE SVAKOG KORAKA ----
// Šest stavki: pet ima staro (po dva pomeranja), jedna je nova (jedno) - 11 koraka.
const koraka = Z.stavkeZaZamenu(napravi("brojanje").novi).length * 2 - 1;
proveri("zamena ima onoliko koraka koliko se očekuje", koraka === 11, String(koraka));
for (let n = 0; n <= koraka; n++) {
  t = napravi("prekid-" + n);
  let pukao = false;
  try { Z.zameni({ ...t, _prekiniPosle: n }); } catch { pukao = true; }
  Z.vrati(t);
  proveri(`struja nestala posle ${n}. koraka: vraćen ceo stari server`,
    (pukao || n === koraka) && jeStaro(t) && podaciNetaknuti(t) && !Z.nedovrsena(t.marker));
}

// ---- 4) BEZ ZAPISA I SA POKVARENIM ZAPISOM ----
t = napravi("bez-zapisa");
proveri("vraćanje bez zapisa ne radi ništa", Z.vrati(t).vraceno === 0 && jeStaro(t));
fs.mkdirSync(path.dirname(t.marker), { recursive: true });
fs.writeFileSync(t.marker, "{pola");
proveri("pokvaren zapis ne obara nadzornika i briše se", Z.vrati(t).vraceno === 0 && !fs.existsSync(t.marker) && jeStaro(t));

// ---- 5) NOVA VERZIJA BEZ SERVERA ----
t = napravi("bez-servera");
fs.rmSync(path.join(t.novi, "src"), { recursive: true, force: true });
let greska = null;
try { Z.zameni(t); } catch (e) { greska = e; }
proveri("verzija bez src se ne menja uopšte", !!greska && jeStaro(t) && !Z.nedovrsena(t.marker), greska?.message);

// ---- 6) REZERVE ----
const rez = path.join(DIR, "rezerve");
for (let i = 1; i <= 5; i++) {
  pisi(rez, `pre-1.0.${i}/x.txt`, String(i));
  const t0 = Date.now() / 1000 - (10 - i) * 60;
  fs.utimesSync(path.join(rez, `pre-1.0.${i}`), t0, t0);
}
pisi(rez, "novi/x.txt", "ne dira se");
proveri("čuvaju se dve najnovije rezerve", Z.ocistiRezerve(rez, 2) === 3 &&
  JSON.stringify(fs.readdirSync(rez).filter((i) => i.startsWith("pre-")).sort()) === JSON.stringify(["pre-1.0.4", "pre-1.0.5"]));
proveri("a ostalo u folderu se ne dira", fs.existsSync(path.join(rez, "novi", "x.txt")));

await kraj();
