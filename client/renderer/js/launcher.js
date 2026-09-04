// CRIT LAUNCHER (renderer)
const S = {
  // Pocetna vrednost dok "welcome" ne stigne. Bez imena igraonice - inace bi
  // druga igraonica na trenutak videla tudje ime na svom ekranu za prijavu.
  settings: { cafeName: "Igraonica", currency: "RSD", ratePerHour: 120 },
  host: "",
  computer: null,
  games: [],
  shop: [],
  tools: [],
  player: null,
  skoroIgrane: [],
  porudzbine: [],
  pozadine: {},
  tekstura: { kljuc: "nema", jacina: "srednje" },
  teksture: null,   // spisak sara za biranje, stize uz welcome
  mojaTekstura: null, // izbor ovog igraca; null znaci "kao u igraonici"
  promo: [],
  balance: 0,
  remaining: null,
  tocak: null,        // nagradni tocak: stanje za ovog igraca (prag, sme li da vrti)
  tocakVrti: false,   // dok animacija tocka traje
  winPodesavanja: null, // mis i zvuk procitani sa racunara; null dok se ne ucitaju
  sfxUkljucen: true,  // zvuci u launcheru
  animacije: true,    // animacije u launcheru (na slabijoj masini se gase)
  tab: "games",
  cart: new Map(),
  shopFilter: null,   // izabrana kategorija u shopu; null znači "sve"
  nacinPlacanja: "credit",
  nacinRucno: false,  // da li je igrac SAM izabrao nacin placanja (vidi renderCart)
  timer: null,
  pendingExit: false,
  pinSvrha: null,     // zašto je PIN tražen: "izlaz" ili "setup"
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString("sr-Latn-RS")} ${S.settings.currency}`;
// inicijali kad stavka nema sliku
const mono = (name) => esc(String(name || "?").trim().slice(0, 2).toUpperCase());
// srpska množina: 1 artikal, 2-4 artikla, 5+ artikala (11-14 idu na "mnogo")
function oblik(n, jedan, dva, mnogo) {
  const a = Math.abs(Math.round(n)), d = a % 10, s = a % 100;
  if (d === 1 && s !== 11) return jedan;
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return dva;
  return mnogo;
}
function dur(sec) {
  if (sec == null) return "bez limita";
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (x) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// male SVG ikone (stroke, currentColor)
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m10.29 3.86-8.18 14.14a2 2 0 0 0 1.71 3h16.36a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  play: '<path d="M6 4.5v15l13-7.5Z"/>',
  gamepad: '<path d="M6 12h4M8 10v4M15 11h.01M18 13h.01"/><rect x="2" y="6" width="20" height="12" rx="4"/>',
  bag: '<path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4Z"/><path d="M4 6h16M9 10a3 3 0 0 0 6 0"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cup: '<path d="M5 8h11v7a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5Z"/><path d="M16 10h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M7 2v3M11 2v3"/>',
  wallet: '<path d="M3 8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M16 12h3"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9"/><path d="M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5ZM12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5Z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 8-8M18 4l3 3M15 7l3 3"/>',
  // Znak profila. Dodat uz stranu Profil - ranije ga nije bilo, a bez ikone bi
  // stavka u meniju stajala prazna dok ostale imaju svoju.
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  // "image" se koristio za Moju pozadinu, ali ga u ovom spisku nije bilo - pa
  // se crtao prazan SVG i stavka je stajala bez ikone.
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  mis: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/>',
  zvuk: '<path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
};
const icon = (name, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;

// ZVUK (WebAudio sintetizovan, bez fajlova)
const sfx = (() => {
  let ac = null;
  const ctx = () => {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ac.state === "suspended") ac.resume();
    return ac;
  };
  function tone(freq, dur, type = "sine", vol = 0.05, sweep = null, delay = 0) {
    // Igrač koji je ugasio zvuke launchera (Nalog > Miš i zvuk) ne čuje ni jedan
    // od njih. Provera stoji ovde, na jednom mestu, umesto na svakom pozivu.
    if (S.sfxUkljucen === false) return;
    const a = ctx(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    o.connect(g); g.connect(a.destination);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
  }
  return {
    hover: () => tone(560, 0.045, "sine", 0.018),
    click: () => tone(300, 0.08, "triangle", 0.05, 620),
    notify: () => { tone(720, 0.09, "sine", 0.045, 980); tone(1080, 0.1, "sine", 0.035, null, 0.08); },
    success: () => { tone(660, 0.09, "sine", 0.05, 1000); tone(1000, 0.13, "sine", 0.045, null, 0.09); },
    error: () => tone(180, 0.24, "sawtooth", 0.05, 110),
    alert: () => { tone(880, 0.14, "square", 0.05); tone(620, 0.22, "square", 0.05, null, 0.16); },
    boot: () => { tone(150, 0.5, "sawtooth", 0.05, 700); tone(920, 0.2, "sine", 0.05, 1500, 0.26); },
    // Kucanje kazaljke po poljima tocka - kratko i suvo, da se ne stopi u zujanje.
    tik: () => tone(1750, 0.028, "square", 0.022),
  };
})();

// Animirano odbrojavanje brojeva
function countTo(el, to, fmt) {
  const from = Number(el.dataset.val || 0);
  el.dataset.val = to;
  // Kad je prozor sakriven/minimizovan (npr. dok traje igra), requestAnimationFrame
  // je pauziran - postavi konačnu vrednost odmah da broj ne ostane zastareo.
  if (from === to || document.hidden) { el.textContent = fmt(to); return; }
  const start = performance.now(), dur = 520;
  function step(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function bump(el) { if (!el) return; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }

// eksplozija "žetona" (nagradni efekat na uspešnu porudžbinu)
// Osvojen iznos odleti sa točka na kredit u HUD-u i tamo se "zalepi".
// Bez ovoga igrač vidi dve nepovezane stvari: poruku da je nešto osvojio, i
// brojku koja se u međuvremenu promenila. Ovako je to jedan pokret.
function letiNaKredit(iznos) {
  const layer = $("#fxLayer");
  const cilj = $("#hudBal")?.closest(".hud-chip");
  const izvor = document.querySelector(".tocak-obl");
  if (!layer || !cilj || !izvor) return;
  const a = izvor.getBoundingClientRect(), b = cilj.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "leti-kredit";
  el.textContent = "+" + money(iznos);
  el.style.left = `${a.left + a.width / 2}px`;
  el.style.top = `${a.top + a.height / 2}px`;
  el.style.setProperty("--dx", `${b.left + b.width / 2 - (a.left + a.width / 2)}px`);
  el.style.setProperty("--dy", `${b.top + b.height / 2 - (a.top + a.height / 2)}px`);
  layer.appendChild(el);
  setTimeout(() => { cilj.classList.add("primio"); setTimeout(() => cilj.classList.remove("primio"), 700); }, 700);
  setTimeout(() => el.remove(), 1300);
}

function burstCoins(x, y, n = 16) {
  const layer = $("#fxLayer");
  if (!layer) return;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = "coin" + (Math.random() < 0.4 ? " red" : "");
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const dist = 60 + Math.random() * 130;
    p.style.left = x + "px"; p.style.top = y + "px";
    p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
    p.style.setProperty("--dy", (Math.sin(ang) * dist - 70) + "px");
    p.style.animationDelay = (Math.random() * 0.06).toFixed(3) + "s";
    layer.appendChild(p);
    setTimeout(() => p.remove(), 1050);
  }
}

// idle "attract" na login ekranu (mami igrače kad računar stoji prazan)
let _idleT = null;
function resetIdle() {
  document.body.classList.remove("attract");
  clearTimeout(_idleT);
  _idleT = setTimeout(() => {
    if ($("#loginScreen").classList.contains("active")) document.body.classList.add("attract");
  }, 40000);
}

// Ako se server ne javi u par sekundi, ponudi ponovno podesavanje -
// da osoblje ne ostane zarobljeno na ekranu "Povezivanje".
let connFailTicks = 0;
setInterval(() => {
  const onConn = $("#connScreen") && $("#connScreen").classList.contains("active");
  if (!onConn) { connFailTicks = 0; return; }
  if (S.wsOk) return;
  if (++connFailTicks === 8) $("#connHelp").classList.remove("hidden");
}, 1000);

function show(id) {
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  primeniPozadinu();
}
// Trajanje je podesivo jer nova poruka nije kao nova poruka: "nalog dopunjen"
// se procita za sekund, a "nov nivo, otkljucano ti je ovo i ono" trazi duze -
// inace nestane pre nego sto igrac stigne da vidi sta je dobio.
function toast(msg, type = "info", trajanje = 3000) {
  const el = document.createElement("div");
  el.className = "toast " + type;
  const ic = type === "success" ? "check" : type === "error" ? "alert" : type === "nivo" ? "gift" : "info";
  el.innerHTML = `<span class="t-ic">${icon(ic)}</span><span class="t-msg"></span>`;
  el.querySelector(".t-msg").textContent = msg;
  $("#toasts").appendChild(el);
  // Obicno obavestenje ostaje tiho - zvuk je za ono sto se desilo igracu.
  if (type === "error") sfx.error(); else if (type === "success" || type === "nivo") sfx.success();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 280); }, trajanje);
}

// Init
(async function init() {
  ucitajIzborLaunchera(); // zvuci i animacije, pre prvog crtanja
  const cfg = await window.crit.getConfig();
  S.host = (cfg.host || "").replace(/\/$/, "");
  if (!cfg.configured) {
    $("#cfgHost").value = cfg.host || "";
    show("setupScreen");
    // adresa je vec popunjena iz podesavanja.json -> kursor odmah na token
    setTimeout(() => $(cfg.host ? "#cfgToken" : "#cfgHost").focus(), 120);
  } else show("connScreen");

  window.crit.onNeedSetup(async () => {
    const c = await window.crit.getConfig();
    $("#cfgHost").value = c.host || "";
    $("#cfgToken").value = "";
    $("#cfgErr").textContent = "";
    show("setupScreen");
    setTimeout(() => $(c.host ? "#cfgToken" : "#cfgHost").focus(), 120);
  });
  window.crit.onWsStatus(({ connected }) => {
    S.wsOk = connected;
    // Stanje veze igrac vidi u donjoj traci dok radi, i na ekranu "Povezivanje"
    // kad veza pukne. Plutajuca oznaka preko ekrana prijave je bila visak.
    updateServerStatus(connected);
    if (!connected && !$("#setupScreen").classList.contains("active")) {
      // Točak koji čeka odgovor se otpušta odmah: preko puknute veze ishod
      // ionako više ne može da stigne, a dok "vrtnja traje" launcher odbacuje
      // svako novo stanje kredita - pa bi HUD ostao zamrznut i posle povratka
      // veze, dok naplata teče dalje.
      otpustiTocak("Veza je pukla usred vrtnje. Spin nije potrošen.");
      // server pauzira naplatu dok nema veze - zaustavi i odbrojavanje,
      // inače bi tajmer lažno otišao u crveno dok stojimo na "Povezivanje..."
      stopTimer();
      $("#connText").textContent = "Povezivanje sa serverom...";
      // Poruka o vremenu ide samo igracu kome je veza pukla USRED sesije.
      // Pri paljenju racunara nema sta da se cuva, pa bi samo zbunjivala.
      $("#connSesija").classList.toggle("hidden", !S.player);
      show("connScreen");
    }
    if (connected) $("#connSesija").classList.add("hidden");
  });
  window.crit.onHotkey(({ action }) => {
    if (action === "unlock") { if ($("#lockedScreen").classList.contains("active")) otkrijPinOsoblja(); }
    else if (action === "exit") openPin("Admin izlaz iz launchera", true);
  });
  window.crit.onServerMsg(handleMsg);
  if (window.crit.onBlokirano) {
    window.crit.onBlokirano(({ ime }) =>
      toast(`Pokretanje preuzetih programa nije dozvoljeno (${ime}). Ako ti nešto treba, pitaj osoblje.`, "error"));
  }
  if (window.crit.onGameError) {
    window.crit.onGameError(({ name, message }) => toast(`Ne mogu da pokrenem ${name}: ${message}`, "error"));
  }
  // tek sada je sve zakačeno - javi main procesu da može da pusti poruke
  if (window.crit.ready) window.crit.ready();
  resetIdle();
})();

// POZADINE EKRANA
// Osoblje ih kaci kroz panel, launcher ih samo primenjuje. Menjaju se u letu,
// bez restarta, jer server posalje novo stanje svim racunarima odjednom.
// Saru crta server (service.js), ovde se samo prosledi u CSS. Stariji server
// ovo polje ne salje uopste - tada tekstura ostaje ugasena, umesto da ekran
// zavrsi u polovicnom stanju.
// BREND: ZNAK I BOJA IGRAONICE
//
// Znak i boja su nekad stajali ušiveni u fajlove - ali sledeća igraonica nije
// ista. Dok je tako bilo,
// znak i boja stajali ušiveni u fajlove, svaka bi morala da dobije prepravljenu
// kopiju programa, pa bi i svaka nadogradnja morala da se pravi posebno za
// svakoga.
//
// Ovde se menja SAMO boja kuće (`--brend*`). Zlatna, zelena i ostale ostaju:
// zelena je "ima kredita", crvena "ističe vreme" - to su značenja, ne ukras, i
// ne smeju da zavise od toga koju je boju vlasnik izabrao.
function primeniBrend(b) {
  if (!b) return;
  S.brend = b;
  const s = document.documentElement.style;
  s.setProperty("--brend", b.akcenat);
  // Odsjaji, senke i traka za pomeranje se pisu kao rgba(var(--brend-rgb), x).
  // Dok je boja stajala upisana u CSS-u, izbor vlasnika je menjao samo pola
  // ekrana - ostalo je ostajalo crveno.
  s.setProperty("--brend-rgb", b.rgb);
  s.setProperty("--brend-deep", b.down);
  s.setProperty("--brend-soft", `rgba(${b.rgb}, 0.15)`);
  s.setProperty("--brend-glow", `rgba(${b.rgb}, 0.55)`);
  // Znak na svim ekranima: podešavanje, prijava, gornja traka, zaključan ekran.
  if (b.logo) {
    const put = (S.host || "") + b.logo;
    $$(".brand-logo, .topbar-logo, .lb-logo").forEach((i) => { i.src = put; i.alt = b.naziv || ""; });
  }
}

function primeniTeksturu(t) {
  if (t && typeof t === "object") S.tekstura = t;
  const sara = String(S.tekstura?.sara || "");
  const vid = Number(S.tekstura?.prozirnost);
  const korak = Number(S.tekstura?.korak);
  const sekundi = Number(S.tekstura?.sekundi);
  // Prima se samo oblik koji server stvarno salje - url("data:image/svg+xml,...").
  const ispravna = /^url\("data:image\/svg\+xml,[^"]*"\)$/.test(sara);
  const st = document.body.style;
  st.setProperty("--tekstura", ispravna ? sara : "none");
  st.setProperty("--tekstura-vid", ispravna && vid >= 0 && vid <= 1 ? String(vid) : "0");
  // Kretanje: 0s znaci da sara stoji. Gornja granica je zastita od zapisa koji
  // bi napravio animaciju od sat vremena ili obrnuto - trepereci ekran.
  const kreceSe = ispravna && Number.isFinite(sekundi) && sekundi >= 3 && sekundi <= 120
    && Number.isFinite(korak) && korak > 0;
  // Korak vazi kad god sara postoji, ne samo kad se pomera: iskre ga koriste da
  // se crvena figura poklopi sa belom, a nemaju trajanje animacije.
  const imaKorak = ispravna && Number.isFinite(korak) && korak > 0;
  st.setProperty("--tekstura-korak", imaKorak ? `${korak}px` : "0px");
  st.setProperty("--tekstura-sekundi", kreceSe ? `${sekundi}s` : "0s");

  // Vrstu kretanja bira CSS preko ovog atributa. Prima se samo ono sto je
  // poznato, da nepoznata vrednost ne ostavi ekran u polovicnom stanju.
  // "Iskre" nemaju trajanje animacije (sekundi = 0), pa se ne traze kroz
  // kreceSe nego zasebno - njima je dovoljno da sara postoji.
  const zna = KRETANJA_UI.includes(S.tekstura?.kretanje);
  const iskreRade = zna && S.tekstura.kretanje === "iskre" && ispravna
    && Number.isFinite(korak) && korak > 0 && /^url\("data:image\/svg\+xml,[^"]*"\)$/.test(String(S.tekstura?.iskra || ""));
  const vrsta = (kreceSe && zna) || iskreRade ? S.tekstura.kretanje : "mirno";

  document.body.dataset.kretanje = vrsta;
  st.setProperty("--tekstura-iskra", iskreRade ? S.tekstura.iskra : "none");
  pratiMisZaDubinu(vrsta === "dubina");
  pustiIskre(iskreRade ? korak : 0);
}

// ISKRE
// Preko nasumicne plocice u mrezi legne ISTA figura u boji kuce, zasvetli i
// ugasi se. Da bi se crvena figura poklopila sa belom ispod nje, iskra mora da
// stoji tacno na koraku mreze - zato se pozicija zaokruzuje na ceo korak.
// Namerno ih je malo i traju kratko: ovo stoji ceo dan iza igara i treba da se
// primeti tek kad pogled odluta, ne da vuce paznju.
const NAJVISE_ISKRI = 5;
let iskreKorak = 0, iskreTajmer = null, iskreSloj = null;

function pustiIskre(korak) {
  if (korak === iskreKorak) return;
  iskreKorak = korak;
  clearInterval(iskreTajmer); iskreTajmer = null;
  if (iskreSloj) { iskreSloj.remove(); iskreSloj = null; }
  if (!korak) return;

  iskreSloj = document.createElement("div");
  iskreSloj.className = "iskre-sloj";
  document.body.appendChild(iskreSloj);

  const zapali = () => {
    if (!iskreSloj || iskreSloj.childElementCount >= NAJVISE_ISKRI) return;
    // Mreza pocinje od 0 0, isto kao pozadina - zato se bira ceo korak.
    const kolona = Math.floor(Math.random() * Math.ceil(window.innerWidth / korak));
    const red = Math.floor(Math.random() * Math.ceil(window.innerHeight / korak));
    const i = document.createElement("i");
    i.className = "iskra";
    i.style.left = `${kolona * korak}px`;
    i.style.top = `${red * korak}px`;
    i.style.width = `${korak}px`;
    i.style.height = `${korak}px`;
    // Svaka gori malo drugacije dugo, da se ne pale u ritmu.
    i.style.animationDuration = `${(2.2 + Math.random() * 1.8).toFixed(2)}s`;
    i.addEventListener("animationend", () => i.remove(), { once: true });
    iskreSloj.appendChild(i);
  };

  zapali();
  iskreTajmer = setInterval(zapali, 900);
}

// DUBINA: blizi sloj sare prati pokret misa.
// Racuna se u ritmu iscrtavanja, ne na svaki dogadjaj misa - inace bi se posao
// gomilao dok igrac brzo prevlaci po ekranu.
const KRETANJA_UI = ["klizanje", "talas", "dubina", "iskre"];
let dubinaUkljucena = false, dubinaZakazana = false, dubinaX = 0, dubinaY = 0;

function dubinaPomeraj(e) {
  dubinaX = (e.clientX / window.innerWidth - 0.5) * 2;   // -1 levo, 1 desno
  dubinaY = (e.clientY / window.innerHeight - 0.5) * 2;
  if (dubinaZakazana) return;
  dubinaZakazana = true;
  requestAnimationFrame(() => {
    dubinaZakazana = false;
    // Pomeraj je mali (do 26 px): pozadina treba da "dise" uz pokret, ne da se
    // vozi po ekranu i vuce pogled sa igara.
    document.body.style.setProperty("--par-x", `${(-dubinaX * 26).toFixed(1)}px`);
    document.body.style.setProperty("--par-y", `${(-dubinaY * 18).toFixed(1)}px`);
  });
}

function pratiMisZaDubinu(uklj) {
  if (uklj === dubinaUkljucena) return;
  dubinaUkljucena = uklj;
  if (uklj) {
    window.addEventListener("pointermove", dubinaPomeraj, { passive: true });
  } else {
    window.removeEventListener("pointermove", dubinaPomeraj);
    document.body.style.setProperty("--par-x", "0px");
    document.body.style.setProperty("--par-y", "0px");
  }
}

function primeniPozadinu() {
  const el = $("#pozadina");
  if (!el) return;
  const zaEkran = {
    setupScreen: "prijava",
    connScreen: "prijava",
    loginScreen: "prijava",
    lockedScreen: "zakljucan",
    desktopScreen: { home: "pocetna", shop: "shop", account: "nalog" }[S.tab] || "pocetna",
  };
  const aktivan = $$(".screen").find((s) => s.classList.contains("active"))?.id;
  const slika = (S.pozadine || {})[zaEkran[aktivan]] || null;
  const zeljeno = slika ? `url('${S.host}${slika}')` : "";
  // Prepisivanje iste vrednosti pravi vidljiv trzaj (opacity prelaz krene ispocetka),
  // pa se sloj dira samo kad se slika stvarno menja.
  if (el.dataset.art !== zeljeno) {
    el.dataset.art = zeljeno;
    el.style.backgroundImage = zeljeno;
    el.classList.toggle("ima", !!slika);
  }
  // Prazni ekrani (prijava, zaključan) nose samo jednu karticu, pa slika sme
  // jače da se vidi. Ekrani sa sadržajem drže jači zastor, da korice i tekst
  // ostanu glavna stvar.
  const prazan = aktivan === "loginScreen" || aktivan === "lockedScreen";
  document.body.classList.toggle("pozadina-prazna", prazan && !!slika);
  // Prazni ekrani (prijava, zakljucan) nemaju sadrzaj preko sare, pa bi se
  // ponavljanje videlo kao vodeni zig. Tamo sara ide tise.
  document.body.classList.toggle("tiha-sara", aktivan === "loginScreen" || aktivan === "lockedScreen" || aktivan === "connScreen");
}

// Prazan racunar stoji satima na ekranu prijave i to je izlog igraonice.
// Iza forme ide baner izdvojene igre, mutan i utisan, da ekran ne bude crn.
function postaviPozadinuPrijave() {
  const fon = $("#loginFon");
  if (!fon) return;
  // Postoji prava pozadina za prijavu (16:9) - ona ide u glavni sloj, a ovaj
  // pomocni ostaje prazan. Rezervno se uzima baner igre; on je sirok i preko
  // celog ekrana izgleda bolje nego uspravan omot, pa ide PRE omota.
  const sopstvena = (S.pozadine || {}).prijava;
  const g = sopstvena ? null : (S.games.find((x) => x.banner) || S.games.find((x) => x.image));
  const art = sopstvena ? null : (g && (g.banner || g.image));
  const zeljeno = art ? `url('${S.host}${art}')` : "";
  // Ne diraj sloj ako se slika nije promenila. Ranije se pri svakom osvezavanju
  // kataloga vrednost ponovo upisivala, pa je pozadina vidno "skakala".
  if (fon.dataset.art === zeljeno) return;
  fon.dataset.art = zeljeno;
  fon.style.backgroundImage = zeljeno;
  fon.classList.toggle("ima", !!art);
}

// Server poruke
function handleMsg(m) {
  switch (m.t) {
    case "welcome":
      S.settings = m.settings; S.computer = m.computer; S.games = m.games || []; S.shop = m.shop || []; S.tools = m.tools || [];
      S.pozadine = m.pozadine || {};
      S.promo = m.promo || [];
      S.teksture = m.teksture || null;
      primeniBrend(m.brend);
      primeniPozadinu();
      primeniTeksturu(m.tekstura);
      $("#loginPc").textContent = m.computer?.name || "-";
      // Ekran prijave nosi i podatke kuće - gost sa ulice ih tu i traži.
      $("#loginKuca").textContent = S.settings.cafeName || "Igraonica";
      $("#loginCena").textContent = S.settings.ratePerHour > 0 ? money(S.settings.ratePerHour) : "-";
      postaviPozadinuPrijave();
      break;
    case "catalog": {
      // osoblje je izmenilo shop/igre/alate - osveži i izbaci iz korpe što više nije dostupno
      S.shop = m.shop || []; S.games = m.games || []; if (m.tools) S.tools = m.tools;
      for (const id of [...S.cart.keys()]) {
        const it = S.shop.find((x) => x.id === id);
        if (!it || !it.available) S.cart.delete(id);
      }
      if (S.tab === "shop" || S.tab === "home") renderContent();
      break;
    }
    case "to_login":
      S.player = null; stopTimer(); document.body.classList.remove("desktop-active");
      $("#pPass").value = ""; $("#pUser").value = ""; $("#loginErr").textContent = "";
      show("loginScreen"); $("#pUser").focus(); resetIdle();
      break;
    case "login_ok":
      clearLoginPending();
      S.player = m.player; S.balance = m.balance; S.remaining = m.remainingSeconds;
      S.skoroIgrane = Array.isArray(m.skoroIgrane) ? m.skoroIgrane : [];
      S.porudzbine = Array.isArray(m.porudzbine) ? m.porudzbine : [];
      // Igraceva pozadina stize odmah uz prijavu, da kucna ne bljesne pa se
      // promeni cim se ekran otvori. "mojaTekstura" je null kad igrac nije
      // birao svoju, pa vazi ono sto je vlasnik podesio.
      if (m.tekstura) primeniTeksturu(m.tekstura);
      S.mojaTekstura = m.mojaTekstura || null;
      S.vip = m.vip || null;
      S.profil = m.profil || null;
      S.accSekcija = null; // sledeci igrac ne nasledjuje odeljak koji je prethodni gledao
      S.tocak = m.tocak || null;
      osveziZnackuNaloga();
      S.cart.clear(); S.nacinPlacanja = "credit"; S.nacinRucno = false;
      playBoot(S.player?.displayName || S.player?.username);
      enterDesktop();
      break;
    case "login_err":
      clearLoginPending();
      $("#loginErr").textContent = m.message; $("#pPass").value = "";
      break;
    case "balance":
      // DOK SE TOČAK VRTI, STANJE SE NE DIRA.
      //
      // Server doda nagradu i pošalje novo stanje ODMAH, a točak se vrti pet
      // sekundi. Kredit se zato tiho menjao usred vrtnje, pre nego što igrač
      // sazna šta je dobio - a kad se nagrada objavi, brojka se više ne pomera.
      // Ispada da nagrada nije ni dodata. Zato se poslednje stanje zadrži i
      // upiše tačno u trenutku kad se nagrada pokaže.
      if (S.tocakVrti) { S.tocakStanje = { balance: m.balance, remaining: m.remainingSeconds }; break; }
      S.balance = m.balance; S.remaining = m.remainingSeconds; updateHud();
      // Iskustvo raste dok naplata tece, pa traka na vrhu pocetne mora da se
      // pomera dok igrac gleda - inace bi napredak postojao samo u bazi.
      if (m.vip) { S.vip = m.vip; osveziVip(); }
      break;
    case "tocak":
      // Vlasnik je upalio/ugasio tocak ili promenio nagrade - osvezi prikaz.
      S.tocak = m.tocak || null;
      if (S.tab === "account" && !S.tocakVrti) renderContent();
      break;
    case "tocak_rezultat":
      // Odgovor je stigao - rok za čekanje više ne treba.
      clearTimeout(tocakRokTajmer); tocakRokTajmer = null;
      // Stanje se osvežava zasebnom "balance" porukom; ovde samo pokrećemo
      // animaciju koja na kraju pokaže nagradu i novo stanje.
      animirajTocak(m.index, m.nagrada, m.sledeciSpin);
      break;
    case "tocak_err":
      S.tocak = m.tocak || S.tocak;
      otpustiTocak(m.message);
      break;
    case "locked":
      stopTimer(); S.player = null; document.body.classList.remove("desktop-active");
      sfx.alert();
      $("#lockTitle").textContent = m.reason === "time" ? "Vreme je isteklo" : "Računar je zaključan";
      $("#lockSub").textContent = m.reason === "time" ? "Kredit je potrošen. Dopuni na kasi pa nastavi gde si stao." : "Pozovite osoblje da otključa računar.";
      $("#lockIcon").classList.toggle("time", m.reason === "time");
      $("#lockPin").value = ""; $("#lockErr").textContent = "";
      sakrijPinOsoblja();
      show("lockedScreen");
      break;
    case "unlock_ok":
      // OTKLJUCAVANJE OTKLJUCAVA, NE GASI LAUNCHER.
      //
      // Ovde je ranije stajalo `if (S.pendingExit) adminExit()`. Ostatak iz
      // vremena kad je admin izlaz isao kroz istu poruku kao otkljucavanje;
      // danas ide svojim putem (verify_pin -> pin_ok -> pinPrihvacen).
      //
      // Posledica: cim se otvori prozor za admin izlaz (Ctrl+Alt+Shift+Q),
      // launcher upamti "izlazim" - i onda ga je BILO KAKVO otkljucavanje
      // gasilo: radnik sa panela, "Otkljucaj sve", ili sam igrac PIN-om na
      // zakljucanom ekranu. Masina ostaje bez launchera do sledeceg paljenja.
      //
      // A splet okolnosti nije redak nego svakodnevni: na zakljucanom ekranu
      // stoje dva polja za PIN, radnik ukuca u ono koje mu je blize.
      //
      // Prozor za PIN se pri tom zatvara: racunar je otkljucan, nema sta vise
      // da se potvrdjuje.
      if (S.pendingExit || S.pinSvrha) odustaniOdPina();
      toast("Otključano", "success");
      break;
    case "unlock_err":
      $("#lockErr").textContent = m.message || "Pogrešan PIN"; $("#lockPin").value = "";
      break;
    case "pin_ok":
      pinPrihvacen();
      break;
    case "pin_err":
      $("#pinErr").textContent = m.wait ? `Previše pokušaja. Sačekajte ${m.wait} s.` : "Pogrešan PIN";
      $("#pinInput").value = "";
      break;
    case "message":
      $("#msgText").textContent = m.text; $("#msgOverlay").classList.add("active"); sfx.notify();
      break;
    case "order_ok": {
      S.balance = m.balance; S.remaining = m.remainingSeconds;
      // Nova korpa krece cista: i artikli i nacin placanja. Bez ovoga bi
      // jednom izabran kes vazio do kraja smene.
      S.cart.clear(); S.nacinPlacanja = "credit"; S.nacinRucno = false;
      novPoId();
      clearOrderPending();
      updateHud(); if (S.tab === "shop") renderContent();
      const chip = $("#hudBal")?.closest(".hud-chip");
      if (chip) { const r = chip.getBoundingClientRect(); burstCoins(r.left + r.width / 2, r.bottom + 4); }
      toast(m.payment === "cash"
        ? `Porudžbina je primljena. Pripremi ${money(m.total)} u kešu.`
        : "Porudžbina je primljena", "success");
      break;
    }
    case "order_err":
      clearOrderPending();
      toast(m.message, "error");
      break;
    case "order_status": {
      const label = { preparing: "se priprema", delivered: "je dostavljena", cancelled: "je otkazana" }[m.status];
      if (label) toast("Porudžbina " + label, m.status === "cancelled" ? "error" : "success");
      break;
    }
    case "promo":
      S.promo = m.promo || [];
      if (S.tab === "home") { renderContent(); pokreniPromo(); }
      break;
    case "pozadine":
      S.pozadine = m.pozadine || {};
      primeniPozadinu();
      postaviPozadinuPrijave();
      break;
    case "brend":
      // Vlasnik je promenio znak ili boju - vidi se odmah, na svih 13 masina.
      primeniBrend(m.brend);
      break;
    case "tekstura":
      primeniTeksturu(m.tekstura);
      // Server javlja i sta je igrac izabrao; null znaci "kao u igraonici".
      if ("moja" in m) S.mojaTekstura = m.moja || null;
      if (S.tab === "account") renderContent();
      break;
    case "moja_tekstura_err":
      toast(m.message || "Ne mogu da promenim pozadinu.", "error");
      break;
    case "vip":
      S.vip = m.vip || null;
      osveziVip();
      break;
    case "profil":
      S.profil = m.profil || null;
      if (S.tab === "account") renderContent();
      break;
    case "profil_err":
      toast(m.message || "Ne mogu da promenim profil.", "error");
      break;
    case "nivo_gore":
      proslaviNivo(m);
      break;
    case "moje_porudzbine":
      S.porudzbine = Array.isArray(m.porudzbine) ? m.porudzbine : [];
      osveziZnackuNaloga();
      if (S.tab === "account") renderContent();
      break;
    case "pw_ok":
      toast("Lozinka je promenjena", "success"); if (S.tab === "account") renderContent();
      break;
    case "pw_err":
      toast(m.message, "error");
      break;
    case "error":
      clearOrderPending();
      toast(m.message, "error");
      break;
  }
}

// Setup
// Ulaz u podešavanja TRAŽI servisni PIN. Ovo dugme se pojavljuje kad server ne
// odgovara - a to igrač izazove čupanjem mrežnog kabla. Bez provere bi mogao da
// obriše podešavanje računara ili da ga preusmeri na svoj server.
$("#connSetup").addEventListener("click", () => openPin("Servisni PIN - promena adrese servera", false, "setup"));

$("#cfgSave").addEventListener("click", async () => {
  const host = $("#cfgHost").value.trim(), token = $("#cfgToken").value.trim();
  $("#cfgErr").textContent = "";
  const r = await window.crit.saveConfig({ host, token });
  if (!r || !r.ok) { $("#cfgErr").textContent = (r && r.error) || "Neispravna adresa servera."; return; }
  S.host = r.host;          // main vraca dopunjenu adresu (doda http:// i port)
  connFailTicks = 0;
  $("#connHelp").classList.add("hidden");
  show("connScreen");
});

// Login
let loginPending = false;
$("#loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (loginPending) return;
  const username = $("#pUser").value.trim(), password = $("#pPass").value;
  if (!username || !password) return;
  $("#loginErr").textContent = "";
  loginPending = true;
  const btn = $("#loginForm button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Prijavljujem..."; }
  window.crit.toServer({ t: "login", username, password });
  clearTimeout(clearLoginPending._t);
  clearLoginPending._t = setTimeout(clearLoginPending, 8000);
});
function clearLoginPending() {
  loginPending = false;
  clearTimeout(clearLoginPending._t);
  const btn = $("#loginForm button[type=submit]");
  if (btn) { btn.disabled = false; btn.textContent = "Prijavi se"; }
}

$("#logoutBtn").addEventListener("click", () => $("#confirmOverlay").classList.add("active"));
$("#cfNo").addEventListener("click", () => $("#confirmOverlay").classList.remove("active"));
$("#cfYes").addEventListener("click", () => {
  $("#confirmOverlay").classList.remove("active");
  window.crit.toServer({ t: "logout" });
});

// Desktop
function enterDesktop() {
  show("desktopScreen");
  document.body.classList.add("desktop-active");
  document.body.classList.remove("attract"); clearTimeout(_idleT);
  S.tab = "home";
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "home"));
  updateHud();
  renderContent();
  startTimer();
  startStatusBar();
}

// DONJA TRAKA (info o računaru)
const setSb = (sel, txt) => { const el = $(sel); if (el) el.querySelector(".sb-txt").textContent = txt; };
function updateClock() { setSb("#sbClock", new Date().toLocaleTimeString("sr-Latn-RS", { hour: "2-digit", minute: "2-digit" })); }
// Verzija u donjoj traci. Kad se jedan racunar ponasa drugacije od ostalih,
// ovo je prvo sto se pogleda - ranije nigde nije pisalo koji je launcher gde.
async function upisiVerziju() {
  if (!window.crit.verzija) return;
  try { setSb("#sbVerzija", "v" + (await window.crit.verzija())); } catch {}
}
function updateServerStatus(connected) {
  const el = $("#sbNet"); if (!el) return;
  el.classList.toggle("ok", connected);
  el.querySelector(".sb-txt").textContent = connected ? "Server: povezan" : "Server: nema veze";
}
async function pollSys() {
  if (!window.crit.sysStats) return;
  try {
    const s = await window.crit.sysStats();
    setSb("#sbCpu", s.cpu != null ? `CPU ${s.cpu}%` : "CPU -");
    setSb("#sbRam", s.ramUsedPct != null ? `RAM ${s.ramUsedPct}%${s.ramGb ? " / " + s.ramGb + "GB" : ""}` : "RAM -");
    const t = $("#sbTemp");
    if (t) { t.querySelector(".sb-txt").textContent = s.temp != null ? `${s.temp}°C` : "temp -"; t.classList.toggle("hot", s.temp != null && s.temp >= 80); }
  } catch {}
}
let _inetT = null;
function checkInternet() {
  const el = $("#sbInet"); if (!el) return;
  clearTimeout(_inetT);
  let settled = false;
  const done = (ok) => { if (settled) return; settled = true; el.classList.toggle("ok", ok); el.querySelector(".sb-txt").textContent = ok ? "Internet: OK" : "Internet: nema"; };
  const img = new Image();
  img.onload = () => done(true);
  img.onerror = () => done(false);
  img.src = "https://www.google.com/favicon.ico?ts=" + Date.now();
  _inetT = setTimeout(() => done(false), 5000);
}
function startStatusBar() {
  setSb("#sbPc", S.computer?.name || "PC");
  updateServerStatus(S.wsOk);
  updateClock(); pollSys(); checkInternet(); upisiVerziju();
  clearInterval(startStatusBar._clk); startStatusBar._clk = setInterval(updateClock, 1000);
  clearInterval(startStatusBar._sys); startStatusBar._sys = setInterval(pollSys, 3000);
  clearInterval(startStatusBar._net); startStatusBar._net = setInterval(checkInternet, 30000);
}
function applyTimerState() {
  const r = S.remaining;
  $("#timerBox").classList.toggle("low", r != null && r <= 300);
  document.body.classList.toggle("time-critical", r != null && r > 0 && r <= 60);
  const ht = document.querySelector(".hero-time"); if (ht) ht.textContent = dur(r);
  const at = $("#accTime"); if (at) at.textContent = dur(r);
}
function updateHud() {
  $("#hudName").textContent = S.player?.displayName || S.player?.username || "-";
  const balEl = $("#hudBal");
  const prev = Number(balEl.dataset.val || 0);
  const now = Math.round(S.balance);
  countTo(balEl, now, (v) => money(v));
  if (prev !== now) bump(balEl.closest(".hud-chip"));
  $("#hudTimer").textContent = dur(S.remaining);
  applyTimerState();
}
function playBoot(name) {
  const ov = $("#bootOverlay");
  if (!ov) return;
  $("#bootLine").textContent = name ? `Dobrodošao, ${String(name).toUpperCase()}` : "Sistem spreman";
  ov.classList.remove("hidden", "out"); ov.classList.add("active");
  sfx.boot();
  clearTimeout(playBoot._t);
  playBoot._t = setTimeout(() => {
    ov.classList.add("out");
    setTimeout(() => { ov.classList.remove("active", "out"); ov.classList.add("hidden"); }, 420);
  }, 1550);
}
function startTimer() {
  stopTimer();
  applyTimerState(); // stopTimer gasi alarm - vrati stvarno stanje odmah, ne tek za sekundu
  S.timer = setInterval(() => {
    if (S.remaining == null) return;
    S.remaining = Math.max(0, S.remaining - 1);
    $("#hudTimer").textContent = dur(S.remaining);
    applyTimerState();
  }, 1000);
}
function stopTimer() { if (S.timer) clearInterval(S.timer); S.timer = null; document.body.classList.remove("time-critical"); }

$$(".tab").forEach((t) => t.addEventListener("click", () => {
  S.tab = t.dataset.tab;
  // Odeljak naloga se bira pri OTVARANJU, ne pri svakom crtanju. Da se racunao
  // stalno, ekran bi odskocio sa porudzbina na profil tacno u trenutku kad pice
  // stigne - a igrac tada bas gleda u taj spisak.
  if (S.tab === "account" && !S.accSekcija) S.accSekcija = podrazumevanaSekcija();
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  renderContent();
  primeniPozadinu();
}));

function renderContent() {
  const c = $("#content");
  c.classList.toggle("home-mode", S.tab === "home"); // fiksni raspored bez skrola
  c.classList.toggle("shop-mode", S.tab === "shop");
  if (S.tab === "home") c.innerHTML = renderHome();
  else if (S.tab === "shop") c.innerHTML = renderShop();
  else if (S.tab === "account") c.innerHTML = renderAccount();
  c.classList.remove("swap"); void c.offsetWidth; c.classList.add("swap");
  if (S.tab === "home") {
    requestAnimationFrame(updateHomeArrows); pokreniPromo();
    requestAnimationFrame(obojiIkoneAlata);
    dovuciIkoneAlata();
  } else { clearInterval(promoTajmer); promoTajmer = null; }
  if (S.tab === "shop") { requestAnimationFrame(colorizeShop); setTimeout(colorizeShop, 350); }
  if (S.tab === "account") requestAnimationFrame(obojiUzorkePozadine);
  if (S.tab === "account" && S.accSekcija === "podesavanja") vezeKlizace();
}

// ---- POČETNA (sve u sliderima: igre po kategorijama + internet) ----
const HOME_URL = "https://www.google.com";

// Brendirane internet kartice - svaka u bojama i sa logom svoje aplikacije.
// ZVANICNI LOGOTIPI BRENDOVA
// Obrisi su preuzeti iz zbirke Simple Icons (simpleicons.org), koja drzi
// zvanicne oblike logotipa i objavljuje ih kao CC0. Ranije su ovde stajali moji
// priblizni crtezi - Steam je bio krug sa tackom, Battle.net elipsa. Sad je to
// stvarni oblik svakog znaka.
//
// Znak se crta BELO na ploci u boji brenda. Tako je uvek citljiv: Steam i Epic
// su zvanicno crni, pa bi crn znak na tamnoj kartici nestao.
//
// "boja" je zvanicna boja brenda iz iste zbirke. Kod dva brenda zvanicna boja
// je crna, sto kao akcenat ne radi nista - za njih stoji njihova stvarna
// prepoznatljiva plava, i to je jedino mesto gde sam odstupio:
//   Steam      zvanicno #000000  ->  #66C0F4 (plava iz njihovog programa)
//   TeamSpeak  zvanicno #000000  ->  #2580C3 (plava sa njihovog znaka)
//   Epic Games zvanicno #313131  ->  #A9AFBA (tamno siva se ne vidi kao ivica)
const BRANDS = [
  { name: "Steam", url: "https://store.steampowered.com", boja: "#66C0F4",
    logo: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/></svg>` },

  { name: "Epic Games", url: "https://store.epicgames.com", boja: "#A9AFBA",
    logo: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4.262 4.262 0 00.02.433c.031.3.037.59.316.92.027.033.311.245.311.245.153.075.258.13.43.2l8.335 3.491c.433.199.614.276.928.27h.002c.314.006.495-.071.928-.27l8.335-3.492c.172-.07.277-.124.43-.2 0 0 .284-.211.311-.243.28-.33.285-.621.316-.92a4.261 4.261 0 00.02-.434V1.879c0-1.373-.506-1.88-1.878-1.88zm13.366 3.11h.68c1.138 0 1.688.553 1.688 1.696v1.88h-1.374v-1.8c0-.369-.17-.54-.523-.54h-.235c-.367 0-.537.17-.537.539v5.81c0 .369.17.54.537.54h.262c.353 0 .523-.171.523-.54V8.619h1.373v2.143c0 1.144-.562 1.71-1.7 1.71h-.694c-1.138 0-1.7-.566-1.7-1.71V4.82c0-1.144.562-1.709 1.7-1.709zm-12.186.08h3.114v1.274H6.117v2.603h1.648v1.275H6.117v2.774h1.74v1.275h-3.14zm3.816 0h2.198c1.138 0 1.7.564 1.7 1.708v2.445c0 1.144-.562 1.71-1.7 1.71h-.799v3.338h-1.4zm4.53 0h1.4v9.201h-1.4zm-3.13 1.235v3.392h.575c.354 0 .523-.171.523-.54V4.965c0-.368-.17-.54-.523-.54zm-3.74 10.147a1.708 1.708 0 01.591.108 1.745 1.745 0 01.49.299l-.452.546a1.247 1.247 0 00-.308-.195.91.91 0 00-.363-.068.658.658 0 00-.28.06.703.703 0 00-.224.163.783.783 0 00-.151.243.799.799 0 00-.056.299v.008a.852.852 0 00.056.31.7.7 0 00.157.245.736.736 0 00.238.16.774.774 0 00.303.058.79.79 0 00.445-.116v-.339h-.548v-.565H7.37v1.255a2.019 2.019 0 01-.524.307 1.789 1.789 0 01-.683.123 1.642 1.642 0 01-.602-.107 1.46 1.46 0 01-.478-.3 1.371 1.371 0 01-.318-.455 1.438 1.438 0 01-.115-.58v-.008a1.426 1.426 0 01.113-.57 1.449 1.449 0 01.312-.46 1.418 1.418 0 01.474-.309 1.58 1.58 0 01.598-.111 1.708 1.708 0 01.045 0zm11.963.008a2.006 2.006 0 01.612.094 1.61 1.61 0 01.507.277l-.386.546a1.562 1.562 0 00-.39-.205 1.178 1.178 0 00-.388-.07.347.347 0 00-.208.052.154.154 0 00-.07.127v.008a.158.158 0 00.022.084.198.198 0 00.076.066.831.831 0 00.147.06c.062.02.14.04.236.061a3.389 3.389 0 01.43.122 1.292 1.292 0 01.328.17.678.678 0 01.207.24.739.739 0 01.071.337v.008a.865.865 0 01-.081.382.82.82 0 01-.229.285 1.032 1.032 0 01-.353.18 1.606 1.606 0 01-.46.061 2.16 2.16 0 01-.71-.116 1.718 1.718 0 01-.593-.346l.43-.514c.277.223.578.335.9.335a.457.457 0 00.236-.05.157.157 0 00.082-.142v-.008a.15.15 0 00-.02-.077.204.204 0 00-.073-.066.753.753 0 00-.143-.062 2.45 2.45 0 00-.233-.062 5.036 5.036 0 01-.413-.113 1.26 1.26 0 01-.331-.16.72.72 0 01-.222-.243.73.73 0 01-.082-.36v-.008a.863.863 0 01.074-.359.794.794 0 01.214-.283 1.007 1.007 0 01.34-.185 1.423 1.423 0 01.448-.066 2.006 2.006 0 01.025 0zm-9.358.025h.742l1.183 2.81h-.825l-.203-.499H8.623l-.198.498h-.81zm2.197.02h.814l.663 1.08.663-1.08h.814v2.79h-.766v-1.602l-.711 1.091h-.016l-.707-1.083v1.593h-.754zm3.469 0h2.235v.658h-1.473v.422h1.334v.61h-1.334v.442h1.493v.658h-2.255zm-5.3.897l-.315.793h.624zm-1.145 5.19h8.014l-4.09 1.348z"/></svg>` },

  { name: "Battle.net", url: "https://www.blizzard.com", boja: "#4381C3",
    logo: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M18.94 8.296C15.9 6.892 11.534 6 7.426 6.332c.206-1.36.714-2.308 1.548-2.508 1.148-.275 2.4.48 3.594 1.854.782.102 1.71.28 2.355.429C12.747 2.013 9.828-.282 7.607.565c-1.688.644-2.553 2.97-2.448 6.094-2.2.468-3.915 1.3-5.013 2.495-.056.065-.181.227-.137.305.034.058.146-.008.194-.04 1.274-.89 2.904-1.373 5.027-1.676.303 3.333 1.713 7.56 4.055 10.952-1.28.502-2.356.536-2.946-.087-.812-.856-.784-2.318-.19-4.04a26.764 26.764 0 0 1-.807-2.254c-2.459 3.934-2.986 7.61-1.143 9.11 1.402 1.14 3.847.725 6.502-.926 1.505 1.672 3.083 2.74 4.667 3.094.084.015.287.043.332-.034.034-.06-.08-.124-.131-.149-1.408-.657-2.64-1.828-3.964-3.515 2.735-1.929 5.691-5.263 7.457-8.988 1.076.86 1.64 1.773 1.398 2.595-.336 1.131-1.615 1.84-3.403 2.185a27.697 27.697 0 0 1-1.548 1.826c4.634.16 8.08-1.22 8.458-3.565.286-1.786-1.295-3.696-4.053-5.17.696-2.139.832-4.04.346-5.588-.029-.08-.106-.27-.196-.27-.068 0-.067.13-.063.187.135 1.547-.263 3.2-1.062 5.19zm-8.533 9.869c-1.96-3.145-3.09-6.849-3.082-10.594 3.702-.124 7.474.748 10.714 2.627-1.743 3.269-4.385 6.1-7.633 7.966h.001z"/></svg>` },

  { name: "YouTube", url: "https://www.youtube.com", boja: "#FF0000",
    logo: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>` },

  { name: "Discord", url: "https://discord.com/app", boja: "#5865F2",
    logo: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>` },

  { name: "TeamSpeak", url: "https://www.teamspeak.com", boja: "#2580C3",
    logo: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M12.005.605h-.09l-.028.001h-.064l-.03.001-.07.001-.02.001-.09.003h-.022l-.07.003-.03.001-.063.003L11.4.62l-.09.005-.09.006h-.015l-.01.001-.064.005-.03.002-.07.005-.02.002-.088.008-.02.001-.07.007-.027.003-.065.006-.025.003-.088.01-.09.01-.023.003-.066.008-.008.002-.015.002h-.003l-.073.01-.015.002-.05.007-.04.006-.014.002-.073.01-.024.005-.07.01-.02.004-.088.015-.035.006-.018.004-.035.006-.02.003-.07.013-.02.004-.08.015h-.003l-.004.001-.005.001-.087.018-.007.002H9.57l-.034.008-.043.01-.018.002L9.4.89l-.013.003-.09.02-.09.02-.01.003-.08.02-.011.003-.087.022-.092.024-.088.024-.01.002-.084.024h-.003l-.09.026-.091.027H8.56l-.073.023-.01.003-.005.002h-.003l-.028.01a6.02 6.02 0 0 0-.19.062l-.08.025-.257.091-.075.027a8.04 8.04 0 0 0-.305.12c-.02.007-.041.014-.061.023l-.144.06a12.574 12.574 0 0 0-.53.24l-.07.034-.08.04c-.17.085-.34.174-.506.267-.154.18-.304.362-.45.548l-.06.08-.036.043.005-.003c-.037.048-.072.098-.11.146-.077.103-.156.205-.231.31-.057.08-.112.162-.167.243-.081.118-.163.234-.24.355-.054.083-.105.168-.158.25-.074.12-.15.24-.22.362-.051.085-.1.172-.148.258-.07.126-.141.25-.21.38-.044.086-.09.174-.132.26a16.1 16.1 0 0 0-.187.379c-.045.096-.088.193-.132.29a16.02 16.02 0 0 0-.433 1.063l-.05.128.009-.012c-.127.357-.245.717-.348 1.084l-.107.049a4.673 4.673 0 0 0-.015.006 4.75 4.75 0 0 0-.56.307 4.673 4.673 0 0 0-.035.022 4.693 4.693 0 0 0-.493.37 4.673 4.673 0 0 0-.045.038 4.705 4.705 0 0 0-.427.427 4.673 4.673 0 0 0-.044.05 4.692 4.692 0 0 0-.366.488 4.673 4.673 0 0 0-.025.04 4.663 4.663 0 0 0-.302.553 4.673 4.673 0 0 0-.01.024 4.638 4.638 0 0 0-.227.606 4.673 4.673 0 0 0-.003.013c-.06.208-.108.42-.14.64a4.673 4.673 0 0 0 0 .01 4.7 4.7 0 0 0 0 1.318 4.673 4.673 0 0 0 0 .01c.032.218.08.432.14.64a4.673 4.673 0 0 0 .004.014c.061.208.137.41.226.605a4.673 4.673 0 0 0 .01.024c.09.192.19.377.303.554a4.673 4.673 0 0 0 .024.038c.112.172.235.336.368.49a4.673 4.673 0 0 0 .041.049c.133.15.275.293.426.426a4.673 4.673 0 0 0 .048.04c.155.134.318.256.49.367a4.673 4.673 0 0 0 .04.027c.178.113.364.215.557.304a4.673 4.673 0 0 0 .015.006c.197.09.4.166.61.228a4.673 4.673 0 0 0 .017.005c.207.06.42.107.637.138a4.673 4.673 0 0 0 .012.002 4.698 4.698 0 0 0 1.315 0 4.673 4.673 0 0 0 .012-.002c.218-.031.43-.078.637-.138a4.673 4.673 0 0 0 .017-.005 4.67 4.67 0 0 0 .609-.227 4.673 4.673 0 0 0 .017-.008c.192-.09.378-.19.555-.303a4.673 4.673 0 0 0 .042-.027c.17-.111.335-.234.49-.366a4.673 4.673 0 0 0 .045-.04c.152-.133.295-.277.429-.43a4.673 4.673 0 0 0 .039-.044c.134-.156.257-.32.37-.493a4.673 4.673 0 0 0 .02-.035 4.62 4.62 0 0 0 .306-.557 4.673 4.673 0 0 0 .01-.021c.089-.197.165-.4.227-.61a4.673 4.673 0 0 0 .002-.008c.06-.208.108-.421.14-.64a4.673 4.673 0 0 0 0-.02 4.698 4.698 0 0 0 .04-.881 4.673 4.673 0 0 0 0-.002c0-.05-.005-.098-.01-.147a4.673 4.673 0 0 0-.006-.085 4.176 4.176 0 0 0-.028-.222 4.673 4.673 0 0 0 0-.005 4.606 4.606 0 0 0-.304-1.098 4.673 4.673 0 0 0 0-.001c-.03-.07-.061-.14-.094-.21a4.673 4.673 0 0 0-.002-.003 4.528 4.528 0 0 0-.083-.165 4.673 4.673 0 0 0-.02-.04l-.07-.123a4.673 4.673 0 0 0-.05-.085l-.037-.06a4.673 4.673 0 0 0-.087-.137l-.012-.016A4.673 4.673 0 0 0 7.14 8.635c-.018-.011-.035-.023-.053-.033a4.673 4.673 0 0 0-.096-.055c-.036-.021-.072-.043-.11-.063a4.673 4.673 0 0 0-.044-.022 4.636 4.636 0 0 0-1.368-.464 13.673 13.673 0 0 1 3.39-5.233 10.301 10.301 0 0 1 3.147-.493c5.7 0 10.329 4.629 10.33 10.329v.002c0 2.13-.647 4.11-1.753 5.756l-.013.018C18.5 21.46 14.682 23.57 9.503 23.02l.02.016c5.2 1.138 9.375-.545 11.882-3.46l-.018.026a10.7 10.7 0 0 0 .308-.372c.018-.023.035-.048.054-.071.094-.122.186-.245.275-.37l.1-.146a10.726 10.726 0 0 0 .506-.816l.076-.133c.173-.32.329-.647.469-.981l.062-.158a10.68 10.68 0 0 0 .314-.901c.016-.053.033-.105.047-.157a9.7 9.7 0 0 0 .136-.527l.003-.018c.039-.17.072-.343.103-.516l.025-.16a10.6 10.6 0 0 0 .108-.95c.004-.06.01-.118.012-.177.009-.181.015-.363.015-.545C24.001 5.982 18.626.605 12.005.605zm.232 3.277c1.363 1.373 2.135 3.205 2.41 5.229.104.765-.046 1.61-.77 2.13-.058.333.115.696.267 1.055.388.92.98 1.757 1.408 2.642.384.798-.632 1.388-1.374 1.63a6.24 6.24 0 0 1-.275.084c.048.383.274.67.215 1.003a.98.98 0 0 1-.372.6s.28.878-.38 1.26c-.152.087-.33.104-.364.34-.064.468-.134.926-.504 1.307-.056.057-.115.11-.177.159 4.326-.152 7.97-3.507 8.372-7.93.435-4.794-3.104-9.04-7.9-9.476a8.865 8.865 0 0 0-.556-.034zm-1.973.17a8.68 8.68 0 0 0-2.003.672c.388.134.736.316.97.534 1.09 1.01 1.629 2.003 1.93 3.383.267 1.218.395 1.809-.245 2.253-.865.6.923 3.164 1.272 3.906-.46.592-1.062.579-1.38.743-.176.09-.103.426-.074.685.028.254.26.413.133.61-.114.175-.55.188-.737.31.182.2.585.399.53.658-.04.2-.492.166-.666.622-.093.245-.045.698-.238.927-.448.53-.917.62-1.85.517a15.94 15.94 0 0 1-.908-.127 8.61 8.61 0 0 0 2.263 1.137c.25.082.517.11.78.082.492-.046.834-.226 1.166-.62.22-.26.165-.776.27-1.054.199-.52.713-.478.76-.706.06-.296-.398-.523-.604-.75.214-.138.707-.153.838-.353.145-.223-.12-.404-.152-.693-.032-.294-.115-.676.085-.78.36-.186 1.045-.172 1.569-.844-.397-.844-2.43-3.76-1.447-4.442.728-.506.583-1.177.28-2.563-.344-1.57-.957-2.698-2.195-3.847a2.214 2.214 0 0 0-.347-.26Z"/></svg>` },

  { name: "FACEIT", url: "https://www.faceit.com", boja: "#FF5500",
    logo: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M23.999 2.705a.167.167 0 00-.312-.1 1141.27 1141.27 0 00-6.053 9.375H.218c-.221 0-.301.282-.11.352 7.227 2.73 17.667 6.836 23.5 9.134.15.06.39-.08.39-.18z"/></svg>` },

  { name: "Twitch", url: "https://twitch.tv", boja: "#9146FF",
    logo: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>` },

  { name: "Spotify", url: "https://open.spotify.com", boja: "#1DB954",
    logo: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>` },

  // Google se po njihovim pravilima nikad ne preboji - "G" ostaje u sve cetiri
  // zvanicne boje, na beloj ploci.
  { name: "Google", url: "https://www.google.com", boja: "#4285F4", light: true,
    logo: `<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.5 14.1a5.9 5.9 0 0 1 0-3.8V7.7H3.2a10 10 0 0 0 0 9z"/><path fill="#EA4335" d="M12 6.1c1.5 0 2.9.5 3.9 1.5l2.9-2.9A10 10 0 0 0 3.2 7.7l3.3 2.6A5.9 5.9 0 0 1 12 6.1Z"/></svg>` },
];
// pretraga logotipa po imenu - fallback lep izgled za poznate alate bez cover slike
const BRAND_LOGOS = {};
// Osoblje kuca ime kako mu dodje: "Team Speak", "Battlenet", "Battle.net".
// Razmaci, tacke i crtice se skidaju pri poredjenju, da logo ne promasi.
const kljucBrenda = (ime) => String(ime || "").toLowerCase().replace(/[\s._-]/g, "");
BRANDS.forEach((b) => (BRAND_LOGOS[kljucBrenda(b.name)] = b));

// Ime cesto nosi i nastavak: "Faceit AC", "Discord PTB", "Battle.net Launcher".
// Zato se, ako tacno ime ne pogodi, gleda i pocetak. Duzi kljucevi se probaju
// prvi, da "battlenet" pobedi eventualni kraci kljuc koji je njegov pocetak.
const KLJUCEVI_BRENDOVA = Object.keys(BRAND_LOGOS).sort((a, b) => b.length - a.length);
function nadjiBrend(ime) {
  const k = kljucBrenda(ime);
  if (!k) return null;
  if (BRAND_LOGOS[k]) return BRAND_LOGOS[k];
  const pocetak = KLJUCEVI_BRENDOVA.find((b) => k.startsWith(b));
  return pocetak ? BRAND_LOGOS[pocetak] : null;
}

// stabilna boja iz imena igre - cover-less kartice dobijaju svoj identitet
function hueFromName(name) {
  let h = 0;
  for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
// dominantna boja limenke sa transparentne slike (canvas), da kartica prati piće
// Pragovi se daju spolja: limenke u shopu su jarke, ikone programa znaju da budu
// prigusene (Steam je tamnoplav), pa im treba blazi prag da se boja uopste nadje.
function dominantColor(img, { minSat = 0.22, minLum = 26 } = {}) {
  try {
    const cv = document.createElement("canvas");
    const w = (cv.width = 28), h = (cv.height = 28);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 140) continue; // preskoči providne piksele
      const rr = d[i], gg = d[i + 1], bb = d[i + 2];
      const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (rr + gg + bb) / 3;
      if (sat < minSat || lum < minLum || lum > 238) continue; // preskoči skoro belo/crno/sivo
      r += rr; g += gg; b += bb; n++;
    }
    if (n < 8) return null;
    return `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`;
  } catch { return null; }
}
// Podloga kartice uzima boju SA SAME LIMENKE. Ranije je boja racunata iz imena
// pa je iza kartica bila duga bez veze sa picem - zuto iza Coca-Cole, ljubicasto
// iza vode. Sada je to jedva vidljiv odsjaj u boji proizvoda.
function colorizeShop() {
  document.querySelectorAll(".pice img[data-color]").forEach((img) => {
    const apply = () => {
      const c = dominantColor(img);
      if (!c) return;
      const card = img.closest(".pice");
      if (card) { card.style.setProperty("--cr", c); card.classList.add("colored"); }
    };
    // decode() garantuje da su pikseli spremni pre crtanja na canvas
    const run = () => (img.decode ? img.decode().then(apply).catch(apply) : apply());
    if (img.complete && img.naturalWidth) run();
    else img.addEventListener("load", run, { once: true });
  });
}
// Oznaka kategorije se prikazuje samo kad stvarno nesto kaze. Podrazumevana
// kategorija je "Igre", a to vec pise iznad police - pa je oznaka na svakoj
// plocici bila ponavljanje, i jos je stajala preko korice i sekla logo igre
// (Counter-Strike, Minecraft, League of Legends). Kad osoblje razvrsta igre po
// kategorijama, oznaka se vraca, ali dole gde ne dira sliku.
const PODRAZUMEVANE_KATEGORIJE = ["igre", "igra", "ostalo", ""];
function oznakaKategorije(g) {
  const k = String(g.category || "").trim();
  if (PODRAZUMEVANE_KATEGORIJE.includes(k.toLowerCase())) return "";
  return `<div class="tile-badge">${esc(k)}</div>`;
}

// Dok osoblje ne okaci korice, plocica ne mora da bude prazan obojen blok.
// Igra se pokrece iz .exe fajla, a taj fajl nosi svoju ikonu - ista ona koja
// stoji na precici na radnoj povrsini. Zato se uzima odatle.
// Igre pokrenute preko steam:// nemaju fajl na disku i ostaju na dva slova.
function gameCardHtml(g, i) {
  let cover;
  let cekaIkonu = false;
  if (g.image) {
    cover = `<img src="${esc(S.host)}${esc(g.image)}" alt="" draggable="false" />`;
  } else {
    const izExe = jeProgramNaDisku(g.path) ? IKONE_PROGRAMA.get(kljucPutanje(g.path)) : null;
    if (izExe) {
      cover = `<div class="tile-fallback ikona" style="--h:${hueFromName(g.name)}">
        <img class="tile-ikona" src="${esc(izExe)}" alt="" draggable="false" /></div>`;
    } else {
      cekaIkonu = izExe === undefined;
      cover = `<div class="tile-fallback" style="--h:${hueFromName(g.name)}"><span class="tile-emoji">${mono(g.name)}</span></div>`;
    }
  }
  // "id" MORA da stoji u ovom atributu.
  //
  // Posle pokretanja se serveru šalje { t: "game_start", gameId: g.id }, a id se
  // čita baš odavde. Dok ga nije bilo, slalo se undefined: server ne bi našao
  // igru i tiho bi odustao, pa je tabela pokretanja ostajala prazna zauvek.
  // Zbog toga igraču nisu radile "skoro igrane" igre, vlasniku spisak
  // najigranijih, a u Logovima nije bilo nijednog zapisa o pokretanju.
  return `<div class="tile" style="--i:${i}" data-game='${esc(JSON.stringify({ id: g.id, path: g.path, args: g.args, name: g.name }))}'>
    <div class="tile-media"${cekaIkonu ? ` data-trazi-ikonu="${esc(g.path)}"` : ""}>
      ${cover}
      ${oznakaKategorije(g)}
      <div class="tile-scrim"><div class="tile-name">${esc(g.name)}</div></div>
      <div class="tile-hover"><span class="play-btn">${icon("play", 24)}</span><span class="play-label">Pokreni</span></div>
    </div>
  </div>`;
}
// Redosled izvora znaka, od najboljeg ka najgrubljem:
//   1. slika koju je osoblje okacilo u panelu - izricit izbor, uvek pobedjuje
//   2. zvanicni znak brenda - vektor, ostar svuda, ceo red ujednacen
//   3. prava ikona iz .exe fajla - za svaki program van spiska brendova
//   4. prvo slovo imena - da kartica nikad ne ostane prazna
// U redu alata na ime ostaje malo mesta (na 1366x768 oko 54 px). Imena pisana
// bez razmaka - "TeamSpeak", "Battle.net", "YouTube" - nemaju gde da se prelome
// pa se seku na "TEAM S...". Ovde se ubacuje <wbr>: nevidljivo mesto na kome
// red SME da se prelomi, posle tacke i na granici malo/veliko slovo. Prelom
// nasred reci se i dalje ne desava.
function prelomIme(ime) {
  return esc(ime)
    .replace(/\.(?=[^\s<])/g, ".<wbr>")
    .replace(/([a-zćčđšž])(?=[A-ZĆČĐŠŽ])/g, "$1<wbr>");
}

function toolCardHtml(t) {
  const data = esc(JSON.stringify({ kind: t.kind, target: t.target, args: t.args, name: t.name }));
  const brand = nadjiBrend(t.name);

  if (t.image) {
    return `<button class="site-card cover" data-tool='${data}'>
      <div class="site-cover"><img src="${esc(S.host)}${esc(t.image)}" alt="" draggable="false" /></div>
      <span class="site-traka"></span><span class="site-name">${prelomIme(t.name)}</span>
    </button>`;
  }

  if (brand) {
    // Zvanicni znak brenda: beo, na ploci u boji brenda. Ide ISPRED ikone iz
    // .exe fajla - vektor je ostar na svakoj rezoluciji i ceo red izgleda kao
    // jedna celina, dok su izvucene ikone bitmape od 48 px razlicitog kvaliteta
    // (a poneki program nosi i genericku ikonu instalera).
    // Google je izuzetak: njihov "G" se po pravilima ne preboji, pa stoji u
    // svoje cetiri boje na beloj ploci.
    return `<button class="site-card brend ${brand.light ? "light" : ""}" data-tool='${data}'
      style="--glow:${brand.boja}">
      <span class="site-logo">${brand.logo}</span>
      <span class="site-traka"></span><span class="site-name">${prelomIme(t.name)}</span>
    </button>`;
  }

  // Program koji nije poznat brend: prava ikona iz njegovog .exe fajla. Stize
  // tek posle pitanja glavnom procesu, pa kartica krece od onoga sto vec zna i
  // sama se dopuni kad ikona stigne - inace bi red treperio pri svakom crtanju.
  const izExe = t.kind === "app" ? IKONE_PROGRAMA.get(kljucPutanje(t.target)) : undefined;
  if (izExe) {
    return `<button class="site-card exe" data-tool='${data}'>
      <span class="site-logo"><img class="exe-ikona" src="${esc(izExe)}" alt="" draggable="false" /></span>
      <span class="site-traka"></span><span class="site-name">${prelomIme(t.name)}</span>
    </button>`;
  }
  const cekaIkonu = t.kind === "app" && izExe === undefined;
  const col = t.color || `hsl(${hueFromName(t.name)} 68% 46%)`;
  return `<button class="site-card letter" data-tool='${data}'
    ${cekaIkonu ? `data-trazi-ikonu="${esc(t.target)}"` : ""}
    style="--glow:${col}">
    <span class="site-logo"><span class="tool-letter">${esc((t.name || "?").trim().charAt(0).toUpperCase())}</span></span>
    <span class="site-traka"></span><span class="site-name">${prelomIme(t.name)}</span>
  </button>`;
}

// Ikone se pamte po putanji, da se glavni proces ne pita iznova pri svakom
// crtanju. Vrednost null znaci "pitano, nema ikone" - da se ne pita ponovo.
// Isti spisak sluzi i precicama i igrama: i jedno i drugo je program na disku.
const IKONE_PROGRAMA = new Map();
const kljucPutanje = (p) => String(p || "").trim().replace(/^"|"$/g, "").trim();

// Igra pokrenuta preko steam:// ili epic:// nema fajl na disku, pa nema ni sta
// da se izvuce - takve se ni ne pitaju.
// Program na disku je i putanja bez nastavka: osoblje drzi precice u C:\games
// i cesto upise samo "C:\games\cs2", a na disku stoji "cs2.lnk". Glavni proces
// sam nadje pravi fajl, pa se ovde ne sme unapred odbiti.
// Odbija se samo ono sto sigurno nije fajl - protokol (steam://) i adresa.
const jeProgramNaDisku = (p) => {
  const put = kljucPutanje(p);
  return !!put && !/^[a-z][a-z0-9+.-]*:\/\//i.test(put);
};

async function dovuciIkoneAlata() {
  if (!window.crit?.programIcon) return; // u pregledu kroz obican pregledac ovoga nema
  const trazene = [...document.querySelectorAll("[data-trazi-ikonu]")]
    .map((el) => kljucPutanje(el.dataset.traziIkonu))
    .filter((p) => p && !IKONE_PROGRAMA.has(p));
  if (!trazene.length) return;

  let stiglo = false;
  await Promise.all([...new Set(trazene)].map(async (p) => {
    try {
      const url = await window.crit.programIcon(p);
      IKONE_PROGRAMA.set(p, url || null);
      if (url) stiglo = true;
    } catch { IKONE_PROGRAMA.set(p, null); }
  }));
  // Ponovo se crta samo ako je stvarno stigla neka ikona.
  if (stiglo && S.tab === "home") renderContent();
}

// Sirova boja iz ikone je neupotrebljiva kao akcenat: Steam je skoro crno plav
// pa se ne vidi, zuta fascikla bode oci. Ton se zadrzava, a zasicenost i
// svetlina se svode na isti opseg - tako svih osam kartica ima akcenat iste
// tezine, a svaka i dalje nosi boju svog programa.
function ujednaciBoju(rgb) {
  const [r, g, b] = rgb.split(",").map((n) => Number(n) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const l = 0.56;                                   // uvek ista svetlina
  const s = Math.min(0.82, Math.max(0.42, d / (1 - Math.abs(2 * ((max + min) / 2) - 1) || 1)));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  const i = Math.floor(h * 6) % 6;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i];
  return t.map((v) => Math.round((v + m) * 255)).join(",");
}

// Boja kartice se vadi iz same ikone, pa svaki alat dobije svoju pravu boju -
// i onaj koji nije ni na kakvom spisku.
function obojiIkoneAlata() {
  document.querySelectorAll(".site-card.exe .exe-ikona").forEach((img) => {
    const primeni = () => {
      const c = dominantColor(img, { minSat: 0.12, minLum: 18 });
      const card = img.closest(".site-card");
      if (c && card) {
        const boja = ujednaciBoju(c);
        card.style.setProperty("--glow", `rgb(${boja})`);
      }
    };
    const kreni = () => (img.decode ? img.decode().then(primeni).catch(primeni) : primeni());
    if (img.complete && img.naturalWidth) kreni();
    else img.addEventListener("load", kreni, { once: true });
  });
}
async function launchTool(t) {
  if (t.kind === "app") {
    const r = await window.crit.launchGame({ path: t.target, args: t.args, name: t.name });
    if (!r.ok) toast(r.error || "Ne mogu da pokrenem alat", "error");
    else if (!r.ignored) toast(`Pokrećem ${t.name || "alat"}...`, "success");
  } else {
    window.crit.openBrowser(t.target);
  }
}
function shelfHtml(title, cards, extra = "") {
  return `<section class="shelf">
    <div class="shelf-head">
      <h2 class="shelf-title">${esc(title)}</h2>
      <span class="razmak"></span>
      <div class="shelf-arrows">
        <button class="shelf-arr" data-arr="prev" aria-label="Levo">${icon("chev", 18)}</button>
        <button class="shelf-arr" data-arr="next" aria-label="Desno">${icon("chev", 18)}</button>
      </div>
    </div>
    <div class="shelf-track ${extra}" data-track>${cards}</div>
  </section>`;
}
// PROMO BANERI
// Kad osoblje okaci promo banere, oni preuzimaju vrh pocetne i smenjuju se
// sami. Tekst se ne crta preko njih - sve sto treba da pise, pise na slici.
const PROMO_RAZMAK = 8000;
let promoTajmer = null, promoIndeks = 0;

function pokreniPromo() {
  clearInterval(promoTajmer);
  promoTajmer = null;
  const lista = S.promo || [];
  if (lista.length < 2 || !$("#promoHero")) return;
  promoTajmer = setInterval(() => prikaziPromo(promoIndeks + 1), PROMO_RAZMAK);
}

function prikaziPromo(i) {
  const slajdovi = $$(".promo-slajd");
  if (!slajdovi.length) return;
  promoIndeks = ((i % slajdovi.length) + slajdovi.length) % slajdovi.length;
  slajdovi.forEach((s, n) => s.classList.toggle("vidljiv", n === promoIndeks));
  $$(".promo-tacka").forEach((t, n) => t.classList.toggle("aktivna", n === promoIndeks));
}

// VIP TRAKA NA VRHU POČETNE
//
// Zamišljena je kao napredak iz igara: znak, nivo, traka koja se puni, i nagrada
// na kraju. Sam XP sistem još ne postoji - pravila (šta daje iskustvo, koliko,
// šta se otključava) tek treba da se osmisle.
//
// Zato ovde stoji ZAKLJUČANO stanje sa pečatom "USKORO!". To je namerno, i nije
// isto što i prazna traka: prazna traka je obećanje koje program ne ispunjava, a
// ovako igrač vidi da stvar POSTOJI i da tek dolazi.
//
// Kad XP sistem stigne, server šalje `vip` uz "welcome" i "balance":
//
//   vip: { nivo: 4, naziv: "Srebro", xp: 320, xpDo: 500, otkljucano: false }
//
// i traka se sama popuni - ništa se ovde ne prepravlja. Dok tog polja nema,
// prikaz je zaključan. Tako se izgled i pravila razvijaju odvojeno.
function vipHtml() {
  const v = S.vip;
  // Tri stanja, ne dva:
  //   nema podataka  - server je stariji ili igrac nije prijavljen -> "Uskoro!"
  //   poslednji nivo - traka je puna i NE trazi jos, jer nema sta da trazi
  //   sve ostalo     - napredak unutar tekuceg nivoa
  const ima = !!v && Number.isFinite(v.nivo);
  const naKraju = ima && v.poslednji;
  const merljiv = ima && !naKraju && Number.isFinite(v.xpDo) && v.xpDo > 0;
  const postotak = naKraju ? 100 : merljiv ? Math.max(0, Math.min(100, (v.xp / v.xpDo) * 100)) : 0;
  const nivo = ima ? `Nivo ${v.nivo}${v.naziv ? " - " + esc(v.naziv) : ""}` : "Nivo -";
  const pod = naKraju
    ? "Najviši nivo - dalje se ne ide"
    : merljiv
      ? `${Math.round(v.xp)} / ${Math.round(v.xpDo)} XP do nivoa ${esc(v.sledeci || "")}`
      : "Otključava se igranjem";

  // Zupci dele traku na nivoe - bez njih je to samo linija koja raste, a sa
  // njima se vidi DOKLE se stiglo i koliko je ostalo.
  const zupci = Array.from({ length: 9 }, (_, i) =>
    `<span class="vip-zub" style="left:${((i + 1) * 10).toFixed(0)}%"></span>`).join("");

  // ZNAK KUCE OSTAJE U VRHU POCETNE.
  //
  // Prva verzija VIP trake ga je izbacila - a bas preko klase `brand-logo`
  // primeniBrend menja logo po igraonici. Bez njega bi svaka igraonica gledala
  // tudji znak na svom najvidljivijem mestu.
  return `<div class="vip ${ima ? "" : "zakljucan"}${naKraju ? " vrh" : ""}">
    <img class="vip-kuca brand-logo" src="img/crit-logo.png" alt="${esc(S.settings.cafeName || "")}" draggable="false" />
    <div class="vip-znak" aria-hidden="true">
      <svg viewBox="0 0 44 48" fill="none">
        <path class="vip-stit" d="M22 2l18 7v18c0 10-8 16-18 19C12 43 4 37 4 27V9z"/>
        <path class="vip-zvezda" d="M22 13l3.2 6.9 7.3.9-5.4 5 1.5 7.2L22 29.4l-6.6 3.6 1.5-7.2-5.4-5 7.3-.9z"/>
      </svg>
    </div>
    <div class="vip-telo">
      <div class="vip-vrh">
        <span class="vip-ime">VIP</span>
        <span class="vip-nivo">${nivo}</span>
      </div>
      <div class="vip-traka">
        <i style="width:${postotak.toFixed(1)}%"></i>
        ${zupci}
      </div>
      <div class="vip-pod">${pod}</div>
    </div>
    ${ima ? "" : `<div class="vip-pecat"><span>Uskoro!</span></div>`}
  </div>`;
}

// Osvežava SAMO traku, ne celu stranu.
//
// Iskustvo raste dok naplata teče - na svakih pet sekundi. Da se tada iscrtava
// cela početna, police bi treperile, drag-to-scroll bi se prekidao, a igrač koji
// prevlači korice bi to osetio kao trzanje.
function osveziVip() {
  const stara = $(".vip");
  if (!stara) return;
  const p = document.createElement("div");
  p.innerHTML = vipHtml();
  const nova = p.firstElementChild;
  if (nova) stara.replaceWith(nova);
  primeniBrend(S.brend);
}

// NOV NIVO SE VIDI I ČUJE, NE SAMO UPIŠE.
//
// Bez ovoga bi napredak postojao samo u bazi: igrač bi jednom slučajno primetio
// da mu je traka drugačija, a otključana stvar bi stajala neiskorišćena jer niko
// nije rekao da postoji. Zato preko ekrana ide obaveštenje sa onim ŠTA je dobio.
function proslaviNivo(m) {
  const dobio = (m.otkljucano || []).map((o) => o.naziv).filter(Boolean);
  toast(`Nivo ${m.nivo} - ${m.naziv}${dobio.length ? ": " + dobio.join(", ") : ""}`, "nivo", 7000);
  const el = $(".vip");
  if (el) {
    // Animacija se pokreće ponovo i kad klasa već stoji - inače drugi nivo
    // zaredom ne bi bljesnuo.
    el.classList.remove("slavi");
    void el.offsetWidth;
    el.classList.add("slavi");
    setTimeout(() => el.classList.remove("slavi"), 2600);
  }
}

// VRH POCETNE
// Levo VIP traka (ili okaceni promo baneri ako ih osoblje ima - to je prostor
// koji je vlasnik platio i on ima prednost), desno stanje
// nagradnog tocka kao traka napretka. Klik na tocak otvara pop-up sa vrtnjom -
// ranije je ceo tocak stajao razvucen na strani Nalog i gusio je.
function heroHtml() {
  const lista = S.promo || [];
  const levo = lista.length
    ? `<div class="hero-promo" id="promoHero">
        ${lista.map((p, i) => `<div class="promo-slajd ${i === 0 ? "vidljiv" : ""}" data-promo="${i}"
          style="background-image:url('${esc(S.host)}${esc(p.image)}')"></div>`).join("")}
        ${lista.length > 1 ? `<div class="promo-tacke">${lista.map((_, i) =>
          `<button class="promo-tacka ${i === 0 ? "aktivna" : ""}" data-promo-idi="${i}" aria-label="Baner ${i + 1}"></button>`).join("")}</div>` : ""}
      </div>`
    : vipHtml();
  // Kad je okačen promo baner, on je slika koju je osoblje napravilo i preko nje
  // ne sme ništa - ni šara ni crvena nit uz ivicu. Klasa "promo" ih gasi.
  return `<section class="hero ${lista.length ? "promo" : ""}">${levo}${heroTocakHtml()}</section>`;
}

// IGRE NE IDU U BANER.
//
// Ovde je nekad stajala traka "Nastavi gde si stao" - tri poslednje igre kao
// sitna dugmad u gornjoj traci. Bila je greška iz dva razloga:
//
//   1. Baner je baner. Tu ide promo materijal koji je osoblje napravilo, ili
//      znak igraonice - jedna mirna slika preko celе širine. Tri male pločice
//      sa imenima igara u tom prostoru izgledaju kao da su tu upale slučajno.
//   2. Iste te igre su onda stajale i u traci i na polici odmah ispod nje, pa
//      se polica NAMERNO nije sortirala da se ne ponove. Time je pokvareno ono
//      što je zaista korisno: da poslednje igrana igra bude prva na polici.
//
// Sada je obrnuto i jednostavnije: baner nosi promo ili znak, a POLICA se ređa
// po tome šta je igrač poslednje igrao. Ko je sinoć igrao CS2, njega zatiče
// prvog - na istom mestu i u istom obliku kao i sve ostale igre.

// Widget tocka u baneru: mini tocak, traka napretka i stanje. Ceo je dugme.
function heroTocakHtml() {
  const t = S.tocak;
  if (!t || !t.ukljucen || !(t.nagrade || []).length) return "";
  const naj = Math.max(...t.nagrade.map((n) => Number(n.kredit) || 0));
  let stanje, pct, ispod;
  if (t.moze) {
    stanje = "spreman";
    pct = 100;
    ispod = `<span class="hw-jak">Besplatan spin te čeka</span>`;
  } else if (t.sledeciSpin) {
    stanje = "iskoriscen";
    pct = 100;
    ispod = `Sledeći spin za <b>${odbrojavanjeDana(t.sledeciSpin)}</b>`;
  } else {
    stanje = "zakljucan";
    pct = t.prag > 0 ? Math.min(100, Math.round((t.potroseno / t.prag) * 100)) : 0;
    ispod = `Još <b>${money(Math.max(0, t.prag - t.potroseno))}</b> do besplatnog spina`;
  }
  return `<button class="hero-tocak ${stanje}" id="heroTocak" title="Otvori nagradni točak">
    <span class="hw-tocak">
      <span class="hw-kaz"></span>
      <span class="hw-krug">${tocakSVG(t.nagrade, 84)}</span>
    </span>
    <span class="hw-desno">
      <span class="hw-vrh">
        <span class="hw-naslov">Nagradni točak</span>
        <span class="hw-nagrada">do ${money(naj)}</span>
      </span>
      <span class="hw-traka"><i style="width:${pct}%"></i></span>
      <span class="hw-ispod">${ispod}</span>
    </span>
  </button>`;
}
// REDOSLED IGARA NA POLICI: POSLEDNJE IGRANA JE PRVA.
//
// Igrač sedne i traži ono što je sinoć igrao. Ko je poslednji put pokrenuo CS2,
// zatiče ga prvog - u istoj kartici i istog oblika kao sve ostale, samo na
// prvom mestu. Iza njih ide redosled koji je osoblje postavilo u panelu.
//
// Ranije je ovo radilo SAMO kad traka "Nastavi gde si stao" nije bila
// prikazana, jer bi se iste igre pojavile dvaput. Ta traka je uklonjena (igre
// ne idu u baner), pa sortiranje sad važi uvek - a to je i jedini oblik u kom
// je korisno.
function poredakIgara() {
  if (!S.skoroIgrane.length) return S.games;
  const mesto = new Map(S.skoroIgrane.map((id, i) => [id, i]));
  const skoro = [], ostale = [];
  for (const g of S.games) (mesto.has(g.id) ? skoro : ostale).push(g);
  skoro.sort((a, b) => mesto.get(a.id) - mesto.get(b.id));
  return skoro.concat(ostale);
}

function renderHome() {
  const gamesShelf = S.games.length
    ? `<section class="shelf games-shelf">
        <div class="shelf-head">
          <h2 class="shelf-title">Igre</h2>
          <span class="razmak"></span>
          <div class="shelf-arrows">
            <button class="shelf-arr" data-arr="prev" aria-label="Levo">${icon("chev", 18)}</button>
            <button class="shelf-arr" data-arr="next" aria-label="Desno">${icon("chev", 18)}</button>
          </div>
        </div>
        <div class="shelf-track games" data-track>${poredakIgara().map((g, i) => gameCardHtml(g, i)).join("")}</div>
      </section>`
    : `<div class="empty-view"><div class="ev-in">${icon("gamepad", 56)}
        <div class="ev-t">Još nema igara</div>
        <div class="ev-s">Osoblje dodaje igre u panelu.</div></div></div>`;
  return `<div class="home">
    ${heroHtml()}
    ${gamesShelf}
    <section class="shelf net-shelf">
      <div class="shelf-head"><h2 class="shelf-title">Internet i alati</h2></div>
      <div class="net-row">${(S.tools.length ? S.tools : []).map(toolCardHtml).join("") || '<div class="cart-empty" style="padding:20px">Osoblje dodaje prečice u panelu.</div>'}</div>
    </section>
  </div>`;
}
// strelice igara: sakrij kad nema šta da se pomera, disable na kraju
function updateHomeArrows() {
  const shelf = document.querySelector(".games-shelf");
  if (!shelf) return;
  const track = shelf.querySelector(".shelf-track");
  const arrows = shelf.querySelector(".shelf-arrows");
  if (!track || !arrows) return;
  arrows.classList.toggle("hidden", track.scrollWidth <= track.clientWidth + 4);
  const upd = () => {
    const p = arrows.querySelector('[data-arr="prev"]'), n = arrows.querySelector('[data-arr="next"]');
    if (p) p.disabled = track.scrollLeft <= 2;
    if (n) n.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
  };
  upd();
  track.onscroll = upd;
}
window.addEventListener("resize", () => { if (S.tab === "home") updateHomeArrows(); });

// ---- Shop ----
// Jedan spisak pića i traka kategorija iznad njega - kao jelovnik. Ranije je
// svaka kategorija imala svoj red kartica; sa sedam artikala to je davalo tri
// reda od kojih je svaki bio popunjen do pola, pa je pola ekrana bilo prazno.
// Ovako je sve na jednom mestu, a traka kategorija sluzi za izbor.
function renderShop() {
  const dostupni = S.shop.filter((i) => i.available);
  const kategorije = [...new Set(dostupni.map((i) => i.category).filter(Boolean))];
  const izabrana = kategorije.includes(S.shopFilter) ? S.shopFilter : null;
  const vidljivi = izabrana ? dostupni.filter((i) => i.category === izabrana) : dostupni;

  const cip = (ime, kljuc, n) =>
    `<button class="shop-cip ${(kljuc || null) === izabrana ? "aktivan" : ""}" data-kat="${esc(kljuc || "")}">
      ${esc(ime)}<span>${n}</span>
    </button>`;
  // Traka ima smisla tek kad ima izmedju cega da se bira.
  const traka = kategorije.length > 1
    ? `<div class="shop-filter">${cip("Sve", "", dostupni.length)}${kategorije
        .map((k) => cip(k, k, dostupni.filter((i) => i.category === k).length)).join("")}</div>`
    : "";

  // Traka o porudžbini koja stiže ide IZNAD mreže artikala.
  //
  // Ispod nje je bila van vidnog polja: mreža se skroluje, pa je igrač morao da
  // skroluje do dna da bi saznao stiže li mu piće. A to je jedino zbog čega
  // traka i postoji - odgovor na prvi pogled.
  const telo = dostupni.length
    ? `${traka}${shopPorudzbine()}<div class="shop-grid">${vidljivi.map(shopCardHtml).join("")}</div>`
    : `<div class="empty-view"><div class="ev-in">${icon("cup", 56)}
        <div class="ev-t">Shop je prazan</div>
        <div class="ev-s">Osoblje dodaje pića i grickalice u panelu.</div></div></div>`;

  return `<div class="shop">
    <div class="shop-products">${telo}</div>
    <div class="cart" id="cartBox">${renderCart()}</div>
  </div>`;
}

// Ispod spiska pića stoji šta je igrač poručio i dokle je stiglo. Spisak je i
// na Nalogu, ali igrač poručuje ovde - pa i status treba da vidi ovde, bez
// prebacivanja taba.
// U SHOP-U SAMO JEDNA LINIJA, NE CEO SPISAK.
//
// Ceo spisak porudžbina je stajao i ovde i na nalogu - ista stvar dvaput, sa
// dva različita markupa. Igraču u Shop-u treba samo odgovor na "stiže li",
// a istorija mu treba na nalogu. Zato ovde ostaje jedna linija dok se nešto
// sprema, i ona vodi na nalog.
function shopPorudzbine() {
  const aktivne = aktivnePorudzbine();
  if (!aktivne.length) return "";
  const komada = aktivne.reduce((z, o) => z + o.items.reduce((s, i) => s + i.qty, 0), 0);
  const sprema = aktivne.some((o) => o.status === "preparing");
  return `<button class="shop-traka" data-acc-sekcija="porudzbine">
    <span class="st-tacka"></span>
    <span class="st-t">${sprema ? "Porudžbina se sprema" : "Porudžbina je primljena"} - ${komada} ${oblikKom(komada)}</span>
    <span class="st-o">Radnik donosi do računara</span>
    <span class="st-vise">Pogledaj ${icon("chev", 14)}</span>
  </button>`;
}
const oblikKom = (n) => (n % 10 === 1 && n % 100 !== 11 ? "komad" : "komada");

// Cena: broj nosi, oznaka valute je sitna uz njega. Tako cena izgleda kao na
// jelovniku, a ne kao red teksta iste debljine.
function cenaHtml(n, klasa = "cena") {
  return `<span class="${klasa}"><b>${Math.round(Number(n) || 0).toLocaleString("sr-Latn-RS")}</b><i>${esc(S.settings.currency)}</i></span>`;
}

// Kartica pica: fotografija na mirnoj podlozi, ispod nje ime, cena i jedno
// malo dugme. Ranije je svaka kartica imala punu crvenu traku "Dodaj" - sedam
// crvenih pravougaonika jedan do drugog je vikalo preko celog ekrana. Sada je
// dugme krug sa tankim obodom i boju dobija tek kad je pice u korpi.
function shopCardHtml(i) {
  const nema = i.stock === 0;
  const malo = i.stock != null && i.stock > 0 && i.stock <= 5;
  const uKorpi = S.cart.get(i.id) || 0;
  return `<article class="pice ${nema ? "nema" : ""} ${uKorpi ? "izabrano" : ""}" data-pice="${i.id}">
    <div class="pice-slika">
      ${i.image
        ? `<img src="${esc(S.host)}${esc(i.image)}" alt="${esc(i.name)}" draggable="false" data-color />`
        : `<span class="pice-mono">${mono(i.name)}</span>`}
      ${nema ? '<span class="pice-nema">Nema na stanju</span>' : ""}
      ${malo ? `<span class="pice-malo">još ${i.stock}</span>` : ""}
    </div>
    <div class="pice-dno">
      <div class="pice-ime">${esc(i.name)}</div>
      <div class="pice-red">
        ${cenaHtml(i.price, "pice-cena")}
        ${nema ? "" : uKorpi
          ? `<div class="pice-step">
               <button data-dec="${i.id}" aria-label="Manje">&minus;</button>
               <b>${uKorpi}</b>
               <button data-inc="${i.id}" aria-label="Više">+</button>
             </div>`
          : `<button class="pice-plus" data-add="${i.id}" aria-label="Dodaj ${esc(i.name)}">${icon("plus", 15)}</button>`}
      </div>
    </div>
  </article>`;
}

function renderCart() {
  if (!S.cart.size) {
    // Kad shop nema nijedan artikal, ne salji igraca "na levu stranu" - tamo
    // nema niceg. Dve poruke na istom ekranu ne smeju da se protivrece.
    const imaSta = S.shop.some((i) => i.available);
    return `<div class="cart-head"><h3>Korpa</h3></div>
      <div class="cart-empty">
        <span class="ce-t">${imaSta ? "Korpa je prazna" : "Trenutno nema šta da se poruči"}</span>
        ${imaSta ? '<span class="ce-s">Dodaj piće sa spiska</span>' : ""}
      </div>`;
  }
  let rows = "", total = 0, komada = 0;
  for (const [id, qty] of S.cart) {
    const it = S.shop.find((x) => x.id === id); if (!it) continue;
    total += it.price * qty;
    komada += qty;
    rows += `<div class="cart-row">
      <div class="cr-slika">${it.image ? `<img src="${esc(S.host)}${esc(it.image)}" alt="" />` : mono(it.name)}</div>
      <div class="cr-tekst">
        <div class="cr-ime">${esc(it.name)}</div>
        <div class="cart-qty"><button class="qbtn" data-dec="${id}" aria-label="Manje">&minus;</button><b>${qty}</b><button class="qbtn" data-inc="${id}" aria-label="Više">+</button></div>
      </div>
      ${cenaHtml(it.price * qty, "cr-cena")}
    </div>`;
  }
  const dovoljno = S.balance >= total;
  // Kredit se nudi samo ako ga stvarno ima; inace bi igrac birao opciju koja
  // sigurno pada i tek na kraju dobio poruku da nema para.
  //
  // PREBACIVANJE NA KES SE VRACA SAMO OD SEBE.
  //
  // Ranije se prebacivalo na kes cim kredita nema, ali se NIKAD nije vracalo.
  // Igrac sa 100 dinara doda kolu od 130 (skoci na kes), predomisli se i uzme
  // vodu od 80 - kredit sad ima, a i dalje pise "Kes". Isto i kad ga radnik
  // dopuni: gost placa kesom nesto sto je vec platio. Zato se pamti da li je
  // KES BIO IGRACEV IZBOR; ako nije, cim kredit bude dovoljan vraca se na njega.
  if (!dovoljno) S.nacinPlacanja = "cash";
  else if (S.nacinPlacanja === "cash" && !S.nacinRucno) S.nacinPlacanja = "credit";
  const nacin = S.nacinPlacanja || "credit";
  return `<div class="cart-head">
      <h3>Korpa</h3>
      <span class="cart-broj">${komada} ${oblik(komada, "artikal", "artikla", "artikala")}</span>
    </div>
    <div class="cart-list">${rows}</div>
    <div class="cart-foot">
      <div class="placanje">
        <button class="nacin ${nacin === "credit" ? "aktivan" : ""} ${dovoljno ? "" : "nemoguc"}" data-nacin="credit" ${dovoljno ? "" : "disabled"}>
          ${icon("wallet", 17)}
          <span class="n-ime">Kredit</span>
          <span class="n-opis">${dovoljno ? `ostaje ${money(S.balance - total)}` : "nemaš dovoljno"}</span>
        </button>
        <button class="nacin ${nacin === "cash" ? "aktivan" : ""}" data-nacin="cash">
          ${icon("cash", 17)}
          <span class="n-ime">Keš</span>
          <span class="n-opis">plaćaš radniku</span>
        </button>
      </div>
      <div class="cart-total"><span>Ukupno</span>${cenaHtml(total, "ct-cena")}</div>
      <button class="btn btn-primary btn-block" id="orderBtn">Poruči</button>
      <div class="cart-note">${nacin === "cash"
        ? "Radnik donosi piće i naplaćuje na licu mesta."
        : "Iznos se skida sa kredita, piće stiže do računara."}</div>
    </div>`;
}

// ---- Nalog ----
const STATUS_PORUDZBINE = {
  pending: ["Primljeno", "ceka"],
  preparing: ["Sprema se", "sprema"],
  delivered: ["Doneto", "gotovo"],
  cancelled: ["Otkazano", "otkazano"],
};

// Poruka o statusu traje par sekundi i promakne dok je igrac u igri, pa spisak
// mora negde i da stoji. Zavrsene se prikazuju samo dok su sveze.
// PORUDŽBINE - JEDNO MESTO.
//
// Ranije je isti spisak stajao i u Shop-u i na nalogu, sa dva različita
// markupa i dva seta CSS klasa. Igrač je istu stvar viđao dvaput, a svaka
// izmena je morala da se odradi na dva mesta.
//
// Sada spisak živi samo ovde. Shop pokazuje jednu liniju dok se porudžbina
// sprema, jer je to jedino što igraču treba u tom trenutku.
function sekcijaPorudzbine() {
  const sve = S.porudzbine || [];
  const aktivne = aktivnePorudzbine();
  const ranije = sve.filter((o) => o.status !== "pending" && o.status !== "preparing");

  if (!sve.length) {
    return `<div class="acc-sek">
      <div class="acc-sek-h"><h3>Porudžbine</h3><p>Ovde stoji sve što si poručio danas.</p></div>
      <div class="acc-prazno">${icon("cup", 26)}
        <div class="ap-t">Još ništa nisi poručio</div>
        <div class="ap-o">Otvori Shop, dodaj u korpu i piće stiže do računara.</div>
      </div>
    </div>`;
  }

  const red = (o) => {
    const [naziv, klasa] = STATUS_PORUDZBINE[o.status] || [o.status, ""];
    const uToku = o.status === "pending" || o.status === "preparing";
    return `<div class="por-red ${klasa} ${uToku ? "u-toku" : ""}">
      <div class="por-levo">
        <div class="por-stavke">${o.items.map((i) => `<span class="por-st"><b>${i.qty}&times;</b> ${esc(i.name)}</span>`).join("")}</div>
        <div class="por-meta">
          <span>${clockHM(o.createdAt)}</span>
          <span class="por-tacka"></span>
          <span>${o.payment === "cash" ? "plaćeno kešom" : "sa kredita"}</span>
        </div>
      </div>
      <div class="por-desno">
        ${cenaHtml(o.total, "por-cena")}
        <span class="por-status ${klasa}">${naziv}</span>
      </div>
    </div>`;
  };

  return `<div class="acc-sek">
    <div class="acc-sek-h"><h3>Porudžbine</h3>
      <p>${aktivne.length ? "Radnik donosi do računara." : "Sve što si poručio danas."}</p></div>
    <div class="por-lista">
      ${aktivne.map(red).join("")}
      ${ranije.length && aktivne.length ? '<div class="por-razdeo">Ranije</div>' : ""}
      ${ranije.map(red).join("")}
    </div>
  </div>`;
}

const clockHM = (ts) => new Date(ts).toLocaleTimeString("sr-Latn-RS", { hour: "2-digit", minute: "2-digit" });

// Tacka na tabu Nalog dok porudzbina nije doneta - igrac vidi da nesto stiže
// i kad je na drugom tabu ili u igri.
function osveziZnackuNaloga() {
  const tab = $$(".tab").find((t) => t.dataset.tab === "account");
  if (!tab) return;
  const cekaju = (S.porudzbine || []).filter((o) => o.status === "pending" || o.status === "preparing").length;
  // Znacka je pravi element: aktivan tab vec koristi ::after za crvenu liniju,
  // pa bi ista kroz ::after progutala natpis na tabu.
  let z = tab.querySelector(".tab-znacka");
  if (!cekaju) { if (z) z.remove(); return; }
  if (!z) { z = document.createElement("span"); z.className = "tab-znacka"; tab.appendChild(z); }
  z.textContent = String(cekaju);
}

function renderAccount() {
  const uname = S.player?.username || "";
  const dname = S.player?.displayName || uname;
  const initial = (dname || "?").charAt(0).toUpperCase();
  const rate = S.settings.ratePerHour || 0;
  return `<div class="account">
    <div class="acc-hero">
      <div class="acc-avatar">${esc(initial)}</div>
      <div class="acc-id">
        <div class="acc-name">${esc(dname)}</div>
        <div class="acc-user">@${esc(uname)}</div>
      </div>
      <div class="acc-stats">
        <div class="acc-stat"><div class="as-l">Kredit</div><div class="as-v pos">${money(S.balance)}</div></div>
        <div class="acc-stat"><div class="as-l">Preostalo vreme</div><div class="as-v" id="accTime">${dur(S.remaining)}</div></div>
        <div class="acc-stat"><div class="as-l">Cena po satu</div><div class="as-v">${money(rate)}</div></div>
      </div>
    </div>
    <div class="acc-telo">
      <nav class="acc-meni">${ACC_SEKCIJE.map(stavkaMenija).join("")}</nav>
      <div class="acc-sadrzaj">${sadrzajSekcije()}</div>
    </div>
  </div>`;
}

// NALOG JE MENI, NE SPISAK PANELA.
//
// Ranije su porudžbine, pozadina i lozinka stajale jedna ispod druge na istom
// ekranu. Sve se videlo odjednom, ništa nije imalo prednost, a strana je
// izgledala pretrpano - i rasla je sa svakom novom stvari.
//
// Sada je levo meni, desno jedan odeljak. Igrač bira šta gleda, svaki odeljak
// ima mesta koliko mu treba, a dodavanje novog ne kvari raspored.
const ACC_SEKCIJE = [
  // Profil je prvi: nalog pocinje od toga KO si, pa tek onda od toga sta radis.
  { kljuc: "profil", naziv: "Profil", ikona: "user" },
  { kljuc: "porudzbine", naziv: "Porudžbine", ikona: "cup" },
  { kljuc: "nagrade", naziv: "Nagrade", ikona: "gift" },
  { kljuc: "podesavanja", naziv: "Miš i zvuk", ikona: "mis" },
  { kljuc: "pozadina", naziv: "Pozadina", ikona: "image" },
  { kljuc: "lozinka", naziv: "Lozinka", ikona: "key" },
];
function stavkaMenija(s) {
  const aktivna = (S.accSekcija || "profil") === s.kljuc;
  // Broj aktivnih porudžbina stoji uz stavku: igrač koji čeka piće ne mora da
  // ulazi u odeljak da bi video da li je stiglo.
  const cek = s.kljuc === "porudzbine" ? aktivnePorudzbine().length : 0;
  return `<button class="acc-mi ${aktivna ? "aktivna" : ""}" data-acc-sekcija="${s.kljuc}">
    ${icon(s.ikona, 17)}<span>${s.naziv}</span>
    ${cek ? `<i class="acc-mi-broj">${cek}</i>` : ""}
  </button>`;
}
const aktivnePorudzbine = () =>
  (S.porudzbine || []).filter((o) => o.status === "pending" || o.status === "preparing");

// SA ČIM SE NALOG OTVARA KAD IGRAČ NIJE NIŠTA IZABRAO.
//
// Profil je prvi u meniju - nalog počinje od toga ko si. Ali igrač koji je
// upravo poručio piće otvara Nalog iz jednog razloga: da vidi da li stiže.
// Njemu profil u tom trenutku ne znači ništa.
//
// Zato: dok ima porudžbine u toku, otvara se na njima; inače na profilu. Kad
// jednom klikne, važi njegov izbor - ovo je samo početno stanje.
function podrazumevanaSekcija() {
  return aktivnePorudzbine().length ? "porudzbine" : "profil";
}

function sadrzajSekcije() {
  switch (S.accSekcija || "profil") {
    case "profil": return sekcijaProfil();
    case "porudzbine": return sekcijaPorudzbine();
    case "nagrade": return sekcijaNagrade();
    case "podesavanja": return sekcijaPodesavanja();
    case "pozadina": return panelMojaPozadina();
    case "lozinka": return sekcijaLozinka();
    default: return sekcijaProfil();
  }
}

// PROFIL: KO SI, DOKLE SI STIGAO, ŠTA SI OSTAVIO ZA SOBOM
//
// Nalog je do sada bio spisak radnji - poruči, promeni lozinku, izaberi
// pozadinu. Nigde nije pisalo KO je igrač ni šta je odigrao, pa nalog nije bio
// njegov nego samo šalter.
//
// Ovde stoji sve što je njegovo: znak, ime u boji koju je izabrao, nivo i
// traka, brojke koje je sam napravio, i spisak onoga što ga tek čeka. Poslednje
// je namerno: nagrada koja se ne vidi unapred nije nagrada nego iznenađenje, a
// iznenađenje ne motiviše da se dođe ponovo.
function sekcijaProfil() {
  const p = S.profil;
  if (!p) {
    return `<div class="acc-prazno">${icon("user", 34)}<div>Profil se učitava...</div></div>`;
  }
  const naKraju = !!p.poslednji;
  const postotak = naKraju ? 100
    : p.zaSledeci > 0 ? Math.max(0, Math.min(100, (p.uNivou / p.zaSledeci) * 100)) : 0;

  const brojke = [
    ["Sati igre", p.sati >= 10 ? Math.round(p.sati) : p.sati.toFixed(1)],
    ["Poseta", p.poseta],
    ["Poručeno", p.porudzbina],
    ["Omiljena igra", p.omiljenaIgra || "-"],
  ].map(([l, v]) => `<div class="pf-brojka"><div class="pf-bl">${l}</div><div class="pf-bv">${esc(String(v))}</div></div>`).join("");

  const boje = Object.entries(p.boje || {}).map(([k, o]) => `
    <button class="pf-boja ${p.izgled.boja === k ? "aktivna" : ""}" data-pf-boja="${k}"
      style="--pf-c:${o.heks}" title="${esc(o.naziv)}" aria-label="${esc(o.naziv)}"></button>`).join("");
  const okviri = Object.entries(p.okviri || {}).map(([k, o]) => `
    <button class="pf-okvir ${p.izgled.okvir === k ? "aktivna" : ""}" data-pf-okvir="${k}">${esc(o.naziv)}</button>`).join("");

  const sme = (sta) => (p.otkljucano || []).find((o) => o.kljuc === sta)?.otkljucano;
  const zakljucaj = (sta) => {
    const o = (p.otkljucano || []).find((x) => x.kljuc === sta);
    return o && !o.otkljucano ? `<span class="pf-brava">${icon("key", 13)} nivo ${o.nivo}</span>` : "";
  };

  const nagrade = (p.otkljucano || []).map((o) => `
    <div class="pf-nagrada ${o.otkljucano ? "ima" : ""}">
      <span class="pf-n-nivo">${o.nivo}</span>
      <span class="pf-n-tekst"><b>${esc(o.naziv)}</b>${esc(o.opis)}</span>
      <span class="pf-n-stanje">${o.otkljucano ? icon("check", 15) : icon("key", 14)}</span>
    </div>`).join("");

  return `<div class="pf">
    <div class="pf-glava">
      <div class="pf-znak okvir-${esc(p.izgled.okvir)}">
        <span>${esc((p.ime || "?").charAt(0).toUpperCase())}</span>
      </div>
      <div class="pf-ko">
        <div class="pf-ime" style="color:${esc((p.boje[p.izgled.boja] || {}).heks || "#eef1f8")}">${esc(p.ime)}</div>
        <div class="pf-titula">${esc(p.naziv)} &middot; nivo ${p.nivo}</div>
      </div>
      <div class="pf-xp">
        <div class="pf-xp-broj">${Math.round(p.xp).toLocaleString("sr-Latn-RS")} <span>XP</span></div>
        <div class="pf-xp-traka"><i style="width:${postotak.toFixed(1)}%"></i></div>
        <div class="pf-xp-pod">${naKraju ? "Najviši nivo" : `još ${Math.round(p.doSledeceg).toLocaleString("sr-Latn-RS")} XP do nivoa ${esc(p.sledeciNaziv || "")}`}</div>
      </div>
    </div>

    <div class="pf-brojke">${brojke}</div>

    <div class="pf-odeljak">
      <div class="pf-naslov">Boja imena ${zakljucaj("boja")}</div>
      <div class="pf-boje ${sme("boja") ? "" : "zakljucano"}">${boje}</div>
    </div>

    <div class="pf-odeljak">
      <div class="pf-naslov">Okvir oko znaka ${zakljucaj("okvir")}</div>
      <div class="pf-okviri ${sme("okvir") ? "" : "zakljucano"}">${okviri}</div>
    </div>

    <div class="pf-odeljak">
      <div class="pf-naslov">Šta te čeka</div>
      <div class="pf-nagrade">${nagrade}</div>
    </div>
  </div>`;
}

// NAGRADE.
//
// Ranije je točak postojao samo kao widget u baneru na početnoj. Ko ga ne
// primeti tamo, nije ni znao da postoji, niti koliko mu fali do spina. Ovde
// stoji cela slika: da li može, koliko fali, i šta se može dobiti.
function sekcijaNagrade() {
  const t = S.tocak;
  if (!t || !t.ukljucen || !(t.nagrade || []).length) {
    return `<div class="acc-sek">
      <div class="acc-sek-h"><h3>Nagrade</h3><p>Nagradni točak trenutno nije aktivan.</p></div>
      <div class="acc-prazno">${icon("gift", 26)}
        <div class="ap-t">Točak je ugašen</div>
        <div class="ap-o">Kad ga vlasnik uključi, ovde ćeš videti koliko ti fali do besplatnog spina.</div>
      </div>
    </div>`;
  }

  const pct = t.prag > 0 ? Math.min(100, Math.round((t.potroseno / t.prag) * 100)) : 100;
  const fali = Math.max(0, t.prag - t.potroseno);
  let stanje;
  if (t.moze) {
    stanje = `<div class="nag-spreman">
      <div class="ns-t">Imaš besplatan spin</div>
      <button class="btn btn-primary btn-lg" id="nagZavrti">Zavrti točak</button>
    </div>`;
  } else if (t.sledeciSpin) {
    stanje = `<div class="nag-ceka">
      <div class="ns-t">Zavrteo si ove nedelje</div>
      <div class="ns-o">Sledeći spin za <b>${odbrojavanjeDana(t.sledeciSpin)}</b>.</div>
    </div>`;
  } else {
    stanje = `<div class="nag-napredak">
      <div class="ns-t">Fali ti još ${money(fali)} potrošnje ove nedelje</div>
      <div class="nag-traka"><i style="width:${pct}%"></i></div>
      <div class="ns-o">Sakupljeno ${money(t.potroseno)} od ${money(t.prag)}. Troši se i na vreme i na piće.</div>
    </div>`;
  }

  return `<div class="acc-sek">
    <div class="acc-sek-h"><h3>Nagrade</h3>
      <p>Jednom nedeljno besplatan spin, za sve koji su te nedelje trošili.</p></div>
    ${stanje}
    <div class="nag-spisak-h">Šta se može dobiti</div>
    <div class="nag-spisak">
      ${t.nagrade.map((n) => `<div class="nag-stavka ${n.kredit > 0 ? "" : "prazna"}">
        ${n.kredit > 0 ? icon("gift", 15) : icon("x", 15)}<span>${esc(n.naziv)}</span>
      </div>`).join("")}
    </div>
  </div>`;
}

// MIŠ I ZVUK.
//
// Windows podešavanja su u kiosku zaključana i s razlogom, pa je igraču jedini
// izlaz bio da zove radnika. Ovde stoji ono što je za igru bitno, a bezbedno je
// menjati: sve je po korisniku, sve se vraća istim dugmetom, i sve se samo
// vraća na zatečeno kad se odjavi.
//
// Rezolucije i osvežavanja ekrana namerno NEMA: Windows ume da prihvati režim
// koji monitor ne prikaže, ekran ostane crn, a igrač u kiosku nema čime da
// vrati staro.
function sekcijaPodesavanja() {
  const p = S.winPodesavanja;
  if (!p) {
    return `<div class="acc-sek"><div class="acc-sek-h"><h3>Miš i zvuk</h3>
      <p>Učitavam podešavanja računara...</p></div></div>`;
  }
  const mis = p.mis || { brzina: 10, ubrzanje: false };
  const imaZvuk = p.zvuk && p.zvuk.jacina != null;

  const klizac = (id, min, max, vred, opis) => `
    <div class="pod-klizac">
      <input type="range" id="${id}" min="${min}" max="${max}" value="${vred}" />
      <span class="pk-vred" id="${id}Vred">${opis}</span>
    </div>`;

  return `<div class="acc-sek">
    <div class="acc-sek-h"><h3>Miš i zvuk</h3>
      <p>Važi dok si prijavljen. Kad se odjaviš, računar se vraća na zatečeno.</p></div>

    <div class="pod-grupa">
      <div class="pod-nas">${icon("mis", 15)} Miš</div>
      <div class="pod-red">
        <div class="pod-levo"><b>Brzina pokazivača</b><span>Koliko se pokazivač pomeri za isti potez rukom.</span></div>
        ${klizac("podBrzina", 1, 20, mis.brzina, String(mis.brzina))}
      </div>
      <div class="pod-red">
        <div class="pod-levo"><b>Ubrzanje pokazivača</b>
          <span>Dok je uključeno, brži potez pomeri pokazivač dalje - pa se nišan u igri ne može naučiti. Za pucačine se drži isključeno.</span></div>
        <button class="prekidac ${mis.ubrzanje ? "" : "ugasen"}" id="podUbrzanje" role="switch" aria-checked="${mis.ubrzanje}">
          <span class="pr-kugla"></span></button>
      </div>
    </div>

    ${imaZvuk ? `<div class="pod-grupa">
      <div class="pod-nas">${icon("zvuk", 15)} Zvuk</div>
      <div class="pod-red">
        <div class="pod-levo"><b>Jačina zvuka</b><span>Zvuk celog računara, ne samo launchera.</span></div>
        ${klizac("podZvuk", 0, 100, p.zvuk.jacina, p.zvuk.jacina + "%")}
      </div>
    </div>` : ""}

    <div class="pod-grupa">
      <div class="pod-nas">${icon("gamepad", 15)} Launcher</div>
      <div class="pod-red">
        <div class="pod-levo"><b>Zvuci u launcheru</b><span>Klik, obaveštenja i nagradni točak.</span></div>
        <button class="prekidac ${S.sfxUkljucen ? "" : "ugasen"}" id="podSfx" role="switch" aria-checked="${!!S.sfxUkljucen}">
          <span class="pr-kugla"></span></button>
      </div>
      <div class="pod-red">
        <div class="pod-levo"><b>Animacije</b><span>Isključi ako računar štuca.</span></div>
        <button class="prekidac ${S.animacije ? "" : "ugasen"}" id="podAnim" role="switch" aria-checked="${!!S.animacije}">
          <span class="pr-kugla"></span></button>
      </div>
    </div>

    <div class="pod-dno">
      <button class="btn btn-ghost" id="podVrati">Vrati na fabričko</button>
      <span class="pod-poruka" id="podPoruka"></span>
    </div>
  </div>`;
}

// Klizači: broj se menja odmah pod prstom, a Windows se dira tek kad igrač
// pusti. Slanje na svaki pomeraj bi otvaralo PowerShell desetinama puta.
function vezeKlizace() {
  const brz = $("#podBrzina");
  if (brz) {
    brz.oninput = () => { const v = $("#podBrzinaVred"); if (v) v.textContent = brz.value; };
    brz.onchange = () => posaljiPodesavanja({
      mis: { brzina: Number(brz.value), ubrzanje: !!S.winPodesavanja?.mis?.ubrzanje } });
  }
  const zv = $("#podZvuk");
  if (zv) {
    zv.oninput = () => { const v = $("#podZvukVred"); if (v) v.textContent = zv.value + "%"; };
    zv.onchange = () => posaljiPodesavanja({ zvuk: { jacina: Number(zv.value) } });
  }
}

// Slanje ka Windows-u ide preko mosta u main procesu. Klizači se pomeraju
// često, pa se ne šalje svaki pomeraj: čeka se da igrač pusti miš.
let _podSlanje = null;
async function posaljiPodesavanja(sta) {
  clearTimeout(_podSlanje);
  const poruka = $("#podPoruka");
  try {
    const r = await window.crit.podesavanjaPrimeni(sta);
    if (!r?.ok) {
      if (poruka) poruka.textContent = r?.error || "Nije uspelo.";
      return;
    }
    S.winPodesavanja = r.stanje || S.winPodesavanja;
    if (S.tab === "account" && S.accSekcija === "podesavanja") renderContent();
  } catch (e) {
    if (poruka) poruka.textContent = "Nije uspelo: " + (e?.message || e);
  }
}

// Zvuci i animacije launchera ostaju uz nalog na ovom računaru - igrač koji ih
// ugasi ne mora to da radi svaki put kad sedne.
function zapamtiIzborLaunchera() {
  try {
    localStorage.setItem("crit_launcher_izbor",
      JSON.stringify({ sfx: !!S.sfxUkljucen, anim: !!S.animacije }));
  } catch {}
}
function ucitajIzborLaunchera() {
  try {
    const o = JSON.parse(localStorage.getItem("crit_launcher_izbor") || "null");
    if (o && typeof o === "object") {
      S.sfxUkljucen = o.sfx !== false;
      S.animacije = o.anim !== false;
    }
  } catch {}
  primeniIzborLaunchera();
}
function primeniIzborLaunchera() {
  document.body.classList.toggle("bez-animacija", !S.animacije);
}

// Miš i zvuk se čitaju sa računara tek kad igraču zatrebaju - čitanje ide preko
// PowerShell-a i traje oko sekundu, pa ne sme na svaku prijavu.
async function ucitajWinPodesavanja() {
  if (S.winPodesavanja || !window.crit?.podesavanjaCitaj) return;
  try {
    S.winPodesavanja = await window.crit.podesavanjaCitaj();
    if (S.tab === "account" && S.accSekcija === "podesavanja") renderContent();
  } catch {}
}

function sekcijaLozinka() {
  return `<div class="acc-sek">
    <div class="acc-sek-h"><h3>Promena lozinke</h3>
      <p>Lozinkom se prijavljuješ za bilo koji računar u igraonici.</p></div>
    <div class="acc-form">
      <div class="field"><label>Trenutna lozinka</label><input id="accOld" type="password" autocomplete="off" /></div>
      <div class="field"><label>Nova lozinka</label><input id="accNew" type="password" autocomplete="off" /></div>
      <button class="btn btn-primary" id="accSave">Sačuvaj lozinku</button>
    </div>
  </div>`;
}

// NAGRADNI TOČAK
// Jednom nedeljno može da zavrti svako ko je za tih 7 dana potrošio bar prag.
// Ishod bira server; ovde se samo prikazuje stanje i animira rezultat.
// Boje polja. Namerno se NE ponavlja ista boja na 120 stepeni - takav raspored
// je na malom tocku davao oblik znaka za radijaciju.
const TOCAK_BOJE = ["#d81f24", "#1c2029", "#ffb527", "#151821", "#8e1b20", "#262b36"];
// POP-UP sa točkom. Otvara se klikom na widget u baneru.
function otvoriTocak() {
  const t = S.tocak;
  if (!t || !t.ukljucen || !(t.nagrade || []).length) return;
  const telo = $("#tocakTelo");
  if (!telo) return;
  telo.innerHTML = `
    <div class="tocak-obl">
      <div class="tocak-kazaljka"></div>
      <div class="tocak-krug" id="tocakKrug">${tocakSVG(t.nagrade, 200)}</div>
      <div class="tocak-sjaj" id="tocakSjaj"></div>
    </div>
    <div class="tocak-akcija" id="tocakAkcija">${tocakAkcijaHtml()}</div>`;
  $("#tocakOverlay").classList.add("active");
  sfx.click();
}
function zatvoriTocak() {
  if (S.tocakVrti) return; // ne prekidaj vrtnju usred animacije
  $("#tocakOverlay").classList.remove("active");
}
function tocakAkcijaHtml() {
  const t = S.tocak;
  if (t.moze) {
    return `<button class="tocak-spin" id="tocakSpin">Zavrti</button>
      <div class="tocak-nota">Imaš jedan besplatan spin ove nedelje.</div>`;
  }
  if (t.sledeciSpin) {
    return `<div class="tocak-nota">Zavrteo si ove nedelje.<br>Sledeći spin za <b>${odbrojavanjeDana(t.sledeciSpin)}</b>.</div>`;
  }
  const preostalo = Math.max(0, t.prag - t.potroseno);
  const pct = t.prag > 0 ? Math.min(100, Math.round((t.potroseno / t.prag) * 100)) : 0;
  return `<div class="tocak-napredak">
      <div class="tn-bar"><div class="tn-fill" style="width:${pct}%"></div></div>
      <div class="tn-tekst">Potrošeno <b>${money(t.potroseno)}</b> od ${money(t.prag)} ove nedelje</div>
    </div>
    <div class="tocak-nota">Potroši još <b>${money(preostalo)}</b> pa se točak otključava.</div>`;
}

// SVG točak sa poljima. Polje 0 počinje na vrhu i ide u smeru kazaljke.
// "velicina" je gustina detalja: mali točak u baneru nema natpise, ali zadržava
// glavčinu i paoke - bez njih je na 84px izgledao kao znak opasnosti, a ne kao
// točak.
function tocakSVG(nagrade, velicina = 200) {
  const n = nagrade.length, seg = 360 / n, cx = 100, cy = 100, r = 96;
  const mali = velicina < 130;
  const tacka = (ug, rr) => [cx + rr * Math.sin(ug * Math.PI / 180), cy - rr * Math.cos(ug * Math.PI / 180)];
  let s = `<svg viewBox="0 0 200 200" class="tocak-svg">`;
  for (let i = 0; i < n; i++) {
    const a0 = i * seg, a1 = (i + 1) * seg, am = a0 + seg / 2;
    const [x0, y0] = tacka(a0, r), [x1, y1] = tacka(a1, r);
    const boja = TOCAK_BOJE[i % TOCAK_BOJE.length];
    s += `<path d="M${cx} ${cy} L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${boja}" stroke="#05060a" stroke-width="${mali ? 1.6 : 1}"/>`;
    if (mali) continue; // na 84px natpisi bi bili mrlje
    // Natpis stoji USPRAVNO. Radijalno okrenut tekst se na donjoj polovini cita
    // ukoso i deluje aljkavo; ovako je svaki iznos citljiv bez naginjanja glave.
    const [lx, ly] = tacka(am, r * 0.66);
    s += `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" fill="#fff" font-family="'Segoe UI',Arial,sans-serif" font-size="11" font-weight="700"
      text-anchor="middle" dominant-baseline="central">${esc(nagrade[i].naziv)}</text>`;
  }
  // Obruc i glavcina. Na malom tocku glavcina je TAMNA sa tankim prstenom:
  // puna crvena sredina je sa tri crvena isecka na 120 stepeni davala oblik
  // znaka za radijaciju umesto tocka.
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="${mali ? 5 : 3}"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${mali ? 24 : 17}" fill="#0b0c11" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>`;
  s += `</svg>`;
  return s;
}

// "3 dana", "5č" - koliko do sledećeg spina.
function odbrojavanjeDana(ts) {
  const ms = ts - Date.now();
  if (ms <= 0) return "sada";
  const dana = Math.floor(ms / 86400000);
  if (dana >= 1) return dana + (dana === 1 ? " dan" : dana < 5 ? " dana" : " dana");
  const sati = Math.ceil(ms / 3600000);
  return sati + (sati === 1 ? " sat" : sati < 5 ? " sata" : " sati");
}

// ZAGLAVLJENA VRTNJA MORA DA SE SAMA OTPUSTI.
//
// Klik odmah upali "vrtnja traje", a ishod se ČEKA SA SERVERA. Dok vrtnja traje,
// prikazano stanje kredita se NAMERNO ne dira: server nagradu doda odmah, a
// točak se vrti pet sekundi, pa bi se brojka promenila pre nego što igrač sazna
// šta je dobio.
//
// Ako odgovor nikad ne stigne - veza pukne baš u tih pet sekundi, server se
// restartuje, ruter se resetuje - vrtnja ostaje "u toku" ZAUVEK. Od tog trenutka
// se svako novo stanje odbacuje: HUD stoji zamrznut dok naplata teče dalje.
// Igrač gleda "1000 din, ostalo 8:20" dok mu vreme stvarno curi, i računar se
// zaključa bez ijednog upozorenja. Dopuna na kasi se takođe ne vidi, pa radnik
// dopunjuje drugi put.
//
// Zato dve mreže: rok u kom odgovor mora da stigne, i otpuštanje čim veza padne
// (preko te veze odgovor ionako više ne može da dođe).
const TOCAK_ROK = 12000; // koliko se čeka odgovor servera
let tocakRokTajmer = null;

function otpustiTocak(razlog) {
  if (!S.tocakVrti) return;
  S.tocakVrti = false;
  clearTimeout(tocakRokTajmer); tocakRokTajmer = null;
  clearInterval(_tikTajmer); _tikTajmer = null;
  document.querySelector(".tocak-obl")?.classList.remove("vrti");
  // Stanje zadržano tokom vrtnje se sada upisuje - inače bi ostalo zarobljeno.
  if (S.tocakStanje) {
    S.balance = S.tocakStanje.balance;
    S.remaining = S.tocakStanje.remaining;
    S.tocakStanje = null;
  }
  updateHud();
  const btn = $("#tocakSpin");
  if (btn) { btn.disabled = false; btn.textContent = "Zavrti"; }
  if (razlog) toast(razlog, "error");
  if (S.tab === "account") renderContent();
}

function zavrtiTocakKlik() {
  if (S.tocakVrti || !S.tocak?.moze) return;
  S.tocakVrti = true;
  const btn = $("#tocakSpin");
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  clearTimeout(tocakRokTajmer);
  tocakRokTajmer = setTimeout(
    () => otpustiTocak("Server se nije javio. Spin nije potrošen - probaj ponovo."),
    TOCAK_ROK);
  window.crit.toServer({ t: "tocak_spin" });
}

const SPIN_TRAJANJE = 5200;
let _tocakUgao = 0, _tikTajmer = null;

function animirajTocak(index, nagrada, sledeciSpin) {
  const krug = $("#tocakKrug");
  const n = S.tocak?.nagrade?.length || 1;
  if (!krug) { zavrsiSpin(nagrada, sledeciSpin); return; }
  const seg = 360 / n;
  // Da polje 'index' stane pod kazaljku (vrh): centar polja je (index+0.5)*seg,
  // pa se tocak okrene tako da taj centar dodje na 0. Puni krugovi su radi
  // efekta, a mala nasumicnost unutar polja da ne staje uvek na isto mesto.
  const jitter = (Math.random() - 0.5) * seg * 0.55;
  const cilj = 360 * 8 + (360 - ((index + 0.5) * seg)) - jitter;
  const obl = document.querySelector(".tocak-obl");
  obl?.classList.add("vrti");

  // ZALET PA PUŠTANJE.
  //
  // Ranije je točak kretao pun gas iz mesta i stajao naglo - izgleda kao da je
  // brojka bila unapred izabrana, jer i jeste. Pravi točak se prvo malo povuče
  // unazad, pa poleti. Taj kratak potez unazad je jedino što gledaocu daje
  // osećaj da je zamah stvaran.
  krug.style.transition = "transform 380ms cubic-bezier(.34,.02,.42,1)";
  krug.style.transform = `rotate(${_tocakUgao - 14}deg)`;

  _tocakUgao += cilj;
  // Kucanje kazaljke i osluškivanje kraja kreću TEK sa pravom vrtnjom. Da su
  // postavljeni odmah, zalet bi im bio prvi "transitionend" i vrtnja bi se
  // završila pre nego što je i počela.
  setTimeout(() => {
    // Duga kriva koja se gasi u nulu: brzo na početku, pa sve sporije, sa
    // dugim repom na kraju gde se polje "smiruje" pod kazaljkom.
    krug.style.transition = `transform ${SPIN_TRAJANJE}ms cubic-bezier(.08,.62,.02,1)`;
    krug.style.transform = `rotate(${_tocakUgao}deg)`;

    // Kucanje kazaljke: gusto na početku, sve ređe kako točak usporava. Ritam
    // prati istu krivu kao i rotacija, pa zvuk i slika idu zajedno.
    const pocetak = performance.now();
    const ukupnoPolja = (cilj / 360) * n;
    let odsvirano = 0;
    clearInterval(_tikTajmer);
    _tikTajmer = setInterval(() => {
      const p = Math.min(1, (performance.now() - pocetak) / SPIN_TRAJANJE);
      const preslo = ukupnoPolja * (1 - Math.pow(1 - p, 3));
      if (preslo - odsvirano >= 1) {
        odsvirano = Math.floor(preslo);
        sfx.tik();
        // Kazaljka odskoči na svaki zubac - inače stoji ukočena dok se ispod
        // nje sve vrti, i ceo pokret izgleda kao slika koja se rotira.
        const kaz = document.querySelector(".tocak-kazaljka");
        if (kaz) { kaz.classList.remove("kuc"); void kaz.offsetWidth; kaz.classList.add("kuc"); }
      }
      if (p >= 1) { clearInterval(_tikTajmer); _tikTajmer = null; }
    }, 28);

    const kraj = () => { krug.removeEventListener("transitionend", kraj); zavrsiSpin(nagrada, sledeciSpin); };
    krug.addEventListener("transitionend", kraj);
    // sigurnosni put ako transitionend ne stigne (npr. prozor u pozadini)
    setTimeout(() => { if (S.tocakVrti) zavrsiSpin(nagrada, sledeciSpin); }, SPIN_TRAJANJE + 600);
  }, 380);
}

function zavrsiSpin(nagrada, sledeciSpin) {
  if (!S.tocakVrti) return;
  S.tocakVrti = false;
  clearTimeout(tocakRokTajmer); tocakRokTajmer = null;
  clearInterval(_tikTajmer); _tikTajmer = null;
  const obl = document.querySelector(".tocak-obl");
  obl?.classList.remove("vrti");
  // Osveži lokalno stanje: iskorišćen spin, novi datum, potrošnja ostaje.
  if (S.tocak) { S.tocak.moze = false; S.tocak.sledeciSpin = sledeciSpin || (Date.now() + 7 * 86400000); }
  const dobio = nagrada && nagrada.kredit > 0;
  if (dobio) obl?.classList.add("dobitak");
  const akcija = $("#tocakAkcija");
  if (akcija) {
    akcija.innerHTML = `<div class="tocak-dobitak ${dobio ? "win" : ""}">
        ${dobio ? `${icon("gift", 18)} Osvojio si <b>${money(nagrada.kredit)}</b>` : "Ovaj put bez nagrade."}
      </div>
      <div class="tocak-nota">Sledeći spin za <b>${odbrojavanjeDana(S.tocak?.sledeciSpin || Date.now())}</b>.</div>
      <button class="btn btn-ghost tocak-zatvori" id="tocakGotovo">Zatvori</button>`;
  }
  // Stanje zadržano tokom vrtnje se upisuje BAŠ SADA, da igrač vidi kako kredit
  // raste u istom trenutku kad sazna šta je dobio. To je jedina veza između
  // nagrade i naloga koju igrač ima.
  if (S.tocakStanje) {
    S.balance = S.tocakStanje.balance;
    S.remaining = S.tocakStanje.remaining;
    S.tocakStanje = null;
    updateHud();
  }
  if (dobio) {
    sfx.success();
    const r = obl?.getBoundingClientRect();
    if (r) burstCoins(r.left + r.width / 2, r.top + r.height / 2);
    // Iznos odleti od točka ka kreditu u HUD-u: bez toga igrač ne poveže
    // osvojeno sa stanjem na nalogu.
    letiNaKredit(nagrada.kredit);
  }
  // Widget u baneru mora da pokaže novo stanje čim se pop-up zatvori.
  if (S.tab === "home") renderContent();
}

// MOJA POZADINA
// Igrac bira svoju saru na svom nalogu. Vazi dok je prijavljen; kad se odjavi,
// racunar se vraca na ono sto je vlasnik podesio. Izbor se pamti uz nalog, pa
// ga igrac zatekne i kad sledeci put sedne za drugi racunar.
function panelMojaPozadina() {
  const t = S.teksture;
  if (!t?.spisak) return ""; // stariji server ovo ne salje
  const moja = S.mojaTekstura;
  const izabranaSara = moja?.kljuc || "kuca";
  const jacina = moja?.jacina || S.tekstura?.jacina || "srednje";
  const kretanje = moja?.kretanje || "mirno";
  const vid = t.prozirnosti?.[jacina] ?? 0.75;

  const kucna = t.spisak[S.tekstura?.kljuc || "nema"];
  const uzorak = (kljuc, o) => `
    <button class="poz-uzorak ${kljuc === izabranaSara ? "izabran" : ""}" data-moja-sara="${esc(kljuc)}" title="${esc(o.opis || "")}">
      <span class="pu-slika" data-sara="${esc(kljuc)}"></span>
      <span class="pu-ime">${esc(o.naziv)}</span>
    </button>`;

  return `<div class="acc-sek">
    <div class="acc-sek-h"><h3>Pozadina</h3>
      <p>Važi samo za tvoj nalog. Kad se odjaviš, računar se vraća na izgled igraonice.</p></div>
    <div class="poz-uzorci">
      ${uzorak("kuca", { naziv: "Kao u igraonici", opis: kucna ? `Trenutno: ${kucna.naziv}` : "Ono što je osoblje podesilo" })}
      ${Object.entries(t.spisak).filter(([k]) => k !== "nema").map(([k, o]) => uzorak(k, o)).join("")}
      ${uzorak("nema", { naziv: "Bez šare", opis: "Čista tamna pozadina" })}
    </div>
    <div class="poz-podesavanja">
      <div>
        <span class="pp-l">Jačina</span>
        <div class="pp-dugmad">${Object.entries(t.jacine || {}).map(([k, n]) =>
          `<button class="btn btn-sm ${k === jacina ? "btn-primary" : "btn-ghost"}" data-moja-jacina="${esc(k)}">${esc(n)}</button>`).join("")}</div>
      </div>
      <div>
        <span class="pp-l">Kretanje</span>
        <div class="pp-dugmad">${Object.entries(t.kretanja || {}).map(([k, o]) =>
          `<button class="btn btn-sm ${k === kretanje ? "btn-primary" : "btn-ghost"}" data-moja-kretanje="${esc(k)}" title="${esc(o.opis)}">${esc(o.naziv)}</button>`).join("")}</div>
      </div>
    </div>
  </div>`;
}

// Uzorci se crtaju posle ubacivanja u stranu: sara sadrzi navodnike, pa ne sme
// kroz style="..." atribut - tamo bi se string prekinuo na prvom navodniku.
function obojiUzorkePozadine() {
  const t = S.teksture;
  if (!t?.spisak) return;
  const moja = S.mojaTekstura;
  const jacina = moja?.jacina || S.tekstura?.jacina || "srednje";
  const vid = t.prozirnosti?.[jacina] ?? 0.75;
  document.querySelectorAll(".pu-slika[data-sara]").forEach((el) => {
    const k = el.dataset.sara;
    const o = k === "kuca" ? t.spisak[S.tekstura?.kljuc || "nema"] : t.spisak[k];
    if (!o?.sara) { el.style.backgroundImage = "none"; return; }
    el.style.backgroundImage = o.sara;
    // Kvadratic je izlog sare, ne pregled jacine. Pri slaboj jacini se na
    // tamnoj plocici nije video nikakav uzorak, pa se biralo naslepo.
    el.style.opacity = String(Math.max(vid, 0.9));
  });
}

// Salje izbor serveru. Menja se samo jedno polje, ostala ostaju kakva su bila.
function posaljiMojuPozadinu(izmena) {
  const moja = S.mojaTekstura;
  const sad = {
    kljuc: moja?.kljuc || "kuca",
    jacina: moja?.jacina || S.tekstura?.jacina || "srednje",
    kretanje: moja?.kretanje || "mirno",
  };
  window.crit.toServer({ t: "moja_tekstura", ...sad, ...izmena });
}

// ---- Delegacija klikova ----
// Jedan slušalac na #content umesto kačenja po elementu: sadržaj se često
// prerenderuje, pa bi se listeneri gomilali (npr. korpa bi dodavala po 2-3
// komada na jedan klik).
const MAX_QTY = 20; // server ograničava na 20 po artiklu - poštuj isto ovde

$("#content").addEventListener("click", (e) => {
  // ako je upravo bilo prevlačenje slajdera, ne tretiraj kao klik
  if (_dragged) { _dragged = false; return; }

  // Izgled profila: boja imena i okvir oko znaka.
  //
  // Zakljucano se ni ne salje - dugme je sivo i ne reaguje. Server svejedno
  // proverava isto (vidi sacuvajProfilIgraca): launcher stoji na racunaru
  // igraca, pa nije mesto na kom se odlucuje sta sme.
  const pfB = e.target.closest("[data-pf-boja]");
  const pfO = e.target.closest("[data-pf-okvir]");
  if (pfB || pfO) {
    const grupa = (pfB || pfO).parentElement;
    if (grupa && grupa.classList.contains("zakljucano")) { sfx.error(); return; }
    window.crit.toServer(pfB
      ? { t: "moj_profil", boja: pfB.dataset.pfBoja }
      : { t: "moj_profil", okvir: pfO.dataset.pfOkvir });
    sfx.click();
    return;
  }

  // Meni na nalogu. Isti atribut nosi i traka u Shop-u, pa ona vodi pravo na
  // odeljak sa porudžbinama - bez drugog spiska.
  const sek = e.target.closest("[data-acc-sekcija]");
  if (sek) {
    S.accSekcija = sek.dataset.accSekcija;
    if (S.accSekcija === "podesavanja") ucitajWinPodesavanja();
    if (S.tab !== "account") {
      S.tab = "account";
      $$(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === "account"));
      primeniPozadinu();
    }
    renderContent();
    sfx.click();
    return;
  }

  // Nagradni točak sa naloga otvara isti pop-up kao i widget na početnoj.
  if (e.target.closest("#nagZavrti")) { otvoriTocak(); return; }

  // ---- Miš i zvuk ----
  if (e.target.closest("#podUbrzanje")) {
    const m = S.winPodesavanja?.mis;
    if (m) posaljiPodesavanja({ mis: { brzina: m.brzina, ubrzanje: !m.ubrzanje } });
    return;
  }
  if (e.target.closest("#podSfx")) {
    S.sfxUkljucen = !S.sfxUkljucen;
    zapamtiIzborLaunchera();
    if (S.sfxUkljucen) sfx.click();
    renderContent();
    return;
  }
  if (e.target.closest("#podAnim")) {
    S.animacije = !S.animacije;
    zapamtiIzborLaunchera();
    primeniIzborLaunchera();
    renderContent();
    return;
  }
  if (e.target.closest("#podVrati")) {
    // Fabričko je ono što Windows podrazumeva: brzina 10, ubrzanje isključeno.
    S.sfxUkljucen = true; S.animacije = true;
    zapamtiIzborLaunchera(); primeniIzborLaunchera();
    posaljiPodesavanja({ mis: { brzina: 10, ubrzanje: false }, zvuk: { jacina: 50 } });
    return;
  }

  // Moja pozadina: izbor se odmah salje serveru, on vrati novu saru i ekran se
  // promeni pred igracem - bez dugmeta "sacuvaj".
  const sara = e.target.closest("[data-moja-sara]");
  if (sara) return posaljiMojuPozadinu({ kljuc: sara.dataset.mojaSara });
  const jac = e.target.closest("[data-moja-jacina]");
  if (jac) return posaljiMojuPozadinu({ jacina: jac.dataset.mojaJacina });
  const kre = e.target.closest("[data-moja-kretanje]");
  if (kre) return posaljiMojuPozadinu({ kretanje: kre.dataset.mojaKretanje });

  const arrEl = e.target.closest("[data-arr]");
  if (arrEl) {
    const track = arrEl.closest(".shelf")?.querySelector("[data-track]");
    if (track) track.scrollBy({ left: (arrEl.dataset.arr === "next" ? 1 : -1) * track.clientWidth * 0.85, behavior: "smooth" });
    return;
  }

  const gameEl = e.target.closest("[data-game]");
  if (gameEl) return launchFromTile(gameEl);

  const toolEl = e.target.closest("[data-tool]");
  if (toolEl) return void launchTool(JSON.parse(toolEl.dataset.tool));

  // Traka kategorija u shopu: prazna vrednost znači "sve".
  const katEl = e.target.closest("[data-kat]");
  if (katEl) {
    S.shopFilter = katEl.dataset.kat || null;
    renderContent();
    return;
  }

  const addEl = e.target.closest("[data-add]");
  if (addEl) return cartChange(Number(addEl.dataset.add), +1);

  const incEl = e.target.closest("[data-inc]");
  if (incEl) return cartChange(Number(incEl.dataset.inc), +1);

  const decEl = e.target.closest("[data-dec]");
  if (decEl) return cartChange(Number(decEl.dataset.dec), -1);

  // Klik na tacku prebacuje baner i pomera odbrojavanje od nule.
  const tacka = e.target.closest("[data-promo-idi]");
  if (tacka) { prikaziPromo(Number(tacka.dataset.promoIdi)); pokreniPromo(); return; }

  const nacinEl = e.target.closest("[data-nacin]");
  if (nacinEl && !nacinEl.disabled) {
    S.nacinPlacanja = nacinEl.dataset.nacin;
    S.nacinRucno = true; // igrac je sam izabrao - ne vracaj mu izbor (vidi renderCart)
    refreshCart();
    return;
  }

  if (e.target.closest("#orderBtn")) return sendOrder();
  if (e.target.closest("#accSave")) return saveAccountPassword();
  if (e.target.closest("#heroTocak")) return otvoriTocak();
});

// Pop-up nagradnog točka stoji IZVAN #content (kao i ostali overlay-i), pa ga
// delegacija odozgo ne vidi. Dok su dugmad točka bila u toj delegaciji, pop-up
// se otvarao ali se NIJE mogao ni zavrteti ni zatvoriti - jedini izlaz je bio
// gašenje launchera. Zato točak ima svoj slušalac, na svom overlay-u.
$("#tocakOverlay").addEventListener("click", (e) => {
  if (e.target.closest("#tocakSpin")) return zavrtiTocakKlik();
  if (e.target.closest("#tocakX") || e.target.closest("#tocakGotovo")) return zatvoriTocak();
  if (e.target === e.currentTarget) return zatvoriTocak(); // klik na tamnu podlogu
});
// Escape zatvara pop-up. Igrač koji ne nađe X mora nekako da izađe.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if ($("#tocakOverlay").classList.contains("active")) zatvoriTocak();
});

