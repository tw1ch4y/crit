import path from "node:path";
import fs from "node:fs";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Pozadine ekrana: vlasnik ih kaci kroz panel, launcheri ih dobijaju odmah,
// radnik ne sme da ih menja, a ime ekrana ne sme da izadje iz spiska.
const BASE = "http://127.0.0.1:8110", WSB = "ws://127.0.0.1:8110";
const DATA = radniFolder("pozadine-data");
await podigniServer(DATA, 8110);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const prijava = async (ko, lozinka) => (await fetch(BASE + "/api/login", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ko, password: lozinka }) }).then((r) => r.json())).token;
const token = await prijava("admin", "admin");
const zovi = (t) => async (p, m = "GET", b) => {
  const r = await fetch(BASE + p, { method: m,
    headers: { "content-type": "application/json", authorization: "Bearer " + t },
    body: b ? JSON.stringify(b) : undefined });
  const tx = await r.text(); let j; try { j = JSON.parse(tx); } catch { j = tx; }
  return { status: r.status, body: j };
};
const api = zovi(token);

// najmanji ispravan PNG (1x1)
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// ---- spisak ekrana ----
const spisak = (await api("/api/pozadine")).body;
const kljucevi = Object.keys(spisak.spisak);
proveri("nudi svih pet ekrana", kljucevi.length === 5, JSON.stringify(kljucevi));
proveri("ekrani su ocekivani",
  ["prijava", "pocetna", "shop", "nalog", "zakljucan"].every((k) => kljucevi.includes(k)), JSON.stringify(kljucevi));
proveri("na pocetku nema nijedne slike", Object.values(spisak.slike).every((v) => !v), JSON.stringify(spisak.slike));

// ---- kacenje ----
const r1 = await api("/api/pozadine/prijava", "POST", { image: PNG });
proveri("slika se kaci", r1.status === 200 && /^\/uploads\/pozadina-prijava-\d+\.png$/.test(r1.body.image || ""), JSON.stringify(r1.body));
const fajl = path.join(DATA, "uploads", path.basename(r1.body.image));
proveri("fajl stvarno postoji na disku", fs.existsSync(fajl));
proveri("dostupna je preko servera", (await fetch(BASE + r1.body.image)).status === 200);

// ---- launcher je dobija u welcome poruci ----
await api("/api/computers/bulk", "POST", { count: 2, prefix: "PC-" });
const comps = (await api("/api/computers")).body;
const poruke = [];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
await cekaj(600);
const welcome = poruke.find((m) => m.t === "welcome");
proveri("welcome nosi pozadine", !!welcome?.pozadine, JSON.stringify(Object.keys(welcome || {})));
proveri("prijava je u welcome poruci", welcome.pozadine.prijava === r1.body.image, JSON.stringify(welcome.pozadine));

// ---- promena stize odmah, bez restarta ----
poruke.length = 0;
const r2 = await api("/api/pozadine/shop", "POST", { image: PNG });
await cekaj(600);
const push = [...poruke].reverse().find((m) => m.t === "pozadine");
proveri("nova pozadina stize launcheru odmah", !!push, JSON.stringify(poruke.map((m) => m.t)));
proveri("push nosi obe slike", push?.pozadine.prijava && push?.pozadine.shop === r2.body.image, JSON.stringify(push?.pozadine));

// ---- zamena brise staru sliku ----
const stariFajl = fajl;
const r3 = await api("/api/pozadine/prijava", "POST", { image: PNG });
await cekaj(200);
proveri("zamena pravi novi fajl", r3.body.image !== r1.body.image, `${r1.body.image} -> ${r3.body.image}`);
proveri("stara slika je obrisana sa diska", !fs.existsSync(stariFajl));

// ---- uklanjanje ----
const r4 = await api("/api/pozadine/shop", "DELETE");
proveri("uklanjanje uspeva", r4.status === 200);
proveri("posle uklanjanja je prazno", !(await api("/api/pozadine")).body.slike.shop, JSON.stringify((await api("/api/pozadine")).body.slike));

// ---- odbijanja ----
proveri("nepoznat ekran se odbija", (await api("/api/pozadine/izmisljen", "POST", { image: PNG })).status === 400);
proveri("ne-slika se odbija", (await api("/api/pozadine/nalog", "POST", { image: "data:text/html;base64,PGgxPng8L2gxPg==" })).status === 400);
proveri("prazan sadrzaj se odbija", (await api("/api/pozadine/nalog", "POST", { image: "" })).status === 400);
// preko 8 MB: odbija se sa razumljivom porukom, ne grubom greskom parsera
// base64 dekodira na 3/4 duzine, pa za >8 MB slike treba ~11 MB teksta
const velika = "data:image/png;base64," + "A".repeat(11 * 1024 * 1024);
const rv = await api("/api/pozadine/nalog", "POST", { image: velika });
proveri("prevelika slika se odbija", rv.status === 400 || rv.status === 413, String(rv.status));
proveri("poruka o velicini je razumljiva", /prevelik|8 MB/i.test(JSON.stringify(rv.body)), JSON.stringify(rv.body));
const preko = "data:image/png;base64," + "A".repeat(20 * 1024 * 1024);
const rp = await api("/api/pozadine/nalog", "POST", { image: preko });
proveri("i mnogo veci fajl daje urednu poruku", rp.status === 413 && /8 MB/.test(JSON.stringify(rp.body)), rp.status + " " + JSON.stringify(rp.body));

// ---- radnik ne sme ----
await api("/api/admins", "POST", { username: "radnik", password: "radnik123", role: "staff" });
const apiRadnik = zovi(await prijava("radnik", "radnik123"));
proveri("radnik ne vidi pozadine", (await apiRadnik("/api/pozadine")).status === 403);
proveri("radnik ne moze da okaci", (await apiRadnik("/api/pozadine/pocetna", "POST", { image: PNG })).status === 403);
proveri("radnik ne moze da ukloni", (await apiRadnik("/api/pozadine/prijava", "DELETE")).status === 403);

// ---- launcher zna sta sa kojim ekranom ----
const izvor = citajIzvor("client/renderer/js/launcher.js");
proveri("launcher mapira ekrane na pozadine",
  /loginScreen: "prijava"/.test(izvor) && /lockedScreen: "zakljucan"/.test(izvor) &&
  /home: "pocetna", shop: "shop", account: "nalog"/.test(izvor));
proveri("pozadina se primenjuje pri promeni ekrana", /function show\(id\)[\s\S]{0,180}primeniPozadinu\(\)/.test(izvor));
proveri("pozadina se primenjuje pri promeni taba", /renderContent\(\);\s*\n\s*primeniPozadinu\(\);/.test(izvor));

const css = citajIzvor("client/renderer/css/launcher.css");
proveri("preko slike uvek ide tamni sloj", /\.pozadina::after/.test(css));

// Uploadovane slike idu u zajednicki server/public/uploads (odatle ih express
// servira), pa test mora sam da pocisti za sobom - inace bi punio projekat.
for (const k of ["prijava", "pocetna", "shop", "nalog", "zakljucan"]) {
  try { await api(`/api/pozadine/${k}`, "DELETE"); } catch {}
}
const ostalo = fs.readdirSync(path.join(KOREN, "server", "public", "uploads")).filter((f) => f.startsWith("pozadina-"));
proveri("test ne ostavlja slike u projektu", ostalo.length === 0, JSON.stringify(ostalo));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
