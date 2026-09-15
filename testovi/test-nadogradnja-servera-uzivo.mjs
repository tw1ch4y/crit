import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { KOREN, radniFolder, brojac } from "./_okruzenje.mjs";
import * as P from "../server/src/paket-servera.js";
// NADOGRADNJA SERVERA SA PANELA - UŽIVO
//
// Ceo put, bez prečica: pravi nadzornik drži kopiju servera, serviser otpremi
// paket preko panela i klikne "Nadogradi", a nadzornik zameni kod. Proverava se:
//
//   - vlasnik ne postavlja i ne pokreće; paket koji nije paket se odbija
//   - server se vraća sa NOVOM verzijom, novi kod je na disku, a podaci igraonice
//     su preživeli
//   - namerno pokvarena verzija (pukne pri pokretanju) se vraća SAMA na
//     prethodnu, i to piše u Logovima i u panelu
//
// Nadogradnja menja fajlove u folderu iz kog nadzornik radi, pa ovde radi nad
// KOPIJOM servera u .radno - pravi server/ se ne dira.
const { proveri, kraj } = brojac();
const PORT = 8221;
const BASE = `http://127.0.0.1:${PORT}`;
const RADNO = radniFolder("nadogradnja-servera-uzivo");
const SRV = path.join(RADNO, "server");
const DATA = path.join(RADNO, "data");
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const radi = (p) => !!p && p.exitCode === null && p.signalCode === null;
const ziv = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
async function sacekaj(fn, ms) {
  const doKad = Date.now() + ms;
  while (Date.now() < doKad) { if (await fn()) return true; await cekaj(400); }
  return false;
}
const zapis = () => { try { return fs.readFileSync(path.join(DATA, "nadzor.log"), "utf8"); } catch { return ""; } };
const zdravlje = async () => {
  try {
    const r = await fetch(BASE + "/api/zdravlje", { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

// ---- kopija servera ----
function kopiraj(sa, na, preskoci = new Set()) {
  fs.mkdirSync(na, { recursive: true });
  for (const e of fs.readdirSync(sa, { withFileTypes: true })) {
    if (preskoci.has(e.name)) continue;
    const s = path.join(sa, e.name), d = path.join(na, e.name);
    if (e.isDirectory()) kopiraj(s, d); else fs.copyFileSync(s, d);
  }
}
const postaviVerziju = (folder, v) => {
  const p = path.join(folder, "package.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.version = v;
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
};
fs.mkdirSync(SRV, { recursive: true });
for (const f of ["package.json", "nadzornik.mjs"]) fs.copyFileSync(path.join(KOREN, "server", f), path.join(SRV, f));
kopiraj(path.join(KOREN, "server", "src"), path.join(SRV, "src"));
kopiraj(path.join(KOREN, "server", "node_modules"), path.join(SRV, "node_modules"));
kopiraj(path.join(KOREN, "server", "public"), path.join(SRV, "public"), new Set(["uploads", "_proba"]));
postaviVerziju(SRV, "9.9.0");

const NOVA = path.join(RADNO, "nova");
kopiraj(SRV, NOVA);
postaviVerziju(NOVA, "9.9.1");
fs.writeFileSync(path.join(NOVA, "src", "znak-nove-verzije.txt"), "9.9.1");
const paketNove = P.napraviPaket(NOVA);

// Pokvarena verzija: paket je ispravan, ali server pukne pri pokretanju - baš
// onaj kvar koji se u panelu ne vidi dok se ne pusti.
const LOSA = path.join(RADNO, "losa");
kopiraj(SRV, LOSA);
postaviVerziju(LOSA, "9.9.2");
const indexLose = path.join(LOSA, "src", "index.js");
fs.writeFileSync(indexLose, 'throw new Error("namerno pokvarena verzija za probu");\n' + fs.readFileSync(indexLose, "utf8"));
const paketLose = P.napraviPaket(LOSA);

// ---- nadzornik ----
const procesi = [];
function nadzornik() {
  const p = spawn(process.execPath, [path.join(SRV, "nadzornik.mjs")], {
    env: { ...process.env, CRIT_DATA_DIR: DATA, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  p.izlaz = "";
  p.stdout.on("data", (d) => (p.izlaz += d));
  p.stderr.on("data", (d) => (p.izlaz += d));
  p.gotov = new Promise((r) => p.once("exit", (kod) => r(kod)));
  procesi.push(p);
  return p;
}
const uloguj = async (u, l) => (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: u, password: l }) }).then((r) => r.json()).catch(() => ({}))).token;
const api = (tok, p, m = "GET", body, sirovo = false) => fetch(BASE + "/api" + p, {
  method: m,
  headers: { authorization: "Bearer " + tok, "content-type": sirovo ? "application/octet-stream" : "application/json" },
  body: sirovo ? body : body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

let n = null;
try {
  n = nadzornik();
  proveri("nadzornik diže kopiju servera", await sacekaj(async () => (await zdravlje())?.verzija === "9.9.0", 40000), n.izlaz.slice(-400));

  const alat = spawn(process.execPath, [path.join(KOREN, "alati", "serviser.mjs"), "servis", "ServisLozinka1"],
    { env: { ...process.env, CRIT_DATA_DIR: DATA }, stdio: "ignore" });
  await new Promise((r) => alat.on("close", r));
  let sTok = await uloguj("servis", "ServisLozinka1");
  let vTok = await uloguj("admin", "admin");

  // Podatak koji mora da preživi nadogradnju.
  await api(vTok, "/players", "POST", { username: "stalni", password: "stalni1234", displayName: "Stalni" });

  // ---- 1) PAKET ----
  let r = await api(vTok, "/nadogradnja-servera");
  proveri("panel vidi verziju i da server drži nadzornik", r.status === 200 && r.body.trenutna === "9.9.0" && r.body.podNadzorom === true,
    JSON.stringify(r.body));
  r = await api(vTok, "/nadogradnja-servera/paket", "PUT", paketNove, true);
  proveri("vlasnik ne postavlja paket servera", r.status === 403);
  r = await api(sTok, "/nadogradnja-servera/paket", "PUT", Buffer.from("smece koje nije paket"), true);
  proveri("fajl koji nije paket se odbija", r.status === 400 && /nije paket/i.test(r.body.error || ""), JSON.stringify(r.body));
  proveri("i ne ostaje na serveru", (await api(vTok, "/nadogradnja-servera")).body.paket === null);
  r = await api(sTok, "/nadogradnja-servera/paket", "PUT", paketNove, true);
  proveri("serviser postavlja paket i server ga proveri", r.status === 200 && r.body.paket?.ispravan === true &&
    r.body.paket.verzija === "9.9.1" && r.body.paket.noviji === true, JSON.stringify(r.body));

  // ---- 2) NADOGRADNJA ----
  r = await api(vTok, "/nadogradnja-servera/pokreni", "POST", {});
  proveri("vlasnik ne pokreće nadogradnju", r.status === 403);
  r = await api(sTok, "/nadogradnja-servera/pokreni", "POST", {});
  proveri("serviser pokreće nadogradnju", r.status === 200 && r.body.verzija === "9.9.1", JSON.stringify(r.body));
  proveri("server se vraća sa novom verzijom", await sacekaj(async () => (await zdravlje())?.verzija === "9.9.1", 60000), zapis().slice(-700));
  proveri("novi kod je stvarno na disku", fs.existsSync(path.join(SRV, "src", "znak-nove-verzije.txt")));
  proveri("nadzornik je nadogradnju potvrdio", await sacekaj(async () => !fs.existsSync(path.join(DATA, "nadogradnja-servera", "zamena.json")), 15000));
  proveri("staro je sačuvano sa strane", fs.readdirSync(path.join(DATA, "nadogradnja-servera")).some((i) => i.startsWith("pre-9.9.0")));
  vTok = await uloguj("admin", "admin");
  sTok = await uloguj("servis", "ServisLozinka1");
  const igraci = (await api(vTok, "/players")).body;
  proveri("podaci igraonice su preživeli nadogradnju", Array.isArray(igraci) && igraci.some((p) => p.username === "stalni"));
  const logovi = JSON.stringify((await api(vTok, "/logs?limit=300")).body);
  proveri("u Logovima piše da je server nadograđen", logovi.includes("server_nadogradjen"));
  proveri("i ko je pokrenuo nadogradnju", logovi.includes("nadogradnja_servera"));
  r = await api(sTok, "/nadogradnja-servera/pokreni", "POST", {});
  proveri("isti paket drugi put se ne pušta - nije noviji", r.status === 400, JSON.stringify(r.body));

  // ---- 3) POKVARENA VERZIJA SE VRAĆA SAMA ----
  r = await api(sTok, "/nadogradnja-servera/paket", "PUT", paketLose, true);
  proveri("pokvarena verzija prolazi proveru paketa - kvar je u kodu", r.status === 200 && r.body.paket?.verzija === "9.9.2",
    JSON.stringify(r.body));
  r = await api(sTok, "/nadogradnja-servera/pokreni", "POST", {});
  proveri("i nadogradnja na nju kreće", r.status === 200, JSON.stringify(r.body));
  await sacekaj(async () => !(await zdravlje()), 15000);
  proveri("kad nova verzija ne proradi, vraća se prethodna sama",
    await sacekaj(async () => (await zdravlje())?.verzija === "9.9.1", 60000), zapis().slice(-900));
  proveri("i na disku je opet prethodna",
    JSON.parse(fs.readFileSync(path.join(SRV, "package.json"), "utf8")).version === "9.9.1" &&
    fs.existsSync(path.join(SRV, "src", "znak-nove-verzije.txt")));
  proveri("zapis o zameni je obrisan", !fs.existsSync(path.join(DATA, "nadogradnja-servera", "zamena.json")));
  vTok = await uloguj("admin", "admin");
  const logovi2 = JSON.stringify((await api(vTok, "/logs?limit=300")).body);
  proveri("u Logovima piše da nadogradnja nije uspela", logovi2.includes("nadogradnja_vracena"));
  const stanje2 = (await api(vTok, "/nadogradnja-servera")).body;
  proveri("i panel to pokazuje", stanje2.poslednjiIshod?.ok === false && /9\.9\.2/.test(stanje2.poslednjiIshod.poruka || ""),
    JSON.stringify(stanje2.poslednjiIshod));

  // ---- 4) GAŠENJE ----
  fs.writeFileSync(path.join(DATA, "nadzor-stani"), "");
  const kod = await Promise.race([n.gotov, cekaj(20000).then(() => "visi")]);
  proveri("nadzornik se posle svega gasi uredno", kod === 0, String(kod));
} finally {
  for (const p of procesi) if (radi(p)) { try { p.kill(); } catch {} }
  try {
    const s = JSON.parse(fs.readFileSync(path.join(DATA, "nadzor.json"), "utf8"));
    if (s?.dete && ziv(s.dete)) process.kill(s.dete);
  } catch {}
  await cekaj(300);
}
proveri("ne ostaje nijedan proces", procesi.every((p) => !radi(p)));
await kraj();