async function launchFromTile(el) {
  if (el.classList.contains("launching")) return;
  const g = JSON.parse(el.dataset.game);
  const label = el.querySelector(".play-label");
  const origLabel = label ? label.textContent : "";
  const done = () => { el.classList.remove("launching"); if (label) label.textContent = origLabel; };
  el.classList.add("launching");
  if (label) label.textContent = "Pokrećem...";
  setTimeout(done, 3000);
  const r = await window.crit.launchGame(g);
  if (!r.ok) { done(); toast(r.error || "Nije moguće pokrenuti igru", "error"); }
  else if (!r.ignored) {
    toast(`Pokrećem ${g.name || "igru"}...`, "success");
    // Javi serveru tek kad je igra stvarno krenula, da neuspeli pokušaji ne
    // ulaze u statistiku ni u redosled police.
    window.crit.toServer({ t: "game_start", gameId: g.id });
    S.skoroIgrane = [g.id, ...S.skoroIgrane.filter((x) => x !== g.id)].slice(0, 8);
  }
}

function cartChange(id, delta) {
  novPoId(); // promenjena korpa = druga porudzbina, pa i nov broj pokusaja
  const cur = S.cart.get(id) || 0;
  const next = cur + delta;
  if (next <= 0) S.cart.delete(id);
  else if (next > MAX_QTY) {
    S.cart.set(id, MAX_QTY);
    toast(`Najviše ${MAX_QTY} komada po artiklu`, "error");
  } else S.cart.set(id, next);
  refreshCart();
  osveziPice(id);
}

