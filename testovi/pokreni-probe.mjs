// Pušta sve alate koji rade sa pravim launcherom u pravom Electronu. Suite iz
// `pokreni-sve.mjs` su brze, ali deo provera čita izvorni kod; ovi alati otvaraju
// prozor, klikću i mere rezultat.
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
  // Pregled panela: sve strane, na tri rezolucije.
  { ime: "pregled-panela", args: ["--port", String(PORT)], opis: "svih 15 strana panela, na tri rezolucije (i na telefonu)" },
  { ime: "proba-klikova", args: [String(PORT)], opis: "svako dugme stvarno stiže do koda" },
  { ime: "proba-kretanja", args: [String(PORT)], opis: "animacije šare se stvarno pomeraju" },
  { ime: "proba-kretanja", args: [String(PORT), "--reduced"], opis: "isto, na računaru sa isključenim Windows animacijama", oznaka: "reduced" },
  { ime: "proba-fonta", args: [String(PORT)], opis: "font ima naša slova, sve debljine" },
  { ime: "proba-police", args: [], opis: "polica igara se stvarno naginje i vraća dok se skroluje", sam: true },
  { ime: "proba-porudzbine", args: [String(PORT)], opis: "porudžbina od klika do baze, preko pravog WebSocketa" },
  { ime: "proba-procesa", args: [], opis: "daljinski task manager: popis i gašenje pravog programa", sam: true },
  { ime: "proba-straze", args: [], opis: "straža nad skinutim programima: jedan proces, gasi skinuto, ne preživi launcher", sam: true },
  { ime: "proba-bez-servera", args: [], opis: "server se ugasi usred igranja: launcher igra dalje, zaključava, preživi restart, server posle naplati", sam: true },
  { ime: "proba-nadogradnja-pin", args: [], opis: "servisni PIN preživljava nadogradnju launchera", sam: true },
  { ime: "proba-servisni-pin-server", args: [], opis: "servisni PIN se upisuje jednom u panelu i vazi na svim masinama, i bez servera", sam: true },
  { ime: "proba-veza", args: [], opis: "launcher preživljava otkucaj servera i sam se vraća", sam: true },
  { ime: "proba-pokretanje-igre", args: [], opis: "klik na igru stiže do baze, izveštaja i logova", sam: true },
  { ime: "proba-pokretanje-van-kataloga", args: [], opis: "most odbija pokretanje van kataloga (cmd.exe, powershell)", sam: true },
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
  // VIP i točak se pale, i jedan gost dobija članarinu. Inače se kartica meri u
  // stanju u kom je vlasnik nikad neće videti - isključena, praznih brojki i bez
  // ijednog upozorenja - pa se ne vidi ni da li se brojke lome ni da li dugačko
  // objašnjenje gura polje iz reda.
  await api("/api/vip", "POST", { ukljucen: true, cena: 1500, dana: 30, xpMnozilac: 2, tocakPrag: 700 });
  await api("/api/tocak", "POST", { ukljucen: true, prag: 1200 });
  for (const [u, ime] of [["marko", "Marko"], ["nikola", "Nikola"]]) {
    await api("/api/players", "POST", { username: u, password: u + "1234", displayName: ime, balance: 1500 });
  }
  const igraci = JSON.parse(await api("/api/players").catch(() => "[]") || "[]");
  if (igraci[0]) await api(`/api/players/${igraci[0].id}/vip`, "POST", { dana: 30, naplati: 1500 });

  // Porudžbine se mere sa sadržajem, ne u praznom stanju; jedna je od VIP gosta
  // (zlatna oznaka, prva u spisku). Artikli se dodaju samo ako ih nema, jer nova
  // baza već nosi fabrički sank.
  let artikli = JSON.parse(await api("/api/shop").catch(() => "[]") || "[]");
  if (!artikli.length) {
    for (const [ime, cena, kat] of [["Coca-Cola 0.5", 130, "Sokovi"], ["Red Bull", 300, "Energetsko"],
      ["Čips paprika", 180, "Grickalice"], ["Espreso", 120, "Topli napici"]]) {
      await api("/api/shop", "POST", { name: ime, price: cena, category: kat, stock: 25 });
    }
    artikli = JSON.parse(await api("/api/shop").catch(() => "[]") || "[]");
  }
  if (artikli.length >= 2 && igraci.length >= 2) {
    await api("/api/pos", "POST", { playerId: igraci[0].id, payment: "cash",
      items: [{ id: artikli[0].id, qty: 2 }, { id: artikli[1].id, qty: 1 }] });
    await api("/api/pos", "POST", { playerId: igraci[1].id, payment: "credit",
      items: [{ id: artikli[2].id, qty: 1 }], note: "bez leda" });
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

// Alati koji mere (`pregled-*`) i `proba-klikova` ispisuju rezultat i kad
// prođu: izmerene visine i praznine, obiđene ekrane i broj pregledanih elemenata.
for (const n of nalazi.filter((x) => x.ok && (x.naziv.startsWith("pregled-") || x.naziv.startsWith("proba-klikova")))) {
  const redovi = n.izlaz.split("\n").filter((l) => l.trim());
  if (redovi.length) console.log(`\n--- ${n.naziv} ---\n${redovi.join("\n")}`);
}

const pali = nalazi.filter((n) => !n.ok);
for (const n of pali) {
  console.log(`\n--- ${n.naziv} ---`);
  // Uz svaki PAO ide i ono što je ispisano odmah posle njega (izmerene vrednosti
  // zbog kojih je pao).
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
