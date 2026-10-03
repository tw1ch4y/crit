import path from "node:path";
import { pathToFileURL } from "node:url";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, panelKlijent, brojac } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// KOCNICA BRZINE NA WEBSOCKETU
//
// Racunar igraca moze da posalje hiljade poruka u sekundi. Server je jedan
// proces koji u isto vreme vodi naplatu za ceo lokal - jedan racunar ne sme da
// ga zaustavi. Prvo se kocnica proverava sama (sa laznim satom, bez cekanja),
// pa na pravom serveru: rafal, zatrpavanje, skupe poruke i ogromna poruka.

const PORT = 8211, BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
const b = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const brzina = await import(pathToFileURL(path.join(KOREN, "server", "src", "brzina.js")).href);
const { Kofa, KocnicaVeze, StrazaTokena, OGRANICENJA, PREKID_POSLE_ODBIJENIH } = brzina;

// ---- 1. kofa sa zetonima, lazni sat ----
let sad = 1_000_000;
const sat = () => sad;
const k = new Kofa({ kapacitet: 5, poSekundi: 2, sat });
let proslo = 0;
for (let i = 0; i < 10; i++) if (k.uzmi()) proslo++;
b.proveri("kofa pusti tacno rafal velicine kapaciteta", proslo === 5, String(proslo));
sad += 1000;
proslo = 0;
for (let i = 0; i < 10; i++) if (k.uzmi()) proslo++;
b.proveri("posle jedne sekunde dopuni se tacno poSekundi", proslo === 2, String(proslo));
sad += 60_000;
proslo = 0;
for (let i = 0; i < 10; i++) if (k.uzmi()) proslo++;
b.proveri("posle duge pauze ne preraste kapacitet", proslo === 5, String(proslo));
sad += 1000;
b.proveri("skupa poruka trosi vise zetona", k.uzmi(2) === true && k.uzmi(1) === false);
sad -= 5000; // sat skoci unazad
b.proveri("skok sata unazad ne puni kofu", k.uzmi(1) === false);

// ---- 2. kocnica jedne veze ----
sad = 2_000_000;
const kv = new KocnicaVeze({ sat });
let odbijeno = 0;
for (let i = 0; i < 100; i++) if (!kv.propustiSirovu().ok) odbijeno++;
b.proveri("zajednicka kofa odbije sve preko rafala", odbijeno === 100 - OGRANICENJA.sve.kapacitet, String(odbijeno));
const kv2 = new KocnicaVeze({ sat });
let promena = 0;
for (let i = 0; i < 10; i++) if (kv2.propustiTip("change_password").ok) promena++;
b.proveri("promena lozinke (scrypt) ima svoju, strozu granicu", promena === OGRANICENJA.change_password.kapacitet, String(promena));
b.proveri("ostale poruke nisu zahvacene tudjom granicom", kv2.propustiTip("heartbeat").ok && kv2.propustiTip("order").ok);
b.proveri("tip koji nije tekst ne obara kocnicu", kv2.propustiTip(undefined).ok && kv2.propustiTip({}).ok);
b.proveri("ime iz prototipa nije tip sa granicom", kv2.propustiTip("toString").ok && kv2.propustiTip("constructor").ok);
const kv3 = new KocnicaVeze({ sat });
let prekid = null;
for (let i = 0; i < OGRANICENJA.sve.kapacitet + PREKID_POSLE_ODBIJENIH + 5; i++) {
  const r = kv3.propustiSirovu();
  if (!r.ok && r.prekini && prekid === null) prekid = i;
}
b.proveri("veza se prekida tek posle uporne zloupotrebe", prekid === OGRANICENJA.sve.kapacitet + PREKID_POSLE_ODBIJENIH - 1, String(prekid));
const kv4 = new KocnicaVeze({ sat });
let prekinuto = false;
for (let krug = 0; krug < 30; krug++) {
  for (let i = 0; i < 20; i++) if (kv4.propustiSirovu().prekini) prekinuto = true;
  sad += 2000;
}
b.proveri("povremeni rafali (20 na 2 s) ne dovode do prekida", !prekinuto);

// ---- 3. straza tokena racunara ----
sad = 3_000_000;
const st = new StrazaTokena({ sat, doBlokade: 10, prozor: 60_000, trajanje: 300_000 });
let r;
for (let i = 0; i < 9; i++) r = st.promasaj("10.0.0.5");
b.proveri("devet promasaja jos ne blokira", !r.blokirana && st.blokirana("10.0.0.5") === 0);
r = st.promasaj("10.0.0.5");
b.proveri("deseti promasaj blokira adresu", r.blokirana && r.upravo && st.blokirana("10.0.0.5") === 300);
b.proveri("druga adresa nije zahvacena", st.blokirana("10.0.0.6") === 0);
sad += 299_000;
b.proveri("blokada traje koliko je zadato", st.blokirana("10.0.0.5") === 1);
sad += 2000;
b.proveri("posle isteka adresa je slobodna", st.blokirana("10.0.0.5") === 0);
for (let i = 0; i < 9; i++) { st.promasaj("10.0.0.7"); sad += 10_000; }
b.proveri("promasaji van prozora od minut se zaboravljaju", st.blokirana("10.0.0.7") === 0 && !st.promasaj("10.0.0.7").blokirana);

