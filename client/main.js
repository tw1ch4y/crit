const { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFile } = require("node:child_process");
const https = require("node:https");
const { scryptSync, timingSafeEqual, createHash } = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const WebSocket = require("ws");
const { ocistiSesiju, racunarJeZasticen, STOP_FAJL } = require("./ciscenje.js");
const { snimiStanje, ugasiNoveProcese, pokreniStrazu, spisakZaPanel, ugasiProces } = require("./procesi.js");
const winPod = require("./windows-podesavanja.js");
const { napraviSkriptu, napraviOsigurac, KOD_OSIGURAC, NUMERACIJA } = require("./nadogradnja-skripta.js");
const { LokalnaSesija, snimiPotpisano, ucitajPotpisano } = require("./lokalna-sesija.js");

const DEV = process.argv.includes("--dev");

// Jedan primerak po nalogu. Drugi (autostart, osigurač posle nadogradnje,
// prečica) vraća postojeći u prvi plan i izlazi pre nego što dotakne politike
// ili vezu sa serverom. `isQuitting` ide pre `quit()`, inače `before-quit`
// poništava izlaz.
const JEDINI_PRIMERAK = app.requestSingleInstanceLock();
if (!JEDINI_PRIMERAK) {
  app.isQuitting = true;
  app.quit();
}

// Launcher menja Windows (politike u registru, plan napajanja, gašenje
// programa iz sesije, čišćenje sesije). Čišćenje je nepovratno, pa se sve to
// radi samo kad su ispunjena oba uslova:
//   - nije izričito isključeno (--dev, --no-lock, bez-zakljucavanja.txt);
//   - launcher je instaliran (`app.isPackaged`). Nepakovan se zaključava samo
//     uz --zakljucaj.
// Treća, nezavisna brava je CRIT-NE-DIRAJ.txt u ciscenje.js.
const PAKOVAN = app.isPackaged;
const IZRICITO_ZAKLJUCAJ = process.argv.includes("--zakljucaj");
const NO_LOCK = DEV || process.argv.includes("--no-lock") ||
  fs.existsSync(path.join(path.dirname(process.execPath), "bez-zakljucavanja.txt")) ||
  (!PAKOVAN && !IZRICITO_ZAKLJUCAJ);

// Preskočeno zaključavanje se ispisuje, da se na računaru u igraonici ne
// zameni sa kvarom.
if (NO_LOCK && !PAKOVAN && !DEV) {
  console.log(
    "\n  Launcher NE dira Windows: pokrenut je iz izvornog koda, ne iz instalacije.\n" +
    "  Ne menjaju se politike u registru, plan napajanja, niti se čiste tragovi sesije.\n" +
    "  Na računaru u igraonici koristi instaler. Za nepakovanu probu SA zaključavanjem: --zakljucaj\n");
}
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

let win = null;
let ws = null;
let reconnectTimer = null;
let config = loadConfig();
const spawnedGames = new Set();

// Sesija i poslednji katalog se čuvaju u nalogu korisnika, da launcher
// pokrenut dok server ne radi zna i sesiju i katalog (vidi lokalna-sesija.js).
const SESIJA_PATH = path.join(app.getPath("userData"), "sesija.json");
const KATALOG_PATH = path.join(app.getPath("userData"), "katalog.json");
const lokalna = new LokalnaSesija({ putanja: SESIJA_PATH, token: config.token });
let kesiraniKatalog = null;
const naVezi = () => !!ws && ws.readyState === WebSocket.OPEN;

// ---------- Config ----------
// Osoblje obično upiše samo IP ili IP:port; adresa se dopunjuje do punog oblika.
function normalizeHost(h) {
  h = String(h || "").trim().replace(/\s+/g, "").replace(/\/+$/, "");
  if (!h) return "";
  if (!/^https?:\/\//i.test(h)) h = "http://" + h;
  try {
    const u = new URL(h);
    // Samo IP ili ime računara; greška u kucanju se odbija odmah umesto da
    // launcher ostane na "Povezivanje".
    if (!/^[a-z0-9.-]+$/i.test(u.hostname)) return "";
    if (!u.port && u.protocol === "http:") u.port = "8095"; // podrazumevani port servera
    return u.origin;
  } catch {
    return "";
  }
}

// Podrazumevana adresa servera iz podesavanja.json pored programa; pri
// podešavanju ostaje samo token.
function defaultHost() {
  const kandidati = [
    path.join(process.resourcesPath || "", "podesavanja.json"),
    path.join(path.dirname(process.execPath), "podesavanja.json"),
    path.join(__dirname, "podesavanja.json"),
  ];
  for (const p of kandidati) {
    try { return normalizeHost(JSON.parse(fs.readFileSync(p, "utf8")).host); } catch {}
  }
  return "";
}

// Servisni PIN se proverava lokalno. Traži se za promenu adrese servera
// (inače bi igrač sa izvučenim kablom preusmerio računar na svoj server) i za
// izlaz iz kioska kad server ne radi.
const FABRICKI_PIN = "1234";
function pinIzPodesavanja() {
  const kandidati = [
    path.join(process.resourcesPath || "", "podesavanja.json"),
    path.join(path.dirname(process.execPath), "podesavanja.json"),
    path.join(__dirname, "podesavanja.json"),
  ];
  for (const p of kandidati) {
    try {
      const v = String(JSON.parse(fs.readFileSync(p, "utf8")).servisniPin || "").trim();
      if (v) return v;
    } catch {}
  }
  return "";
}

// PIN sa servera stiže kao heš i pamti se u config.json u nalogu korisnika,
// koji nadogradnja ne dira, pa važi i bez veze sa serverom.
function zapamtiServisniPin(p) {
  const stari = config.servisniPinHes || null;
  const novi = p && p.hes && p.so ? { hes: p.hes, so: p.so } : null;
  if ((stari?.hes || null) === (novi?.hes || null)) return; // ništa novo
  try {
    config = { ...config, servisniPinHes: novi };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(novi ? "servisni PIN primljen sa servera" : "servisni PIN sa servera obrisan");
  } catch (e) { console.error("servisni PIN nije zapamćen:", e.message); }
}

// Prihvata se, redom: PIN sa servera, ručno upisan PIN iz podesavanja.json
// koji nije fabrički, i fabrički 1234 - ali samo dok server nije poslao svoj.
// Izvora je namerno više jer je ovo jedini izlaz iz kioska.
const imaPinSaServera = () => !!(config.servisniPinHes && config.servisniPinHes.hes);

function proveriPin(uneti) {
  const pin = String(uneti || "").trim();
  if (!pin) return false;

  const saServera = config.servisniPinHes;
  if (saServera?.hes && saServera?.so) {
    try {
      const test = scryptSync(pin, Buffer.from(saServera.so, "hex"), 32).toString("hex");
      if (timingSafeEqual(Buffer.from(test, "hex"), Buffer.from(saServera.hes, "hex"))) return true;
    } catch {}
  }
  const lokalni = servisniPin();
  // Fabrički prolazi samo dok sa servera nije stigao pravi PIN.
  if (lokalni === FABRICKI_PIN && saServera?.hes) return false;
  return pin === lokalni;
}

function servisniPin() {
  const izFajla = pinIzPodesavanja();
  const zapamcen = String(config.servisniPin || "").trim();
  if (izFajla && izFajla !== FABRICKI_PIN) {
    if (izFajla !== zapamcen) {
      try {
        config = { ...config, servisniPin: izFajla };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      } catch {}
    }
    return izFajla;
  }
  return zapamcen || izFajla || FABRICKI_PIN;
}

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    c.host = normalizeHost(c.host) || defaultHost(); // popravi ranije snimljenu adresu
    return c;
  } catch {
    return { host: defaultHost(), token: "", configured: false };
  }
}
function saveConfig(c) {
  const host = normalizeHost(c.host);
  const token = String(c.token || "").trim();
  if (!host || !token) return { ok: false, error: "Unesi adresu servera i token računara." };
  config = { ...config, ...c, host, token, configured: true };
  lokalna.postaviToken(token);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return { ok: true, host };
}

// Briše podešavanje i vraća launcher na ekran za podešavanje.
function resetConfig() {
  try { fs.unlinkSync(CONFIG_PATH); } catch {}
  config = { host: "", token: "", configured: false };
  // Novi server, novi token: zapis sesije i katalog starog više ne važe.
  lokalna.obrisi();
  lokalna.postaviToken("");
  kesiraniKatalog = null;
  try { fs.unlinkSync(KATALOG_PATH); } catch {}
  try { if (ws) ws.close(); } catch {}
  clearTimeout(reconnectTimer);
  sendToRenderer("need-setup", {});
  focusLauncher();
}

