// NADZORNIK SERVERA - šta radi i zašto piše u src/nadzor.js.
//
//   node nadzornik.mjs             pokreće server i drži ga
//   node nadzornik.mjs --provera   isto, ali samo iza nadzornika koji je nestao
//                                  bez urednog gašenja (vidi PROVERA niže)
//
// Pokreće ga zakazani zadatak pri paljenju računara ("Podesi autostart.bat"),
// ili ručno "Pokreni server.bat". Uredno se gasi:
//   - kad se u data\ pojavi fajl "nadzor-stani" (tako ga gasi VRATI-KOPIJU.bat,
//     i to bez administratora, iako zadatak radi kao SYSTEM)
//   - na Ctrl+C i kad se zatvori prozor u kom radi
//
// Uz to izvodi nadogradnju servera sa panela: server javi da je paket spreman
// i ugasi se, a nadzornik zameni kod i podigne novu verziju - ili vrati staru,
// ako se nova ne javi (vidi src/zamena-servera.js).
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { napraviNadzornika } from "./src/nadzor.js";
import { zameni, vrati, nedovrsena, potvrdi, ocistiRezerve } from "./src/zamena-servera.js";

const OVDE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8095;
const DATA_DIR = process.env.CRIT_DATA_DIR || path.join(OVDE, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const ZAPIS = path.join(DATA_DIR, "nadzor.log");
const STANJE = path.join(DATA_DIR, "nadzor.json");
const STANI = path.join(DATA_DIR, "nadzor-stani");
const POKRENI = path.join(DATA_DIR, "nadzor-pokreni");
const PROVERA = process.argv.includes("--provera");
const NADOGRADNJA = path.join(DATA_DIR, "nadogradnja-servera");
const MARKER = path.join(NADOGRADNJA, "zamena.json");
const ISHOD = path.join(NADOGRADNJA, "ishod.json");
const NOVI = path.join(NADOGRADNJA, "novi");
const NAJVECI_ZAPIS = 1024 * 1024;
// Nova verzija ima ovoliko da se javi sa svojim brojem. Prvo pokretanje posle
// nadogradnje prilagođava bazu, pa ume da potraje duže od običnog.
const ROK_NOVE_VERZIJE_MS = 90000;
const OPIS = {
  start: "pokretanje", pad: "posle pada", zaglavljen: "posle zastoja", port: "port je bio zauzet",
  nadogradnja: "nova verzija", vracena: "vraćena prethodna verzija", nadzornik: "posle nestanka nadzornika",
};

// Zapis nadzornika ide u fajl, jer kad radi kao zakazani zadatak nema prozora
// u koji bi išao. Seče se na četvrt megabajta kad pređe megabajt: server koji
// pada u krug ne sme da napuni disk.
function log(tekst) {
  const red = `[${new Date().toISOString()}] ${tekst}`;
  console.log(red);
  try {
    if (fs.statSync(ZAPIS).size > NAJVECI_ZAPIS) fs.writeFileSync(ZAPIS, fs.readFileSync(ZAPIS, "utf8").slice(-256 * 1024));
  } catch {}
  try { fs.appendFileSync(ZAPIS, red + "\n", "utf8"); } catch {}
}

function upisiStanje(dete) {
  try {
    fs.writeFileSync(STANJE, JSON.stringify({ pid: process.pid, dete, port: PORT, od: new Date().toISOString() }), "utf8");
  } catch {}
}

const verzijaNaDisku = () => {
  try { return String(JSON.parse(fs.readFileSync(path.join(OVDE, "package.json"), "utf8")).version); } catch { return "?"; }
};

function upisiIshod(ishod) {
  try {
    fs.mkdirSync(NADOGRADNJA, { recursive: true });
    fs.writeFileSync(ISHOD, JSON.stringify({ ...ishod, vreme: new Date().toISOString() }), "utf8");
  } catch {}
}

// ---- nadogradnja ----
let cekaNadogradnju = null;   // server je javio da je paket spreman
let proveraNove = null;       // nova verzija je pokrenuta i čeka se da se javi

// Pre svakog pokretanja: nedovršena zamena se vraća, a zatražena se izvodi.
async function prePokretanja(razlog) {
  if (nedovrsena(MARKER)) {
    // Zapis stoji: prethodna zamena nije potvrđena. Ili je nova verzija pala pri
    // pokretanju, ili se nije javila na vreme, ili je računar ostao bez struje
    // usred zamene. U svakom od tih slučajeva staro se vraća.
    const z = nedovrsena(MARKER);
    const r = vrati({ folderServera: OVDE, marker: MARKER });
    const nova = proveraNove?.verzija || "nova verzija";
    log(`nadogradnja nije potvrđena - vraćena prethodna verzija (${r.vraceno} stavki iz ${path.basename(z.rezerva || "")})`);
    upisiIshod({ ok: false, verzija: nova, vracena: verzijaNaDisku(),
      poruka: `Nadogradnja na ${nova} nije uspela: nova verzija se nije javila, pa je vraćena ${verzijaNaDisku()}.` });
    proveraNove = null;
    cekaNadogradnju = null;
    return "vracena";
  }
  if (razlog === "nadogradnja" && cekaNadogradnju) {
    const trazeno = cekaNadogradnju;
    cekaNadogradnju = null;
    const stara = verzijaNaDisku();
    if (!fs.existsSync(path.join(NOVI, "src", "index.js"))) {
      log("nadogradnja je zatražena, ali nova verzija nije raspakovana - pokrećem postojeću");
      upisiIshod({ ok: false, verzija: trazeno.verzija, poruka: "Nadogradnja nije izvedena: raspakovan paket nije nađen." });
      return "pad";
    }
    const pecat = new Date().toISOString().replace(/[:.]/g, "-");
    const rezerva = path.join(NADOGRADNJA, `pre-${stara}-${pecat}`);
    try {
      const r = zameni({ folderServera: OVDE, novi: NOVI, rezerva, marker: MARKER });
      log(`kod zamenjen: ${stara} -> ${trazeno.verzija} (${r.stavke} stavki), staro je u ${path.basename(rezerva)}`);
    } catch (e) {
      log(`zamena koda nije uspela: ${e?.message || e} - vraćam staro`);
      try { vrati({ folderServera: OVDE, marker: MARKER }); } catch (e2) { log(`vraćanje nije uspelo: ${e2?.message || e2}`); }
      upisiIshod({ ok: false, verzija: trazeno.verzija, vracena: stara,
        poruka: `Nadogradnja na ${trazeno.verzija} nije uspela pri zameni fajlova (${String(e?.message || e).slice(0, 120)}). Server radi na ${stara}.` });
      return "vracena";
    }
    proveraNove = { verzija: trazeno.verzija, stara, doKad: Date.now() + ROK_NOVE_VERZIJE_MS };
    return "nadogradnja";
  }
  return razlog;
}

// Nova verzija se potvrđuje tek kad se javi sa SVOJIM brojem. Server koji radi,
// a javlja stari broj, znači da zamena nije uzela.
setInterval(async () => {
  if (!proveraNove) return;
  const z = await zdravlje();
  if (z?.ok && z.verzija === proveraNove.verzija) {
    potvrdi(MARKER);
    log(`nova verzija ${proveraNove.verzija} se javila - nadogradnja je potvrđena`);
    proveraNove = null;
    try { ocistiRezerve(NADOGRADNJA, 2); } catch {}
    return;
  }
  if (Date.now() > proveraNove.doKad) {
    log(`nova verzija ${proveraNove.verzija} se nije javila za ${ROK_NOVE_VERZIJE_MS / 1000} s - gasim je i vraćam staru`);
    const d = trenutnoDete;
    proveraNove.doKad = Infinity; // ne ponavljaj dok se gasi
    if (d) ubij(d); // izlaz pokreće prePokretanja, a on vidi zapis i vraća staro
  }
}, 2000).unref?.();

// ---- server ----
let trenutnoDete = null;

function pokreni(razlog) {
  const d = spawn(process.execPath, [path.join(OVDE, "src", "index.js")], {
    cwd: OVDE,
    windowsHide: true,
    env: { ...process.env, POD_NADZOROM: "1", RAZLOG_POKRETANJA: razlog },
    // Greške servera idu i u zapis nadzornika: kad server pada noću, a radi kao
    // zakazani zadatak, prozora nema - a razlog pada je baš u tim redovima.
    stdio: ["ignore", "inherit", "pipe", "ipc"],
  });
  log(`pokrećem server ${verzijaNaDisku()} (${OPIS[razlog] || razlog}), PID ${d.pid}`);
  upisiStanje(d.pid);
  d.stderr.setEncoding("utf8");
  let ostatak = "";
  d.stderr.on("data", (komad) => {
    process.stderr.write(komad);
    ostatak += komad;
    const redovi = ostatak.split(/\r?\n/);
    ostatak = redovi.pop();
    for (const r of redovi) if (r.trim()) log("server: " + r.slice(0, 500));
  });
  d.on("error", (e) => log(`server nije mogao da se pokrene: ${e.message}`));
  const dete = {
    pid: d.pid,
    naIzlaz(cb) { d.once("exit", (kod) => { if (trenutnoDete === dete) trenutnoDete = null; cb(kod); }); },
    // Uredno: server upiše bazu i izađe sam (vidi ugasiUredno u src/index.js).
    zamoli() {
      try { d.send({ t: "ugasi" }); } catch { ubij(dete); }
    },
  };
  // Server javlja da je paket spreman (vidi nadogradnja-servera.js).
  d.on("message", (m) => {
    if (m?.t !== "nadogradi" || typeof m.verzija !== "string" || !/^\d+\.\d+\.\d+$/.test(m.verzija)) return;
    if (cekaNadogradnju || proveraNove) return;
    log(`server traži nadogradnju na ${m.verzija}`);
    cekaNadogradnju = { verzija: m.verzija };
    nadzor.ponovo("nadogradnja");
  });
  trenutnoDete = dete;
  return dete;
}

function ubij(dete) {
  if (!dete?.pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(dete.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }, () => {});
  } else {
    try { process.kill(dete.pid, "SIGKILL"); } catch {}
  }
}

