import { radniFolder, podigniServer, citajIzvor, KOREN } from "./_okruzenje.mjs";
import { banerIgre, promoCrit } from "../server/src/banner.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";
// Uploads folder je zajednicki sa projektom i sa drugim pokrenutim serverima
// (slike se serviraju iz public/). Zato test gleda samo fajlove KOJE JE SAM
// napravio: snimi spisak na pocetku, pa na kraju proveri da nije ostao nijedan
// novi. Tako tudji fajlovi (npr. iz preview servera) ne obaraju test.
const UPLOADS = join(KOREN, "server", "public", "uploads");
const preFajlovi = new Set(readdirSync(UPLOADS));
// Privremeni baneri - CRIT promo i baneri igara, dok pravi dizajn ne stigne.
// Crtaju se kao SVG i pisu pravo u uploads (launcher ih prikazuje kao
// background-image, gde SVG ostaje ostar). Ovde se gleda da SVG bude ispravan,
// da ime igre ne moze da ga slomi, i da se dugmad u panelu ponasaju kako treba.
const BASE = "http://127.0.0.1:8131";
await podigniServer(radniFolder("baner-data"), 8131);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

// ---- oblik SVG-a ----
const bi = banerIgre("Counter-Strike 2");
proveri("baner igre je SVG", bi.startsWith("<svg") && bi.trimEnd().endsWith("</svg>"));
proveri("baner igre je 2800x400 (7:1)", bi.includes('width="2800"') && bi.includes('height="400"'));
// Baner NAMERNO ne nosi ime igre. Kad je igra izdvojena na vrhu pocetne,
// launcher preko banera vec ispisuje ime svojim slovima - da se ista rec ne bi
// pojavila dvaput jedna preko druge.
proveri("baner igre NE sadrzi ime igre", !bi.includes("COUNTER-STRIKE") && !/COUNTER-STRIKE 2/.test(bi),
  "inace bi hero ispisao ime dvaput");
const pc = promoCrit("Crit");
// 11:1 je odnos trake u vrhu pocetne levo od nagradnog tocka; na 7:1 bi baner
// stajao uklopljen u traku sa tamnim ivicama sa strane.
proveri("promo je SVG 2200x200 (11:1)", pc.startsWith("<svg") && pc.includes('width="2200"') && pc.includes('height="200"'));
proveri("promo ima CRIT", pc.includes(">CRIT<"));
proveri("promo ne ponavlja CRIT kao podnaslov", pc.includes("GAMING CENTAR") && (pc.match(/CRIT/g) || []).length <= 3,
  "kad se kuca zove Crit, podnaslov ne sme opet da bude CRIT");

// ---- baner ostaje ispravan bez obzira na ime ----
// Baner ne koristi ime, ali funkcija prima naziv - bilo koje ime (prazno,
// dugacko, sa < > &) mora da da isti ispravan SVG bez stranih oznaka.
for (const ime of ['', '   ', '<script>x</script>', 'A & B', "Prašak Ž&<>", "x".repeat(200)]) {
  const s = banerIgre(ime);
  const ispravan = s.startsWith("<svg") && s.trimEnd().endsWith("</svg>") && !s.includes("<script");
  proveri(`ime "${ime.slice(0, 16) || "(prazno)"}" daje ispravan SVG`, ispravan);
}

// ---- API: generisanje kroz panel ----
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// napravi par igara: jedna vec ima "pravi" baner (kao da ga je vlasnik okacio)
const g1 = (await api("/api/games", "POST", { name: "Test Igra", path: "C:\\games\\t1.lnk" })).body;
const g2 = (await api("/api/games", "POST", { name: "Druga", path: "C:\\games\\t2.lnk" })).body;

// per-igra dugme
const r1 = await api(`/api/games/${g1.id}/banner-auto`, "POST", {});
proveri("dugme pravi baner jednoj igri", r1.status === 200 && /\/uploads\/baner-igra-.*\.svg$/.test(r1.body.banner), JSON.stringify(r1.body));

// SVG se stvarno servira, i to kao image/svg+xml
const svgOdg = await fetch(BASE + r1.body.banner);
proveri("baner se servira kao SVG", svgOdg.status === 200 && /image\/svg\+xml/.test(svgOdg.headers.get("content-type") || ""),
  svgOdg.headers.get("content-type"));
const staraPutanja = r1.body.banner;

// ponovno generisanje brise stari generisani fajl (ne gomila uploads)
const r2 = await api(`/api/games/${g1.id}/banner-auto`, "POST", {});
proveri("novo generisanje daje novi fajl", r2.body.banner !== staraPutanja);
const stariJos = await fetch(BASE + staraPutanja);
proveri("stari generisani baner je obrisan", stariJos.status === 404, String(stariJos.status));

// bulk: pravi samo onima bez banera
const pre = (await api("/api/games")).body.filter((g) => !g.banner).length;
const rb = await api("/api/games/banneri-auto", "POST", {});
proveri("bulk javlja koliko je napravio", rb.body.koliko === pre, `javio ${rb.body.koliko}, bez banera bilo ${pre}`);
const posle = (await api("/api/games")).body.filter((g) => !g.banner).length;
proveri("posle bulk-a nijedna igra nije bez banera", posle === 0, `jos ${posle} bez banera`);

// bulk NE dira igru koja vec ima baner (ne gazi tudji rad)
const banerG1 = (await api("/api/games")).body.find((g) => g.id === g1.id).banner;
await api("/api/games/banneri-auto", "POST", {});
const banerG1Posle = (await api("/api/games")).body.find((g) => g.id === g1.id).banner;
proveri("bulk ne menja igru koja vec ima baner", banerG1 === banerG1Posle, `${banerG1} -> ${banerG1Posle}`);

// CRIT promo
const rp = await api("/api/promo/crit", "POST", {});
proveri("CRIT promo se pravi", rp.status === 200 && /\/uploads\/promo-crit-.*\.svg$/.test(rp.body.image), JSON.stringify(rp.body));
const promo = (await api("/api/promo")).body;
proveri("promo se pojavi u listi i vidljiv je", promo.some((p) => p.image === rp.body.image && p.available === 1));
proveri("promo se servira kao SVG", /image\/svg\+xml/.test((await fetch(BASE + rp.body.image)).headers.get("content-type") || ""));

// nepostojeca igra
const nem = await api("/api/games/999999/banner-auto", "POST", {});
proveri("baner nepostojece igre javlja 404", nem.status === 404, String(nem.status));

// ---- pociscenje ----
// Brisanje igre/promo preko API-ja unlink-uje i njihov fajl. Posle toga ne sme
// da ostane nijedan NOV baner koji je ovaj test napravio.
for (const g of (await api("/api/games")).body) await api(`/api/games/${g.id}`, "DELETE");
for (const p of (await api("/api/promo")).body) await api(`/api/promo/${p.id}`, "DELETE");
const noviLeftover = readdirSync(UPLOADS)
  .filter((f) => !preFajlovi.has(f) && /^(baner-igra|promo-crit)-/.test(f));
proveri("test ne ostavlja svoje banere u projektu", noviLeftover.length === 0, JSON.stringify(noviLeftover));

// ---- panel ima dugmad ----
const app = citajIzvor("server/public/js/app.js");
proveri("panel: bulk dugme za banere", app.includes('id="banneriAuto"') && app.includes("/games/banneri-auto"));
proveri("panel: baner oznaka je i dugme", app.includes('data-game="baner"') && app.includes("/banner-auto"));
proveri("panel: dugme za CRIT promo", app.includes('id="promoCrit"') && app.includes("/promo/crit"));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