// ---------- Prozor ----------
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().size;
  win = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false,
    fullscreen: !DEV,
    kiosk: !DEV,
    alwaysOnTop: !DEV,
    autoHideMenuBar: true,
    backgroundColor: "#0a0d14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: DEV,
    },
  });
  // Od ovog trenutka greška više ne ruši program - vidi mrežu uz javiProblem.
  prozorPostojao = true;
  // svako (ponovno) učitavanje stranice resetuje spremnost renderera
  win.webContents.on("did-start-loading", () => { rendererReady = false; });

  // Pad procesa ekrana (memorija, GPU) ostavio bi crn, zaključan ekran.
  // Prozor se vraća sam, a osoblje dobija zapis sa imenom računara.
  win.webContents.on("render-process-gone", (_e, detalji) => {
    const razlog = detalji?.reason || "nepoznato";
    javiProblem("ekran_pukao", `Ekran launchera je pukao (${razlog}) - vraćam ga`);
    if (razlog === "clean-exit" || app.isQuitting) return;
    try { win.reload(); } catch { app.relaunch(); app.exit(0); }
  });
  // Zamrznut ekran igrač doživljava isto kao pokvaren računar.
  win.on("unresponsive", () => {
    javiProblem("ekran_ne_reaguje", "Ekran launchera ne reaguje - vraćam ga");
    try { win.reload(); } catch {}
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (!DEV) win.setAlwaysOnTop(true, "screen-saver");

  // Zabrani zatvaranje prozora (osim preko admin izlaza)
  win.on("close", (e) => {
    if (!app.isQuitting) e.preventDefault();
  });

  // blokiraj otvaranje novih prozora iz sadržaja
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

// ---------- WebSocket ka serveru ----------
function connectWs() {
  if (!config.configured || !config.host || !config.token) {
    sendToRenderer("need-setup", {});
    return;
  }
  clearTimeout(reconnectTimer);

  // Stara veza se gasi bez svojih slušalaca. Server drži jednu vezu po
  // računaru, pa bi njen zakasneli "close" javio da veze nema dok nova radi i
  // zakazao još jedno povezivanje.
  if (ws) {
    const stara = ws;
    ws = null;
    try { stara.removeAllListeners(); } catch {}
    // Veza koja se još povezuje javlja grešku na close(); bez slušaoca bi to
    // bila neuhvaćena greška.
    try { stara.on("error", () => {}); } catch {}
    try { stara.close(); } catch {}
    try { stara.terminate(); } catch {}
  }

  // Verzija ide uz adresu, da se na strani Računari vidi koji računar ima
  // koji launcher.
  const url = config.host.replace(/^http/i, "ws") + "/ws?kind=client&token=" + encodeURIComponent(config.token)
    + "&v=" + encodeURIComponent(app.getVersion())
    // Numeracija verzija (vidi server/src/verzije.js); bez nje server launcher
    // vidi kao stari i ne šalje mu nadogradnju.
    + "&n=" + NUMERACIJA
    // Postoji neprijavljen rad bez servera: server ne vraća sesiju dok ne
    // stigne izveštaj (clientOfflineIzvestaj).
    + (lokalna.izvestaj() ? "&offline=1" : "");
  let sveza;
  try { sveza = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }
  ws = sveza;
  // Događaji sa zamenjene veze se ignorišu.
  const jeAktuelna = () => ws === sveza;

  sveza.on("open", () => {
    if (!jeAktuelna()) return;
    lokalna.postaviVezu(true);
    // Izveštaj o radu bez servera ide pre svega ostalog.
    const izvestaj = lokalna.izvestaj();
    if (izvestaj) wsSend({ t: "offline_izvestaj", ...izvestaj });
    if (neispravanZapisZaJavu) {
      javiProblem("sesija_zapis", `Zapis sesije na ovom računaru nije prošao proveru (${neispravanZapisZaJavu}) - nije korišćen`);
      neispravanZapisZaJavu = null;
    }
    sendToRenderer("ws-status", { connected: true });
    // Uz MAC adrese (Wake-on-LAN) ide i da li je servisni PIN još fabrički;
    // panel to prikazuje po računaru.
    wsSend({ t: "sys_info", nics: localNics(), fabrickiPin: !imaPinSaServera() && servisniPin() === FABRICKI_PIN });
    // Neuspela prethodna nadogradnja se javlja čim postoji veza.
    javiIshodNadogradnje();
  });
  sveza.on("message", (buf) => {
    if (!jeAktuelna()) return;
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    handleServerMsg(msg);
    sendToRenderer("server-msg", msg);
  });
  sveza.on("close", () => {
    if (!jeAktuelna()) return;
    lokalna.postaviVezu(false);
    sendToRenderer("ws-status", { connected: false });
    // Igrač usred sesije ne čeka sledeći otkucaj da vidi svoje stanje.
    if (lokalna.aktivna()) posaljiLokalnoStanje();
    scheduleReconnect();
  });
  sveza.on("error", () => {});

  clearInterval(connectWs._hb);
  connectWs._hb = setInterval(() => {
    // Mirovanje meri Windows (poslednji dodir tastature ili miša), pa važi i
    // u igri preko celog ekrana.
    wsSend({ t: "heartbeat", mirovanje: sesijaAktivna ? powerMonitor.getSystemIdleTime() : 0 });
  }, 20000);
}
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectWs, 3000);
}
function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// IPv4 kartice sa MAC adresom; server bira LAN karticu po IP-u.
function localNics() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal && i.mac && i.mac !== "00:00:00:00:00:00") {
        out.push({ ip: i.address, mac: i.mac });
      }
    }
  }
  return out;
}

// Potvrda PIN-a osoblja sa servera (verify_pin -> pin_ok). Glavni proces je
// vidi kroz svoju vezu, pa je ekran ne može izmisliti (vidi admin-exit).
const PIN_VAZI_MS = 15000;
let pinPotvrdjenDo = 0;

// Poruke servera koje glavni proces obrađuje sam.
function handleServerMsg(msg) {
  pratiLokalnuSesiju(msg);
  if (msg.t === "pin_ok") pinPotvrdjenDo = Date.now() + PIN_VAZI_MS;
  // Servisni PIN stiže uz "welcome" i posebno kad se promeni u panelu.
  if (msg.t === "welcome" && "servisniPin" in msg) zapamtiServisniPin(msg.servisniPin);
  // Spisak onoga što se sme pokrenuti - vidi zapamtiDozvoljeno.
  if (msg.t === "welcome" || msg.t === "catalog") zapamtiDozvoljeno(msg);
  // Boja kuće za obaveštenja preko igre: to je zaseban prozor bez CSS-a
  // launchera.
  if (msg.t === "welcome" && msg.brend?.akcenat) zapamtiBojuKuce(msg.brend.akcenat);
  if (msg.t === "brend" && msg.brend?.akcenat) zapamtiBojuKuce(msg.brend.akcenat);
  if (msg.t === "servisni_pin") {
    zapamtiServisniPin(msg.pin);
    // Panel odmah vidi da je ova mašina primila nov PIN.
    wsSend({ t: "sys_info", nics: localNics(), fabrickiPin: !imaPinSaServera() && servisniPin() === FABRICKI_PIN });
    return;
  }
  // Daljinski spisak procesa za panel.
  if (msg.t === "procesi_trazi") {
    spisakZaPanel()
      .then((spisak) => wsSend({ t: "procesi_lista", zahtev: msg.zahtev, spisak }))
      .catch(() => wsSend({ t: "procesi_lista", zahtev: msg.zahtev, spisak: [], greska: "Popis procesa nije uspeo" }));
    return;
  }
  if (msg.t === "procesi_ugasi") {
    ugasiProces(msg.pid)
      .then((r) => wsSend({ t: "proces_ugasen", zahtev: msg.zahtev, ...r }))
      .catch(() => wsSend({ t: "proces_ugasen", zahtev: msg.zahtev, ok: false, greska: "Gašenje nije uspelo" }));
    return;
  }
  // Pri prijavi se pamti šta je već radilo, da bi se na kraju sesije ugasilo
  // samo ono što je pokrenuo igrač (igre preko Steam-a rade pod drugim imenom).
  if (msg.t === "login_ok") {
    sesijaAktivna = true;
    javljeniPragovi = new Set();
    showBackdrop(); // od sada zastor pokriva desktop dok god traje sesija
    proveriVreme(msg.remainingSeconds, true); // pri prijavi samo zapamti stanje
    // Sesija koja se nastavlja posle prekida veze ne snima zatečeno stanje
    // ponovo: igre pokrenute u međuvremenu ne smeju da postanu "zatečene".
    if (!NO_LOCK && !(msg.nastavak && procesiPreSesije)) snimiStanje().then((s) => { procesiPreSesije = s; }).catch(() => {});
    pokreniStrazuSesije();
    // Miš i zvuk pre ovog igrača, da se vrate na kraju sesije.
    if (!(msg.nastavak && podesavanjaPreSesije)) winPod.procitajSve().then((s) => { podesavanjaPreSesije = s; }).catch(() => {});
  }
  if (msg.t === "balance") proveriVreme(msg.remainingSeconds);

  // Poruka osoblja mora da stigne i kad je igrač u punom ekranu.
  if (msg.t === "message" && msg.text) {
    prikaziObavestenje({ naslov: "Poruka od osoblja", opis: msg.text, vrsta: "poruka", boja: "plava", trajanje: 15000 });
  }
  if (msg.t === "mirovanje") odbrojMirovanje(msg.preostalo);
  if (msg.t === "locked" || msg.t === "to_login") {
    sesijaAktivna = false;
    zavrsiSesiju();
    setPolicies(true); // vrati zaključavanje ako ga je osoblje privremeno skinulo
    focusLauncher();
  }
  if (msg.t === "force_logout") {
    sesijaAktivna = false;
    zavrsiSesiju();
    focusLauncher();
  }
  if (msg.t === "command") runCommand(msg.cmd);
  if (msg.t === "install") runInstall(msg);
  if (msg.t === "nadogradnja") primiNadogradnju(msg);
}

// Straža gasi programe pokrenute iz Preuzimanja, Temp-a i sa radne površine.
// Jedan pomoćni proces na sniženom prioritetu radi koliko i sesija (vidi
// pokreniStrazu u procesi.js).
let straza = null;
function pokreniStrazuSesije() {
  if (NO_LOCK || straza || !podesavanje("blokirajPreuzeteProgram", true)) return;
  straza = pokreniStrazu({
    obavesti: (ime) => {
      sendToRenderer("blokirano", { ime });
      wsSend({ t: "log_klijent", tekst: `Blokirano pokretanje preuzetog programa: ${ime}` });
    },
    kvar: (opis) => javiProblem("straza", opis),
  });
}
function zaustaviStrazu() {
  if (!straza) return;
  try { straza.zaustavi(); } catch {}
  straza = null;
}

function podesavanje(kljuc, podrazumevano) {
  try {
    for (const m of [process.resourcesPath, path.dirname(process.execPath), __dirname].filter(Boolean)) {
      try {
        const v = JSON.parse(fs.readFileSync(path.join(m, "podesavanja.json"), "utf8"))[kljuc];
        if (v !== undefined) return v;
      } catch {}
    }
  } catch {}
  return podrazumevano;
}

// Obaveštenje preko igre: upozorenje o vremenu i poruke osoblja idu u
// zaseban prozor iznad svega.
let overlay = null;
let overlayTajmer = null;
// Fabrička boja kuće (ista kao u launcher.css), dok ne stigne sa servera.
let bojaKuce = "#2f6ae8";
function zapamtiBojuKuce(heks) {
  if (/^#[0-9a-f]{6}$/i.test(String(heks || ""))) bojaKuce = String(heks).toLowerCase();
}

// Položaj se računa iz trenutne rezolucije pri svakom prikazivanju; igre
// menjaju rezoluciju, a obaveštenje na staroj koordinati bi ispalo van ekrana.
function overlayMere() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.max(280, Math.min(660, width - 40));
  return { width: w, height: 110, x: Math.round((width - w) / 2), y: 0 };
}

