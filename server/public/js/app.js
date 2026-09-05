// Crit panel
const state = {
  token: localStorage.getItem("crit_token") || null,
  admin: null,
  view: "dashboard",
  computers: [],
  orders: [],
  players: [],
  shop: [],
  logs: [],
  // Pocetna vrednost dok podesavanja ne stignu sa servera. Namerno bez imena
  // igraonice: druga igraonica bi na trenutak videla tudje ime na svom panelu.
  settings: { cafeName: "Igraonica", currency: "RSD", ratePerHour: 120 },
  ws: null,
  wsOk: false,
  selection: new Set(),
  filter: "all",
  posCart: new Map(),
  posFilter: null,   // izabrana kategorija na Kasi; null znači "sve"
  shopFilter: null,  // izabrana kategorija na strani Shop; null znači "sve"
  posPayment: "cash",
  posPlayerId: null,
  ordersTab: "active",
  logFilter: "sve",
  installStatus: {},
  nadogradnja: null,
  shift: null,
  reportPeriod: "today",
  plPage: 1, plSearch: "", playersPage: null,
  lgPage: 1, lgSearch: "", logsPage: null,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// inicijali kad artikal/igra nema sliku
const monogram = (name) => esc(String(name || "?").trim().slice(0, 2).toUpperCase());
// Uloge idu odozdo nagore: radnik < vlasnik < serviser. Visa uvek sme sve sto
// sme niza, pa se svuda pita "da li je BAR vlasnik", ne "da li je tacno vlasnik".
const RANG = { staff: 1, owner: 2, serviser: 3 };
const rang = (u) => RANG[u] || 0;
const isOwner = () => rang(state.admin?.role) >= RANG.owner;
const isServiser = () => rang(state.admin?.role) >= RANG.serviser;
// Nad tudjim nalogom se sme samo ako je NIZI od mog - isto pravilo kao na serveru.
const smemNad = (uloga) => rang(state.admin?.role) > rang(uloga);
const ULOGA_NAZIV = { serviser: "Serviser", owner: "Vlasnik", staff: "Radnik" };

// Api
async function api(path, method = "GET", body) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers: { "Content-Type": "application/json", ...(state.token ? { Authorization: "Bearer " + state.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Server ugašen, kabl ispao, telefon izgubio WiFi. Bez ovoga je pregledač
    // bacao svoje "Failed to fetch" i radnik je na ekranu dobijao englesku
    // poruku koja mu ne kaže ni šta se desilo ni šta da radi.
    state.vezaPukla = true;
    setConn(false, true);
    const e = new Error("Nema veze sa serverom. Proveri da li je glavni računar upaljen i da li server radi.");
    e.veza = true;
    throw e;
  }
  state.vezaPukla = false;
  const data = await res.json().catch(() => ({}));
  // Sama odjava se radi SAMO kad je postojeca prijava istekla usred rada.
  // Na ekranu za prijavu 401 znaci pogresna lozinka - ranije je i to zvalo
  // doLogout(), a doLogout zove /logout, koji bez tokena opet vraca 401 i opet
  // zove doLogout. Jedna pogresna lozinka je tako pokretala petlju od nekoliko
  // hiljada zahteva u sekundi, koja se nije zaustavljala do osvezavanja strane,
  // i uz to je gutala pravu poruku o gresci.
  if (res.status === 401 && state.token && path !== "/login" && path !== "/logout") {
    doLogout();
    throw new Error("Sesija je istekla");
  }
  if (!res.ok) throw new Error(data.error || "Došlo je do greške");
  return data;
}

// Format
const cur = () => state.settings.currency || "RSD";
const ratePerHour = () => Number(state.settings.ratePerHour) || 0;

// Srpski broji na tri načina: 1 nalog, 2-4 naloga, 5+ naloga. Brojevi 11-14 idu
// uz mnoštvo iako se završavaju na 1-4.
function oblik(n, jedan, dva, mnogo) {
  n = Math.abs(Math.round(n));
  const desetice = n % 100, jedinice = n % 10;
  if (desetice >= 11 && desetice <= 14) return mnogo;
  if (jedinice === 1) return jedan;
  if (jedinice >= 2 && jedinice <= 4) return dva;
  return mnogo;
}

// Prazna tabela. Ranije je svaka pisala samo jedan sivi red teksta usred belog
// polja - izgledalo je kao da se strana nije učitala. Sada svuda isto: ikona,
// šta fali i šta se radi da bi se pojavilo.
function praznaTabela(kolona, ikona, naslov, opis = "") {
  return `<tr><td colspan="${kolona}" class="empty">${icon(ikona)}
    <div class="e-t">${naslov}</div>
    ${opis ? `<div class="e-s">${opis}</div>` : ""}</td></tr>`;
}

// Prečice po satima uz iznose u dinarima. Kad je naplata isključena (cena 0)
// sati nemaju smisla, pa se red ni ne prikazuje.
function satiChips() {
  const r = ratePerHour();
  if (r <= 0) return "";
  return `<div class="quick-amts sati">${[1, 2, 3, 5].map((h) =>
    `<button class="btn btn-sm" data-sati="${h}" title="Upiši iznos za ${h} h igre">${h} h <span class="faint">${Math.round(h * r)}</span></button>`).join("")}</div>`;
}
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString("sr-Latn-RS")} ${cur()}`;
function dur(sec) {
  if (sec == null) return "bez limita";
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (x) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
const clock = (ts) => ts ? new Date(ts).toLocaleTimeString("sr-Latn-RS", { hour: "2-digit", minute: "2-digit" }) : "-";
const dt = (ts) => ts ? new Date(ts).toLocaleString("sr-Latn-RS", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
function timeAgo(ts) {
  if (!ts) return "-";
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return "malopre";
  if (d < 3600) return Math.floor(d / 60) + " min";
  if (d < 86400) return Math.floor(d / 3600) + " č";
  return Math.floor(d / 86400) + " d";
}
function statusInfo(c) {
  if (!c.online) return { key: "offline", label: "Offline", cls: "offline" };
  if (c.status === "in_use") return { key: "online", label: "Online", cls: "online" };
  if (c.status === "locked") return { key: "locked", label: "Zaključan", cls: "locked" };
  return { key: "standby", label: "Standby", cls: "standby" };
}
function fmtBytes(n) {
  n = Number(n) || 0;
  return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}
function fmtUptime(fromTs) {
  const s = Math.max(0, Math.floor((Date.now() - fromTs) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} č`;
  if (h > 0) return `${h} č ${m} min`;
  return `${m} min`;
}
function copyText(t) {
  const done = () => toast("Kopirano", "success");
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch {}
    ta.remove();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(done).catch(fallback);
  else fallback();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]");
  if (b) copyText(b.dataset.copy);
});
const kv = (k, v) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;

// Toast
function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  const ic = type === "success" ? "check" : type === "error" ? "alert" : "info";
  el.innerHTML = `<span class="t-ic">${icon(ic)}</span><span class="t-msg"></span>`;
  el.querySelector(".t-msg").textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 280); }, 3200);
}

// BREND: LOGO I BOJA IGRAONICE
//
// Dok su logo i crvena stajali ušiveni u fajlove, druga igraonica je morala da
// dobije prepravljenu kopiju programa - pa bi svaka nadogradnja morala da se
// pravi posebno za svakoga. Ovako se program izdaje jedan, a izgled se podešava
// iz panela i menja se svuda odjednom, bez osvežavanja strane.
function primeniBrend(b) {
  if (!b) return;
  state.brend = b;
  const s = document.documentElement.style;
  s.setProperty("--accent", b.akcenat);
  s.setProperty("--accent-hover", b.hover);
  s.setProperty("--accent-down", b.down);
  s.setProperty("--accent-soft", b.soft);
  s.setProperty("--accent-line", b.line);
  // Logo na sva tri mesta: prijava, bočna traka, mobilna traka. Kad ga nema,
  // ostaje ugrađeni - nova igraonica ne sme da gleda prazan pravougaonik dok ne
  // okači svoj.
  if (b.logo) $$(".login-logo-img, .side-logo-img").forEach((i) => { i.src = b.logo; i.alt = b.naziv || ""; });
  if (b.naziv) document.title = `${b.naziv} - Panel`;
}

// DUGME KOJE MENJA NOVAC SE ZAKLJUČAVA DOK SERVER NE ODGOVORI.
//
// Radnik na kasi radi u žurbi i pred gostom. Dupli klik na "Naplati" je slao
// DVA računa i naplaćivao dvaput; dupli klik na "Dodaj" je kredit dopunjavao
// dvaput. Oba puta se otkrije tek na kraju smene, kao razlika u kasi koju niko
// ne ume da objasni - a razlika u kasi mora da ima ime.
//
// U launcheru je ta zaštita postojala od ranije ("Poruči" se zaključava do
// odgovora servera); u panelu je nije bilo, a baš se on koristi u gužvi.
//
// Dugme se vraća u prvobitno stanje BEZ OBZIRA na ishod, pa neuspeo zahtev ne
// ostavlja radnika sa zaključanim dugmetom.
async function jednomKlik(btn, posao, tekstDok = "Šaljem...") {
  if (!btn || btn.disabled) return;
  const stari = btn.textContent;
  btn.disabled = true;
  btn.textContent = tekstDok;
  try {
    return await posao();
  } finally {
    // Posao je mogao da zatvori modal, pa je dugme već van strane - tada ovo
    // ništa ne menja i to je u redu.
    btn.disabled = false;
    btn.textContent = stari;
  }
}

// Modal
function modal(title, bodyHtml, onMount, wide = false, locked = false) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-back"><div class="modal ${wide ? "wide" : ""}">
    <div class="modal-head"><h3>${esc(title)}</h3>${locked ? "" : `<button class="modal-x" data-close>${icon("x")}</button>`}</div>
    <div class="modal-body">${bodyHtml}</div></div></div>`;
  const back = $(".modal-back", root);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.classList.add("closing");
    setTimeout(() => { if (back.parentNode === root) root.innerHTML = ""; }, 170);
  };
  if (!locked) {
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    $("[data-close]", root)?.addEventListener("click", close);
  }
  if (onMount) onMount(root, close);
  return close;
}

// Potvrda / unos (sloj iznad modala, umesto browser confirm/prompt)
function confirmDialog(text, opts = {}) {
  return new Promise((resolve) => {
    const root = $("#confirmRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal confirm">
      <div class="confirm-ic ${opts.danger ? "danger" : ""}">${icon(opts.danger ? "alert" : "info")}</div>
      <div class="confirm-t">${esc(opts.title || "Potvrda")}</div>
      <div class="confirm-s">${esc(text)}</div>
      ${/* Posebno naglašena rečenica ispod objašnjenja - ono što se NE SME
           prevideti (npr. "trenutno igraju 3 igrača, igra će im biti ugašena").
           Ide kao svoje polje, a ne kao HTML u tekstu, jer se tekst BEŽI: u
           njemu se pojavljuju imena računara i naloga, koja ne smeju da postanu
           oznake. */ ""}
      ${opts.istaknuto ? `<div class="confirm-hi">${esc(opts.istaknuto)}</div>` : ""}
      <div class="confirm-row">
        <button class="btn" data-c="no">Otkaži</button>
        <button class="btn ${opts.danger ? "btn-danger-solid" : "btn-primary"}" data-c="yes">${esc(opts.ok || "Potvrdi")}</button>
      </div></div></div>`;
    const back = $(".modal-back", root);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      back.classList.add("closing");
      setTimeout(() => { if (back.parentNode === root) root.innerHTML = ""; }, 160);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); finish(false); }
      else if (e.key === "Enter") { e.stopPropagation(); finish(true); }
    };
    document.addEventListener("keydown", onKey, true);
    back.addEventListener("mousedown", (e) => { if (e.target === back) finish(false); });
    $('[data-c="no"]', root).addEventListener("click", () => finish(false));
    $('[data-c="yes"]', root).addEventListener("click", () => finish(true));
    $('[data-c="yes"]', root).focus();
  });
}
function promptDialog(title, opts = {}) {
  return new Promise((resolve) => {
    const root = $("#confirmRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal confirm">
      <div class="confirm-t">${esc(title)}</div>
      ${opts.text ? `<div class="confirm-s">${esc(opts.text)}</div>` : ""}
      <div class="field"><textarea id="pdInput" rows="2" placeholder="${esc(opts.placeholder || "")}"></textarea></div>
      <div class="confirm-row">
        <button class="btn" data-c="no">Otkaži</button>
        <button class="btn btn-primary" data-c="yes">${esc(opts.ok || "Pošalji")}</button>
      </div></div></div>`;
    const back = $(".modal-back", root);
    const input = $("#pdInput", root);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      back.classList.add("closing");
      setTimeout(() => { if (back.parentNode === root) root.innerHTML = ""; }, 160);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); finish(null); }
      else if (e.key === "Enter" && !e.shiftKey) { e.stopPropagation(); e.preventDefault(); finish(input.value.trim() || null); }
    };
    document.addEventListener("keydown", onKey, true);
    back.addEventListener("mousedown", (e) => { if (e.target === back) finish(null); });
    $('[data-c="no"]', root).addEventListener("click", () => finish(null));
    $('[data-c="yes"]', root).addEventListener("click", () => finish(input.value.trim() || null));
    input.focus();
  });
}
const cbx = (cls, id, checked) => `<label class="cbx"><input type="checkbox" class="${cls}" data-id="${id}" ${checked ? "checked" : ""}><span class="box"></span></label>`;

// Paginacija (25 po strani)
function pagerHtml(d) {
  if (!d || !d.total) return "";
  const from = (d.page - 1) * d.per + 1;
  const to = Math.min(d.total, d.page * d.per);
  return `<div class="pager">
    <div class="pager-info">Prikazano <b>${from}-${to}</b> od <b>${d.total}</b></div>
    <div class="pager-ctrl">
      <button class="btn btn-sm" data-pg="prev" ${d.page <= 1 ? "disabled" : ""}>Prethodna</button>
      <span class="pager-page">${d.page} / ${d.pages}</span>
      <button class="btn btn-sm" data-pg="next" ${d.page >= d.pages ? "disabled" : ""}>Sledeća</button>
    </div></div>`;
}
function bindPager(root, d, go) {
  $$("[data-pg]", root).forEach((b) => b.addEventListener("click", () => {
    if (b.disabled) return;
    go(b.dataset.pg === "prev" ? Math.max(1, d.page - 1) : Math.min(d.pages, d.page + 1));
  }));
}

// Auth
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginErr").textContent = "";
  try {
    const data = await api("/login", "POST", { username: $("#loginUser").value, password: $("#loginPass").value });
    state.token = data.token; state.admin = data.admin;
    localStorage.setItem("crit_token", data.token);
    enterApp();
  } catch (err) { $("#loginErr").textContent = err.message; }
});

function doLogout() {
  // Bez tokena server nema sta da ponisti - zahtev bi samo vratio 401.
  if (state.token) api("/logout", "POST").catch(() => {});
  state.token = null; localStorage.removeItem("crit_token");
  if (state.ws) { try { state.ws.close(); } catch {} }
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
}

async function enterApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  applyRole();
  await loadSnapshot();
  connectWs();
  render();
  updateShiftBar();
  maybeForceShift();
}

// Smene
function maybeForceShift() {
  // Radnik mora imati otvorenu smenu da bi radio
  if (!isOwner() && !state.shift) openShiftModal(true);
}
function updateShiftBar() {
  const el = $("#shiftBar");
  if (!el) return;
  if (state.shift) {
    const t = state.shift.totals || {};
    el.innerHTML = `<div class="shift-bar">
      <div class="sb-info"><div class="sb-t">Smena otvorena</div><div class="sb-s">${esc(state.shift.admin || "")}, kasa ${money(state.shift.openingCash)}</div></div>
      <button class="btn btn-sm" id="closeShiftBtn">Zatvori</button></div>`;
    $("#closeShiftBtn").addEventListener("click", closeShiftModal);
  } else {
    el.innerHTML = isOwner() ? `<button class="btn btn-sm btn-block" id="openShiftBtn">${icon("plus")} Otvori smenu</button>` : "";
    const b = $("#openShiftBtn"); if (b) b.addEventListener("click", () => openShiftModal(false));
  }
}
function openShiftModal(mandatory) {
  modal("Otvaranje smene", `
    <div class="muted">Unesi početno stanje kase (koliko para ima u kasi na početku smene).</div>
    <div class="field"><label>Početno stanje kase (${cur()})</label><input id="osCash" type="number" value="0" autofocus /></div>
    <div class="err-msg" id="osErr"></div>
    <button class="btn btn-primary btn-block" id="osOpen">Otvori smenu</button>
    ${mandatory ? `<button class="btn btn-ghost btn-block" id="osLogout" style="margin-top:6px">Odjava</button>` : ""}`,
    (root, close) => {
      $("#osOpen", root).addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
        try {
          const r = await api("/shift/open", "POST", { openingCash: $("#osCash", root).value });
          // Kontrolna tabla mora odmah iznova: na njoj stoji upozorenje "smena
          // nije otvorena", i ako ostane posle otvaranja, izgleda kao da dugme
          // nije uradilo ništa.
          state.shift = r.shift; updateShiftBar(); refreshView(["dashboard"]);
          toast("Smena je otvorena", "success"); close();
        } catch (e) { $("#osErr", root).textContent = e.message; }
      }, "Otvaram..."));
      const lo = $("#osLogout", root); if (lo) lo.addEventListener("click", doLogout);
    }, false, !!mandatory);
}
function closeShiftModal() {
  const s = state.shift;
  modal("Zatvaranje smene", `
    <div class="muted">Smenu otvorio: <b>${esc(s?.admin || "")}</b></div>
    <div class="field"><label>Prebrojano stanje kase (${cur()})</label><input id="csCash" type="number" placeholder="koliko para je stvarno u kasi" autofocus /></div>
    <div class="faint" style="font-size:13px">Ostavi prazno ako ne prebrojavaš - obračun radi i bez toga.</div>
    ${state.vanSmene > 0 ? `<div class="upozorenje-fabricko" style="margin:12px 0 0"><div>
      <b>Danas je ${money(state.vanSmene)} naplaćeno dok smena nije bila otvorena.</b>
      <span>Taj novac je u kasi, ali ne ulazi u ovaj obračun. Ako brojiš kasu, računaj sa tim - inače će izgledati kao višak.</span>
    </div></div>` : ""}
    <div class="err-msg" id="csErr"></div>
    <button class="btn btn-primary btn-block" id="csClose">Zatvori i obračunaj</button>`,
    (root, close) => {
      $("#csClose", root).addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
        try {
          const r = await api("/shift/close", "POST", { closingCash: $("#csCash", root).value });
          state.shift = null; updateShiftBar(); refreshView(["dashboard"]); close(); showShiftSummary(r.summary);
        } catch (e) { $("#csErr", root).textContent = e.message; }
      }, "Obračunavam..."));
    });
}
function shiftBreakdownHtml(s) {
  const kv = (k, v, cls = "") => `<div style="display:flex;justify-content:space-between;padding:6px 0"><span class="muted">${k}</span><span class="${cls}" style="font-weight:650">${v}</span></div>`;
  const shopCredit = s.shopCredit != null ? s.shopCredit : Math.max(0, (s.shop || 0) - (s.shopCash || 0));
  return `
    ${kv("Otvorena", dt(s.openedAt))}
    ${kv("Zatvorena", s.closedAt ? dt(s.closedAt) : '<span class="pill green">U toku</span>')}
    ${kv("Otvorio", esc(s.admin || ""))}
    <div class="sec-label" style="margin:12px 0 2px">Novac u kasi</div>
    ${kv("Početno stanje kase", money(s.openingCash))}
    ${kv("Dopune kredita (keš)", "+" + money(s.topups), "pos")}
    ${s.deducts ? kv("Skidanja / ispravke", "−" + money(s.deducts), "zero") : ""}
    ${kv("Shop plaćen kešom", "+" + money(s.shopCash), "pos")}
    <div style="border-top:1px solid var(--line);margin:8px 0"></div>
    ${kv("<b>UKUPAN PAZAR</b>", money(s.revenue), "pos")}
    ${kv("Očekivano u kasi", money(s.expectedCash))}
    ${s.closingCash != null ? kv("Prebrojano u kasi", money(s.closingCash)) : ""}
    ${s.difference != null ? kv("Razlika (višak/manjak)", (s.difference >= 0 ? "+" : "") + money(s.difference), s.difference < 0 ? "zero" : "pos") : ""}
    <div class="sec-label" style="margin:14px 0 2px">Potrošnja igrača (nije nov novac)</div>
    ${kv("Vreme na računarima", money(s.sessions))}
    ${kv("Shop sa naloga", money(shopCredit))}
    <div class="faint" style="font-size:12px;margin-top:8px;line-height:1.5">Potrošnja se plaća iz kredita koji je već uplaćen ranije, zato ne ulazi u pazar smene.</div>`;
}
function showShiftSummary(s) {
  // Kad se kasa ne poklopi, objašnjenje se traži ODMAH - u tom trenutku čovek
  // zna zašto. Sutra više ne zna, a razlika ostaje gola brojka koja liči na
  // krađu. Ako se poklapa, ne pita se ništa.
  const razlika = s.difference != null && Math.abs(s.difference) >= 0.5;
  modal(`Obračun smene #${s.id}`, `${shiftBreakdownHtml(s)}
    ${razlika ? `<div class="field" style="margin-top:12px"><label>Zašto se kasa ne poklapa? (može i kasnije)</label>
      <textarea id="ssNote" rows="2" placeholder="npr. 500 vraćeno gostu, kusur uzet iz kase"></textarea></div>` : ""}
    <button class="btn btn-primary btn-block" id="ssOk" style="margin-top:10px">U redu</button>`,
    (root, close) => {
      $("#ssOk", root).addEventListener("click", async () => {
        const t = razlika ? $("#ssNote", root).value.trim() : "";
        if (t) { try { await api(`/shifts/${s.id}/napomena`, "POST", { note: t }); } catch {} }
        close(); maybeForceShift();
      });
    });
}
// Izveštaji
async function renderReports() {
  const period = state.reportPeriod || "today";
  let d = {};
  try { d = await api("/stats?period=" + period); } catch (e) { toast(e.message, "error"); }
  const r = d.revenue || {};
  const chart = period === "today" ? (d.byHour || []) : (d.byDay || []);
  const pLabel = { today: "Danas", week: "7 dana", month: "30 dana" };
  const s = d.sessions || {};
  const peak = period === "today" ? d.peak?.hour : d.peak?.day;
  const peakStr = peak && peak.revenue > 0
    ? `Najprometniji ${period === "today" ? "sat" : "dan"}: <b>${esc(peak.label)}${period === "today" ? "h" : ""}</b> (${money(peak.revenue)})`
    : "";
  const prosekStr = s.count ? `Prosečno po sesiji: <b>${money(s.avg || 0)}</b>, ${fmtMinutes(s.avgMin || 0)}` : "";
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Izveštaji</h1><div class="sub">Promet i statistika</div></div>
      <div class="head-actions">
        <button class="btn btn-sm" id="repExport">${icon("download")} Izvoz (CSV)</button>
        <div class="filters">${["today", "week", "month"].map((p) => `<button class="chip ${period === p ? "active" : ""}" data-rp="${p}">${pLabel[p]}</button>`).join("")}</div>
      </div></div>
    <div class="stat-strip">
      <div class="stat"><div class="k">Ukupan promet</div><div class="v money">${money(r.total || 0)}</div></div>
      <div class="stat"><div class="k">Vreme (sesije)</div><div class="v">${money(r.session || 0)}</div></div>
      <div class="stat"><div class="k">Shop</div><div class="v">${money(r.shop || 0)}</div>
        <div class="stat-split">${icon("cash")} keš ${money(r.shopCash || 0)}, kredit ${money(r.shopCredit || 0)}</div></div>
      <div class="stat"><div class="k">Dopune</div><div class="v">${money(r.topups || 0)}</div>
        ${r.poklonjeno ? `<div class="stat-split">${icon("gift")} poklonjeno ${money(r.poklonjeno)}</div>` : ""}</div>
      <div class="stat"><div class="k">Sesije</div><div class="v">${s.count || 0} <small>${fmtMinutes(s.minutes || 0)}</small></div></div>
      <div class="stat"><div class="k">Novi igrači</div><div class="v">${d.newPlayers || 0}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Promet ${period === "today" ? "po satu" : "po danima"}</h2>
      ${peakStr || prosekStr ? `<span class="faint" style="font-size:13px">${[peakStr, prosekStr].filter(Boolean).join(", ")}</span>` : ""}</div>
      <div class="card-body">${barChart(chart)}</div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
      <div class="card"><div class="card-head"><h2>Najaktivniji igrači</h2></div>
        <div class="table-wrap"><table><tbody>${(d.topPlayers || []).map((p, i) => `<tr><td style="width:26px" class="faint">${i + 1}.</td><td><b>${esc(p.username)}</b></td><td class="mono pos" style="text-align:right">${money(p.spent)}</td></tr>`).join("") || '<tr><td class="empty">Nema podataka</td></tr>'}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h2>Zarada po računaru</h2></div>
        <div class="table-wrap"><table><tbody>${(d.byComputer || []).map((c) => `<tr><td><b>${esc(c.name)}</b></td><td class="faint" style="text-align:right">${c.sessions} sesija</td><td class="mono pos" style="text-align:right">${money(c.revenue)}</td></tr>`).join("") || '<tr><td class="empty">Nema podataka</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Najigranije igre</h2><span class="faint" style="font-size:12px">koliko puta je pokrenuta</span></div>
      <div class="table-wrap"><table><tbody>${(d.topGames || []).map((g, i) => `<tr><td style="width:26px" class="faint">${i + 1}.</td><td><b>${esc(g.name)}</b></td><td class="faint" style="text-align:right">${g.igraca} ${oblik(g.igraca, "igrač", "igrača", "igrača")}</td><td class="mono" style="text-align:right">${g.puta}x</td></tr>`).join("") || '<tr><td class="empty">Još niko nije pokretao igre</td></tr>'}</tbody></table></div></div>`;
  $$("[data-rp]").forEach((b) => b.addEventListener("click", () => { state.reportPeriod = b.dataset.rp; renderReports(); }));
  const ex = $("#repExport");
  if (ex) ex.addEventListener("click", () => izveziIzvestaj(period, d));
}
// Izvoz u CSV - vlasnik otvori u Excelu ili pošalje knjigovođi. Excel na našim
// računarima očekuje tačku-zarez i BOM da bi čitao ćirilicu/latinicu iz UTF-8.
function izveziIzvestaj(period, d) {
  const r = d.revenue || {}, s = d.sessions || {};
  // NAZIV IGRE SE PRIPREMA ZA CSV, NE LEPI SIROV.
  //
  // Kolone deli tačka-zarez, a naziv igre kuca čovek. Jedan „Half-Life; Alyx"
  // razdvaja jedan red u dve kolone i tabela se pomeri od tog mesta naniže -
  // knjigovođa dobije fajl koji izgleda ispravno, a nije. Isto važi za navodnike
  // i za prelom reda.
  const polje = (v) => {
    const t = String(v ?? "");
    return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const red = (a, b) => `${polje(a)};${polje(b)}`;
  const linije = [
    red("Izveštaj", { today: "Danas", week: "Poslednjih 7 dana", month: "Poslednjih 30 dana" }[period] || period),
    red("Napravljeno", new Date().toLocaleString("sr-Latn-RS")),
    "",
    red("Stavka", "Iznos (RSD)"),
    red("Ukupan promet", r.total || 0),
    red("Vreme (sesije)", r.session || 0),
    red("Shop ukupno", r.shop || 0),
    red("  - keš", r.shopCash || 0),
    red("  - kredit", r.shopCredit || 0),
    red("Dopune kredita", r.topups || 0),
    // Poklonjen kredit (nagradni točak i popust na paket) stoji na ekranu kao
    // trošak, pa mora i ovde: bez njega izveštaj koji ide knjigovođi kaže manje
    // nego što piše u panelu, a to je razlika koju treba objašnjavati.
    red("Poklonjen kredit (točak, paketi)", r.poklonjeno || 0),
    red("Broj sesija", s.count || 0),
    red("Odigrano minuta", s.minutes || 0),
    red("Prosek po sesiji", s.avg || 0),
    red("Novi igrači", d.newPlayers || 0),
    "",
    red(period === "today" ? "Sat" : "Dan", "Promet (RSD)"),
    ...(period === "today" ? d.byHour || [] : d.byDay || []).map((x) => red(x.label, x.revenue)),
    "",
    "Najigranije igre;Puta pokrenuta",
    ...(d.topGames || []).map((g) => red(g.name, g.puta)),
  ];
  const csv = "﻿" + linije.join("\r\n");
  const naziv = `crit-izvestaj-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = naziv;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Izveštaj je preuzet", "success");
}
function barChart(data) {
  if (!data || !data.length || !data.some((x) => x.revenue > 0)) return '<div class="empty" style="padding:34px">Nema prometa u ovom periodu</div>';
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const maxIdx = data.findIndex((d) => d.revenue === max);
  const step = Math.ceil(data.length / 13);
  // stubovi idu do 86% visine da vrednost iznad najviseg stane u preostali prostor
  return `<div class="chart">${data.map((d, i) => {
    const pct = d.revenue > 0 ? Math.max(2, Math.round((d.revenue / max) * 86)) : 0;
    const lbl = i % step === 0 ? esc(d.label) : "";
    const peak = i === maxIdx && d.revenue > 0 ? `<div class="bar-peak">${money(d.revenue)}</div>` : "";
    return `<div class="bar-col" title="${esc(d.label)}: ${money(d.revenue)}"><div class="bar-area">${peak}<div class="bar" style="height:${pct}%"></div></div><div class="bar-lbl">${lbl}</div></div>`;
  }).join("")}</div>`;
}
function fmtMinutes(m) {
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h > 0 ? `${h}č ${mm}min` : `${mm}min`;
}

async function renderShifts() {
  let list = [];
  try { list = await api("/shifts"); } catch {}
  // Razlika ide u sam spisak: zbog nje se ova strana i otvara. Dok je stajala
  // samo u detalju, trebalo je kliknuti na svaku smenu da bi se videlo gde se
  // kasa nije poklopila, a njih je šezdesetak mesečno.
  const razlikaHtml = (s) => {
    if (s.difference == null) return '<span class="faint">-</span>';
    if (Math.abs(s.difference) < 0.5) return '<span class="pill green">poklapa se</span>';
    const manjak = s.difference < 0;
    return `<span class="mono" style="color:var(--${manjak ? "danger" : "locked"});font-weight:650">${manjak ? "" : "+"}${money(s.difference)}</span>`;
  };
  const rows = list.map((s) => `<tr data-shiftrow="${s.id}" style="cursor:pointer">
    <td><b>#${s.id}</b>${s.note ? ` <span title="${esc(s.note)}">${icon("message")}</span>` : ""}</td>
    <td>${esc(s.admin || "")}</td>
    <td class="mono faint" style="font-size:13px">${dt(s.openedAt)}</td>
    <td class="mono faint" style="font-size:13px">${s.closedAt ? dt(s.closedAt) : "-"}</td>
    <td class="mono">${money(s.openingCash)}</td>
    <td class="mono ${s.revenue ? "pos" : ""}">${s.revenue != null ? money(s.revenue) : "-"}</td>
    <td>${razlikaHtml(s)}</td>
    <td>${s.status === "open" ? '<span class="pill green">U toku</span>' : '<span class="pill gray">Zatvorena</span>'}</td>
  </tr>`).join("");
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Smene</h1><div class="sub">Istorija smena i pazara</div></div>
      ${state.shift ? `<button class="btn btn-danger" id="shClose">Zatvori aktivnu smenu</button>` : `<button class="btn btn-primary" id="shOpen">${icon("plus")} Otvori smenu</button>`}</div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Smena</th><th>Otvorio</th><th>Otvorena</th><th>Zatvorena</th><th>Početna kasa</th><th>Pazar</th><th>Razlika u kasi</th><th>Status</th></tr></thead>
      <tbody>${rows || praznaTabela(8, "clock", "Još nema smena",
        "Smena se otvara dugmetom gore desno. Od tog trenutka se broji pazar, a kad je zatvoriš ostaje ovde zapisana.")}</tbody></table></div></div>`;
  $$("[data-shiftrow]").forEach((tr) => tr.addEventListener("click", () => shiftDetailModal(Number(tr.dataset.shiftrow))));
  const o = $("#shOpen"); if (o) o.addEventListener("click", () => openShiftModal(false));
  const c = $("#shClose"); if (c) c.addEventListener("click", closeShiftModal);
}
async function shiftDetailModal(id) {
  try {
    const s = await api(`/shifts/${id}`);
    // Razlika u kasi uvek ima razlog: vraćen novac gostu, kusur uzet za sitno,
    // radnik se prebrojao. Bez mesta da se to zapiše, posle mesec dana ostaje
    // gola brojka koju niko ne ume da objasni, a izgleda kao krađa.
    modal(`Smena #${s.id}`, `${shiftBreakdownHtml(s)}
      <div class="field" style="margin-top:12px"><label>Napomena uz smenu</label>
        <textarea id="sdNote" rows="2" placeholder="npr. 500 vraćeno gostu, kusur uzet iz kase">${esc(s.note || "")}</textarea></div>
      <div class="card-foot" style="padding:0">
        <button class="btn" id="sdSave">Sačuvaj napomenu</button>
        <button class="btn btn-primary" id="sdOk">Zatvori prozor</button>
      </div>`,
      (root, close) => {
        $("#sdOk", root).addEventListener("click", close);
        $("#sdSave", root).addEventListener("click", async () => {
          try { await api(`/shifts/${id}/napomena`, "POST", { note: $("#sdNote", root).value });
            toast("Napomena je sačuvana", "success"); close(); renderShifts(); }
          catch (e) { toast(e.message, "error"); }
        });
      });
  } catch (e) { toast(e.message, "error"); }
}

function applyRole() {
  const owner = isOwner();
  $$('[data-owner="1"]').forEach((el) => el.classList.toggle("hidden", !owner));
  $("#pfName").textContent = state.admin?.username || "";
  $("#pfRole").textContent = ULOGA_NAZIV[state.admin?.role] || "Radnik";
  $("#pfAvatar").textContent = (state.admin?.username || "?").charAt(0).toUpperCase();
  $("#pfAvatar").classList.toggle("owner", owner);
  if (!owner && ["shop", "games", "tools", "izgled", "computers", "staff", "settings", "logs", "install", "shifts", "reports"].includes(state.view)) state.view = "dashboard";
}

async function loadSnapshot() {
  try {
    const d = await api("/snapshot");
    state.computers = d.computers; state.orders = d.orders; state.players = d.players; state.settings = d.settings; state.shift = d.shift;
    state.zalihe = d.zalihe || [];
    state.vanSmene = d.vanSmene || 0;
    primeniBrend(d.brend);
    updateCounts();
  } catch (e) { toast(e.message, "error"); }
}

// Websocket
// Traka o prekidu veze. Kad prekid javi WebSocket, ceka se 1.5 s - kratki
// prekidi se sami zakrpe i traka bi bespotrebno treperila. Kad prekid javi
// neuspeo zahtev (odmah = true), radnik je bas tada nesto kliknuo i mora
// istog trena da vidi zasto se nista nije desilo.
function setConn(ok, odmah = false) {
  const b = $("#connBanner");
  if (!b) return;
  clearTimeout(setConn._t);
  if (ok) b.classList.add("hidden");
  else if (odmah) b.classList.remove("hidden");
  else setConn._t = setTimeout(() => b.classList.remove("hidden"), 1500);
}
function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?kind=panel&token=${state.token}`);
  state.ws = ws;
  ws.onopen = () => { state.wsOk = true; setConn(true); };
  ws.onclose = () => { state.wsOk = false; setConn(false); setTimeout(() => { if (state.token) connectWs(); }, 2000); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === "snapshot") { state.computers = m.computers; state.orders = m.orders; state.settings = m.settings; refreshView(["dashboard", "orders"]); updateCounts(); }
    else if (m.t === "computers") { state.computers = m.computers; osveziIstice(); refreshView(["dashboard", "computers"]); }
    else if (m.t === "brend") primeniBrend(m.brend);
    else if (m.t === "orders") { state.orders = m.orders; refreshView(["orders", "dashboard"]); updateCounts(); }
    else if (m.t === "log") { state.logs.unshift(m.log); if (state.view === "logs") prependLog(m.log); }
    else if (m.t === "install") { state.installStatus[m.computerId] = m; if (state.view === "install") updateInstallStatus(); }
    else if (m.t === "install_clear") { state.installStatus = {}; if (state.view === "install") updateInstallStatus(); }
    else if (m.t === "nadogradnja") { if (state.view === "install") osveziNadogradnju(); }
    else if (m.t === "istice") upozoriIstice(m);
    else if (m.t === "shift") { state.shift = m.shift; updateShiftBar(); }
    else if (m.t === "event") {
      if (m.kind === "order") { toast(m.text, "info"); ding(); }
      else if (m.kind === "timeup") { toast(m.text, "error"); ding(); }
      // Igrac je pokusao da pokrene igru koje na tom racunaru nema. Ranije je to
      // znao samo on, pa je vlasnik saznavao tek kad se neko poduzi da se pozali.
      else if (m.kind === "igra-ne-radi") { toast(m.text, "error"); ding(); }
      else if (m.kind === "mirovanje") { toast(m.text, "info"); ding(); }
      else if (m.kind === "zaliha") {
        toast(m.text, m.nema ? "error" : "info");
        ding();
        osveziZalihe();
      }
      else if (m.kind === "login") toast(m.text, "info");
    }
  };
}
function refreshView(views) { if (views.includes(state.view)) render(); }
function updateCounts() {
  const n = state.orders.filter((o) => o.status === "pending" || o.status === "preparing").length;
  const b = $("#ordersCount");
  b.textContent = n; b.classList.toggle("hidden", n === 0);
}
function ding() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.frequency.value = 760; g.gain.value = 0.05;
    o.start(); o.frequency.exponentialRampToValueAtTime(1240, ac.currentTime + 0.09);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22);
    o.stop(ac.currentTime + 0.23);
  } catch {}
}

// Nav
$("#nav").addEventListener("click", (e) => {
  const n = e.target.closest(".nav-item");
  if (!n) return;
  e.preventDefault();
  const v = n.dataset.view;
  if (["shop", "games", "tools", "izgled", "computers", "staff", "settings", "logs", "install", "shifts", "reports"].includes(v) && !isOwner()) return;
  state.view = v;
  state.selection.clear(); updateBulkBar();
  $$(".nav-item").forEach((x) => x.classList.toggle("active", x === n));
  render();
});

let lastView = null;
function render() {
  // ulazna animacija samo pri promeni stranice - WS refresh ne sme da trepce
  const main = $("#main");
  if (main && lastView !== state.view) {
    lastView = state.view;
    main.classList.remove("view-in");
    void main.offsetWidth;
    main.classList.add("view-in");
    clearTimeout(render._t);
    render._t = setTimeout(() => main.classList.remove("view-in"), 500);
  }
  ({ dashboard: renderDashboard, players: renderPlayers, orders: renderOrders, pos: renderPos, shop: renderShop, games: renderGames, tools: renderTools, izgled: renderIzgled, computers: renderComputers, install: renderInstall, reports: renderReports, shifts: renderShifts, staff: renderStaff, logs: renderLogs, settings: renderSettings }[state.view] || renderDashboard)();
}

// Profil meni
function togglePfMenu(open) {
  const m = $("#pfMenu"), btn = $("#profileBtn");
  if (!m || !btn) return;
  const isOpen = !m.classList.contains("hidden") && !m.classList.contains("closing");
  const want = open === undefined ? !isOpen : open;
  if (want === isOpen) return;
  clearTimeout(togglePfMenu._t);
  if (want) {
    m.classList.remove("hidden", "closing");
    btn.classList.add("open");
  } else {
    m.classList.add("closing");
    btn.classList.remove("open");
    togglePfMenu._t = setTimeout(() => { m.classList.add("hidden"); m.classList.remove("closing"); }, 150);
  }
}
// NA TELEFONU PROFIL IDE U GORNJU TRAKU.
//
// Bocni meni se na uskom ekranu pretvara u traku sa ikonama na dnu, a njegovo
// podnozje - smena, "Promeni lozinku" i "Odjavi se" - tu nema gde da stane.
// Ranije se prosto sakrivalo, pa se sa telefona nije mogla otvoriti smena ni
// promeniti lozinka; a bas to radnik radi sa telefona. Zato se isti taj deo
// premesta u gornju traku, gde zdesna ionako stoji prazan prostor.
//
// Premesta se cvor, ne kopija: kopija bi udvostrucila id-jeve i osluskivace.
const USKO = window.matchMedia("(max-width: 860px)");
function smestiProfil() {
  const foot = $(".side-foot");
  const gde = USKO.matches ? $(".topbar") : $(".sidebar");
  if (foot && gde && foot.parentElement !== gde) {
    togglePfMenu(false);
    gde.appendChild(foot);
  }
}
smestiProfil();
USKO.addEventListener("change", smestiProfil);

$("#profileBtn").addEventListener("click", (e) => { e.stopPropagation(); togglePfMenu(); });
document.addEventListener("click", () => togglePfMenu(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") togglePfMenu(false); });
$("#pmLogout").addEventListener("click", doLogout);
function promenaLozinkeModal() {
  modal("Promena lozinke", `
    <div class="field"><label>Trenutna lozinka</label><input id="myOld" type="password" autofocus /></div>
    <div class="field"><label>Nova lozinka</label><input id="myNew" type="password" /></div>
    <div class="err-msg" id="myErr"></div>
    <button class="btn btn-primary btn-block" id="mySave">Sačuvaj lozinku</button>`, (root, close) => {
    $("#mySave", root).addEventListener("click", async () => {
      try { await api("/me/password", "POST", { oldPassword: $("#myOld", root).value, newPassword: $("#myNew", root).value }); toast("Lozinka je promenjena", "success"); close(); }
      catch (e) { $("#myErr", root).textContent = e.message; }
    });
  });
}
$("#pmPassword").addEventListener("click", promenaLozinkeModal);
// Upozorenje na kontrolnoj tabli se iscrtava iznova pri svakom osvezavanju, pa
// mu dugme ne moze da nosi svoj osluskivac - hvata se ovde.
document.addEventListener("click", (e) => {
  if (e.target.closest("#upzLozinka")) promenaLozinkeModal();
  if (e.target.closest("#upzSmena")) openShiftModal(false);
});

// Kontrolna tabla
// Panel je dostupan sa svakog telefona na mreži, a preko njega se dopunjuje
// kredit. Ko uđe sa admin/admin može sebi da upiše koliko hoće. Dosad je o tome
// pisalo samo u konzoli servera, koju niko ne čita - zato upozorenje stoji na
// kontrolnoj tabli, koju vlasnik gleda svaki dan, dok se lozinka ne promeni.
// Radnik je već naplaćivao, a smena nije otvorena.
//
// Obračun smene broji samo ono što je naplaćeno DOK je smena otvorena. Novac
// naplaćen pre toga je uredno zapisan i vidi se u Izveštajima, ali na kraju
// dana stoji u kasi kao višak koji obračun ne pominje - a radnik ne zna zašto.
// Upozorenje se pojavljuje tek kad se to stvarno desi, da ne dosađuje ujutru
// dok igraonica još nije ni počela da radi.
function upozorenjeSmena() {
  if (state.shift || !(state.vanSmene > 0)) return "";
  return `<div class="upozorenje-fabricko" id="upozSmena">
    ${icon("alert")}
    <div>
      <b>Smena nije otvorena, a naplaćeno je ${money(state.vanSmene)}.</b>
      <span>Taj novac se vidi u Izveštajima, ali neće ući ni u jedan obračun smene - na kraju dana će u kasi stajati kao višak koji obračun ne pominje. Otvori smenu da se dalja naplata uredno broji.</span>
      ${isOwner() ? `<button class="btn btn-sm" id="upzSmena">Otvori smenu</button>` : ""}
    </div>
  </div>`;
}

function upozorenjeLozinka() {
  if (!state.settings?.fabrickaLozinka) return "";
  return `<div class="upozorenje-fabricko" id="upozLozinka">
    ${icon("alert")}
    <div>
      <b>Vlasnički nalog još uvek ima fabričku lozinku (admin / admin).</b>
      <span>Panel se otvara sa svakog telefona na mreži, a preko njega se dopunjuje kredit. Promeni lozinku pre otvaranja igraonice.</span>
      <button class="btn btn-sm" id="upzLozinka">Promeni lozinku</button>
    </div>
  </div>`;
}

// SERVISNI PIN LAUNCHERA JOŠ FABRIČKI.
//
// Taj PIN čuva ulaz u podešavanja launchera i izlaz iz kioska kad server ne
// radi. Dok stoji na 1234, igrač koji iščupa mrežni kabl može da preusmeri
// računar na svoj server i tako sebi otvori besplatnu igru.
//
// Menja se ručno, po mašini - a ručni korak se zaboravi baš na onoj trinaestoj.
// Zato ovde stoje IMENA računara: bez njih vlasnik zna da negde nešto fali, ali
// mora da obiđe sve mašine da nađe koju. Isti razlog zbog kog je i fabrička
// lozinka vlasnika dobila svoje upozorenje.
function upozorenjePin() {
  if (!isOwner()) return "";
  const masine = state.computers.filter((c) => c.pinFabricki === true).map((c) => c.name);
  if (!masine.length) return "";
  return `<div class="upozorenje-fabricko" id="upozPin">
    ${icon("alert")}
    <div>
      <b>Servisni PIN launchera je fabrički (1234) na ${masine.length === 1 ? "računaru" : `${masine.length} računara`}: ${esc(masine.join(", "))}.</b>
      <span>Taj PIN čuva ulaz u podešavanja launchera i izlaz iz kioska kad server ne radi. Dok je fabrički, igrač koji iščupa mrežni kabl može da preusmeri računar na svoj server.
      Menja se na samoj mašini: u folderu gde je launcher instaliran, podfolder <span class="mono">resources</span>, fajl <span class="mono">podesavanja.json</span>, polje <span class="mono">servisniPin</span>. Posle izmene restartuj launcher.</span>
    </div>
  </div>`;
}

async function renderDashboard() {
  let rep = {};
  try { rep = await api("/report"); } catch {}
  const online = state.computers.filter((c) => c.online && c.status === "in_use").length;
  const standby = state.computers.filter((c) => c.online && c.status !== "in_use" && c.status !== "locked").length;
  const locked = state.computers.filter((c) => c.online && c.status === "locked").length;
  const off = state.computers.filter((c) => !c.online).length;
  const wakeable = state.computers.filter((c) => !c.online && c.mac).length; // offline sa poznatim MAC-om
  const promet = (rep.sessionRevenue || 0) + (rep.shopRevenue || 0) + (rep.cashRevenue || 0);

  const counts = { all: state.computers.length, online, standby, locked, offline: off };
  // izbaci iz selekcije računare koji više ne postoje
  const validIds = new Set(state.computers.map((c) => c.id));
  for (const id of [...state.selection]) if (!validIds.has(id)) state.selection.delete(id);
  const filtered = filteredComputers();

  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Kontrolna tabla</h1><div class="sub">${state.computers.length} računara u mreži</div></div>
      <button class="btn" id="dashOrder">${icon("plus")} Porudžbina</button></div>
    ${upozorenjeLozinka()}
    ${upozorenjePin()}
    ${upozorenjeSmena()}
    <div class="stat-strip">
      <div class="stat"><div class="k">Zauzeto</div><div class="v online">${online}</div></div>
      <div class="stat stat-slobodno" id="statSlobodno" title="Klikni da vidiš samo slobodne">
        <div class="k">Slobodno</div>
        <div class="v">${standby}${off ? ` <small>+${off} ugašenih</small>` : ""}</div>
      </div>
      <div class="stat"><div class="k">Zaključano</div><div class="v" style="color:var(--locked)">${locked}</div></div>
      <div class="stat"><div class="k">Promet danas</div><div class="v money">${money(promet)}</div></div>
      <div class="stat"><div class="k">Dopune danas</div><div class="v money">${money(rep.topups || 0)}</div></div>
    </div>
    ${trakaSlobodnih()}
    ${trakaZaliha()}
    <div class="board-bar">
      <div class="filters">
        ${["all", "online", "standby", "locked", "offline"].map((f) => `<button class="chip ${state.filter === f ? "active" : ""}" data-filter="${f}">${{ all: "Svi", online: "Online", standby: "Standby", locked: "Zaključani", offline: "Offline" }[f]}${counts[f] != null ? ` (${counts[f]})` : ""}</button>`).join("")}
      </div>
      <label class="cbx" style="margin-left:6px"><input type="checkbox" id="selAll"><span class="box"></span> <span style="font-size:13px;font-weight:500">Označi sve</span></label>
      <div class="spacer"></div>
      ${wakeable ? `<button class="btn btn-sm" id="wakeAll">${icon("power")} Upali sve (${wakeable})</button>` : ""}
      ${locked ? `<button class="btn btn-sm" data-shift="unlock">${icon("unlock")} Otključaj sve (${locked})</button>` : ""}
      <button class="btn btn-sm" data-shift="lock">${icon("lock")} Zaključaj sve</button>
      <button class="btn btn-sm btn-danger" data-shift="shutdown">${icon("power")} Ugasi sve (kraj smene)</button>
    </div>
    <div class="station-grid">${filtered.map(stationCard).join("") || `<div class="empty" style="grid-column:1/-1">${icon("monitor", "")}<div>Nema računara u ovom filteru</div></div>`}</div>`;

  $$("[data-filter]").forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.filter; renderDashboard(); }));
  $("#statSlobodno").addEventListener("click", () => {
    state.filter = state.filter === "standby" ? "all" : "standby";
    renderDashboard();
  });
  $("#selAll").addEventListener("change", (e) => {
    state.selection.clear();
    if (e.target.checked) filtered.forEach((c) => state.selection.add(c.id));
    $$(".pc-check").forEach((ch) => { ch.checked = e.target.checked; ch.closest(".station").classList.toggle("selected", e.target.checked); });
    updateBulkBar();
    syncSelAll();
  });
  $$("[data-shift]").forEach((b) => b.addEventListener("click", () => shiftAction(b.dataset.shift)));
  const wa = $("#wakeAll");
  if (wa) wa.addEventListener("click", async () => {
    wa.disabled = true;
    try {
      const r = await api("/computers/wake-all", "POST");
      toast(`Signal za paljenje poslat na ${r.sent} računara`, "success");
    } catch (e) { toast(e.message, "error"); } finally { wa.disabled = false; }
  });
  $("#dashOrder").addEventListener("click", openOrderModal);
  updateBulkBar();
  syncSelAll();
}

