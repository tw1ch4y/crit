import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
// Sta se desi kad u polja udje glupost: prazno, minus, ogroman broj, tekst,
// HTML. Server mora da odbije ili da svede na razumno, nikad da pukne.
import fs from "node:fs";

const BASE = "http://127.0.0.1:8102";
const DATA = radniFolder("unosi-data");
await podigniServer(DATA, 8102);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
async function api(p, m = "GET", b) {
  const r = await fetch(BASE + p, { method: m,
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}

const zivServer = async () => (await api("/api/computers")).status === 200;

// ---- kredit ----
const p = (await api("/api/players", "POST", { username: "test", password: "test1234", balance: 500 })).body;
const stanje = async () => (await api(`/api/players?page=1&per=5&search=test`)).body.items[0].balance;

for (const [naziv, iznos] of [["tekst", "abc"], ["prazno", ""], ["nula", 0], ["null", null], ["NaN", "NaN"]]) {
  const r = await api(`/api/players/${p.id}/topup`, "POST", { amount: iznos });
  proveri(`dopuna "${naziv}" se odbija`, r.status === 400, JSON.stringify(r.body));
}
proveri("stanje nepromenjeno posle odbijenih", await stanje() === 500, String(await stanje()));

const veliki = await api(`/api/players/${p.id}/topup`, "POST", { amount: 1e308 });
proveri("beskonacan iznos ne pravi Infinity u bazi", Number.isFinite(await stanje()), String(await stanje()));

const previse = await api(`/api/players/${p.id}/topup`, "POST", { amount: -999999 });
proveri("ne moze da se skine vise nego sto ima", previse.status === 400, JSON.stringify(previse.body));

// ---- nalozi ----
const bezLoz = await api("/api/players", "POST", { username: "bezlozinke", password: "" });
proveri("nalog bez lozinke se odbija", bezLoz.status === 400, JSON.stringify(bezLoz.body));
const duplikat = await api("/api/players", "POST", { username: "test", password: "test1234" });
proveri("duplo korisnicko ime se odbija", duplikat.status === 400, JSON.stringify(duplikat.body));
const razmaci = await api("/api/players", "POST", { username: "   ", password: "test1234" });
proveri("ime od samih razmaka se odbija", razmaci.status === 400, JSON.stringify(razmaci.body));

// ---- shop ----
const minus = await api("/api/shop", "POST", { name: "Test minus", category: "Test", price: -500 });
const artikli = (await api("/api/shop")).body;
const nadjen = artikli.find((a) => a.name === "Test minus");
proveri("artikal sa negativnom cenom se ne pravi ili je cena >= 0",
  minus.status === 400 || !nadjen || nadjen.price >= 0,
  JSON.stringify({ status: minus.status, cena: nadjen?.price }));

// ---- gosti ----
for (const [naziv, br] of [["minus", -5], ["tekst", "pet"], ["ogroman", 1000]]) {
  const r = await api("/api/players/guests", "POST", { count: br, balance: 0 });
  const n = r.body?.players?.length;
  proveri(`brzi gost "${naziv}" daje razuman broj`, r.status === 200 && n >= 1 && n <= 10, `${r.status} / ${n}`);
}

// ---- podesavanja ----
const cenaMinus = await api("/api/settings", "POST", { ratePerHour: -100 });
const s = (await api("/api/settings")).body;
proveri("negativna cena po satu se ne primenjuje kao naplata unazad", Number(s.ratePerHour) >= 0, String(s.ratePerHour));
await api("/api/settings", "POST", { ratePerHour: 120 });

const idleTekst = await api("/api/settings", "POST", { idleMinutes: "abc" });
const s2 = (await api("/api/settings")).body;
proveri("nevalidno mirovanje ne obara server", Number.isFinite(Number(s2.idleMinutes)) || s2.idleMinutes === 0, String(s2.idleMinutes));
await api("/api/settings", "POST", { idleMinutes: 15 });

// ---- racunari ----
const bezImena = await api("/api/computers", "POST", { name: "" });
proveri("racunar bez imena se odbija", bezImena.status === 400, JSON.stringify(bezImena.body));
const nepostojeci = await api("/api/computers/99999/lock", "POST");
proveri("akcija nad nepostojecim racunarom ne obara server", nepostojeci.status < 500, String(nepostojeci.status));

// ---- smene ----
await api("/api/shift/open", "POST", { openingCash: 1000 });
const dupla = await api("/api/shift/open", "POST", { openingCash: 500 });
proveri("dve smene odjednom se odbijaju", dupla.status === 400, JSON.stringify(dupla.body));
await api("/api/shift/close", "POST", { closingCash: 1000 });
const praznaZatvara = await api("/api/shift/close", "POST", { closingCash: 0 });
proveri("zatvaranje bez otvorene smene se odbija", praznaZatvara.status === 400, JSON.stringify(praznaZatvara.body));

// ---- HTML u imenima ne sme da se vrati kao izvrsiv kod ----
const xss = await api("/api/players", "POST", { username: "<img src=x onerror=alert(1)>", password: "test1234" });
if (xss.status === 200) {
  const nadjenXss = (await api(`/api/players?page=1&per=50`)).body.items.find((i) => i.username.includes("<img"));
  proveri("opasno ime se cuva kao tekst, panel ga ekranira", !!nadjenXss, "nije nadjen");
} else proveri("opasno ime odbijeno na ulazu", true);

// ---- podesavanja: u bazu ide provereno, ne sirovo ----
// Ranije je provera radila nad Number(vrednost) a upisivala se sirova vrednost.
// ratePerHour: true je tako prolazilo kao ispravno i zavrsavalo kao NULL u bazi,
// a to tiho gasi naplatu svima - nijedna greska se ne prikaze, samo svi igraju
// dzabe dok neko ne primeti.
for (const losa of [[120], {}, [], { a: 1 }]) {
  const r = await api("/api/settings", "POST", { ratePerHour: losa });
  proveri(`cena po satu odbija ${JSON.stringify(losa)}`, r.status === 400, JSON.stringify(r.body));
}
const posleLosih = (await api("/api/settings")).body;
proveri("cena po satu je ostala upotrebljiv broj",
  Number.isFinite(Number(posleLosih.ratePerHour)) && Number(posleLosih.ratePerHour) > 0, JSON.stringify(posleLosih.ratePerHour));

await api("/api/settings", "POST", { ratePerHour: " 150 " });
const oCisceno = (await api("/api/settings")).body;
proveri("razmaci oko broja ne ulaze u bazu", Number(oCisceno.ratePerHour) === 150 && !/\s/.test(String(oCisceno.ratePerHour)),
  JSON.stringify(oCisceno.ratePerHour));

await api("/api/settings", "POST", { cafeName: "  Crit  ", unlockPin: " 4321 " });
const oTekst = (await api("/api/settings")).body;
proveri("naziv i PIN se cuvaju bez suvisnih razmaka",
  oTekst.cafeName === "Crit" && String(oTekst.unlockPin) === "4321", JSON.stringify({ n: oTekst.cafeName, p: oTekst.unlockPin }));
proveri("objekat kao naziv se odbija", (await api("/api/settings", "POST", { cafeName: { x: 1 } })).status === 400);
await api("/api/settings", "POST", { ratePerHour: 120, cafeName: "Crit", unlockPin: "1234" });

// ---- IZMENA katalога, ne samo dodavanje ----
// Dodavanje je bilo provereno, izmena nije. A vlasnik cesce menja nego sto
// dodaje: obrise ime da ga prekuca, sklizne mu se misem, i tako u bazu ude
// igra bez imena koja se u launcheru prikaze kao prazna plocica.
const igra = (await api("/api/games", "POST", { name: "Proba", path: "C:\\games\\proba.lnk" })).body;
for (const [sta, telo] of [
  ["bez imena", { name: "", path: "C:\\games\\proba.lnk" }],
  ["ime od samih razmaka", { name: "   ", path: "C:\\games\\proba.lnk" }],
  ["bez putanje", { name: "Proba", path: "" }],
]) {
  const r = await api(`/api/games/${igra.id}`, "PUT", telo);
  proveri(`izmena igre ${sta} se odbija`, r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
}
const igrePosle = (await api("/api/games")).body;
proveri("igra je zadrzala ime posle odbijenih izmena",
  igrePosle.find((g) => g.id === igra.id)?.name === "Proba",
  JSON.stringify(igrePosle.find((g) => g.id === igra.id)));

// Razmak ispred imena se ne vidi, a igra zbog njega skoci na pocetak police i
// postane "izdvojena" na pocetnoj strani. Tako je " Team Fortress 2" zavrsio
// kao naslovna igra u igraonici.
await api(`/api/games/${igra.id}`, "PUT", { name: "  Proba 2  ", path: " C:\\games\\proba.lnk " });
const posleRazmaka = (await api("/api/games")).body.find((g) => g.id === igra.id);
proveri("razmaci oko imena igre se seku", posleRazmaka?.name === "Proba 2", JSON.stringify(posleRazmaka?.name));
proveri("razmaci oko putanje se seku", posleRazmaka?.path === "C:\\games\\proba.lnk", JSON.stringify(posleRazmaka?.path));

const artikal = (await api("/api/shop", "POST", { name: "  Sok  ", category: "Pića", price: 100 })).body;
const nadjiArtikal = async () => (await api("/api/shop")).body.find((s) => s.id === artikal.id);
proveri("razmaci oko imena artikla se seku", (await nadjiArtikal())?.name === "Sok",
  JSON.stringify((await nadjiArtikal())?.name));
for (const [sta, telo] of [
  ["bez imena", { name: "", price: 100 }],
  ["ime od samih razmaka", { name: "  ", price: 100 }],
]) {
  const r = await api(`/api/shop/${artikal.id}`, "PUT", telo);
  proveri(`izmena artikla ${sta} se odbija`, r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
}
proveri("artikal je zadrzao ime posle odbijenih izmena", (await nadjiArtikal())?.name === "Sok",
  JSON.stringify((await nadjiArtikal())?.name));

// Izmena necega sto ne postoji je greska u pozivu, ne uspeh. Kad server na to
// kaze "ok", panel prikaze "Sacuvano" a nista nije sacuvano.
for (const [sta, put] of [["igre", "/api/games/999999"], ["artikla", "/api/shop/999999"], ["alata", "/api/tools/999999"]]) {
  const r = await api(put, "PUT", { name: "X", path: "C:\\x.lnk", target: "https://x.com", kind: "web", price: 1 });
  proveri(`izmena nepostojece ${sta} javlja gresku`, r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);
}

// ---- nijedan odgovor ne sme da bude stack trace ----
// Express na neuhvacenu gresku podrazumevano vrati HTML sa celim stack trace-om
// i apsolutnim putanjama fajlova. Panel to prikaze kao nerazumljivu bujicu
// teksta, a i nema razloga da se spolja vidi kako je server sastavljen.
const smece = [
  ["PUT", "/api/games/1", { name: 5, path: [], args: {}, category: null }],
  ["PUT", "/api/shop/1", { name: {}, price: "abc", stock: [] }],
  ["PUT", "/api/tools/1", { name: [], kind: 7, target: {} }],
  ["POST", "/api/games", { name: {}, path: {} }],
  ["POST", "/api/shop", { name: [], price: {} }],
  ["POST", "/api/players", { username: {}, password: [] }],
  ["POST", "/api/computers", { name: {} }],
  ["POST", "/api/settings", { ratePerHour: [], idleMinutes: {} }],
];
let hteloHtml = 0, htelo500 = 0;
for (const [m, put, telo] of smece) {
  const r = await api(put, m, telo);
  const jeHtml = typeof r.body === "string" && /<!DOCTYPE|<html/i.test(r.body);
  if (jeHtml) { hteloHtml++; console.log(`       ${m} ${put} -> HTML`); }
  if (r.status >= 500) { htelo500++; console.log(`       ${m} ${put} -> ${r.status}`); }
}
proveri("nijedan odgovor nije HTML sa stack trace-om", hteloHtml === 0, `${hteloHtml} od ${smece.length}`);
proveri("smece u poljima ne obara rutu", htelo500 === 0, `${htelo500} od ${smece.length} vratilo 5xx`);
proveri("postoji zastitna mreza za neuhvacene greske",
  citajIzvor("server/src/index.js").includes("Greška na serveru. Pokušaj ponovo"),
  "bez nje Express vrati HTML sa putanjama fajlova");

proveri("server je i dalje ziv posle svega", await zivServer());

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