function saveAccountPassword() {
  window.crit.toServer({ t: "change_password", oldPassword: $("#accOld").value, newPassword: $("#accNew").value });
  $("#accOld").value = ""; $("#accNew").value = "";
}

function refreshCart() { const box = $("#cartBox"); if (box) box.innerHTML = renderCart(); }

// Kartica pica mora da prati korpu (brojka i plus/minus), ali se ne sme
// preiscrtati cela mreza - igracu bi odskocila lista pod prstom.
function osveziPice(id) {
  const stara = $(`[data-pice="${id}"]`);
  const it = S.shop.find((x) => x.id === id);
  if (!stara || !it) return;
  const pom = document.createElement("div");
  pom.innerHTML = shopCardHtml(it);
  stara.replaceWith(pom.firstElementChild);
}

// ---- Slanje porudžbine (zaključano dok server ne odgovori) ----
let orderPending = false;
function setOrderBusy(b) {
  const btn = $("#orderBtn");
  if (btn) { btn.disabled = b; btn.textContent = b ? "Šaljem..." : "Poruči"; }
}
function clearOrderPending() { orderPending = false; clearTimeout(sendOrder._t); setOrderBusy(false); }

// BROJ POKUŠAJA - isti dok se korpa ne promeni.
//
// Dugme se otključava posle osam sekundi bez odgovora, da igrač ne ostane
// zarobljen kad server zaćuti. U tom procepu drugi klik bi prošao kao NOVA
// porudžbina i naplatio dvaput. Zato uz nju ide broj koji se ne menja pri
// ponavljanju: server po njemu prepozna da je to isti pokušaj i vrati stari
// odgovor umesto da napravi drugi račun.
//
// Nov broj se pravi tek kad porudžbina prođe ili se korpa promeni - onda je to
// stvarno druga porudžbina i treba da se naplati.
let poId = null;
const novPoId = () => { poId = null; };
function sendOrder() {
  if (orderPending) return;
  const items = [...S.cart].map(([id, qty]) => ({ id, qty }));
  if (!items.length) return;
  if (!poId) poId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  orderPending = true;
  setOrderBusy(true);
  window.crit.toServer({ t: "order", items, payment: S.nacinPlacanja === "cash" ? "cash" : "credit", poId });
  // ako server ne odgovori, ne ostavljaj dugme zauvek zaključano
  clearTimeout(sendOrder._t);
  sendOrder._t = setTimeout(clearOrderPending, 8000);
}

