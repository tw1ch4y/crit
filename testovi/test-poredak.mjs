import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
// Redosled police u launcheru: skoro igrane napred, ostale zadrzavaju redosled iz panela.
import fs from "node:fs";

const izvor = citajIzvor("client/renderer/js/launcher.js");
const pocetak = izvor.indexOf("function poredakIgara()");
const kraj = izvor.indexOf("\n}", pocetak) + 2;
if (pocetak < 0) { console.error("nisam nasao poredakIgara u launcher.js"); process.exit(1); }

// Poslednje igrana igra je prva na polici, uvek, u istoj kartici kao ostale.
const S = { games: [], skoroIgrane: [], promo: [] };
const poredak = new Function("S", izvor.slice(pocetak, kraj) + "\nreturn poredakIgara;")(S);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const imena = (a) => a.map((g) => g.name).join(",");

S.games = [
  { id: 1, name: "CS2" }, { id: 2, name: "Fortnite" },
  { id: 3, name: "GTA V" }, { id: 4, name: "Valorant" },
];

S.skoroIgrane = [];
proveri("bez istorije redosled ostaje iz panela", imena(poredak()) === "CS2,Fortnite,GTA V,Valorant", imena(poredak()));

S.skoroIgrane = [3, 1];
proveri("skoro igrane idu napred u svom redosledu", imena(poredak()) === "GTA V,CS2,Fortnite,Valorant", imena(poredak()));

S.skoroIgrane = [4];
proveri("jedna skoro igrana", imena(poredak()) === "Valorant,CS2,Fortnite,GTA V", imena(poredak()));

// igra koju je osoblje u medjuvremenu sakrilo ne sme da napravi rupu ni duplikat
S.skoroIgrane = [99, 2];
proveri("obrisana igra iz istorije se ignorise", imena(poredak()) === "Fortnite,CS2,GTA V,Valorant", imena(poredak()));

S.skoroIgrane = [1, 2, 3, 4];
proveri("sve igrane, nista se ne gubi", poredak().length === 4 && new Set(poredak().map((g) => g.id)).size === 4, imena(poredak()));

S.games = [];
S.skoroIgrane = [1, 2];
proveri("prazan katalog ne puca", poredak().length === 0);

// ---- SORTIRANJE VAZI UVEK, I KAD JE OKACEN PROMO BANER ----
//
// Promo baner i redosled na polici su nezavisni: ono sto je igrac poslednje
// igrao je uvek prvo.
S.games = [
  { id: 1, name: "CS2" }, { id: 2, name: "Fortnite" },
  { id: 3, name: "GTA V" }, { id: 4, name: "Valorant" },
];
S.skoroIgrane = [3, 1];
S.promo = [{ image: "/uploads/promo-1.png" }];
proveri("uz okacen promo baner polica se i dalje sortira",
  imena(poredak()) === "GTA V,CS2,Fortnite,Valorant", imena(poredak()));
S.promo = [];
proveri("bez promo banera isto tako",
  imena(poredak()) === "GTA V,CS2,Fortnite,Valorant", imena(poredak()));

// Ono zbog cega je vlasnik i trazio izmenu: zadnje igran CS2 mora da bude prvi.
S.skoroIgrane = [1];
proveri("zadnje igran CS2 je PRVI na ekranu",
  imena(poredak()).startsWith("CS2"), imena(poredak()));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
