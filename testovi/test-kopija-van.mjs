import fs from "node:fs";
import path from "node:path";
import { radniFolder, podigniServer, citajIzvor } from "./_okruzenje.mjs";
// KOPIJA VAN RAČUNARA.
//
// Baza i svih tridesetak rezervnih kopija stoje na istom fizičkom disku. Sve
// ostalo u održavanju pazi da disk ne PUKNE od punoće - ništa od toga ne pomaže
// kad disk OTKAŽE. Tog dana nestaje sve odjednom: nalozi, kredit koji su gosti
// uplatili, promet, cela evidencija.
//
// Ovde se proverava ono što se u toj zaštiti najlakše pokvari: da ćutanje nikad
// ne prođe kao uspeh. Kopija koja "radi", a zapravo piše u prazan folder na
// istom disku, gora je od nikakve - vlasnik gleda zeleno stanje i ne radi ništa.
const BASE = "http://127.0.0.1:8173";
const DATA = radniFolder("kopija-van-data");
// Kratak rok za odredište koje ne odgovara - vidi odeljak 11.
process.env.ROK_ODREDISTA_MS = "1500";
await podigniServer(DATA, 8173);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b, t = token) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + t },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; } return { status: r.status, body: j }; });

const ODREDISTE = path.join(DATA, "..", "kopija-van-usb");
fs.rmSync(ODREDISTE, { recursive: true, force: true });
const dbFajlova = () => { try { return fs.readdirSync(ODREDISTE).filter((f) => f.endsWith(".db")); } catch { return []; } };

// ---- 1) dok nije podeseno, panel to ne precutkuje ----
let s = (await api("/api/kopija-van")).body;
proveri("na pocetku stoji da nije podeseno", s.stanje === "nepodesena" && !s.ukljucena, s.stanje);

// ---- 2) neispravno odrediste se odbija ODMAH, dok vlasnik gleda ----
// Kad bi se prvi put pisalo tek u ponoc, pogresna putanja bi se otkrila tek
// onog dana kad kopija zatreba - a tada je kasno.
const los = await api("/api/kopija-van", "POST", { putanja: "Z:\\ovoga-diska-nema\\nikako" });
proveri("nepostojeci disk se odbija odmah", los.status === 400 && /Ne mogu da pišem/.test(los.body.error || ""), JSON.stringify(los.body));
proveri("odbijeno odrediste se NE pamti", (await api("/api/kopija-van")).body.stanje === "nepodesena");

// ---- 3) ispravno odrediste: kopija odlazi odmah ----
const ok = await api("/api/kopija-van", "POST", { putanja: ODREDISTE });
proveri("ispravno odrediste se prima", ok.status === 200 && ok.body.ukljucena, JSON.stringify(ok.body));
proveri("prva kopija odlazi odmah pri cuvanju", dbFajlova().length === 1, `${dbFajlova().length} fajlova`);
proveri("stanje je uredno", (await api("/api/kopija-van")).body.stanje === "uredna");

// Kopija mora da bude PRAVA baza, ne prazan fajl - inace se otkrije tek pri vracanju.
const put = path.join(ODREDISTE, dbFajlova()[0]);
proveri("kopija je prava SQLite baza", fs.readFileSync(put).subarray(0, 15).toString() === "SQLite format 3");
const { DatabaseSync } = await import("node:sqlite");
const kopija = new DatabaseSync(put, { readOnly: true });
proveri("kopija nosi podatke", kopija.prepare("SELECT COUNT(*) c FROM computers").get().c > 0);
// Zatvoriti PRE brisanja: Windows ne da da se obrise folder cija je datoteka
// jos otvorena, pa bi suita pukla na EPERM umesto da javi nalaz.
kopija.close();

