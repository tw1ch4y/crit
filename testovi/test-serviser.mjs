import path from "node:path";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, podigniServer, citajIzvor } from "./_okruzenje.mjs";
// SERVISER JE ODVOJEN OD VLASNIKA
//
// Tri uloge, odozdo nagore: radnik < vlasnik < serviser. Visa uvek sme sve sto
// sme niza, ali NIKO ne dira sebi ravnog ni viseg.
//
// Serviser postoji zbog dve stvari koje dolaze sa izdavanjem programa drugim
// igraonicama:
//   1. PODRSKA - kad vlasnik zaboravi lozinku ili se sam zakljuca, mora
//      postojati neko ko to razresi a da se baza ne dira rucno.
//   2. LICENCIRANJE (kasnije) - uslovi pod kojima program radi ne mogu da stoje
//      pod nalogom onoga na koga se odnose.
//
// Ovde se proverava ono sto se lako pokvari pri sledecoj izmeni: da vlasnik NE
// MOZE da ukloni servisera, da ne moze sebi da napravi nadredjenog, i - obrnuto
// - da serviser i dalje sme sve sto sme vlasnik. Prestroga podela je isto tako
// kvar: podrska koja ne moze da udje ne vredi nista.
const BASE = "http://127.0.0.1:8176";
const DATA = radniFolder("serviser-data");
await podigniServer(DATA, 8176);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const uloguj = async (u, p) => (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: u, password: p }) }).then((r) => r.json())).token;
const api = (t) => (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + t },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; } return { status: r.status, body: j }; });

// ---- 1) serviser se pravi SA GLAVNOG RACUNARA, ne iz panela ----
//
// Na svezoj instalaciji servisera nema, pa prvi ne moze da nastane kroz panel:
// neko bi morao vec da bude serviser da bi ga napravio. Koren poverenja je
// pristup samom racunaru na kom server radi.
const alat = (args) => new Promise((res) => {
  const p = spawn(process.execPath, [path.join(KOREN, "alati", "serviser.mjs"), ...args],
    { env: { ...process.env, CRIT_DATA_DIR: DATA }, stdio: ["ignore", "pipe", "pipe"] });
  let izlaz = ""; p.stdout.on("data", (d) => (izlaz += d)); p.stderr.on("data", (d) => (izlaz += d));
  p.on("close", (kod) => res({ kod, izlaz }));
});

let r = await alat([]);
proveri("na svezoj bazi nema servisera", /Nema serviserskog naloga/.test(r.izlaz), r.izlaz.slice(0, 120));
r = await alat(["servis", "kratka"]);
proveri("kratka lozinka se odbija", r.kod !== 0 && /bar 8 znakova/.test(r.izlaz), r.izlaz.slice(0, 120));
r = await alat(["servis", "ServisLozinka1"]);
proveri("alat pravi serviserski nalog", r.kod === 0 && /Napravljen serviserski nalog/.test(r.izlaz), r.izlaz.slice(0, 160));
r = await alat(["--ukloni", "servis"]);
proveri("poslednji serviser se ne uklanja bez upozorenja", r.kod !== 0 && /poslednji serviserski nalog/.test(r.izlaz),
  "bez ijednog takvog naloga podrska vise ne moze da udje");

const sTok = await uloguj("servis", "ServisLozinka1");
const S = api(sTok);
proveri("serviser se prijavljuje na isti panel", !!sTok);

const vTok = await uloguj("admin", "admin");
const V = api(vTok);

// ---- 2) SERVISER SME SVE STO SME I VLASNIK ----
// Prestroga podela je isto tako kvar: podrska koja ne moze nista ne vredi.
proveri("serviser vidi podesavanja", (await S("/api/settings")).status === 200);
proveri("serviser vidi logove", (await S("/api/logs")).status === 200);
proveri("serviser vidi rezervne kopije", (await S("/api/kopije")).status === 200);
proveri("serviser menja cenu", (await S("/api/settings", "POST", { ratePerHour: 150 })).status === 200);

// ---- 3) VLASNIK NE DIRA SERVISERA ----
// Ovo je cela poenta. Kad bi vlasnik mogao da ukloni serviserski nalog, podrska
// nema kako da udje onog dana kad se on sam zakljuca.
const spisak = (await V("/api/admins")).body;
const servis = spisak.find((a) => a.username === "servis");
proveri("vlasnik VIDI serviserski nalog", !!servis && servis.role === "serviser",
  "nalog sa pristupom tudjim podacima ne sme da bude sakriven od onoga ciji su podaci");

