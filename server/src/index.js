import "./prewarn.js"; // mora prvo (gasi SQLite experimental warning)
import express from "express";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db, checkpoint } from "./db.js";
import { backupDb, odrzavanje, kopirajVanRacunara } from "./odrzavanje.js";
import { getAdmin } from "./auth.js";
import { router } from "./routes.js";
import * as nadg from "./nadogradnja.js";
import * as nadgServera from "./nadogradnja-servera.js";
import { initWs, setHandlers, broadcastPanels } from "./hub.js";
import * as svc from "./service.js";
import * as internet from "./internet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8095;
const PUBLIC = path.join(__dirname, "..", "public");
// Verzija ide u adrese style.css i app.js, da pregledač posle nadogradnje
// učita nove fajlove.
let VERZIJA = "0";
try { VERZIJA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || "0"; } catch {}

const app = express();
// Slike stižu kao base64 (oko trećinu veće), pa je granica iznad najveće
// dozvoljene slike (8 MB).
app.use(express.json({ limit: "12mb" }));
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Fajl je prevelik. Najveća dozvoljena slika je 8 MB." });
  }
  if (err) return res.status(400).json({ error: "Neispravan zahtev" });
  next();
});

// ---- Zaštitna zaglavlja ----
//
// Sve što korisnici upisuju prolazi kroz `esc()`; CSP je druga brana, pa
// pregledač izvršava samo skripte sa ovog servera. `style-src` dozvoljava
// inline stilove (panel ih koristi, šara je `background-image`), a
// `img-src data:` je za šaru i pregled slike pre slanja.
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "));
  // Pregledač ne nagađa vrstu fajla.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Panel radi na lokalnoj mrezi i nema sta da javlja spolja odakle se dolazi.
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// Zdravlje - jedina adresa pod /api bez prijave. Pita je nadzornik; proverava
// se i baza. Vraća samo da je server živ i verziju.
app.get("/api/zdravlje", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.set("Cache-Control", "no-store").json({ ok: true, verzija: VERZIJA, radi: Math.round(process.uptime()) });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// API
app.use("/api", router);
// Nepoznata adresa pod /api vraća JSON, ne HTML stranicu.
app.use("/api", (req, res) => res.status(404).json({ error: `Nepoznata adresa: ${req.method} /api${req.path}` }));

// ---- Preuzimanje launchera (nadogradnja) ----
//
// Zahteva token računara i puštenu verziju, a šalje tačno puštenu verziju
// (računar proverava najavljen sha256).
app.get("/nadogradnja/launcher.exe", (req, res) => {
  const token = String(req.query.token || "");
  const comp = token ? db.prepare("SELECT id FROM computers WHERE token = ?").get(token) : null;
  if (!comp) return res.status(403).type("text").send("Nevažeći token računara");

  const st = nadg.stanje();
  if (!st.ima || !st.pusteno) return res.status(404).type("text").send("Nema puštene nadogradnje");

  const put = path.join(nadg.FOLDER, st.fajl);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", st.velicina);
  res.setHeader("X-Crit-Verzija", st.verzija);
  res.setHeader("X-Crit-Sha256", st.sha256);
  // Instalater se ne kešira: isto ime posle nove gradnje je drugi sadržaj.
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "HEAD") return res.end();

  const tok = fs.createReadStream(put);
  tok.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  // Prekinuto preuzimanje zatvara tok.
  res.on("close", () => tok.destroy());
  tok.pipe(res);
});

// index.html se sklapa u hodu, sa verzijom u adresama CSS-a i JS-a; sama
// strana se ne kešira.
const posaljiPanel = (req, res) => {
  fs.readFile(path.join(PUBLIC, "index.html"), "utf8", (e, html) => {
    if (e) return res.status(500).send("Panel nije nađen");
    res.set("Cache-Control", "no-cache");
    res.type("html").send(html.replaceAll("__VERZIJA__", VERZIJA));
  });
};
app.get("/", posaljiPanel);
app.get("/index.html", posaljiPanel);

// Otpremljene slike su u folderu sa podacima (UPLOADS u service.js). Ruta je
// pre `express.static(PUBLIC)`, jer stara instalacija ima slike i na starom
// mestu. Svaka slika dobija nov naziv, pa sme dugo da se kešira.
app.use("/uploads", express.static(svc.UPLOADS, { maxAge: "7d", fallthrough: true }));

// Statički panel; ETag i verzija u adresi.
app.use(express.static(PUBLIC));

