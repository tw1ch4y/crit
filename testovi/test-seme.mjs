import path from "node:path";
import { pathToFileURL } from "node:url";
import { KOREN, brojac, citajIzvor } from "./_okruzenje.mjs";
// SEME ULAZNIH PORUKA
//
// Sve sto stigne sa racunara igraca prolazi kroz semu pre nego sto dotakne
// novac, vreme ili bazu. Ovde se seme proveravaju SAME, bez servera: da prave
// poruke launchera prolaze, da sve preko toga ne prolazi, i da greska nikad ne
// nosi vrednost (u odbijenoj poruci moze da stoji lozinka).
//
// Na kraju se proverava i da spisak sema prati launcher: nova poruka u
// launcheru bez seme bi na serveru bila tiho odbacena.

const { proveriKlijentskuPoruku, TIPOVI_KLIJENTA, SEME_HTTP, proveriTelo } =
  await import(pathToFileURL(path.join(KOREN, "server", "src", "seme.js")).href);
const b = brojac();
const prolazi = (m) => proveriKlijentskuPoruku(m).ok === true;
const pada = (m) => proveriKlijentskuPoruku(m).ok === false;

// ---- 1. ono sto pravi launcher salje mora da prodje ----
const prave = [
  { t: "login", username: "marko", password: "test1234" },
  { t: "logout" },
  { t: "hello" },
  { t: "heartbeat", mirovanje: 0 },
  { t: "heartbeat", mirovanje: 125 },
  { t: "unlock_pin", pin: "1234" },
  { t: "verify_pin", pin: "0000" },
  { t: "order", items: [{ id: 3, qty: 2 }], payment: "credit", poId: "1791000000000-abcd1234" },
  { t: "order", items: [{ id: 3, qty: 1 }], payment: "cash" },
  { t: "change_password", oldPassword: "stara", newPassword: "nova1234" },
  { t: "moja_tekstura", kljuc: "munje", jacina: "jako", kretanje: "talas" },
  { t: "moja_tekstura", kljuc: "kuca" },
  { t: "moj_profil", boja: "zlatna" },
  { t: "moj_profil", okvir: "nema" },
  { t: "tocak_spin" },
  { t: "game_start", gameId: 7 },
  { t: "game_start" },
  { t: "igra_ne_radi", igra: "APEX", razlog: "nema" },
  { t: "klijent_problem", vrsta: "ekran_pukao", opis: "Ekran launchera je pukao (crashed) - vraćam ga" },
  { t: "log_klijent", tekst: "Očišćeni tragovi prethodnog igrača" },
  { t: "sys_info", nics: [{ ip: "192.168.1.50", mac: "aa:bb:cc:dd:ee:01" }], fabrickiPin: false },
  { t: "sys_info", mac: "aa:bb:cc:dd:ee:01" },
  { t: "install_status", program: "Steam", state: "downloading", message: "Preuzimam instalaciju..." },
  { t: "nadogradnja_status", verzija: "2.47.0", state: "preuzimam", message: "Preuzimam nadogradnju..." },
  { t: "procesi_lista", zahtev: 4, spisak: [{ pid: 1234, ime: "chrome.exe", putanja: "C:\\Program Files\\chrome.exe", memorija: 123456, zasticen: false }] },
  { t: "procesi_lista", zahtev: 5, spisak: [], greska: "Popis procesa nije uspeo" },
  { t: "proces_ugasen", zahtev: 6, ok: true, ime: "game.exe" },
  { t: "proces_ugasen", zahtev: 7, ok: false, greska: "Neispravan PID" },
];
for (const m of prave) {
  const r = proveriKlijentskuPoruku(m);
  b.proveri(`prava poruka prolazi: ${m.t}${m.t === "order" ? " (" + m.payment + ")" : ""}`, r.ok, JSON.stringify(r.greske || r.razlog));
}

// ---- 2. oblik i nepoznat tip ----
for (const [naziv, m] of [["null", null], ["niz", []], ["broj", 5], ["tekst", "login"]]) {
  b.proveri(`odbija poruku koja nije objekat (${naziv})`, proveriKlijentskuPoruku(m).razlog === "oblik");
}
b.proveri("odbija nepoznat tip", proveriKlijentskuPoruku({ t: "daj_kredit", iznos: 1000 }).razlog === "nepoznata");
b.proveri("odbija poruku bez tipa", proveriKlijentskuPoruku({ username: "x" }).razlog === "nepoznata");
b.proveri("odbija tip koji nije tekst", proveriKlijentskuPoruku({ t: 123 }).razlog === "nepoznata");
b.proveri("ne prihvata nasledjena imena kao tip (__proto__, toString)",
  pada({ t: "toString" }) && pada({ t: "__proto__" }) && pada({ t: "constructor" }));

// ---- 3. STROGO: visak polja na vrhu poruke ----
const tocak = proveriKlijentskuPoruku({ t: "tocak_spin", index: 5, nagrada: { kredit: 1000 } });
b.proveri("tocak: poruka sa 'index'/'nagrada' se odbija cela", !tocak.ok && tocak.razlog === "neispravna", JSON.stringify(tocak));
b.proveri("tocak: greska kaze koja polja su visak", JSON.stringify(tocak.greske).includes("index") && JSON.stringify(tocak.greske).includes("nagrada"),
  JSON.stringify(tocak.greske));
