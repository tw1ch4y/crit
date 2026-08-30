// Pušta SVE alate koji rade sa pravim launcherom u pravom Electronu.
//
// Zašto postoji: suite (`pokreni-sve.mjs`) su brze i rade bez ičega spolja, ali
// se dobar deo njihovih tvrdnji svodi na čitanje izvornog koda - hvataju da je
// neko obrisao liniju, ne da funkcija radi. Pravi dokaz daju alati u ovom
// spisku: oni otvaraju prozor, kliknu dugme i mere šta se stvarno desilo.
//
// Dok se pokretali samo ručno, bili su zaboravljivi - a baš su oni našli da se
// nagradni točak ne može ni zavrteti ni zatvoriti, i da animacije stoje mrtve na
// računaru sa isključenim Windows animacijama.
//
//   node pokreni-probe.mjs          sve
//   node pokreni-probe.mjs klikova  samo one čije ime sadrži "klikova"
//
// Traje nekoliko minuta jer svaki alat diže svoj Electron prozor.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// Gasenje zaostalih launchera je zajednicko sa probama - objasnjenje zasto je
// potrebno stoji uz samu funkciju u _okruzenje.mjs.
import { ugasiLaunchere } from "./_okruzenje.mjs";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(OVDE, "..");
const PORT = 8171;
const FILTER = (process.argv[2] || "").toLowerCase();
const DATA = path.join(OVDE, ".radno", "probe-data");

// Alati kojima treba server na PORT-u. proba-procesa sam diže svoj, pa ide bez.
const ALATI = [
  { ime: "pregled-electron", args: ["--port", String(PORT)], opis: "svi ekrani na dve rezolucije, mere šta ispada iz ekrana" },
  { ime: "proba-klikova", args: [String(PORT)], opis: "svako dugme stvarno stiže do koda" },
  { ime: "proba-kretanja", args: [String(PORT)], opis: "animacije šare se stvarno pomeraju" },
  { ime: "proba-kretanja", args: [String(PORT), "--reduced"], opis: "isto, na računaru sa isključenim Windows animacijama", oznaka: "reduced" },
  { ime: "proba-fonta", args: [String(PORT)], opis: "font ima naša slova, sve debljine" },
  { ime: "proba-porudzbine", args: [String(PORT)], opis: "porudžbina od klika do baze, preko pravog WebSocketa" },
  { ime: "proba-procesa", args: [], opis: "daljinski task manager: popis i gašenje pravog programa", sam: true },
  { ime: "proba-nadogradnja-pin", args: [], opis: "servisni PIN preživljava nadogradnju launchera", sam: true },
  { ime: "proba-servisni-pin-server", args: [], opis: "servisni PIN se upisuje jednom u panelu i vazi na svim masinama, i bez servera", sam: true },
  { ime: "proba-veza", args: [], opis: "launcher preživljava otkucaj servera i sam se vraća", sam: true },
  { ime: "proba-pokretanje-igre", args: [], opis: "klik na igru stiže do baze, izveštaja i logova", sam: true },
  { ime: "proba-tocka", args: [], opis: "nagrada sa točka stiže na kredit tek kad se objavi", sam: true },
  { ime: "proba-tocak-zaglavljen", args: [], opis: "veza pukne usred vrtnje - launcher se sam izvuče, kredit se ne zamrzava", sam: true },
  { ime: "proba-admin-izlaz", args: [], opis: "otkljucavanje ne gasi launcher, a admin izlaz i dalje radi", sam: true },
  { ime: "proba-podesavanja", args: [], opis: "miš i zvuk se menjaju i vraćaju na zatečeno pri odjavi", sam: true },
  { ime: "proba-obavestenja", args: [], opis: "upozorenje o vremenu i poruka osoblja stižu preko igre", sam: true },
];

const izabrani = FILTER ? ALATI.filter((a) => (a.ime + (a.oznaka || "")).toLowerCase().includes(FILTER)) : ALATI;
if (!izabrani.length) {
  console.error(`Nijedan alat ne odgovara "${FILTER}". Dostupni: ${[...new Set(ALATI.map((a) => a.ime))].join(", ")}`);
  process.exit(1);
}