function zdravlje() {
  return new Promise((resolve) => {
    const zahtev = http.get({ host: "127.0.0.1", port: PORT, path: "/api/zdravlje", timeout: 5000 }, (res) => {
      let telo = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { telo += c; if (telo.length > 4096) res.destroy(); });
      res.on("end", () => {
        try { const j = JSON.parse(telo); resolve(res.statusCode === 200 ? j : null); } catch { resolve(null); }
      });
      res.on("error", () => resolve(null));
    });
    zahtev.on("timeout", () => { zahtev.destroy(); resolve(null); });
    zahtev.on("error", () => resolve(null));
  });
}
const proveri = async () => (await zdravlje())?.ok === true;

const nadzor = napraviNadzornika({ pokreni, proveri, ubij, log, prePokretanja });

let gasenjeUToku = false;
async function ugasi(zasto) {
  if (gasenjeUToku) return;
  gasenjeUToku = true;
  log(`nadzornik se gasi (${zasto})`);
  await nadzor.stani();
  try { fs.unlinkSync(STANJE); } catch {}
  try { brava.close(); } catch {}
  process.exit(0);
}

// PROVERA NA 5 MINUTA ("--provera", drugi zakazani zadatak).
//
// Nadzornik ugašen silom - iz Task Manager-a, ili ga Windows ubije kad ostane
// bez memorije - povuče i server: Windows gasi Node dete zajedno sa roditeljem.
// A "ponovo pri grešci" zakazanog zadatka važi za zadatak koji ne uspe da
// KRENE, ne za program koji je posle ugašen. Server bi ostao ugašen do sledećeg
// paljenja računara.
//
// Zato drugi zadatak na svakih 5 minuta pokreće nadzornika sa --provera, a on
// diže server samo kad je prethodni nadzornik NESTAO: nadzor.json ostaje iza
// nadzornika koji je ubijen, a briše ga svako uredno gašenje. Namerno ugašen
// server (VRATI-KOPIJU, uklanjanje autostarta) tako ostaje ugašen - osim kad je
// ostavljen fajl nadzor-pokreni. Dok nadzornik radi, ovog drugog odbije brava.
let razlogStarta = "start";
let opisStarta = "";
if (PROVERA) {
  const nestao = fs.existsSync(STANJE);
  if (!nestao && !fs.existsSync(POKRENI)) process.exit(0);
  opisStarta = nestao ? " - provera: prethodni nadzornik je nestao bez gašenja" : " - provera: ostavljen je zahtev za paljenje";
  // Posle nestanka struje zapis takođe ostane, a to nije ubijen nadzornik.
  if (nestao && os.uptime() > 10 * 60) razlogStarta = "nadzornik";
}