// DRAG-TO-SCROLL (slajderi na Početnoj)
let _drag = null, _dragged = false;
$("#content").addEventListener("pointerdown", (e) => {
  const track = e.target.closest(".shelf-track");
  if (!track || e.target.closest("[data-arr]")) return;
  _dragged = false;
  _drag = { track, x: e.clientX, left: track.scrollLeft, moved: 0 };
});
window.addEventListener("pointermove", (e) => {
  if (!_drag) return;
  const dx = e.clientX - _drag.x;
  _drag.moved = Math.max(_drag.moved, Math.abs(dx));
  if (_drag.moved > 6) _drag.track.classList.add("grabbing");
  _drag.track.scrollLeft = _drag.left - dx;
});
window.addEventListener("pointerup", () => {
  if (!_drag) return;
  if (_drag.moved > 8) _dragged = true; // suzbij klik posle prevlačenja
  _drag.track.classList.remove("grabbing");
  _drag = null;
});

// (Sajt-alati otvaraju sistemski pregledač preko shell.openExternal - vidi main.js openBrowser.)

// Locked
// Polje za PIN ne stoji igraču pred nosom - dok ga osoblje ne pozove, na
// ekranu nema šta da se pogađa. Poziva se hotkey-om ili klikom na napomenu,
// da otključavanje radi i ako neki drugi program preotme Ctrl+Alt+U.
function otkrijPinOsoblja() {
  $("#lockPinBox").classList.remove("hidden");
  $("#lockStaff").classList.add("hidden");
  $("#lockPin").focus();
}
function sakrijPinOsoblja() {
  $("#lockPinBox").classList.add("hidden");
  $("#lockStaff").classList.remove("hidden");
  $("#lockErr").textContent = "";
}
$("#lockStaff").addEventListener("click", otkrijPinOsoblja);