function filteredComputers() {
  return state.computers.filter((c) => state.filter === "all" ? true : statusInfo(c).key === state.filter);
}
// "Označi sve" prati stvarno stanje: čekiran kad su svi vidljivi označeni,
// crtica (indeterminate) kad je označen samo deo
function syncSelAll() {
  const el = $("#selAll");
  if (!el) return;
  const vis = filteredComputers();
  const sel = vis.filter((c) => state.selection.has(c.id)).length;
  el.checked = vis.length > 0 && sel === vis.length;
  el.indeterminate = sel > 0 && sel < vis.length;
}

// Kad uđe grupa, radnik mora u sekundi da vidi KOJI su računari slobodni,
// ne samo koliko ih ima. Ugašeni se posebno označavaju jer traže paljenje.
// Piće nestane u špicu i sazna se tek kad gost pita. Traka stoji na kontrolnoj
// tabli dok se magacin ne dopuni, a klik vodi pravo na dopunu zalihe.
function trakaZaliha() {
  const z = state.zalihe || [];
  if (!z.length) return "";
  const prazni = z.filter((i) => i.stock === 0);
  const pri_kraju = z.filter((i) => i.stock > 0);
  const znacka = (i) =>
    `<button class="zaliha-stavka ${i.stock === 0 ? "prazno" : ""}" data-zaliha="${i.id}" title="Dopuni zalihu">
      ${esc(i.name)} <b>${i.stock === 0 ? "nema" : i.stock}</b>
    </button>`;
  return `<div class="zaliha-traka">
    <span class="zaliha-naslov">${icon("bag")} ${prazni.length ? "Nema na stanju" : "Zaliha pri kraju"}</span>
    ${prazni.map(znacka).join("")}${pri_kraju.map(znacka).join("")}
  </div>`;
}

async function osveziZalihe() {
  try { state.zalihe = await api("/zalihe"); } catch { return; }
  if (state.view === "dashboard") renderDashboard();
}

// Klik na artikal u traci vodi pravo u dopunu, bez odlaska na stranu Shop.
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-zaliha]");
  if (!b) return;
  const id = Number(b.dataset.zaliha);
  const stavka = (state.zalihe || []).find((x) => x.id === id);
  if (!stavka) return;
  const v = await promptDialog("Dopuni zalihu - " + stavka.name, {
    text: `Trenutno: ${stavka.stock}. Koliko komada dodati?`, placeholder: "npr. 24", ok: "Dopuni",
  });
  if (v == null) return;
  const add = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  if (!add) return;
  try {
    const r = await api(`/shop/${id}/stock`, "POST", { add });
    toast(`${stavka.name} - sada ${r.stock} na stanju`, "success");
    osveziZalihe();
  } catch (err) { toast(err.message, "error"); }
});

function trakaSlobodnih() {
  const spremni = state.computers.filter((c) => c.online && !c.player && c.status !== "locked");
  const ugaseni = state.computers.filter((c) => !c.online);
  if (!spremni.length && !ugaseni.length) {
    return `<div class="slobodni-traka puna">${icon("info")}<span>Svi računari su zauzeti</span></div>`;
  }
  // Daljinsko paljenje radi samo za racunar kome je upisana MAC adresa. Ranije
  // su svi ugaseni stajali kao dugme "klikni da upalis", pa je klik na dvanaest
  // od trinaest davao samo poruku o gresci - traka je obecavala sto ne moze.
  const znacka = (c, ugasen) => {
    const moze = !ugasen || !!c.mac;
    const naslov = !ugasen ? "Slobodan"
      : moze ? "Ugašen - klikni da upališ"
      : "Ugašen - nema zabeleženu MAC adresu, pa ne može daljinsko paljenje. Računar mora bar jednom da se poveže dok je uključen.";
    return `<button class="slobodan-pc${ugasen ? " ugasen" : ""}${moze ? "" : " bez-mac"}" data-slobodan="${c.id}" title="${naslov}">${esc(c.name)}</button>`;
  };
  // Naslov mora da odgovara onome sto u traci stvarno stoji. Ranije je uvek
  // pisalo "SLOBODNO", pa je pri zatvorenoj igraonici traka nabrajala svih 13
  // racunara ispod brojaca na kom pise "SLOBODNO 0" - dva podatka jedan ispod
  // drugog koji protivrece jedan drugom.
  const delovi = [];
  if (spremni.length) delovi.push(`<span class="slobodni-naslov">Slobodno</span>${spremni.map((c) => znacka(c, false)).join("")}`);
  // Naslov obećava paljenje samo ako bar jedan ugašen ima MAC adresu.
  const imaMac = ugaseni.some((c) => c.mac);
  if (ugaseni.length) delovi.push(`<span class="slobodni-naslov">Ugašeno${!spremni.length && imaMac ? " (klikni da upališ)" : ""}</span>${ugaseni.map((c) => znacka(c, true)).join("")}`);
  return `<div class="slobodni-traka">${delovi.join("")}</div>`;
}

function stationCard(c) {
  const si = statusInfo(c);
  let body;
  if (c.player) {
    const rem = c.session?.remainingSeconds;
    const low = rem != null && rem < 300;
    body = `<div class="st-user">${esc(c.player.displayName || c.player.username)}</div>
      <div class="st-line">
        <span class="st-timer ${low ? "low" : ""}" data-rem="${rem ?? ""}">${dur(rem)}</span>
        <span class="st-bal">${money(c.player.balance)}</span>
      </div>
      <div class="st-sub uz">Prijava ${clock(c.session?.startedAt)}<i class="uz-tacka"></i>igra <span data-since="${c.session?.startedAt ?? ""}">${c.session?.startedAt ? dur((Date.now() - c.session.startedAt) / 1000) : "-"}</span></div>`;
  } else {
    const txt = si.key === "locked" ? "Zaključan - čeka osoblje" : si.key === "offline" ? "Ugašen / nije povezan" : "Slobodan za prijavu";
    const ic = si.key === "locked" ? "lock" : si.key === "offline" ? "power" : "monitor";
    body = `<div class="st-empty">${icon(ic)}<span>${txt}</span></div>`;
    if (si.key === "offline" && c.lastSeen) body += `<div class="st-sub">Poslednji put online: ${timeAgo(c.lastSeen)}</div>`;
  }
  const acts = [];
  if (si.key === "offline") {
    if (c.mac) acts.push(`<button class="btn btn-sm btn-primary" data-act="wake" data-id="${c.id}">${icon("power")} Upali</button>`);
    acts.push(`<button class="btn btn-sm btn-ghost" data-act="detail" data-id="${c.id}" style="flex:1">Detalji</button>`);
  } else if (c.player) {
    // Igrač je za računarom - dopuna je ono što radnik ovde najčešće radi,
    // pa ide na karticu da ne mora da traži nalog po spisku igrača.
    acts.push(`<button class="btn btn-sm" data-act="dopuni" data-id="${c.id}">${icon("wallet")} Dopuni</button>`);
    acts.push(`<button class="btn btn-sm icon" data-act="lock" data-id="${c.id}" title="Zaključaj računar">${icon("lock")}</button>`);
    acts.push(`<button class="btn btn-sm icon" data-act="detail" data-id="${c.id}" title="Više opcija">${icon("more")}</button>`);
  } else {
    if (si.key === "locked") acts.push(`<button class="btn btn-sm btn-primary" data-act="unlock" data-id="${c.id}">${icon("unlock")} Otključaj</button>`);
    else acts.push(`<button class="btn btn-sm" data-act="lock" data-id="${c.id}">${icon("lock")} Zaključaj</button>`);
    acts.push(`<button class="btn btn-sm icon" data-act="detail" data-id="${c.id}" title="Više opcija">${icon("more")}</button>`);
  }

  const sel = state.selection.has(c.id);
  return `<div class="station ${si.cls} ${sel ? "selected" : ""} ${istaknutRacunar === c.id ? "istaknut" : ""}" data-id="${c.id}">
    <div class="st-head">
      ${cbx("pc-check", c.id, sel)}
      <div class="st-name">${esc(c.name)}</div>
      <span class="st-status ${si.cls}"><span class="d"></span>${si.label}</span>
    </div>
    <div class="st-body">${body}</div>
    <div class="st-actions">${acts.join("")}</div></div>`;
}

// selekcija
document.addEventListener("change", (e) => {
  const ch = e.target.closest(".pc-check");
  if (!ch) return;
  const id = Number(ch.dataset.id);
  if (ch.checked) state.selection.add(id); else state.selection.delete(id);
  const card = ch.closest(".station"); if (card) card.classList.toggle("selected", ch.checked);
  updateBulkBar();
  syncSelAll();
});

function updateBulkBar() {
  const bar = $("#bulkBar");
  const n = state.selection.size;
  if (state.view !== "dashboard" || n === 0) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  bar.innerHTML = `<span class="cnt">${n} označeno</span>
    <button class="btn btn-sm" data-bulk="message">${icon("message")} Poruka</button>
    <button class="btn btn-sm" data-bulk="lock">${icon("lock")} Zaključaj</button>
    <button class="btn btn-sm" data-bulk="unlock">${icon("unlock")} Otključaj</button>
    <button class="btn btn-sm" data-bulk="logout">${icon("logoff")} Odjavi</button>
    <button class="btn btn-sm" data-bulk="restart">${icon("restart")} Restart</button>
    <button class="btn btn-sm btn-danger" data-bulk="shutdown">${icon("power")} Ugasi</button>
    <button class="btn btn-sm btn-ghost" data-bulk="clear">${icon("x")}</button>`;
  $$("[data-bulk]", bar).forEach((b) => b.addEventListener("click", () => bulkClick(b.dataset.bulk)));
}