function createOverlay() {
  if (DEV) return null;
  if (overlay && !overlay.isDestroyed()) return overlay;
  overlay = new BrowserWindow({
    ...overlayMere(),
    frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, focusable: false, show: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "overlay-preload.js"), contextIsolation: true },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setIgnoreMouseEvents(true); // ne sme da hvata klikove umesto igre
  overlay.loadFile(path.join(__dirname, "renderer", "overlay.html"));
  overlay.on("close", (e) => { if (!app.isQuitting) e.preventDefault(); });
  return overlay;
}

function prikaziObavestenje({ naslov, opis = "", vrsta = "vreme", boja = "", trajanje = 7000 }) {
  const o = createOverlay();
  if (!o || o.isDestroyed()) return;
  const posalji = () => {
    o.webContents.send("overlay-prikazi", { naslov, opis, vrsta, boja, kuca: bojaKuce });
    // Položaj se namešta pred svako prikazivanje: igra je u međuvremenu mogla da
    // promeni rezoluciju, a obaveštenje koje je ostalo na staroj koordinati
    // završi van ekrana - i upozorenje o vremenu niko ne vidi.
    try { o.setBounds(overlayMere()); } catch {}
    o.showInactive(); // nikad ne otima fokus igri
    o.setAlwaysOnTop(true, "screen-saver");
    clearTimeout(overlayTajmer);
    overlayTajmer = setTimeout(() => { try { o.hide(); } catch {} }, trajanje);
  };
  if (o.webContents.isLoading()) o.webContents.once("did-finish-load", posalji);
  else posalji();
}

function sakrijObavestenje() {
  clearTimeout(overlayTajmer);
  if (overlay && !overlay.isDestroyed()) try { overlay.hide(); } catch {}
}

// Odbrojavanje pred zatvaranje sesije zbog mirovanja. Server javi da je vreme
// isteklo, ali brojanje ide lokalno - da se poruka skine u istom trenutku kad
// igrač pomeri miš, a ne tek na sledećem heartbeat-u za dvadesetak sekundi.
let mirovanjeTajmer = null;
function odbrojMirovanje(preostalo) {
  clearInterval(mirovanjeTajmer);
  mirovanjeTajmer = null;
  if (preostalo == null) return sakrijObavestenje();

  let ostalo = Math.max(1, Math.round(preostalo));
  const crtaj = () => prikaziObavestenje({
    naslov: "Nema aktivnosti za ovim računarom",
    opis: `Sesija se zatvara za ${ostalo} s. Pomeri miš ili pritisni taster da nastaviš.`,
    vrsta: "vreme",
    trajanje: 5000,
  });
  crtaj();

  mirovanjeTajmer = setInterval(() => {
    if (powerMonitor.getSystemIdleTime() < 5) {
      clearInterval(mirovanjeTajmer);
      mirovanjeTajmer = null;
      sakrijObavestenje();
      wsSend({ t: "heartbeat", mirovanje: 0 }); // javi serveru odmah da je igrač tu
      return;
    }
    if (--ostalo <= 0) { clearInterval(mirovanjeTajmer); mirovanjeTajmer = null; return; }
    crtaj();
  }, 1000);
}

// Pragovi upozorenja u minutima. Svaki se javi jednom po sesiji.
const PRAGOVI = [30, 15, 10, 5, 2, 1];
let javljeniPragovi = new Set();
// tiho = samo zapamti dokle se stiglo, bez prikazivanja (pri prijavi i
// nastavku sesije).
function proveriVreme(preostaloSek, tiho = false) {
  if (preostaloSek == null || !sesijaAktivna) return;
  const min = Math.ceil(preostaloSek / 60);
  // Tiho se pamte samo pragovi koji su već prošli (strogo veće), ne i onaj u
  // kom je igrač sada - inače bi gost prijavljen sa manje od minut ostao bez
  // ijednog upozorenja. Prag koji je dopunom ponovo iznad preostalog vremena se
  // zaboravlja, da bi se javio opet.
  for (const p of [...javljeniPragovi]) if (min > p) javljeniPragovi.delete(p);

  const dostignuti = PRAGOVI.filter((p) => (tiho ? min < p : min <= p));
  const novi = dostignuti.filter((p) => !javljeniPragovi.has(p));
  if (!novi.length) return;
  novi.forEach((p) => javljeniPragovi.add(p));
  if (tiho) return;

  const p = Math.min(...novi); // ako je preskočeno više pragova, javi najhitniji
  const hitno = p <= 5;
  prikaziObavestenje({
    naslov: p === 1 ? "Ostao ti je još 1 minut" : `Ostalo ti je još ${p} minuta`,
    opis: hitno ? "Sačuvaj igru i javi se osoblju za dopunu." : "Za dopunu se javi osoblju.",
    vrsta: "vreme",
    boja: hitno ? "" : "zuta",
    trajanje: hitno ? 12000 : 7000,
  });
  // I zvuk: preko igre u ekskluzivnom punom ekranu Windows često ne iscrta
  // obaveštenje, a launcher se čuje i kad je iza igre.
  sendToRenderer("vreme-istice", { minuta: p, hitno });
}

let procesiPreSesije = null;

// Miš i zvuk koje je igrač podesio važe samo za njegovu sesiju; na kraju se
// vraća zatečeno stanje.
let podesavanjaPreSesije = null;
function vratiPodesavanja() {
  const s = podesavanjaPreSesije;
  podesavanjaPreSesije = null;
  if (!s) return;
  if (s.mis) winPod.primeniMis(s.mis).catch(() => {});
  if (s.zvuk && s.zvuk.jacina != null) winPod.primeniZvuk({ jacina: s.zvuk.jacina }).catch(() => {});
}

function zavrsiSesiju() {
  vratiPodesavanja();
  zaustaviStrazu();
  javljeniPragovi = new Set();
  clearInterval(mirovanjeTajmer);
  mirovanjeTajmer = null;
  try { if (overlay && !overlay.isDestroyed()) overlay.hide(); } catch {}
  killAllGames();
  closeBrowser();
  if (!NO_LOCK && procesiPreSesije) {
    ugasiNoveProcese(procesiPreSesije, { log: (m) => console.log(m) })
      .catch(() => {})
      .finally(() => { procesiPreSesije = null; });
  }
  ocistiTragove(); // sledeći igrač ne sme da zatekne tuđe prijave
}

// Čišćenje tragova prethodnog igrača (vidi ciscenje.js). Brisanje je
// asinhrono, a nova prijava čeka da se završi (vidi to-server).
let posaoCiscenja = null;
function ocistiTragove() {
  if (posaoCiscenja) return;
  posaoCiscenja = new Promise((res) => setTimeout(res, 1500)) // da se pregledači i igre stvarno ugase
    .then(obrisiTragoveSada)
    .catch((e) => console.error("čišćenje:", e?.message || e))
    .finally(() => { posaoCiscenja = null; });
}
async function obrisiTragoveSada() {
  const r = ocistiSesiju({
    dozvoljeno: !NO_LOCK,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
    dirname: __dirname,
    log: (m) => console.log(m),
  });
  await r.posao;
  if (r.radjeno) wsSend({ t: "log_klijent", tekst: "Očišćeni tragovi prethodnog igrača" });
}

// ---------- Daljinska instalacija ----------
function reportInstall(program, state, message) {
  wsSend({ t: "install_status", program, state, message });
}
// Preuzimanje fajla koji će biti pokrenut. Povratni poziv se zove tačno
// jednom, a veličina se poredi sa najavljenom, da nedovršen fajl ne prođe kao
// gotov.
function downloadFile(url, dest, cb, redirects = 0) {
  const mod = url.startsWith("https") ? https : http;
  let odgovoreno = false;
  const gotovo = (greska) => {
    if (odgovoreno) return;
    odgovoreno = true;
    // Nedovršen fajl se briše.
    if (greska) { try { fs.unlinkSync(dest); } catch {} }
    cb(greska);
  };

  const req = mod.get(url, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
      res.resume();
      if (odgovoreno) return;
      // Location sme da bude relativan ("/download/setup.exe").
      let sledeci;
      try { sledeci = new URL(res.headers.location, url).href; }
      catch { return gotovo(new Error("neispravno preusmerenje: " + res.headers.location)); }
      odgovoreno = true; // dalje odgovara pozvani
      return downloadFile(sledeci, dest, cb, redirects + 1);
    }
    if (res.statusCode !== 200) { res.resume(); return gotovo(new Error("HTTP " + res.statusCode)); }

    const najavljeno = Number(res.headers["content-length"]) || 0;
    let skinuto = 0;
    res.on("data", (d) => { skinuto += d.length; });

    const file = fs.createWriteStream(dest);
    res.pipe(file);
    res.on("error", (e) => { try { file.destroy(); } catch {} gotovo(e); });
    file.on("error", (e) => gotovo(e));
    file.on("finish", () => file.close(() => {
      if (najavljeno && skinuto !== najavljeno) {
        return gotovo(new Error(`preuzeto ${skinuto} od ${najavljeno} bajtova - veza je pukla nasred`));
      }
      if (!skinuto) return gotovo(new Error("preuzet prazan fajl"));
      gotovo(null);
    }));
  });
  req.on("error", (e) => gotovo(e));
  req.setTimeout(180000, () => req.destroy(new Error("Isteklo vreme preuzimanja")));
}
function runInstall({ name, url, args }) {
  reportInstall(name, "downloading", "Preuzimam instalaciju...");
  try {
    const dir = path.join(os.tmpdir(), "crit-install");
    fs.mkdirSync(dir, { recursive: true });
    let base = "setup.exe";
    try { base = decodeURIComponent(new URL(url).pathname.split("/").pop()) || base; } catch {}
    if (!/\.(exe|msi)$/i.test(base)) base += ".exe";
    const dest = path.join(dir, Date.now() + "-" + base);
    downloadFile(url, dest, (err) => {
      if (err) return reportInstall(name, "error", "Preuzimanje nije uspelo: " + err.message);
      reportInstall(name, "installing", "Instaliram...");
      try {
        let cmd, cargs;
        if (/\.msi$/i.test(dest)) { cmd = "msiexec"; cargs = ["/i", dest, ...(args ? args.split(" ").filter(Boolean) : ["/qn"])]; }
        else { cmd = dest; cargs = args ? args.split(" ").filter(Boolean) : []; }
        const child = spawn(cmd, cargs, { windowsHide: true });
        // Instalacija se briše kad završi, da se instaleri ne gomilaju u Temp-u.
        const pospremi = () => { try { fs.unlinkSync(dest); } catch {} };
        child.on("exit", (code) => {
          reportInstall(name, code === 0 ? "done" : "error", code === 0 ? "Instalirano" : "Instalacija je vratila kod " + code);
          pospremi();
        });
        child.on("error", (e) => { reportInstall(name, "error", e.message); pospremi(); });
      } catch (e) { reportInstall(name, "error", e.message); }
    });
  } catch (e) { reportInstall(name, "error", e.message); }
}