// ---- 4. pravi server ----
await podigniServer(radniFolder("brzina-data"), PORT);
const api = await panelKlijent(BASE);
await api("/api/players", "POST", { username: "pera", password: "pera1234", balance: 5000 });
const racunari = (await api("/api/computers")).body;

const spoji = (pc) => new Promise((res, rej) => {
  const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}&p=2`);
  const poruke = [];
  let zatvoren = null;
  w.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
  w.on("close", (kod) => { zatvoren = kod; });
  w.on("error", () => {});
  w.once("open", () => res({ w, poruke, zatvoren: () => zatvoren }));
  setTimeout(() => rej(new Error("veza nije otvorena")), 3000);
});
const dogadjaji = async (vrsta) => (await api(`/api/bezbednost?vrsta=${vrsta}&limit=50`)).body;

// 4a) rafal od 120 otkucaja: visak se odbaci, veza ostaje
const a = await spoji(racunari[0]);
await cekaj(200);
for (let i = 0; i < 120; i++) a.w.send(JSON.stringify({ t: "heartbeat", mirovanje: 0 }));
await cekaj(500);
b.proveri("posle rafala veza ostaje otvorena", a.w.readyState === 1 && a.zatvoren() === null, String(a.zatvoren()));
const brz = await dogadjaji("brzina_prekoracena");
b.proveri("prekoracenje je zabelezeno sa imenom racunara", brz.some((d) => d.racunar === racunari[0].name && d.nivo === "upozorenje"),
  JSON.stringify(brz.slice(0, 2)));
// kad se kofa dopuni, racunar radi normalno
await cekaj(1200);
a.poruke.length = 0;
a.w.send(JSON.stringify({ t: "login", username: "pera", password: "pera1234" }));
await cekaj(700);
b.proveri("posle smirivanja prijava radi", a.poruke.some((m) => m.t === "login_ok"), JSON.stringify(a.poruke.map((m) => m.t)));

// 4b) skupa poruka: "hello" (ceo katalog) ima svoju granicu
const h = await spoji(racunari[1]);
await cekaj(300);
h.poruke.length = 0;
for (let i = 0; i < 15; i++) h.w.send(JSON.stringify({ t: "hello" }));
await cekaj(800);
const katalozi = h.poruke.filter((m) => m.t === "welcome").length;
b.proveri("15 zahteva za katalog daje najvise onoliko koliko kofa pusta", katalozi === OGRANICENJA.hello.kapacitet, `${katalozi} kataloga`);
h.w.close();

// 4c) zatrpavanje bez prestanka: veza se prekida (1008)
const z = await spoji(racunari[2]);
await cekaj(200);
for (let i = 0; i < 600; i++) { try { z.w.send(JSON.stringify({ t: "heartbeat" })); } catch {} }
await cekaj(800);
b.proveri("racunar koji zatrpava server biva iskljucen (1008)", z.zatvoren() === 1008, String(z.zatvoren()));
const spam = await dogadjaji("veza_prekinuta_spam");
b.proveri("prekid je zabelezen kao kritican", spam.some((d) => d.racunar === racunari[2].name && d.nivo === "kriticno"), JSON.stringify(spam.slice(0, 1)));

// 4d) poruka veca od dozvoljene: veza se prekida, server zivi
const v = await spoji(racunari[3]);
await cekaj(200);
v.w.send(JSON.stringify({ t: "log_klijent", tekst: "x".repeat(600 * 1024) }));
await cekaj(600);
b.proveri("poruka od 600 KB prekida vezu (1009)", v.zatvoren() === 1009, String(v.zatvoren()));
b.proveri("prevelika poruka je zabelezena", (await dogadjaji("poruka_prevelika")).some((d) => d.racunar === racunari[3].name));

// 4e) za sve to vreme ostali rade: panel odgovara brzo, prijavljeni ima sesiju
const t0 = Date.now();
const snap = await api("/api/computers");
b.proveri("panel odgovara i posle zatrpavanja", snap.status === 200 && Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
b.proveri("sesija na prvom racunaru i dalje traje", snap.body.find((c) => c.id === racunari[0].id)?.status === "in_use",
  JSON.stringify(snap.body.find((c) => c.id === racunari[0].id)));

a.w.close();
await b.kraj();