async function bulkClick(action) {
  const ids = [...state.selection];
  if (action === "clear") { state.selection.clear(); renderDashboard(); return; }
  if (action === "message") {
    modal(`Poruka za ${ids.length} računara`, `<div class="field"><label>Tekst poruke</label><textarea id="bmText" rows="3" autofocus></textarea></div><button class="btn btn-primary btn-block" id="bmSend">Pošalji</button>`, (root, close) => {
      $("#bmSend", root).addEventListener("click", async () => {
        const text = $("#bmText", root).value.trim(); if (!text) return;
        for (const id of ids) await api(`/computers/${id}/message`, "POST", { text }).catch(() => {});
        toast("Poruka je poslata", "success"); close();
      });
    });
    return;
  }
  // KOLIKO IH TRENUTNO IGRA - to je jedini broj koji ovde nešto znači.
  //
  // "Zaključaj" i "Odjavi" na računaru sa igračem zatvaraju sesiju i GASE MU
  // IGRU. Do sada su išli bez ijednog pitanja, dok su "Ugasi" i "Restart" imali
  // potvrdu - a posledica je ista: čovek usred meča ostaje bez igre. U igraonici
  // je to najskuplja greška koja se pravi jednim promašenim klikom, jer gost
  // koji tako izgubi partiju sledeći put ide preko puta.
  const igraju = ids.filter((id) => state.computers.find((c) => c.id === id)?.player).length;
  const uzIgrace = igraju
    ? `Od toga ${igraju === 1 ? "1 računar ima igrača koji trenutno igra" : `${igraju} ${oblik(igraju, "računar ima igrača koji", "računara imaju igrače koji", "računara ima igrače koji")} trenutno ${igraju === 1 ? "igra" : "igraju"}`} - igra će im biti ugašena.`
    : null;

  const potvrde = {
    shutdown: { text: `Ugasiće se ${ids.length} označenih računara.`, istaknuto: uzIgrace, title: "Gašenje računara", ok: "Ugasi", danger: true },
    restart: { text: `Restartovaće se ${ids.length} označenih računara.`, istaknuto: uzIgrace, title: "Restart računara", ok: "Restartuj", danger: true },
    lock: igraju ? { text: `Zaključaće se ${ids.length} označenih računara.`, istaknuto: uzIgrace, title: "Zaključavanje računara", ok: "Zaključaj", danger: true } : null,
    logout: igraju ? { text: `Odjaviće se igrači sa ${ids.length} označenih računara.`, istaknuto: uzIgrace, title: "Odjava igrača", ok: "Odjavi", danger: true } : null,
  }[action];
  // Zaključavanje i odjava PRAZNIH računara ne pitaju ništa - nema šta da se
  // prekine, a pitanje bez sadržaja se nauči da se preskače.
  if (potvrde && !(await confirmDialog(potvrde.text, potvrde))) return;
  try {
    const r = await api("/computers-action", "POST", { ids, action });
    toast(`Izvršeno na ${r.sent} od ${r.total} računara`, "success");
    state.selection.clear();
    if (state.view === "dashboard") renderDashboard();
  } catch (e) { toast(e.message, "error"); }
}

async function shiftAction(action) {
  // Isto kao kod grupnih akcija: broj onih koji TRENUTNO IGRAJU je jedino što
  // ovde nešto znači. "Zaključaj sve" na punoj igraonici gasi igru svima
  // odjednom, a stara poruka to nije ni pominjala.
  const igraju = state.computers.filter((c) => c.player).length;
  const uzIgrace = igraju
    ? `Trenutno ${igraju === 1 ? "igra 1 igrač" : `igraju ${igraju} igrača`} - igra će im biti ugašena.`
    : null;
  const conf = {
    shutdown: { text: "Svi računari će biti ugašeni.", istaknuto: uzIgrace, title: "Kraj smene", ok: "Ugasi sve", danger: true },
    lock: { text: "Svi računari će biti zaključani.", istaknuto: uzIgrace, title: "Zaključavanje svih računara", ok: "Zaključaj sve", danger: !!igraju },
    unlock: { text: "Svi zaključani računari će biti otključani. Sesije koje su u toku se ne diraju.", title: "Otključavanje", ok: "Otključaj sve", danger: false },
  }[action];
  if (!(await confirmDialog(conf.text, conf))) return;
  try {
    const r = await api("/computers-action", "POST", { ids: [], action });
    toast(action === "shutdown" ? `Gasim ${r.sent} računara` : action === "unlock" ? `Otključano ${r.sent}` : `Zaključano ${r.sent}`, "success");
  } catch (e) { toast(e.message, "error"); }
}

// akcije po računaru
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = Number(btn.dataset.id), act = btn.dataset.act;
  try {
    if (act === "lock") { await api(`/computers/${id}/lock`, "POST"); toast("Računar je zaključan", "success"); }
    else if (act === "unlock") { await api(`/computers/${id}/unlock`, "POST"); toast("Računar je otključan", "success"); }
    else if (act === "wake") { await api(`/computers/${id}/wake`, "POST"); toast("Signal za paljenje je poslat", "success"); }
    else if (act === "detail") pcDetail(id);
    else if (act === "dopuni") {
      const c = state.computers.find((x) => x.id === id);
      if (!c?.player) return toast("Za ovim računarom nema prijavljenog igrača", "error");
      const p = await nadjiIgraca(c.player.id, c.player.username);
      if (p) topupModal(p); else toast("Nalog nije pronađen", "error");
    }
  } catch (err) { toast(err.message, "error"); }
});

// Znacke slobodnih računara iznad mreže: ugašen se pali, spreman se pokazuje.
document.addEventListener("click", async (e) => {
  const z = e.target.closest("[data-slobodan]");
  if (!z) return;
  const id = Number(z.dataset.slobodan);
  const c = state.computers.find((x) => x.id === id);
  if (!c) return;
  if (!c.online) {
    if (!c.mac) return toast(`${c.name} nema upisanu MAC adresu - ne može daljinsko paljenje`, "error");
    try { await api(`/computers/${id}/wake`, "POST"); toast(`Signal za paljenje poslat na ${c.name}`, "success"); }
    catch (err) { toast(err.message, "error"); }
    return;
  }
  // Kartica ume da bude van prikaza zbog filtera - vrati na sve pa je pokaži.
  if (!document.querySelector(`.station[data-id="${id}"]`)) state.filter = "all";
  istakniRacunar(id);
  document.querySelector(`.station[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
});

// Tabla se osvežava svake sekunde i pravi kartice iznova, pa oznaka mora da
// živi u stanju - inače je prvo osvežavanje obriše pre nego što je radnik vidi.
let istaknutRacunar = null;
let istaknutTajmer = null;
function istakniRacunar(id) {
  istaknutRacunar = id;
  clearTimeout(istaknutTajmer);
  istaknutTajmer = setTimeout(() => {
    istaknutRacunar = null;
    if (state.view === "dashboard") renderDashboard();
  }, 2500);
  renderDashboard();
}

function pcDetail(id) {
  const c = state.computers.find((x) => x.id === id);
  if (!c) return;
  const si = statusInfo(c);
  const off = si.key === "offline";
  let rows = kv("Status", `<span class="st-status ${si.cls}"><span class="d"></span>${si.label}</span>`);
  if (c.player) {
    rows += kv("Igrač", `<b>${esc(c.player.displayName || c.player.username)}</b>`);
    rows += kv("Kredit", `<b class="pos">${money(c.player.balance)}</b>`);
    rows += kv("Preostalo vreme", `<b>${dur(c.session?.remainingSeconds)}</b>`);
    rows += kv("Prijavljen u", clock(c.session?.startedAt));
    rows += kv("Igra već", c.session?.startedAt ? dur((Date.now() - c.session.startedAt) / 1000) : "-");
  }
  rows += kv("IP adresa", c.ip ? `<span class="mono">${esc(c.ip)}</span><button class="btn btn-sm btn-ghost ic-btn" data-copy="${esc(c.ip)}" title="Kopiraj IP">${icon("copy")}</button>` : '<span class="faint">nepoznata</span>');
  rows += kv("MAC (za paljenje)", c.mac ? `<span class="mono">${esc(c.mac)}</span>` : '<span class="faint">nepoznat - poveži računar bar jednom</span>');
  if (!off && c.connectedAt) rows += kv("Launcher povezan od", `${clock(c.connectedAt)} <span class="faint">(${fmtUptime(c.connectedAt)})</span>`);
  if (off) rows += kv("Poslednji put online", c.lastSeen ? timeAgo(c.lastSeen) : '<span class="faint">nikad</span>');
  modal(c.name, `
    <div class="kv-card">${rows}</div>
    <div class="sec-label">Kontrola</div>
    <div class="btn-row">
      <button class="btn btn-sm" data-d="message">${icon("message")} Poruka</button>
      ${si.key === "locked" ? `<button class="btn btn-sm btn-primary" data-d="unlock">${icon("unlock")} Otključaj</button>` : `<button class="btn btn-sm" data-d="lock">${icon("lock")} Zaključaj</button>`}
      ${c.player ? `<button class="btn btn-sm" data-d="logout">${icon("logoff")} Odjavi igrača</button>` : ""}
    </div>
    <div class="sec-label">Sistem računara</div>
    <div class="btn-row">
      ${off && c.mac ? `<button class="btn btn-sm btn-primary" data-d="wake">${icon("power")} Upali (WoL)</button>` : ""}
      <button class="btn btn-sm" data-d="procesi" ${off ? "disabled" : ""}>${icon("taskmgr")} Šta radi na računaru</button>
      <button class="btn btn-sm" data-d="reboot_launcher" ${off ? "disabled" : ""}>${icon("refresh")} Restart launchera</button>
      <button class="btn btn-sm" data-d="restart" ${off ? "disabled" : ""}>${icon("restart")} Restartuj</button>
      <button class="btn btn-sm" data-d="logoff" ${off ? "disabled" : ""}>${icon("logoff")} Odjava Windows</button>
      <button class="btn btn-sm btn-danger" data-d="shutdown" ${off ? "disabled" : ""}>${icon("power")} Ugasi</button>
    </div>
    ${off ? '<div class="faint" style="font-size:13px">Računar je offline - sistemske komande nisu dostupne.</div>' : ""}`, (root, close) => {
    $$("[data-d]", root).forEach((b) => b.addEventListener("click", async () => {
      const d = b.dataset.d;
      try {
        if (d === "message") {
          const text = await promptDialog("Poruka za " + c.name, { placeholder: "Tekst poruke koji igrač vidi na ekranu", ok: "Pošalji" });
          if (text) { await api(`/computers/${id}/message`, "POST", { text }); toast("Poruka je poslata", "success"); }
        }
        else if (d === "lock") { await api(`/computers/${id}/lock`, "POST"); toast("Zaključano", "success"); close(); }
        else if (d === "unlock") { await api(`/computers/${id}/unlock`, "POST"); toast("Otključano", "success"); close(); }
        else if (d === "logout") {
          if (await confirmDialog(`Igrač će biti odjavljen sa računara ${c.name}.`, { title: "Odjava igrača", ok: "Odjavi" })) {
            await api(`/computers/${id}/logout`, "POST"); toast("Igrač je odjavljen", "success"); close();
          }
        }
        else if (d === "wake") { await api(`/computers/${id}/wake`, "POST"); toast("Signal za paljenje je poslat", "success"); close(); }
        else if (d === "procesi") { close(); procesiModal(c); }
        else {
          if (d === "shutdown" || d === "restart" || d === "logoff" || d === "reboot_launcher") {
            const txt = { shutdown: "Računar će biti ugašen.", restart: "Računar će biti restartovan.", logoff: "Windows nalog će biti odjavljen.", reboot_launcher: "Launcher na računaru će biti ponovo pokrenut." }[d];
            const okLbl = { shutdown: "Ugasi", restart: "Restartuj", logoff: "Odjavi", reboot_launcher: "Restartuj launcher" }[d];
            if (!(await confirmDialog(txt, { title: c.name, ok: okLbl, danger: d !== "reboot_launcher" }))) return;
          }
          await api(`/computers/${id}/command`, "POST", { cmd: d }); toast("Komanda je poslata", "success"); if (d !== "taskmgr") close();
        }
      } catch (err) { toast(err.message, "error"); }
    }));
  });
}

// ŠTA RADI NA RAČUNARU (daljinski task manager)
//
// Radnik sa glavnog računara vidi šta radi na izabranoj mašini i gasi
// zaglavljenu igru. Ranije je "Task Manager" iz panela otvarao Task Manager NA
// računaru igrača - radnik bi morao da ustane i ode do te mašine, a igrač bi u
// međuvremenu imao Task Manager pred sobom.
//
// Sistemski programi se prikazuju, ali se NE mogu ugasiti odavde - inače bi
// jedan pogrešan klik oborio Windows nasred smene.
const mem = (b) => {
  const n = Number(b) || 0;
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + " GB";
  return Math.round(n / 1024 / 1024) + " MB";
};

function procesiModal(c) {
  let spisak = [];
  let filter = "";
  // Sistemskih procesa je oko dve trecine spiska i nijedan se ne gasi odavde.
  // Radnik ovde trazi zaglavljenu igru, pa mu oni samo smetaju - prikazuju se
  // tek na zahtev.
  let sviProcesi = false;
  modal(`Šta radi na ${c.name}`, `
    <div class="toolbar" style="margin-bottom:12px">
      <div class="search">${icon("search")}<input id="prSearch" placeholder="Pretraži programe..." /></div>
      <label class="cbx" style="margin:0"><input type="checkbox" id="prSvi"><span class="box"></span>
        <span style="font-size:13px">Prikaži i sistemske</span></label>
      <button class="btn btn-sm" id="prOsvezi">${icon("refresh")} Osveži</button>
    </div>
    <div id="prTelo"><div class="empty" style="padding:26px">učitavam spisak sa računara...</div></div>`,
    (root, close) => {
      const telo = $("#prTelo", root);

      const crtaj = () => {
        const q = filter.trim().toLowerCase();
        let vid = sviProcesi ? spisak : spisak.filter((p) => !p.zasticen);
        if (q) vid = vid.filter((p) => p.ime.includes(q) || String(p.pid).includes(q));
        if (!spisak.length) {
          telo.innerHTML = `<div class="empty" style="padding:26px">${icon("inbox")}
            <div class="e-t">Ništa se ne prikazuje</div>
            <div class="e-s">Računar nije javio nijedan program.</div></div>`;
          return;
        }
        telo.innerHTML = `
          <div class="table-wrap"><table>
            <thead><tr><th>Program</th><th>Memorija</th><th></th></tr></thead>
            <tbody>${vid.slice(0, 200).map((p) => `<tr>
              <td>
                <b>${esc(p.ime)}</b>
                <div class="faint uz" style="font-size:12px">PID ${p.pid}${p.putanja ? `<i class="uz-tacka"></i>${esc(p.putanja)}` : ""}</div>
              </td>
              <td class="mono">${mem(p.memorija)}</td>
              <td style="text-align:right">${p.zasticen
                ? '<span class="pill faint" title="Sistemski program - ne gasi se odavde">sistemski</span>'
                : `<button class="btn btn-sm btn-ghost del" data-ugasi="${p.pid}" data-ime="${esc(p.ime)}">${icon("x")} Ugasi</button>`}</td>
            </tr>`).join("")}</tbody>
          </table></div>
          <div class="faint" style="font-size:12px;margin-top:10px">
            Prikazano ${Math.min(vid.length, 200)} od ${spisak.length} programa koji rade.
            ${sviProcesi ? "Sistemski se ne gase odavde." : `Sistemskih (${spisak.filter((p) => p.zasticen).length}) nema u spisku - oni se ne gase odavde.`}
          </div>`;
        $$("[data-ugasi]", root).forEach((b) => b.addEventListener("click", async () => {
          const pid = b.dataset.ugasi, ime = b.dataset.ime;
          if (!(await confirmDialog(`Program „${ime}" će biti ugašen na računaru ${c.name}. Nesačuvan rad se gubi.`,
            { title: "Gašenje programa", ok: "Ugasi", danger: true }))) return;
          b.disabled = true;
          try {
            const r = await api(`/computers/${c.id}/procesi/${pid}/ugasi`, "POST");
            toast(`Ugašen ${r.ime || ime}`, "success");
            await ucitaj();
          } catch (e) { toast(e.message, "error"); b.disabled = false; }
        }));
      };

      const ucitaj = async () => {
        try {
          const r = await api(`/computers/${c.id}/procesi`);
          spisak = r.spisak || [];
          crtaj();
        } catch (e) {
          telo.innerHTML = `<div class="ucitavanje-palo">${icon("alert")}
            <b>Spisak nije mogao da se učita</b>
            <span>${esc(e.message)}</span></div>`;
        }
      };

      let t;
      $("#prSearch", root).addEventListener("input", (e) => {
        clearTimeout(t);
        const v = e.target.value;
        t = setTimeout(() => { filter = v; crtaj(); }, 200);
      });
      $("#prSvi", root).addEventListener("change", (e) => { sviProcesi = e.target.checked; crtaj(); });
      $("#prOsvezi", root).addEventListener("click", ucitaj);
      ucitaj();
    }, true);
}

// live vreme
setInterval(() => {
  if (state.view === "dashboard") {
    $$("[data-rem]").forEach((el) => {
      let r = el.dataset.rem; if (r === "") return;
      r = Math.max(0, parseInt(r) - 1); el.dataset.rem = r;
      el.textContent = dur(r); el.classList.toggle("low", r < 300);
    });
    $$("[data-since]").forEach((el) => { const s = el.dataset.since; if (s) el.textContent = dur((Date.now() - Number(s)) / 1000); });
  } else if (state.view === "orders") {
    $$("[data-ago]").forEach((el) => { const t = Number(el.dataset.ago); if (t) el.textContent = timeAgo(t); });
  }
}, 1000);