b.proveri("otkucaj ne sme da nosi preostalo vreme", pada({ t: "heartbeat", mirovanje: 0, remainingSeconds: 99999 }));
b.proveri("otkucaj ne sme da nosi stanje kredita", pada({ t: "heartbeat", balance: 100000 }));
b.proveri("odjava ne nosi nista", pada({ t: "logout", playerId: 2 }));
b.proveri("prijava ne nosi id igraca", pada({ t: "login", username: "a", password: "b", playerId: 1 }));
b.proveri("porudzbina ne nosi ukupan iznos", pada({ t: "order", items: [{ id: 1, qty: 1 }], total: 1 }));

// ---- 4. tipovi i granice ----
b.proveri("prijava: ime mora da bude tekst", pada({ t: "login", username: 5, password: "x" }));
b.proveri("prijava: null se ne prihvata", pada({ t: "login", username: null, password: null }));
b.proveri("prijava: 50000 znakova se ne prihvata", pada({ t: "login", username: "x".repeat(50000), password: "y" }));
b.proveri("prijava: lozinka do 256 znakova prolazi", prolazi({ t: "login", username: "a", password: "p".repeat(256) }));
b.proveri("PIN mora da postoji", pada({ t: "unlock_pin" }));
b.proveri("PIN ne moze da bude objekat", pada({ t: "verify_pin", pin: { $gt: "" } }));
b.proveri("mirovanje ne moze da bude negativno", pada({ t: "heartbeat", mirovanje: -999 }));
b.proveri("mirovanje ne moze da bude tekst", pada({ t: "heartbeat", mirovanje: "tekst" }));
b.proveri("porudzbina: stavke moraju da budu niz", pada({ t: "order", items: "nije niz" }));
b.proveri("porudzbina: id stavke mora da bude ceo broj", pada({ t: "order", items: [{ id: "abc", qty: 1 }] }));
b.proveri("porudzbina: id 0 ili minus ne prolazi", pada({ t: "order", items: [{ id: 0 }] }) && pada({ t: "order", items: [{ id: -3 }] }));
b.proveri("porudzbina: stavka null ne prolazi", pada({ t: "order", items: [null] }));
b.proveri("porudzbina: najvise 160 redova", pada({ t: "order", items: Array.from({ length: 500 }, () => ({ id: 1, qty: 1 })) }));
b.proveri("porudzbina: nacin placanja samo kredit ili kes", pada({ t: "order", items: [{ id: 1 }], payment: "besplatno" }));
b.proveri("porudzbina: kolicina tekst ne prolazi", pada({ t: "order", items: [{ id: 1, qty: "puno" }] }));
b.proveri("igra: id igre mora da bude broj", pada({ t: "game_start", gameId: "ne-broj" }));
b.proveri("instalacija: nepoznato stanje ne prolazi", pada({ t: "install_status", program: "X", state: "hakovano" }));
b.proveri("mrezne kartice: ne niz se odbija", pada({ t: "sys_info", nics: "nije niz" }));
b.proveri("proces: zahtev mora da bude broj", pada({ t: "proces_ugasen", zahtev: "x", ok: true }));

// ---- 5. porudzbina: postojece ciscenje ostaje (cena UVEK iz baze) ----
const sCenom = proveriKlijentskuPoruku({ t: "order", items: [{ id: 4, qty: 1, price: 1, total: 1 }], payment: "credit" });
b.proveri("stavka sa poljem 'price' prolazi, ali bez njega", sCenom.ok && JSON.stringify(sCenom.poruka.items) === '[{"id":4,"qty":1}]',
  JSON.stringify(sCenom.poruka?.items));
b.proveri("odbacena polja su prijavljena", JSON.stringify(sCenom.odbacena) === '["items.0.price","items.0.total"]', JSON.stringify(sCenom.odbacena));
b.proveri("minus kolicina prolazi semu (server je svodi na 1)", prolazi({ t: "order", items: [{ id: 1, qty: -5 }] }));
b.proveri("prazna korpa prolazi semu (server kaze 'Prazna porudzbina')", prolazi({ t: "order", items: [] }));

// ---- 6. greska nikad ne nosi vrednost ----
const tajne = [
  { t: "login", username: "marko", password: { lozinka: "TAJNA-123" } },
  { t: "change_password", oldPassword: "TAJNA-123", newPassword: ["TAJNA-123"] },
  { t: "unlock_pin", pin: "TAJNA-123".repeat(10) },
];
b.proveri("ni jedna greska ne sadrzi poslatu lozinku ili PIN",
  tajne.every((m) => !JSON.stringify(proveriKlijentskuPoruku(m)).includes("TAJNA-123")),
  tajne.map((m) => JSON.stringify(proveriKlijentskuPoruku(m))).join(" | "));