// ---- 4) ISCUPAN USB NE SME DA PRODJE KAO USPEH ----
//
// Ovo je cela poenta. Dok se odrediste pravilo pri kopiranju (`mkdir -p`),
// nestanak medija je znacio da se napravi NOV PRAZAN folder na sistemskom
// disku, kopija se uredno upise u njega i javi se da je sve u redu. Vlasnik bi
// mesecima gledao zeleno stanje, a jedini primerak baze bi i dalje bio na
// jednom disku.
fs.rmSync(ODREDISTE, { recursive: true, force: true });
const pao1 = await api("/api/kopija-van/sada", "POST");
proveri("iscupan USB javlja gresku", pao1.status === 500, `status ${pao1.status}: ${JSON.stringify(pao1.body)}`);
proveri("greska kaze sta da se uradi", /disk/i.test(pao1.body.error || ""), pao1.body.error);
proveri("server NE pravi lazno odrediste", !fs.existsSync(ODREDISTE), "napravio je prazan folder i mislio da je sacuvao");
const posle = (await api("/api/kopija-van")).body;
proveri("panel odmah stoji na 'pala'", posle.stanje === "pala", posle.stanje);
proveri("razlog stoji ispisan", !!posle.greska, JSON.stringify(posle));

// Sveza kopija od malopre NE sme da prekrije gresku: USB je vec iscupan, pa
// sutra kopije nece biti. Da se gledala samo starost, upozorenje bi kasnilo dva dana.
proveri("sveza kopija ne prikriva palo kopiranje",
  posle.poslednja && Date.now() - posle.poslednja < 60000 && posle.stanje === "pala",
  "stanje bi bilo 'uredna' da se gleda samo starost");

// ---- 5) vracen USB -> sve se oporavlja samo ----
fs.mkdirSync(ODREDISTE, { recursive: true });
const opet = await api("/api/kopija-van/sada", "POST");
proveri("vracen USB odmah radi", opet.status === 200 && dbFajlova().length === 1, JSON.stringify(opet.body));
proveri("greska se brise kad prodje", !(await api("/api/kopija-van")).body.greska);

// ---- 6) odrediste ne buja bez granice ----
// USB od 8 GB bi se inace napunio punim kopijama baze.
for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(ODREDISTE, `crit-2020-01-${String(i + 10)}T00-00-00-000.db`), "stara");
await api("/api/kopija-van/sada", "POST");
proveri("na odredistu ostaje najvise 7 kopija", dbFajlova().length <= 7, `${dbFajlova().length} fajlova`);
proveri("najnovija je zadrzana", dbFajlova().some((f) => !f.startsWith("crit-2020")), dbFajlova().join(", "));

// ---- 7) radnik ovo ne dira ----
await api("/api/admins", "POST", { username: "radnik", password: "radnik123", role: "staff" });
const rt = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "radnik", password: "radnik123" }) }).then((r) => r.json())).token;
proveri("radnik ne vidi podesavanje", (await api("/api/kopija-van", "GET", null, rt)).status === 403);
proveri("radnik ne moze da ga promeni", (await api("/api/kopija-van", "POST", { putanja: "C:\\" }, rt)).status === 403);

// ---- 8) prazno polje iskljucuje, bez brisanja onoga sto je vec napolju ----
const kolikoJeBilo = dbFajlova().length;
await api("/api/kopija-van", "POST", { putanja: "" });
proveri("prazno polje iskljucuje kopiranje", (await api("/api/kopija-van")).body.stanje === "nepodesena");
proveri("vec odnete kopije se ne brisu", dbFajlova().length === kolikoJeBilo, `${dbFajlova().length} != ${kolikoJeBilo}`);

// ---- 9) neuspeh se vidi i u Logovima, ne samo u konzoli ----
const src = citajIzvor("server/src/index.js");
proveri("palo kopiranje ide u Logove", /kopija_van_pala/.test(src),
  "prozor servera niko ne gleda - vlasnik ovo mora naci u panelu");

// ---- 10) SLIKE IDU ZAJEDNO SA BAZOM ----
//
// Baza bez slika je pola kopije. Redovi pokazuju na /uploads/..., a tih fajlova
// nema - pa se posle vracanja svaki omot, svaka slika pica i svih pet pozadina
// kucaju iznova, rucno. A vlasnik bi pri tom mesecima gledao zeleno "kopija
// uredna", jer je .db fajl uredno odlazio na USB.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
await api("/api/kopija-van", "POST", { putanja: ODREDISTE });
const igra = (await api("/api/games", "POST", { name: "Sa omotom", path: "C:/igre/sa-omotom.exe" })).body;
const saSlikom = await api(`/api/games/${igra.id}/image`, "POST", { image: PNG });
const imeSlike = path.basename(saSlikom.body.image || "");
proveri("slika je otpremljena", !!imeSlike, JSON.stringify(saSlikom.body));
proveri("i stoji UZ BAZU, u folderu sa podacima",
  fs.existsSync(path.join(DATA, "uploads", imeSlike)),
  "u server/public/uploads je bila van svake kopije i van svake izolacije");

