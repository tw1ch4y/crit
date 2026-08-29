import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
// Izvlaci odbrojMirovanje iz client/main.js i pusta ga sa laznim Windows-om,
// da se provere brojanje, otkazivanje pri povratku igraca i ciscenje tajmera.
import fs from "node:fs";

const izvor = citajIzvor("client/main.js");
const pocetak = izvor.indexOf("let mirovanjeTajmer = null;");
const kraj = izvor.indexOf("\n}", izvor.indexOf("function odbrojMirovanje")) + 2;
if (pocetak < 0 || kraj < 2) { console.error("nisam nasao funkciju u main.js"); process.exit(1); }

let idleSek = 0;
const prikazano = [];
const poslato = [];
let sakriveno = 0;

const kod = izvor.slice(pocetak, kraj);
const napravi = new Function(
  "powerMonitor", "prikaziObavestenje", "sakrijObavestenje", "wsSend",
  kod + "\nreturn odbrojMirovanje;"
);
const odbrojMirovanje = napravi(
  { getSystemIdleTime: () => idleSek },
  (o) => prikazano.push(o.opis),
  () => sakriveno++,
  (m) => poslato.push(m)
);

let pao = 0, prosao = 0;
const proveri = (naziv, uslov, detalj = "") => {
  if (uslov) { prosao++; console.log("  OK   " + naziv); }
  else { pao++; console.log("  PAO  " + naziv + (detalj ? "  -> " + detalj : "")); }
};
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. odbrojavanje ide unazad dok igrac miruje
idleSek = 900;
odbrojMirovanje(5);
proveri("odmah prikaze poruku", prikazano.length === 1 && /za 5 s/.test(prikazano[0]), prikazano[0]);
await cekaj(2300);
proveri("broji unazad", /za 3 s/.test(prikazano.at(-1)), prikazano.at(-1));

// 2. igrac pomeri mis -> poruka nestaje odmah, server dobija javljanje
idleSek = 0;
await cekaj(1200);
proveri("poruka sklonjena po povratku", sakriveno === 1, String(sakriveno));
proveri("serveru javljeno da je igrac tu", poslato.some((m) => m.t === "heartbeat" && m.mirovanje === 0), JSON.stringify(poslato));
const brojPosle = prikazano.length;
await cekaj(1500);
proveri("tajmer stvarno stao", prikazano.length === brojPosle, `${brojPosle} -> ${prikazano.length}`);

// 3. null gasi sve
prikazano.length = 0; sakriveno = 0;
idleSek = 900;
odbrojMirovanje(4);
odbrojMirovanje(null);
await cekaj(1600);
proveri("null sklanja poruku", sakriveno === 1, String(sakriveno));
proveri("null zaustavlja brojanje", prikazano.length === 1, String(prikazano.length));

// 4. dolazak novog odbrojavanja ne pravi drugi tajmer
prikazano.length = 0;
idleSek = 900;
odbrojMirovanje(9);
odbrojMirovanje(9);
await cekaj(1200);
const posle1s = prikazano.length;
proveri("nema duplog brojanja", posle1s <= 3, `poruka: ${posle1s}`);

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