// ---------- Nadogradnja launchera ----------
//
// Računar preuzima instaler sa servera na koji je već vezan, svojim tokenom;
// u poruci nema adrese, pa podmetnuta poruka ne može da pokrene tuđi program.
// Pre pokretanja se proveravaju veličina i sha256 otisak. Računar na kom neko
// igra i zaštićen razvojni računar se ne nadograđuju.
const NADOGRADNJA_DIR = path.join(os.tmpdir(), "crit-nadogradnja");
const NADOGRADNJA_ISHOD = path.join(NADOGRADNJA_DIR, "ishod.txt");
let nadogradnjaUToku = false;
// Od puštanja instalacije do gašenja launchera prijava se ne prima: sesija
// bi se prekinula čim instalater krene.
let instalacijaKrece = false;

function javiNadogradnju(verzija, state, message) {
  wsSend({ t: "nadogradnja_status", verzija, state, message });
}

// Poređenje po brojevima, ne kao tekst (2.44.0 je novije od 2.9.0); isto kao
// na serveru.
function verzijaNovija(a, b) {
  const raspakuj = (v) => String(v || "").trim().split(/[.\-+]/).map((d) => parseInt(d, 10));
  const x = raspakuj(a), y = raspakuj(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = Number.isFinite(x[i]) ? x[i] : 0;
    const q = Number.isFinite(y[i]) ? y[i] : 0;
    if (p !== q) return p > q;
  }
  return false;
}

function otisakFajla(put) {
  const h = createHash("sha256");
  const fd = fs.openSync(put, "r");
  try {
    const bafer = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, bafer, 0, bafer.length, null)) > 0) h.update(bafer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest("hex");
}

// Razlog zašto se računar sada ne nadograđuje; prazno znači da sme.
function nadogradnjaSmeta(verzija, numeracija) {
  if (racunarJeZasticen()) return `zaštićen računar (${STOP_FAJL})`;
  // Instalater pored nepakovanog launchera bi napravio drugu, uporednu instalaciju.
  if (!PAKOVAN) return "launcher radi iz izvornog koda, ne iz instalacije";
  if (sesijaAktivna) return "igrač je prijavljen";
  if (spawnedGames.size) return "igra je pokrenuta";
  // Instaler iz druge numeracije se ne pokreće: stari 2.57.0 je brojem veći od
  // v1.0.0.
  if (numeracija !== NUMERACIJA) return "instaler je iz druge numeracije verzija";
  if (!verzijaNovija(verzija, app.getVersion())) return `već ima verziju ${app.getVersion()}`;
  return "";
}

function primiNadogradnju(msg) {
  const verzija = String(msg.verzija || "");
  if (nadogradnjaUToku) return;
  if (!verzija || !/^[\d.]+$/.test(verzija)) return;

  const smeta = nadogradnjaSmeta(verzija, Number(msg.numeracija) || 0);
  if (smeta) {
    // Nije greška: server šalje najavu ponovo čim se računar oslobodi. Razlog se
    // javlja da se u panelu vidi zašto računar čeka.
    javiNadogradnju(verzija, "preskoceno", smeta);
    return;
  }
  if (!config.host || !config.token) return;

  nadogradnjaUToku = true;
  javiNadogradnju(verzija, "preuzimam", "Preuzimam nadogradnju...");
  const odustani = (poruka) => {
    nadogradnjaUToku = false;
    javiNadogradnju(verzija, "greska", poruka);
  };

  let dest;
  try {
    fs.mkdirSync(NADOGRADNJA_DIR, { recursive: true });
    // Ostaci ranijih pokušaja.
    for (const f of fs.readdirSync(NADOGRADNJA_DIR)) {
      if (/\.exe$/i.test(f)) try { fs.unlinkSync(path.join(NADOGRADNJA_DIR, f)); } catch {}
    }
    dest = path.join(NADOGRADNJA_DIR, `launcher-${verzija}.exe`);
  } catch (e) { return odustani("Nema mesta za preuzimanje: " + e.message); }

  const url = config.host.replace(/\/+$/, "") + "/nadogradnja/launcher.exe?token=" + encodeURIComponent(config.token);
  downloadFile(url, dest, (err) => {
    if (err) return odustani("Preuzimanje nije uspelo: " + err.message);
    try {
      const st = fs.statSync(dest);
      if (msg.velicina && st.size !== Number(msg.velicina)) {
        fs.unlinkSync(dest);
        return odustani(`preuzeto ${st.size} od ${msg.velicina} bajtova`);
      }
      if (msg.sha256 && otisakFajla(dest) !== String(msg.sha256).toLowerCase()) {
        fs.unlinkSync(dest);
        return odustani("otisak se ne poklapa - fajl nije onaj koji je server najavio");
      }
    } catch (e) { return odustani("Provera fajla nije uspela: " + e.message); }
    // Ponovna provera posle preuzimanja: za to vreme je neko mogao da sedne za
    // računar.
    const smetaSada = nadogradnjaSmeta(verzija, Number(msg.numeracija) || 0);
    if (smetaSada) {
      try { fs.unlinkSync(dest); } catch {}
      nadogradnjaUToku = false;
      return javiNadogradnju(verzija, "preskoceno", smetaSada);
    }
    pokreniNadogradnju(dest, verzija);
  });
}

// Instalater gasi launcher da bi prepisao njegove fajlove, pa instalaciju
// vodi pomoćna skripta: sačeka da se launcher ugasi, pokrene instalater i vrati
// launcher. Ishod upisuje u fajl, koji launcher čita po povratku (vidi
// javiIshodNadogradnje).
function pokreniNadogradnju(instalater, verzija) {
  const skripta = path.join(NADOGRADNJA_DIR, "nadogradi.cmd");
  const osigurac = path.join(NADOGRADNJA_DIR, "osigurac.cmd");
  const zajedno = { launcher: process.execPath, ishod: NADOGRADNJA_ISHOD, verzija };
  try {
    fs.writeFileSync(skripta, napraviSkriptu({ instalater, ...zajedno }), "utf8");
    fs.writeFileSync(osigurac, napraviOsigurac(zajedno), "utf8");
    try { fs.unlinkSync(NADOGRADNJA_ISHOD); } catch {}
  } catch (e) {
    nadogradnjaUToku = false;
    return javiNadogradnju(verzija, "greska", "Priprema nije uspela: " + e.message);
  }
  javiNadogradnju(verzija, "instaliram", `Instaliram ${verzija} i vraćam se`);
  instalacijaKrece = true;
  const pusti = (put) => {
    const p = spawn("cmd.exe", ["/c", put], { detached: true, stdio: "ignore", windowsHide: true });
    p.unref();
  };
  try {
    pusti(skripta);
    // Osigurač se pokreće odvojeno od glavne skripte.
    pusti(osigurac);
  } catch (e) {
    nadogradnjaUToku = false;
    instalacijaKrece = false;
    return javiNadogradnju(verzija, "greska", "Pokretanje instalacije nije uspelo: " + e.message);
  }
  // Kratka pauza da poruka "instaliram" stigne do servera.
  setTimeout(() => { try { app.exit(0); } catch { process.exit(0); } }, 800);
}

// Ishod prethodne nadogradnje. Ako ga čita nova verzija, nadogradnja je
// prošla i server to vidi po verziji; ako ga čita stara, javlja razlog.
function javiIshodNadogradnje() {
  let red;
  try { red = fs.readFileSync(NADOGRADNJA_ISHOD, "utf8").trim(); } catch { return; }
  try { fs.unlinkSync(NADOGRADNJA_ISHOD); } catch {}
  const [kod, znak, verzija = ""] = red.split(/\s+/);
  // Ishod bez oznake numeracije je iz stare numeracije i ne tiče se ovog launchera.
  if (znak !== "N" + NUMERACIJA) return;
  if (!verzija) return;
  if (!verzijaNovija(verzija, app.getVersion())) return; // stigli smo do nje - proslo je

  // Osigurač je vratio launcher: instalater se nije završio za pet minuta.
  javiNadogradnju(verzija, "greska", kod === KOD_OSIGURAC
    ? `Instalacija ${verzija} se nije završila za pet minuta (instaler je stao ili ` +
      `čeka odobrenje). Launcher je ostao na ${app.getVersion()}.`
    : `Instalacija ${verzija} je vratila kod ${kod}. Launcher je ostao na ${app.getVersion()}.`);
}

// Daljinske komande sa panela.
function runCommand(cmd) {
  if (DEV && ["shutdown", "restart", "logoff"].includes(cmd)) {
    console.log("[DEV] komanda ignorisana:", cmd);
    return;
  }
  // Server pre gašenja zatvara sesiju, pa brisanje tragova igrača tek kreće.
  // Gašenje ga čeka najviše 30 s, da ne ostane pola profila pregledača.
  const posleCiscenja = (fn) => {
    if (!posaoCiscenja) return fn();
    Promise.race([posaoCiscenja, new Promise((r) => setTimeout(r, 30000))]).finally(fn);
  };
  switch (cmd) {
    case "shutdown": posleCiscenja(() => pokreniKomandu("shutdown", ["/s", "/t", "3", "/c", "Kraj smene"])); break;
    case "restart": posleCiscenja(() => pokreniKomandu("shutdown", ["/r", "/t", "3", "/c", "Restart racunara"])); break;
    case "logoff": posleCiscenja(() => pokreniKomandu("shutdown", ["/l"])); break;
    case "reboot_launcher": app.relaunch(); app.isQuitting = true; app.exit(0); break;
  }
}