// JEDAN NADZORNIK PO PORTU.
//
// Brava je port na lokalnoj adresi, a ne fajl: fajl sa PID-om ostane i kad
// nadzornik umre bez pozdrava (nestanak struje), a Windows posle restarta isti
// broj da nekom drugom procesu - pa bi server zauvek "već radio". Port oslobodi
// sam Windows, u trenutku kad proces nestane.
//
// Drugi nadzornik (dupli klik na "Pokreni server.bat" dok zadatak već radi)
// ovde sazna da nije sam i izađe uredno, sa kodom 0 - da ga zakazani zadatak ne
// bi ponovo pokretao.
const brava = net.createServer();
brava.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log("");
    console.log("  Server vec radi u pozadini (drugi nadzornik drzi ovaj port).");
    console.log(`  Panel: http://localhost:${PORT}`);
    console.log("");
    process.exit(0);
  }
  log(`nadzornik ne može da postavi bravu: ${e.message}`);
  process.exit(1);
});
brava.listen({ host: "127.0.0.1", port: PORT + 1000, exclusive: true }, () => {
  log(`nadzornik je pokrenut (PID ${process.pid}, port servera ${PORT})${opisStarta}`);
  // Stari zahtev za gašenje ne važi za ovo pokretanje; zahtev za paljenje je ispunjen.
  try { fs.unlinkSync(STANI); } catch {}
  try { fs.unlinkSync(POKRENI); } catch {}
  // Zapis stoji od prvog trenutka: i nadzornik ubijen pre prvog servera se diže.
  upisiStanje(null);
  nadzor.start(razlogStarta);
  setInterval(() => {
    if (!fs.existsSync(STANI)) return;
    try { fs.unlinkSync(STANI); } catch {}
    ugasi("zatraženo fajlom nadzor-stani");
  }, 2000);
});

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(signal, () => ugasi(signal));
// Nadzornik ne sme da padne zbog svoje greške - tada niko ne drži server.
process.on("uncaughtException", (e) => log(`greška u nadzorniku: ${String(e?.stack || e).slice(0, 500)}`));
process.on("unhandledRejection", (e) => log(`greška u nadzorniku: ${String(e?.stack || e).slice(0, 500)}`));