// Igrači
async function renderPlayers() {
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Igrači</h1><div class="sub" id="plCount">učitavam...</div></div>
      <div class="head-actions">
        <button class="btn hidden" id="cleanGuests"></button>
        <button class="btn" id="addGuests">${icon("user")} Brzi gost</button>
        <button class="btn btn-primary" id="addPlayer">${icon("plus")} Novi nalog</button>
      </div></div>
    <div class="toolbar hidden" id="plTraka"><div class="search">${icon("search")}<input id="playerSearch" placeholder="Pretraži igrače..." value="${esc(state.plSearch)}" /></div></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Korisnik</th><th>Nivo</th><th>Kredit</th><th>Status</th><th>Poslednja prijava</th><th></th></tr></thead>
      <tbody id="playerRows"></tbody></table></div><div id="plPager"></div></div>`;
  $("#addPlayer").addEventListener("click", playerModal);
  $("#addGuests").addEventListener("click", guestsModal);
  osveziCiscenjeGostiju();
  let t;
  $("#playerSearch").addEventListener("input", (e) => {
    clearTimeout(t);
    const v = e.target.value.trim();
    t = setTimeout(() => { state.plSearch = v; state.plPage = 1; refreshPlayers(); }, 300);
  });
  refreshPlayers();
}
async function refreshPlayers() {
  let d = { items: [], total: 0, page: 1, pages: 1, per: 25 };
  let pukla = false;
  try { d = await api(`/players?page=${state.plPage}&per=25&search=${encodeURIComponent(state.plSearch)}`); }
  catch (e) { toast(e.message, "error"); pukla = !!e.veza; }
  // Kad podaci NISU stigli, spisak ne sme da kaze "jos nema naloga" - radnik bi
  // pomislio da nalog ne postoji i napravio isti jos jednom.
  if (pukla) {
    $("#plCount").textContent = "podaci nisu učitani";
    // Poruka ide UMESTO tabele, ne u njenu celiju: u celiji je sirina vezana za
    // kolone, pa se na telefonu tekst lomio po jednu rec u redu.
    const kartica = $("#playerRows").closest(".card");
    if (kartica) kartica.innerHTML = `<div class="ucitavanje-palo">${icon("alert")}
      <b>Spisak nije mogao da se učita</b>
      <span>Nema veze sa serverom. Ovo ne znači da naloga nema - pokušaj ponovo kad se veza vrati.</span>
      <button class="btn btn-sm" id="plPonovo">Pokušaj ponovo</button></div>`;
    const dugme = $("#plPonovo");
    if (dugme) dugme.addEventListener("click", () => renderPlayers());
    return;
  }
  state.playersPage = d;
  const rows = d.items.map((p) => `<tr data-prow="${p.id}" style="cursor:pointer">
    <td><b>${esc(p.username)}</b>${p.displayName && p.displayName !== p.username ? `<div class="faint" style="font-size:13px">${esc(p.displayName)}</div>` : ""}</td>
    ${/* Nivo je jedini podatak o vernosti koji program ima: ko je stalan gost
         vidi se odavde, bez otvaranja ijedne strane. */ ""}
    <td class="nivo-c"><span class="nivo-znak">${p.nivo || 1}</span><span class="faint">${esc(p.nivoNaziv || "")}</span></td>
    <td class="mono ${p.balance > 0 ? "pos" : "zero"}">${money(p.balance)}</td>
    <td>${p.banned ? '<span class="pill red">Blokiran</span>' : '<span class="pill green">Aktivan</span>'}</td>
    <td class="mono faint">${p.lastLogin ? timeAgo(p.lastLogin) : "-"}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-sm btn-primary" data-p="topup" data-id="${p.id}">${icon("wallet")} Dopuni</button>
      <button class="btn btn-sm" data-p="edit" data-id="${p.id}">${icon("more")}</button></td></tr>`).join("");
  const tb = $("#playerRows");
  if (tb) tb.innerHTML = rows || (state.plSearch
    ? praznaTabela(5, "search", "Nema rezultata za tu pretragu", `Ni jedan nalog se ne poklapa sa „${esc(state.plSearch)}“. Probaj deo imena ili korisničkog imena.`)
    : praznaTabela(5, "user", "Još nema naloga", "Nalog se pravi dugmetom gore desno. Igrač se tim imenom prijavljuje na svakom računaru."));
  const c = $("#plCount"); if (c) c.textContent = `${d.total} ${oblik(d.total, "nalog", "naloga", "naloga")}`;
  // Polje za pretragu nad praznim spiskom samo zbunjuje - nema sta da se trazi.
  const tr = $("#plTraka"); if (tr) tr.classList.toggle("hidden", !d.total && !state.plSearch);
  const pg = $("#plPager");
  if (pg) { pg.innerHTML = pagerHtml(d); bindPager(pg, d, (p) => { state.plPage = p; refreshPlayers(); }); }
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-p]");
  if (btn) {
    const id = Number(btn.dataset.id);
    const p = (state.playersPage?.items || []).find((x) => x.id === id) || state.players.find((x) => x.id === id);
    if (!p) return;
    if (btn.dataset.p === "topup") topupModal(p); else if (btn.dataset.p === "edit") editPlayerModal(p);
    return;
  }
  // klik bilo gde na red otvara nalog
  const row = e.target.closest("[data-prow]");
  if (row) {
    const p = (state.playersPage?.items || []).find((x) => x.id === Number(row.dataset.prow));
    if (p) editPlayerModal(p);
  }
});
function playerModal() {
  modal("Novi nalog igrača", `
    <div class="form-row">
      <div class="field"><label>Korisničko ime</label><input id="npUser" autofocus /></div>
      <div class="field"><label>Lozinka</label><input id="npPass" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Ime za prikaz (nije obavezno)</label><input id="npName" /></div>
      <div class="field"><label>Početni kredit (${cur()})</label><input id="npBal" type="number" value="0" /></div>
    </div>
    <div class="field"><label>Napomena (vidi samo osoblje)</label><input id="npNote" placeholder="npr. broj telefona, ko je doveo..." /></div>
    <div class="err-msg" id="npErr"></div>
    <button class="btn btn-primary btn-block" id="npSave">Kreiraj nalog</button>`, (root, close) => {
    $("#npSave", root).addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
      try { await api("/players", "POST", { username: $("#npUser", root).value, password: $("#npPass", root).value, displayName: $("#npName", root).value, balance: $("#npBal", root).value, note: $("#npNote", root).value }); toast("Nalog je kreiran", "success"); close(); renderPlayers(); }
      catch (err) { $("#npErr", root).textContent = err.message; }
    }, "Pravim nalog..."));
  });
}
// Nalozi za goste koji nemaju svoj. Rezultat ostaje otvoren dok ga radnik ne
// zatvori - lozinke se posle ne mogu videti nigde, mora da ih izdiktira sad.
function guestsModal() {
  modal("Brzi gost", `
    <div class="muted">Otvara naloge <b>gost-01</b>, <b>gost-02</b>... sa četvorocifrenom lozinkom koju izdiktiraš gostima.</div>
    <div class="form-row">
      <div class="field"><label>Koliko naloga</label><input id="gbCount" type="number" value="1" min="1" max="10" autofocus /></div>
      <div class="field"><label>Kredit po nalogu (${cur()})</label><input id="gbBal" type="number" value="0" /></div>
    </div>
    <div class="quick-amts">${[100, 200, 300, 500].map((v) => `<button class="btn btn-sm" data-gq="${v}">${v}</button>`).join("")}</div>
    ${satiChips()}
    <div class="err-msg" id="gbErr"></div>
    <button class="btn btn-primary btn-block" id="gbSave">Otvori naloge</button>`, (root, close) => {
    $$("[data-gq]", root).forEach((b) => b.addEventListener("click", () => { $("#gbBal", root).value = Number(b.dataset.gq); }));
    $$("[data-sati]", root).forEach((b) => b.addEventListener("click", () => { $("#gbBal", root).value = Math.round(Number(b.dataset.sati) * ratePerHour()); }));
    // Dupli klik je ovde skuplji nego drugde: napravio bi DVA seta naloga, oba
    // sa kreditom, a lozinke prvog seta se posle ne mogu videti nigde - one se
    // pokazuju samo jednom, u prozoru koji drugi set prepiše.
    $("#gbSave", root).addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
      const count = Number($("#gbCount", root).value);
      if (!count || count < 1) { $("#gbErr", root).textContent = "Unesi bar jedan nalog"; return; }
      try {
        const r = await api("/players/guests", "POST", { count, balance: $("#gbBal", root).value });
        close();
        prikaziGoste(r.players);
        renderPlayers();
      } catch (err) { $("#gbErr", root).textContent = err.message; }
    }, "Otvaram naloge..."));
  });
}

// Dugme za čišćenje se pokazuje samo kad stvarno ima šta da se obriše, da ne
// stoji prazno na strani kod igraonice koja goste ne koristi.
async function osveziCiscenjeGostiju() {
  const b = $("#cleanGuests");
  if (!b || !isOwner()) return;
  let spremni = [];
  try { spremni = await api("/players/guests/spremni"); } catch { return; }
  if (!$("#cleanGuests")) return; // radnik je u međuvremenu otišao na drugu stranu
  if (!spremni.length) return $("#cleanGuests").classList.add("hidden");
  const dugme = $("#cleanGuests");
  dugme.innerHTML = `${icon("trash")} Očisti goste (${spremni.length})`;
  dugme.classList.remove("hidden");
  dugme.onclick = async () => {
    const n = spremni.length;
    const imena = spremni.slice(0, 6).map((g) => g.username).join(", ") + (n > 6 ? "..." : "");
    const ok = await confirmDialog(
      `${n === 1 ? "Trajno se briše" : "Trajno se brišu"} ${n} ${oblik(n, "gostujući nalog", "gostujuća naloga", "gostujućih naloga")} bez kredita: ${imena}. Redovni igrači se ne diraju.`,
      { title: "Čišćenje gostiju", ok: "Obriši", danger: true }
    );
    if (!ok) return;
    try {
      const r = await api("/players/guests/ocisti", "POST");
      toast(`${oblik(r.obrisano, "Obrisan", "Obrisana", "Obrisano")} ${r.obrisano} ${oblik(r.obrisano, "nalog", "naloga", "naloga")}`, "success");
      renderPlayers();
    } catch (e) { toast(e.message, "error"); }
  };
}

function prikaziGoste(igraci) {
  const redovi = igraci.map((p) => `<tr>
    <td class="mono"><b>${esc(p.username)}</b></td>
    <td class="mono lozinka">${esc(p.password)}</td>
    <td class="mono">${money(p.balance)}</td></tr>`).join("");
  modal(igraci.length === 1 ? "Nalog je otvoren" : `${oblik(igraci.length, "Otvoren", "Otvorena", "Otvoreno")} ${igraci.length} ${oblik(igraci.length, "nalog", "naloga", "naloga")}`, `
    <div class="muted">Izdiktiraj podatke gostima. Lozinke se posle ne mogu pročitati - ako se izgube, postavljaš novu iz naloga igrača.</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Korisničko ime</th><th>Lozinka</th><th>Kredit</th></tr></thead>
      <tbody>${redovi}</tbody></table></div>
    <button class="btn btn-block" id="ggCopy">${icon("copy")} Kopiraj spisak</button>`, (root, close) => {
    $("#ggCopy", root).addEventListener("click", async () => {
      const tekst = igraci.map((p) => `${p.username}  ${p.password}`).join("\n");
      try { await navigator.clipboard.writeText(tekst); toast("Spisak je kopiran", "success"); }
      catch { toast("Kopiranje nije uspelo", "error"); }
    });
  });
}

// Upozorenje da igraču ističe vreme. Namerno OSTAJE na ekranu dok ga radnik ne
// skloni - kratki toast bi promakao dok se radnik bavi kasom ili pićem.
// Klik na "Dopuni" odmah otvara dopunu tog igrača, da ne mora da ga traži.
const isticeAktivna = new Map(); // computerId -> element
function upozoriIstice(m) {
  const lista = $("#isticeLista");
  if (!lista) return;

  const staro = isticeAktivna.get(m.computerId);
  if (staro) staro.remove();

  const hitno = m.preostalo <= 60;
  const el = document.createElement("div");
  el.className = "istice-kartica" + (hitno ? " hitno" : "");
  el.innerHTML = `
    <div class="ik-vreme">${m.preostalo >= 60 ? Math.round(m.preostalo / 60) + " min" : m.preostalo + " s"}</div>
    <div class="ik-info">
      <div class="ik-pc">${esc(m.computer)}</div>
      <div class="ik-igrac">${esc(m.player)}</div>
    </div>
    <button class="btn btn-sm btn-primary" data-ik="dopuni">Dopuni</button>
    <button class="btn btn-sm btn-ghost ik-x" data-ik="skloni">${icon("x")}</button>`;

  el.querySelector('[data-ik="skloni"]').addEventListener("click", () => {
    el.remove(); isticeAktivna.delete(m.computerId);
  });
  el.querySelector('[data-ik="dopuni"]').addEventListener("click", async () => {
    el.remove(); isticeAktivna.delete(m.computerId);
    const p = await nadjiIgraca(m.playerId, m.player);
    if (p) topupModal(p); else toast("Nalog nije pronađen", "error");
  });

  lista.appendChild(el);
  isticeAktivna.set(m.computerId, el);
  ding();
  if (hitno) ding();
}

// Kad računar više nije u opasnoj zoni (dopunjen ili odjavljen), skloni upozorenje.
function osveziIstice() {
  for (const [id, el] of isticeAktivna) {
    const c = state.computers.find((x) => x.id === id);
    const rem = c?.session?.remainingSeconds;
    if (!c || !c.player || (rem != null && rem > 600)) { el.remove(); isticeAktivna.delete(id); }
  }
}

// Kontrolna tabla drži samo sažetak igrača uz računar, pun zapis je na strani
// Igrači koja se učitava po stranicama - ako nije u memoriji, dovuci ga.
async function nadjiIgraca(id, username) {
  const p = state.players.find((x) => x.id === id) || (state.playersPage?.items || []).find((x) => x.id === id);
  if (p) return p;
  try {
    const r = await api(`/players?page=1&per=5&search=${encodeURIComponent(username || "")}`);
    return r.items.find((x) => x.id === id) || null;
  } catch { return null; }
}

async function topupModal(p) {
  let mode = "add";
  // Paketi se prodaju baš odavde - radnik otvori dopunu, klikne paket, gotovo.
  let paketi = [];
  try { paketi = (await api("/paketi")).filter((x) => x.available !== 0); } catch {}
  const rph = ratePerHour();
  const paketiHtml = paketi.length ? `
    <div class="paket-red">
      <div class="paket-naslov">Vremenski paketi</div>
      ${paketi.map((pk) => {
        const vredi = rph > 0 ? Math.round(pk.hours * rph) : 0;
        const popust = vredi > pk.price ? `<span class="paket-popust">ušteda ${money(vredi - pk.price)}</span>` : "";
        return `<button class="paket-dugme" data-paket="${pk.id}">
          <span class="paket-ime">${esc(pk.name)}, ${pk.hours}h</span>
          <span class="paket-cena">${money(pk.price)} ${popust}</span></button>`;
      }).join("")}
    </div>` : "";
  modal("Kredit - " + p.username, `
    <div class="muted">Trenutno stanje: <b class="pos">${money(p.balance)}</b></div>
    ${paketiHtml}
    <div class="seg" id="tuMode">
      <button class="active" data-m="add">Dodaj kredit</button>
      <button data-m="sub">Skini kredit</button>
    </div>
    <div class="field"><label>Iznos (${cur()})</label><input id="tuAmt" type="number" autofocus /></div>
    <div class="quick-amts">${[100, 200, 300, 500, 1000].map((v) => `<button class="btn btn-sm" data-quick="${v}">${v}</button>`).join("")}</div>
    ${satiChips()}
    <div class="tu-racun" id="tuRacun"></div>
    <div class="err-msg" id="tuErr"></div>
    <button class="btn btn-primary btn-block" id="tuSave">Dodaj</button>`, (root, close) => {
    // KOLIKO JE TO VREMENA.
    //
    // Gost pruži 700 dinara i pita koliko dobija. Dugmad za sate rade u jednom
    // smeru (sati -> iznos), a radnik najčešće ide obrnuto: ukuca iznos koji je
    // dobio. Bez ovoga mora da računa u glavi, pred gostom i u gužvi.
    const racun = () => {
      const el = $("#tuRacun", root);
      if (!el) return;
      const r = ratePerHour();
      const amt = Number($("#tuAmt", root).value) || 0;
      if (r <= 0) { el.innerHTML = '<span class="faint">Naplata po satu je isključena - kredit se troši samo na piće.</span>'; return; }
      if (!amt) { el.innerHTML = ""; return; }
      const znak = mode === "add" ? 1 : -1;
      const novo = Math.max(0, Math.round((Number(p.balance) + znak * amt) * 100) / 100);
      el.innerHTML = `
        <div class="tur-red"><span>${mode === "add" ? "Dodaje" : "Skida"}</span>
          <b>${dur((amt / r) * 3600)}</b> <span class="faint">igre</span></div>
        <div class="tur-red"><span>Novo stanje</span>
          <b class="pos">${money(novo)}</b> <span class="faint">= ${dur((novo / r) * 3600)}</span></div>`;
    };
    const setMode = (m) => { mode = m; $$("#tuMode button", root).forEach((b) => b.classList.toggle("active", b.dataset.m === m)); $("#tuSave", root).textContent = m === "add" ? "Dodaj" : "Skini"; racun(); };
    $$("#tuMode button", root).forEach((b) => b.addEventListener("click", () => setMode(b.dataset.m)));
    $("#tuAmt", root).addEventListener("input", racun);
    $$("[data-quick]", root).forEach((b) => b.addEventListener("click", () => { $("#tuAmt", root).value = (Number($("#tuAmt", root).value) || 0) + Number(b.dataset.quick); racun(); }));
    // Gost traži "dva sata", ne "240 dinara" - neka panel računa umesto radnika.
    $$("[data-sati]", root).forEach((b) => b.addEventListener("click", () => { $("#tuAmt", root).value = Math.round(Number(b.dataset.sati) * ratePerHour()); racun(); }));
    $$("[data-paket]", root).forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const r = await api(`/players/${p.id}/paket`, "POST", { paketId: Number(b.dataset.paket) });
        toast(`Paket prodat: ${money(r.kredit)} kredita za ${money(r.cena)}`, "success");
        close(); renderPlayers();
      } catch (err) { $("#tuErr", root).textContent = err.message; b.disabled = false; }
    }));
    $("#tuSave", root).addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
      const amt = Number($("#tuAmt", root).value);
      if (!amt || amt <= 0) { $("#tuErr", root).textContent = "Unesi iznos veći od nule"; return; }
      try { await api(`/players/${p.id}/topup`, "POST", { amount: mode === "add" ? amt : -amt }); toast(mode === "add" ? "Kredit je dopunjen" : "Kredit je skinut", "success"); close(); renderPlayers(); }
      catch (err) { $("#tuErr", root).textContent = err.message; }
    }, mode === "add" ? "Dodajem..." : "Skidam..."));
  });
}
async function editPlayerModal(p) {
  let tx = [];
  try { tx = await api(`/players/${p.id}/transactions`); } catch {}
  const txRows = tx.slice(0, 10).map((t) => `<tr><td>${txLabel(t.type)}</td><td class="mono ${t.amount >= 0 ? "pos" : "zero"}">${t.amount >= 0 ? "+" : ""}${money(t.amount)}</td><td class="mono faint">${dt(t.created_at)}</td></tr>`).join("");
  modal("Nalog - " + p.username, `
    <div class="kv-card">
      ${kv("Kredit", `<b class="${p.balance > 0 ? "pos" : "zero"}">${money(p.balance)}</b>`)}
      ${kv("Status", p.banned ? '<span class="pill red">Blokiran</span>' : '<span class="pill green">Aktivan</span>')}
      ${kv("Nalog kreiran", p.createdAt ? dt(p.createdAt) : "-")}
      ${kv("Poslednja prijava", p.lastLogin ? timeAgo(p.lastLogin) : "-")}
    </div>
    <div class="form-row">
      <div class="field"><label>Korisničko ime</label><input id="epUser" value="${esc(p.username)}" /></div>
      <div class="field"><label>Ime za prikaz</label><input id="epName" value="${esc(p.displayName || "")}" /></div>
    </div>
    <div class="field"><label>Napomena (vidi samo osoblje)</label><input id="epNote" value="${esc(p.note || "")}" /></div>
    <div class="err-msg" id="epErr"></div>
    <button class="btn btn-primary btn-block" id="epSave">Sačuvaj izmene</button>
    <div class="field"><label>Reset lozinke</label><div class="btn-row"><input id="epPass" placeholder="Nova lozinka" style="flex:1" /><button class="btn" id="epPassBtn">Reset</button></div></div>
    <div class="btn-row">
      <button class="btn ${p.banned ? "" : "btn-danger"}" id="epBan" style="flex:1">${icon("ban")} ${p.banned ? "Odblokiraj nalog" : "Blokiraj nalog"}</button>
      ${isOwner() ? `<button class="btn btn-danger" id="epDel" style="flex:1">${icon("trash")} Obriši nalog</button>` : ""}
    </div>
    <div><label class="lbl">Poslednje transakcije</label>
      <div class="table-wrap" style="border:1px solid var(--line);border-radius:var(--r)"><table><tbody>${txRows || '<tr><td class="empty" style="padding:24px">Nema transakcija</td></tr>'}</tbody></table></div></div>`, (root, close) => {
    $("#epSave", root).addEventListener("click", async () => {
      try {
        await api(`/players/${p.id}`, "PUT", { username: $("#epUser", root).value, displayName: $("#epName", root).value, note: $("#epNote", root).value });
        toast("Izmene su sačuvane", "success"); close(); renderPlayers();
      } catch (e) { $("#epErr", root).textContent = e.message; }
    });
    $("#epPassBtn", root).addEventListener("click", async () => { try { await api(`/players/${p.id}/password`, "POST", { password: $("#epPass", root).value }); toast("Lozinka je resetovana", "success"); } catch (e) { toast(e.message, "error"); } });
    // BLOKIRANJE PREKIDA SESIJU I GASI IGRU.
    //
    // Nije samo oznaka na nalogu: ako gost trenutno igra, blokiranje mu zatvara
    // sesiju i gasi igru na licu mesta. Do sada je išlo bez ijednog pitanja, a i
    // bez hvatanja greške - kad zahtev padne, radnik ne vidi ništa i misli da je
    // nalog blokiran.
    $("#epBan", root).addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
      const zaRacunarom = !p.banned && state.computers.find((c) => c.player?.id === p.id);
      if (zaRacunarom && !(await confirmDialog(
        `Nalog "${p.username}" biće blokiran i neće moći da se prijavi.`,
        { title: "Blokiranje naloga", ok: "Blokiraj", danger: true,
          istaknuto: `Igrač trenutno igra na ${zaRacunarom.name} - sesija se prekida i igra mu se gasi.` }))) return;
      try {
        await api(`/players/${p.id}/ban`, "POST", { banned: !p.banned });
        toast(p.banned ? "Nalog je odblokiran" : "Nalog je blokiran", "success");
        close(); renderPlayers();
      } catch (e) { $("#epErr", root).textContent = e.message; }
    }, p.banned ? "Odblokiravam..." : "Blokiram..."));
    const del = $("#epDel", root);
    if (del) del.addEventListener("click", async () => {
      const extra = p.balance > 0 ? ` Na nalogu je ostalo ${money(p.balance)} kredita.` : "";
      if (!(await confirmDialog(`Nalog "${p.username}" i njegova istorija sesija i transakcija biće trajno obrisani.${extra}`, { title: "Brisanje naloga", ok: "Obriši nalog", danger: true }))) return;
      try { await api(`/players/${p.id}`, "DELETE"); toast("Nalog je obrisan", "success"); close(); renderPlayers(); }
      catch (e) { toast(e.message, "error"); }
    });
  });
}
const txLabel = (t) => ({ topup: "Dopuna", session: "Sesija", shop: "Shop", refund: "Povraćaj", adjust: "Korekcija", bonus: "Bonus (paket)" }[t] || t);

// Porudžbine
const ORDER_STATUS = { pending: ["Na čekanju", "amber"], preparing: ["Priprema se", "blue"], delivered: ["Dostavljeno", "green"], cancelled: ["Otkazano", "red"] };
async function renderOrders() {
  const tab = state.ordersTab || "active";
  let historyRows = "";
  if (tab === "history") {
    let all = [];
    try { all = await api("/orders?all=1"); } catch {}
    const done = all.filter((o) => o.status === "delivered" || o.status === "cancelled");
    historyRows = done.map((o) => {
      const [lbl, col] = ORDER_STATUS[o.status] || [o.status, "gray"];
      return `<tr>
        <td class="mono faint" style="font-size:13px;white-space:nowrap">${dt(o.createdAt)}</td>
        <td><b>#${o.id}</b></td>
        <td>${o.player ? esc(o.player) : '<span class="faint">keš</span>'}${o.payment === "cash" && o.player ? ' <span class="faint">(keš)</span>' : ""}${o.computer ? ` <span class="faint">${esc(o.computer)}</span>` : ""}</td>
        <td class="muted" style="max-width:340px">${o.items.map((i) => `${i.qty}x ${esc(i.name)}`).join(", ")}</td>
        <td class="mono">${money(o.total)}</td>
        <td><span class="pill ${col}">${lbl}</span></td>
      </tr>`;
    }).join("");
    $("#main").innerHTML = `
      <div class="page-head"><div><h1>Porudžbine</h1><div class="sub">Poslednjih ${done.length} završenih</div></div>
        <div class="head-actions"><div class="filters">
          <button class="chip" data-otab="active">Aktivne</button>
          <button class="chip active" data-otab="history">Istorija</button>
        </div><button class="btn btn-primary" id="goPos">${icon("plus")} Nova porudžbina</button></div></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Vreme</th><th>Br.</th><th>Ko / gde</th><th>Artikli</th><th>Iznos</th><th>Status</th></tr></thead>
        <tbody>${historyRows || praznaTabela(6, "inbox", "Još nema završenih porudžbina",
          "Kad porudžbinu označiš kao dostavljenu ili je otkažeš, seli se ovde.")}</tbody></table></div></div>`;
  } else {
    try { state.orders = await api("/orders"); } catch {}
    updateCounts();
    const active = state.orders.filter((o) => o.status === "pending" || o.status === "preparing");
    const cards = active.map((o) => {
      const [stLbl, stCol] = ORDER_STATUS[o.status] || [o.status, "gray"];
      const items = o.items.map((i) => `<div class="oi"><span class="oi-q">${i.qty}x</span><span class="oi-n">${esc(i.name)}</span><span class="oi-p">${money(i.price * i.qty)}</span></div>`).join("");
      return `
      <div class="order">
        <div class="order-head">
          <span class="order-id">#${o.id}</span>
          <span class="pill ${stCol}">${stLbl}</span>
          <span class="order-ago" data-ago="${o.createdAt}">${timeAgo(o.createdAt)}</span>
        </div>
        <div class="order-who">
          ${o.computer ? `<span class="ow">${icon("monitor")}${esc(o.computer)}</span>` : ""}
          <span class="ow">${o.player ? `${icon("user")}${esc(o.player)}` : `${icon("cash")}Keš`}</span>
          ${o.payment === "cash" && o.player ? `<span class="ow kes">${icon("cash")}keš</span>` : ""}
          ${o.source === "pos" ? `<span class="ow">${icon("wallet")}kasa</span>` : ""}
        </div>
        <div class="order-list">${items}</div>
        ${o.note ? `<div class="order-note">${icon("message")}<span>${esc(o.note)}</span></div>` : ""}
        <div class="order-sum ${o.payment === "cash" ? "kes" : ""}">
          <span>${o.payment === "cash" ? "Naplati keš" : "Skinuto sa naloga"}</span>
          <span>${money(o.total)}</span>
        </div>
        <div class="order-foot">
          ${o.status === "pending" ? `<button class="btn btn-sm" data-o="preparing" data-id="${o.id}">Pripremam</button>` : ""}
          <button class="btn btn-sm btn-primary" data-o="delivered" data-id="${o.id}">${icon("check")} Dostavljeno</button>
          <button class="btn btn-sm btn-ghost oc" data-o="cancelled" data-id="${o.id}" title="Otkaži porudžbinu">${icon("x")}</button>
        </div>
      </div>`;
    }).join("");
    $("#main").innerHTML = `
      <div class="page-head"><div><h1>Porudžbine</h1><div class="sub">${active.length} ${oblik(active.length, "aktivna", "aktivne", "aktivnih")}</div></div>
        <div class="head-actions"><div class="filters">
          <button class="chip active" data-otab="active">Aktivne</button>
          <button class="chip" data-otab="history">Istorija</button>
        </div><button class="btn btn-primary" id="goPos">${icon("plus")} Nova porudžbina</button></div></div>
      <div class="orders-grid">${cards || `
        <div class="empty-page"><div class="empty-inner">${icon("inbox")}
          <div class="e-t">Nema aktivnih porudžbina</div>
          <div class="e-s">Kad igrač poruči iz launchera, porudžbina se pojavi ovde i zvoni. Ručno je kucaš na strani Kasa.</div>
        </div></div>`}</div>`;
  }
  $$("[data-otab]").forEach((b) => b.addEventListener("click", () => { state.ordersTab = b.dataset.otab; renderOrders(); }));
  $("#goPos").addEventListener("click", openOrderModal);
}
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-o]");
  if (!btn) return;
  // OTKAZIVANJE PITA, OSTALO NE.
  //
  // Dugme "×" stoji tik uz "Dostavljeno", a radi nešto sasvim drugo: vraća
  // gostu novac na nalog, izbacuje račun iz pazara i vraća piće na stanje. Jedan
  // promašen klik na porudžbini koja je uredno doneta znači da je gost dobio i
  // piće i novac nazad, a da manjak ispliva tek pri obračunu smene.
  if (btn.dataset.o === "cancelled") {
    const o = (state.orders || []).find((x) => String(x.id) === String(btn.dataset.id));
    const novac = o
      ? (o.payment === "cash" ? `Račun od ${money(o.total)} izlazi iz pazara.` : `${money(o.total)} se vraća gostu na nalog.`)
      : null;
    const ok = await confirmDialog(
      `Porudžbina #${btn.dataset.id} će biti otkazana. Piće se vraća na stanje.`,
      { title: "Otkazivanje porudžbine", ok: "Otkaži porudžbinu", danger: true, istaknuto: novac });
    if (!ok) return;
  }
  try { await api(`/orders/${btn.dataset.id}/status`, "POST", { status: btn.dataset.o }); renderOrders(); } catch (err) { toast(err.message, "error"); }
});

// Pretraga naloga igrača (umesto liste svih iz baze)
function playerComboHtml(sel) {
  if (sel) {
    return `<div class="combo-sel">${icon("user")}<b>${esc(sel.username)}</b>
      <span class="${sel.balance > 0 ? "pos" : "zero"}" style="margin-left:auto;font-size:13px">${money(sel.balance)}</span>
      <button type="button" class="btn btn-ghost ic-btn" data-combo-clear title="Promeni igrača">${icon("x")}</button></div>`;
  }
  return `<div class="combo">${icon("search")}<input data-combo-input placeholder="Ukucaj korisničko ime..." autocomplete="off" /><div class="combo-list hidden" data-combo-list></div></div>`;
}
function mountPlayerCombo(root, players, onPick) {
  const clear = root.querySelector("[data-combo-clear]");
  if (clear) { clear.addEventListener("click", () => onPick(null)); return; }
  const input = root.querySelector("[data-combo-input]");
  const list = root.querySelector("[data-combo-list]");
  if (!input || !list) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.classList.add("hidden"); list.innerHTML = ""; return; }
    const m = players.filter((p) => p.username.toLowerCase().includes(q) || (p.displayName || "").toLowerCase().includes(q)).slice(0, 6);
    list.innerHTML = m.length
      ? m.map((p) => `<button type="button" data-pick="${p.id}"><b>${esc(p.username)}</b>${p.displayName && p.displayName !== p.username ? `<span class="faint">${esc(p.displayName)}</span>` : ""}<span class="${p.balance > 0 ? "pos" : "zero"}">${money(p.balance)}</span></button>`).join("")
      : `<div class="combo-none">Nema naloga koji sadrži "${esc(input.value.trim())}"</div>`;
    list.classList.remove("hidden");
    $$("[data-pick]", list).forEach((b) => b.addEventListener("click", () => onPick(players.find((p) => p.id === Number(b.dataset.pick)) || null)));
  });
}

// Kasa (pos)
async function renderPos() {
  try { state.shop = await api("/shop"); if (!state.players.length) state.players = await api("/players"); } catch {}
  const avail = state.shop.filter((i) => i.available);
  // Jedan spisak i traka kategorija iznad njega. Ranije je svaka kategorija
  // imala svoj red plocica, pa su se "Energetsko" i "Vode" delile istu traku i
  // radnik je pred gostom trazio po ekranu ono sto staje u jedan red.
  const kategorije = [...new Set(avail.map((i) => i.category).filter(Boolean))];
  const izabrana = kategorije.includes(state.posFilter) ? state.posFilter : null;
  const vidljivi = izabrana ? avail.filter((i) => i.category === izabrana) : avail;
  const cip = (ime, kljuc, n) =>
    `<button class="pos-cip ${(kljuc || null) === izabrana ? "aktivan" : ""}" data-pos-kat="${esc(kljuc || "")}">${esc(ime)}<span>${n}</span></button>`;
  const traka = kategorije.length > 1
    ? `<div class="pos-filter">${cip("Sve", "", avail.length)}${kategorije
        .map((k) => cip(k, k, avail.filter((i) => i.category === k).length)).join("")}</div>`
    : "";

  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Kasa</h1><div class="sub">Ručno kucanje porudžbine za igrača ili keš</div></div></div>
    <div class="pos-layout">
      <div class="pos-grid">${avail.length
        ? `${traka}<div class="pos-stavke">${vidljivi.map((i) => posItemHtml(i)).join("")}</div>`
        : `<div class="empty" style="width:100%">${icon("bag")}<div class="e-t">Nema artikala za prodaju</div><div class="e-s">Dodaj piće i grickalice na strani Shop, pa se ovde pojave za kucanje.</div></div>`}</div>
      <div class="cart"><div class="cart-head">Račun</div><div id="cartBody"></div></div>
    </div>`;
  $$("[data-pos]").forEach((b) => b.addEventListener("click", () => {
    const id = Number(b.dataset.pos);
    state.posCart.set(id, (state.posCart.get(id) || 0) + 1);
    renderCart();
    osveziPosPlocicu(id);
  }));
  $$("[data-pos-kat]").forEach((b) => b.addEventListener("click", () => {
    state.posFilter = b.dataset.posKat || null;
    renderPos();
  }));
  renderCart();
}

// Radnik kuca račun dok gost stoji pred njim. Slika se prepoznaje brže od
// imena, a "Coca-Cola" i "Coca-Cola Zero" se po tekstu lako promaše.
// korpa/atribut se razlikuju izmedju strane Kasa i pop-up porudžbine, sve ostalo je isto
function posItemHtml(i, korpa = state.posCart, atribut = "pos") {
  const uRacunu = korpa.get(i.id) || 0;
  const nema = i.stock === 0;
  const malo = i.stock != null && i.stock > 0 && i.stock <= 5;
  return `<button class="pos-item ${uRacunu ? "u-racunu" : ""} ${nema ? "nema" : ""}" data-${atribut}="${i.id}" ${nema ? "disabled" : ""}>
    <span class="pi-slika">${i.image
      ? `<img src="${esc(i.image)}" alt="" draggable="false" />`
      : `<span class="pi-mono">${monogram(i.name)}</span>`}</span>
    <span class="pi-tekst">
      <span class="n">${esc(i.name)}</span>
      <span class="p">${money(i.price)}</span>
    </span>
    ${uRacunu ? `<span class="pi-broj">${uRacunu}</span>` : ""}
    ${nema ? '<span class="pi-nema">nema</span>' : malo ? `<span class="pi-malo">${i.stock}</span>` : ""}
  </button>`;
}

function osveziPosPlocicu(id) {
  const stara = document.querySelector(`[data-pos="${id}"]`);
  const it = state.shop.find((x) => x.id === id);
  if (!stara || !it) return;
  const pom = document.createElement("div");
  pom.innerHTML = posItemHtml(it);
  const nova = pom.firstElementChild;
  nova.addEventListener("click", () => {
    state.posCart.set(id, (state.posCart.get(id) || 0) + 1);
    renderCart();
    osveziPosPlocicu(id);
  });
  stara.replaceWith(nova);
}
function renderCart() {
  const box = $("#cartBody");
  if (!box) return;
  if (!state.posCart.size) { box.innerHTML = `<div class="cart-empty">${icon("cash")}<div>Klikni artikal levo da uđe u račun</div></div>`; return; }
  let rows = "", total = 0;
  for (const [id, qty] of state.posCart) {
    const it = state.shop.find((x) => x.id === id); if (!it) continue;
    total += it.price * qty;
    rows += `<div class="cart-row"><span class="nm">${esc(it.name)}</span>
      <span class="qty"><button data-cq="dec" data-id="${id}">−</button><b>${qty}</b><button data-cq="inc" data-id="${id}">+</button></span>
      <span class="pr">${money(it.price * qty)}</span></div>`;
  }
  const players = state.players.filter((p) => !p.banned);
  const sel = state.posPlayerId ? players.find((p) => p.id === state.posPlayerId) || null : null;
  box.innerHTML = `
    <div class="cart-list">${rows}</div>
    <div class="cart-foot">
      <div class="seg">
        <button class="${state.posPayment === "cash" ? "active" : ""}" data-pay="cash">Keš</button>
        <button class="${state.posPayment === "credit" ? "active" : ""}" data-pay="credit">Sa naloga</button>
      </div>
      ${state.posPayment === "credit" ? `<div class="field" style="margin-bottom:12px"><label>Nalog igrača</label><div id="posCombo">${playerComboHtml(sel)}</div>
        ${sel && sel.balance < total ? `<div class="warn-line">Nedovoljno kredita na nalogu za ovaj račun</div>` : ""}</div>` : ""}
      <div class="cart-total"><span>Ukupno</span><span>${money(total)}</span></div>
      <button class="btn btn-primary btn-block" id="posSubmit">Naplati</button>
      <button class="btn btn-ghost btn-block" id="posClear" style="margin-top:6px">Poništi račun</button>
    </div>`;
  $$("[data-cq]").forEach((b) => b.addEventListener("click", () => {
    const id = Number(b.dataset.id);
    const q = (state.posCart.get(id) || 0) + (b.dataset.cq === "inc" ? 1 : -1);
    if (q <= 0) state.posCart.delete(id); else state.posCart.set(id, q);
    state.posId = null; // promenjen racun = druga naplata, pa i nov broj pokusaja
    renderCart();
    osveziPosPlocicu(id);
  }));
  $$("[data-pay]").forEach((b) => b.addEventListener("click", () => {
    state.posPayment = b.dataset.pay;
    if (state.posPayment === "cash") state.posPlayerId = null;
    renderCart();
  }));
  const combo = $("#posCombo");
  if (combo) mountPlayerCombo(combo, players, (p) => { state.posPlayerId = p ? p.id : null; renderCart(); });
  $("#posClear").addEventListener("click", () => { const bili = [...state.posCart.keys()]; state.posCart.clear(); state.posPlayerId = null; state.posId = null; renderCart(); bili.forEach(osveziPosPlocicu); });
  $("#posSubmit").addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
    const items = [...state.posCart].map(([id, qty]) => ({ id, qty }));
    if (!items.length) return;
    if (state.posPayment === "credit" && !state.posPlayerId) { toast("Ukucaj i izaberi nalog igrača", "error"); return; }
    // BROJ POKUŠAJA - isti dok se račun ne promeni.
    //
    // Zaključano dugme sprečava da se klikne dvaput. Ali ono ima rok: posle
    // osam sekundi bez odgovora se otključava, da radnik ne ostane zarobljen kad
    // server zaćuti. U tom procepu drugi klik bi prošao kao NOV račun i naplatio
    // dvaput. Server po ovom broju prepozna isti pokušaj i vrati stari odgovor.
    if (!state.posId) state.posId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const r = await api("/pos", "POST", { items, playerId: state.posPayment === "credit" ? state.posPlayerId : null, payment: state.posPayment, poId: state.posId });
      toast(`Porudžbina #${r.orderId} - ${money(r.total)}`, "success");
      const bili = [...state.posCart.keys()];
      state.posCart.clear(); state.posPlayerId = null; state.posId = null; renderCart();
      try { state.shop = await api("/shop"); } catch {} // zaliha se promenila
      bili.forEach(osveziPosPlocicu);
    } catch (e) { toast(e.message, "error"); }
  }, "Naplaćujem..."));
}

// Porudžbina u pop-upu
async function openOrderModal() {
  try { if (!state.shop.length) state.shop = await api("/shop"); if (!state.players.length) state.players = await api("/players"); } catch {}
  const cart = new Map();
  let payment = "cash";
  const cats = {};
  state.shop.filter((i) => i.available).forEach((i) => (cats[i.category] ||= []).push(i));
  let grid = "";
  for (const [c, items] of Object.entries(cats)) {
    grid += `<div class="pos-cat">${esc(c)}</div>`;
    grid += items.map((i) => posItemHtml(i, cart, "add")).join("");
  }
  modal("Nova porudžbina", `<div class="om-grid">
      <div class="om-products">${grid || '<div class="faint">Nema artikala. Dodaj ih u Shop.</div>'}</div>
      <div class="om-side" id="omSide"></div></div>`, (root, close) => {
    const players = state.players.filter((p) => !p.banned);
    let selPlayer = null;
    function renderSide() {
      let rows = "", total = 0;
      for (const [id, qty] of cart) {
        const it = state.shop.find((x) => x.id === id); if (!it) continue;
        total += it.price * qty;
        rows += `<div class="cart-row"><span class="nm">${esc(it.name)}</span><span class="qty"><button data-cq="dec" data-id="${id}">−</button><b>${qty}</b><button data-cq="inc" data-id="${id}">+</button></span><span class="pr">${money(it.price * qty)}</span></div>`;
      }
      $("#omSide", root).innerHTML = `
        <div class="cart-list">${rows || '<div class="cart-empty">Klikni artikle levo</div>'}</div>
        <div class="cart-foot">
          <div class="seg"><button class="${payment === "cash" ? "active" : ""}" data-pay="cash">Keš</button><button class="${payment === "credit" ? "active" : ""}" data-pay="credit">Sa naloga</button></div>
          ${payment === "credit" ? `<div class="field" style="margin-bottom:12px"><label>Nalog igrača</label><div id="omCombo">${playerComboHtml(selPlayer)}</div>
            ${selPlayer && selPlayer.balance < total ? `<div class="warn-line">Nedovoljno kredita na nalogu za ovaj račun</div>` : ""}</div>` : ""}
          <div class="cart-total"><span>Ukupno</span><span>${money(total)}</span></div>
          <button class="btn btn-primary btn-block" id="omSubmit">Naplati</button></div>`;
      $$("[data-cq]", root).forEach((b) => b.addEventListener("click", () => { const id = Number(b.dataset.id); const q = (cart.get(id) || 0) + (b.dataset.cq === "inc" ? 1 : -1); if (q <= 0) cart.delete(id); else cart.set(id, q); renderSide(); osveziPlocicu(id); }));
      $$("[data-pay]", root).forEach((b) => b.addEventListener("click", () => { payment = b.dataset.pay; if (payment === "cash") selPlayer = null; renderSide(); }));
      const combo = $("#omCombo", root);
      if (combo) mountPlayerCombo(combo, players, (p) => { selPlayer = p; renderSide(); });
      $("#omSubmit", root).addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
        const items = [...cart].map(([id, qty]) => ({ id, qty }));
        if (!items.length) { toast("Dodaj bar jedan artikal", "error"); return; }
        if (payment === "credit" && !selPlayer) { toast("Ukucaj i izaberi nalog igrača", "error"); return; }
        try { const r = await api("/pos", "POST", { items, playerId: payment === "credit" ? selPlayer.id : null, payment }); toast(`Porudžbina #${r.orderId} - ${money(r.total)}`, "success"); close(); if (state.view === "orders") renderOrders(); }
        catch (e) { toast(e.message, "error"); }
      }, "Naplaćujem..."));
    }
    // Pločice u modalu pokazuju koliko je čega već na računu, pa se preiscrtavaju
    // zajedno sa desnom stranom.
    function osveziPlocicu(id) {
      const stara = $(`[data-add="${id}"]`, root);
      const it = state.shop.find((x) => x.id === id);
      if (!stara || !it) return;
      const pom = document.createElement("div");
      pom.innerHTML = posItemHtml(it, cart, "add");
      const nova = pom.firstElementChild;
      nova.addEventListener("click", () => dodaj(id));
      stara.replaceWith(nova);
    }
    function dodaj(id) { cart.set(id, (cart.get(id) || 0) + 1); renderSide(); osveziPlocicu(id); }
    $$("[data-add]", root).forEach((b) => b.addEventListener("click", () => dodaj(Number(b.dataset.add))));
    renderSide();
  }, true);
}

