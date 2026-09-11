import "./prewarn.js"; // mora prvo (gasi SQLite experimental warning)
import express from "express";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db, checkpoint } from "./db.js";
import { backupDb, odrzavanje } from "./odrzavanje.js";
import { getAdmin } from "./auth.js";
import { router } from "./routes.js";
import * as nadg from "./nadogradnja.js";
import { initWs, setHandlers, broadcastPanels } from "./hub.js";
import * as svc from "./service.js";
import * as internet from "./internet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8095;
const PUBLIC = path.join(__dirname, "..", "public");
// Verzija ide u adrese style.css i app.js. Bez toga pregledac posle nadogradnje
// i dalje pokazuje staru, kesirawanu stranu - vlasnik zameni fajlove i zakune
// se da se "nista nije promenilo". Sa ovim se pri svakoj novoj verziji povuku
// svezi fajlovi, a stari se i dalje kesiraju dok verzija stoji.
let VERZIJA = "0";
try { VERZIJA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || "0"; } catch {}

const app = express();
// Slike stizu kao base64, sto naduva sadrzaj za oko trecinu - limit mora da
// bude iznad najvece dozvoljene slike (8 MB pozadina) da bi korisnik dobio
// razumljivu poruku umesto grube greske iz parsera.
app.use(express.json({ limit: "12mb" }));
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Fajl je prevelik. Najveća dozvoljena slika je 8 MB." });
  }
  if (err) return res.status(400).json({ error: "Neispravan zahtev" });
  next();
});

// ---- Zastitna zaglavlja ----
//
// Panel prikazuje ono sto ljudi upisuju: imena igraca, nazive igara, beleske uz
// nalog. Sve to prolazi kroz `esc()` pre nego sto udje u stranu, i to je prva
// brana. Ovo je druga: i da jedno jedino mesto ikad promasi, ubacena skripta ne
// moze da se pokrene jer pregledac izvrsava samo skripte sa ovog servera.
//
// Zasto je to vazno bas ovde: iz panela se upisuje kredit. Skripta koja se
// izvrsi u vlasnikovom pregledacu ne mora nista da provaljuje - ona VEC jeste
// vlasnik.
//
// `style-src` mora da dozvoli inline: panel sklapa HTML sa `style="..."` na
// desetinama mesta, a sara pozadine se postavlja kao `background-image`.
// `img-src data:` je zbog te sare (SVG kao data adresa) i zbog pregleda slike
// pre slanja (FileReader).
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
  // Pregledac ne sme da nagadja vrstu fajla: slika koju je neko postavio, a
  // koja "lici" na skriptu, ne sme da se izvrsi kao skripta.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Panel radi na lokalnoj mrezi i nema sta da javlja spolja odakle se dolazi.
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// API
app.use("/api", router);
// Nepoznata adresa pod /api vraca JSON, ne Express-ovu HTML stranicu. Panel sve
// odgovore cita kao JSON, pa bi na HTML javio nerazumljivu gresku umesto jasnog
// "ta adresa ne postoji" - a to se desi kad panel i server nisu iste verzije.
app.use("/api", (req, res) => res.status(404).json({ error: `Nepoznata adresa: ${req.method} /api${req.path}` }));

// ---- Preuzimanje launchera (nadogradnja) ----
//
// Jedina adresa van /api koja nesto daje, i jedina koju racunari zovu bez
// prijave osoblja. Zato se ovde traze tri stvari, i to ovim redom:
//
//  1. Token racunara. Nije panelski token - masina ga dobija pri postavljanju
//     i drzi ga u svojim podesavanjima. Bez njega niko sa mreze ne moze da
//     skine instalater, pa ni da ga razgleda.
//  2. Verzija mora da bude PUSTENA. Fajl koji stoji u folderu, a covek ga jos
//     nije odobrio, ne postoji za spoljni svet.
//  3. Salje se tacno ona verzija koja je pustena. Racunar je najavljen otisak
//     vec zapamtio i proverice ga; ako mu stigne bilo sta drugo, odbice da to
//     pokrene.
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
  // Instalater se ne kesira: isto ime fajla posle nove gradnje znaci drugi
  // sadrzaj, a posrednik koji vrati stari bi vratio i staru gresku.
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "HEAD") return res.end();

  const tok = fs.createReadStream(put);
  tok.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  // Racunar koji prekine preuzimanje (restart, iscupan kabl) ne sme da ostavi
  // otvoren tok koji dalje cita sa diska.
  res.on("close", () => tok.destroy());
  tok.pipe(res);
});

// index.html se sklapa u hodu: verzija se ubaci u adrese CSS-a i JS-a, pa
// pregledac za svaku novu verziju povuce sveze fajlove. Sama strana se ne
// kesira - uvek se trazi ponovo, a ona onda referise verzionirane fajlove.
const posaljiPanel = (req, res) => {
  fs.readFile(path.join(PUBLIC, "index.html"), "utf8", (e, html) => {
    if (e) return res.status(500).send("Panel nije nađen");
    res.set("Cache-Control", "no-cache");
    res.type("html").send(html.replaceAll("__VERZIJA__", VERZIJA));
  });
};
app.get("/", posaljiPanel);
app.get("/index.html", posaljiPanel);

