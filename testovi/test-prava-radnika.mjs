import { radniFolder, podigniServer, ucitajWebSocket } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Sta radnik sme, a sta ne: dopune, kasa, smena i otkljucavanje da; pravila
// igraonice i vlasnicki nalog ne. Pravi se pravi radnicki nalog i kuca se na
// sve osetljive rute redom.
const BASE = "http://127.0.0.1:8163";
const DATA = radniFolder("prava-data");
await podigniServer(DATA, 8163);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const prijava = async (u, p) => (await fetch(BASE + "/api/login", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) }).then((r) => r.json()));

const vlasnikToken = (await prijava("admin", "admin")).token;
const kao = (t) => (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + t },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, telo: await r.json().catch(() => ({})) }));
const vlasnik = kao(vlasnikToken);

await vlasnik("/api/admins", "POST", { username: "pera", password: "pera1234", role: "staff" });
const p = await prijava("pera", "pera1234");
proveri("radnik moze da se prijavi", !!p.token, JSON.stringify(p).slice(0, 120));
const radnik = kao(p.token);
proveri("radnik je oznacen kao radnik", p.admin?.role === "staff", JSON.stringify(p.admin));

// ---- posao koji radnik MORA da moze ----
await vlasnik("/api/computers/bulk", "POST", { count: 2, prefix: "PC-" });
await vlasnik("/api/players", "POST", { username: "gost1", password: "gost1234", displayName: "Gost" });
const igrac = (await vlasnik("/api/players")).telo.find((x) => x.username === "gost1");
const pc = (await vlasnik("/api/computers")).telo[0];

for (const [ime, put, met, telo] of [
  ["otvori smenu", "/api/shift/open", "POST", { openingCash: 1000 }],
  ["dopuni kredit", `/api/players/${igrac.id}/topup`, "POST", { amount: 500, note: "keš" }],
  ["otkljuca racunar", `/api/computers/${pc.id}/unlock`, "POST", {}],
  ["posalje poruku", `/api/computers/${pc.id}/message`, "POST", { text: "Zdravo" }],
  ["vidi porudzbine", "/api/orders", "GET", null],
  ["proda na kasi", "/api/pos", "POST", { items: [], payment: "cash" }],
]) {
  const r = await radnik(put, met, telo);
  proveri(`radnik moze da ${ime}`, r.status !== 401 && r.status !== 403, `status ${r.status} ${JSON.stringify(r.telo).slice(0, 80)}`);
}

// ---- ono sto radnik NE SME ----
const zabranjeno = [
  ["napravi sebi vlasnicki nalog", "/api/admins", "POST", { username: "zika", password: "zika1234", role: "owner" }],
  ["obrise vlasnicki nalog", "/api/admins/1", "DELETE", null],
  ["promeni lozinku vlasniku", "/api/admins/1/password", "POST", { password: "novo1234" }],
  ["vidi spisak naloga", "/api/admins", "GET", null],
  ["promeni cenu po satu", "/api/settings", "POST", { ratePerHour: 1 }],
  ["ukljuci nagradni tocak", "/api/tocak", "POST", { ukljucen: true }],
  ["posalje instalaciju na racunare", "/api/install", "POST", { ids: [pc.id], name: "x", url: "http://x/y.exe" }],
];
for (const [ime, put, met, telo] of zabranjeno) {
  const r = await radnik(put, met, telo);
  proveri(`radnik NE MOZE da ${ime}`, r.status === 403, `status ${r.status} ${JSON.stringify(r.telo).slice(0, 80)}`);
}

// ---- podesavanja: radnik ne treba da zna da vlasnik ima fabricku lozinku ----
// Panel se otvara sa svakog telefona na mrezi. Poruka "vlasnik jos ima
// admin/admin" je uputstvo kako da mu se udje u nalog, a odatle se kredit
// upisuje bez ikakve kocnice.
const sV = (await vlasnik("/api/settings")).telo;
const sR = (await radnik("/api/settings")).telo;
proveri("vlasnik vidi upozorenje o fabrickoj lozinci", sV.fabrickaLozinka === true, JSON.stringify(sV));
proveri("radniku se to NE javlja", !sR.fabrickaLozinka,
  "radnik bi tako saznao da vlasnicki nalog ima pogodnu lozinku");
proveri("radnik i dalje dobija sto mu treba za posao", typeof sR.ratePerHour === "number" && !!sR.currency,
  JSON.stringify(sR));

