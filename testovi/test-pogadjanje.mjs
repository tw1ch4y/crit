import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Kocnica protiv pogadjanja lozinki. Igraci sede na istoj mrezi kao server, pa
// bez ovoga nalog osoblja ili tudji nalog sa kreditom moze da se mlati hiljadama
// pokusaja u sekundi. Vazi za panel, za prijavu igraca i za PIN osoblja.
const BASE = "http://127.0.0.1:8114", WSB = "ws://127.0.0.1:8114";
const DATA = radniFolder("pogadjanje-data");
await podigniServer(DATA, 8114);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const prijaviSe = (ko, lozinka) => fetch(BASE + "/api/login", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ko, password: lozinka }) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const token = (await prijaviSe("admin", "admin")).body.token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => { const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; });

// ---- PANEL: peti promasaj zakljucava ----
const odgovori = [];
for (let i = 0; i < 4; i++) odgovori.push((await prijaviSe("admin", "netacna")).status);
proveri("prva cetiri promasaja vracaju 401", odgovori.every((s) => s === 401), JSON.stringify(odgovori));

// Pauza se javlja odmah na pokusaju koji je zakljucava, ne tek na sledecem.
const peti = await prijaviSe("admin", "netacna");
proveri("peti pokusaj zakljucava sa 429", peti.status === 429, JSON.stringify(peti));
proveri("poruka kaze koliko da se ceka", /Sačekajte \d+ s/.test(peti.body.error || ""), peti.body.error);

// Dok traje pauza ne prolazi ni tacna lozinka - inace bi kocnica bila ukras.
const tacnaUPauzi = await prijaviSe("admin", "admin");
proveri("ni tacna lozinka ne prolazi dok traje pauza", tacnaUPauzi.status === 429, JSON.stringify(tacnaUPauzi.status));

// Drugi nalog sa iste masine ima svoj racun - jedan zakljucan nalog ne sme da
// zakljuca ceo panel.
const drugi = await prijaviSe("nepostojeci", "bilosta");
proveri("drugi nalog nije zahvacen pauzom", drugi.status === 401, JSON.stringify(drugi.status));

// ---- uspesna prijava brise brojac ----
// cetiri promasaja (ispod praga), pa tacna lozinka, pa opet cetiri - ako brojac
// nije obrisan, ovde bi vec pala pauza.
const svez = "radnik" + Date.now();
await api("/api/admins", "POST", { username: svez, password: "radnik1234", role: "staff" });
for (let i = 0; i < 4; i++) await prijaviSe(svez, "netacna");
proveri("tacna lozinka prolazi posle cetiri promasaja", (await prijaviSe(svez, "radnik1234")).status === 200);
const posleCiscenja = [];
for (let i = 0; i < 4; i++) posleCiscenja.push((await prijaviSe(svez, "netacna")).status);
proveri("uspesna prijava je obrisala brojac", posleCiscenja.every((s) => s === 401), JSON.stringify(posleCiscenja));

// ---- IGRAC: ista kocnica preko WebSocketa ----
await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 500 });
await api("/api/players", "POST", { username: "jelena", password: "jela1234", balance: 500 });
const comps = (await api("/api/computers")).body;

const veza = async (comp) => {
  const poruke = [];
  const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comp.token)}`);
  w.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
  await new Promise((res, rej) => { w.once("open", res); w.once("error", rej); });
  await cekaj(300);
  poruke.length = 0;
  return { w, poruke };
};
// CEKA ODGOVOR, NE FIKSNIH 250 ms.
//
// Dok je stajala pauza, test je povremeno padao na "drugi racunar radi
// normalno" - ne zato sto kocnica ne radi, nego zato sto odgovor nije stigao za
// to vreme. Suite pusta vise servera uporedo, pa je 250 ms na opterecenom
// racunaru ponekad premalo.
//
// Test koji padne svaki deseti put je gori od nikakvog: nauci se da se ponovo
// pusti, pa se tako preskoci i pravi pad. Ovako je i brze - odgovor obicno
// stigne za desetak milisekundi.
const probaj = async (v, username, password) => {
  v.poruke.length = 0;
  v.w.send(JSON.stringify({ t: "login", username, password }));
  for (let i = 0; i < 200; i++) {
    const m = v.poruke.find((x) => x.t === "login_err" || x.t === "login_ok");
    if (m) return m;
    await cekaj(20);
  }
  return undefined;
};

const a = await veza(comps[0]);
const greske = [];
for (let i = 0; i < 4; i++) greske.push((await probaj(a, "marko", "netacna"))?.message);
proveri("prva cetiri promasaja igracu kazu pogresna lozinka",
  greske.every((m) => /Pogrešno korisničko ime/.test(m || "")), JSON.stringify(greske));

const petiIgrac = await probaj(a, "marko", "netacna");
proveri("peti pokusaj igraca zakljucava", /Previše pokušaja/.test(petiIgrac?.message || ""), JSON.stringify(petiIgrac));
proveri("ni tacna lozinka ne prolazi dok traje pauza",
  /Previše pokušaja/.test((await probaj(a, "marko", "test1234"))?.message || ""));

// Drugi racunar nije zahvacen - kocnica je po racunaru, ne po nalogu.
const b = await veza(comps[1]);
const naDrugom = await probaj(b, "marko", "test1234");
proveri("drugi racunar radi normalno", naDrugom?.t === "login_ok", JSON.stringify(naDrugom?.t));

// ---- uredna odbijanja se NE broje ----
// "vec ste prijavljeni na drugom racunaru" nije promasaj lozinke. Da se broji,
// igrac koji svaki dan uredno ulazi zavrsio bi zakljucan bez razloga.
const c = await veza(comps[2]);
const zauzet = [];
for (let i = 0; i < 6; i++) zauzet.push((await probaj(c, "marko", "test1234"))?.message);
proveri("vec prijavljen igrac se ne broji kao promasaj",
  zauzet.every((m) => /Već ste prijavljeni/.test(m || "")), JSON.stringify(zauzet));

const drugiNalog = await probaj(c, "jelena", "jela1234");
proveri("racunar i dalje prima ispravnu prijavu", drugiNalog?.t === "login_ok", JSON.stringify(drugiNalog?.t));

a.w.close(); b.w.close(); c.w.close();

// ---- izvor ----
const app = citajIzvor("server/public/js/app.js");
const service = citajIzvor("server/src/service.js");
const routes = citajIzvor("server/src/routes.js");

// Pogresna lozinka na panelu je ranije zvala doLogout(), koji zove /logout,
// koji bez tokena opet vraca 401 - petlja od nekoliko hiljada zahteva u sekundi
// koja je stajala tek kad se strana osvezi, i gutala pravu poruku o gresci.
proveri("sama odjava ne gadja prijavu i odjavu",
  /path !== "\/login" && path !== "\/logout"/.test(app), "api() bi opet mogao da udje u petlju");
proveri("sama odjava trazi da token uopste postoji", /res\.status === 401 && state\.token/.test(app));
proveri("doLogout ne zove server bez tokena", /if \(state\.token\) api\("\/logout"/.test(app));

proveri("kocnica je na jednom mestu", (service.match(/const promasaji = new Map/g) || []).length === 1);
proveri("PIN koristi istu kocnicu", service.includes("`pin:${computerId}`"));
proveri("prijava igraca koristi istu kocnicu", service.includes("`igrac:${computerId}`"));
proveri("panel koristi istu kocnicu", routes.includes("svc.kocnica.ceka(kljuc)"));
proveri("mapa promasaja se cisti da ne raste", service.includes("KOCNICA_ZABORAV"));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
