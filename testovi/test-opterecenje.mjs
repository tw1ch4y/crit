import { radniFolder, podigniServer, ucitajWebSocket } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Svih trinaest racunara odjednom: pravi WebSocket, pravi server i pravi upisi.
// Porudzbine nad istom zalihom, prijave i pokretanja u isto vreme, panel koji sve
// prima uzivo.
const PORT = 8185;
const BASE = `http://127.0.0.1:${PORT}`;
const WSB = `ws://127.0.0.1:${PORT}`;
const DATA = radniFolder("opterecenje-data");
await podigniServer(DATA, PORT);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (a, b, e = 0.5) => Math.abs(a - b) < e;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/shift/open", "POST", { openingCash: 5000 }).catch(() => {});
const racunari = await api("/api/computers");
proveri("igraonica ima 13 racunara", racunari.length === 13, String(racunari.length));

// Svaki racunar dobija svog igraca sa istim pocetnim kreditom.
const POCETNO = 5000;
const igraci = [];
for (let i = 0; i < racunari.length; i++) {
  const u = "gost" + i;
  await api("/api/players", "POST", { username: u, password: u + "1234", displayName: "Gost " + i });
  igraci.push(u);
}
const sviIgraci = await api("/api/players");
for (const p of sviIgraci) await api(`/api/players/${p.id}/topup`, "POST", { amount: POCETNO, note: "keš" });

// Jedan artikal sa TACNO odredjenom zalihom - da se vidi da li se prekoraci.
await api("/api/shop", "POST", { name: "Limenka", price: 100, category: "Sokovi", stock: 20 });
const artikal = (await api("/api/shop")).find((x) => x.name === "Limenka");