// ---- token radnika prestaje da vazi kad se nalog obrise ----
const nalozi = (await vlasnik("/api/admins")).telo;
const pera = nalozi.find((a) => a.username === "pera");
await vlasnik(`/api/admins/${pera.id}`, "DELETE");
const posle = await radnik("/api/players");
proveri("obrisan radnik vise ne moze da radi", posle.status === 401,
  `status ${posle.status} - stari token bi i dalje radio`);

// ---- OTPUSTEN RADNIK ----
// Nalog se gasi, ne brise: smena koju je otvorio i dopune koje je upisao ostaju
// potpisane. Ugasen nalog i njegov token vise ne rade.
const spisak = (await vlasnik("/api/admins")).telo;
const ugasen = spisak.find((a) => a.username === "pera");
proveri("ugasen nalog se i dalje vidi vlasniku", !!ugasen,
  "vlasnik mora da zna ko je sve imao pristup");
proveri("oznacen je kao neaktivan", ugasen && ugasen.aktivan === false, JSON.stringify(ugasen));

const opet = await prijava("pera", "pera1234");
proveri("ugasen radnik ne moze vise da se prijavi", !opet.token, JSON.stringify(opet).slice(0, 100));

// istorija ostaje potpisana
const smene = (await vlasnik("/api/shifts")).telo;
const njegova = (Array.isArray(smene) ? smene : smene?.smene || []).find((s) => s.adminUsername === "pera" || s.admin === "pera");
proveri("smena koju je otvorio ostaje zapisana na njegovo ime", !!njegova,
  "bez toga obracun smene ostaje bez imena");

// vlasnik moze da ga vrati
await vlasnik(`/api/admins/${ugasen.id}/vrati`, "POST", {});
const vracen = await prijava("pera", "pera1234");
proveri("vlasnik moze da vrati radnika na posao", !!vracen.token, JSON.stringify(vracen).slice(0, 100));

// ---- VEC OTVOREN PANEL SE ZATVARA ----
// Token se proverava pri povezivanju. Bez ovoga bi otpusten radnik nastavio da
// gleda promet uzivo dok ne osvezi stranu.
const pera2 = await prijava("pera", "pera1234");
const ws = new WebSocket(`ws://127.0.0.1:8163/ws?kind=panel&token=${pera2.token}&v=proba`);
let zatvoren = false, poruka = "";
ws.on("message", (d) => { try { const m = JSON.parse(d); if (m.t === "error") poruka = m.message; } catch {} });
ws.on("close", () => (zatvoren = true));
await new Promise((r) => ws.on("open", r));
await cekaj(300);
proveri("radnik moze da otvori panel dok ima pristup", !zatvoren);

const peraOpet = (await vlasnik("/api/admins")).telo.find((a) => a.username === "pera");
await vlasnik(`/api/admins/${peraOpet.id}`, "DELETE");
await cekaj(600);
proveri("otvoren panel se zatvara cim se oduzme pristup", zatvoren,
  "inace bi nastavio da prima promet uzivo dok ne osvezi stranu");
proveri("i kaze mu se zasto", /oduzet/i.test(poruka), poruka || "(bez poruke)");

const opetWs = new WebSocket(`ws://127.0.0.1:8163/ws?kind=panel&token=${pera2.token}&v=proba`);
let odbijen = false;
opetWs.on("close", () => (odbijen = true));
await new Promise((r) => { opetWs.on("open", r); opetWs.on("error", r); });
await cekaj(500);
proveri("ne moze ni da se ponovo poveze", odbijen);
try { opetWs.close(); } catch {}

await vlasnik(`/api/admins/${peraOpet.id}/vrati`, "POST", {});

// nalog bez ijednog traga se brise skroz, da spisak ne skuplja prazne redove
await vlasnik("/api/admins", "POST", { username: "greska", password: "greska12", role: "staff" });
const gr = (await vlasnik("/api/admins")).telo.find((a) => a.username === "greska");
const rez = await vlasnik(`/api/admins/${gr.id}`, "DELETE");
proveri("nalog bez istorije se brise skroz", rez.telo?.obrisan === true, JSON.stringify(rez.telo));
proveri("i nestaje sa spiska", !(await vlasnik("/api/admins")).telo.some((a) => a.username === "greska"));

console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(400);
process.exit(pao ? 1 : 0);