// Dok je igrač prijavljen, launcher je običan prozor i igrač prebacuje
// prozore sa Alt+Tab. Iznad svega su samo prijava i zaključan ekran.
let sesijaAktivna = false;

function focusLauncher() {
  if (!win || win.isDestroyed()) return;
  clearExternal();
  launchGuardUntil = 0;
  if (!DEV) {
    win.setAlwaysOnTop(!sesijaAktivna, "screen-saver");
    win.setFullScreen(true);
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // Zastor ostaje dok traje sesija, da se iza prozora ne vidi radna površina.
  if (!sesijaAktivna) hideBackdrop();
}

// Zastor: crn prozor preko celog ekrana, ispod igre a iznad radne površine.
// Launcher zato sme da se skloni pred igrom, a radna površina se ne vidi.
let backdrop = null;
function createBackdrop() {
  if (DEV) return null;
  if (backdrop && !backdrop.isDestroyed()) return backdrop;
  const { width, height } = screen.getPrimaryDisplay().size;
  backdrop = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false, fullscreen: true, skipTaskbar: true, show: false,
    backgroundColor: "#070c1c",
    webPreferences: { preload: path.join(__dirname, "backdrop-preload.js"), contextIsolation: true },
  });
  backdrop.loadFile(path.join(__dirname, "renderer", "backdrop.html"));
  backdrop.on("close", (e) => { if (!app.isQuitting) e.preventDefault(); });
  // Fokus na zastoru je nagoveštaj da je igra zatvorena, ne dokaz: igra preko
  // celog ekrana gubi fokus i pri učitavanju ili uz obaveštenje. Launcher preko
  // žive igre bi joj promenio rezoluciju, pa zastor mora da drži fokus bez
  // prekida, a zatim se proverava da li proces igre još radi.
  backdrop.on("focus", () => {
    if (Date.now() < launchGuardUntil) return;
    zastorFokusOd = Date.now();
    setTimeout(potvrdiDaJeIgraGotova, POTVRDA_MS);
  });
  backdrop.on("blur", () => { zastorFokusOd = 0; });
  return backdrop;
}

// Koliko dugo zastor mora da drži fokus da bi se proverilo da li je igra gotova.
const POTVRDA_MS = 3000;
let zastorFokusOd = 0;

function potvrdiDaJeIgraGotova() {
  if (app.isQuitting) return;
  if (!backdrop || backdrop.isDestroyed() || !backdrop.isFocused()) return;
  if (!zastorFokusOd || Date.now() - zastorFokusOd < POTVRDA_MS - 100) return; // fokus je u međuvremenu skakao
  if (Date.now() < launchGuardUntil) return;

  const images = [...new Set([...externalImages, ...[...spawnedGames].map((g) => g.image)])].filter(Boolean);
  if (!images.length) { clearExternal(); focusLauncher(); return; }
  anyRunning(images, (running) => {
    if (running) return;                      // igra je i dalje tu - ne diramo je
    if (Date.now() < launchGuardUntil) return;
    if (!backdrop || backdrop.isDestroyed() || !backdrop.isFocused()) return;
    clearExternal();
    focusLauncher();
  });
}
function showBackdrop() {
  const b = createBackdrop();
  if (!b || b.isDestroyed()) return;
  if (b.isMinimized()) b.restore();
  // Zastor prati trenutnu rezoluciju. Poziva se svake sekunde, pa se mera
  // menja samo kad se razlikuje: nepotreban setBounds ume da trgne igru.
  try {
    const { width, height } = screen.getPrimaryDisplay().size;
    const t = b.getBounds();
    if (t.width !== width || t.height !== height || t.x !== 0 || t.y !== 0) {
      b.setBounds({ x: 0, y: 0, width, height });
    }
  } catch {}
  if (!b.isVisible()) b.showInactive(); // nikad ne otima fokus igri
}
function hideBackdrop() {
  if (backdrop && !backdrop.isDestroyed() && backdrop.isVisible()) backdrop.hide();
}

// Igra ide u prvi plan: prvo zastor preko radne površine, pa se launcher
// sklanja, inače bi se igra otvorila iza njega.
function stepBack() {
  if (!win || win.isDestroyed() || DEV) return;
  showBackdrop();
  win.setAlwaysOnTop(false);
  setTimeout(() => {
    if (win && !win.isDestroyed() && gameActive()) win.minimize();
  }, 250);
}

// Spoljni program (pregledač, Steam) nema proces koji launcher prati, pa se
// pamti da radi i ne otima mu se fokus.
let externalActive = false;
let externalImages = [];
const BROWSER_IMAGES = ["chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "brave.exe"];
// Procesi po kojima se vidi da je spoljni program zatvoren
// (steam:// -> steam.exe, epic:// -> EpicGamesLauncher.exe...).
function protocolImages(url) {
  const shema = String(url).split(":")[0].toLowerCase();
  const mapa = {
    steam: ["steam.exe"],
    epic: ["EpicGamesLauncher.exe"],
    "com.epicgames.launcher": ["EpicGamesLauncher.exe"],
    battlenet: ["Battle.net.exe"],
    riot: ["RiotClientServices.exe"],
    origin: ["Origin.exe"],
    uplay: ["upc.exe"],
    "ubisoftconnect": ["upc.exe"],
    roblox: ["RobloxPlayerBeta.exe"],
    minecraft: ["MinecraftLauncher.exe"],
  };
  return mapa[shema] || BROWSER_IMAGES;
}

function markExternal(images = BROWSER_IMAGES) { externalActive = true; externalImages = images; }
function clearExternal() { externalActive = false; externalImages = []; }

// Pokretač igre (Steam, Riot, Epic) brzo izađe, a igra nastavi pod drugim
// imenom. Posle pokretanja se zato neko vreme ne dira prvi plan.
let launchGuardUntil = 0;
const GUARD_MS = 25000;
function startGuard() { launchGuardUntil = Date.now() + GUARD_MS; }

const gameActive = () =>
  spawnedGames.size > 0 || externalActive || Date.now() < launchGuardUntil;

// Provera da li je pokrenuti program zatvoren pa treba vratiti launcher.
function checkGameGone() {
  if (Date.now() < launchGuardUntil) return;

  // Fokus na zastoru nije dokaz (vidi potvrdiDaJeIgraGotova); dok se zna koji
  // proces treba pitati, pita se on.
  const images = [...new Set([...externalImages, ...[...spawnedGames].map((g) => g.image)])].filter(Boolean);
  if (!images.length && backdrop && !backdrop.isDestroyed() && backdrop.isFocused()
    && zastorFokusOd && Date.now() - zastorFokusOd >= POTVRDA_MS) {
    clearExternal();
    focusLauncher();
    return;
  }
  // Nepoznat proces (igra radi pod drugim imenom): prvi plan se ne dira.
  if (!images.length) return;

  // Provere se ne preklapaju; na zauzetom računaru jedna traje i duže od
  // pet sekundi.
  if (proveraIgreUToku) return;
  proveraIgreUToku = true;
  anyRunning(images, (running) => {
    proveraIgreUToku = false;
    if (!running && Date.now() >= launchGuardUntil) { clearExternal(); focusLauncher(); }
  });
}
let proveraIgreUToku = false;

// Nadzor prozora: vraća launcher posle Win+D, "minimize all" i sličnog. Dok
// igra radi fokus se ne otima.
let watchdog = null;
let tick = 0;
function startWatchdog() {
  if (DEV || watchdog) return;
  watchdog = setInterval(() => {
    if (app.isQuitting) return;
    if (!win || win.isDestroyed()) { createWindow(); return; }

    if (sesijaAktivna) {
      // Sesija u toku: prvi plan se ne dira, samo zastor pokriva radnu površinu.
      if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false);
      showBackdrop();
    } else if (gameActive()) {
      // Nema prijavljenog igrača, ali nešto još radi.
      if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false);
      showBackdrop();
      if (++tick % 5 === 0) checkGameGone();
    } else {
      // Prijava ili zaključan ekran: launcher je iznad svega.
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.showInactive();
      if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, "screen-saver");
      if (!win.isFullScreen()) win.setFullScreen(true);
      if (!win.isFocused()) win.focus();
      hideBackdrop();
    }
  }, 1000);
}

function anyRunning(images, cb) {
  let left = images.length, found = false;
  for (const img of images) {
    isProcessRunning(img, (r) => {
      if (r) found = true;
      if (--left === 0) cb(found);
    });
  }
}

// ---------- RAD BEZ SERVERA ----------
//
// Kad server nije dostupan, launcher vodi sesiju sam: sat ide, upozorenja
// stižu, računar se zaključa kad kredit istekne, igrač sme da se odjavi. Kad se
// veza vrati, server naplati razliku (lokalna-sesija.js, server/src/offline.js).
let neispravanZapisZaJavu = null;

function ucitajRadBezServera() {
  lokalna.postaviToken(config.token);
  lokalna.ucitaj();
  if (lokalna.neispravanZapis) {
    // Zapis koji ne prolazi proveru se ne koristi; ostaje sa strane, a osoblje
    // dobija prijavu.
    try { fs.renameSync(SESIJA_PATH, SESIJA_PATH + ".neispravan"); } catch {}
    neispravanZapisZaJavu = lokalna.neispravanZapis;
  }
  const k = ucitajPotpisano(KATALOG_PATH, config.token);
  if (k.podaci) {
    kesiraniKatalog = k.podaci;
    zapamtiDozvoljeno(k.podaci);
    lokalna.postaviCenu(k.podaci.settings?.ratePerHour);
  }
  // Launcher pokrenut usred sesije (pad, restart računara) je nastavlja; pragovi
  // koji su prošli se pamte tiho.
  if (lokalna.aktivna()) {
    sesijaAktivna = true;
    proveriVreme(lokalna.preostalo(), true);
  }
}

function snimiKatalog(msg) {
  if (msg.t === "welcome") {
    // PIN se čuva u config.json, a stanje interneta brzo zastari.
    const { t, servisniPin, internet, izKesa, ...ostalo } = msg;
    kesiraniKatalog = ostalo;
  } else if (msg.t === "catalog" && kesiraniKatalog) {
    for (const polje of ["shop", "games", "tools"]) if (msg[polje]) kesiraniKatalog[polje] = msg[polje];
  } else return;
  try { snimiPotpisano(KATALOG_PATH, kesiraniKatalog, config.token); } catch {}
}

