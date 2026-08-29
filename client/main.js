const { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, exec } = require("node:child_process");
const https = require("node:https");
const http = require("node:http");
const os = require("node:os");
const WebSocket = require("ws");
const { ocistiSesiju } = require("./ciscenje.js");
const { snimiStanje, ugasiNoveProcese, presretniPokretanja, spisakZaPanel, ugasiProces } = require("./procesi.js");
const winPod = require("./windows-podesavanja.js");

const DEV = process.argv.includes("--dev");
// Proba na sopstvenom/glavnom računaru: kiosk radi, ali se Windows ne dira
// (Task Manager, Win taster i ostalo ostaju kako jesu).
const NO_LOCK = DEV || process.argv.includes("--no-lock") ||
  fs.existsSync(path.join(path.dirname(process.execPath), "bez-zakljucavanja.txt"));
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

let win = null;
let ws = null;
let reconnectTimer = null;
let config = loadConfig();
const spawnedGames = new Set();

// ---------- Config ----------
// Osoblje po pravilu ukuca samo "192.168.1.67" ili "192.168.1.67:8095".
// Sve to mora da radi, pa adresu sami dopunimo do punog oblika.
function normalizeHost(h) {
  h = String(h || "").trim().replace(/\s+/g, "").replace(/\/+$/, "");
  if (!h) return "";
  if (!/^https?:\/\//i.test(h)) h = "http://" + h;
  try {
    const u = new URL(h);
    // dozvoli samo IP ili obično ime računara - da očigledna greška u kucanju
    // ne prođe pa da launcher zauvek visi na "Povezivanje"
    if (!/^[a-z0-9.-]+$/i.test(u.hostname)) return "";
    if (!u.port && u.protocol === "http:") u.port = "8095"; // podrazumevani port servera
    return u.origin;
  } catch {
    return "";
  }
}

// Adresa servera se upisuje jednom u podesavanja.json pored programa, pa je
// osoblje ne kuca na svakom računaru - pri podešavanju ostaje samo token.
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

// SERVISNI PIN - proverava se lokalno, bez servera.
//
// Postoji zbog dva slucaja koja server ne moze da pokrije:
//  1. Igrac iscupa mrezni kabl. Posle par sekundi launcher nudi "Promeni
//     adresu servera" - bez provere bi mogao da obrise podesavanje ili da
//     masinu preusmeri na svoj server i tako sebi otvori besplatnu igru.
//  2. Server ne radi. Admin izlaz trazi PIN PREKO servera, pa bi osoblje
//     ostalo zakljucano na svih trinaest masina bez nacina da izadje.
//
// Upisuje se jednom, u podesavanja.json pored programa (isti fajl koji nosi
// adresu servera). Ako nije upisan, vazi isti fabricki 1234 kao za PIN u
// panelu - i isto tako se OBAVEZNO menja pre otvaranja.
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

// NADOGRADNJA NE SME DA VRATI FABRICKI PIN.
//
// podesavanja.json stoji u resources/ pored programa, a instaler ga pri
// nadogradnji PREPISUJE fabrickim. Kad bi se PIN citao samo odatle, svaka nova
// verzija bi ga tiho vratila na 1234 na svih trinaest masina - a to je bas onaj
// PIN koji cuva ulaz u podesavanja i izlaz iz launchera kad server ne radi.
// Niko to ne bi primetio dok neko ne proba.
//
// Zato se PIN koji nije fabricki zapamti u config.json (u nalogu korisnika, koji
// nadogradnja ne dira). Ako posle nadogradnje u podesavanjima opet stoji 1234,
// vazi zapamceni. Kad vlasnik namerno upise NOVI PIN, on je razlicit od
// fabrickog pa odmah preuzima - i pamti se umesto starog.
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
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return { ok: true, host };
}