// ---- svih 13 se povezuje ----
const veze = [];
const primljeno = new Map();   // computerId -> [poruke]
function poveziKlijenta(pc) {
  const ws = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=opterecenje`);
  primljeno.set(pc.id, []);
  ws.on("message", (d) => { try { primljeno.get(pc.id).push(JSON.parse(d)); } catch {} });
  return new Promise((res, rej) => { ws.on("open", () => res(ws)); ws.on("error", rej); });
}
const t0 = Date.now();
for (const pc of racunari) veze.push(await poveziKlijenta(pc));
const vremePovezivanja = Date.now() - t0;
proveri("svih 13 launchera se povezalo", veze.length === 13 && veze.every((w) => w.readyState === 1));
proveri("povezivanje nije trajalo predugo", vremePovezivanja < 8000, `${vremePovezivanja} ms`);

// panel gleda uzivo, kao sto stvarno stoji otvoren ceo dan
const panel = new WebSocket(`${WSB}/ws?kind=panel&token=${token}&v=opterecenje`);
const panelPoruke = [];
panel.on("message", (d) => { try { panelPoruke.push(JSON.parse(d)); } catch {} });
await new Promise((r) => panel.on("open", r));
await cekaj(400);

// ---- svi se prijavljuju U ISTOM TRENUTKU ----
const t1 = Date.now();
veze.forEach((ws, i) => ws.send(JSON.stringify({ t: "login", username: igraci[i], password: igraci[i] + "1234" })));
await cekaj(2500);
const vremePrijava = Date.now() - t1;

const stanje = await api("/api/computers");
const uUpotrebi = stanje.filter((c) => c.status === "in_use").length;
proveri("svih 13 sesija je pokrenuto", uUpotrebi === 13, `${uUpotrebi} od 13`);
proveri("prijave su prosle za razumno vreme", vremePrijava < 6000, `${vremePrijava} ms`);
// Ko sedi za kojim racunarom stoji u snapshot-u (to je ono sto panel i crta),
// obican spisak racunara nosi samo stanje veze.
const snap = await api("/api/snapshot");
proveri("svaki racunar ima svog igraca",
  new Set(snap.computers.map((c) => c.player?.username).filter(Boolean)).size === 13,
  String(snap.computers.filter((c) => c.player).length));

// ---- 13 PORUDZBINA ODJEDNOM NAD ISTOM ZALIHOM ----
//
// Zaliha je 20, a trinaest racunara trazi po 2 komada = 26. Sest mora da bude
// odbijeno, a stanje ne sme u minus.
//
// Ovo cuva jednonitni server sa sinhronim upisom, ne transakcija (test prolazi
// i bez nje). Transakcije cuvaju od prekida nasred posla; to proverava
// test-jedan-posao.
veze.forEach((ws) => ws.send(JSON.stringify({ t: "order", items: [{ id: artikal.id, qty: 2 }], payment: "credit" })));
await cekaj(3000);

const posleArtikal = (await api("/api/shop")).find((x) => x.id === artikal.id);
proveri("zaliha nije otisla u minus", posleArtikal.stock >= 0, `stanje ${posleArtikal.stock}`);
const porudzbine = await api("/api/orders");
const prodato = porudzbine.reduce((z, o) => z + (o.items || []).reduce((s, i) => s + i.qty, 0), 0);
proveri("prodato nije vise nego sto je bilo na stanju", prodato <= 20, `prodato ${prodato} od 20`);
proveri("zaliha se poklapa sa prodatim", posleArtikal.stock === 20 - prodato,
  `stanje ${posleArtikal.stock}, prodato ${prodato}`);

// Bez ovoga bi test prolazio i da je vecina porudzbina pala iz nekog drugog
// razloga - onda ne bi dokazivao nista o trci nad zalihom.
proveri("zaliha je STVARNO iscrpljena do nule", posleArtikal.stock === 0 && prodato === 20,
  `stanje ${posleArtikal.stock}, prodato ${prodato} - trka se nije ni desila`);
const odbijenih = [...primljeno.values()].filter((p) => p.some((m) => m.t === "order_err")).length;
proveri("racunari koji nisu stigli su uredno odbijeni", odbijenih === 3,
  `${odbijenih} odbijeno; 13 racunara x 2 komada = 26 nad zalihom 20, znaci 10 prodje i 3 ne`);
const bezPoruke = [...primljeno.values()].filter((p) => !p.some((m) => m.t === "order_ok" || m.t === "order_err")).length;
proveri("svaki racunar je dobio odgovor", bezPoruke === 0,
  `${bezPoruke} racunara je ostalo bez odgovora - igrac bi gledao u prazno`);

// Naplata mora da se poklopi sa prometom: stanje = dopuna minus sve skinuto.
// Racuna se iz PROMETA, ne iz porudzbina - sesija se naplacuje po sekundi, pa
// se iznos menja dok test radi, a promet je zapis koji ostaje.
const igraciPosle = await api("/api/players");
let greskeNaplate = 0;
for (const p of igraciPosle) {
  const promet = await api(`/api/players/${p.id}/transactions`);
  const zbir = promet.reduce((z, t) => z + t.amount, 0);
  if (!blizu(p.balance, zbir, 1)) greskeNaplate++;
}
proveri("nijedan igrac nije naplacen dvaput", greskeNaplate === 0, `${greskeNaplate} igraca sa pogresnim stanjem`);
if (greskeNaplate && process.argv.includes("--detalji")) {
  const p = igraciPosle[0];
  const t = await api(`/api/players/${p.id}/transactions`);
  console.log("\n  DETALJI za", p.username, "stanje", p.balance);
  console.log("  porudzbine:", JSON.stringify(porudzbine.filter((o) => o.player === p.username).map((o) => o.total)));
  console.log("  promet:", JSON.stringify(t.map((x) => `${x.type}:${x.amount}`)));
  console.log("  racunari[0]:", JSON.stringify((await api("/api/computers"))[0]).slice(0, 300));
}

// ---- panel je sve to video ----
proveri("panel je dobio obavestenja o porudzbinama", panelPoruke.length > 10, String(panelPoruke.length));

// ---- POKRETANJA IGARA U RAFALU ----
// Klik na igru upisuje red. Trinaest racunara koji brzo menjaju igre je najgusci
// saobracaj koji server vidi.
await api("/api/games", "POST", { name: "Test igra", path: "C:\\g\\t.exe", category: "Igre" });
const igra = (await api("/api/games"))[0];
const t2 = Date.now();
for (let krug = 0; krug < 8; krug++) {
  veze.forEach((ws) => ws.send(JSON.stringify({ t: "game_start", gameId: igra.id })));
  await cekaj(120);
}
await cekaj(1500);
const vremeRafala = Date.now() - t2;
proveri("server je progurao rafal pokretanja", vremeRafala < 12000, `${vremeRafala} ms`);
proveri("server i dalje odgovara posle rafala", Array.isArray(await api("/api/computers")));

// ---- MREZA ZAPINJE USRED SMENE ----
// Sest racunara gubi vezu i vraca se. Sesija sme da se nastavi, ali NE sme da
// se naplati dvaput, niti da se izgubi.
const preKredit = Object.fromEntries((await api("/api/players")).map((p) => [p.username, p.balance]));
const paloIh = 6;
for (let i = 0; i < paloIh; i++) veze[i].terminate();
await cekaj(2500);
const uPadu = (await api("/api/computers")).filter((c) => c.online).length;
proveri("server je primetio da veza puca", uPadu <= 13 - paloIh + 1, `${uPadu} online`);

for (let i = 0; i < paloIh; i++) veze[i] = await poveziKlijenta(racunari[i]);
await cekaj(2500);
const posleVracanja = (await api("/api/computers")).filter((c) => c.online).length;
proveri("svi su se vratili na vezu", posleVracanja === 13, `${posleVracanja} online`);

const posleKredit = Object.fromEntries((await api("/api/players")).map((p) => [p.username, p.balance]));
let dvostruko = 0;
for (const u of Object.keys(preKredit)) {
  // Sesija se naplacuje po vremenu, pa kredit sme da padne - ali ne naglo za
  // ceo iznos jos jednom.
  if (posleKredit[u] < preKredit[u] - 200) dvostruko++;
}
proveri("prekid veze nije naplatio sesiju ponovo", dvostruko === 0, `${dvostruko} igraca naglo osiromasilo`);

// ---- SERVER JE JOS ZDRAV ----
const memorija = Math.round(process.memoryUsage().heapUsed / 1048576);
proveri("potrosnja memorije je razumna", memorija < 400, `${memorija} MB`);
const odziv0 = Date.now();
await api("/api/snapshot");
const odziv = Date.now() - odziv0;
proveri("panel se i dalje ucitava brzo", odziv < 1500, `${odziv} ms`);

const smena = await api("/api/shift");
proveri("obracun smene je i dalje ispravan", typeof smena?.totals?.revenue === "number", JSON.stringify(smena).slice(0, 120));

veze.forEach((w) => { try { w.close(); } catch {} });
try { panel.close(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(600);
process.exit(pao ? 1 : 0);
