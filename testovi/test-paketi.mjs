import { radniFolder, podigniServer, citajIzvor } from "./_okruzenje.mjs";
// Vremenski paketi: jeftinije vreme kupljeno unapred (5h za 500). Igrač plati
// 500, dobije 5h (=600 kredita po satnici 120). Razlika 100 je popust. Ovde se
// gleda da novac koji uđe (500) uđe u pazar tačno, a popust ne naduva promet.
const BASE = "http://127.0.0.1:8135";
await podigniServer(radniFolder("paketi-data"), 8135);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const blizu = (a, b) => Math.abs(a - b) < 0.5;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });
const balance = async (id) => (await api(`/api/players?page=1&per=5&search=`)).items.find((x) => x.id === id)?.balance;

// ---- podrazumevani paket 5h/500 postoji ----
const paketi = await api("/api/paketi");
proveri("podrazumevani paket 5h/500 postoji", paketi.some((p) => p.hours === 5 && p.price === 500), JSON.stringify(paketi));
const p5 = paketi.find((p) => p.hours === 5);

// ---- prodaja paketa ----
const marko = await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 0 });
await api("/api/shift/open", "POST", { openingCash: 0 }); // da pazar smene meri
const prodaja = await api(`/api/players/${marko.id}/paket`, "POST", { paketId: p5.id });
proveri("prodaja vraća kredit i cenu", prodaja.ok && prodaja.cena === 500 && prodaja.kredit === 600, JSON.stringify(prodaja));
proveri("igraču je dodato 600 kredita (5h × 120)", blizu(await balance(marko.id), 600), String(await balance(marko.id)));

// ---- računovodstvo: 500 je pazar, 100 je popust (ne promet) ----
const tx = await api(`/api/players/${marko.id}/transactions`);
const topup = tx.find((t) => t.type === "topup");
const bonus = tx.find((t) => t.type === "bonus");
proveri("dopuna je tačno 500 (novac koji je ušao)", topup && blizu(topup.amount, 500), JSON.stringify(topup));
proveri("popust 100 je zaseban bonus, ne dopuna", bonus && blizu(bonus.amount, 100), JSON.stringify(bonus));

const s = await api("/api/stats?period=today");
proveri("izveštaj broji 500 kao dopunu, ne 600", blizu(s.revenue.topups, 500), String(s.revenue.topups));

// pazar smene = novac u kasi = 500 (ne 600)
const shift = await api("/api/shift");
proveri("pazar smene je 500, popust se ne broji", blizu(shift.totals.revenue, 500), JSON.stringify(shift.totals));

// ---- CRUD paketa (samo vlasnik) ----
const nov = await api("/api/paketi", "POST", { name: "10 sati", hours: 10, price: 900 });
proveri("vlasnik pravi novi paket", nov.ok, JSON.stringify(nov));
const izm = await api(`/api/paketi/${nov.id}`, "PUT", { name: "10 sati VIP", hours: 10, price: 850 });
proveri("izmena paketa radi", izm.ok, JSON.stringify(izm));
const posle = (await api("/api/paketi")).find((p) => p.id === nov.id);
proveri("izmena je sačuvana", posle.name === "10 sati VIP" && posle.price === 850, JSON.stringify(posle));
proveri("brisanje paketa radi", (await api(`/api/paketi/${nov.id}`, "DELETE")).ok);
proveri("obrisan paket više ne postoji", !(await api("/api/paketi")).some((p) => p.id === nov.id));

// ---- neispravni unosi ----
proveri("paket bez sati se odbija", (await api("/api/paketi", "POST", { name: "X", hours: 0, price: 100 })).error != null);
proveri("paket sa negativnom cenom se odbija", (await api("/api/paketi", "POST", { name: "X", hours: 2, price: -5 })).error != null);
proveri("izmena nepostojećeg paketa javlja grešku", (await api("/api/paketi/999999", "PUT", { name: "X", hours: 1, price: 1 })).error != null);
proveri("prodaja nepostojećeg paketa se odbija", (await api(`/api/players/${marko.id}/paket`, "POST", { paketId: 999999 })).error != null);

// ---- radnik ne sme da menja pakete, ali sme da prodaje ----
await api("/api/admins", "POST", { username: "radnik", password: "radnik123", role: "staff" });
const rtok = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "radnik", password: "radnik123" }) }).then((r) => r.json())).token;
const rapi = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + rtok }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.status);
proveri("radnik ne može da napravi paket", (await rapi("/api/paketi", "POST", { name: "X", hours: 1, price: 1 })) === 403);
proveri("radnik SME da proda paket (to mu je posao)", (await rapi(`/api/players/${marko.id}/paket`, "POST", { paketId: p5.id })) === 200);

// ---- izvor: panel i seed ----
const db = citajIzvor("server/src/db.js");
proveri("seed pravi podrazumevani paket 5h/500", db.includes('"5 sati", 5, 500'));
const app = citajIzvor("server/public/js/app.js");
proveri("panel prodaje pakete na dopuni", app.includes("/paket") && app.includes("paketId"));

proveri("server živ posle svega", Array.isArray((await api("/api/paketi"))));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