function pratiLokalnuSesiju(msg) {
  switch (msg.t) {
    case "welcome":
      lokalna.postaviCenu(msg.settings?.ratePerHour);
      snimiKatalog(msg);
      break;
    case "catalog": snimiKatalog(msg); break;
    case "login_ok": lokalna.zapocni(msg); break;
    case "balance": lokalna.sinhronizuj(msg); break;
    case "offline_primljen": lokalna.potvrdi(msg); break;
    case "locked":
    case "to_login":
    case "force_logout":
      // Server je zatvorio sesiju. Zapis koji čeka potvrdu ostaje dok ga server ne
      // obračuna.
      if (!lokalna.cekaPotvrdu()) lokalna.obrisi();
      break;
  }
}

function posaljiLokalnoStanje() {
  const s = lokalna.stanje();
  if (!s || s.kraj) return;
  sendToRenderer("server-msg", {
    t: "lokalno_stanje", player: s.igrac,
    balance: lokalna.procenaKredita(), remainingSeconds: lokalna.preostalo(),
  });
}

function tikLokalneSesije() {
  lokalna.tik();
  if (!lokalna.aktivna() || naVezi()) return;
  const ostalo = lokalna.preostalo();
  // Upozorenja pred istek idu i bez servera: isti pragovi, isti zvuk.
  if (ostalo !== null) proveriVreme(ostalo);
  posaljiLokalnoStanje();
  if (ostalo === 0) zavrsiBezServera("vreme");
}

function zavrsiBezServera(razlog) {
  if (!lokalna.zavrsi(razlog)) return;
  sesijaAktivna = false;
  zavrsiSesiju();
  if (razlog === "vreme") {
    setPolicies(true);
    sendToRenderer("server-msg", { t: "locked", reason: "time", bezServera: true });
  } else {
    sendToRenderer("server-msg", { t: "to_login", bezServera: true });
  }
  focusLauncher();
}

// Spoljne komande idu kroz execFile, bez cmd.exe i uvek sa rokom: kod `exec`
// rok gasi samo cmd, a zaglavljen program ispod njega ostaje.
const ROK_KOMANDE = 10000;
function pokreniKomandu(program, argumenti, gotovo = () => {}, rok = ROK_KOMANDE) {
  try {
    execFile(program, argumenti, { windowsHide: true, timeout: rok }, (greska, izlaz) => gotovo(greska, izlaz));
  } catch (e) {
    gotovo(e, "");
  }
}

// ---------- Pokretanje igara ----------
const recentLaunch = new Map(); // putanja -> vreme (spreči dupli klik)

// Da li proces sa tim imenom još radi (igra koju je pokretač pokrenuo pa
// izašao), da se ne otme fokus igri.
function isProcessRunning(imageName, cb) {
  if (!imageName) return cb(false);
  // Kad provera ne uspe, odgovor je "radi": suprotno bi launcher poslalo preko
  // žive igre. Sledeća provera to ispravlja za par sekundi.
  pokreniKomandu("tasklist", ["/FI", `IMAGENAME eq ${imageName}`, "/NH"], (err, stdout) => {
    cb(err ? true : String(stdout).toLowerCase().includes(String(imageName).toLowerCase()));
  }, 8000);
}

// Argumenti se dele po razmacima, a navodnici čuvaju celinu
// ("-game C:\Moje igre\mod").
function razdvojArgumente(s) {
  const out = String(s || "").match(/"[^"]*"|\S+/g) || [];
  return out.map((a) => a.replace(/^"|"$/g, ""));
}

// Igra koja neće da se pokrene javlja se i serveru. `id` i `vrsta` služe
// serveru da kvar upiše uz samu stavku kataloga.
function javiDaNeRadi(igra, razlog, id, vrsta) {
  try { wsSend({ t: "igra_ne_radi", igra: String(igra || "").slice(0, 80), razlog, id, vrsta }); } catch {}
}

// Kvar na samom launcheru ide u panel sa imenom računara.
function javiProblem(vrsta, opis) {
  console.error("[launcher]", vrsta, opis);
  try { wsSend({ t: "klijent_problem", vrsta: String(vrsta).slice(0, 40), opis: String(opis).slice(0, 200) }); } catch {}
}

// Neuhvaćena greška u glavnom procesu Electrona gasi launcher i ostavlja
// računar bez kioska i naplate. Posle prvog prozora greška se zapisuje i
// javlja panelu, a launcher radi dalje (nadzor po potrebi pravi nov prozor).
// Pre prvog prozora launcher izlazi: proces bez prozora bi visio, a autostart
// ga pri sledećoj prijavi ne bi pokrenuo ponovo.
let prozorPostojao = false;
for (const [dogadjaj, vrsta] of [["uncaughtException", "neuhvacena-greska"], ["unhandledRejection", "neobradjeno-odbijanje"]]) {
  process.on(dogadjaj, (e) => {
    if (app.isQuitting) return;
    const tekst = String(e?.stack || e?.message || e || "").split("\n").slice(0, 2).join(" ");
    if (!prozorPostojao) {
      console.error("[launcher] pad pre prvog prozora:", tekst);
      process.exit(1);
    }
    javiProblem(vrsta, tekst);
  });
}

// Igrač dobija poruku na srpskom sa uputstvom šta dalje, ne sistemsku
// grešku; tačan razlog ide osoblju kroz "igra_ne_radi".
function objasniGresku(greska) {
  const kod = String(greska?.code || "");
  const tekst = String(greska?.message ?? greska ?? "");
  const kaze = (re) => re.test(tekst);
  if (kod === "ENOENT" || kaze(/ENOENT|cannot find|could not find|not found|ne mo\w+ da (se )?(na[đd]e|prona[đd]e)/i))
    return "Igra nije pronađena na ovom računaru. Pozovite osoblje.";
  if (kod === "EACCES" || kod === "EPERM" || kaze(/EACCES|EPERM|access is denied|denied|pristup je odbijen/i))
    return "Windows nije dozvolio pokretanje. Pozovite osoblje.";
  if (kod === "EBUSY" || kaze(/EBUSY|being used by another|zauzet/i))
    return "Igra je trenutno zauzeta. Sačekaj koji trenutak pa probaj ponovo.";
  return "Igra ne može da se pokrene. Pozovite osoblje.";
}

// Osoblje u panel često upiše putanju bez nastavka ("C:\games\cs2"), a na
// disku je "cs2.lnk". Vraća { put }, { folder: true } ili null.
const NASTAVCI = [".lnk", ".exe", ".url", ".bat", ".cmd"];
function nadjiPutanju(p) {
  try {
    if (fs.existsSync(p)) {
      return fs.statSync(p).isDirectory() ? { folder: true } : { put: p };
    }
    // Bez nastavka: nastavci se probaju redom, prvo .lnk.
    if (!path.extname(p)) {
      for (const n of NASTAVCI) {
        if (fs.existsSync(p + n)) return { put: p + n };
      }
    }
  } catch {}
  return null;
}

// Ikona prečice (.lnk) je generička; ikona se uzima iz cilja prečice.
function izvorIkone(put) {
  if (!/\.lnk$/i.test(put)) return put;
  try {
    const veza = shell.readShortcutLink(put);
    // Ikona zadata na samoj prečici ima prednost nad ikonom cilja.
    const izvor = veza.icon || veza.target;
    return izvor && fs.existsSync(izvor) ? izvor : put;
  } catch {
    return put;
  }
}

// Pokreće se samo ono što je stiglo sa servera. Ekran nudi samo stavke iz
// kataloga, ali glavni proces to proverava i sam, a pokušaj van spiska
// odbija i prijavljuje osoblju.
const dozvoljeno = new Set();
const kljucPutanje2 = (p) => String(p || "").trim().replace(/^"|"$/g, "").trim().toLowerCase();

function zapamtiDozvoljeno(msg) {
  // Spisak se pravi iznova sa svakim katalogom, pa stavka uklonjena u panelu
  // odmah prestaje da se pokreće.
  dozvoljeno.clear();
  for (const g of msg.games || []) if (g?.path) dozvoljeno.add(kljucPutanje2(g.path));
  for (const t of msg.tools || []) if (t?.target) dozvoljeno.add(kljucPutanje2(t.target));
}

function smePokretanje(put) {
  // Dok katalog ne stigne ne blokira se ništa; na ekranu tada ionako nema
  // nijedne pločice.
  if (!dozvoljeno.size) return true;
  return dozvoljeno.has(kljucPutanje2(put));
}

function launchGame(gamePath, args, name, id, vrsta) {
  if (!smePokretanje(gamePath)) {
    console.error("odbijeno pokretanje van kataloga:", gamePath);
    javiProblem("pokretanje_odbijeno", `Odbijeno pokretanje van kataloga: ${String(gamePath).slice(0, 120)}`);
    return { ok: false, error: "Ova stavka nije u katalogu igraonice. Pozovite osoblje." };
  }
  return launchGameStvarno(gamePath, args, name, id, vrsta);
}