$("#lockUnlock").addEventListener("click", () => {
  const pin = $("#lockPin").value.trim(); if (!pin) return;
  window.crit.toServer({ t: "unlock_pin", pin });
});
$("#lockPin").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#lockUnlock").click(); });

// Message overlay
$("#msgOk").addEventListener("click", () => $("#msgOverlay").classList.remove("active"));

// PIN OVERLAY (admin exit)
function openPin(title, isExit, svrha = "izlaz") {
  S.pendingExit = !!isExit;
  S.pinSvrha = svrha;
  $("#pinTitle").textContent = title; $("#pinInput").value = ""; $("#pinErr").textContent = "";
  $("#pinOverlay").classList.add("active"); $("#pinInput").focus();
}
// Jedno mesto za odustajanje, da se Escape i dugme "Odustani" ne razilaze.
function odustaniOdPina() {
  S.pendingExit = false;
  S.pinSvrha = null;
  $("#pinInput").value = ""; // PIN ne ostaje u polju za sledećeg
  $("#pinOverlay").classList.remove("active");
}
$("#pinCancel").addEventListener("click", odustaniOdPina);
$("#pinOk").addEventListener("click", async () => {
  const pin = $("#pinInput").value.trim(); if (!pin) return;
  // Ulaz u podešavanja se uvek proverava lokalno: tu se ide baš kad servera
  // nema, pa provera preko servera ne bi mogla ni da se izvrši.
  // Za ostalo se pita server (PIN se menja centralno, u panelu), a kad veze
  // nema pada se na servisni PIN - inače bi pri padu servera osoblje ostalo
  // zaključano na svih trinaest mašina bez načina da izađe.
  if (S.pinSvrha === "setup" || !S.wsOk) {
    const r = await window.crit.proveriServisniPin(pin);
    if (r && r.ok) return pinPrihvacen();
    $("#pinErr").textContent = "Pogrešan servisni PIN.";
    return;
  }
  window.crit.toServer({ t: "verify_pin", pin });
});