// ---- 7. HTTP: po tipu, ne po vrednosti ----
const http = (sema, telo) => SEME_HTTP[sema].safeParse(telo).success;
b.proveri("dopuna: broj prolazi", http("dopuna", { amount: 500 }));
b.proveri("dopuna: tekst iz polja prolazi (opseg proverava servis)", http("dopuna", { amount: "abc" }) && http("dopuna", { amount: "150" }));
b.proveri("dopuna: objekat se odbija", !http("dopuna", { amount: { $gt: 0 } }));
b.proveri("dopuna: niz se odbija", !http("dopuna", { amount: [500] }));
b.proveri("gosti: 'pet' prolazi (servis svodi na broj)", http("gosti", { count: "pet", balance: 0 }));
b.proveri("komanda: samo poznate komande", http("komanda", { cmd: "shutdown" }) && !http("komanda", { cmd: "format c:" }));
b.proveri("grupna akcija: id racunara mora da bude broj", !http("grupnaAkcija", { ids: ["1; DROP"], action: "lock" }));
b.proveri("grupna akcija: nepoznata akcija se odbija", !http("grupnaAkcija", { ids: [1], action: "obrisi_sve" }));
b.proveri("status porudzbine: samo poznati statusi", !http("statusPorudzbine", { status: "placeno" }));
b.proveri("kasa: nacin placanja samo kes ili kredit", !http("kasa", { items: [{ id: 1 }], payment: "pokloni" }));
b.proveri("kasa: igrac kao broj ili niz cifara", http("kasa", { playerId: 4 }) && http("kasa", { playerId: "4" }) && !http("kasa", { playerId: "4 OR 1=1" }));
b.proveri("podesavanja: naziv kao objekat se odbija", !http("podesavanja", { cafeName: { x: 1 } }));
b.proveri("podesavanja: cena sa razmacima prolazi (servis cisti)", http("podesavanja", { ratePerHour: " 150 " }));
b.proveri("podesavanja: cena kao niz se odbija", !http("podesavanja", { ratePerHour: [120] }));
b.proveri("instalacija: samo http(s) link", http("instalacija", { name: "X", url: "https://x.rs/setup.exe" })
  && !http("instalacija", { name: "X", url: "file:///C:/Windows/System32/cmd.exe" })
  && !http("instalacija", { name: "X", url: "\\\\server\\share\\x.exe" }));
b.proveri("panel sme da posalje i polja koja ruta ne cita", http("instalacija", { id: 3, name: "Steam", url: "https://x.rs/a.exe", created_at: 1, ids: [1, 2] }));
b.proveri("prijava na panel: ime kao objekat se odbija", !http("prijava", { username: { $ne: "" }, password: "x" }));

// ---- 8. middleware vraca 400 JSON i prijavljuje bez vrednosti ----
let prijavljeno = null;
let odgovor = null;
const mw = proveriTelo(SEME_HTTP.dopuna, (req, greske) => { prijavljeno = greske; });
const res = { status(k) { this.k = k; return this; }, json(o) { odgovor = { k: this.k, o }; return this; } };
let dalje = false;
mw({ body: { amount: { tajna: "TAJNA-123" } } }, res, () => { dalje = true; });
b.proveri("middleware: neispravno telo ne ide dalje", !dalje);
b.proveri("middleware: odgovor je 400 sa porukom", odgovor?.k === 400 && typeof odgovor?.o?.error === "string", JSON.stringify(odgovor));
b.proveri("middleware: prijava kaze polje, ne vrednost", prijavljeno?.[0]?.polje === "amount" && !JSON.stringify(prijavljeno).includes("TAJNA"),
  JSON.stringify(prijavljeno));
dalje = false;
mw({ body: { amount: 100 } }, res, () => { dalje = true; });
b.proveri("middleware: ispravno telo ide dalje", dalje);

// ---- 9. spisak sema prati launcher i server ----
// Svaka poruka koju launcher salje mora da ima semu - inace je server odbacuje.
const izvori = [citajIzvor("client/main.js"), citajIzvor("client/renderer/js/launcher.js")];
const salje = new Set();
for (const izvor of izvori) {
  for (const m of izvor.matchAll(/(?:wsSend|toServer)\(/g)) {
    for (const t of izvor.slice(m.index, m.index + 220).matchAll(/t: "([a-z_]+)"/g)) salje.add(t[1]);
  }
}
const bezSeme = [...salje].filter((t) => !TIPOVI_KLIJENTA.includes(t));
b.proveri("launcher salje bar 15 vrsta poruka (provera stvarno cita izvor)", salje.size >= 15, [...salje].join(", "));
b.proveri("svaka poruka launchera ima semu", bezSeme.length === 0, `bez seme: ${bezSeme.join(", ")}`);

const svc = citajIzvor("server/src/service.js");
const telo = svc.slice(svc.indexOf("export function handleClientMessage"), svc.indexOf("// Igrac menja svoju pozadinu"));
const slucajevi = [...telo.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
const bezObrade = TIPOVI_KLIJENTA.filter((t) => !slucajevi.includes(t));
b.proveri("server obradjuje svaki tip koji sema pusta", slucajevi.length >= 15 && bezObrade.length === 0, `bez obrade: ${bezObrade.join(", ")}`);

await b.kraj();