function launchGameStvarno(gamePath, args, name, id, vrsta) {
  // Putanja kopirana iz Windows-a često nosi navodnike.
  gamePath = String(gamePath || "").trim().replace(/^"|"$/g, "").trim();
  if (!gamePath) return { ok: false, error: "Ova igra nema podešenu putanju. Pozovite osoblje." };

  // Isti unos se ne pokreće dvaput u 3 sekunde.
  const now = Date.now();
  if (now - (recentLaunch.get(gamePath) || 0) < 3000) return { ok: true, ignored: true };
  recentLaunch.set(gamePath, now);

  try {
    // Internet adresa -> sistemski pregledač.
    if (/^https?:\/\//i.test(gamePath)) { openBrowser(gamePath); return { ok: true }; }

    // Protokol (steam://, epic://...) -> Windows.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(gamePath)) {
      shell.openExternal(gamePath).catch(() => {});
      markExternal(protocolImages(gamePath));
      startGuard();
      stepBack();
      return { ok: true };
    }

    const nadjena = nadjiPutanju(gamePath);
    if (!nadjena) {
      javiDaNeRadi(name || path.basename(gamePath), "nema", id, vrsta);
      return { ok: false, error: `"${name || path.basename(gamePath)}" nije instalirana na ovom računaru. Pozovite osoblje.` };
    }
    if (nadjena.folder) {
      javiDaNeRadi(name || path.basename(gamePath), "folder", id, vrsta);
      return { ok: false, error: `Za "${name || path.basename(gamePath)}" je upisan folder, a treba prečica ili .exe fajl. Pozovite osoblje.` };
    }
    gamePath = nadjena.put;

    // Prečice (.lnk), .url i .bat otvara Windows; spawn ih ne pokreće.
    if (/\.(lnk|url|bat|cmd)$/i.test(gamePath)) {
      // shell.openPath obično vraća poruku o grešci, ali ume i da odbije obećanje
      // (pokvarena prečica); neobrađeno odbijanje bi srušilo launcher.
      const javiKvar = (poruka) => {
        sendToRenderer("game-error", { name: name || path.basename(gamePath), message: poruka });
        javiDaNeRadi(name || path.basename(gamePath), "greska", id, vrsta);
      };
      shell.openPath(gamePath)
        .then((greska) => { if (greska) javiKvar(objasniGresku(greska)); })
        .catch((e) => javiKvar(objasniGresku(e)));
      markExternal([]);   // ne znamo koji proces nastaje - oslanjamo se na zastor
      startGuard();
      stepBack();
      return { ok: true };
    }

    const image = path.basename(gamePath);
    const child = spawn(gamePath, razdvojArgumente(args), {
      detached: false, stdio: "ignore", cwd: path.dirname(gamePath),
    });
    const entry = { child, image, name: name || image };
    spawnedGames.add(entry);
    startGuard(); // dok gard traje, launcher ne dira prvi plan

    child.on("error", (e) => {
      spawnedGames.delete(entry);
      launchGuardUntil = 0;
      sendToRenderer("game-error", { name: entry.name, message: objasniGresku(e) });
      javiDaNeRadi(entry.name, "greska", id, vrsta);
      focusLauncher();
    });
    child.on("exit", () => {
      // Pokretač je izašao, a igra verovatno kreće pod drugim imenom; o povratku
      // launchera odlučuje nadzor kad istekne čekanje.
      spawnedGames.delete(entry);
    });

    stepBack();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function killAllGames() {
  for (const g of spawnedGames) {
    try { g.child.kill("SIGKILL"); } catch {}
    // Pokretač je često već izašao; gasi se i sam proces igre.
    if (g.image) pokreniKomandu("taskkill", ["/IM", g.image, "/F", "/T"]);
  }
  spawnedGames.clear();
  recentLaunch.clear();
  launchGuardUntil = 0;
}

// ---------- Sajtovi -> sistemski pregledač ----------
// Pregledač radi van launchera, pa igrač prebacuje između igre i sajta sa
// Alt+Tab.
function openBrowser(url) {
  const target = url || "https://www.google.com";
  shell.openExternal(target).catch(() => {});
  markExternal(BROWSER_IMAGES);
  startGuard();
  stepBack();
}
// Kraj sesije zatvara pregledač, da sledeći igrač ne zatekne tuđe kartice.
function closeBrowser() {
  clearExternal();
  if (DEV || process.platform !== "win32") return;
  for (const img of BROWSER_IMAGES) {
    pokreniKomandu("taskkill", ["/IM", img, "/F", "/T"]);
  }
}

// ---------- IPC ----------
// Token ostaje u glavnom procesu; ekranu trebaju samo adresa i da li je
// računar podešen.
ipcMain.handle("get-config", () => ({ host: config.host, configured: config.configured }));
ipcMain.handle("save-config", (e, c) => {
  // Nova adresa se prima samo dok računar nije podešen, a u to stanje se
  // ulazi tek servisnim PIN-om (reset-config).
  if (config.configured) return { ok: false, error: "Računar je već podešen. Promena ide preko servisnog PIN-a." };
  const r = saveConfig(c);
  if (r.ok) connectWs();
  return r;
});
// Brisanje podešavanja traži servisni PIN, inače bi se računar sa izvučenim
// kablom preusmerio na drugi server.
ipcMain.handle("reset-config", (e, pin) => {
  if (!proveriPin(pin)) return { ok: false, error: "Pogrešan servisni PIN." };
  resetConfig();
  return { ok: true };
});
// Lokalna provera PIN-a - radi i kad server ne odgovara.
ipcMain.handle("proveri-servisni-pin", (e, pin) => ({ ok: proveriPin(pin) }));
ipcMain.handle("to-server", async (e, msg) => {
  // Odjava bez servera se završava lokalno; server je obračuna kad se vrati.
  if (msg?.t === "logout" && !naVezi() && lokalna.aktivna()) { zavrsiBezServera("odjava"); return true; }
  // Prijava čeka da se obrišu tragovi prethodnog igrača - vidi ocistiTragove.
  if (msg?.t === "login" && posaoCiscenja) await posaoCiscenja;
  if (msg?.t === "login" && instalacijaKrece) return false;
  wsSend(msg);
  return true;
});
// Zaključan ekran posle isteklog vremena, bez servera: otključava se
// servisnim PIN-om, a server to vidi u izveštaju.
ipcMain.handle("otkljucaj-bez-servera", (e, pin) => {
  if (!proveriPin(pin)) return { ok: false };
  lokalna.otkljucaj();
  return { ok: true };
});
ipcMain.handle("launch-game", (e, { path: p, args, name, id, vrsta }) => launchGame(p, args, name, id, vrsta));
// Samo internet adrese: shell.openExternal otvara i file:// i druge
// protokole, čime bi se zaobišao katalog.
ipcMain.handle("open-browser", (e, url) => {
  const adresa = String(url || "").trim();
  if (adresa && !/^https?:\/\//i.test(adresa)) {
    javiProblem("pokretanje_odbijeno", `Odbijeno otvaranje adrese: ${adresa.slice(0, 120)}`);
    return false;
  }
  openBrowser(adresa || undefined);
  return true;
});
ipcMain.handle("focus-launcher", () => { focusLauncher(); return true; });

// ---------- Global hotkeys ----------
function registerHotkeys() {
  // Osoblje: otključavanje računara (PIN na ekranu).
  globalShortcut.register("CommandOrControl+Alt+U", () => { focusLauncher(); sendToRenderer("hotkey", { action: "unlock" }); });
  // Launcher u prvi plan.
  globalShortcut.register("CommandOrControl+Alt+Home", () => { focusLauncher(); });
  // Izlaz iz launchera (PIN na ekranu).
  globalShortcut.register("CommandOrControl+Alt+Shift+Q", () => { focusLauncher(); sendToRenderer("hotkey", { action: "exit" }); });

  // Nova adresa servera i token: samo bez veze sa serverom i uz servisni PIN,
  // isti prozor kao dugme "Promeni adresu servera".
  globalShortcut.register("CommandOrControl+Alt+Shift+R", () => {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    focusLauncher();
    sendToRenderer("hotkey", { action: "setup" });
  });
  if (DEV) return;

  // Prečice koje vode do radne površine, Start menija ili Task Manager-a.
  // Alt+Tab i Alt+F4 ostaju: igraču trebaju, a launcher se ne može zatvoriti i
  // ispod njega je zastor.
  const blocked = [
    "Alt+Escape", "Control+Escape", "Control+Shift+Escape",
    "Super+D", "Super+E", "Super+R", "Super+M", "Super+Shift+M",
    "Super+Tab", "Super+L", "Super+I", "Super+X", "Super+S", "Super+A",
    "Super+Up", "Super+Down", "Super+Left", "Super+Right",
    "F11",
  ];
  for (const key of blocked) {
    try { globalShortcut.register(key, () => { if (!gameActive()) focusLauncher(); }); } catch {}
  }
}

// Politike po korisniku (HKCU, bez administratora). Vraćaju se pri izlazu sa
// PIN-om.
const POLICY_SYS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System";
const POLICY_EXP = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer";
// Plan napajanja: dok launcher radi, računar ne spava i ekran se ne gasi.
// Pri izlazu sa PIN-om vraća se Windows-ov fabrički plan (Balanced).
const PLAN_VISOKI = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";  // High performance
const PLAN_URAVNOTEZEN = "381b4222-f694-41f0-9685-ff5bb260df2e"; // Balanced
function planNapajanja(ukljuci) {
  if (NO_LOCK || process.platform !== "win32") return;
  const cmds = ukljuci
    ? [
        ["/setactive", PLAN_VISOKI],
        ["/change", "monitor-timeout-ac", "0"],   // ekran se ne gasi
        ["/change", "standby-timeout-ac", "0"],   // racunar ne ide na spavanje
        ["/change", "disk-timeout-ac", "0"],
      ]
    : [
        ["/setactive", PLAN_URAVNOTEZEN],
        ["/change", "monitor-timeout-ac", "15"],
        ["/change", "standby-timeout-ac", "30"],
        ["/change", "disk-timeout-ac", "20"],
      ];
  for (const argumenti of cmds) pokreniKomandu("powercfg", argumenti);
}

// NoControlPanel zatvara Podešavanja (ms-settings) i Kontrolnu tablu, pa i
// deinstalaciju launchera, koji je instaliran u profil igrača.
function setPolicies(on) {
  if (NO_LOCK || process.platform !== "win32") return;
  const v = on ? 1 : 0;
  const vrednosti = [
    [POLICY_SYS, "DisableTaskMgr"],
    [POLICY_SYS, "DisableLockWorkstation"],
    [POLICY_SYS, "DisableChangePassword"],
    [POLICY_EXP, "NoLogoff"],
    [POLICY_EXP, "NoWinKeys"],
    [POLICY_EXP, "NoClose"],
    [POLICY_EXP, "NoRun"],
    [POLICY_EXP, "NoControlPanel"],
  ];
  for (const [kljuc, ime] of vrednosti) {
    pokreniKomandu("reg", ["add", kljuc, "/v", ime, "/t", "REG_DWORD", "/d", String(v), "/f"]);
  }
}

// Prečice pristupačnosti (pet puta Shift i ostale) - vidi windows-podesavanja.js.
function precicePristupacnosti(ukljucene) {
  if (NO_LOCK || process.platform !== "win32") return;
  winPod.precicePristupacnosti(ukljucene)
    .then((r) => { if (!r.ok) javiProblem("pristupacnost", r.greska); })
    .catch(() => {});
}

// Autostart se upisuje pri svakom pokretanju (HKCU\...\Run), pod imenom
// izvršnog fajla - isto ime briše POPRAVI-RACUNAR.bat. Ručna prečica u
// Startup folderu tako nije potrebna.
function upisiAutostart() {
  if (NO_LOCK || process.platform !== "win32") return;
  try {
    const ime = path.basename(process.execPath, path.extname(process.execPath));
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, name: ime });
  } catch (e) {
    javiProblem("autostart", `Upis u automatsko pokretanje nije uspeo: ${e?.message || e}`);
  }
  ukloniStaruPrecicu();
}

