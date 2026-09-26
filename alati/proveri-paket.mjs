// Proverava paket za USB pokretanjem.
//
//   node alati/proveri-paket.mjs
//
// Diže server iz samog paketa i radi ono što igraonica radi prvog dana:
// otvara panel, traži katalog i preuzima svaku sliku koju baza pominje.
// Traje dvadesetak sekundi.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const KOREN = path.join(import.meta.dirname, "..");
const BREND = JSON.parse(fs.readFileSync(path.join(KOREN, "igraonica.json"), "utf8"));
const PAKET = path.join(path.dirname(KOREN), `${BREND.ime.toUpperCase().replace(/\s+/g, "-")}-ZA-IGRAONICU`);
const SRV = path.join(PAKET, "1 - SERVER (glavni racunar)");
// Drugi port, jer server igraonice može da radi na istom računaru.
const PORT = process.env.PORT || "8211";

const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

if (!fs.existsSync(SRV)) {
  console.error(`\nNema paketa na:\n  ${PAKET}\n`);
  console.error("Napravi ga prvo:  node napravi-paket.mjs\n");
  process.exit(1);
}

console.log(`\nPROVERA PAKETA\n  ${PAKET}\n`);

// Server se diže iz paketa, sa podacima iz paketa; ništa se ne uzima iz
// projekta.
const server = spawn(process.execPath, [path.join(SRV, "src", "index.js")], {
  env: { ...process.env, PORT, CRIT_DATA_DIR: path.join(SRV, "data") },
  stdio: ["ignore", "pipe", "pipe"], cwd: SRV,
});
let izlaz = "";
server.stdout.on("data", (d) => (izlaz += d));
server.stderr.on("data", (d) => (izlaz += d));
const ugasi = () => { try { server.kill(); } catch {} };
process.on("exit", ugasi);

let token = null;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/login`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }) });
    const j = await r.json();
    if (j.token) { token = j.token; break; }
  } catch {}
  await cekaj(250);
}
proveri("server iz paketa se diže", !!token, izlaz.split("\n").filter(Boolean).slice(-4).join(" | "));
if (!token) { ugasi(); console.log(`\n${prosao}/${prosao + pao} prošlo\n`); process.exit(1); }

const api = (p) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { authorization: "Bearer " + token } }).then((r) => r.json());
const stigla = async (u) => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${u}`);
    return r.status === 200 && (r.headers.get("content-type") || "").startsWith("image/");
  } catch { return false; }
};

// ---- KATALOG NIJE PRAZAN ----
const igre = await api("/api/games");
const alati = await api("/api/tools");
const shop = await api("/api/shop");
const comps = await api("/api/computers");
proveri(`igre u paketu (${igre.length})`, igre.length > 0, "paket bez igara je prazna polica");
proveri(`prečice u paketu (${alati.length})`, alati.length > 0);
proveri(`artikli u paketu (${shop.length})`, shop.length > 0);
proveri(`računari u paketu (${comps.length})`, comps.length > 0);

// ---- Svaka slika koju baza pominje se stvarno preuzima ----
const fali = [];
for (const g of igre) {
  if (!g.image) { fali.push(`omot: ${g.name}`); continue; }
  if (!(await stigla(g.image))) fali.push(`omot: ${g.name} (${g.image})`);
}
proveri("svaka igra ima omot koji se otvara", fali.length === 0, fali.join(", "));

const banerFali = [];
for (const g of igre.filter((x) => x.banner)) if (!(await stigla(g.banner))) banerFali.push(g.name);
proveri("baneri se otvaraju", banerFali.length === 0, banerFali.join(", "));

const piceFali = [];
for (const s of shop.filter((x) => x.image)) if (!(await stigla(s.image))) piceFali.push(s.name);
proveri("slike pića se otvaraju", piceFali.length === 0, piceFali.join(", "));

const poz = await api("/api/pozadine");
const pozSlike = Object.entries(poz.slike || {}).filter(([, v]) => v);
const pozFali = [];
for (const [k, v] of pozSlike) if (!(await stigla(v))) pozFali.push(k);
proveri(`pozadine ekrana (${pozSlike.length})`, pozFali.length === 0, pozFali.join(", "));

// ---- PANEL SE OTVARA, I TO U PRAVOJ VERZIJI ----
const verzija = JSON.parse(fs.readFileSync(path.join(KOREN, "server", "package.json"), "utf8")).version;
const strana = await fetch(`http://127.0.0.1:${PORT}/`);
const html = await strana.text();
proveri("panel se otvara", strana.status === 200 && /<title>/.test(html));
proveri(`panel nosi verziju ${verzija}`, html.includes(`?v=${verzija}`),
  (html.match(/style\.css\?v=[^"]*/) || ["nema"])[0]);

// Instaler mora da bude iste verzije kao i server - inače u igraonicu odlazi
// launcher koji ne odgovara panelu.
const cli = path.join(PAKET, "2 - LAUNCHER (racunari igraca)");
const setup = fs.existsSync(cli) ? fs.readdirSync(cli).find((f) => /^Crit Launcher Setup v.*\.exe$/i.test(f)) : null;
proveri("instaler je u paketu", !!setup, String(setup));
proveri(`instaler je verzija ${verzija}`, !!setup && setup.includes(`v${verzija}.exe`), String(setup));

// ---- SLIKE STOJE UZ BAZU ----
proveri("slike su u data/uploads", fs.existsSync(path.join(SRV, "data", "uploads")),
  "tu se kopiraju sa bazom i preživljavaju nadogradnju");
proveri("staro mesto je prazno", !fs.existsSync(path.join(SRV, "public", "uploads")),
  "inače paket nosi iste fajlove dvaput");

ugasi();
await cekaj(300);
console.log(`\n${prosao}/${prosao + pao} prošlo`);
console.log(pao ? "\nPaket NIJE spreman za igraonicu.\n" : "\nPaket je spreman za USB.\n");
process.exit(pao ? 1 : 0);