// Briše podešavanje i vraća launcher na ekran za podešavanje.
function resetConfig() {
  try { fs.unlinkSync(CONFIG_PATH); } catch {}
  config = { host: "", token: "", configured: false };
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
  // svako (ponovno) učitavanje stranice resetuje spremnost renderera
  win.webContents.on("did-start-loading", () => { rendererReady = false; });

  // Ako ekran launchera pukne (nestanak memorije, greška u GPU sloju), igrač
  // ostaje pred crnim prozorom, a računar je i dalje zaključan - ne može ništa
  // dok radnik ne dođe. Zato se prozor sam vraća. Osoblje o tome dobija zapis:
  // ako se ista mašina javlja više puta, to je hardver, ne launcher.
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

  // STARA VEZA SE PRVO GASI, I TO BEZ SVOJIH SLUSALACA.
  //
  // connectWs se zove i kad osoblje sacuva nova podesavanja ("Promeni adresu
  // servera"), a tada stara veza ume da bude jos otvorena. Bez ovoga ostanu
  // dve: server za jedan racunar drzi samo jednu i zatvori stariju, a njen
  // "close" onda javi rendereru da veze NEMA (iako nova radi) i zakaze jos
  // jedno povezivanje. Nastane vrtoglavica u kojoj traka gore trepce
  // "povezivanje" dok je sve u redu - a to se desava bas pri postavljanju
  // masine, kad radnik i gleda da li se povezalo.
  if (ws) {
    const stara = ws;
    ws = null;
    try { stara.removeAllListeners(); } catch {}
    try { stara.close(); } catch {}
    try { stara.terminate(); } catch {}
  }

  // Verzija ide uz adresu da bi se u panelu, na strani Racunari, videlo koji
  // racunar ima koji launcher. Bez toga se u igraonici sa 13 masina ne moze
  // znati zasto se jedna ponasa drugacije.
  const url = config.host.replace(/^http/i, "ws") + "/ws?kind=client&token=" + encodeURIComponent(config.token)
    + "&v=" + encodeURIComponent(app.getVersion());
  let sveza;
  try { sveza = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }
  ws = sveza;
  // Dogadjaji sa vec zamenjene veze se ignorisu - inace zakasneli "close" sa
  // stare gasi statusnu traku nove.
  const jeAktuelna = () => ws === sveza;

  sveza.on("open", () => {
    if (!jeAktuelna()) return;
    sendToRenderer("ws-status", { connected: true });
    // Uz MAC adrese (za Wake-on-LAN) ide i da li je servisni PIN jos fabricki.
    //
    // Taj PIN cuva ulaz u podesavanja launchera i izlaz iz kioska kad server ne
    // radi. Dok stoji na 1234, igrac koji iscupa mrezni kabl moze da preusmeri
    // masinu na svoj server. Menja se rucno, po masini - a rucni korak se
    // zaboravi bas na onoj trinaestoj. Sam launcher to ne moze da resi, ali moze
    // da PRIJAVI, pa panel vise ne cuti o tome.
    wsSend({ t: "sys_info", nics: localNics(), fabrickiPin: servisniPin() === FABRICKI_PIN });
  });
  sveza.on("message", (buf) => {
    if (!jeAktuelna()) return;
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    handleServerMsg(msg);
    sendToRenderer("server-msg", msg);
  });
  sveza.on("close", () => {
    if (!jeAktuelna()) return;
    sendToRenderer("ws-status", { connected: false });
    scheduleReconnect();
  });
  sveza.on("error", () => {});

  // heartbeat
  clearInterval(connectWs._hb);
  connectWs._hb = setInterval(() => {
    // Mirovanje broji sam Windows (od poslednjeg dodira tastature ili miša),
    // pa važi i dok je igrač u punom ekranu u igri.
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

// Sve realne (non-internal) IPv4 kartice sa MAC-om - server bira LAN karticu po IP-u
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

// server komande koje main obrađuje lokalno
function handleServerMsg(msg) {
  // DALJINSKI TASK MANAGER: radnik iz panela gleda sta radi na ovoj masini i
  // gasi zaglavljenu igru, ne ustajuci od kase.
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
  // Igrač se prijavio - zapamti šta je radilo pre njega, da na kraju sesije
  // znamo šta je tačno on pokrenuo (igre preko Steam-a rade pod drugim imenom).
  if (msg.t === "login_ok") {
    sesijaAktivna = true;
    javljeniPragovi = new Set();
    showBackdrop(); // od sada zastor pokriva desktop dok god traje sesija
    proveriVreme(msg.remainingSeconds, true); // pri prijavi samo zapamti stanje
    if (!NO_LOCK) snimiStanje().then((s) => { procesiPreSesije = s; }).catch(() => {});
    // Zapamti kako je miš i zvuk bio pre ovog igrača, da se na kraju sesije
    // vrati. Bez toga bi sledeći gost zatekao tuđa podešavanja.
    winPod.procitajSve().then((s) => { podesavanjaPreSesije = s; }).catch(() => {});
  }
  // Server šalje novo stanje na svakih par sekundi - odatle znamo koliko je ostalo.
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
}

// Igrač skine program kroz pregledač i pokrene ga - time bi zaobišao launcher.
// Gasimo sve pokrenuto iz Preuzimanja/Temp/Desktop i javljamo mu zašto.
function presretniSkinute() {
  if (NO_LOCK || !podesavanje("blokirajPreuzeteProgram", true)) return;
  presretniPokretanja({
    obavesti: (ime) => {
      sendToRenderer("blokirano", { ime });
      wsSend({ t: "log_klijent", tekst: `Blokirano pokretanje preuzetog programa: ${ime}` });
    },
  }).catch(() => {});
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

// Obaveštenje preko igre. Igrač je najčešće u punom ekranu i ne vidi launcher,
// pa upozorenje o vremenu i poruke osoblja moraju da idu iznad svega.
let overlay = null;
let overlayTajmer = null;
function createOverlay() {
  if (DEV) return null;
  if (overlay && !overlay.isDestroyed()) return overlay;
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  overlay = new BrowserWindow({
    width: Math.min(660, width - 40), height: 110,
    x: Math.round((width - Math.min(660, width - 40)) / 2), y: 0,
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
    o.webContents.send("overlay-prikazi", { naslov, opis, vrsta, boja });
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
// tiho = samo zapamti dokle smo stigli, bez prikazivanja. Koristi se pri prijavi:
// igrač sa 12 minuta ne sme da dobije poruku "ostalo ti je 30 minuta".
function proveriVreme(preostaloSek, tiho = false) {
  if (preostaloSek == null || !sesijaAktivna) return;
  const min = Math.ceil(preostaloSek / 60);
  const dostignuti = PRAGOVI.filter((p) => min <= p);
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
}

// Kraj sesije: ugasi sve što je igrač pokrenuo, pa obriši njegove tragove.
let procesiPreSesije = null;

// PODEŠAVANJA SE VRAĆAJU NA ZATEČENO.
//
// Igrač sme da namesti miš i zvuk kako mu odgovara, ali to važi samo za njegovu
// sesiju. Sledeći gost mora da zatekne računar onakav kakav je bio, inače se
// podešavanja gomilaju kroz dan i niko ne zna šta je čije.
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

// Čišćenje tragova prethodnog igrača. Ne radi ništa u --dev/--no-lock režimu,
// niti ako "ciscenjeSesije" nije uključeno u podesavanja.json.
let ciscenjeUToku = false;
function ocistiTragove() {
  if (ciscenjeUToku) return;
  ciscenjeUToku = true;
  setTimeout(() => {
    try {
      const r = ocistiSesiju({
        dozvoljeno: !NO_LOCK,
        resourcesPath: process.resourcesPath,
        execPath: process.execPath,
        dirname: __dirname,
        log: (m) => console.log(m),
      });
      if (r.radjeno) wsSend({ t: "log_klijent", tekst: "Očišćeni tragovi prethodnog igrača" });
    } catch (e) {
      console.error("čišćenje:", e.message);
    }
    ciscenjeUToku = false;
  }, 1500); // sačekaj da se pregledači i igre stvarno ugase
}

// ---------- Daljinska instalacija (preuzmi sa URL-a i pokreni tiho) ----------
function reportInstall(program, state, message) {
  wsSend({ t: "install_status", program, state, message });
}
function downloadFile(url, dest, cb, redirects = 0) {
  const mod = url.startsWith("https") ? https : http;
  const req = mod.get(url, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
      res.resume();
      return downloadFile(res.headers.location, dest, cb, redirects + 1);
    }
    if (res.statusCode !== 200) { res.resume(); return cb(new Error("HTTP " + res.statusCode)); }
    const file = fs.createWriteStream(dest);
    res.pipe(file);
    file.on("finish", () => file.close(() => cb(null)));
    file.on("error", (e) => cb(e));
  });
  req.on("error", (e) => cb(e));
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
        child.on("exit", (code) => reportInstall(name, code === 0 ? "done" : "error", code === 0 ? "Instalirano" : "Instalacija je vratila kod " + code));
        child.on("error", (e) => reportInstall(name, "error", e.message));
      } catch (e) { reportInstall(name, "error", e.message); }
    });
  } catch (e) { reportInstall(name, "error", e.message); }
}

// daljinske komande sa panela
function runCommand(cmd) {
  if (DEV && ["shutdown", "restart", "logoff"].includes(cmd)) {
    console.log("[DEV] komanda ignorisana:", cmd);
    return;
  }
  switch (cmd) {
    case "shutdown": exec('shutdown /s /t 3 /c "Crit - kraj smene"'); break;
    case "restart": exec('shutdown /r /t 3 /c "Crit - restart"'); break;
    case "logoff": exec("shutdown /l"); break;
    // "taskmgr" je izbačen. Otvarao je Task Manager NA računaru igrača: radnik
    // bi morao da ustane i ode do te mašine, a igrač bi u međuvremenu imao Task
    // Manager pred sobom. Zamenjen je daljinskim prikazom - server šalje
    // "procesi_trazi", a gašenje ide kroz "procesi_ugasi".
    case "reboot_launcher": app.relaunch(); app.isQuitting = true; app.exit(0); break;
  }
}

// Dok je igrač prijavljen, launcher je običan prozor - igrač slobodno prebacuje
// između njega, Discorda, pregledača i igre (Alt+Tab). "Iznad svega" ostaje samo
// login i zaključan ekran, jer se odatle ne sme pobeći.
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
  // Zastor ostaje dok traje sesija: iza launchera i ostalih prozora mora da bude
  // on, a ne Windows desktop. Sklanja se tek kad sesija prestane.
  if (!sesijaAktivna) hideBackdrop();
}