// Prečica iz Startup foldera koja pokazuje na launcher na drugoj putanji
// (stara instalacija u Program Files) otvara Windows grešku pri prijavi.
// Briše se samo prečica čiji je cilj ovaj isti program.
function ukloniStaruPrecicu() {
  try {
    const folder = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    const exe = path.basename(process.execPath).toLowerCase();
    for (const f of fs.readdirSync(folder)) {
      if (!/\.lnk$/i.test(f)) continue;
      const put = path.join(folder, f);
      let cilj = "";
      try { cilj = shell.readShortcutLink(put).target || ""; } catch { continue; }
      if (path.basename(cilj).toLowerCase() !== exe) continue;
      if (path.resolve(cilj).toLowerCase() === path.resolve(process.execPath).toLowerCase()) continue;
      try { fs.unlinkSync(put); console.log("uklonjena stara prečica iz autostarta:", f); } catch {}
    }
  } catch {}
}

// Glavni proces proverava izlaz i sam: prolazi uz ispravan servisni PIN ili
// kad je server upravo potvrdio PIN osoblja (vidi pinPotvrdjenDo).
ipcMain.handle("admin-exit", (e, pin) => {
  if (!proveriPin(pin) && Date.now() > pinPotvrdjenDo) {
    javiProblem("izlaz_odbijen", "Izlaz iz launchera je zatražen bez ispravnog PIN-a - odbijen");
    return false;
  }
  pinPotvrdjenDo = 0;
  app.isQuitting = true;
  killAllGames();
  app.quit();
  return true;
});

// ---------- Sistemski podaci za donju traku ----------
let _lastCpu = null;
function cpuLoad() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) { for (const t in c.times) total += c.times[t]; idle += c.times.idle; }
  if (!_lastCpu) { _lastCpu = { idle, total }; return null; }
  const di = idle - _lastCpu.idle, dt = total - _lastCpu.total;
  _lastCpu = { idle, total };
  if (dt <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(100 - (di / dt) * 100)));
}
// Temperatura procesora preko WMI. Nalog igrača obično nema pravo na taj
// razred, pa se posle tri neuspeha zaredom više ne pita, a dok igra radi ne
// pita se uopšte.
let _temp = { at: 0, val: null, neuspeha: 0 };
function cpuTemp() {
  return new Promise((resolve) => {
    if (_temp.neuspeha >= 3 || gameActive() || Date.now() - _temp.at < 60000) return resolve(_temp.val);
    _temp.at = Date.now();
    pokreniKomandu("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1).CurrentTemperature"],
    (err, stdout) => {
      let v = null;
      const n = parseInt(String(stdout || "").trim(), 10);
      if (!err && n) v = Math.round(n / 10 - 273.15); // desetine Kelvina -> °C
      if (v != null && (v < 10 || v > 120)) v = null;
      _temp.neuspeha = v == null ? _temp.neuspeha + 1 : 0;
      _temp.val = v;
      resolve(v);
    }, 5000);
  });
}
ipcMain.handle("verzija", () => app.getVersion());
// Miš i zvuk koje igrač menja sa svog naloga; važe dok traje sesija.
ipcMain.handle("podesavanja-citaj", async () => {
  try { return await winPod.procitajSve(); }
  catch (e) { return { greska: String(e?.message || e).slice(0, 200) }; }
});
// Igrač dobija razumljivu poruku, a tačna greška ide osoblju kroz
// klijent_problem.
const podesiIliJavi = async (sta, radi, imenica) => {
  const r = await radi(sta);
  if (r.ok) return null;
  javiProblem("podesavanja", `${imenica}: ${r.greska}`);
  return { ok: false, error: `${imenica} nije mogao da se podesi na ovom računaru. Osoblje je obavešteno.` };
};

ipcMain.handle("podesavanja-primeni", async (e, sta) => {
  try {
    if (!sesijaAktivna) return { ok: false, error: "Prijavi se pa probaj ponovo." };
    if (sta?.mis) {
      const pao = await podesiIliJavi(sta.mis, (x) => winPod.primeniMis(x), "Miš");
      if (pao) return pao;
    }
    if (sta?.zvuk && sta.zvuk.jacina != null) {
      const pao = await podesiIliJavi(sta.zvuk, (x) => winPod.primeniZvuk(x), "Zvuk");
      if (pao) return pao;
    }
    return { ok: true, stanje: await winPod.procitajSve() };
  } catch (err) {
    javiProblem("podesavanja", String(err?.message || err).slice(0, 200));
    return { ok: false, error: "Podešavanje nije prošlo na ovom računaru. Osoblje je obavešteno." };
  }
});

ipcMain.handle("sys-stats", async () => {
  const ramTotal = os.totalmem(), ramFree = os.freemem();
  return {
    cpu: cpuLoad(),
    ramUsedPct: Math.round((1 - ramFree / ramTotal) * 100),
    ramGb: (ramTotal / 1073741824).toFixed(0),
    temp: await cpuTemp(),
    uptime: os.uptime(),
  };
});

// Ikona programa iz samog .exe fajla, za prečice i igre bez omota.
const ikoneProgramaKes = new Map(); // putanja -> data URL (ili null ako nema)

ipcMain.handle("program-icon", async (e, putanja) => {
  const p = String(putanja || "").trim().replace(/^"|"$/g, "").trim();
  if (!p) return null;
  if (ikoneProgramaKes.has(p)) return ikoneProgramaKes.get(p);

  let url = null;
  try {
    // Ista pravila kao pri pokretanju (nastavak se traži). Za nepostojeću putanju
    // Windows vraća generičku ikonu, pa se ona ne uzima.
    const n = nadjiPutanju(p);
    const izvor = n?.put ? izvorIkone(n.put) : null;
    if (izvor && /\.(exe|lnk|ico)$/i.test(izvor)) {
      const img = await app.getFileIcon(izvor, { size: "large" });
      if (img && !img.isEmpty()) url = img.toDataURL();
    }
  } catch { url = null; }

  ikoneProgramaKes.set(p, url);
  return url;
});

// Ekran je spreman: šalje se bafer i traži svež katalog sa servera.
ipcMain.handle("renderer-ready", () => {
  rendererReady = true;
  flushToRenderer();
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendToRenderer("ws-status", { connected: true });
    wsSend({ t: "hello" }); // server ponovo šalje welcome + trenutno stanje
  } else {
    // Bez servera ekran se crta iz poslednjeg kataloga, a sesija iz zapisa.
    sendToRenderer("ws-status", { connected: false });
    if (kesiraniKatalog) sendToRenderer("server-msg", { ...kesiraniKatalog, t: "welcome", izKesa: true });
    if (lokalna.aktivna()) posaljiLokalnoStanje();
  }
  return true;
});

// Poruke pre nego što ekran zakači slušaoce idu u bafer, inače bi se
// "welcome" izgubio.
let rendererReady = false;
const pendingMsgs = [];
function sendToRenderer(channel, data) {
  if (!rendererReady) {
    pendingMsgs.push([channel, data]);
    if (pendingMsgs.length > 200) pendingMsgs.shift();
    return;
  }
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}
function flushToRenderer() {
  const q = pendingMsgs.splice(0);
  for (const [ch, d] of q) {
    if (win && !win.isDestroyed()) win.webContents.send(ch, d);
  }
}

// ---------- App lifecycle ----------
app.whenReady().then(() => {
  if (!JEDINI_PRIMERAK) return;
  ucitajRadBezServera();
  createWindow();
  registerHotkeys();
  setPolicies(true);
  precicePristupacnosti(false);
  upisiAutostart();
  planNapajanja(true);
  startWatchdog();
  connectWs();
  pratiRezoluciju();
  setInterval(tikLokalneSesije, 1000);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Prozori prate promenu rezolucije (igre je menjaju). Dok igra radi
// launcher se ne dira: prozori su iza nje, a diranje prvog plana bi joj
// promenilo rezoluciju.
function pratiRezoluciju() {
  if (DEV) return;
  const obnovi = () => {
    try {
      const { width, height } = screen.getPrimaryDisplay().size;
      if (backdrop && !backdrop.isDestroyed() && backdrop.isVisible()) {
        backdrop.setBounds({ x: 0, y: 0, width, height });
      }
      if (overlay && !overlay.isDestroyed() && overlay.isVisible()) overlay.setBounds(overlayMere());
      if (win && !win.isDestroyed() && !gameActive()) {
        const b = win.getBounds();
        if (b.width !== width || b.height !== height) {
          win.setBounds({ x: 0, y: 0, width, height });
          win.setFullScreen(true);
        }
      }
    } catch {}
  };
  // Windows javlja promenu pre nego što je primeni, pa se mera čita i kasnije.
  const kasnije = () => { obnovi(); setTimeout(obnovi, 1200); };
  screen.on("display-metrics-changed", kasnije);
  screen.on("display-added", kasnije);
  screen.on("display-removed", kasnije);
}

// Launcher se gasi samo izlazom sa PIN-om.
app.on("window-all-closed", () => {
  if (app.isQuitting) { if (process.platform !== "darwin") app.quit(); }
  else createWindow();
});
app.on("before-quit", (e) => {
  if (!app.isQuitting) { e.preventDefault(); focusLauncher(); }
});
app.on("will-quit", () => {
  // Drugi primerak ne vraća ništa: politike i plan napajanja pripadaju prvom,
  // koji i dalje radi.
  if (!JEDINI_PRIMERAK) return;
  clearInterval(watchdog);
  zaustaviStrazu();
  globalShortcut.unregisterAll();
  setPolicies(false); // vrati Task Manager i Ctrl+Alt+Del opcije
  precicePristupacnosti(true);
  planNapajanja(false); // vrati uspavljivanje i gašenje ekrana
});

if (JEDINI_PRIMERAK) app.on("second-instance", () => focusLauncher());