const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server za alate kojima treba ----
let server = null;
if (izabrani.some((a) => !a.sam)) {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  server = spawn(process.execPath, [path.join(KOREN, "server", "src", "index.js")], {
    env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: "ignore",
  });
  let ziv = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (r.status) { ziv = true; break; }
    } catch {}
    await cekaj(250);
  }
  if (!ziv) {
    console.error("Server se nije podigao na portu " + PORT);
    try { server.kill(); } catch {}
    process.exit(1);
  }
  // Alati traže katalog kakav igraonica stvarno ima; prazna baza bi dala prazne
  // ekrane i tvrdnje bi prolazile ni o čemu.
  const t = (await fetch(`http://127.0.0.1:${PORT}/api/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
  const api = (p, m = "GET", b) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: m,
    headers: { "content-type": "application/json", authorization: "Bearer " + t },
    body: b ? JSON.stringify(b) : undefined }).then((r) => r.text());
  await api("/api/computers/bulk", "POST", { count: 3, prefix: "PC-" });
  for (const g of ["Counter-Strike 2", "Valorant", "Fortnite"]) {
    await api("/api/games", "POST", { name: g, path: "C:\\games\\" + g.toLowerCase().replace(/\s/g, ""), category: "Igre" });
  }
}

const zaostalih = ugasiLaunchere();
if (zaostalih) console.log(`\n(ugašeno ${zaostalih} zaostalih launchera iz prethodnog pokretanja)`);

console.log(`\nPROBE NA PRAVOM LAUNCHERU  (${izabrani.length} ${izabrani.length === 1 ? "alat" : "alata"})\n`);

const nalazi = [];
for (const a of izabrani) {
  const naziv = a.ime + (a.oznaka ? ` (${a.oznaka})` : "");
  // Linija napretka ima smisla samo u terminalu; kad se izlaz preusmerava u
  // fajl, \r ostaje u tekstu i red se udvaja.
  if (process.stdout.isTTY) process.stdout.write(`  ...  ${naziv.padEnd(30)} ${a.opis}\r`);
  const t0 = Date.now();
  const kod = await new Promise((res) => {
    const p = spawn(process.execPath, [path.join(OVDE, a.ime + ".mjs"), ...a.args], { cwd: OVDE, stdio: ["ignore", "pipe", "pipe"] });
    let izlaz = "";
    p.stdout.on("data", (d) => (izlaz += d));
    p.stderr.on("data", (d) => (izlaz += d));
    p.on("close", (c) => res({ c, izlaz }));
  });
  // Čisti se POSLE SVAKOG alata, ne samo na kraju niza.
  //
  // spawn sa shell:true na Windows-u ubija samo cmd.exe omotač, pa launcher
  // ostane da radi i uđe u sledeći alat. Dva launchera sa istim tokenom se onda
  // otimaju o vezu i sledeći alat puca na "No handler registered" - greška koja
  // izgleda kao kvar u programu, a nije.
  ugasiLaunchere();
  await cekaj(600);

  const sek = Math.round((Date.now() - t0) / 1000);
  const ok = kod.c === 0;
  nalazi.push({ naziv, ok, izlaz: kod.izlaz, sek });
  console.log(`  ${ok ? "OK  " : "PAO "} ${naziv.padEnd(30)} ${a.opis}  (${sek}s)`);
}

if (server) { try { server.kill(); } catch {} await cekaj(400); }
// Za sobom se ne ostavlja nijedan prozor: proba koja je pukla na pola ume da
// ostavi Electron da radi, a on onda kvari sledece pokretanje.
ugasiLaunchere();

const pali = nalazi.filter((n) => !n.ok);
for (const n of pali) {
  console.log(`\n--- ${n.naziv} ---`);
  // Uz svaki PAO ide i ono što je ispisano ODMAH POSLE njega: tu stoje izmerene
  // vrednosti zbog kojih je i pao. Ranije je filter propuštao samo red sa "PAO"
  // pa se iz izveštaja nije videlo zašto, i moralo se ručno puštati iznova.
  const redovi = n.izlaz.split("\n");
  const bitno = [];
  redovi.forEach((l, i) => {
    if (!/PAO|GRESKA|Error|ne radi|odsecen/i.test(l)) return;
    bitno.push(l);
    for (let k = i + 1; k < Math.min(i + 5, redovi.length); k++) {
      if (/^\s{6,}/.test(redovi[k])) bitno.push(redovi[k]); else break;
    }
  });
  console.log((bitno.length ? bitno : redovi.slice(-14)).join("\n"));
}

console.log(`\n${nalazi.length - pali.length}/${nalazi.length} alata proslo`);
if (pali.length) console.log("Slike i detalji ostaju u testovi/.slike*/ i .radno/");
process.exit(pali.length ? 1 : 0);