await api("/api/kopija-van/sada", "POST");
const slikeTamo = path.join(ODREDISTE, "slike");
proveri("SLIKA JE OTISLA NA ODREDISTE", fs.existsSync(path.join(slikeTamo, imeSlike)),
  "vracena baza bez slika pokazuje na fajlove kojih nema");

// Drugi prolaz ne sme da prepisuje isto - USB bi na svako dnevno pokretanje
// nanovo primao desetine megabajta, a slike se menjaju jednom u par meseci.
const drugi = (await api("/api/kopija-van/sada", "POST")).body;
proveri("vec odneta slika se ne prepisuje", (drugi.slike?.novih ?? 0) === 0,
  JSON.stringify(drugi.slike));
proveri("ali se i dalje broji kao odneta", (drugi.slike?.preskoceno ?? 0) > 0,
  JSON.stringify(drugi.slike));

// Slika obrisana na serveru OSTAJE u kopiji: kopija treba da prezivi i gresku
// vlasnika, a nekoliko zaostalih fajlova kosta megabajt.
await api(`/api/games/${igra.id}`, "DELETE");
await api("/api/kopija-van/sada", "POST");
proveri("kopija ne brise za serverom", fs.existsSync(path.join(slikeTamo, imeSlike)),
  "izbrisana igra ne sme da povuce sliku i iz rezervne kopije");

// ---- 11) ODREDISTE KOJE NE ODGOVARA NE SME DA ZAUSTAVI SERVER ----
//
// Mrezni folder ciji racunar spava ume da drzi poziv i po minut. Dok je
// kopiranje bilo sinhrono, za to vreme je stajao ceo server - naplata, panel,
// launcheri - a nadzornik bi ga posle minut i po proglasio zaglavljenim i ubio.
// Ovde se odrediste "zaledi" (odgovor nikad ne stigne) i gleda sta server radi.
{
  const fsp = (await import("node:fs/promises")).default;
  const pravi = fsp.stat;
  fsp.stat = (p, ...ost) => (String(p).startsWith(ODREDISTE) ? new Promise(() => {}) : pravi(p, ...ost));
  try {
    const pocetak = Date.now();
    const cekanje = api("/api/kopija-van/sada", "POST");
    await new Promise((r) => setTimeout(r, 200));
    const zdrav = await fetch(BASE + "/api/zdravlje").then((r) => r.ok).catch(() => false);
    proveri("dok odrediste ne odgovara, server radi", zdrav && Date.now() - pocetak < 1200, `${Date.now() - pocetak} ms`);
    const odg = await cekanje;
    proveri("posle roka stize greska, poziv ne visi", odg.status === 500 && /ne odgovara/.test(odg.body.error || ""),
      JSON.stringify(odg.body));
    proveri("i panel stoji na 'pala'", (await api("/api/kopija-van")).body.stanje === "pala");
    const drugo = await api("/api/kopija-van/sada", "POST");
    proveri("dok prethodni poziv visi, novo kopiranje se ne pokusava",
      drugo.status === 500 && /jo[sš] nije zavr[sš]eno/.test(drugo.body.error || ""), JSON.stringify(drugo.body));
  } finally {
    fsp.stat = pravi;
  }
}
const src2 = citajIzvor("server/src/odrzavanje.js");
proveri("nijedan sinhroni poziv ne dira odrediste",
  !/function kopirajSada[\s\S]*?existsSync\(cilj\)/.test(src2) && !/copyFileSync\(izvor\.p/.test(src2),
  "sinhroni poziv ka mreznom folderu zaustavlja ceo server");

fs.rmSync(ODREDISTE, { recursive: true, force: true });
console.log(`\n${prosao}/${prosao + pao} proslo`);
await new Promise((r) => setTimeout(r, 300));
process.exit(pao ? 1 : 0);