// OTPREMLJENE SLIKE STOJE UZ BAZU, NE U PROGRAMU.
//
// Omoti, slike pica, pozadine i baneri su podaci igraonice - zato zive u folderu
// sa podacima (vidi UPLOADS u service.js): kopiraju se sa bazom, ne mesaju se sa
// paketom pri nadogradnji, i ne izlaze iz izolovane instance.
//
// Mora PRE `express.static(PUBLIC)`: stara instalacija ima iste fajlove i na
// starom mestu, pa bi se inace servirala zatecena kopija umesto one koju je
// vlasnik upravo otpremio. Slika se ne menja pod istim imenom (svako otpremanje
// dobija nov vremenski pecat), pa sme da se kesira dugo.
app.use("/uploads", express.static(svc.UPLOADS, { maxAge: "7d", fallthrough: true }));

// Staticki panel. express.static sam salje ETag, pa pregledac na svaki fajl
// pita "je li se promenio" i dobija 304 ako nije - jeftino, a nikad ne servira
// staru verziju. Uz verziju u adresi (?v=) to znaci: nova verzija = svez fajl,
// ista verzija = brza provera.
app.use(express.static(PUBLIC));

// Zastitna mreza: nijedna ruta ne sme da posalje stack trace klijentu.
// Express podrazumevano na neuhvacenu gresku vrati HTML sa celim stack trace-om
// i apsolutnim putanjama fajlova - panel to prikaze kao nerazumljivu bujicu
// teksta, a i nema razloga da iko spolja vidi kako je server sastavljen.
// Greska i dalje ide u log servera, gde joj je mesto.
app.use((err, req, res, next) => {
  console.error(`[greska] ${req.method} ${req.originalUrl}:`, err?.stack || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Greška na serveru. Pokušaj ponovo, a ako se ponovi pogledaj prozor servera." });
});

const server = http.createServer(app);

// ---- WebSocket ----
initWs(server, {
  authComputer: (token) => (token ? db.prepare("SELECT * FROM computers WHERE token = ?").get(token) : null),
  authAdmin: (token) => getAdmin(token),
});

setHandlers({
  onClientOpen: (comp, ws, ip, verzija) => svc.onClientOpen(comp, ip, verzija),
  onClientClose: (id) => svc.onClientClose(id),
  onClientMessage: (id, msg) => svc.handleClientMessage(id, msg),
  onPanelOpen: (ws) => {
    // posalji pun snapshot novom panelu
    ws.send(JSON.stringify(svc.fullSnapshot()));
  },
});

// ---- Naplata svakih 5s ----
setInterval(() => {
  try { svc.billingTick(); } catch (e) { console.error("billing:", e); }
}, 5000);

// ---- Zaštita: WAL checkpoint (2 min) + backup baze (15 min + na startu) ----
// Racunari se nadograde sami cim se oslobode - vidi nadogradnjaTick.
setInterval(() => {
  try { svc.nadogradnjaTick(); } catch (e) { console.error("nadogradnja:", e.message); }
}, 60 * 1000);

// ---- Ima li igraonica internet ----
//
// Proverava SERVER, jednom, i javlja svima. Ranije je to radio svaki launcher
// za sebe, svakih 30 sekundi, ucitavanjem google.com/favicon.ico - trinaest
// masina, oko 37.000 poziva dnevno, i pogresan odgovor cim bas Google negde
// zapne. Objasnjenje je u internet.js.
internet.pokreni((ok) => svc.javiInternet(ok));

setInterval(() => checkpoint(), 2 * 60 * 1000);
setInterval(() => backupDb(), 15 * 60 * 1000);
backupDb();

// ---- Održavanje: na startu i jednom dnevno ----
//
// Seče logove po starosti i po broju, proređuje rezervne kopije i pazi na
// slobodan prostor. Objašnjenje granica i izmerene brojke su u odrzavanje.js.
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
  // KOPIJA VAN RAČUNARA - jedina zaštita od otkaza diska.
  //
  // Neuspeh mora da se čuje. USB se iščupa, mrežni disk se odjavi, a kopija
  // tiho prestane da izlazi napolje - i to se otkrije tek onog dana kad zatreba.
  // Zato zapis ide u Logove, gde vlasnik gleda, a ne samo u konzolu koju niko
  // ne otvara.
  const van = r.vanRacunara;
  if (van?.ok) {
    console.log(`kopija van računara: ${van.fajl} -> ${van.cilj}`);
  } else if (van?.error) {
    console.error(`PAŽNJA: kopija van računara nije uspela (${van.error}) - odredište ${van.cilj}`);
    svc.logEvent({ category: "sistem", action: "kopija_van_pala", actor: "sistem",
      detail: `Kopija van računara nije uspela: ${van.error}. Odredište: ${van.cilj}. ` +
        `Dok ovo stoji, baza postoji samo na jednom disku.` });
  }
  return r;
}
setInterval(() => odrzavanjeSada("dnevno"), 24 * 60 * 60 * 1000);
odrzavanjeSada("start");

// ---- Start ----
server.listen(PORT, () => {
  const ips = localIps();
  console.log(`\nCrit server radi na portu ${PORT}`);
  console.log(`  ovaj racunar:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  mreza/telefon: http://${ip}:${PORT}`);
  console.log("");
});

// Server radi na racunaru u igraonici, bez nadzora. Jedan neuhvacen previd ne
// sme da ugasi proces usred smene i ostavi 13 racunara bez naplate - greska se
// zapise, a server nastavlja da radi.
//
// Zapis ide i u LOGOVE, ne samo u konzolu. Prozor sa serverom niko ne gleda i
// cesto je minimizovan; ako nesto pukne u devet uvece, vlasnik to sutra vidi u
// panelu (Logovi > Sistem) umesto da nagadja zasto se nesto cudno ponasalo.
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