// Shop
async function renderShop() {
  const items = await api("/shop");
  window._shop = items;
  const cats = {};
  items.forEach((i) => (cats[i.category] ||= []).push(i));
  const card = (i) => {
    // "Zaliha: bez limita" se lomilo na dva reda pored dugmeta Dopuni.
    const stockHtml = i.stock == null
      ? '<span class="prod-stock inf">Neograničeno</span>'
      : (i.stock === 0 ? '<span class="prod-stock out">Rasprodato</span>' : `<span class="prod-stock ${i.stock <= 5 ? "low" : ""}">Zaliha: ${i.stock}</span>`);
    return `<div class="prod-card ${i.available ? "" : "off"}">
    <div class="prod-media">${i.image ? `<img src="${esc(i.image)}" alt="${esc(i.name)}" />` : `<span class="ph">${monogram(i.name)}</span>`}${i.available ? "" : '<span class="prod-hidden">Skriveno</span>'}</div>
    <div class="prod-info">
      <div class="prod-name">${esc(i.name)}</div>
      <div class="prod-row">${stockHtml}<span class="prod-price">${money(i.price)}</span></div>
      <div class="prod-row"><button class="btn btn-sm btn-block" data-shop="restock" data-id="${i.id}">${icon("plus")} Dopuni zalihu</button></div>
    </div>
    <div class="prod-foot">
      <button class="btn btn-sm btn-ghost" data-shop="edit" data-id="${i.id}">${icon("edit")} Izmeni</button>
      <button class="btn btn-sm btn-ghost" data-shop="toggle" data-id="${i.id}" title="${i.available ? "Sakrij iz launchera" : "Prikaži u launcheru"}">${icon(i.available ? "eye" : "eyeoff")}</button>
      <button class="btn btn-sm btn-ghost del" data-shop="del" data-id="${i.id}">${icon("trash")}</button>
    </div></div>`;
  };
  // Jedan spisak i traka kategorija iznad njega. Ranije je svaka kategorija
  // imala svoj red kartica, pa su se dve kategorije delile istu traku a treca
  // padala ispod - izgledalo je kao da su kartice nabacane gde je bilo mesta.
  const kategorije = Object.keys(cats).filter(Boolean);
  const izabrana = kategorije.includes(state.shopFilter) ? state.shopFilter : null;
  const vidljivi = izabrana ? items.filter((i) => i.category === izabrana) : items;
  const cip = (ime, kljuc, n) =>
    `<button class="pos-cip ${(kljuc || null) === izabrana ? "aktivan" : ""}" data-shop-kat="${esc(kljuc || "")}">${esc(ime)}<span>${n}</span></button>`;
  const traka = kategorije.length > 1
    ? `<div class="pos-filter">${cip("Sve", "", items.length)}${kategorije
        .map((k) => cip(k, k, cats[k].length)).join("")}</div>`
    : "";

  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Shop</h1><div class="sub">${items.length} ${oblik(items.length, "artikal", "artikla", "artikala")}</div></div>
      <button class="btn btn-primary" id="addShop">${icon("plus")} Novi artikal</button></div>
    ${items.length ? `${traka}<div class="prod-grid">${vidljivi.map(card).join("")}</div>` : `<div class="empty">${icon("bag")}
      <div class="e-t">Shop je prazan</div>
      <div class="e-s">Dodaj piće i grickalice dugmetom gore desno - odmah se pojave igračima u launcheru i tebi na Kasi.</div></div>`}`;
  $("#addShop").addEventListener("click", () => shopModal());
  $$("[data-shop-kat]").forEach((b) => b.addEventListener("click", () => {
    state.shopFilter = b.dataset.shopKat || null;
    renderShop();
  }));
}
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-shop]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const item = (window._shop || []).find((x) => x.id === id);
  if (btn.dataset.shop === "edit") shopModal(item);
  else if (btn.dataset.shop === "toggle" && item) {
    try {
      await api(`/shop/${id}`, "PUT", { name: item.name, category: item.category, price: item.price, emoji: item.emoji, available: !item.available, stock: item.stock == null ? "" : item.stock });
      toast(item.available ? "Artikal je sakriven iz launchera" : "Artikal je ponovo vidljiv", "success");
      renderShop();
    } catch (err) { toast(err.message, "error"); }
  }
  else if (btn.dataset.shop === "restock" && item) {
    const v = await promptDialog("Dopuni zalihu - " + item.name, { text: `Trenutno: ${item.stock == null ? "bez limita" : item.stock}. Koliko komada dodati?`, placeholder: "npr. 24", ok: "Dopuni" });
    if (v == null) return;
    const add = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
    if (!add) return;
    try { const r = await api(`/shop/${id}/stock`, "POST", { add }); toast(`Zaliha dopunjena - sada ${r.stock}`, "success"); renderShop(); }
    catch (err) { toast(err.message, "error"); }
  }
  else if (btn.dataset.shop === "del") {
    if (await confirmDialog("Artikal će biti trajno obrisan.", { title: "Brisanje artikla", ok: "Obriši", danger: true })) {
      try { await api(`/shop/${id}`, "DELETE"); renderShop(); } catch (err) { toast(err.message, "error"); }
    }
  }
});
function shopModal(item) {
  const it = item || { name: "", category: "Pića", price: "", emoji: "", available: 1, image: null };
  let picked = null, removeImg = false;
  modal(item ? "Izmena artikla" : "Novi artikal", `
    <div style="display:flex;gap:16px;align-items:flex-start">
      <div class="img-picker">
        <div class="img-preview" id="imgPrev">${it.image ? `<img src="${esc(it.image)}" />` : monogram(it.name)}</div>
        <button class="btn btn-sm btn-block" id="imgBtn" type="button">Izaberi sliku</button>
        ${it.image ? `<button class="btn btn-sm btn-ghost btn-block" id="imgRem" type="button">Ukloni</button>` : ""}
        <input type="file" id="imgFile" accept="image/*" hidden />
      </div>
      <div style="flex:1;display:grid;gap:13px">
        <div class="field"><label>Naziv</label><input id="siName" value="${esc(it.name)}" autofocus /></div>
        <div class="form-row">
          <div class="field"><label>Cena (${cur()})</label><input id="siPrice" type="number" value="${it.price}" /></div>
          <div class="field"><label>Kategorija</label><input id="siCat" list="siCatLista" value="${esc(it.category)}" />${ponudaKategorija(state.shop, "siCatLista")}</div></div>
        <div class="field"><label>Stanje (zaliha)</label><input id="siStock" type="number" value="${it.stock == null ? "" : it.stock}" placeholder="prazno = neograniceno" /></div>
      </div>
    </div>
    <label class="cbx"><input type="checkbox" id="siAvail" ${it.available ? "checked" : ""}><span class="box"></span> <span style="font-size:14px">Dostupno igračima u launcheru</span></label>
    <div class="err-msg" id="siErr"></div>
    <button class="btn btn-primary btn-block" id="siSave">Sačuvaj</button>`, (root, close) => {
    const fi = $("#imgFile", root);
    $("#imgBtn", root).addEventListener("click", () => fi.click());
    fi.addEventListener("change", () => {
      const f = fi.files[0]; if (!f) return;
      if (f.size > 3 * 1024 * 1024) { $("#siErr", root).textContent = "Slika je prevelika (najviše 3 MB)"; return; }
      const rd = new FileReader();
      rd.onload = () => { picked = rd.result; removeImg = false; $("#imgPrev", root).innerHTML = `<img src="${picked}" />`; };
      rd.readAsDataURL(f);
    });
    const rem = $("#imgRem", root);
    if (rem) rem.addEventListener("click", () => { removeImg = true; picked = null; $("#imgPrev", root).innerHTML = monogram(it.name); });
    $("#siSave", root).addEventListener("click", async () => {
      const body = { name: $("#siName", root).value, category: $("#siCat", root).value, price: $("#siPrice", root).value, emoji: it.emoji || "", available: $("#siAvail", root).checked, stock: $("#siStock", root).value };
      try {
        let id = item?.id;
        if (item) await api(`/shop/${item.id}`, "PUT", body); else { const r = await api("/shop", "POST", body); id = r.id; }
        if (picked) await api(`/shop/${id}/image`, "POST", { image: picked });
        else if (removeImg) await api(`/shop/${id}/image`, "DELETE");
        toast("Sačuvano", "success"); close(); renderShop();
      } catch (e) { $("#siErr", root).textContent = e.message; }
    });
  });
}

// Igre
// Podsetnik sa dimenzijama, i koliko igara jos ceka sliku. Stoji samo dok
// stvarno nesto fali - kad je sve okaceno, traka nestaje.
// Traka javlja SAMO ono što stvarno fali. Omot je obavezan - bez njega je
// kartica u polici prazna. Baner je izborni: on je rezervna pozadina ekrana
// prijave, a prijava već ima svoju pozadinu, pa igra bez banera nije problem i
// ne sme da stoji kao upozorenje.
function trakaSlika(games) {
  const bezOmota = games.filter((g) => !g.image).length;
  const bezBanera = games.filter((g) => !g.banner).length;
  if (!bezOmota) return "";
  const dugmeBaner = bezBanera
    ? `<button class="btn btn-sm" id="banneriAuto">${icon("image")} Napravi privremene banere (${bezBanera})</button>`
    : "";
  return `<div class="slike-traka">
    <div class="st-red">${icon("image")} <b>${bezOmota}</b> ${oblik(bezOmota, "igra nema omot", "igre nemaju omot", "igara nema omot")}</div>
    <div class="st-mere">
      <span><b>Omot</b> 600 x 800 px (3:4) - kartica u polici igara</span>
      <span><b>Baner</b> 2800 x 400 px (7:1) - izborno, rezervna pozadina ekrana prijave</span>
    </div>
    ${dugmeBaner}
  </div>`;
}

async function renderGames() {
  const games = await api("/games");
  window._games = games;
  const cats = {};
  games.forEach((g) => (cats[g.category || "Igre"] ||= []).push(g));
  // Vlasnik mora na jedan pogled da vidi kojoj igri fali slika, inace bi morao
  // da otvara svaku posebno da bi proverio.
  const card = (g) => `<div class="game-card ${g.available === 0 ? "off" : ""}">
    <div class="game-emoji omot">${g.image ? `<img src="${esc(g.image)}" alt="" />` : monogram(g.name)}</div>
    <div class="game-info">
      <div class="game-top">
        <div class="game-name">${esc(g.name)}${g.available === 0 ? ' <span class="pill gray">Skriveno</span>' : ""}</div>
        <div class="game-acts">
          <button class="btn btn-sm btn-ghost" data-game="edit" data-id="${g.id}" title="Izmeni">${icon("edit")}</button>
          <button class="btn btn-sm btn-ghost" data-game="toggle" data-id="${g.id}" title="${g.available === 0 ? "Prikaži u launcheru" : "Sakrij iz launchera"}">${icon(g.available === 0 ? "eyeoff" : "eye")}</button>
          <button class="btn btn-sm btn-ghost del" data-game="del" data-id="${g.id}" title="Obriši">${icon("trash")}</button>
        </div>
      </div>
      <div class="game-path" title="${esc(g.path)}">${esc(g.path)}</div>
      ${g.args ? `<div class="game-path">argumenti: ${esc(g.args)}</div>` : ""}
      <div class="slike-stanje">
        <span class="ss ${g.image ? "ima" : "fali"}" title="Omot 600x800 - kartica u polici igara">${g.image ? icon("check") : icon("alert")} omot</span>
        <button class="ss ss-akcija ${g.banner ? "ima" : "izborno"}" data-game="baner" data-id="${g.id}"
          title="${g.banner ? "Klikni da napraviš novi privremeni baner" : "Široka slika (2800x400) - izborna, rezervna pozadina ekrana prijave. Klikni da napraviš privremenu."}">${g.banner ? icon("check") : icon("image")} baner</button>
      </div>
    </div></div>`;
  // Naslov kategorije se pise samo kad ih ima vise od jedne. Kad su sve igre u
  // podrazumevanoj kategoriji, iznad spiska je stajalo "IGRE" - a strana se vec
  // zove "Igre", pa je isti podatak pisao dva puta jedan ispod drugog.
  const viseKategorija = Object.keys(cats).length > 1;
  const groups = Object.entries(cats).map(([cat, list]) =>
    `${viseKategorija ? `<div class="kat-naslov">${esc(cat)}</div>` : ""}<div class="game-grid">${list.map(card).join("")}</div>`
  ).join("");
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Igre</h1><div class="sub">${games.length} ${oblik(games.length, "igra", "igre", "igara")} u launcheru</div></div>
      <button class="btn btn-primary" id="addGame">${icon("plus")} Nova igra</button></div>
    ${trakaSlika(games)}
    ${groups || `<div class="empty">${icon("inbox")}<div>Još nema dodatih igara.<br>Dodaj prečice do .exe fajlova ili internet adresa.</div></div>`}`;
  $("#addGame").addEventListener("click", () => gameModal());
  const bAuto = $("#banneriAuto");
  if (bAuto) bAuto.addEventListener("click", async () => {
    bAuto.disabled = true;
    try {
      const r = await api("/games/banneri-auto", "POST");
      toast(`Napravljeno ${r.koliko} ${oblik(r.koliko, "privremeni baner", "privremena banera", "privremenih banera")}`, "success");
      renderGames();
    } catch (e) { toast(e.message, "error"); bAuto.disabled = false; }
  });
}
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-game]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const it = (window._games || []).find((x) => x.id === id);
  if (btn.dataset.game === "edit") gameModal(it);
  else if (btn.dataset.game === "toggle" && it) {
    const nowVisible = it.available !== 0;
    try {
      await api(`/games/${id}`, "PUT", { name: it.name, path: it.path, args: it.args, emoji: it.emoji, category: it.category, available: !nowVisible });
      toast(nowVisible ? "Igra je sakrivena iz launchera" : "Igra je ponovo vidljiva", "success");
      renderGames();
    } catch (err) { toast(err.message, "error"); }
  }
  else if (btn.dataset.game === "baner") {
    btn.disabled = true;
    try {
      await api(`/games/${id}/banner-auto`, "POST");
      toast("Privremeni baner je napravljen", "success");
      renderGames();
    } catch (err) { toast(err.message, "error"); btn.disabled = false; }
  }
  else if (btn.dataset.game === "del") {
    if (await confirmDialog("Igra će biti uklonjena iz launchera.", { title: "Brisanje igre", ok: "Obriši", danger: true })) {
      try { await api(`/games/${id}`, "DELETE"); renderGames(); } catch (err) { toast(err.message, "error"); }
    }
  }
});
// KATEGORIJA SE NUDI, NE PAMTI SE NAPAMET
//
// Polje ostaje polje za kucanje - niko ne zna unapred šta će igraonica prodavati.
// Ali čovek koji u utorak upiše "Piće" u četvrtak upiše "Pića", pa u launcheru
// stoje dve police za istu stvar, obe sa po tri artikla. Ispod polja stoji ono
// što već postoji, pa je lakše kliknuti nego se setiti kako je bilo napisano.
//
// Server uz to sam poklapa iste reči koje se razlikuju samo po velikom slovu,
// razmaku ili kvačici (vidi `uskladiKategoriju` u service.js) - to je ono što
// se sa sigurnošću zna da je ista stvar.
function ponudaKategorija(spisak, id) {
  const kat = [...new Set((spisak || []).map((x) => String(x.category || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "sr-Latn-RS"));
  if (!kat.length) return "";
  return `<datalist id="${id}">${kat.map((k) => `<option value="${esc(k)}"></option>`).join("")}</datalist>`;
}

function gameModal(game) {
  const g = game || { name: "", path: "", args: "", emoji: "", category: "Igre", image: null, banner: null };
  let picked = null, removeImg = false;      // cover (3:4)
  let bPicked = null, bRemove = false;        // baner (16:5, za vrh launchera)
  modal(game ? "Izmena igre" : "Nova igra", `
    <div style="display:flex;gap:16px;align-items:flex-start">
      <div class="img-picker">
        <div class="img-preview" id="giPrev">${g.image ? `<img src="${esc(g.image)}" />` : monogram(g.name)}</div>
        <button class="btn btn-sm btn-block" id="giImgBtn" type="button">Omot</button>
        <div class="mera">600 x 800 px</div>
        ${g.image ? `<button class="btn btn-sm btn-ghost btn-block" id="giImgRem" type="button">Ukloni</button>` : ""}
        <input type="file" id="giFile" accept="image/*" hidden />
      </div>
      <div style="flex:1;display:grid;gap:13px">
        <div class="field"><label>Naziv</label><input id="giName" value="${esc(g.name)}" autofocus /></div>
        <div class="form-row">
          <div class="field"><label>Kategorija</label><input id="giCat" list="giCatLista" value="${esc(g.category)}" />${ponudaKategorija(window._games, "giCatLista")}</div></div>
      </div>
    </div>
    <div class="field"><label>Putanja do .exe ili internet adresa</label><input id="giPath" value="${esc(g.path)}" placeholder="C:\\Games\\igra.exe" /></div>
    <div class="field"><label>Argumenti (nije obavezno)</label><input id="giArgs" value="${esc(g.args)}" /></div>
    <label class="cbx"><input type="checkbox" id="giAvail" ${g.available === 0 ? "" : "checked"}><span class="box"></span> <span style="font-size:14px">Prikaži igru u launcheru (igrači je vide)</span></label>
    <div class="field">
      <label>Baner igre <span class="mera-uz">2800 x 400 px (7:1)</span></label>
      <div class="banner-picker">
        <div class="banner-preview" id="giBanPrev">${g.banner ? `<img src="${esc(g.banner)}" />` : '<span class="faint">Široka slika koja stoji iza forme za prijavu, ako na strani "Izgled launchera" nije okačena posebna pozadina prijave.</span>'}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" id="giBanBtn" type="button">Postavi baner</button>
          ${g.banner ? `<button class="btn btn-sm btn-ghost" id="giBanRem" type="button">Ukloni baner</button>` : ""}
        </div>
        <input type="file" id="giBanFile" accept="image/*" hidden />
      </div>
    </div>
    <div class="err-msg" id="giErr"></div>
    <button class="btn btn-primary btn-block" id="giSave">Sačuvaj</button>`, (root, close) => {
    const fi = $("#giFile", root);
    $("#giImgBtn", root).addEventListener("click", () => fi.click());
    fi.addEventListener("change", () => {
      const f = fi.files[0]; if (!f) return;
      if (f.size > 3 * 1024 * 1024) { $("#giErr", root).textContent = "Cover je prevelik (najviše 3 MB)"; return; }
      const rd = new FileReader();
      rd.onload = () => { picked = rd.result; removeImg = false; $("#giPrev", root).innerHTML = `<img src="${picked}" />`; };
      rd.readAsDataURL(f);
    });
    const rem = $("#giImgRem", root);
    if (rem) rem.addEventListener("click", () => { removeImg = true; picked = null; $("#giPrev", root).innerHTML = monogram(g.name); });
    // baner
    const bfi = $("#giBanFile", root);
    $("#giBanBtn", root).addEventListener("click", () => bfi.click());
    bfi.addEventListener("change", () => {
      const f = bfi.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { $("#giErr", root).textContent = "Baner je prevelik (najviše 5 MB)"; return; }
      const rd = new FileReader();
      rd.onload = () => { bPicked = rd.result; bRemove = false; $("#giBanPrev", root).innerHTML = `<img src="${bPicked}" />`; };
      rd.readAsDataURL(f);
    });
    const brem = $("#giBanRem", root);
    if (brem) brem.addEventListener("click", () => { bRemove = true; bPicked = null; $("#giBanPrev", root).innerHTML = '<span class="faint">nema banera - koristi se cover ili boja</span>'; });
    $("#giSave", root).addEventListener("click", async () => {
      const body = { name: $("#giName", root).value, path: $("#giPath", root).value, args: $("#giArgs", root).value, emoji: g.emoji || "", category: $("#giCat", root).value, available: $("#giAvail", root).checked };
      try {
        let id = game?.id;
        if (game) await api(`/games/${game.id}`, "PUT", body);
        else { const r = await api("/games", "POST", body); id = r.id; }
        if (picked) await api(`/games/${id}/image`, "POST", { image: picked });
        else if (removeImg) await api(`/games/${id}/image`, "DELETE");
        if (bPicked) await api(`/games/${id}/banner`, "POST", { image: bPicked });
        else if (bRemove) await api(`/games/${id}/banner`, "DELETE");
        toast("Sačuvano", "success"); close(); renderGames();
      } catch (e) { $("#giErr", root).textContent = e.message; }
    });
  });
}

// INTERNET ALATI (prečice u launcheru)
// Pozadine ekrana u launcheru. Slike se kace ovde, ne u folder launchera -
// jednom okacena slika odmah ide na sve računare, bez reinstalacije.
const POZADINE_OPIS = {
  prijava: {
    naslov: "Ekran za prijavu",
    opis: "Stoji ceo dan dok je računar slobodan. Ovo gost prvo vidi kad sedne, pa najviše vredi uložiti u ovu sliku.",
    zona: "Forma za prijavu je u sredini, oko 400x420 px. Drži sredinu mirnu, jaki detalji neka budu levo i desno.",
  },
  pocetna: {
    naslov: "Početna",
    opis: "Iza hero banera, police igara i reda sa alatima.",
    zona: "Ceo ekran je pokriven sadržajem. Bira se mirna, tamnija slika - tekstura, apstrakcija ili prigušen enterijer.",
  },
  shop: {
    naslov: "Shop",
    opis: "Iza kartica pića i korpe.",
    zona: "Kartice pokrivaju levu trećinu do dve trećine, korpa desnu. Slika se vidi u razmacima.",
  },
  nalog: {
    naslov: "Nalog",
    opis: "Strana sa podacima igrača, porudžbinama i promenom lozinke.",
    zona: "Sadržaj je u gornjoj polovini. Donja polovina slike se najbolje vidi.",
  },
  zakljucan: {
    naslov: "Zaključan ekran",
    opis: "Kad igraču istekne vreme ili osoblje zaključa računar.",
    zona: "Katanac i poruka su u sredini. Neka slika bude tamnija i mirnija, ovde igrač čita tekst.",
  },
};

// Spisak promo banera se osvežava sam, bez ponovnog crtanja cele strane -
// inače bi se pri svakom kliku gubio položaj skrola.
async function ucitajPromo() {
  const box = $("#promoSpisak");
  if (!box) return;
  let lista = [];
  try { lista = await api("/promo"); } catch { }
  if (!$("#promoSpisak")) return;
  if (!lista.length) {
    box.innerHTML = `<div class="empty" style="padding:22px">${icon("image")}<div>Još nema promo banera.<br>Dok ih nema, u traci na vrhu početne stoji znak igraonice.</div></div>`;
    return;
  }
  box.innerHTML = `<div class="promo-lista">${lista.map((p, i) => `
    <div class="promo-red ${p.available ? "" : "skriven"}">
      <div class="promo-slika"><img src="${esc(p.image)}" alt="" /></div>
      <div class="promo-info">
        <div class="promo-naziv">${esc(p.naziv || "Baner " + (i + 1))}${p.available ? "" : ' <span class="pill gray">Skriven</span>'}</div>
        <div class="promo-mesto">${i + 1}. po redu</div>
      </div>
      <div class="promo-akcije">
        <button class="btn btn-sm btn-ghost" data-promo="gore" data-id="${p.id}" title="Pomeri gore" ${i === 0 ? "disabled" : ""}>${icon("chevUp")}</button>
        <button class="btn btn-sm btn-ghost" data-promo="dole" data-id="${p.id}" title="Pomeri dole" ${i === lista.length - 1 ? "disabled" : ""}>${icon("chevDown")}</button>
        <button class="btn btn-sm btn-ghost" data-promo="vidljivost" data-id="${p.id}" data-v="${p.available ? 0 : 1}" title="${p.available ? "Sakrij iz launchera" : "Prikaži u launcheru"}">${icon(p.available ? "eye" : "eyeoff")}</button>
        <button class="btn btn-sm btn-ghost del" data-promo="brisi" data-id="${p.id}" title="Obriši">${icon("trash")}</button>
      </div>
    </div>`).join("")}</div>`;
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-promo]");
  if (!b || b.disabled) return;
  const id = Number(b.dataset.id);
  try {
    if (b.dataset.promo === "gore" || b.dataset.promo === "dole") {
      await api(`/promo/${id}/pomeri`, "POST", { smer: b.dataset.promo });
    } else if (b.dataset.promo === "vidljivost") {
      await api(`/promo/${id}/vidljivost`, "POST", { vidljiv: b.dataset.v === "1" });
    } else if (b.dataset.promo === "brisi") {
      if (!(await confirmDialog("Promo baner će biti trajno obrisan.", { title: "Brisanje banera", ok: "Obriši", danger: true }))) return;
      await api(`/promo/${id}`, "DELETE");
      toast("Baner je obrisan", "success");
    }
    ucitajPromo();
  } catch (err) { toast(err.message, "error"); }
});

// ZNAK I BOJA IGRAONICE
//
// Program se izdaje jedan, a svaka igraonica ima svoje ime, znak i boju. Dok su
// logo i boja stajali ušiveni u fajlove, druga igraonica je morala da dobije
// prepravljenu kopiju - pa bi i svaka nadogradnja morala da se pravi posebno.
//
// Izbor boje je bio polje za heks i sistemski birač. To radi, ali traži da
// vlasnik ZNA koja boja valja, a nema kako da zna: boja mora da se čita na
// tamnoj podlozi, da nosi belo slovo na dugmetu i da se ne pomeša sa bojama
// koje ovde nešto znače. Zato sada ide spisak gotovih, proba pre primene i
// upozorenje kad izabrana boja upadne u tuđe značenje.
let bkBrend = null;      // poslednje što je server rekao
let bkIzbor = null;      // boja koja se PROBA (još nije primenjena)
let bkSvoja = false;     // je li otvoreno polje za svoju boju
let bkZamerke = [];
let bkTajmer = null;

