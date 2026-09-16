import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Verzija launchera po racunaru.
//
// Povod: igraonica ima 13 masina, jedna se ponasa drugacije od ostalih, a nigde
// ne pise koji je launcher gde instaliran. Bez toga se ne razlikuje "funkcija ne
// radi" od "na toj masini je stara verzija" - a to je razlika izmedju trazenja
// greske po kodu i jednog klika na instaler.
const BASE = "http://127.0.0.1:8121", WSB = "ws://127.0.0.1:8121";
await podigniServer(radniFolder("verzija-data"), 8121);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p) => fetch(BASE + p, { headers: { authorization: "Bearer " + token } }).then((r) => r.json());

const pc = (await api("/api/computers"))[0];
proveri("ima racunara za probu", !!pc);

// Launcher se javlja isto kao pravi: verzija ide uz adresu.
const spoji = (v) => new Promise((res) => {
  const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}` + (v == null ? "" : `&v=${encodeURIComponent(v)}`));
  w.once("open", () => res(w));
  w.once("error", () => res(null));
  setTimeout(() => res(null), 2500);
});
const verzijaSad = async () => (await api("/api/computers")).find((c) => c.id === pc.id)?.verzija;
const numeracijaSad = async () => (await api("/api/computers")).find((c) => c.id === pc.id)?.numeracija;

const a = await spoji("2.22.0");
await cekaj(400);
proveri("verzija stize do panela", (await verzijaSad()) === "2.22.0", `dobijeno: ${JSON.stringify(await verzijaSad())}`);
a?.close(); await cekaj(250);

// Launcher nove numeracije to javlja uz verziju, a panel mora da ga dobije -
// inače svaki launcher prikazuje kao "stari".
const n1 = await new Promise((res) => {
  const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}&v=2.22.0&n=1`);
  w.once("open", () => res(w)); w.once("error", () => res(null));
});
await cekaj(400);
proveri("numeracija stize do panela", (await numeracijaSad()) === 1, `dobijeno: ${JSON.stringify(await numeracijaSad())}`);
n1?.close(); await cekaj(250);

// Stariji launcher ne salje nista. To ne sme da obrise ono sto vec znamo -
// racunar se u medjuvremenu mogao samo restartovati, a poslednja poznata
// verzija je i dalje tacan podatak o tome sta je na njemu instalirano.
const b = await spoji(null);
await cekaj(400);
proveri("stariji launcher ne brise poznatu verziju", (await verzijaSad()) === "2.22.0",
  `dobijeno: ${JSON.stringify(await verzijaSad())}`);
b?.close(); await cekaj(250);

const c = await spoji("2.23.0");
await cekaj(400);
proveri("nadogradnja prepisuje staru verziju", (await verzijaSad()) === "2.23.0", `dobijeno: ${JSON.stringify(await verzijaSad())}`);
c?.close(); await cekaj(250);

// Verzija dolazi iz adrese, a adresu moze da sastavi bilo ko ko ima token.
const d = await spoji("x".repeat(500));
await cekaj(400);
const duga = (await verzijaSad()) || "";
proveri("predugacka verzija se odseca", duga.length <= 20, `duzina: ${duga.length}`);
d?.close(); await cekaj(250);

// ---- izvor ----
const main = citajIzvor("client/main.js");
const html = citajIzvor("client/renderer/index.html");
const launcher = citajIzvor("client/renderer/js/launcher.js");
const preload = citajIzvor("client/preload.js");
const panel = citajIzvor("server/public/js/app.js");
const db = citajIzvor("server/src/db.js");
const css = citajIzvor("client/renderer/css/launcher.css").replace(/\s+/g, " ");

proveri("launcher salje svoju verziju", main.includes('"&v=" + encodeURIComponent(app.getVersion())'));
proveri("verzija je dostupna i ekranu", preload.includes("verzija:") && main.includes('ipcMain.handle("verzija"'));
proveri("baza dobija kolonu bez brisanja podataka", db.includes('columnExists("computers", "launcher_version")'));
proveri("stara verzija se ne gazi praznim", citajIzvor("server/src/service.js").includes("launcher_version = COALESCE(?, launcher_version)"));
proveri("verzija pise u donjoj traci launchera", html.includes('id="sbVerzija"') && launcher.includes("upisiVerziju"));
proveri("u traci je tisa od ostalog", /\.sb-verzija \{[^}]*opacity/.test(css));
proveri("panel ima kolonu Launcher", panel.includes("<th>Launcher</th>"));
proveri("panel istice racunar koji zaostaje", panel.includes("const zaostao = najnovija"),
  "inace se rucno uporedjuje 13 redova");
proveri("prazno polje je objasnjeno", panel.includes("Launcher se nije javio ili ne javlja verziju"));
proveri("najnovija se trazi poredjenjem brojeva, ne teksta", panel.includes(".sort(porediVerzije)"),
  "kao tekst je 2.9.0 novije od 2.44.0");
proveri("launcher iz stare numeracije je oznacen", panel.includes("(stara)</span>"));

// ---- UPUTSTVO ZA OBILAZAK NE SME DA ZAOSTANE IZA KODA ----
//
// SLEDECI-KORACI.md se cita RUKOM, pred trinaest masina: u njemu pise koji se
// instaler pokrece i koja verzija mora da stoji u panelu posle toga. Dok se
// menjao rucno, zaostajao je - uputstvo je trazilo 2.45.0, a u paketu je stajao
// 2.49.0. Covek koji to zatekne ili prekuca pogresno ili pomisli da je uzeo
// pogresan paket, i to usred obilaska.
//
// Zato `verzija.mjs` sada menja i njega, a ovde se cuva da to stvarno radi.
const uputstvo = citajIzvor("SLEDECI-KORACI.md");
const nasa = JSON.parse(citajIzvor("server/package.json")).version;
const pomenute = [...new Set(uputstvo.match(/\d+\.\d+\.\d+/g) || [])];
proveri("uputstvo uopste pominje verziju", pomenute.length > 0,
  "ako vise ne pominje, ova provera nema sta da cuva - obrisi je");
proveri(`uputstvo nosi tekucu verziju (${nasa})`,
  pomenute.every((v) => v === nasa), `nadjeno: ${pomenute.join(", ")}`);
proveri("verzija.mjs menja i uputstvo",
  citajIzvor("verzija.mjs").includes("SLEDECI-KORACI.md"),
  "inace ce opet zaostati, samo sledeci put");

// Brojevi provera se u uputstvu ne zapisuju: zastare istog dana, a niko ih ne
// osvezava. Umesto toga stoji komanda koja ih sama ispise.
proveri("uputstvo ne tvrdi koliko ima provera",
  !/\d{3,} (automatske )?provere/.test(uputstvo) && uputstvo.includes("node testovi/pokreni-sve.mjs"),
  "upisan broj zastari istog dana");

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