// Neuhvaćena greška: klijent dobija JSON bez stack trace-a, a greška ide u
// log servera.
app.use((err, req, res, next) => {
  console.error(`[greska] ${req.method} ${req.originalUrl}:`, err?.stack || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Greška na serveru. Pokušaj ponovo, a ako se ponovi pogledaj prozor servera." });
});

const server = http.createServer(app);

// Zauzet port znači da server već radi: ovaj izlazi sa kodom po kom ga
// nadzornik ne diže u krug (KOD_PORT_ZAUZET u nadzor.js). Rukovalac se kači
// pre WebSocket-a, jer `ws` inače baca istu grešku kao neuhvaćenu.
server.on("error", (e) => {
  // Greška posle dobijenog porta se zapisuje; server radi dalje.
  if (server.listening) return zapisiPad("greška servera", e);
  if (e?.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} je zauzet - server verovatno vec radi. Ovaj se gasi.\n`);
    process.exit(3);
  }
  zapisiPad("server ne može da sluša", e);
  process.exit(1);
});

// ---- WebSocket ----
const wss = initWs(server, {
  authComputer: (token) => (token ? db.prepare("SELECT * FROM computers WHERE token = ?").get(token) : null),
  authAdmin: (token) => getAdmin(token),
});

setHandlers({
  onClientOpen: (comp, ws, ip, verzija, opcije) => svc.onClientOpen(comp, ip, verzija, opcije),
  onClientClose: (id) => svc.onClientClose(id),
  onClientMessage: (id, msg) => svc.handleClientMessage(id, msg),
  onPanelOpen: (ws) => {
    // posalji pun snapshot novom panelu
    ws.send(JSON.stringify(svc.fullSnapshot()));
  },
});

// Redovni poslovi kreću tek kad server dobije port, da drugi pokrenut
// primerak ne dira bazu.
function pokreniRedovnePoslove() {
  // ---- Naplata svakih 5s ----
  setInterval(() => {
    try { svc.billingTick(); } catch (e) { console.error("billing:", e); }
  }, 5000);

  // Računari se nadograđuju čim se oslobode (nadogradnjaTick).
  setInterval(() => {
    try { svc.nadogradnjaTick(); } catch (e) { console.error("nadogradnja:", e.message); }
  }, 60 * 1000);

  // Internet proverava server i javlja svim launcherima (internet.js).
  internet.pokreni((ok) => svc.javiInternet(ok));

  setInterval(() => checkpoint(), 2 * 60 * 1000);
  setInterval(() => backupDb(), 15 * 60 * 1000);
  backupDb();

  // Održavanje na startu i jednom dnevno: logovi, rezervne kopije, slobodan
  // prostor (odrzavanje.js).
  function odrzavanjeSada(razlog) {
    const r = odrzavanje(svc.getActiveShift()?.id ?? null);
    const obrisano = r.logovi.poStarosti + r.logovi.poBroju + r.pokretanja + r.kopije.obrisano;
    if (obrisano) {
      console.log(`održavanje (${razlog}): logovi -${r.logovi.poStarosti + r.logovi.poBroju}, ` +
        `pokretanja igara -${r.pokretanja}, kopije -${r.kopije.obrisano} ` +
        `(ostalo ${r.kopije.zadrzano} kopija, ${r.kopije.ukupnoMB} MB)`);
    }
    if (r.stanje.maloMesta) {
      console.error(`PAŽNJA: na disku je ostalo samo ${r.stanje.slobodnoMB} MB. ` +
        `Kad disk stane, server ne može da piše i igraonica staje.`);
      svc.logEvent({ category: "sistem", action: "disk_malo", actor: "sistem",
        detail: `Malo mesta na disku: ${r.stanje.slobodnoMB} MB slobodno` });
    }
    // Kopija van računara. Neuspeh ide u Logove. Kopiranje je asinhrono, da
    // odredište koje ne odgovara ne zaustavi server.
    kopirajVanRacunara().then((van) => {
      if (van?.ok) {
        console.log(`kopija van računara: ${van.fajl} -> ${van.cilj}`);
      } else if (van?.error) {
        console.error(`PAŽNJA: kopija van računara nije uspela (${van.error}) - odredište ${van.cilj}`);
        svc.logEvent({ category: "sistem", action: "kopija_van_pala", actor: "sistem",
          detail: `Kopija van računara nije uspela: ${van.error}. Odredište: ${van.cilj}. ` +
            `Dok ovo stoji, baza postoji samo na jednom disku.` });
      }
    }).catch(() => {});
    return r;
  }
  setInterval(() => odrzavanjeSada("dnevno"), 24 * 60 * 60 * 1000);
  odrzavanjeSada("start");
}

// ---- Start ----
server.listen(PORT, () => {
  const ips = localIps();
  console.log(`\nCrit server radi na portu ${PORT}`);
  console.log(`  ovaj racunar:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  mreza/telefon: http://${ip}:${PORT}`);
  console.log("");
  pokreniRedovnePoslove();
  // Nadzornik javlja zašto je server pokrenut; pad i zastoj idu u Logove.
  const razlog = process.env.RAZLOG_POKRETANJA;
  // Ishod nadogradnje sa panela. Neuspeh je upisao nadzornik pre vraćanja
  // stare verzije.
  if (razlog === "nadogradnja") {
    svc.logEvent({ category: "sistem", action: "server_nadogradjen", actor: "nadzornik",
      detail: `Server je nadograđen na ${nadgServera.trenutnaVerzija}` });
    nadgServera.obrisiIshod();
  }
  const ishod = nadgServera.preuzmiIshod();
  if (ishod && ishod.ok === false) {
    svc.logEvent({ category: "sistem", action: "nadogradnja_vracena", actor: "nadzornik",
      detail: String(ishod.poruka || "Nadogradnja servera nije uspela - vraćena je prethodna verzija").slice(0, 300) });
  }
  const PONOVO = {
    pad: "Server je pao i nadzornik ga je ponovo pokrenuo. Razlog je u data/nadzor.log.",
    zaglavljen: "Server nije odgovarao pa ga je nadzornik ponovo pokrenuo. Detalji su u data/nadzor.log.",
    nadzornik: "Nadzornik servera je bio ugašen silom (npr. iz Task Manager-a), a sa njim i server. " +
      "Provera na 5 minuta ih je ponovo pokrenula.",
  };
  if (Object.hasOwn(PONOVO, razlog || "")) {
    svc.logEvent({ category: "sistem", action: "server_ponovo_pokrenut", actor: "nadzornik", detail: PONOVO[razlog] });
  }
});

// Neuhvaćena greška ne gasi server; zapisuje se u konzolu i u Logove
// (Logovi > Sistem), najviše jednom u minuti za istu grešku.
const skoroZapisano = new Map(); // poruka -> ts
function zapisiPad(vrsta, e) {
  const tekst = String(e?.stack || e || "").slice(0, 400);
  console.error(vrsta + ":", tekst);
  // Ista greska ume da se ponavlja u petlji; log ne sme da se zatrpa.
  const kljuc = tekst.slice(0, 120);
  const sada = Date.now();
  if (sada - (skoroZapisano.get(kljuc) || 0) < 60000) return;
  skoroZapisano.set(kljuc, sada);
  // Ako je i sam upis u bazu uzrok pada, logEvent to guta i nista se ne desava.
  try {
    svc.logEvent({
      category: "sistem", action: "greska", actor: "server",
      detail: `${vrsta}: ${tekst.split("\n")[0].slice(0, 200)}`,
    });
  } catch {}
}
process.on("uncaughtException", (e) => zapisiPad("neuhvacena greska", e));
process.on("unhandledRejection", (e) => zapisiPad("neobradjeno odbijanje", e));

// Uredno gašenje: WAL se prepisuje u bazu i baza se zatvara. Stiže od
// nadzornika (poruka "ugasi"), na Ctrl+C i pri zatvaranju prozora.
let gasiSe = false;
function ugasiUredno(zasto) {
  if (gasiSe) return;
  gasiSe = true;
  console.log(`\nServer se gasi (${zasto})...`);
  try {
    svc.logEvent({ category: "sistem", action: "server_ugasen", actor: "sistem", detail: `Server je uredno ugašen (${zasto})` });
  } catch {}
  let gotovo = false;
  const kraj = () => {
    if (gotovo) return;
    gotovo = true;
    try { checkpoint(); } catch {}
    try { db.close(); } catch {}
    process.exit(0);
  };
  // Veze se prekidaju odmah, pa launcheri prelaze na rad bez servera. Posle
  // tri sekunde izlazi se u svakom slučaju.
  try { for (const k of wss.clients) k.terminate(); } catch {}
  try { server.close(kraj); } catch { kraj(); }
  setTimeout(kraj, 3000);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(signal, () => ugasiUredno(signal));
process.on("message", (poruka) => { if (poruka?.t === "ugasi") ugasiUredno("nadzornik"); });

function localIps() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}