async function ucitajBrend() {
  const telo = $("#brendTelo");
  if (!telo) return;
  let b;
  try { b = await api("/brend"); } catch { telo.innerHTML = '<div class="faint">Nije učitano</div>'; return; }
  if (!$("#brendTelo")) return;
  // Proba se resetuje na ono što je stvarno primenjeno. Da ostane od prošlog
  // puta, vlasnik bi se vratio na stranicu i video boju koju nikad nije potvrdio.
  bkBrend = b;
  bkIzbor = b.akcenat;
  bkZamerke = [];

  telo.innerHTML = `
    <div class="poz-uputstvo" style="margin-bottom:16px">
      <div><b>Znak</b><span>PNG sa providnošću</span><i>Stoji na prijavi, u bočnoj traci panela i na svim ekranima launchera. Najbolje radi širi nego viši, oko 600x200 px. Najviše 3 MB.</i></div>
      <div><b>Boja</b><span>jedna, ostalo se izvodi</span><i>Iz nje se prave svetlija i tamnija nijansa za dugmad i okvire. Zelena, zlatna i crvena se ne diraju - one znače "ima kredita", "nagrada" i "ističe vreme", to su značenja a ne ukras.</i></div>
    </div>
    <div class="brend-red">
      <div class="brend-logo-box">
        ${b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.naziv || "")}" />` : `<span class="poz-prazno">${icon("image")} ugrađeni znak</span>`}
      </div>
      <div class="brend-akcije">
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hidden" id="brendFile" />
        <button class="btn btn-primary" id="brendOkaci">${icon("image")} ${b.logo ? "Zameni znak" : "Okači znak"}</button>
        ${b.logo ? `<button class="btn btn-danger" id="brendSkini">${icon("trash")} Vrati ugrađeni</button>` : ""}
      </div>
    </div>
    <div class="card-sub" style="margin:18px -18px 0">Boja igraonice</div>
    <div id="bkTelo"></div>`;

  crtajBoju();
  osveziProveru(true);
  vezeZnak();
}

// Crta se samo deo sa bojom, ne cela kartica - da izbor boje ne prerisava i
// znak iznad njega (pa da polje za fajl izgubi vezu).
function crtajBoju() {
  const cilj = $("#bkTelo");
  if (!cilj || !bkBrend) return;
  cilj.innerHTML = bkHtml(bkBrend);
  vezeBoju();
}

function zamerkeHtml(z) {
  if (!z || !z.length) return "";
  return z.map((x) => `<div class="bk-zamerka">${icon("alert")}<span>${esc(x.tekst)}</span></div>`).join("") +
    // Poslednja rečenica je namerna: vlasnik odlučuje kako mu izgleda igraonica.
    // Bez nje upozorenje liči na kvar, pa se ljudi vrte u krug tražeći "ispravnu" boju.
    `<div class="bk-zamerka-pod">Boja se ipak može primeniti - ovo je upozorenje, ne zabrana.</div>`;
}

function bkHtml(b) {
  const izabrana = bkIzbor;
  const drugacija = String(izabrana).toLowerCase() !== String(b.akcenat).toLowerCase();
  const uzorci = (b.gotove || []).map((g) => `
    <button class="bk-uzorak${g.heks.toLowerCase() === String(izabrana).toLowerCase() ? " aktivna" : ""}" type="button"
      data-bk="${esc(g.heks)}" style="--bk:${esc(g.heks)}" title="${esc(g.heks)}">
      <span class="bk-krug"></span><span class="bk-ime">${esc(g.naziv)}</span>
    </button>`).join("");

  return `
    <div class="bk-proba" id="bkProba" style="--accent:${esc(izabrana)}">
      <div class="bk-proba-vrh">
        <span class="bk-proba-tab aktivna">Početna</span>
        <span class="bk-proba-tab">Shop</span>
        <span class="bk-proba-tab">Nalog</span>
        <span class="bk-proba-kredit">640 RSD</span>
      </div>
      <div class="bk-proba-telo">
        <span class="bk-proba-dugme">Poruči</span>
        <span class="bk-proba-traka"><i></i></span>
        <span class="bk-proba-vip">${icon("gift")} VIP</span>
        <span class="bk-proba-kraj">${icon("clock")} 12 min</span>
      </div>
      <div class="bk-proba-nota">Ovako to vidi igrač. Zelena, zlatna i crvena su ovde namerno - da se vidi da li im se boja kuće približila.</div>
    </div>

    <div class="bk-uzorci">${uzorci}</div>

    <button class="bk-svoja-x" id="bkSvojaX" type="button" aria-expanded="${bkSvoja ? "true" : "false"}">
      ${icon(bkSvoja ? "chevUp" : "chevDown")} Svoja boja
    </button>
    ${bkSvoja ? `
      <div class="bk-svoja">
        <input type="color" id="bkBiras" value="${esc(izabrana)}" aria-label="Izbor boje" />
        <input id="bkHeks" value="${esc(izabrana)}" maxlength="7" spellcheck="false" aria-label="Boja u heks obliku" />
        <span class="faint">ako imaš tačnu boju iz svog znaka</span>
      </div>` : ""}

    <div class="bk-zamerke" id="bkZamerke">${zamerkeHtml(bkZamerke)}</div>

    <div class="bk-akcije">
      <button class="btn btn-primary" id="bkPrimeni"${drugacija ? "" : " disabled"}>
        ${drugacija ? "Primeni na sve računare" : "Ovo je trenutna boja"}
      </button>
      ${String(b.akcenat).toLowerCase() !== String(b.fabricki).toLowerCase()
        ? `<button class="btn btn-ghost" id="bkFabricka">Vrati fabričku</button>` : ""}
      <span class="faint bk-nap">Boja se menja na svih ${state.computers.length || "13"} računara odjednom, čim se primeni.</span>
    </div>
    <div class="err-msg" id="brendErr"></div>`;
}

function vezeBoju() {
  $$("#bkTelo [data-bk]").forEach((el) => el.addEventListener("click", () => postaviProbu(el.dataset.bk)));

  const x = $("#bkSvojaX");
  if (x) x.addEventListener("click", () => { bkSvoja = !bkSvoja; crtajBoju(); if (bkSvoja) $("#bkHeks")?.focus(); });

  const biras = $("#bkBiras"), heks = $("#bkHeks");
  if (biras) biras.addEventListener("input", () => {
    if (heks) heks.value = biras.value.toLowerCase();
    postaviProbu(biras.value, true);
  });
  if (heks) heks.addEventListener("input", () => {
    // Dok vlasnik kuca, vrednost je pola gotova ("#2f6"). Proba se ne pomera dok
    // ne postane cela boja - inače bi treperila na svaki otkucaj.
    const v = heks.value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(v)) return;
    // Birač mora da prati upisano. Dok nije, pokazivao je staru boju pored nove
    // - pa je izgledalo kao da polje i birač govore o dve različite stvari.
    if (biras) biras.value = v;
    postaviProbu(v, true);
  });

  const primeni = $("#bkPrimeni");
  if (primeni) primeni.addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
    try {
      const r = await api("/brend/boja", "POST", { akcenat: bkIzbor });
      primeniBrend(r);
      bkBrend = { ...bkBrend, ...r };
      toast("Boja je primenjena na sve računare", "success");
      crtajBoju();
    } catch (e) { const el = $("#brendErr"); if (el) el.textContent = e.message; }
  }, "Primenjujem..."));

  const fab = $("#bkFabricka");
  // Fabrička boja stiže sa servera. Dok ju je panel držao kao svoju kopiju, ovo
  // dugme je vraćalo staru boju i pošto je fabrička promenjena.
  if (fab) fab.addEventListener("click", () => postaviProbu(bkBrend.fabricki));
}

// Proba se menja ODMAH, ali se ne čuva. Primena ide na svih trinaest mašina
// odjednom, pa vlasnik prvo mora da vidi šta bira.
function postaviProbu(heks, uzivo) {
  const v = String(heks || "").trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(v)) return;
  bkIzbor = v;
  if (uzivo) {
    // Vučenje po biraču boje poziva ovo na svaki pomeraj miša. Prerisati celo
    // polje značilo bi da birač u tom trenutku izgubi fokus, pa se menjaju samo
    // proba, dugme i oznaka izabranog uzorka.
    obeleziProbu();
  } else {
    crtajBoju();
  }
  osveziProveru();
}

function obeleziProbu() {
  const proba = $("#bkProba");
  if (proba) proba.style.setProperty("--accent", bkIzbor);
  const dug = $("#bkPrimeni");
  if (dug) {
    const drugacija = bkIzbor !== String(bkBrend?.akcenat).toLowerCase();
    dug.disabled = !drugacija;
    dug.textContent = drugacija ? "Primeni na sve računare" : "Ovo je trenutna boja";
  }
  $$("#bkTelo [data-bk]").forEach((el) => el.classList.toggle("aktivna", el.dataset.bk.toLowerCase() === bkIzbor));
}

// Zamerke i izvedene nijanse računa SERVER - isto ono što će dobiti launcher.
// Da panel računa svoje, proba bi pokazivala jednu boju a mašine drugu.
// Pitanje se odlaže da vučenje po biraču ne pošalje stotinu zahteva.
function osveziProveru(odmah) {
  clearTimeout(bkTajmer);
  const trazi = async () => {
    const za = bkIzbor;
    let r;
    try { r = await api(`/brend/provera?heks=${encodeURIComponent(za)}`); } catch { return; }
    if (za !== bkIzbor) return;   // vlasnik je u međuvremenu izabrao drugu
    bkZamerke = r.zamerke || [];
    const okvir = $("#bkZamerke");
    if (okvir) okvir.innerHTML = zamerkeHtml(bkZamerke);
    const proba = $("#bkProba");
    if (proba && r.nijanse) {
      for (const [ime, vred] of Object.entries({
        "--accent": r.nijanse.akcenat, "--accent-hover": r.nijanse.hover,
        "--accent-down": r.nijanse.down, "--accent-soft": r.nijanse.soft, "--accent-line": r.nijanse.line,
      })) proba.style.setProperty(ime, vred);
    }
  };
  if (odmah) trazi(); else bkTajmer = setTimeout(trazi, 200);
}

function vezeZnak() {
  $("#brendOkaci").addEventListener("click", () => $("#brendFile").click());
  $("#brendFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const čitač = new FileReader();
    čitač.onload = async () => {
      try { const r = await api("/brend/logo", "POST", { image: čitač.result }); primeniBrend(r); toast("Znak je postavljen", "success"); ucitajBrend(); }
      catch (err) { const el = $("#brendErr"); if (el) el.textContent = err.message; }
    };
    čitač.readAsDataURL(f);
    e.target.value = "";
  });
  const skini = $("#brendSkini");
  if (skini) skini.addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
    if (!(await confirmDialog("Vraća se ugrađeni znak programa.", { title: "Uklanjanje znaka", ok: "Vrati ugrađeni" }))) return;
    try { const r = await api("/brend/logo", "DELETE"); primeniBrend(r); toast("Vraćen ugrađeni znak", "success"); ucitajBrend(); }
    catch (e) { const el = $("#brendErr"); if (el) el.textContent = e.message; }
  }, "Uklanjam..."));
}

async function renderIzgled() {
  let podaci = { spisak: {}, slike: {} };
  try { podaci = await api("/pozadine"); } catch (e) { toast(e.message, "error"); }
  // Sare i prozirnosti stizu sa servera, iste one koje dobija launcher - pregled
  // ovde zato ne moze da pokaze nesto drugo od onoga sto igrac vidi.
  let tex = { spisak: {}, jacine: {}, prozirnosti: {}, izbor: { kljuc: "nema", jacina: "srednje" } };
  try { tex = await api("/tekstura"); } catch (e) { toast(e.message, "error"); }
  const vid = tex.prozirnosti[tex.izbor.jacina] ?? 0.75;

  const kartica = (kljuc) => {
    const o = POZADINE_OPIS[kljuc] || { naslov: kljuc, opis: "", zona: "" };
    const slika = podaci.slike[kljuc];
    return `<div class="poz-kartica">
      <div class="poz-slika ${slika ? "ima" : ""}">
        ${slika ? `<img src="${esc(slika)}" alt="" />` : `<span class="poz-prazno">${icon("image")} nema slike</span>`}
      </div>
      <div class="poz-telo">
        <div class="poz-naslov">${esc(o.naslov)}</div>
        <div class="poz-opis">${esc(o.opis)}</div>
        <div class="poz-zona">${icon("info")} ${esc(o.zona)}</div>
        <div class="poz-akcije">
          <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-poz-file="${kljuc}" />
          <button class="btn btn-sm btn-primary" data-poz-pick="${kljuc}">${icon("plus")} ${slika ? "Zameni sliku" : "Postavi sliku"}</button>
          ${slika ? `<button class="btn btn-sm btn-ghost" data-poz-del="${kljuc}">${icon("trash")} Ukloni</button>` : ""}
        </div>
      </div>
    </div>`;
  };

  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Izgled launchera</h1><div class="sub">Pozadine ekrana koje igrači vide</div></div></div>

    <!-- Uputstvo se cita jednom, a stajalo je otvoreno na vrhu strane i guralo
         sve sto se stvarno menja za 181px nize. Sada je skupljeno, jedan klik. -->
    <details class="card poz-pomoc" style="margin-bottom:18px">
      <summary><h2>Kako se pripremaju slike</h2><span>dimenzija, format, svetlina</span>${icon("chevDown")}</summary>
      <div class="card-body">
        <div class="poz-uputstvo">
          <div><b>Dimenzija</b><span>2560 x 1440 px (16:9)</span><i>Pokriva i 1920x1080 i 1366x768 bez mutnjenja. Manje od 1920x1080 nemoj koristiti.</i></div>
          <div><b>Format</b><span>JPG ili WEBP</span><i>PNG samo ako slika ima providnost. Najviše 8 MB po slici.</i></div>
          <div><b>Svetlina</b><span>Tamnija slika</span><i>Preko svake slike ide tamni sloj da tekst ostane čitljiv, ali svetla slika i dalje pravi problem.</i></div>
          <div><b>Detalji</b><span>Mirna sredina</span><i>Sitni detalji i tekst na slici se gube ispod sadržaja. Najbolje rade teksture, gradijenti i prigušene fotografije.</i></div>
        </div>
      </div>
    </details>

    <div class="card" style="margin-bottom:18px" id="kartaBrend">
      <div class="card-head"><h2>Znak i boja igraonice</h2>
        <span class="faint" style="font-size:12px">menja se svuda odjednom</span></div>
      <div class="card-body" id="brendTelo"><div class="faint">učitavam...</div></div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <h2>Promo baneri</h2>
        <div class="head-actions">
          <button class="btn btn-sm" id="promoCrit">${icon("image")} Napravi baner sa imenom</button>
          <button class="btn btn-sm btn-primary" id="promoDodaj">${icon("plus")} Novi baner</button>
        </div>
      </div>
      <div class="card-body">
        <div class="poz-uputstvo" style="margin-bottom:16px">
          <div><b>Dimenzija</b><span>2200 x 200 px (11:1)</span><i>Stoji u traci na vrhu početne, levo od nagradnog točka. Baner se uklapa u traku i nikad se ne seče, pa i drugi odnos radi - samo ostanu tamne ivice.</i></div>
          <div><b>Smena</b><span>na 8 sekundi</span><i>Kad ima više banera, smenjuju se sami. Jedan baner stoji stalno.</i></div>
          <div><b>Tekst</b><span>na samoj slici</span><i>Launcher ne crta ništa preko banera, pa sve što treba da piše mora da bude na slici.</i></div>
        </div>
        <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" id="promoFile" />
        <div id="promoSpisak"><div class="empty" style="padding:18px">učitavam...</div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <h2>Tekstura pozadine</h2>
        <div class="tex-jacina">
          <span class="tex-grupa">Jačina</span>
          ${Object.entries(tex.jacine).map(([k, n]) =>
            `<button class="btn btn-sm ${k === tex.izbor.jacina ? "btn-primary" : "btn-ghost"}" data-tex-jacina="${k}">${esc(n)}</button>`).join("")}
          <span class="tex-grupa">Kretanje</span>
          ${Object.entries(tex.kretanja || {}).map(([k, o]) =>
            `<button class="btn btn-sm ${k === tex.izbor.kretanje ? "btn-primary" : "btn-ghost"}" data-tex-kretanje="${k}" title="${esc(o.opis)}">${esc(o.naziv)}</button>`).join("")}
        </div>
      </div>
      <div class="card-body">
        <div class="tex-nota">${icon("info")} Sitna šara koja se ponavlja preko celog ekrana, iznad okačene pozadine. Menja se odmah na svim računarima, bez restarta.</div>
        <div class="tex-mreza">
          ${Object.entries(tex.spisak).map(([k, o]) => `
            <button class="tex-kartica ${k === tex.izbor.kljuc ? "izabrana" : ""}" data-tex="${k}">
              <span class="tex-uzorak" data-sara="${k}">
                ${k === "nema" ? '<i class="tex-nista">bez šare</i>' : ""}
              </span>
              <span class="tex-ime">${esc(o.naziv)}</span>
              <span class="tex-opis">${esc(o.opis)}</span>
            </button>`).join("")}
        </div>
      </div>
    </div>

    <div class="poz-mreza">${Object.keys(POZADINE_OPIS).map(kartica).join("")}</div>`;

  // Sara sadrzi navodnike, pa ne sme kroz style="..." atribut - tu bi se string
  // prekinuo na prvom navodniku i uzorak bi ostao prazan.
  $$("[data-sara]").forEach((el) => {
    const o = tex.spisak[el.dataset.sara];
    if (!o || !o.sara) return;
    el.style.backgroundImage = o.sara;
    el.style.opacity = String(vid);
  });

  // Menja se jedno polje, ostala ostaju kakva jesu.
  const snimiTeksturu = async (izmena) => {
    try {
      await api("/tekstura", "POST", {
        kljuc: tex.izbor.kljuc, jacina: tex.izbor.jacina, kretanje: tex.izbor.kretanje, ...izmena,
      });
      renderIzgled();
    } catch (e) { toast(e.message, "error"); }
  };
  $$("[data-tex]").forEach((b) => b.addEventListener("click", () => snimiTeksturu({ kljuc: b.dataset.tex })));
  $$("[data-tex-jacina]").forEach((b) => b.addEventListener("click", () => snimiTeksturu({ jacina: b.dataset.texJacina })));
  $$("[data-tex-kretanje]").forEach((b) => b.addEventListener("click", () => snimiTeksturu({ kretanje: b.dataset.texKretanje })));

  $("#promoDodaj").addEventListener("click", () => $("#promoFile").click());
  $("#promoCrit").addEventListener("click", async (e) => {
    e.target.closest("button").disabled = true;
    try { await api("/promo/crit", "POST"); toast(`Baner "${state.settings.cafeName}" je napravljen`, "success"); ucitajPromo(); }
    catch (err) { toast(err.message, "error"); e.target.closest("button").disabled = false; }
  });
  $("#promoFile").addEventListener("change", async () => {
    const f = $("#promoFile").files[0]; if (!f) return;
    if (f.size > 8 * 1024 * 1024) return toast("Slika je prevelika (najviše 8 MB)", "error");
    const rd = new FileReader();
    rd.onload = async () => {
      try { await api("/promo", "POST", { image: rd.result, naziv: f.name.replace(/\.[^.]+$/, "") }); toast("Promo baner je dodat", "success"); ucitajPromo(); }
      catch (e) { toast(e.message, "error"); }
    };
    rd.readAsDataURL(f);
    $("#promoFile").value = "";
  });
  ucitajPromo();
  ucitajBrend();

  $$("[data-poz-pick]").forEach((b) => b.addEventListener("click", () => {
    $(`[data-poz-file="${b.dataset.pozPick}"]`).click();
  }));
  $$("[data-poz-file]").forEach((fi) => fi.addEventListener("change", async () => {
    const f = fi.files[0]; if (!f) return;
    if (f.size > 8 * 1024 * 1024) return toast("Slika je prevelika (najviše 8 MB)", "error");
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        await api(`/pozadine/${fi.dataset.pozFile}`, "POST", { image: rd.result });
        toast("Pozadina je postavljena", "success");
        renderIzgled();
      } catch (e) { toast(e.message, "error"); }
    };
    rd.readAsDataURL(f);
  }));
  $$("[data-poz-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmDialog("Pozadina ovog ekrana biće uklonjena.", { title: "Uklanjanje pozadine", ok: "Ukloni", danger: true }))) return;
    try { await api(`/pozadine/${b.dataset.pozDel}`, "DELETE"); toast("Pozadina je uklonjena", "success"); renderIzgled(); }
    catch (e) { toast(e.message, "error"); }
  }));
}

// Ovi alati imaju ugradjen logo u launcheru, njima cover slika nije potrebna.
// Spisak mora da prati BRANDS u client/renderer/js/launcher.js.
const ALATI_SA_LOGOM = ["steam", "epic games", "battle.net", "youtube", "discord", "teamspeak", "google", "spotify", "twitch", "faceit"];
// Isto pravilo kao u launcheru: razmaci, tacke i crtice se ne broje, pa
// "Team Speak" i "Battlenet" pogadjaju "teamspeak" i "battle.net".
const kljucBrenda = (ime) => String(ime || "").toLowerCase().replace(/[\s._-]/g, "");
const SET_LOGOA = new Set(ALATI_SA_LOGOM.map(kljucBrenda));
// Isto pravilo kao u launcheru: prvo tacno ime, pa pocetak imena - da "Faceit AC"
// i "Discord PTB" pogode svoj brend. Duzi kljucevi idu prvi.
const KLJUCEVI_LOGOA = [...SET_LOGOA].sort((a, b) => b.length - a.length);
const imaUgradjenLogo = (ime) => {
  const k = kljucBrenda(ime);
  return !!k && (SET_LOGOA.has(k) || KLJUCEVI_LOGOA.some((b) => k.startsWith(b)));
};

// Prečica na program vadi PRAVU ikonu iz .exe fajla, pa joj slika ne treba -
// launcher pokaže isti logo koji Windows pokazuje za taj program. Bez ovoga bi
// panel javljao da fali slika i za alate koji je već imaju.
// Isto pravilo kao u launcheru: prečica bez nastavka ("C:\games\cs2" a na
// disku "cs2.lnk") i dalje daje ikonu, jer je launcher sam pronađe.
const samSeSnalazi = (t) => t.kind === "app" && !!String(t.target || "").trim()
  && !/^[a-z][a-z0-9+.-]*:\/\//i.test(String(t.target || "").trim());
const trebaSlika = (t) => !t.image && !imaUgradjenLogo(t.name) && !samSeSnalazi(t);

function trakaAlata(tools) {
  const bez = tools.filter(trebaSlika).length;
  if (!bez) return "";
  return `<div class="slike-traka">
    <div class="st-red">${icon("image")} <b>${bez}</b> ${oblik(bez, "prečica prikazuje samo slovo", "prečice prikazuju samo slovo", "prečica prikazuje samo slovo")}</div>
    <div class="st-mere">
      <span><b>Slika</b> 256 x 256 px (1:1) - logo na providnoj podlozi</span>
      <span>Prečica na .exe sama uzima ikonu programa. Steam, Epic, Battle.net, YouTube, Twitch, Discord, TeamSpeak, FACEIT, Google i Spotify imaju ugrađen logo</span>
    </div>
  </div>`;
}

async function renderTools() {
  const tools = await api("/tools");
  window._tools = tools;
  const kindLabel = (t) => t.kind === "app" ? '<span class="pill blue">Program</span>' : '<span class="pill green">Sajt</span>';
  const card = (t) => `<div class="game-card ${t.available === 0 ? "off" : ""}">
    <div class="game-emoji">${t.image ? `<img src="${esc(t.image)}" alt="" />` : (t.name || "?").trim().charAt(0).toUpperCase()}</div>
    <div class="game-info">
      <div class="game-top">
        <div class="game-name">${esc(t.name)} ${kindLabel(t)}${t.available === 0 ? ' <span class="pill gray">Skriveno</span>' : ""}</div>
        <div class="game-acts">
          <button class="btn btn-sm btn-ghost" data-tool="edit" data-id="${t.id}" title="Izmeni">${icon("edit")}</button>
          <button class="btn btn-sm btn-ghost" data-tool="toggle" data-id="${t.id}" title="${t.available === 0 ? "Prikaži u launcheru" : "Sakrij iz launchera"}">${icon(t.available === 0 ? "eyeoff" : "eye")}</button>
          <button class="btn btn-sm btn-ghost del" data-tool="del" data-id="${t.id}" title="Obriši">${icon("trash")}</button>
        </div>
      </div>
      <div class="game-path" title="${esc(t.target)}">${esc(t.target)}</div>
      ${t.args ? `<div class="game-path">argumenti: ${esc(t.args)}</div>` : ""}
      <div class="slike-stanje">
        ${t.image
          ? `<span class="ss ima" title="Sopstvena slika 256x256">${icon("check")} slika</span>`
          : samSeSnalazi(t)
            ? `<span class="ss ima" title="Launcher uzima pravu ikonu iz .exe fajla">${icon("check")} ikona programa</span>`
            : imaUgradjenLogo(t.name)
              ? `<span class="ss ima" title="Launcher ima ugrađen logo za ovaj alat">${icon("check")} ugrađen logo</span>`
              : `<span class="ss fali" title="Bez slike se prikazuje samo prvo slovo">${icon("alert")} nema sliku</span>`}
      </div>
    </div></div>`;
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Internet alati</h1><div class="sub">${tools.length} ${oblik(tools.length, "prečica", "prečice", "prečica")}: sajtovi otvaraju pregledač, programi pokreću .exe</div></div>
      <button class="btn btn-primary" id="addTool">${icon("plus")} Nova prečica</button></div>
    ${trakaAlata(tools)}
    <div class="game-grid">${tools.map(card).join("") || `<div class="empty" style="grid-column:1/-1">${icon("inbox")}<div>Još nema prečica.<br>Dodaj sajt (npr. YouTube) ili program (npr. Steam, TS3).</div></div>`}</div>`;
  $("#addTool").addEventListener("click", () => toolModal());
}
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-tool]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const it = (window._tools || []).find((x) => x.id === id);
  if (btn.dataset.tool === "edit") toolModal(it);
  else if (btn.dataset.tool === "toggle" && it) {
    try {
      await api(`/tools/${id}`, "PUT", { name: it.name, kind: it.kind, target: it.target, args: it.args, color: it.color, available: it.available !== 0 ? false : true });
      toast(it.available !== 0 ? "Prečica je sakrivena" : "Prečica je vidljiva", "success");
      renderTools();
    } catch (err) { toast(err.message, "error"); }
  }
  else if (btn.dataset.tool === "del") {
    if (await confirmDialog("Prečica će biti uklonjena iz launchera.", { title: "Brisanje prečice", ok: "Obriši", danger: true })) {
      try { await api(`/tools/${id}`, "DELETE"); renderTools(); } catch (err) { toast(err.message, "error"); }
    }
  }
});
function toolModal(tool) {
  const t = tool || { name: "", kind: "web", target: "", args: "", image: null, available: 1 };
  let picked = null, removeImg = false, kind = t.kind === "app" ? "app" : "web";
  modal(tool ? "Izmena prečice" : "Nova prečica", `
    <div style="display:flex;gap:16px;align-items:flex-start">
      <div class="img-picker">
        <div class="img-preview" id="tlPrev">${t.image ? `<img src="${esc(t.image)}" />` : (t.name ? esc(t.name.trim().charAt(0).toUpperCase()) : "?")}</div>
        <button class="btn btn-sm btn-block" id="tlImgBtn" type="button">Slika</button>
        <div class="mera">256 x 256 px</div>
        ${t.image ? `<button class="btn btn-sm btn-ghost btn-block" id="tlImgRem" type="button">Ukloni</button>` : ""}
        <input type="file" id="tlFile" accept="image/*" hidden />
      </div>
      <div style="flex:1;display:grid;gap:13px">
        <div class="field"><label>Naziv</label><input id="tlName" value="${esc(t.name)}" autofocus /></div>
        <div class="field"><label>Tip prečice</label>
          <div class="seg" id="tlKind">
            <button type="button" class="${kind === "web" ? "active" : ""}" data-k="web">Sajt (otvara pregledač)</button>
            <button type="button" class="${kind === "app" ? "active" : ""}" data-k="app">Program (.exe)</button>
          </div>
        </div>
      </div>
    </div>
    <div class="field" id="tlWebField" style="${kind === "app" ? "display:none" : ""}"><label>Adresa (URL)</label><input id="tlUrl" value="${kind === "web" ? esc(t.target) : ""}" placeholder="https://www.youtube.com" /></div>
    <div id="tlAppFields" style="${kind === "web" ? "display:none" : ""}">
      <div class="field"><label>Putanja do .exe ili protokol</label><input id="tlPath" value="${kind === "app" ? esc(t.target) : ""}" placeholder="C:\\Program Files\\Steam\\steam.exe  ili  steam://" /></div>
      <div class="field"><label>Argumenti (nije obavezno)</label><input id="tlArgs" value="${esc(t.args || "")}" /></div>
    </div>
    <label class="cbx"><input type="checkbox" id="tlAvail" ${t.available === 0 ? "" : "checked"}><span class="box"></span> <span style="font-size:14px">Prikaži u launcheru (igrači je vide)</span></label>
    <div class="err-msg" id="tlErr"></div>
    <button class="btn btn-primary btn-block" id="tlSave">Sačuvaj</button>`, (root, close) => {
    // tip prečice
    $$("#tlKind button", root).forEach((b) => b.addEventListener("click", () => {
      kind = b.dataset.k;
      $$("#tlKind button", root).forEach((x) => x.classList.toggle("active", x === b));
      $("#tlWebField", root).style.display = kind === "web" ? "" : "none";
      $("#tlAppFields", root).style.display = kind === "app" ? "" : "none";
    }));
    // cover
    const fi = $("#tlFile", root);
    $("#tlImgBtn", root).addEventListener("click", () => fi.click());
    fi.addEventListener("change", () => {
      const f = fi.files[0]; if (!f) return;
      if (f.size > 3 * 1024 * 1024) { $("#tlErr", root).textContent = "Slika je prevelika (najviše 3 MB)"; return; }
      const rd = new FileReader();
      rd.onload = () => { picked = rd.result; removeImg = false; $("#tlPrev", root).innerHTML = `<img src="${picked}" />`; };
      rd.readAsDataURL(f);
    });
    const rem = $("#tlImgRem", root);
    if (rem) rem.addEventListener("click", () => { removeImg = true; picked = null; $("#tlPrev", root).innerHTML = ($("#tlName", root)?.value || "?").trim().charAt(0).toUpperCase() || "?"; });
    $("#tlSave", root).addEventListener("click", async () => {
      const target = kind === "web" ? $("#tlUrl", root).value : $("#tlPath", root).value;
      const body = { name: $("#tlName", root).value, kind, target, args: kind === "app" ? $("#tlArgs", root).value : "", available: $("#tlAvail", root).checked };
      try {
        let id = tool?.id;
        if (tool) await api(`/tools/${tool.id}`, "PUT", body);
        else { const r = await api("/tools", "POST", body); id = r.id; }
        if (picked) await api(`/tools/${id}/image`, "POST", { image: picked });
        else if (removeImg) await api(`/tools/${id}/image`, "DELETE");
        toast("Sačuvano", "success"); close(); renderTools();
      } catch (e) { $("#tlErr", root).textContent = e.message; }
    });
  });
}

// Računari
async function renderComputers() {
  const comps = await api("/computers");
  const onlineCount = comps.filter((c) => c.online).length;
  // Verzija launchera po racunaru. Kad se jedan racunar ponasa drugacije od
  // ostalih, prvo se gleda da li je zaostao za ostalima - a to se ranije nije
  // videlo nigde. Racunari sa launcherom starijim od 2.22 je ne salju.
  const najnovija = comps.map((c) => c.verzija).filter(Boolean).sort().pop();
  const verzijaCel = (c) => {
    if (!c.verzija) return '<span class="faint" title="Launcher stariji od 2.22 ne javlja verziju">-</span>';
    const zaostao = najnovija && c.verzija !== najnovija;
    return `<span class="${zaostao ? "pill amber" : "faint"}"${zaostao ? ` title="Ostali racunari imaju ${esc(najnovija)}"` : ""}>${esc(c.verzija)}</span>`;
  };
  const rows = comps.map((c) => `<tr><td><b>${esc(c.name)}</b></td>
    <td><span class="pill ${c.status === "in_use" ? "green" : c.status === "locked" ? "amber" : c.status === "idle" ? "blue" : "gray"}">${{ in_use: "Online", idle: "Standby", locked: "Zaključan", offline: "Offline" }[c.status] || c.status}</span></td>
    <td class="mono" style="font-size:13px;white-space:nowrap">${verzijaCel(c)}</td>
    <td class="mono ${c.ip ? "" : "faint"}" style="font-size:13px">${c.ip ? esc(c.ip) : "-"}</td>
    <td class="mono faint" style="font-size:13px;white-space:nowrap">${c.online ? '<span class="pos">sada</span>' : c.lastSeen ? timeAgo(c.lastSeen) : "-"}</td>
    <td class="mono faint" style="font-size:13px;white-space:nowrap">${esc(c.token)} <button class="btn btn-sm btn-ghost ic-btn" data-copy="${esc(c.token)}" title="Kopiraj token">${icon("copy")}</button></td>
    <td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-comp="rename" data-id="${c.id}" data-name="${esc(c.name)}">${icon("edit")}</button>
      <button class="btn btn-sm btn-danger" data-comp="del" data-id="${c.id}">${icon("trash")}</button></td></tr>`).join("");
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Računari</h1><div class="sub">${comps.length} ${oblik(comps.length, "računar", "računara", "računara")}, ${onlineCount} povezano</div></div>
      <div class="head-actions"><button class="btn" id="bulkComp">Podesi broj</button><button class="btn btn-primary" id="addComp">${icon("plus")} Dodaj</button></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Naziv</th><th>Status</th><th>Launcher</th><th>IP adresa</th><th>Poslednji put online</th><th>Token</th><th></th></tr></thead>
      <tbody>${rows || praznaTabela(7, "monitor", "Još nema računara",
        "Dodaj ih dugmetom gore desno. Svaki dobija svoj ključ koji se upisuje u launcher na tom računaru.")}</tbody></table></div></div>`;
  $("#addComp").addEventListener("click", () => modal("Dodaj računar", `<div class="field"><label>Naziv (npr. PC-14)</label><input id="cName" autofocus /></div><button class="btn btn-primary btn-block" id="cSave">Dodaj</button>`, (root, close) => {
    $("#cSave", root).addEventListener("click", async () => { try { await api("/computers", "POST", { name: $("#cName", root).value }); toast("Dodato", "success"); close(); renderComputers(); } catch (e) { toast(e.message, "error"); } });
  }));
  $("#bulkComp").addEventListener("click", () => modal("Podesi broj računara", `<div class="field"><label>Koliko računara ukupno treba da postoji?</label><input id="cCount" type="number" value="13" autofocus /></div><div class="faint" style="font-size:13px">Dodaće nedostajuće (PC-01 ... PC-N). Postojeći se ne diraju.</div><button class="btn btn-primary btn-block" id="cbSave" style="margin-top:12px">Primeni</button>`, (root, close) => {
    $("#cbSave", root).addEventListener("click", async () => { try { const r = await api("/computers/bulk", "POST", { count: $("#cCount", root).value }); toast(`Dodato ${r.added} računara`, "success"); close(); renderComputers(); } catch (e) { toast(e.message, "error"); } });
  }));
}
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-comp]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.comp === "del") {
    if (await confirmDialog("Računar i njegov token će biti obrisani.", { title: "Brisanje računara", ok: "Obriši", danger: true })) {
      try { await api(`/computers/${id}`, "DELETE"); renderComputers(); } catch (err) { toast(err.message, "error"); }
    }
  }
  else if (btn.dataset.comp === "rename") modal("Preimenuj računar", `<div class="field"><label>Novi naziv</label><input id="rnName" value="${esc(btn.dataset.name)}" autofocus /></div><button class="btn btn-primary btn-block" id="rnSave">Sačuvaj</button>`, (root, close) => {
    $("#rnSave", root).addEventListener("click", async () => { try { await api(`/computers/${id}`, "PUT", { name: $("#rnName", root).value }); toast("Preimenovano", "success"); close(); renderComputers(); } catch (e) { toast(e.message, "error"); } });
  });
});