// Zastor: pun ekran crne pozadine koji stoji ISPOD igre, a IZNAD Windows desktopa.
// Zahvaljujući njemu launcher sme da se skloni (da igra normalno dođe u prvi plan),
// a igrač ipak nikad ne vidi desktop.
let backdrop = null;
function createBackdrop() {
  if (DEV) return null;
  if (backdrop && !backdrop.isDestroyed()) return backdrop;
  const { width, height } = screen.getPrimaryDisplay().size;
  backdrop = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false, fullscreen: true, skipTaskbar: true, show: false,
    backgroundColor: "#07070a",
    webPreferences: { preload: path.join(__dirname, "backdrop-preload.js"), contextIsolation: true },
  });
  backdrop.loadFile(path.join(__dirname, "renderer", "backdrop.html"));
  backdrop.on("close", (e) => { if (!app.isQuitting) e.preventDefault(); });
  // Kad se igra zatvori, Windows dodeljuje fokus sledećem prozoru - a to je zastor.
  // To nam je najbrži znak da je igra gotova, bez čekanja na proveru procesa.
  backdrop.on("focus", () => {
    if (Date.now() < launchGuardUntil) return;
    setTimeout(() => {
      if (backdrop && !backdrop.isDestroyed() && backdrop.isFocused()) focusLauncher();
    }, 400);
  });
  return backdrop;
}
function showBackdrop() {
  const b = createBackdrop();
  if (!b || b.isDestroyed()) return;
  if (b.isMinimized()) b.restore();
  b.showInactive(); // nikad ne otima fokus igri
}
function hideBackdrop() {
  if (backdrop && !backdrop.isDestroyed() && backdrop.isVisible()) backdrop.hide();
}