// Jedno mesto za "PIN je prihvaćen", bez obzira ko ga je proverio.
async function pinPrihvacen() {
  const svrha = S.pinSvrha;
  S.pinSvrha = null;
  $("#pinOverlay").classList.remove("active");
  if (svrha === "setup") {
    const r = await window.crit.resetConfig($("#pinInput").value.trim());
    if (!r || !r.ok) { toast((r && r.error) || "Nije uspelo", "error"); return; }
    $("#connHelp").classList.add("hidden");
    connFailTicks = 0;
    return;
  }
  if (S.pendingExit) { S.pendingExit = false; window.crit.adminExit(); }
}
$("#pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#pinOk").click(); });

// ZVUČNI FEEDBACK (delegacija)
let _lastHover = null;
document.addEventListener("pointerover", (e) => {
  const el = e.target.closest(".tile, .tab, .pice, .site-card, .hero-play");
  if (el && el !== _lastHover) { _lastHover = el; sfx.hover(); }
  else if (!el) _lastHover = null;
});
document.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".btn, .tab, .tile, .site-card, .hero-play, .pice-plus, .pice-step button, .qbtn, .shelf-arr")) sfx.click();
});

// IDLE ATTRACT - reset na svaku aktivnost
["pointermove", "pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, resetIdle, { passive: true }));

// blokiraj kontekst meni i osvezavanje
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  if (e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "R"))) e.preventDefault();
  if (e.key === "F11") e.preventDefault();
  if (e.key === "Escape") {
    if ($("#msgOverlay").classList.contains("active")) $("#msgOverlay").classList.remove("active");
    else if ($("#confirmOverlay").classList.contains("active")) $("#confirmOverlay").classList.remove("active");
    // Escape mora da ostavi ISTO stanje kao dugme "Odustani". Ranije je čistio
    // samo `pendingExit`, a `pinSvrha` je ostajala od prethodnog otvaranja - pa
    // je posle odustajanja od "Promeni adresu servera" u stanju visilo "setup".
    // Danas se to ne može iskoristiti, jer svako otvaranje PIN-a svrhu upisuje
    // iznova. Ali svrha koja preživi odustajanje je napunjen pištolj: prva
    // sledeća upotreba PIN-a koja je ne postavi izričito obrisala bi launcheru
    // adresu servera umesto da izađe iz kioska.
    else if ($("#pinOverlay").classList.contains("active")) { odustaniOdPina(); }
  }
});