proveri("vlasnik ne moze da ukloni servisera",
  (await V(`/api/admins/${servis.id}`, "DELETE")).status === 400, "podrska bi ostala bez ulaza");
proveri("vlasnik ne moze da mu promeni lozinku",
  (await V(`/api/admins/${servis.id}/password`, "POST", { password: "provala123" })).status === 400);
const posle = (await V("/api/admins")).body.find((a) => a.username === "servis");
proveri("serviserski nalog je i dalje aktivan", posle?.aktivan === true, JSON.stringify(posle));
proveri("serviser i dalje moze da se prijavi", !!(await uloguj("servis", "ServisLozinka1")),
  "da mu je vlasnik promenio lozinku, ovde bi palo");

// Vlasnik ne sme ni sebi da napravi nadredjenog.
const pokusaj = await V("/api/admins", "POST", { username: "lazni-servis", password: "abc12345", role: "serviser" });
proveri("vlasnik ne moze da napravi servisera", pokusaj.status === 400, JSON.stringify(pokusaj.body));
proveri("takav nalog nije nastao", !(await S("/api/admins")).body.some((a) => a.username === "lazni-servis"));

// ---- 4) ...ali serviser moze ----
//
// Pravljenje ide do SVOJE uloge, menjanje samo ispod nje. Vlasnik sme da doda
// drugog vlasnika (igraonica sa dva gazde je normalna stvar), a serviser drugog
// servisera - ali nijedan posle ne sme da tog sebi ravnog ukloni.
proveri("serviser pravi drugog servisera",
  (await S("/api/admins", "POST", { username: "servis2", password: "DrugiServis1", role: "serviser" })).status === 200);
proveri("vlasnik sme da doda drugog vlasnika",
  (await V("/api/admins", "POST", { username: "suvlasnik", password: "suvlasnik1", role: "owner" })).status === 200,
  "igraonica sa dva gazde je normalna stvar");
proveri("serviser sme da dira vlasnika",
  (await S(`/api/admins/${spisak.find((a) => a.role === "owner").id}/password`, "POST", { password: "novaVlasnik1" })).status === 200,
  "vlasnik koji zaboravi lozinku mora nekako da je vrati");

// ---- 5) radnik ne moze nista od ovoga ----
await S("/api/admins", "POST", { username: "radnik", password: "radnik123", role: "staff" });
const R = api(await uloguj("radnik", "radnik123"));
proveri("radnik ne vidi spisak naloga", (await R("/api/admins")).status === 403);
proveri("radnik ne MENJA podesavanja", (await R("/api/settings", "POST", { ratePerHour: 999 })).status === 403,
  "citanje mu treba - panel iz njega uzima cenu i valutu - ali izmena ne");
proveri("radnik ne vidi logove", (await R("/api/logs")).status === 403);

// ---- 6) niko ne dira sebi ravnog ----
// Dva vlasnika u istoj igraonici ne smeju da se medjusobno iskljucuju.
await S("/api/admins", "POST", { username: "vlasnik2", password: "vlasnik123", role: "owner" });
const v2 = (await S("/api/admins")).body.find((a) => a.username === "vlasnik2");
const V2 = api(await uloguj("vlasnik2", "vlasnik123"));
const prviVlasnik = spisak.find((a) => a.role === "owner");
proveri("vlasnik ne dira drugog vlasnika",
  (await V2(`/api/admins/${prviVlasnik.id}`, "DELETE")).status === 400,
  "inace se dva vlasnika medjusobno iskljuce iz sopstvene igraonice");
proveri("...ali dira radnika",
  (await V2(`/api/admins/${(await S("/api/admins")).body.find((a) => a.username === "radnik").id}`, "DELETE")).status === 200);

// ---- 7) panel i izvor prate ista pravila ----
const app = citajIzvor("server/public/js/app.js");
proveri("panel zna za tri uloge", /RANG = \{ staff: 1, owner: 2, serviser: 3 \}/.test(app));
proveri("panel nudi serviserski nalog samo serviseru", /isServiser\(\) \? '<option value="serviser">/.test(app));
proveri("dugmad stoje samo nad nizim nalozima", /const smem = smemNad\(a\.role\);/.test(app));
proveri("serviserski nalog se VIDI na spisku", /održava program - postavlja se sa glavnog računara/.test(app),
  "sakriven nalog sa punim pristupom je obmana vlasnika");
const auth = citajIzvor("server/src/auth.js");
proveri("vlasnicka prava obuhvataju servisera", /requireOwner = traziRang\(RANG\.owner/.test(auth),
  "inace bi podrska ostala bez pola panela");

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