// Igra ide u prvi plan: prvo podigni zastor (pokriva desktop), pa skloni launcher.
// Bez sklanjanja launchera igre se otvaraju iza njega i deluje kao da "rade u pozadini".
function stepBack() {
  if (!win || win.isDestroyed() || DEV) return;
  showBackdrop();
  win.setAlwaysOnTop(false);
  setTimeout(() => {
    if (win && !win.isDestroyed() && gameActive()) win.minimize();
  }, 250);
}

// Spoljna aplikacija (sistemski pregledač, Steam i sl.) nema svoj proces koji
// pratimo, pa pamtimo da je pokrenuta i ne otimamo joj fokus dok traje.
let externalActive = false;
let externalImages = [];
const BROWSER_IMAGES = ["chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "brave.exe"];
// images = procesi koje pratimo da bismo znali kad je spoljni program zatvoren
// steam:// -> steam.exe, epic/com.epicgames -> EpicGamesLauncher.exe itd.
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

// Igre se često pokreću preko svog pokretača (Steam, Riot, Epic): .exe koji smo
// pokrenuli brzo izađe, a igra nastavi pod drugim imenom. Zato posle pokretanja
// držimo "gard" - za to vreme ne diramo prvi plan, ma šta se desilo sa procesom.
let launchGuardUntil = 0;
const GUARD_MS = 25000;
function startGuard() { launchGuardUntil = Date.now() + GUARD_MS; }

const gameActive = () =>
  spawnedGames.size > 0 || externalActive || Date.now() < launchGuardUntil;

// Provera da li je pokrenuti program zatvoren pa treba vratiti launcher.
function checkGameGone() {
  if (Date.now() < launchGuardUntil) return;

  // Zastor ima fokus => ispred njega nema ničega, program je zatvoren.
  if (backdrop && !backdrop.isDestroyed() && backdrop.isFocused()) {
    clearExternal();
    focusLauncher();
    return;
  }

  const images = [...new Set([...externalImages, ...[...spawnedGames].map((g) => g.image)])].filter(Boolean);
  // Ako ne znamo koji proces da pratimo (pokretač je izašao, igra radi pod
  // drugim imenom), NE diramo prvi plan - inače bismo prekrili igru.
  if (!images.length) return;

  anyRunning(images, (running) => {
    if (!running && Date.now() >= launchGuardUntil) { clearExternal(); focusLauncher(); }
  });
}

// Nadzor prozora: hvata Win+D, "minimize all", pad procesa i slično.
// Dok igra radi ne otimamo fokus (showInactive), samo ne dozvoljavamo
// da launcher ostane sakriven i otkrije desktop.
let watchdog = null;
let tick = 0;
function startWatchdog() {
  if (DEV || watchdog) return;
  watchdog = setInterval(() => {
    if (app.isQuitting) return;
    if (!win || win.isDestroyed()) { createWindow(); return; }

    if (sesijaAktivna) {
      // Igrač radi: ne diramo prvi plan uopšte. Sme da drži Discord, muziku i
      // igru i da se prebacuje kako hoće. Naš posao je samo da zastor pokriva
      // desktop i da prozor launchera ne ostane sakriven.
      if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false);
      showBackdrop();
      if (++tick % 4 === 0) presretniSkinute();
    } else if (gameActive()) {
      // Nema prijavljenog igrača, ali nešto još radi (npr. osoblje otvorilo Task Manager)
      if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false);
      showBackdrop();
      if (++tick % 5 === 0) checkGameGone();
    } else {
      // Login ili zaključan ekran: launcher mora biti iznad svega i neizbežan.
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

// ---------- Pokretanje igara ----------
const recentLaunch = new Map(); // putanja -> vreme (spreči dupli klik)

// Da li na sistemu i dalje postoji proces sa tim imenom (npr. igra koju je
// pokretač startovao pa se sam ugasio) - da ne otmemo fokus pokrenutoj igri.
function isProcessRunning(imageName, cb) {
  if (!imageName) return cb(false);
  exec(`tasklist /FI "IMAGENAME eq ${imageName}" /NH`, { windowsHide: true }, (err, stdout) => {
    cb(!err && String(stdout).toLowerCase().includes(String(imageName).toLowerCase()));
  });
}

// Argumenti se dele po razmacima, ali ono pod navodnicima ostaje celo
// ("-game C:\Moje igre\mod" ne sme da se raspadne).
function razdvojArgumente(s) {
  const out = String(s || "").match(/"[^"]*"|\S+/g) || [];
  return out.map((a) => a.replace(/^"|"$/g, ""));
}

// Igra koja nece da se pokrene javlja se i serveru, ne samo igracu. Do sada je
// to znao samo onaj ko sedi za tim racunarom: dobije "nije instalirana", slegne
// ramenima i pokrene nesto drugo. Vlasnik sazna tek ako se neko poduzi da mu
// kaze - a najcesci uzrok je precica koja bas na tom racunaru fali.
function javiDaNeRadi(igra, razlog) {
  try { wsSend({ t: "igra_ne_radi", igra: String(igra || "").slice(0, 80), razlog }); } catch {}
}

// Kvar na samom launcheru. Igrac to ne prijavljuje - on samo vidi da racunar
// "ne radi" i zove radnika. Ovako osoblje u panelu ima zapis sa imenom
// racunara, pa se vidi da li se ista masina javlja stalno.
function javiProblem(vrsta, opis) {
  console.error("[launcher]", vrsta, opis);
  try { wsSend({ t: "klijent_problem", vrsta: String(vrsta).slice(0, 40), opis: String(opis).slice(0, 200) }); } catch {}
}

// Igracu se NE prikazuje sistemska poruka. Windows javlja stvari poput
// "spawn C:\games\cs2.lnk ENOENT" ili "Access is denied" - to je engleski,
// tehnicki, i igracu ne kaze ni sta se desilo ni sta da radi. Osoblje i dalje
// dobija tacan razlog kroz "igra_ne_radi", pa se ovde ne gubi nista.
function objasniGresku(greska) {
  const kod = String(greska?.code || "");
  const tekst = String(greska?.message ?? greska ?? "");
  const kaze = (re) => re.test(tekst);
  if (kod === "ENOENT" || kaze(/ENOENT|cannot find|could not find|not found|ne mo\w+ da (se )?(na[đd]e|prona[đd]e)/i))
    return "Igra nije pronađena na ovom računaru.";
  if (kod === "EACCES" || kod === "EPERM" || kaze(/EACCES|EPERM|access is denied|denied|pristup je odbijen/i))
    return "Windows nije dozvolio pokretanje.";
  if (kod === "EBUSY" || kaze(/EBUSY|being used by another|zauzet/i))
    return "Igra je trenutno zauzeta.";
  return "Igra ne može da se pokrene.";
}

// TRAZENJE PRAVE PUTANJE
// Osoblje drzi precice u C:\games i u panel cesto upise samo "C:\games\cs2",
// bez nastavka - a na disku stoji "cs2.lnk". Bez ovoga bi igrac dobio poruku
// da igra nije instalirana, iako jeste.
// Vraca: { put } kad je nadjen fajl, { folder: true } kad je upisan folder,
// null kad nema niceg.
const NASTAVCI = [".lnk", ".exe", ".url", ".bat", ".cmd"];
function nadjiPutanju(p) {
  try {
    if (fs.existsSync(p)) {
      return fs.statSync(p).isDirectory() ? { folder: true } : { put: p };
    }
    // Nastavak nije upisan - proba se redom. Prvo .lnk, jer se precice
    // najcesce i koriste.
    if (!path.extname(p)) {
      for (const n of NASTAVCI) {
        if (fs.existsSync(p + n)) return { put: p + n };
      }
    }
  } catch {}
  return null;
}

// IZ CEGA SE VADI IKONA
// Sama precica (.lnk) NE daje ikonu programa - Windows za nju vrati sicusnu
// genericku slicicu (izmereno: 0.7 KB, dok pravi .exe da 2-5 KB). Zato se
// precica prvo procita da se sazna na sta pokazuje, pa se ikona uzme odatle.
// Bez ovoga bi sve igre u igraonici imale praznu ikonu, jer osoblje drzi
// precice u C:\games.
function izvorIkone(put) {
  if (!/\.lnk$/i.test(put)) return put;
  try {
    const veza = shell.readShortcutLink(put);
    // Precica sme da ima i svoju ikonu (desni klik > Promeni ikonu) - tada ta
    // ima prednost nad ikonom cilja.
    const izvor = veza.icon || veza.target;
    return izvor && fs.existsSync(izvor) ? izvor : put;
  } catch {
    return put;
  }
}

function launchGame(gamePath, args, name) {
  // "C:\Games\game.exe" -> C:\Games\game.exe (kopiranje putanje iz Windows-a
  // često ponese navodnike, pa spawn ne nađe fajl)
  gamePath = String(gamePath || "").trim().replace(/^"|"$/g, "").trim();
  if (!gamePath) return { ok: false, error: "Ova igra nema podešenu putanju. Pozovite osoblje." };

  // isti unos ne sme da se pokrene dvaput u 3 sekunde
  const now = Date.now();
  if (now - (recentLaunch.get(gamePath) || 0) < 3000) return { ok: true, ignored: true };
  recentLaunch.set(gamePath, now);

  try {
    // internet adresa -> sistemski pregledač (Alt+Tab)
    if (/^https?:\/\//i.test(gamePath)) { openBrowser(gamePath); return { ok: true }; }

    // protokol (steam://, epic://, com.epicgames.launcher://) -> prepusti sistemu
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(gamePath)) {
      shell.openExternal(gamePath).catch(() => {});
      markExternal(protocolImages(gamePath));
      startGuard();
      stepBack();
      return { ok: true };
    }

    const nadjena = nadjiPutanju(gamePath);
    if (!nadjena) {
      javiDaNeRadi(name || path.basename(gamePath), "nema");
      return { ok: false, error: `"${name || path.basename(gamePath)}" nije instalirana na ovom računaru. Pozovite osoblje.` };
    }
    if (nadjena.folder) {
      javiDaNeRadi(name || path.basename(gamePath), "folder");
      return { ok: false, error: `Za "${name || path.basename(gamePath)}" je upisan folder, a treba prečica ili .exe fajl. Pozovite osoblje.` };
    }
    gamePath = nadjena.put;

    // Prečice (.lnk), .url i .bat se ne mogu pokrenuti kroz spawn - njih otvara
    // Windows sam. Osoblje često zalepi baš putanju do prečice sa desktopa.
    if (/\.(lnk|url|bat|cmd)$/i.test(gamePath)) {
      shell.openPath(gamePath).then((greska) => {
        if (!greska) return;
        sendToRenderer("game-error", { name: name || path.basename(gamePath), message: objasniGresku(greska) });
        javiDaNeRadi(name || path.basename(gamePath), "greska");
      });
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
      javiDaNeRadi(entry.name, "greska");
      focusLauncher();
    });
    child.on("exit", () => {
      // Pokretač je izašao, ali igra verovatno tek startuje pod drugim imenom.
      // Ne vraćamo launcher ovde - o tome odlučuje nadzor kad gard istekne.
      spawnedGames.delete(entry);
    });

    // pusti igru u prvi plan
    stepBack();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function killAllGames() {
  for (const g of spawnedGames) {
    try { g.child.kill("SIGKILL"); } catch {}
    // pokretač je često već izašao - dokrajči i sam proces igre
    if (g.image) { try { exec(`taskkill /IM "${g.image}" /F /T`, { windowsHide: true }); } catch {} }
  }
  spawnedGames.clear();
  recentLaunch.clear();
  launchGuardUntil = 0;
}

// ---------- Web alati -> pravi sistemski pregledač (Chrome/podrazumevani) ----------
// Otvara se van launchera da bi radio Alt+Tab (igra + YouTube istovremeno).
// Launcher se umanji kad se otvori sajt, isto kao pri pokretanju igre.
function openBrowser(url) {
  const target = url || "https://www.google.com";
  shell.openExternal(target).catch(() => {});
  markExternal(BROWSER_IMAGES);
  startGuard();
  stepBack();
}
// Kraj sesije zatvara i pregledač: sledeći igrač ne sme da zatekne tuđe
// otvorene kartice i prijave.
function closeBrowser() {
  clearExternal();
  if (DEV || process.platform !== "win32") return;
  for (const img of BROWSER_IMAGES) {
    try { exec(`taskkill /IM "${img}" /F /T`, { windowsHide: true }, () => {}); } catch {}
  }
}

// ---------- IPC ----------
ipcMain.handle("get-config", () => ({ host: config.host, token: config.token, configured: config.configured }));
ipcMain.handle("save-config", (e, c) => {
  const r = saveConfig(c);
  if (r.ok) connectWs();
  return r;
});
// Brisanje podesavanja TRAZI servisni PIN. Bez toga je "Promeni adresu
// servera" bio otvoren put: iscupa se kabl, sacekaju se sekunde dok se dugme ne
// pojavi, i masina se preusmeri gde igrac hoce.
ipcMain.handle("reset-config", (e, pin) => {
  if (String(pin || "") !== servisniPin()) return { ok: false, error: "Pogrešan servisni PIN." };
  resetConfig();
  return { ok: true };
});
// Lokalna provera PIN-a - radi i kad server ne odgovara.
ipcMain.handle("proveri-servisni-pin", (e, pin) => ({ ok: String(pin || "") === servisniPin() }));
ipcMain.handle("to-server", (e, msg) => { wsSend(msg); return true; });
ipcMain.handle("launch-game", (e, { path: p, args, name }) => launchGame(p, args, name));
ipcMain.handle("open-browser", (e, url) => { openBrowser(url); return true; });
ipcMain.handle("focus-launcher", () => { focusLauncher(); return true; });

// ---------- Global hotkeys ----------
function registerHotkeys() {
  // Osoblje: otključaj računar (prompt za PIN u rendereru)
  globalShortcut.register("CommandOrControl+Alt+U", () => { focusLauncher(); sendToRenderer("hotkey", { action: "unlock" }); });
  // Vrati launcher u prvi plan (npr. izadji iz igre)
  globalShortcut.register("CommandOrControl+Alt+Home", () => { focusLauncher(); });
  // Admin izlaz iz launchera (prompt za PIN)
  globalShortcut.register("CommandOrControl+Alt+Shift+Q", () => { focusLauncher(); sendToRenderer("hotkey", { action: "exit" }); });

  // Ponovno podešavanje adrese/tokena. Radi samo kad NEMA veze sa serverom -
  // tada osoblju i treba, a igraču ne vredi ništa (i dalje je zaključan u launcheru).
  globalShortcut.register("CommandOrControl+Alt+Shift+R", () => {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    resetConfig();
  });
  if (DEV) return;

  // Prečice koje vode do desktopa, Start menija ili Task Manager-a.
  // Registracija ih "guta" dok launcher radi.
  //
  // Namerno NISU blokirani Alt+Tab i Alt+F4: igraču trebaju da zatvori ili
  // prebaci igru, a nisu opasni jer je launcher raširen ispod svega (desktop
  // se ne vidi) i njegov prozor se ne da zatvoriti.
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

// Windows politike po korisniku (HKCU, ne traži admin prava).
// Gasi Task Manager i opcije na Ctrl+Alt+Del ekranu dok launcher radi.
// Vraća se u normalu kroz admin izlaz, da osoblje ne ostane zaključano.
const POLICY_SYS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System";
const POLICY_EXP = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer";
// PLAN NAPAJANJA
// Windows fabrički gasi ekran i uspavljuje računar posle par minuta mirovanja.
// U igraonici to znaci crn ekran nasred filma ili striminga, i prekid igre koja
// se ne dira misem. Zato launcher prelazi na "High performance" i gasi
// uspavljivanje dok radi, a pri izlasku (admin izlaz) vraca sve kako je bilo.
//
// Vraca se na "Balanced" jer je to Windows fabricki plan; ako je vlasnik imao
// drugi, moze da ga izabere ponovo - nista se ne brise.
const PLAN_VISOKI = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";  // High performance
const PLAN_URAVNOTEZEN = "381b4222-f694-41f0-9685-ff5bb260df2e"; // Balanced
function planNapajanja(ukljuci) {
  if (NO_LOCK || process.platform !== "win32") return;
  const cmds = ukljuci
    ? [
        `powercfg /setactive ${PLAN_VISOKI}`,
        "powercfg /change monitor-timeout-ac 0",   // ekran se ne gasi
        "powercfg /change standby-timeout-ac 0",   // racunar ne ide na spavanje
        "powercfg /change disk-timeout-ac 0",
      ]
    : [
        `powercfg /setactive ${PLAN_URAVNOTEZEN}`,
        "powercfg /change monitor-timeout-ac 15",
        "powercfg /change standby-timeout-ac 30",
        "powercfg /change disk-timeout-ac 20",
      ];
  for (const c of cmds) exec(c, { windowsHide: true }, () => {});
}

function setPolicies(on) {
  if (NO_LOCK || process.platform !== "win32") return;
  const v = on ? 1 : 0;
  const cmds = [
    `reg add "${POLICY_SYS}" /v DisableTaskMgr /t REG_DWORD /d ${v} /f`,
    `reg add "${POLICY_SYS}" /v DisableLockWorkstation /t REG_DWORD /d ${v} /f`,
    `reg add "${POLICY_SYS}" /v DisableChangePassword /t REG_DWORD /d ${v} /f`,
    `reg add "${POLICY_EXP}" /v NoLogoff /t REG_DWORD /d ${v} /f`,
    `reg add "${POLICY_EXP}" /v NoWinKeys /t REG_DWORD /d ${v} /f`,
    `reg add "${POLICY_EXP}" /v NoClose /t REG_DWORD /d ${v} /f`,
  ];
  for (const c of cmds) exec(c, { windowsHide: true }, () => {});
}

ipcMain.handle("admin-exit", () => {
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
// Temperatura CPU-a preko WMI (radi na delu mašina; na desktopima često nije dostupno).
// Keširano da ne pokrećemo PowerShell prečesto; gracefully null ako ne uspe.
let _tempCache = { at: 0, val: null };
function cpuTemp() {
  return new Promise((resolve) => {
    if (Date.now() - _tempCache.at < 15000) return resolve(_tempCache.val);
    _tempCache.at = Date.now();
    exec(
      'powershell -NoProfile -Command "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1).CurrentTemperature"',
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        let v = null;
        const n = parseInt(String(stdout).trim(), 10);
        if (!err && n) v = Math.round(n / 10 - 273.15); // desetine Kelvina -> °C
        if (v != null && (v < 10 || v > 120)) v = null;
        _tempCache.val = v;
        resolve(v);
      }
    );
  });
}
ipcMain.handle("verzija", () => app.getVersion());
// Podešavanja miša i zvuka koja igrač menja sa svog naloga.
// Menja se samo dok traje sesija; zavrsiSesiju() vraća zatečeno.
ipcMain.handle("podesavanja-citaj", async () => {
  try { return await winPod.procitajSve(); }
  catch (e) { return { greska: String(e?.message || e).slice(0, 200) }; }
});
ipcMain.handle("podesavanja-primeni", async (e, sta) => {
  try {
    if (!sesijaAktivna) return { ok: false, error: "Nisi prijavljen." };
    if (sta?.mis) {
      const r = await winPod.primeniMis(sta.mis);
      if (!r.ok) return { ok: false, error: "Miš: " + r.greska };
    }
    if (sta?.zvuk && sta.zvuk.jacina != null) {
      const r = await winPod.primeniZvuk(sta.zvuk);
      if (!r.ok) return { ok: false, error: "Zvuk: " + r.greska };
    }
    return { ok: true, stanje: await winPod.procitajSve() };
  } catch (err) { return { ok: false, error: String(err?.message || err).slice(0, 200) }; }
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

// IKONA PROGRAMA
// Windows nosi pravu ikonu unutar .exe fajla. Koriste je i precice i igre bez
// okacene korice: svaki program koji osoblje doda dobija svoj pravi znak, bez
// spiska koji neko mora rucno da odrzava.
const ikoneProgramaKes = new Map(); // putanja -> data URL (ili null ako nema)

ipcMain.handle("program-icon", async (e, putanja) => {
  const p = String(putanja || "").trim().replace(/^"|"$/g, "").trim();
  if (!p) return null;
  if (ikoneProgramaKes.has(p)) return ikoneProgramaKes.get(p);

  let url = null;
  try {
    // Ista pravila kao pri pokretanju: ako nastavak nije upisan, trazi se
    // precica. Inace bi igra koja se uredno pokrece ostala bez ikone.
    // Za putanju koja ne postoji Windows vrati genericku ikonu nepoznatog
    // fajla - to nije logo programa, pa se ni ne uzima.
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

// Renderer javlja da je spreman: pusti bafer i zatraži svež state sa servera
ipcMain.handle("renderer-ready", () => {
  rendererReady = true;
  flushToRenderer();
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendToRenderer("ws-status", { connected: true });
    wsSend({ t: "hello" }); // server ponovo šalje welcome + trenutno stanje
  }
  return true;
});

// Renderer se javlja tek kad je stranica učitana i kad je zakačio slušaoce.
// Do tada poruke sa servera idu u bafer - inače bi "welcome" (igre, shop,
// podešavanja) stigao pre nego što stranica postoji i bio bi izgubljen.
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
  createWindow();
  registerHotkeys();
  setPolicies(true);
  planNapajanja(true);
  startWatchdog();
  connectWs();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Bez admin izlaza (PIN) aplikacija se ne gasi: ni zatvaranjem prozora,
// ni Alt+F4, ni preko "window-all-closed".
app.on("window-all-closed", () => {
  if (app.isQuitting) { if (process.platform !== "darwin") app.quit(); }
  else createWindow();
});
app.on("before-quit", (e) => {
  if (!app.isQuitting) { e.preventDefault(); focusLauncher(); }
});
app.on("will-quit", () => {
  clearInterval(watchdog);
  globalShortcut.unregisterAll();
  setPolicies(false); // vrati Task Manager i Ctrl+Alt+Del opcije
  planNapajanja(false); // vrati uspavljivanje i gašenje ekrana
});

// jedan instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on("second-instance", () => focusLauncher());
