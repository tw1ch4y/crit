// Otvara UI launchera u obicnom pregledacu, bez Electrona - za doradu izgleda.
// Kopira client/renderer u server/public/_proba i ubacuje lazni most ka Windows-u.
//
//   node pregled-launchera.mjs          napravi i ostavi
//   node pregled-launchera.mjs --obrisi skloni folder
//
// Zatim: pokreni server i otvori http://localhost:<port>/_proba/
// Podaci (igre, pica, alati) se povlace sa tog istog servera.
import fs from "node:fs";
import path from "node:path";
import { KOREN } from "./_okruzenje.mjs";
// Nivoi, boje imena i okviri se UZIMAJU iz programa, ne prepisuju ovde. Da
// pregled drzi svoju kopiju, pokazivao bi nivoe kojih vise nema - a bas se po
// njemu ocenjuje kako izgleda.
import { nivoZa, otkljucanoZa, BOJE_IMENA, OKVIRI } from "../server/src/nivoi.js";

const IZVOR = path.join(KOREN, "client", "renderer");
const CILJ = path.join(KOREN, "server", "public", "_proba");

if (process.argv.includes("--obrisi")) {
  fs.rmSync(CILJ, { recursive: true, force: true });
  console.log("obrisano: server/public/_proba");
  process.exit(0);
}

const MOST = `// Lazni most ka Electronu, samo za pregled izgleda.
(function () {
  const bez = () => {};
  window.crit = {
    getConfig: async () => ({ host: "", token: "pregled", configured: true }),
    saveConfig: async () => ({ ok: true }),
    resetConfig: async () => {},
    toServer: (m) => { console.log("[ka serveru]", m); },
    launchGame: async (g) => { console.log("[pokreni]", g); return { ok: true }; },
    openBrowser: (u) => console.log("[pregledac]", u),
    focusLauncher: bez, adminExit: bez, ready: bez,
    sysStats: async () => ({ cpu: 23, ram: 48, temp: 41 }),
    onNeedSetup: bez,
    onWsStatus: (f) => setTimeout(() => f({ connected: true }), 80),
    onHotkey: bez,
    onServerMsg: (f) => { window.__salji = f; },
    onBlokirano: bez, onGameError: bez,
  };
})();
`;

// Iskustvo izmisljenog igraca. Namerno je u sredini nekog nivoa: prazna i puna
// traka izgledaju dobro same po sebi, a greske se vide na pola.
//
//   node pregled-launchera.mjs --xp 0       zakljucano stanje ("Uskoro!")
//   node pregled-launchera.mjs --xp 32400   poslednji nivo, traka puna
const XP_PREGLED = (() => {
  const i = process.argv.indexOf("--xp");
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : 4200;
})();

// Isti oblik koji server salje launcheru (vipOd / profilIgraca u service.js).
// Racun nivoa se ne prepisuje - zove se onaj iz programa.
const vipZa = (xp) => {
  const n = nivoZa(xp);
  return { nivo: n.nivo, naziv: n.naziv, xp: n.uNivou, xpDo: n.poslednji ? null : n.zaSledeci,
    poslednji: n.poslednji, sledeci: n.sledeciNaziv, vip: n.nivo >= 5 };
};
const profilZa = (xp) => {
  const n = nivoZa(xp);
  return { username: "marko", ime: "Marko", clanOd: Date.now() - 240 * 24 * 3600 * 1000,
    nivo: n.nivo, naziv: n.naziv, xp: n.xp, uNivou: n.uNivou, zaSledeci: n.zaSledeci,
    doSledeceg: n.doSledeceg, poslednji: n.poslednji, sledeciNaziv: n.sledeciNaziv,
    sati: 96.5, poseta: 41, porudzbina: 63, omiljenaIgra: "Counter-Strike 2", omiljenaPuta: 28,
    izgled: { boja: "bela", okvir: "nema" }, otkljucano: otkljucanoZa(xp),
    boje: BOJE_IMENA, okviri: OKVIRI };
};

const PODACI = `// Puni launcher pravim podacima sa servera, kao da je igrac prijavljen.
(async () => {
  await new Promise((r) => setTimeout(r, 250));
  let t;
  const prijava = async () => t || (t = (await (await fetch("/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  })).json()).token);
  const uzmi = async (p) => (await fetch(p, { headers: { authorization: "Bearer " + (await prijava()) } })).json();
  const [shop, games, tools, poz, promo, tex] = await Promise.all([uzmi("/api/shop"), uzmi("/api/games"), uzmi("/api/tools"), uzmi("/api/pozadine"), uzmi("/api/promo"), uzmi("/api/tekstura")]);
  window.__salji({ t: "welcome", computer: { id: 7, name: "PC-07" },
    settings: { cafeName: "Crit", currency: "RSD", ratePerHour: 120 }, shop, games, tools, pozadine: poz.slike || {},
    tekstura: tex.izbor, promo: (promo || []).filter((x) => x.available) });
  window.__salji({ t: "login_ok", player: { id: 1, username: "marko", displayName: "Marko" },
    balance: 640, remainingSeconds: 19200, session: { id: 1, startedAt: Date.now() - 3600000 }, skoroIgrane: [],
    vip: ${JSON.stringify(vipZa(XP_PREGLED))}, profil: ${JSON.stringify(profilZa(XP_PREGLED))} });
})();
`;

fs.rmSync(CILJ, { recursive: true, force: true });
fs.cpSync(IZVOR, CILJ, { recursive: true });
fs.writeFileSync(path.join(CILJ, "pregled-most.js"), MOST, "utf8");
fs.writeFileSync(path.join(CILJ, "pregled-podaci.js"), PODACI, "utf8");

// Most mora PRE launcher.js, jer launcher odmah zove window.crit.getConfig().
const html = fs.readFileSync(path.join(IZVOR, "index.html"), "utf8")
  .replace('<script src="js/launcher.js"></script>',
    '<script src="pregled-most.js"></script>\n  <script src="js/launcher.js"></script>\n  <script src="pregled-podaci.js"></script>');
fs.writeFileSync(path.join(CILJ, "index.html"), html, "utf8");

console.log("Napravljeno: server/public/_proba");
console.log("Otvori: http://localhost:8095/_proba/   (ili port na kom radi server)");
console.log("Kad zavrsis: node pregled-launchera.mjs --obrisi");