// Instalacije
const INSTALL_STATE = { queued: ["Na čekanju", "gray"], downloading: ["Preuzimanje...", "blue"], installing: ["Instalacija...", "amber"], done: ["Završeno", "green"], error: ["Greška", "red"] };
// Linkovi instalacija su predugacki za red u tabeli. Kad se seku s desna, ostane
// "https://www.battle.net/downloa" - vidi se odakle je, ali ne i sta skida.
// Zato se secka SREDINA: ostaju sajt i ime fajla, a to su bas dve stvari koje
// vlasnik proverava pre nego sto posalje instalaciju na trinaest masina.
function skratiLink(url) {
  try {
    const u = new URL(url);
    const delovi = u.pathname.split("/").filter(Boolean);
    const fajl = delovi[delovi.length - 1] || "";
    const domacin = u.hostname.replace(/^www\./, "");
    if (!fajl) return domacin;
    return delovi.length > 1 ? `${domacin}/…/${fajl}` : `${domacin}/${fajl}`;
  } catch { return url; }
}

// ---------- Nadogradnja launchera ----------
//
// Do sada je svaka izmena launchera znacila obilazak svih trinaest masina.
// Odavde se instalater postavi jednom, pusti u rad, i racunari ga uzimaju sami
// cim se oslobode.
//
// Podela posla nije slucajna: instalater postavlja i pusta SERVISER (on ga je i
// napravio, pa jedini moze da zna da li valja), a vlasnik vidi stanje i sme da
// pogura one koji su slobodni.
const NAD_STANJE = {
  poslato: ["Poslato", "gray"],
  preuzimam: ["Preuzima...", "blue"],
  instaliram: ["Instalira...", "amber"],
  gotovo: ["Nadograđen", "green"],
  greska: ["Greška", "red"],
  preskoceno: ["Čeka", "gray"],
};
// Prima BAJTOVE. Ime je puno namerno: nize u fajlu postoji lokalni `mb` koji
// prima megabajte, a dve funkcije istog imena sa razlicitim jedinicama su
// greska koja ceka da se desi.
const velicinaFajla = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");

function nadogradnjaHtml(n) {
  if (!n) return "";
  const zaostali = n.racunari.filter((r) => r.zaostaje);
  // Kad su svi na istoj verziji, nema sta da se gleda - jedan red je dovoljan.
  const spisak = zaostali.length ? `<div class="nad-masine">${zaostali.map((r) => {
    const s = r.status && NAD_STANJE[r.status.state];
    const zivo = r.status && (r.status.state === "preuzimam" || r.status.state === "instaliram");
    return `<div class="nad-masina${r.slobodan ? "" : " zauzeta"}" title="${esc(r.status?.message || "")}">
      <b>${esc(r.name)}</b>
      <span class="mono faint">${r.verzija ? esc(r.verzija) : "nepoznata"}</span>
      ${s ? `<span class="pill ${s[1]} ${zivo ? "pulse" : ""}">${s[0]}</span>`
          : `<span class="pill ${r.slobodan ? "blue" : "gray"}">${r.online ? (r.slobodan ? "spreman" : "zauzet") : "ugašen"}</span>`}
    </div>`;
  }).join("")}</div>` : "";

  const fajlovi = isServiser() && n.fajlovi?.length ? `<div class="nad-fajlovi">${n.fajlovi.map((f) => `
    <div class="nad-fajl"><span class="mono">${esc(f.ime)}</span><span class="faint">${velicinaFajla(f.velicina)}</span>
      <button class="btn btn-sm btn-danger" data-nad="obrisi" data-ime="${esc(f.ime)}" title="Obriši">${icon("trash")}</button></div>`).join("")}</div>` : "";

  if (!n.ima) {
    return `<div class="card"><div class="card-head"><h2>Nadogradnja launchera</h2></div>
      <div class="empty" style="padding:28px 18px">Na serveru nema instalatera launchera.<br>
        ${isServiser() ? "Postavi ga ovde i računari će ga preuzeti sami, čim se oslobode."
                       : "Instalater postavlja serviser."}</div>
      ${isServiser() ? `<div class="nad-akcije"><button class="btn btn-primary" data-nad="postavi">${icon("download")} Postavi instalater</button></div>` : ""}
    </div>`;
  }

  return `<div class="card"><div class="card-head"><h2>Nadogradnja launchera</h2>
      <span class="pill ${n.pusteno ? "green" : "amber"}">${n.pusteno ? "Puštena u rad" : "Nije puštena"}</span></div>
    <div class="nad-vrh">
      <div><div class="faint" style="font-size:12px">Na serveru</div>
        <div style="font-size:19px;font-weight:700">${esc(n.verzija)}</div>
        <div class="faint mono uz" style="font-size:12px">${esc(n.fajl)}<i class="uz-tacka"></i>${velicinaFajla(n.velicina)}</div></div>
      <div><div class="faint" style="font-size:12px">Zaostaje</div>
        <div style="font-size:19px;font-weight:700">${n.zaostalih} ${n.zaostalih === 1 ? "računar" : "računara"}</div>
        <div class="faint" style="font-size:12px">od ${n.racunari.length}</div></div>
    </div>
    ${n.pusteno ? `<div class="nad-nota">Računari je preuzimaju sami, čim se oslobode. Onaj na kom neko igra se ne dira.</div>`
                : `<div class="nad-nota upozorenje">Dok verzija nije puštena u rad, nijedan računar je ne preuzima.</div>`}
    ${spisak}
    ${fajlovi}
    <div class="nad-akcije">
      ${isServiser() ? `<button class="btn" data-nad="postavi">${icon("download")} Postavi instalater</button>` : ""}
      ${isServiser() ? (n.pusteno
        ? `<button class="btn btn-danger" data-nad="povuci">Povuci iz rada</button>`
        : `<button class="btn btn-primary" data-nad="pusti">Pusti verziju ${esc(n.verzija)} u rad</button>`) : ""}
      ${n.pusteno && n.zaostalih ? `<button class="btn" data-nad="posalji">${icon("send")} Pošalji slobodnima odmah</button>` : ""}
    </div>
  </div>`;
}

async function osveziNadogradnju() {
  const el = $("#nadKarta");
  if (!el) return;
  try {
    state.nadogradnja = await api("/nadogradnja");
    el.innerHTML = nadogradnjaHtml(state.nadogradnja);
  } catch {}
}

// Instalater je oko sto megabajta, pa ide kao sirov tok, ne kroz JSON.
async function posaljiInstalater(file) {
  const r = await fetch("/api/nadogradnja/fajl?ime=" + encodeURIComponent(file.name), {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", ...(state.token ? { Authorization: "Bearer " + state.token } : {}) },
    body: file,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Slanje nije uspelo");
  return d;
}

function nadogradnjaKlik(e) {
  const btn = e.target.closest("[data-nad]");
  if (!btn) return;
  const sta = btn.dataset.nad;

  if (sta === "postavi") {
    const ulaz = document.createElement("input");
    ulaz.type = "file";
    ulaz.accept = ".exe";
    ulaz.addEventListener("change", async () => {
      const f = ulaz.files?.[0];
      if (!f) return;
      await jednomKlik(btn, async () => {
        try {
          state.nadogradnja = await posaljiInstalater(f);
          $("#nadKarta").innerHTML = nadogradnjaHtml(state.nadogradnja);
          toast(`Instalater ${f.name} je na serveru`, "success");
        } catch (err) { toast(err.message, "error"); }
      }, "Šaljem instalater...");
    });
    ulaz.click();
    return;
  }

  if (sta === "pusti") {
    const n = state.nadogradnja;
    jednomKlik(btn, async () => {
      // Ovo je jedina radnja u panelu koja pokrece instalaciju na svim
      // masinama. Broj masina stoji u pitanju da bi se videlo koliko je siroko.
      const ok = await confirmDialog(
        `Računari će je preuzeti i instalirati sami, čim se oslobode. ` +
        `Računar na kom neko igra se ne dira - on dolazi na red kasnije.`,
        { title: "Pustiti verziju u rad?", istaknuto: `${n.verzija} → ${n.zaostalih} računara`, ok: "Pusti u rad" });
      if (!ok) return;
      try {
        state.nadogradnja = await api("/nadogradnja/pusti", "POST", { verzija: n.verzija });
        $("#nadKarta").innerHTML = nadogradnjaHtml(state.nadogradnja);
        toast("Verzija je puštena u rad", "success");
      } catch (err) { toast(err.message, "error"); }
    }, "Puštam...");
    return;
  }

  if (sta === "povuci") {
    jednomKlik(btn, async () => {
      try {
        state.nadogradnja = await api("/nadogradnja/povuci", "POST");
        $("#nadKarta").innerHTML = nadogradnjaHtml(state.nadogradnja);
        toast("Nadogradnja je povučena", "success");
      } catch (err) { toast(err.message, "error"); }
    }, "Povlačim...");
    return;
  }

  if (sta === "posalji") {
    jednomKlik(btn, async () => {
      try {
        const r = await api("/nadogradnja/posalji", "POST", {});
        state.nadogradnja = r;
        $("#nadKarta").innerHTML = nadogradnjaHtml(state.nadogradnja);
        toast(r.poslato ? `Poslato na ${r.poslato} računara` +
          (r.zauzeto ? `, ${r.zauzeto} zauzeto ili ugašeno` : "")
          : "Nema slobodnog računara koji zaostaje", r.poslato ? "success" : "info");
      } catch (err) { toast(err.message, "error"); }
    });
    return;
  }

  if (sta === "obrisi") {
    const ime = btn.dataset.ime;
    jednomKlik(btn, async () => {
      const ok = await confirmDialog("Instalater se briše sa servera. Ovo ne dira računare koji su ga već instalirali.",
        { title: "Obrisati instalater?", istaknuto: ime, ok: "Obriši", danger: true });
      if (!ok) return;
      try {
        state.nadogradnja = await api("/nadogradnja/fajl?ime=" + encodeURIComponent(ime), "DELETE");
        $("#nadKarta").innerHTML = nadogradnjaHtml(state.nadogradnja);
      } catch (err) { toast(err.message, "error"); }
    }, "Brišem...");
  }
}

async function renderInstall() {
  let programs = [];
  try {
    programs = await api("/programs");
    const st = await api("/install-status");
    state.installStatus = {};
    st.forEach((s) => (state.installStatus[s.computerId] = s));
  } catch {}
  try { state.nadogradnja = await api("/nadogradnja"); } catch { state.nadogradnja = null; }
  window._programs = programs;
  const progRows = programs.map((p) => `<tr>
    <td><b>${esc(p.name)}</b>${p.note ? `<div class="faint" style="font-size:12px">${esc(p.note)}</div>` : ""}
      <div class="trunc-mono" title="${esc(p.url)}">${esc(skratiLink(p.url))}</div></td>
    <td class="mono faint" style="font-size:12px;white-space:nowrap">${esc(p.args || "-")}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-sm btn-primary" data-prog="install" data-id="${p.id}">${icon("download")} Instaliraj</button>
      <button class="btn btn-sm" data-prog="edit" data-id="${p.id}">${icon("edit")}</button>
      <button class="btn btn-sm btn-danger" data-prog="del" data-id="${p.id}">${icon("trash")}</button></td></tr>`).join("");
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Instalacije</h1><div class="sub">Daljinsko instaliranje programa na računare igrača</div></div>
      <div class="head-actions">
        <button class="btn" id="quickInstall">${icon("send")} Instaliraj sa linka</button>
        <button class="btn btn-primary" id="addProg">${icon("plus")} Novi program</button>
      </div></div>
    <div id="nadKarta">${nadogradnjaHtml(state.nadogradnja)}</div>
    <div class="install-layout">
      <div class="card"><div class="card-head"><h2>Biblioteka programa</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Program</th><th>Tihi argumenti</th><th></th></tr></thead>
          <tbody>${progRows || praznaTabela(3, "download", "Nema sačuvanih programa",
            "Sačuvaj instalacije koje često koristiš - Steam, Discord, drajvere - pa ih odavde šalješ na bilo koji računar.")}</tbody></table></div></div>
      <div class="card ist-card"><div class="card-head"><h2>Status</h2>
        <button class="btn btn-sm btn-ghost ${Object.keys(state.installStatus).length ? "" : "hidden"}" id="clearInstall">Očisti</button></div>
        <div id="installStatusList">${installStatusHtml()}</div></div>
    </div>`;
  $("#addProg").addEventListener("click", () => progModal());
  $("#quickInstall").addEventListener("click", quickInstallModal);
  $("#nadKarta").addEventListener("click", nadogradnjaKlik);
  const ci = $("#clearInstall");
  if (ci) ci.addEventListener("click", async () => {
    try { await api("/install-status", "DELETE"); state.installStatus = {}; updateInstallStatus(); }
    catch (e) { toast(e.message, "error"); }
  });
}
function installStatusHtml() {
  const arr = Object.values(state.installStatus);
  if (!arr.length) return '<div class="empty" style="padding:36px 18px">Ovde se uživo prati tok instalacija -<br>preuzimanje, pokretanje i ishod po računaru.</div>';
  return arr.sort((a, b) => (b.ts || 0) - (a.ts || 0)).map((s) => {
    const [lbl, col] = INSTALL_STATE[s.state] || [s.state, "gray"];
    const live = s.state === "downloading" || s.state === "installing";
    return `<div class="ist-row">
      <div class="ist-top"><b>${esc(s.computer || "?")}</b><span class="ist-ago">${timeAgo(s.ts)}</span></div>
      <div class="ist-mid"><span class="ist-prog">${esc(s.program || "")}</span><span class="pill ${col} ${live ? "pulse" : ""}">${lbl}</span></div>
      ${s.message && s.state === "error" ? `<div class="ist-msg">${esc(s.message)}</div>` : ""}
    </div>`;
  }).join("");
}
function updateInstallStatus() {
  const el = $("#installStatusList");
  if (el) el.innerHTML = installStatusHtml();
  const ci = $("#clearInstall");
  if (ci) ci.classList.toggle("hidden", !Object.keys(state.installStatus).length);
}
function quickInstallModal() {
  modal("Instalacija sa linka", `
    <div class="muted" style="font-size:13px">Jednokratno slanje instalacije, bez čuvanja u biblioteci.</div>
    <div class="form-row">
      <div class="field"><label>Naziv</label><input id="qiName" placeholder="npr. Steam" autofocus /></div>
      <div class="field"><label>Tihi argumenti (opciono)</label><input id="qiArgs" placeholder="/S" /></div>
    </div>
    <div class="field"><label>Direktan link (URL) do instalacije</label><input id="qiUrl" placeholder="https://.../setup.exe" /></div>
    <label class="cbx"><input type="checkbox" id="qiSaveLib"><span class="box"></span> <span style="font-size:13px">Sačuvaj i u biblioteku</span></label>
    <div class="err-msg" id="qiErr"></div>
    <button class="btn btn-primary btn-block" id="qiSend">Izaberi računare i pošalji</button>`, (root, close) => {
    $("#qiSend", root).addEventListener("click", async () => {
      const name = $("#qiName", root).value.trim(), url = $("#qiUrl", root).value.trim(), args = $("#qiArgs", root).value.trim();
      if (!name || !url) { $("#qiErr", root).textContent = "Unesi naziv i link"; return; }
      if (!/^https?:\/\//i.test(url)) { $("#qiErr", root).textContent = "Link mora počinjati sa http:// ili https://"; return; }
      if ($("#qiSaveLib", root).checked) { try { await api("/programs", "POST", { name, url, args }); } catch {} }
      close();
      installTargets({ name, url, args });
    });
  });
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-prog]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const p = (window._programs || []).find((x) => x.id === id);
  if (btn.dataset.prog === "install") installTargets({ programId: id, name: p?.name });
  else if (btn.dataset.prog === "edit") progModal(p);
  else if (btn.dataset.prog === "del") {
    if (await confirmDialog("Program će biti uklonjen iz biblioteke.", { title: "Brisanje programa", ok: "Obriši", danger: true })) {
      try { await api(`/programs/${id}`, "DELETE"); renderInstall(); } catch (err) { toast(err.message, "error"); }
    }
  }
});
function progModal(p) {
  const it = p || { name: "", url: "", args: "", note: "" };
  modal(p ? "Izmena programa" : "Novi program", `
    <div class="field"><label>Naziv</label><input id="pgName" value="${esc(it.name)}" autofocus /></div>
    <div class="field"><label>Direktan link (URL)</label><input id="pgUrl" value="${esc(it.url)}" placeholder="https://.../setup.exe" /></div>
    <div class="field"><label>Tihi argumenti (opciono)</label><input id="pgArgs" value="${esc(it.args)}" placeholder="/S  ili  /qn" /></div>
    <div class="field"><label>Napomena (opciono)</label><input id="pgNote" value="${esc(it.note || "")}" /></div>
    <div class="err-msg" id="pgErr"></div>
    <button class="btn btn-primary btn-block" id="pgSave">Sačuvaj</button>`, (root, close) => {
    $("#pgSave", root).addEventListener("click", async () => {
      const body = { name: $("#pgName", root).value, url: $("#pgUrl", root).value, args: $("#pgArgs", root).value, note: $("#pgNote", root).value };
      try { if (p) await api(`/programs/${p.id}`, "PUT", body); else await api("/programs", "POST", body); toast("Sačuvano", "success"); close(); renderInstall(); }
      catch (e) { $("#pgErr", root).textContent = e.message; }
    });
  });
}
function installTargets(prog) {
  const rows = state.computers.map((c) => `<label class="cbx" style="display:flex;padding:7px 4px;border-bottom:1px solid var(--line)">
    <input type="checkbox" class="inst-t" data-id="${c.id}" ${c.online ? "checked" : "disabled"}><span class="box"></span>
    <span style="margin-left:2px">${esc(c.name)} ${c.online ? "" : '<span class="faint">(offline)</span>'}</span></label>`).join("");
  modal("Instaliraj: " + esc(prog.name || "program"), `
    <div class="muted" style="font-size:14px">Izaberi računare (offline ne mogu da prime instalaciju):</div>
    <div style="max-height:300px;overflow-y:auto">${rows}</div>
    <div class="err-msg" id="itErr"></div>
    <button class="btn btn-primary btn-block" id="itSend">Pošalji instalaciju</button>`, (root, close) => {
    // Dupli klik bi poslao istu instalaciju dvaput na iste mašine: dva
    // preuzimanja i dva instalatera istog programa u isto vreme, koji onda
    // smetaju jedan drugom i oba padnu.
    $("#itSend", root).addEventListener("click", (ev) => jednomKlik(ev.currentTarget, async () => {
      const ids = $$(".inst-t:checked", root).map((c) => Number(c.dataset.id));
      if (!ids.length) { $("#itErr", root).textContent = "Izaberi bar jedan online računar"; return; }
      try { const r = await api("/install", "POST", { ...prog, ids }); toast(`Instalacija poslata na ${r.sent} računara`, "success"); close(); if (state.view === "install") updateInstallStatus(); }
      catch (e) { $("#itErr", root).textContent = e.message; }
    }, "Šaljem..."));
  });
}

// Radnici
async function renderStaff() {
  const admins = await api("/admins");
  // Ugašen nalog (otpušten radnik) ostaje na spisku: vlasnik mora da vidi ko je
  // sve imao pristup, a smene i promet i dalje nose njegovo ime.
  // SERVISERSKI NALOG SE VIDI, ALI SE NE DIRA.
  //
  // Vlasnik je gazda svoje igraonice, ali ne i programa: serviserski nalog ne
  // pravi i ne uklanja. Zato dugmad stoje samo nad nalozima NIŽIM od mog.
  //
  // Vidi se namerno. Nalog koji ima pristup tuđim podacima ne sme da bude
  // sakriven od onoga čiji su podaci - vlasnik u svakom trenutku zna ko još
  // može da uđe. Ne može da ga ukloni (to je cena podrške), ali ne može ni da
  // bude obmanut da ga nema.
  const PILULA = { serviser: "pill red", owner: "pill amber", staff: "pill blue" };
  const rows = admins.map((a) => {
    const smem = smemNad(a.role);
    return `<tr${a.aktivan === false ? ' class="red-ugasen"' : ""}><td><b>${esc(a.username)}</b>
      ${a.aktivan === false ? '<div class="faint" style="font-size:12px">nalog ugašen - prijava više ne radi</div>' : ""}
      ${a.role === "serviser" ? '<div class="faint" style="font-size:12px">održava program - postavlja se sa glavnog računara</div>' : ""}</td>
    <td><span class="${PILULA[a.role] || "pill blue"}">${ULOGA_NAZIV[a.role] || "Radnik"}</span></td>
    <td class="mono faint">${new Date(a.createdAt).toLocaleDateString("sr-Latn-RS")}</td>
    <td style="text-align:right;white-space:nowrap">${!smem
      ? `<span class="faint" style="font-size:12px">${a.id === state.admin.id ? "tvoj nalog" : "nije u tvojoj nadležnosti"}</span>`
      : a.aktivan === false
        ? `<button class="btn btn-sm" data-staff="vrati" data-id="${a.id}" data-name="${esc(a.username)}">${icon("refresh")} Vrati</button>`
        : `<button class="btn btn-sm" data-staff="pw" data-id="${a.id}" data-name="${esc(a.username)}">${icon("key")}</button>
      <button class="btn btn-sm btn-danger" data-staff="del" data-id="${a.id}" data-name="${esc(a.username)}">${icon("trash")}</button>`}</td></tr>`;
  }).join("");
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Radnici</h1><div class="sub">Nalozi za prijavu na panel</div></div>
      <button class="btn btn-primary" id="addStaff">${icon("plus")} Novi nalog</button></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Korisnik</th><th>Uloga</th><th>Kreiran</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>
    <div class="faint" style="font-size:13px;margin-top:12px;max-width:680px">
      <b>Radnik</b> - kontrolna tabla, igrači, porudžbine, kasa.<br>
      <b>Vlasnik</b> - sve u igraonici: cene, podešavanja, shop, igre, računari, logovi, radnici.<br>
      <b>Serviser</b> - onaj ko je program postavio i ko ga održava. Vidi se na spisku, ali ga vlasnik ne menja i ne uklanja: postavlja se sa glavnog računara (<span class="mono">alati/serviser.mjs</span>). Postoji da bi podrška mogla da uđe i kad se vlasnik sam zaključa.
    </div>`;
  $("#addStaff").addEventListener("click", () => modal("Novi nalog za panel", `
    <div class="field"><label>Korisničko ime</label><input id="saUser" autofocus /></div>
    <div class="field"><label>Lozinka</label><input id="saPass" /></div>
    <div class="field"><label>Uloga</label><select id="saRole"><option value="staff">Radnik</option><option value="owner">Vlasnik</option>${
      // Serviserski nalog nudi samo serviseru. Vlasnik ne sme sebi da napravi
      // nadređenog - ni slučajno ni namerno; server to i odbija.
      isServiser() ? '<option value="serviser">Serviser</option>' : ""}</select></div>
    <div class="err-msg" id="saErr"></div><button class="btn btn-primary btn-block" id="saSave">Kreiraj</button>`, (root, close) => {
    $("#saSave", root).addEventListener("click", async () => { try { await api("/admins", "POST", { username: $("#saUser", root).value, password: $("#saPass", root).value, role: $("#saRole", root).value }); toast("Nalog je kreiran", "success"); close(); renderStaff(); } catch (e) { $("#saErr", root).textContent = e.message; } });
  }));
}
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-staff]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.staff === "del") {
    // Ako mu je smena jos otvorena, kasa ostaje na njegovo ime a on vise ne
    // moze da udje da je zatvori - vlasnik mora da zna da to pada na njega.
    const uSmeni = state.shift && state.shift.admin === btn.dataset.name;
    if (await confirmDialog("Radniku se oduzima pristup panelu i prijava mu više neće raditi. Smene i dopune koje je upisao ostaju zapisane na njegovo ime, jer bez toga obračun smene nema smisla. Nalog se kasnije može vratiti."
      + (uSmeni ? "\n\nPAŽNJA: njegova smena je trenutno otvorena. Pošto više neće moći da uđe, smenu ćete morati sami da zatvorite i prebrojite kasu." : ""),
      { title: "Oduzimanje pristupa", ok: "Oduzmi pristup", danger: true })) {
      try {
        const r = await api(`/admins/${id}`, "DELETE");
        toast(r.obrisan ? "Nalog je obrisan" : "Pristup je oduzet", "success");
        renderStaff();
      } catch (err) { toast(err.message, "error"); }
    }
  }
  else if (btn.dataset.staff === "vrati") {
    try { await api(`/admins/${id}/vrati`, "POST"); toast("Nalog je vraćen", "success"); renderStaff(); }
    catch (err) { toast(err.message, "error"); }
  }
  else if (btn.dataset.staff === "pw") modal("Nova lozinka - " + btn.dataset.name, `<div class="field"><label>Nova lozinka</label><input id="stPw" autofocus /></div><button class="btn btn-primary btn-block" id="stSave">Sačuvaj</button>`, (root, close) => {
    $("#stSave", root).addEventListener("click", async () => { try { await api(`/admins/${id}/password`, "POST", { password: $("#stPw", root).value }); toast("Lozinka je promenjena", "success"); close(); } catch (e) { toast(e.message, "error"); } });
  });
});

