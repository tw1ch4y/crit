import path from "node:path";
import fs from "node:fs";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Promo baneri: kacenje, redosled, skrivanje, brisanje, i da launcheri odmah
// dobiju izmenu. Bez banera hero i dalje pokazuje izdvojenu igru.
const BASE = "http://127.0.0.1:8112", WSB = "ws://127.0.0.1:8112";
const DATA = radniFolder("promo-data");
await podigniServer(DATA, 8112);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
// Uploads folder je zajednicki sa projektom i drugim pokrenutim serverima.
// Snimi spisak na pocetku pa na kraju proveri samo NOVE fajlove - tako fajlovi
// tudjeg servera (npr. demo pregled) ne obaraju test.
const UPLOADS = path.join(KOREN, "server", "public", "uploads");
const prePromo = new Set(fs.readdirSync(UPLOADS));

const prijava = async (ko, l) => (await fetch(BASE + "/api/login", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ko, password: l }) }).then((r) => r.json())).token;
const token = await prijava("admin", "admin");
const zovi = (t) => async (p, m = "GET", b) => {
  const r = await fetch(BASE + p, { method: m,
    headers: { "content-type": "application/json", authorization: "Bearer " + t },
    body: b ? JSON.stringify(b) : undefined });
  const tx = await r.text(); let j; try { j = JSON.parse(tx); } catch { j = tx; }
  return { status: r.status, body: j };
};
const api = zovi(token);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

await api("/api/computers/bulk", "POST", { count: 2, prefix: "PC-" });

// ---- bez banera: klijent dobija prazan spisak ----
const poruke = [];
const comps = (await api("/api/computers")).body;
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
await cekaj(600);
const welcome = poruke.find((m) => m.t === "welcome");
proveri("welcome nosi promo polje", Array.isArray(welcome?.promo), JSON.stringify(welcome?.promo));
proveri("bez banera spisak je prazan", welcome.promo.length === 0);

// ---- dodavanje ----
const a = await api("/api/promo", "POST", { image: PNG, naziv: "Prvi" });
const b2 = await api("/api/promo", "POST", { image: PNG, naziv: "Drugi" });
const c = await api("/api/promo", "POST", { image: PNG, naziv: "Treci" });
proveri("baneri se kace", [a, b2, c].every((r) => r.status === 200 && /^\/uploads\/promo-/.test(r.body.image || "")), JSON.stringify([a, b2, c].map((r) => r.body.image)));
const napravljeni = [a, b2, c].map((r) => r.body.image);
proveri("fajlovi postoje na disku", napravljeni.every((u) => fs.existsSync(path.join(KOREN, "server", "public", u))));

let lista = (await api("/api/promo")).body;
proveri("spisak ima tri banera", lista.length === 3, String(lista.length));
proveri("redosled je po dodavanju", lista.map((p) => p.naziv).join(",") === "Prvi,Drugi,Treci", lista.map((p) => p.naziv).join(","));
proveri("svaki je vidljiv po difoltu", lista.every((p) => p.available === 1));

// ---- launcher odmah dobija ----
poruke.length = 0;
await api("/api/promo", "POST", { image: PNG, naziv: "Cetvrti" });
await cekaj(600);
const push = [...poruke].reverse().find((m) => m.t === "promo");
proveri("izmena stize launcheru odmah", !!push && push.promo.length === 4, JSON.stringify(push?.promo?.length));
proveri("klijent ne dobija skrivena polja", push.promo.every((p) => p.image && !("sort" in p)), JSON.stringify(push.promo[0]));

// ---- pomeranje ----
await api(`/api/promo/${c.body.id}/pomeri`, "POST", { smer: "gore" });
lista = (await api("/api/promo")).body;
proveri("pomeranje gore menja mesto sa prethodnim", lista.map((p) => p.naziv).join(",") === "Prvi,Treci,Drugi,Cetvrti", lista.map((p) => p.naziv).join(","));

await api(`/api/promo/${a.body.id}/pomeri`, "POST", { smer: "gore" });
lista = (await api("/api/promo")).body;
proveri("prvi ne moze jos gore", lista[0].naziv === "Prvi", lista.map((p) => p.naziv).join(","));

// ---- skrivanje ----
await api(`/api/promo/${b2.body.id}/vidljivost`, "POST", { vidljiv: false });
lista = (await api("/api/promo")).body;
proveri("skriven ostaje u panelu", lista.find((p) => p.id === b2.body.id).available === 0);
poruke.length = 0;
await cekaj(400);
const zaKlijenta = (await api("/api/promo")).body.filter((p) => p.available);
proveri("skriven ne ide igracu", zaKlijenta.length === 3 && !zaKlijenta.some((p) => p.naziv === "Drugi"), JSON.stringify(zaKlijenta.map((p) => p.naziv)));

// ---- brisanje ----
const zaBrisanje = a.body.image;
await api(`/api/promo/${a.body.id}`, "DELETE");
proveri("brisanje uklanja iz spiska", (await api("/api/promo")).body.length === 3);
proveri("fajl je obrisan sa diska", !fs.existsSync(path.join(KOREN, "server", "public", zaBrisanje)));

// ---- odbijanja ----
proveri("ne-slika se odbija", (await api("/api/promo", "POST", { image: "data:text/html;base64,PHA+eDwvcD4=" })).status === 400);
proveri("prazno se odbija", (await api("/api/promo", "POST", { image: "" })).status === 400);
proveri("brisanje nepostojeceg se odbija", (await api("/api/promo/99999", "DELETE")).status === 400);

// ---- radnik ne sme ----
await api("/api/admins", "POST", { username: "radnik", password: "radnik123", role: "staff" });
const apiRadnik = zovi(await prijava("radnik", "radnik123"));
proveri("radnik ne vidi promo", (await apiRadnik("/api/promo")).status === 403);
proveri("radnik ne moze da doda", (await apiRadnik("/api/promo", "POST", { image: PNG })).status === 403);
proveri("radnik ne moze da obrise", (await apiRadnik(`/api/promo/${c.body.id}`, "DELETE")).status === 403);

// ---- launcher: promo ima prednost, smenjivanje postoji ----
const izvor = citajIzvor("client/renderer/js/launcher.js");
// Okacen baner ide na mesto znaka kuce u vrhu pocetne; tocak ostaje desno.
proveri("promo preuzima vrh pocetne", /lista\.length\s*\n?\s*\?\s*`<div class="hero-promo"/.test(izvor));
proveri("bez banera u vrhu stoji znak kuce", izvor.includes('class="hb-logo" src="img/crit-logo.png"'));
proveri("jedan baner se ne smenjuje", /lista\.length < 2/.test(izvor));
proveri("smena se gasi van pocetne", /clearInterval\(promoTajmer\); promoTajmer = null;/.test(izvor));
const css = citajIzvor("client/renderer/css/launcher.css");
proveri("preko promo banera nema zastora", /\.hero\.promo::before,\s*\.hero\.promo::after \{ display: none; \}/.test(css));
proveri("launcher oznaci vrh kad je baner okacen", /class="hero \$\{lista\.length \? "promo" : ""\}"/.test(izvor));

// ---- pociscenje ----
for (const p of (await api("/api/promo")).body) await api(`/api/promo/${p.id}`, "DELETE");
const ostalo = fs.readdirSync(UPLOADS).filter((f) => !prePromo.has(f) && f.startsWith("promo-"));
proveri("test ne ostavlja svoje slike u projektu", ostalo.length === 0, JSON.stringify(ostalo));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