// Logovi
const LOG_CATS = { sve: "Sve", prijava: "Prijave", sesija: "Sesije", novac: "Novac", shop: "Shop", igre: "Igre", racunar: "Računari", nalozi: "Nalozi", podesavanja: "Podešavanja", sistem: "Sistem" };
const clockS = (ts) => new Date(ts).toLocaleTimeString("sr-Latn-RS", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Danas";
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Juče";
  return d.toLocaleDateString("sr-Latn-RS", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });
}
async function renderLogs() {
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Logovi</h1><div class="sub" id="lgCount">učitavam...</div></div></div>
    <div class="board-bar"><div class="filters">${Object.entries(LOG_CATS).map(([k, v]) => `<button class="chip ${state.logFilter === k ? "active" : ""}" data-lf="${k}">${v}</button>`).join("")}</div>
      <div class="search" style="margin-left:auto">${icon("search")}<input id="logSearch" placeholder="Pretraži logove..." value="${esc(state.lgSearch)}" /></div></div>
    <div class="card"><div id="logList"></div><div id="lgPager"></div></div>`;
  $$("[data-lf]").forEach((b) => b.addEventListener("click", () => { state.logFilter = b.dataset.lf; state.lgPage = 1; renderLogs(); }));
  let t;
  $("#logSearch").addEventListener("input", (e) => {
    clearTimeout(t);
    const v = e.target.value.trim();
    t = setTimeout(() => { state.lgSearch = v; state.lgPage = 1; refreshLogs(); }, 300);
  });
  refreshLogs();
}
async function refreshLogs() {
  let d = { items: [], total: 0, page: 1, pages: 1, per: 15 };
  try { d = await api(`/logs?page=${state.lgPage}&per=15&category=${state.logFilter}&search=${encodeURIComponent(state.lgSearch)}`); }
  catch (e) { toast(e.message, "error"); }
  state.logsPage = d;
  const list = $("#logList");
  if (list) {
    let html = "", lastDay = null;
    for (const l of d.items) {
      const dl = dayLabel(l.ts);
      if (dl !== lastDay) { html += `<div class="log-day">${dl}</div>`; lastDay = dl; }
      html += logRow(l);
    }
    list.innerHTML = html || `<div class="empty">${icon(state.lgSearch ? "search" : "info")}
      <div class="e-t">${state.lgSearch ? "Nema rezultata za tu pretragu" : "Nema zabeleženih događaja"}</div>
      <div class="e-s">${state.lgSearch
        ? `Ni jedan zapis ne sadrži „${esc(state.lgSearch)}“.`
        : "Ovde se sam upisuje svaka prijava, sesija, uplata i promena podešavanja."}</div></div>`;
  }
  const c = $("#lgCount"); if (c) c.textContent = `${d.total} ${oblik(d.total, "zapis", "zapisa", "zapisa")}`;
  const pg = $("#lgPager");
  if (pg) { pg.innerHTML = pagerHtml(d); bindPager(pg, d, (p) => { state.lgPage = p; refreshLogs(); }); }
}
const LOG_ICON = { prijava: "key", sesija: "clock", novac: "cash", shop: "bag", igre: "igre", racunar: "monitor", nalozi: "user", podesavanja: "sliders", sistem: "info" };
function logRow(l) {
  // Kategorija se pise samo dok se gleda "Sve". Kad je filter vec na "Prijave",
  // oznaka "Prijave" uz svaki red ne kaze nista novo.
  const kat = (state.logFilter || "sve") === "sve"
    ? `<span class="log-kat">${LOG_CATS[l.category] || l.category}</span>` : "";
  // Kvar mora da se razlikuje od obicnog zapisa. Bez toga red "igra nije htela
  // da se pokrene" izgleda isto kao "pokrenuta igra", pa se u spisku izgubi -
  // a to je bas red zbog kog se logovi i otvaraju.
  const kvar = /_fail$/.test(l.action || "");
  return `<div class="log-row${kvar ? " kvar" : ""}">
    <span class="log-ic ${l.category}">${icon(LOG_ICON[l.category] || "info")}</span>
    <span class="log-text">${l.actor ? `<b>${esc(l.actor)}</b> ` : ""}${esc(l.detail || l.action)}${l.target ? ` <span class="faint">${esc(l.target)}</span>` : ""}</span>
    ${l.amount != null ? `<span class="log-amount ${l.amount >= 0 ? "pos" : "zero"}">${l.amount >= 0 ? "+" : ""}${money(l.amount)}</span>` : ""}
    ${kat}
    <span class="log-vreme">${clockS(l.ts)}</span></div>`;
}
// novi zapis preko WS: osveži listu (sa malim zadržavanjem zbog grupnih akcija)
function prependLog(l) {
  if ((state.lgPage || 1) !== 1 || state.lgSearch) return;
  if (state.logFilter !== "sve" && l.category !== state.logFilter) return;
  clearTimeout(prependLog._t);
  prependLog._t = setTimeout(() => { if (state.view === "logs") refreshLogs(); }, 350);
}

// Red u podešavanjima: naslov i objašnjenje levo, polje desno.
// Stoji IZVAN renderSettings jer ga koristi i kartica nagradnog točka, koja se
// učitava zasebno. Dok je bio lokalna promenljiva, ta kartica je pucala na
// "setRow is not defined" i zauvek ostajala na "učitavam..." - osoblje nije
// moglo ni da upali točak ni da promeni nagrade.
const setRow = (t, d, c, stanje = "") => `<div class="set-row"><div class="sr-l"><div class="sr-t">${t}</div>${d ? `<div class="sr-d ${stanje}">${d}</div>` : ""}</div><div class="sr-c">${c}</div></div>`;

// Podešavanja
async function renderSettings() {
  const s = await api("/settings");
  let si = null;
  try { si = await api("/server-info"); } catch {}
  const addrRows = (si?.ips || []).map((ip) => {
    const addr = `http://${ip}:${si.port}`;
    return kv(`<span class="mono">${esc(addr)}</span>`, `<button class="btn btn-sm btn-ghost ic-btn" data-copy="${esc(addr)}" title="Kopiraj adresu">${icon("copy")}</button>`);
  }).join("") || kv('<span class="faint">Nema mrežnih adresa</span>', "");
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Podešavanja</h1><div class="sub">Dostupno samo vlasniku</div></div></div>
    <div class="settings-col">
      <div class="card">
        <div class="card-head"><h2>Igraonica i cene</h2></div>
        <div class="set-rows">
          ${setRow("Naziv igraonice", "Prikazuje se igračima u launcheru", `<input id="setName" value="${esc(s.cafeName)}" />`)}
          ${setRow("Cena po satu", "Kredit se skida proporcionalno, iz sekunde u sekundu", `<div class="input-suffix"><input id="setRate" type="number" value="${s.ratePerHour}" /><span>${esc(s.currency)}/h</span></div>`)}
          ${setRow("Valuta", "Oznaka uz sve iznose u panelu i launcheru", `<input id="setCur" value="${esc(s.currency)}" />`)}
          ${setRow("PIN za otključavanje", s.unlockPin === "1234"
            ? "Još uvek stoji fabrički PIN 1234 - promeni ga pre otvaranja, inače ga igrači brzo pogode"
            : "Osoblje ga kuca na računaru igrača (Ctrl+Alt+U)",
            `<div class="input-eye"><input id="setPin" type="password" value="${esc(s.unlockPin)}" autocomplete="off" /><button type="button" class="btn btn-ghost ic-btn" id="pinEye" title="Prikaži PIN">${icon("eye")}</button></div>`,
            s.unlockPin === "1234" ? "upozorenje" : "")}
          ${setRow("Servisni PIN launchera", s.servisniPin
            ? "Otvara podešavanja launchera i izlaz iz kioska kad server ne radi. Upisuješ ga ovde jednom - stiže na sve računare odmah."
            : "Još nije podešen, pa na računarima važi fabrički 1234. Dok je tako, igrač koji iščupa mrežni kabl može da preusmeri računar na svoj server. Upiši ga ovde jednom - stiže na sve računare odmah.",
            `<div class="input-eye"><input id="setSPin" type="password" value="${esc(s.servisniPin || "")}" placeholder="npr. 7431" autocomplete="off" /><button type="button" class="btn btn-ghost ic-btn" id="spinEye" title="Prikaži PIN">${icon("eye")}</button></div>`,
            s.servisniPin ? "" : "upozorenje")}
          ${setRow("Odjava zbog mirovanja", "Igrač koji ustane i zaboravi da se odjavi prestaje da plaća, a računar se oslobađa. Dobija odbrojavanje od 60 s pre odjave. Upiši 0 da isključiš.", `<div class="input-suffix"><input id="setIdle" type="number" value="${s.idleMinutes ?? 15}" /><span>min</span></div>`)}
        </div>
        <div class="card-foot"><button class="btn btn-primary" id="setSave">Sačuvaj podešavanja</button></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Vremenski paketi</h2>
          <button class="btn btn-sm btn-primary" id="paketNovi">${icon("plus")} Novi paket</button></div>
        <div class="card-sub">Jeftinije vreme kupljeno unapred. Osoblje ih prodaje na dopuni kredita, jednim klikom.</div>
        <div id="paketiLista" class="paketi-lista"><div class="empty" style="padding:16px">učitavam...</div></div>
      </div>
      <div class="card" id="tocakKartica"><div class="empty" style="padding:22px">učitavam...</div></div>
      ${si ? `
      <div class="card">
        <div class="card-head"><h2>Server</h2><span class="pill green">radi ${fmtUptime(si.startedAt)}</span></div>
        <div class="card-body kv-list">
          ${kv("Verzija panela", `<span class="mono">${esc(si.version)}</span>`)}
          ${kv("Node", `<span class="mono">${esc(si.node)}</span>`)}
          ${kv("Port", `<span class="mono">${si.port}</span>`)}
          ${kv("Veličina baze", fmtBytes(si.dbSizeBytes))}
        </div>
        <div class="card-sub">Adresa servera - unosi se u launcher pri podešavanju računara</div>
        <div class="card-body kv-list" style="padding-top:4px">${addrRows}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Rezervne kopije baze</h2></div>
        <div class="card-body kv-list">
          ${kv("Poslednja kopija", si.backups.lastAt ? timeAgo(si.backups.lastAt) : '<span class="faint">nema</span>')}
          ${kv("Sačuvano", `${si.backups.count} <span class="faint">gusto blizu, ređe daleko</span>`)}
          ${kv("Automatski", "na svakih 15 minuta i pri pokretanju servera")}
        </div>
        <div class="card-sub">Poslednje kopije</div>
        <div class="table-wrap"><table><tbody id="kopijeRedovi"><tr><td class="empty" style="padding:18px">učitavam...</td></tr></tbody></table></div>
        <div class="card-sub">Ako baza pukne, kopija se vraća skriptom <span class="mono">VRATI-KOPIJU.bat</span> u folderu servera. Server pri tome mora da bude ugašen.</div>
        <div class="card-foot"><button class="btn" id="backupNow">${icon("refresh")} Napravi kopiju sada</button></div>
      </div>

      <div class="card" id="kartaKopijaVan">
        <div class="card-head"><h2>Kopija van računara</h2></div>
        <div class="card-body" id="kopijaVanTelo"><div class="faint" style="padding:4px 0">učitavam...</div></div>
      </div>

      <div class="card" id="kartaSkladiste">
        <div class="card-head"><h2>Prostor na disku</h2></div>
        <div class="card-body kv-list" id="skladisteTelo"><div class="faint" style="padding:4px 0">učitavam...</div></div>
        <div class="card-sub">Koliko se dugo čuva</div>
        <div class="card-body set-rows" id="skladisteGranice"></div>
        <div class="card-sub">Zapisi stariji od zadatog se brišu, a ako ih i posle toga ima previše, briše se najstariji da bi novi imao mesto. Promet, sesije i porudžbine se ne brišu nikad - to je poslovna evidencija.</div>
        <div class="card-foot">
          <button class="btn" id="skladisteSacuvaj">Sačuvaj granice</button>
          <button class="btn" id="skladisteOcisti">${icon("trash")} Očisti sada</button>
        </div>
      </div>` : ""}
    </div>`;
  $("#setSave").addEventListener("click", async () => {
    // PROMENA CENE PO SATU MENJA VREME SVIMA KOJI IGRAJU.
    //
    // Vreme nije zapamćeno uz nalog nego se računa iz kredita: kredit podeljen
    // cenom. Ko je uplatio 600 pri ceni 120 ima pet sati; čim cena skoči na
    // 150, isti taj kredit vredi četiri. Igrači to vide odmah, na svom tajmeru,
    // usred sesije - a vlasnik koji menja cenu obično misli samo na nove goste.
    const staraCena = Number(state.settings.ratePerHour) || 0;
    const novaCena = Number($("#setRate").value) || 0;
    const uIgri = (state.computers || []).filter((c) => c.session && c.player).length;
    if (novaCena !== staraCena && uIgri > 0) {
      const gore = novaCena > staraCena;
      const primer = (kredit) => `${money(kredit)} = ${dur(staraCena > 0 ? (kredit / staraCena) * 3600 : null)} → ${dur(novaCena > 0 ? (kredit / novaCena) * 3600 : null)}`;
      const ok = await confirmDialog(
        `Trenutno ${oblik(uIgri, "igra", "igraju", "igra")} ${uIgri} ${oblik(uIgri, "igrač", "igrača", "igrača")}. `
        + `Preostalo vreme se računa iz kredita, pa će im se tajmer promeniti odmah, usred sesije.`
        + `\n\nNa primer: ${primer(600)}`
        + `\n\n${gore ? "Dobiće manje vremena za isti kredit." : "Dobiće više vremena za isti kredit."}`,
        { title: "Promena cene po satu", ok: "Promeni cenu", danger: gore });
      if (!ok) return;
    }
    try { const d = await api("/settings", "POST", { cafeName: $("#setName").value, currency: $("#setCur").value, ratePerHour: $("#setRate").value, unlockPin: $("#setPin").value, servisniPin: $("#setSPin").value, idleMinutes: $("#setIdle").value }); state.settings = d.settings; toast("Podešavanja su sačuvana", "success"); }
    catch (e) { toast(e.message, "error"); }
  });
  // Oba PIN polja se otkrivaju istim dugmetom-okom.
  for (const [dugme, polje] of [["#pinEye", "#setPin"], ["#spinEye", "#setSPin"]]) {
    const eye = $(dugme);
    if (!eye) continue;
    eye.addEventListener("click", () => {
      const i = $(polje);
      const show = i.type === "password";
      i.type = show ? "text" : "password";
      eye.innerHTML = icon(show ? "eyeoff" : "eye");
      eye.title = show ? "Sakrij PIN" : "Prikaži PIN";
    });
  }
  const bk = $("#backupNow");
  if (bk) bk.addEventListener("click", async () => {
    bk.disabled = true;
    try { await api("/backup", "POST"); toast("Rezervna kopija je napravljena", "success"); renderSettings(); }
    catch (e) { toast(e.message, "error"); bk.disabled = false; }
  });
  const pn = $("#paketNovi");
  if (pn) pn.addEventListener("click", () => paketModal());
  ucitajPakete();
  ucitajTocak();
  ucitajKopije();
  ucitajKopijuVan();
  ucitajSkladiste();
}

// Prostor na disku. Glavni računar niko neće održavati, a kad disk stane server
// ne može da piše i cela igraonica staje - zato vlasnik ovo vidi na istom mestu
// gde su i rezervne kopije, a ne tek kad bude kasno.
async function ucitajSkladiste() {
  const telo = $("#skladisteTelo");
  if (!telo) return;
  let s;
  try { s = await api("/skladiste"); }
  catch (e) { telo.innerHTML = `<div class="faint" style="padding:4px 0">${esc(e.message)}</div>`; return; }

  // Nova igraonica ima bazu manju od megabajta. Zaokruženo na cele, to je
  // "0 MB" i izgleda kao da nešto ne radi - zato sitno ide u kilobajtima.
  const mb = (n) => {
    if (n >= 1024) return (n / 1024).toFixed(1) + " GB";
    if (n >= 10) return Math.round(n) + " MB";
    if (n >= 1) return n.toFixed(1) + " MB";
    return Math.max(1, Math.round(n * 1024)) + " KB";
  };
  const disk = s.slobodnoMB === null ? '<span class="faint">nepoznato</span>'
    : `<span${s.maloMesta ? ' style="color:var(--danger)"' : ""}>${mb(s.slobodnoMB)} slobodno</span>`;
  const komada = `${s.kopijaKomada} ${oblik(s.kopijaKomada, "kopija", "kopije", "kopija")}`;
  telo.innerHTML =
    kv("Baza", fmtBytes(s.bazaBajta)) +
    kv("Rezervne kopije", `${fmtBytes(s.kopijeBajta)} <span class="faint">${komada}</span>`) +
    kv("Na disku", disk) +
    (s.najstarijaKopija ? kv("Najstarija kopija", timeAgo(s.najstarijaKopija)) : "") +
    kv("Zapisa u Logovima", String(s.redovi.logs));

  if (s.maloMesta) {
    telo.insertAdjacentHTML("afterbegin",
      `<div class="upozorenje-fabricko" style="margin-bottom:12px"><div>
        <b>Malo mesta na disku.</b>
        <span>Kad disk stane, server ne može da piše: prijava, kasa i naplata sesija prestaju da rade.
        Oslobodi prostor na glavnom računaru ili smanji granicu za rezervne kopije.</span>
      </div></div>`);
  }

  const polje = (id, v) => `<input id="${id}" type="number" min="1" value="${v}" style="width:110px" />`;
  $("#skladisteGranice").innerHTML =
    setRow("Logovi - dana", "starije od ovoga se briše", polje("sklLogDana", s.granice.logDana)) +
    setRow("Logovi - najviše zapisa", "kad se pređe, briše se najstariji", polje("sklLogNajvise", s.granice.logNajvise)) +
    setRow("Pokretanja igara - dana", "koristi se za spisak najigranijih", polje("sklPokretanja", s.granice.pokretanjaDana)) +
    setRow("Rezervne kopije - najviše MB", "preko toga se briše najstarija kopija", polje("sklKopijeMB", s.granice.kopijeMB)) +
    setRow("Upozori ispod - MB", "ispod ovoliko slobodnog diska kopija se ne pravi", polje("sklDiskMB", s.granice.diskMB));

  $("#skladisteSacuvaj").onclick = async () => {
    try {
      await api("/skladiste", "POST", {
        logDana: $("#sklLogDana").value, logNajvise: $("#sklLogNajvise").value,
        pokretanjaDana: $("#sklPokretanja").value, kopijeMB: $("#sklKopijeMB").value, diskMB: $("#sklDiskMB").value,
      });
      toast("Granice su sačuvane", "success");
      ucitajSkladiste();
    } catch (e) { toast(e.message, "error"); }
  };
  $("#skladisteOcisti").onclick = async () => {
    if (!(await confirmDialog("Zapisi stariji od zadatih granica biće obrisani, a rezervne kopije proređene. Promet, sesije i porudžbine se ne diraju.",
      { title: "Čišćenje", ok: "Očisti" }))) return;
    try {
      const r = await api("/skladiste/ocisti", "POST");
      const n = r.logovi.poStarosti + r.logovi.poBroju + r.pokretanja;
      toast(n || r.kopije.obrisano ? `Obrisano ${n} zapisa i ${r.kopije.obrisano} kopija` : "Nije bilo šta da se briše", "success");
      ucitajSkladiste(); ucitajKopije();
    } catch (e) { toast(e.message, "error"); }
  };
}

// Nagradni točak - podešavanje (vlasnik): uključi/isključi, prag potrošnje, nagrade.
async function ucitajTocak() {
  const box = $("#tocakKartica");
  if (!box) return;
  let cfg = { ukljucen: false, prag: 1200, nagrade: [] };
  try { cfg = await api("/tocak"); } catch {}
  if (!$("#tocakKartica")) return;
  window._tocak = cfg;
  const rph = ratePerHour();
  const ukupnaTezina = cfg.nagrade.reduce((a, n) => a + Math.max(0, n.tezina), 0) || 1;
  const nagRedovi = cfg.nagrade.map((n) => {
    const sansa = Math.round((Math.max(0, n.tezina) / ukupnaTezina) * 100);
    return `<div class="paket-stavka">
      <div class="paket-info"><b>${esc(n.naziv)}</b> <span class="faint">${n.kredit > 0 ? money(n.kredit) + " kredita" : "prazno"}, šansa ~${sansa}%</span></div>
      <div class="paket-akcije">
        <button class="btn btn-sm btn-ghost" data-nag-izmeni="${n.id}" title="Izmeni">${icon("edit")}</button>
        <button class="btn btn-sm btn-ghost del" data-nag-brisi="${n.id}" title="Obriši">${icon("trash")}</button>
      </div></div>`;
  }).join("") || `<div class="empty" style="padding:16px">Nema nagrada. Dodaj bar jednu.</div>`;
  box.innerHTML = `
    <div class="card-head"><h2>Nagradni točak</h2>
      <label class="switch"><input type="checkbox" id="tocakUkljucen" ${cfg.ukljucen ? "checked" : ""}><span class="slider"></span></label></div>
    <div class="card-sub">Jednom nedeljno može da zavrti svako ko je za tih 7 dana potrošio bar prag. Ishod bira server, igrač ne može da namesti.</div>
    <div class="set-rows" style="padding:0 16px">
      ${setRow("Prag potrošnje (nedeljno)", `Igrač mora toliko da potroši za 7 dana da bi smeo da vrti${rph > 0 ? ` (~${(cfg.prag / rph).toFixed(1)}h igre)` : ""}`, `<div class="input-suffix"><input id="tocakPrag" type="number" value="${cfg.prag}" /><span>${cur()}</span></div>`)}
    </div>
    <div class="card-sub" style="display:flex;justify-content:space-between;align-items:center">Polja na točku
      <button class="btn btn-sm" id="nagNova">${icon("plus")} Nagrada</button></div>
    <div class="paketi-lista">${nagRedovi}</div>`;
  const sw = $("#tocakUkljucen");
  if (sw) sw.addEventListener("change", async () => {
    try { await api("/tocak", "POST", { ukljucen: sw.checked }); toast(sw.checked ? "Točak je uključen" : "Točak je isključen", "success"); }
    catch (e) { toast(e.message, "error"); sw.checked = !sw.checked; }
  });
  const prag = $("#tocakPrag");
  if (prag) prag.addEventListener("change", async () => {
    try { await api("/tocak", "POST", { prag: prag.value }); toast("Prag sačuvan", "success"); ucitajTocak(); }
    catch (e) { toast(e.message, "error"); }
  });
  const nn = $("#nagNova");
  if (nn) nn.addEventListener("click", () => nagradaModal());
}
function nagradaModal(n) {
  const g = n || { naziv: "", kredit: 100, tezina: 10 };
  modal(n ? "Izmena nagrade" : "Nova nagrada", `
    <div class="field"><label>Naziv (šta piše na polju)</label><input id="ngName" value="${esc(g.naziv)}" placeholder="npr. 100 din, ili Ništa" autofocus /></div>
    <div class="form-row">
      <div class="field"><label>Kredit (0 = prazno)</label><input id="ngKredit" type="number" value="${g.kredit}" /></div>
      <div class="field"><label>Težina (veće = češće)</label><input id="ngTezina" type="number" value="${g.tezina}" /></div>
    </div>
    <div class="err-msg" id="ngErr"></div>
    <button class="btn btn-primary btn-block" id="ngSave">Sačuvaj</button>`, (root, close) => {
    $("#ngSave", root).addEventListener("click", async () => {
      const body = { naziv: $("#ngName", root).value, kredit: $("#ngKredit", root).value, tezina: $("#ngTezina", root).value };
      try {
        if (n) await api(`/tocak/nagrade/${n.id}`, "PUT", body); else await api("/tocak/nagrade", "POST", body);
        toast("Sačuvano", "success"); close(); ucitajTocak();
      } catch (e) { $("#ngErr", root).textContent = e.message; }
    });
  });
}
document.addEventListener("click", async (e) => {
  const iz = e.target.closest("[data-nag-izmeni]");
  const br = e.target.closest("[data-nag-brisi]");
  if (iz) { const n = (window._tocak?.nagrade || []).find((x) => x.id === Number(iz.dataset.nagIzmeni)); if (n) nagradaModal(n); }
  else if (br) {
    const id = Number(br.dataset.nagBrisi);
    if (await confirmDialog("Nagrada će biti obrisana.", { title: "Brisanje nagrade", ok: "Obriši", danger: true })) {
      try { await api(`/tocak/nagrade/${id}`, "DELETE"); ucitajTocak(); } catch (err) { toast(err.message, "error"); }
    }
  }
});

// Vremenski paketi u podešavanjima - lista sa izmenom i brisanjem.
async function ucitajPakete() {
  const box = $("#paketiLista");
  if (!box) return;
  let lista = [];
  try { lista = await api("/paketi"); } catch {}
  if (!$("#paketiLista")) return;
  if (!lista.length) {
    box.innerHTML = `<div class="empty" style="padding:18px">${icon("clock")}<div class="e-t">Još nema paketa</div>
      <div class="e-s">Dodaj paket kao „5 sati za 500“ pa ga osoblje prodaje na dopuni.</div></div>`;
    return;
  }
  const rph = ratePerHour();
  box.innerHTML = lista.map((p) => {
    const vredi = rph > 0 ? Math.round(p.hours * rph) : 0;
    const ušteda = vredi > p.price ? ` <span class="pos">ušteda ${money(vredi - p.price)}</span>` : "";
    return `<div class="paket-stavka ${p.available ? "" : "off"}">
      <div class="paket-info"><b>${esc(p.name)}</b> <span class="faint">${p.hours}h za ${money(p.price)}${ušteda}</span></div>
      <div class="paket-akcije">
        <button class="btn btn-sm btn-ghost" data-paket-izmeni="${p.id}" title="Izmeni">${icon("edit")}</button>
        <button class="btn btn-sm btn-ghost" data-paket-vid="${p.id}" title="${p.available ? "Sakrij" : "Prikaži"}">${icon(p.available ? "eye" : "eyeoff")}</button>
        <button class="btn btn-sm btn-ghost del" data-paket-brisi="${p.id}" title="Obriši">${icon("trash")}</button>
      </div></div>`;
  }).join("");
  window._paketi = lista;
}
function paketModal(paket) {
  const p = paket || { name: "", hours: 5, price: 500 };
  modal(paket ? "Izmena paketa" : "Novi paket", `
    <div class="field"><label>Naziv</label><input id="pkName" value="${esc(p.name)}" placeholder="npr. 5 sati" autofocus /></div>
    <div class="form-row">
      <div class="field"><label>Sati</label><input id="pkHours" type="number" step="0.5" value="${p.hours}" /></div>
      <div class="field"><label>Cena (${cur()})</label><input id="pkPrice" type="number" value="${p.price}" /></div>
    </div>
    <div class="err-msg" id="pkErr"></div>
    <button class="btn btn-primary btn-block" id="pkSave">Sačuvaj</button>`, (root, close) => {
    $("#pkSave", root).addEventListener("click", async () => {
      const body = { name: $("#pkName", root).value, hours: $("#pkHours", root).value, price: $("#pkPrice", root).value };
      try {
        if (paket) await api(`/paketi/${paket.id}`, "PUT", body); else await api("/paketi", "POST", body);
        toast("Sačuvano", "success"); close(); ucitajPakete();
      } catch (e) { $("#pkErr", root).textContent = e.message; }
    });
  });
}
document.addEventListener("click", async (e) => {
  const iz = e.target.closest("[data-paket-izmeni]");
  const vid = e.target.closest("[data-paket-vid]");
  const br = e.target.closest("[data-paket-brisi]");
  if (iz) { const p = (window._paketi || []).find((x) => x.id === Number(iz.dataset.paketIzmeni)); if (p) paketModal(p); }
  else if (vid) {
    const p = (window._paketi || []).find((x) => x.id === Number(vid.dataset.paketVid)); if (!p) return;
    try { await api(`/paketi/${p.id}`, "PUT", { name: p.name, hours: p.hours, price: p.price, available: !p.available }); ucitajPakete(); }
    catch (err) { toast(err.message, "error"); }
  }
  else if (br) {
    const id = Number(br.dataset.paketBrisi);
    if (await confirmDialog("Paket će biti obrisan.", { title: "Brisanje paketa", ok: "Obriši", danger: true })) {
      try { await api(`/paketi/${id}`, "DELETE"); ucitajPakete(); } catch (err) { toast(err.message, "error"); }
    }
  }
});

// KOPIJA VAN RAČUNARA.
//
// Baza i sve rezervne kopije stoje na istom disku. Sve gore na ovoj strani
// pazi da disk ne PUKNE od punoće - ništa od toga ne pomaže kad disk OTKAŽE.
// Tog dana nestaje sve odjednom: nalozi, kredit koji su gosti uplatili, promet.
//
// Zato ova kartica ne ćuti dok nije podešena. Prazno odredište stoji žuto,
// zastarela kopija crveno - da se stanje vidi na strani koju vlasnik ionako
// otvara, umesto da se otkrije onog dana kad zatreba.
async function ucitajKopijuVan() {
  const telo = $("#kopijaVanTelo");
  if (!telo) return;
  let d;
  try { d = await api("/kopija-van"); } catch { telo.innerHTML = '<div class="faint">Stanje nije učitano</div>'; return; }
  if (!$("#kopijaVanTelo")) return;

  const poruka = {
    nepodesena: ["upozorenje-fabricko", "<b>Kopija se ne odnosi van računara.</b>",
      "Baza i sve rezervne kopije su na istom disku. Ako taj disk otkaže, nestaje i jedno i drugo. " +
      "Upiši odredište - USB koji stalno stoji u računaru, drugi disk ili mrežni folder."],
    nikad: ["upozorenje-fabricko", "<b>Odredište je upisano, ali kopija još nije otišla.</b>",
      "Klikni „Kopiraj sada“ i proveri da fajl stvarno stigne."],
    zastarela: ["upozorenje-fabricko", "<b>Poslednja kopija van računara je zastarela.</b>",
      "Najčešće je USB iščupan ili mrežni disk nedostupan. Dok ovo stoji, baza postoji samo na jednom disku."],
    pala: ["upozorenje-fabricko", "<b>Poslednje kopiranje nije uspelo.</b>",
      "Odredište nije dostupno. Proveri da li je disk priključen, pa klikni „Kopiraj sada“ - " +
      "dok ovo stoji, nove kopije ne izlaze van računara."],
    uredna: null,
  }[d.stanje];

  telo.innerHTML =
    (poruka ? `<div class="${poruka[0]}" style="margin-bottom:12px"><div>${poruka[1]} <span>${poruka[2]}</span></div></div>` : "") +
    `<div class="kv-list" style="padding-top:0">
      ${kv("Odredište", d.putanja ? `<span class="mono">${esc(d.putanja)}</span>` : '<span class="faint">nije podešeno</span>')}
      ${kv("Poslednja kopija", d.poslednja
        ? `<span class="${d.stanje === "zastarela" ? "zero" : "pos"}">${timeAgo(d.poslednja)}</span>`
        : '<span class="faint">nikad</span>')}
      ${d.greska ? red("Poslednja greška", `<span class="zero mono">${esc(d.greska)}</span>`) : ""}
      ${kv("Automatski", `jednom dnevno, čuva se poslednjih ${d.zadrzi}`)}
    </div>
    <div class="card-sub" style="margin:10px -18px 0">Odredište</div>
    <div class="field" style="margin-top:10px">
      <input id="kvPut" placeholder="npr. E:\\crit-kopije  ili  \\\\server\\kopije" value="${esc(d.putanja || "")}" />
      <div class="faint" style="font-size:12px;margin-top:6px">Prazno polje isključuje kopiranje. Odredište se proverava odmah pri čuvanju.</div>
    </div>
    <div class="card-foot" style="margin:12px -18px -18px">
      <button class="btn btn-primary" id="kvSacuvaj">Sačuvaj odredište</button>
      <button class="btn" id="kvSada" ${d.putanja ? "" : "disabled"}>${icon("download")} Kopiraj sada</button>
    </div>`;

  $("#kvSacuvaj").onclick = async () => {
    try {
      await api("/kopija-van", "POST", { putanja: $("#kvPut").value.trim() });
      toast($("#kvPut").value.trim() ? "Odredište sačuvano - kopija je poslata" : "Kopiranje van računara isključeno", "success");
      ucitajKopijuVan();
    } catch (err) { toast(err.message, "error"); }
  };
  $("#kvSada").onclick = async () => {
    const b = $("#kvSada"); b.disabled = true;
    try { await api("/kopija-van/sada", "POST"); toast("Kopija je odneta van računara", "success"); }
    catch (err) { toast(err.message, "error"); }
    finally { ucitajKopijuVan(); }
  };
}

// Kopije se preuzimaju direktno, sa tokenom u zaglavlju - zato ide preko
// blob-a, a ne kao obican link koji bi vratio 401.
async function ucitajKopije() {
  const tb = $("#kopijeRedovi");
  if (!tb) return;
  let spisak = [];
  try { spisak = await api("/kopije"); } catch { }
  if (!$("#kopijeRedovi")) return;
  if (!spisak.length) {
    tb.innerHTML = '<tr><td class="empty" style="padding:18px">Još nema kopija</td></tr>';
    return;
  }
  // Pet poslednjih je dovoljno da se vidi da kopije rade; red iznad kaze koliko
  // ih se ukupno cuva, a osam redova je samo produzavalo stranu.
  tb.innerHTML = spisak.slice(0, 5).map((k) => `<tr>
    <td class="mono faint" style="font-size:13px;white-space:nowrap">${dt(k.vreme)}</td>
    <td class="faint">${fmtBytes(k.velicina)}</td>
    <td style="text-align:right"><button class="btn btn-sm btn-ghost" data-kopija="${esc(k.fajl)}">${icon("download")} Preuzmi</button></td>
  </tr>`).join("");
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-kopija]");
  if (!b) return;
  const fajl = b.dataset.kopija;
  b.disabled = true;
  try {
    const r = await fetch(`/api${""}/kopije/${encodeURIComponent(fajl)}`, { headers: { authorization: "Bearer " + state.token } });
    if (!r.ok) throw new Error("Preuzimanje nije uspelo");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fajl;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Kopija je preuzeta", "success");
  } catch (err) { toast(err.message, "error"); }
  b.disabled = false;
});

// Start
if (state.token) {
  api("/me").then((d) => { state.admin = d.admin; enterApp(); }).catch(() => { state.token = null; localStorage.removeItem("crit_token"); });
}
