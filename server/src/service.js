import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dgram from "node:dgram";
import { fileURLToPath } from "node:url";
import { db, getSetting, setSetting, DATA_DIR, uJednomPoslu } from "./db.js";
import { verifyPassword, hashPassword } from "./auth.js";
import { broadcastPanels, broadcastClients, sendClient, isClientOnline, izbaciPanel } from "./hub.js";
import { banerIgre, promoCrit } from "./banner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ID trenutno otvorene smene (keširano; inicijalizuje se na dnu fajla)
let activeShiftId = null;

// Pomoćne
export function settingsObj() {
  return {
    cafeName: getSetting("cafe_name", "Crit"),
    currency: getSetting("currency", "RSD"),
    ratePerHour: Number(getSetting("rate_per_hour", "120")),
    unlockPin: getSetting("unlock_pin", "1234"),
    idleMinutes: Number(getSetting("idle_minutes", "15")),
    fabrickaLozinka: fabrickaLozinkaVlasnika(),
  };
}

// Da li vlasnik jos uvek ima fabricku lozinku (admin / admin).
// Panel je dostupan sa svakog telefona na mrezi, a preko njega se dopunjuje
// kredit - ko udje sa admin/admin moze sebi da upise koliko hoce. Dosad je o
// tome pisalo samo u konzoli servera, koju niko ne cita.
// Racuna se jednom i pamti: provera je scrypt, ne sme na svaki zahtev.
let _fabricka = null;
export function fabrickaLozinkaVlasnika() {
  if (_fabricka !== null) return _fabricka;
  try {
    const v = db.prepare("SELECT password_hash FROM admins WHERE role='owner' ORDER BY id LIMIT 1").get();
    _fabricka = !!v && verifyPassword("admin", v.password_hash);
  } catch { _fabricka = false; }
  return _fabricka;
}
// Poziva se kad se lozinka promeni, da upozorenje odmah nestane.
export function zaboraviProveruLozinke() { _fabricka = null; }

function rate() {
  // Ako cena po satu ikako ispadne ne-broj (rucna izmena baze, stara kopija),
  // NaN bi prosao kroz naplatu i svakom igracu spustio stanje na nulu, pa bi im
  // sistem redom zakljucao racunare. Nula znaci "ne naplacuj" i bar je bezopasna.
  const r = Number(getSetting("rate_per_hour", "120"));
  return Number.isFinite(r) && r > 0 ? r : 0;
}

export function remainingSeconds(balance) {
  const r = rate();
  if (r <= 0) return null; // neograničeno
  return Math.max(0, Math.floor((balance / r) * 3600));
}

function playerById(id) {
  return db.prepare("SELECT * FROM players WHERE id = ?").get(id);
}
function computerById(id) {
  return db.prepare("SELECT * FROM computers WHERE id = ?").get(id);
}
function activeSessionForComputer(computerId) {
  return db
    .prepare("SELECT * FROM sessions WHERE computer_id = ? AND status = 'active'")
    .get(computerId);
}

function addTransaction(playerId, type, amount, balanceAfter, adminId, note) {
  db.prepare(
    "INSERT INTO transactions (player_id, type, amount, balance_after, admin_id, note, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(playerId, type, amount, balanceAfter, adminId || null, note || null, Date.now());
}

// Logovi / audit
//
// UPIS I JAVLJANJE SU RAZDVOJENI, i to namerno.
//
// Obračun smene se ne računa iz tabele `transactions` nego IZ LOGOVA (po
// shift_id). Zato zapis u logu nije beleška o dopuni - on JESTE dopuna, koliko
// se kase tiče. Kad se novac i taj zapis upisuju odvojeno, pad između njih
// ostavlja kredit na nalogu koji nijedan obračun ne pominje: radnik na kraju
// smene ima manjak koji ne ume da objasni, a gost je uredno platio.
//
// `upisiLog` je zato upis BEZ javljanja i BEZ gutanja greške - da može da uđe u
// isti posao sa novcem i da ga obori ako ne prođe. Javljanje panelima ide POSLE
// potvrde upisa (`javiLog`), jer bi inače radnik u feedu video dopunu koje u
// bazi nema.
function upisiLog({ category, action, actor = "sistem", target = null, detail = null, amount = null }) {
  const ts = Date.now();
  db.prepare("INSERT INTO logs (ts, category, action, actor, target, detail, amount, shift_id) VALUES (?,?,?,?,?,?,?,?)")
    .run(ts, category, action, actor, target, detail, amount == null ? null : Math.round(amount * 100) / 100, activeShiftId);
  return { ts, category, action, actor, target, detail, amount };
}
// Javi panelima zapis koji je već potvrđeno upisan.
function javiLog(log) {
  if (log) try { broadcastPanels({ t: "log", log }); } catch {}
}
export function logEvent(o) {
  try { javiLog(upisiLog(o)); } catch {}
}
export function getLogs({ category, search, limit = 200 } = {}) {
  let sql = "SELECT * FROM logs";
  const cond = [], args = [];
  if (category && category !== "sve") { cond.push("category = ?"); args.push(category); }
  if (search) { const s = `%${search}%`; cond.push("(detail LIKE ? OR actor LIKE ? OR target LIKE ?)"); args.push(s, s, s); }
  if (cond.length) sql += " WHERE " + cond.join(" AND ");
  sql += " ORDER BY ts DESC LIMIT ?";
  args.push(Math.min(1000, Number(limit) || 200));
  return db.prepare(sql).all(...args);
}

// Rotacija logova - baza radi godinama, ne sme da raste bez granice.
// Bezbedno je: zatvorene smene čuvaju svoje konačne brojke u tabeli `shifts`,
// a otvorena smena se nikad ne dira.
// stranična lista logova (ne učitava celu bazu)
export function logsPage({ category, search, page = 1, per = 25 } = {}) {
  const cond = [], args = [];
  if (category && category !== "sve") { cond.push("category = ?"); args.push(category); }
  if (search) { const s = `%${search}%`; cond.push("(detail LIKE ? OR actor LIKE ? OR target LIKE ?)"); args.push(s, s, s); }
  const where = cond.length ? " WHERE " + cond.join(" AND ") : "";
  const total = db.prepare(`SELECT COUNT(*) c FROM logs${where}`).get(...args).c;
  per = Math.min(100, Math.max(5, Number(per) || 25));
  const pages = Math.max(1, Math.ceil(total / per));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const items = db.prepare(`SELECT * FROM logs${where} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per);
  return { items, total, page, pages, per };
}

// SMENE (shifts)
export function getActiveShift() {
  return db.prepare("SELECT * FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1").get() || null;
}

function shiftTotals(shiftId, openedAt, until = Date.now()) {
  const one = (sql) => db.prepare(sql).get(shiftId).s;
  const topups = one("SELECT COALESCE(SUM(amount),0) s FROM logs WHERE shift_id=? AND category='novac' AND amount>0");
  const deductsNeg = one("SELECT COALESCE(SUM(amount),0) s FROM logs WHERE shift_id=? AND category='novac' AND amount<0");
  // otkazane porudžbine se poništavaju kroz log sa pozitivnim iznosom (order_cancel)
  const shop = one("SELECT COALESCE(SUM(-amount),0) s FROM logs WHERE shift_id=? AND category='shop' AND amount IS NOT NULL");
  const sessions = one("SELECT COALESCE(SUM(-amount),0) s FROM logs WHERE shift_id=? AND category='sesija' AND amount IS NOT NULL");
  const shopCash = db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment='cash' AND status!='cancelled' AND created_at>=? AND created_at<=?").get(openedAt, until).s;
  const deducts = round2(-deductsNeg); // pozitivan broj = koliko je skinuto
  return {
    topups: round2(topups),
    deducts,
    shop: round2(shop),
    shopCash: round2(shopCash),
    shopCredit: round2(shop - shopCash),
    sessions: round2(sessions),
    // PAZAR = novac koji je stvarno ušao u kasu tokom smene.
    // Kupovina sa naloga NIJE nov novac (taj novac je ušao ranije, pri dopuni),
    // pa se ne sabira ovde - inače bi se isti dinar brojao dvaput.
    revenue: round2(topups - deducts + shopCash),
  };
}

// NOVAC NAPLAĆEN VAN SMENE (danas)
//
// Obračun smene se računa iz logova po shift_id. Kad smena nije otvorena, log
// ostaje bez nje - novac je uredno zapisan i vidi se u Izveštajima, ali ne
// pripada nijednom obračunu.
//
// Za radnika to znači da na kraju dana ima keš u kasi koji obračun ne pominje,
// pa izgleda kao višak koji niko ne ume da objasni. A uputstvo za otvaranje
// igraonice smenu ni ne pominje, tako da će se to desiti baš prvog dana.
//
// Zato se ovaj iznos računa i pokazuje: na kontrolnoj tabli dok smena nije
// otvorena, i u obračunu pri zatvaranju smene, gde se kasa i broji.
export function novacVanSmene(odKada = null) {
  const pocetakDana = odKada ?? new Date().setHours(0, 0, 0, 0);
  try {
    const dopune = db.prepare(
      "SELECT COALESCE(SUM(amount),0) s FROM logs WHERE shift_id IS NULL AND ts>=? AND category='novac' AND amount>0").get(pocetakDana).s;
    const kesUShopu = db.prepare(
      "SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment='cash' AND status!='cancelled' AND created_at>=? " +
      "AND NOT EXISTS (SELECT 1 FROM shifts sh WHERE orders.created_at>=sh.opened_at AND orders.created_at<=COALESCE(sh.closed_at, 9e18))").get(pocetakDana).s;
    return round2(dopune + kesUShopu);
  } catch { return 0; }
}

export function activeShiftInfo() {
  const s = getActiveShift();
  if (!s) return null;
  return { id: s.id, admin: s.admin_username, openedAt: s.opened_at, openingCash: round2(s.opening_cash), totals: shiftTotals(s.id, s.opened_at) };
}

export function openShift(adminId, username, openingCash) {
  if (getActiveShift()) return { error: "Smena je već otvorena" };
  const now = Date.now();
  const info = db.prepare("INSERT INTO shifts (admin_id, admin_username, opened_at, opening_cash, status) VALUES (?,?,?,?, 'open')")
    .run(adminId, username, now, Number(openingCash) || 0);
  activeShiftId = Number(info.lastInsertRowid);
  logEvent({ category: "sistem", action: "shift_open", actor: username, detail: `Otvorena smena - početno stanje kase ${round2(openingCash)}`, amount: Number(openingCash) || 0 });
  broadcastPanels({ t: "shift", shift: activeShiftInfo() });
  return { ok: true, shift: activeShiftInfo() };
}

export function closeShift(username, closingCash) {
  const s = getActiveShift();
  if (!s) return { error: "Nema otvorene smene" };
  const now = Date.now();
  const t = shiftTotals(s.id, s.opened_at, now);
  const expectedCash = round2(s.opening_cash + t.topups - t.deducts + t.shopCash);
  const closing = closingCash === null || closingCash === undefined || closingCash === "" ? null : Number(closingCash);
  const diff = closing == null ? null : round2(closing - expectedCash);
  db.prepare("UPDATE shifts SET status='closed', closed_at=?, closing_cash=?, total_topups=?, total_deducts=?, total_shop=?, total_revenue=?, total_shop_cash=?, total_sessions=? WHERE id=?")
    .run(now, closing, t.topups, t.deducts, t.shop, t.revenue, t.shopCash, t.sessions, s.id);
  logEvent({ category: "sistem", action: "shift_close", actor: username, detail: `Zatvorena smena #${s.id} - pazar ${t.revenue}`, amount: t.revenue });

  // MANJAK I VIŠAK IDU U LOGOVE, ZASEBNO.
  //
  // Logovi su jedino mesto koje se pretražuje unazad. Dok je razlika stajala
  // samo u obračunu te smene, niko je nije mogao naći bez otvaranja svake
  // smene ponaosob - a manjak u kasi je baš ono što se traži unazad, i po
  // radniku i po danu.
  if (diff != null && Math.abs(diff) >= 0.5) {
    logEvent({
      category: "novac",
      action: diff < 0 ? "kasa_manjak" : "kasa_visak",
      actor: username,
      target: `smena #${s.id}`,
      detail: diff < 0
        ? `Manjak u kasi: prebrojano ${closing}, očekivano ${expectedCash}`
        : `Višak u kasi: prebrojano ${closing}, očekivano ${expectedCash}`,
      // Iznos NIJE u polju amount: tamo se sabira pazar, pa bi manjak
      // pokvario obračun smene u kojoj je zapisan. Stoji u opisu.
    });
  }
  activeShiftId = null;
  broadcastPanels({ t: "shift", shift: null });
  return {
    ok: true,
    summary: {
      id: s.id, admin: s.admin_username, openedAt: s.opened_at, closedAt: now,
      openingCash: round2(s.opening_cash), closingCash: closing,
      topups: t.topups, deducts: t.deducts, shop: t.shop, shopCash: t.shopCash, shopCredit: t.shopCredit, sessions: t.sessions,
      revenue: t.revenue, expectedCash, difference: diff,
    },
  };
}

// OBJAŠNJENJE UZ SMENU.
//
// Kad se kasa ne poklopi, uvek postoji razlog: vraćen novac gostu, kusur uzet
// iz kase za sitno, radnik se prebrojao. Bez mesta da se to zapiše, razlika
// ostaje gola brojka koju posle mesec dana niko ne ume da objasni, a izgleda
// kao krađa. Kolona je u bazi stajala od početka, ali se nigde nije koristila.
export function zabeleziUzSmenu(id, tekst) {
  const s = db.prepare("SELECT id FROM shifts WHERE id=?").get(id);
  if (!s) return { error: "Smena ne postoji" };
  const t = String(tekst ?? "").trim().slice(0, 500);
  db.prepare("UPDATE shifts SET note=? WHERE id=?").run(t || null, id);
  return { ok: true, note: t || null };
}

export function shiftsList(limit = 50) {
  return db.prepare("SELECT * FROM shifts ORDER BY id DESC LIMIT ?").all(Math.min(200, Number(limit) || 50))
    .map((s) => {
      // RAZLIKA IDE U SAM SPISAK.
      //
      // To je jedino zbog čega vlasnik i otvara ovu stranu: da vidi gde se kasa
      // nije poklopila. Dok je stajala samo u detalju, morao je da klikne na
      // svaku smenu posebno - a njih je šezdesetak mesečno, pa se ne gleda.
      const zatvorena = s.status === "closed" && s.total_topups != null;
      const ocekivano = zatvorena
        ? round2(s.opening_cash + (s.total_topups || 0) - (s.total_deducts || 0) + (s.total_shop_cash || 0))
        : null;
      const razlika = ocekivano != null && s.closing_cash != null ? round2(s.closing_cash - ocekivano) : null;
      return {
        id: s.id, admin: s.admin_username, openedAt: s.opened_at, closedAt: s.closed_at,
        openingCash: round2(s.opening_cash),
        closingCash: s.closing_cash == null ? null : round2(s.closing_cash),
        revenue: s.total_revenue == null ? null : round2(s.total_revenue),
        expectedCash: ocekivano, difference: razlika, note: s.note || null,
        status: s.status,
      };
    });
}

// Izveštaji / statistika
export function stats(from, to) {
  const g2 = (sql) => db.prepare(sql).get(from, to).s;
  // Trošak sesije se u `transactions` upisuje tek pri završetku, pa "ukupan
  // promet" nije video nikoga ko trenutno igra - a "zarada po računaru" niže
  // čita `sessions.cost` i vidi ga. Dva broja na istoj strani se onda nisu
  // poklapala, i to najviše baš uveče, kad su sve mašine pune.
  //
  // Aktivne sesije se dodaju samo kad period ide DO SADA (Danas / 7 / 30 dana).
  // Za zatvoren period u prošlosti nemaju šta da traže.
  const sadaUPeriodu = to >= Date.now() - 60000;
  const uToku = sadaUPeriodu
    ? db.prepare("SELECT COALESCE(SUM(cost),0) s FROM sessions WHERE status='active' AND started_at<=?").get(to).s
    : 0;
  const sessionRev = g2("SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE type='session' AND created_at BETWEEN ? AND ?") + uToku;
  const shopRev = g2("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status!='cancelled' AND created_at BETWEEN ? AND ?");
  const shopCash = g2("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment='cash' AND status!='cancelled' AND created_at BETWEEN ? AND ?");
  const topups = g2("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='topup' AND created_at BETWEEN ? AND ?");
  // Poklonjen kredit: nagradni točak i popust na vremenski paket. Ne ulazi u
  // pazar (nije novac u kasi), ali vlasnik mora da vidi koliko ga je koštao -
  // inače se trošak nigde ne pojavljuje i točak izgleda kao da je besplatan.
  const poklonjeno = g2("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='bonus' AND created_at BETWEEN ? AND ?");
  const sessCount = db.prepare("SELECT COUNT(*) c FROM sessions WHERE started_at BETWEEN ? AND ?").get(from, to).c;
  const playSec = db.prepare("SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at),0) s FROM sessions WHERE started_at BETWEEN ? AND ?").get(Date.now(), from, to).s;

  const dayFmt = "strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime')";
  const hourFmt = "CAST(strftime('%H', created_at/1000, 'unixepoch', 'localtime') AS INTEGER)";
  const merge = (sessRows, shopRows, keyName) => {
    const map = {};
    for (const r of sessRows) map[r.k] = (map[r.k] || 0) + r.v;
    for (const r of shopRows) map[r.k] = (map[r.k] || 0) + r.v;
    return map;
  };
  const sByDay = db.prepare(`SELECT ${dayFmt} k, SUM(-amount) v FROM transactions WHERE type='session' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const oByDay = db.prepare(`SELECT ${dayFmt} k, SUM(total) v FROM orders WHERE status!='cancelled' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const dayMap = merge(sByDay, oByDay);
  const byDay = Object.keys(dayMap).sort().map((d) => ({ label: d.slice(8) + "." + d.slice(5, 7), revenue: round2(dayMap[d]) }));

  const sByHour = db.prepare(`SELECT ${hourFmt} k, SUM(-amount) v FROM transactions WHERE type='session' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const oByHour = db.prepare(`SELECT ${hourFmt} k, SUM(total) v FROM orders WHERE status!='cancelled' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const hourMap = merge(sByHour, oByHour);
  const byHour = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, "0"), revenue: round2(hourMap[h] || 0) }));

  const topPlayers = db.prepare("SELECT p.username u, COALESCE(SUM(-t.amount),0) spent FROM transactions t JOIN players p ON p.id=t.player_id WHERE t.type IN ('session','shop') AND t.created_at BETWEEN ? AND ? GROUP BY p.id ORDER BY spent DESC LIMIT 8")
    .all(from, to).map((r) => ({ username: r.u, spent: round2(r.spent) }));
  const byComputer = db.prepare("SELECT c.name n, COALESCE(SUM(s.cost),0) rev, COUNT(*) cnt FROM sessions s JOIN computers c ON c.id=s.computer_id WHERE s.started_at BETWEEN ? AND ? GROUP BY c.id ORDER BY rev DESC")
    .all(from, to).map((r) => ({ name: r.n, revenue: round2(r.rev), sessions: r.cnt }));

  // Novi igrači u periodu - vlasniku pokazuje da li mesto raste.
  const newPlayers = db.prepare("SELECT COUNT(*) c FROM players WHERE created_at BETWEEN ? AND ?").get(from, to).c;
  // Najprometniji sat (danas) ili dan (nedelja/mesec) - kad je najveća gužva.
  const vrhSat = byHour.reduce((a, h) => (h.revenue > a.revenue ? h : a), { label: "", revenue: 0 });
  const vrhDan = byDay.reduce((a, h) => (h.revenue > a.revenue ? h : a), { label: "", revenue: 0 });
  return {
    revenue: { session: round2(sessionRev), shop: round2(shopRev), shopCash: round2(shopCash), shopCredit: round2(shopRev - shopCash), topups: round2(topups), poklonjeno: round2(poklonjeno), total: round2(sessionRev + shopRev) },
    sessions: {
      count: sessCount, minutes: Math.round(playSec / 60000),
      // Prosečan promet po sesiji - koliko u proseku ostavi jedan gost.
      avg: sessCount ? round2(sessionRev / sessCount) : 0,
      avgMin: sessCount ? Math.round(playSec / 60000 / sessCount) : 0,
    },
    newPlayers,
    peak: { hour: vrhSat, day: vrhDan },
    byDay, byHour, topPlayers, byComputer,
    topGames: najigranije(from, to),
  };
}

// pun obračun jedne smene (radi i za otvorenu - računa do sada)
export function shiftDetail(id) {
  const s = db.prepare("SELECT * FROM shifts WHERE id=?").get(id);
  if (!s) return null;
  const until = s.closed_at || Date.now();
  // Zatvorena smena koristi brojke zapamćene pri zatvaranju - obračun mora da
  // ostane isti zauvek, bez obzira na kasnije izmene ili rotaciju logova.
  const stored = s.status === "closed" && s.total_revenue != null && s.total_shop_cash != null;
  const t = stored
    ? {
        topups: round2(s.total_topups || 0),
        deducts: round2(s.total_deducts || 0),
        shop: round2(s.total_shop || 0),
        shopCash: round2(s.total_shop_cash || 0),
        shopCredit: round2((s.total_shop || 0) - (s.total_shop_cash || 0)),
        sessions: round2(s.total_sessions || 0),
        revenue: round2(s.total_revenue || 0),
      }
    : shiftTotals(s.id, s.opened_at, until);
  const expectedCash = round2(s.opening_cash + t.topups - t.deducts + t.shopCash);
  const closing = s.closing_cash == null ? null : round2(s.closing_cash);
  const diff = closing == null ? null : round2(closing - expectedCash);
  return {
    id: s.id, admin: s.admin_username, openedAt: s.opened_at, closedAt: s.closed_at, status: s.status,
    openingCash: round2(s.opening_cash), closingCash: closing,
    topups: t.topups, deducts: t.deducts, shop: t.shop, shopCash: t.shopCash, shopCredit: t.shopCredit, sessions: t.sessions,
    revenue: t.revenue, expectedCash, difference: diff, note: s.note || null,
  };
}

// Snapshoti za panel
export function computersSnapshot() {
  const rows = db.prepare("SELECT * FROM computers ORDER BY name").all();
  return rows.map((c) => {
    const online = isClientOnline(c.id);
    let player = null;
    let session = null;
    if (c.current_player_id) {
      const p = playerById(c.current_player_id);
      if (p) {
        player = { id: p.id, username: p.username, displayName: p.display_name, balance: round2(p.balance) };
        session = {
          id: c.current_session_id,
          remainingSeconds: remainingSeconds(p.balance),
        };
        const s = c.current_session_id ? db.prepare("SELECT * FROM sessions WHERE id=?").get(c.current_session_id) : null;
        if (s) session.startedAt = s.started_at, session.cost = round2(s.cost);
      }
    }
    return {
      id: c.id,
      name: c.name,
      status: online ? c.status : "offline",
      online,
      lastSeen: c.last_seen,
      ip: c.ip || null,
      mac: c.mac || null,
      verzija: c.launcher_version || null,
      // null = launcher to ne javlja (starija verzija); true = PIN je fabrički
      pinFabricki: c.pin_fabricki == null ? null : !!c.pin_fabricki,
      connectedAt: connectedSince.get(c.id) || null,
      player,
      session,
    };
  });
}

const mapPlayer = (p) => ({
  id: p.id,
  username: p.username,
  displayName: p.display_name,
  balance: round2(p.balance),
  banned: !!p.banned,
  note: p.note,
  createdAt: p.created_at,
  lastLogin: p.last_login,
});

export function playersSnapshot() {
  return db
    .prepare("SELECT id, username, display_name, balance, banned, note, created_at, last_login FROM players ORDER BY username")
    .all()
    .map(mapPlayer);
}

// stranična lista igrača (za tabelu - ne učitava celu bazu)
export function playersPage({ page = 1, per = 25, search = "" } = {}) {
  const cond = search ? "WHERE username LIKE ? OR display_name LIKE ?" : "";
  const args = search ? [`%${search}%`, `%${search}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM players ${cond}`).get(...args).c;
  per = Math.min(100, Math.max(5, Number(per) || 25));
  const pages = Math.max(1, Math.ceil(total / per));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const items = db
    .prepare(`SELECT id, username, display_name, balance, banned, note, created_at, last_login FROM players ${cond} ORDER BY username LIMIT ? OFFSET ?`)
    .all(...args, per, (page - 1) * per)
    .map(mapPlayer);
  return { items, total, page, pages, per };
}

export function ordersSnapshot(includeDone = false) {
  const where = includeDone ? "" : "WHERE o.status IN ('pending','preparing')";
  const orders = db
    .prepare(
      `SELECT o.*, p.username, c.name AS computer_name
       FROM orders o
       LEFT JOIN players p ON p.id = o.player_id
       LEFT JOIN computers c ON c.id = o.computer_id
       ${where}
       ORDER BY o.created_at DESC LIMIT 100`
    )
    .all();
  return orders.map((o) => ({
    id: o.id,
    player: o.username || null,
    computer: o.computer_name,
    total: round2(o.total),
    status: o.status,
    payment: o.payment,
    source: o.source,
    note: o.note,
    createdAt: o.created_at,
    items: db.prepare("SELECT name, price, qty FROM order_items WHERE order_id = ?").all(o.id),
  }));
}

// Porudzbine ovog igraca za njegov pregled u launcheru. Kratka poruka o statusu
// zna da promakne dok je igrac u igri, pa mora negde i da stoji.
export function igracevePorudzbine(playerId, limit = 6) {
  const rows = db.prepare(
    `SELECT id, total, status, payment, created_at FROM orders
     WHERE player_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(playerId, limit);
  return rows.map((o) => ({
    id: o.id,
    total: round2(o.total),
    status: o.status,
    payment: o.payment,
    createdAt: o.created_at,
    items: db.prepare("SELECT name, qty FROM order_items WHERE order_id = ?").all(o.id),
  }));
}

// Posalje igracu svez spisak njegovih porudzbina (ako je jos za racunarom).
function posaljiPorudzbineIgracu(playerId) {
  if (!playerId) return;
  const comp = db.prepare("SELECT id FROM computers WHERE current_player_id = ?").get(playerId);
  if (comp) sendClient(comp.id, { t: "moje_porudzbine", porudzbine: igracevePorudzbine(playerId) });
}

// Spisak rezervnih kopija. Kopija koja se ne vidi i ne moze da se preuzme je
// pola posla - vlasnik mora da zna sta ima i da moze da odnese van racunara.
export function listaKopija() {
  const dir = path.join(DATA_DIR, "backups");
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith("crit-") && f.endsWith(".db"))
      .map((f) => {
        const s = fs.statSync(path.join(dir, f));
        return { fajl: f, vreme: s.mtimeMs, velicina: s.size };
      })
      .sort((a, b) => b.vreme - a.vreme);
  } catch { return []; }
}

// Putanja do kopije, uz proveru da ime ne izlazi iz foldera sa kopijama.
export function putanjaKopije(fajl) {
  if (!/^crit-[\w-]+\.db$/.test(String(fajl || ""))) return null;
  const p = path.join(DATA_DIR, "backups", fajl);
  return fs.existsSync(p) ? p : null;
}

export function shopList() {
  return db.prepare("SELECT * FROM shop_items ORDER BY sort, name").all();
}
export function gamesList() {
  return db.prepare("SELECT * FROM games ORDER BY sort, name").all();
}
// samo dostupne igre (za launcher - sakrivene se ne šalju igraču)
export function gamesForClient() {
  return db.prepare("SELECT * FROM games WHERE available = 1 ORDER BY sort, name").all();
}

// ---- Alati / prečice (Internet sekcija u launcheru) ----
export function toolsList() {
  return db.prepare("SELECT * FROM tools ORDER BY sort, name").all();
}
export function toolsForClient() {
  return db.prepare("SELECT id, name, kind, target, args, image, color FROM tools WHERE available = 1 ORDER BY sort, name").all();
}
export function createTool({ name, kind, target, args, color, available }) {
  name = String(name || "").trim();
  kind = kind === "app" ? "app" : "web";
  target = String(target || "").trim();
  if (!name) return { error: "Naziv je obavezan" };
  if (!target) return { error: kind === "app" ? "Putanja do programa je obavezna" : "Adresa (URL) je obavezna" };
  if (kind === "web" && !/^https?:\/\//i.test(target)) return { error: "Adresa mora počinjati sa http:// ili https://" };
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort),0) s FROM tools").get().s;
  const info = db.prepare("INSERT INTO tools (name, kind, target, args, color, available, sort, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(name, kind, target, args || "", color || null, available === false ? 0 : 1, maxSort + 1, Date.now());
  return { ok: true, id: info.lastInsertRowid };
}
export function updateTool(id, { name, kind, target, args, color, available }) {
  const t = db.prepare("SELECT * FROM tools WHERE id=?").get(id);
  if (!t) return { error: "Alat ne postoji" };
  name = String(name ?? t.name).trim();
  kind = (kind ?? t.kind) === "app" ? "app" : "web";
  target = String(target ?? t.target).trim();
  if (!name) return { error: "Naziv je obavezan" };
  if (!target) return { error: "Cilj (URL ili putanja) je obavezan" };
  if (kind === "web" && !/^https?:\/\//i.test(target)) return { error: "Adresa mora počinjati sa http:// ili https://" };
  db.prepare("UPDATE tools SET name=?, kind=?, target=?, args=?, color=?, available=? WHERE id=?")
    .run(name, kind, target, args ?? t.args ?? "", color ?? t.color ?? null, available === false ? 0 : available === true ? 1 : t.available, id);
  return { ok: true };
}
export function deleteTool(id) {
  removeImage("tools", id);
  db.prepare("DELETE FROM tools WHERE id=?").run(id);
  return { ok: true };
}

// Brisanje artikla iz shopa mora da povuce i njegovu fotografiju. Igre i alati
// su to radili od pocetka, shop nije - pa je svaka obrisana limenka ostavljala
// sliku na disku zauvek.
export function deleteShopItem(id) {
  removeImage("shop_items", id);
  db.prepare("DELETE FROM shop_items WHERE id=?").run(id);
  return { ok: true };
}
export function reorderTools(ids) {
  const upd = db.prepare("UPDATE tools SET sort=? WHERE id=?");
  (ids || []).forEach((id, i) => upd.run(i, Number(id)));
  return { ok: true };
}

// ---- Zalihe pića (stock; NULL = neograničeno) ----
// Pretvara ono što je stiglo u porudžbini u čist spisak: cena UVEK iz baze,
// količina ograničena, i - najvažnije - isti artikal spojen u JEDAN red.
//
// Ranije je svaka stavka išla zasebno. Klijent koji pošalje isti artikal u pet
// redova po 20 komada je prošao proveru zaliha pet puta (svaki red se merio
// zasebno prema istoj zalihi), pa bi se prodalo sto komada iako ih na stanju
// ima dvadeset - a radnik bi tek kod frižidera video da pića nema.
// Kroz launcher se to ne može desiti (korpa je Map po artiklu), ali server ne
// sme da veruje da je klijent onakav kakvim ga mi pravimo.
export function spojiStavke(items, { najviseVrsta = 40, najviseKomada = 20, samoDostupne = true } = {}) {
  const po = new Map();
  // Radnik na kasi sme i skriven artikal (npr. nešto što se ne nudi igračima
  // kroz launcher), igrač ne sme - zato razlika u upitu.
  const upit = samoDostupne
    ? "SELECT * FROM shop_items WHERE id = ? AND available = 1"
    : "SELECT * FROM shop_items WHERE id = ?";
  for (const it of Array.isArray(items) ? items.slice(0, najviseVrsta * 4) : []) {
    const id = Number(it?.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const kolicina = Math.max(1, Math.min(najviseKomada, Math.floor(Number(it.qty) || 1)));
    if (!po.has(id)) {
      if (po.size >= najviseVrsta) continue;
      const row = db.prepare(upit).get(id);
      if (!row) continue;
      po.set(id, { item: row, qty: 0 });
    }
    const red = po.get(id);
    red.qty = Math.min(najviseKomada, red.qty + kolicina);
  }
  return [...po.values()];
}

function stockShortage(resolved) {
  return resolved.find((r) => r.item.stock != null && r.item.stock < r.qty) || null;
}
// Ispod ovoga se javlja osoblju da je vreme za dopunu magacina.
export const PRAG_ZALIHE = 5;

function consumeStock(resolved) {
  const upd = db.prepare("UPDATE shop_items SET stock = MAX(0, stock - ?) WHERE id=? AND stock IS NOT NULL");
  let changed = false;
  for (const r of resolved) {
    if (r.item.stock == null) continue;
    upd.run(r.qty, r.item.id);
    changed = true;
    // Pice nestane u spicu i sazna se tek kad gost pita. Javi cim padne
    // ispod praga, i to jednom - da ne zvoni na svakoj sledecoj porudzbini.
    const posle = db.prepare("SELECT name, stock FROM shop_items WHERE id=?").get(r.item.id);
    if (!posle) continue;
    const pre = r.item.stock;
    const nema = posle.stock === 0;
    // Dva odvojena povoda: prvi put ispod praga, i trenutak kad se stvarno
    // isprazni. Drugo mora da prodje i kad je artikal vec bio pri kraju.
    const preslo = pre > PRAG_ZALIHE && posle.stock <= PRAG_ZALIHE;
    const isprazneno = pre > 0 && nema;
    if (!preslo && !isprazneno) continue;
    broadcastPanels({ t: "event", kind: "zaliha", nema,
      text: nema ? `${posle.name} - nema više na stanju` : `${posle.name} - ostalo još ${posle.stock}` });
    logEvent({ category: "shop", action: "stock_low", actor: "sistem", target: posle.name,
      detail: nema ? "Artikal je rasprodat" : `Zaliha pri kraju: ${posle.stock}` });
  }
  if (changed) pushCatalog();
}

// OTKAZANA PORUDŽBINA VRAĆA PIĆE NA STANJE.
//
// Zaliha se skidala pri poručivanju, a pri otkazivanju se nije vraćala nikad -
// kredit jeste, zaliha ne. Svako otkazivanje je time trajno "pojelo" po jedno
// piće iz evidencije. Kroz mesec dana stanje u panelu je niže od onoga što
// stvarno stoji u frižideru: launcher piše "Rasprodato" nad punim sanducima, a
// traka za dopunu doziva radnika na artikle kojih ima.
//
// Vraća se samo ono što se DANAS vodi po komadu. Ako je vlasnik u međuvremenu
// uključio brojanje zalihe na artiklu koji je u trenutku porudžbine bio
// neograničen, ovde bi se dodao komad koji nikad nije ni skinut - retko i
// ispravlja se pri prvom brojanju frižidera.
function vratiStock(orderId) {
  const stavke = db.prepare(
    `SELECT oi.item_id, SUM(oi.qty) qty FROM order_items oi
     JOIN shop_items si ON si.id = oi.item_id
     WHERE oi.order_id = ? AND si.stock IS NOT NULL
     GROUP BY oi.item_id`).all(orderId);
  if (!stavke.length) return [];
  const upd = db.prepare("UPDATE shop_items SET stock = stock + ? WHERE id=? AND stock IS NOT NULL");
  for (const s of stavke) upd.run(s.qty, s.item_id);
  return stavke;
}

// Artikli koje treba dopuniti, za traku na kontrolnoj tabli.
export function zaliheNaIzmaku() {
  return db.prepare(
    `SELECT id, name, stock FROM shop_items
     WHERE available = 1 AND stock IS NOT NULL AND stock <= ?
     ORDER BY stock, name`
  ).all(PRAG_ZALIHE);
}

// Osoblje je izmenilo shop/igre - pošalji svež katalog svim launcherima,
// da igrač ne gleda zastareo spisak i ne pokušava da poruči skriven artikal.
export function pushCatalog() {
  broadcastClients({ t: "catalog", shop: shopList(), games: gamesForClient(), tools: toolsForClient() });
}

export function fullSnapshot() {
  return {
    t: "snapshot",
    computers: computersSnapshot(),
    orders: ordersSnapshot(),
    settings: settingsObj(),
  };
}

function pushComputers() {
  broadcastPanels({ t: "computers", computers: computersSnapshot() });
}
function pushOrders() {
  broadcastPanels({ t: "orders", orders: ordersSnapshot() });
}

// KLIJENT: konekcija / prijava
const connectedSince = new Map(); // computerId -> ts (od kada je launcher povezan)

export function onClientOpen(comp, ip, verzija) {
  connectedSince.set(comp.id, Date.now());
  // Verzija se pamti samo kad je launcher posalje. Stariji je ne salju, pa
  // ostaje ono sto je poslednje bilo poznato - a prazno polje u panelu znaci
  // "ovaj racunar ima launcher stariji od 2.22".
  db.prepare("UPDATE computers SET last_seen = ?, ip = COALESCE(?, ip), launcher_version = COALESCE(?, launcher_version) WHERE id = ?")
    .run(Date.now(), ip || null, verzija || null, comp.id);
  sendWelcomeState(comp.id);
  pushComputers();
}

// Pun "welcome" + trenutno stanje računara. Poziva se na konekciju klijenta,
// ali i na "hello" - kad se launcher ponovo učita pa mu treba svež katalog.
export function sendWelcomeState(computerId) {
  const comp = computerById(computerId);
  if (!comp) return;
  const settings = settingsObj();
  sendClient(comp.id, {
    t: "welcome",
    computer: { id: comp.id, name: comp.name },
    settings: { cafeName: settings.cafeName, currency: settings.currency, ratePerHour: settings.ratePerHour },
    shop: shopList(),
    games: gamesForClient(),
    tools: toolsForClient(),
    pozadine: pozadineObj(),
    tekstura: teksturaObj(),
    // Spisak sara ide klijentu da bi igrac mogao da bira svoju na svom nalogu.
    // Sve sare zajedno su oko 4 KB - salje se jednom, pri povezivanju.
    teksture: {
      spisak: Object.fromEntries(Object.entries(TEKSTURE).map(([k, o]) => [k, { naziv: o.naziv, opis: o.opis, sara: o.sara }])),
      jacine: JACINE, kretanja: KRETANJA, prozirnosti: PROZIRNOSTI,
    },
    promo: promoZaKlijenta(),
  });

  // Ako postoji aktivna sesija (npr. server se restartovao) - nastavi je
  const s = activeSessionForComputer(comp.id);
  if (s) {
    const p = playerById(s.player_id);
    db.prepare("UPDATE computers SET status='in_use', current_player_id=?, current_session_id=? WHERE id=?")
      .run(p.id, s.id, comp.id);
    sendClient(comp.id, loginOkPayload(p, s));
  } else if (comp.status === "locked") {
    sendClient(comp.id, { t: "locked", reason: "staff" });
  } else {
    db.prepare("UPDATE computers SET status='idle' WHERE id=?").run(comp.id);
    sendClient(comp.id, { t: "to_login" });
  }
}

export function onClientClose(computerId) {
  connectedSince.delete(computerId);
  db.prepare("UPDATE computers SET last_seen = ? WHERE id = ?").run(Date.now(), computerId);
  pushComputers();
}

function loginOkPayload(player, session) {
  return {
    t: "login_ok",
    player: { id: player.id, username: player.username, displayName: player.display_name },
    balance: round2(player.balance),
    remainingSeconds: remainingSeconds(player.balance),
    session: { id: session.id, startedAt: session.started_at },
    skoroIgrane: skoroIgraneIgre(player.id),
    porudzbine: igracevePorudzbine(player.id),
    // Igraceva sara ide odmah uz prijavu, da ne bljesne kucna pa se promeni.
    tekstura: teksturaZaRacunar(player.id),
    // Sta je bas ovaj igrac izabrao; null znaci "kao u igraonici".
    mojaTekstura: (() => { const t = temaIgraca(player.id); return t ? { kljuc: t.kljuc, jacina: t.jacina, kretanje: t.kretanje } : null; })(),
    // Nagradni tocak: stanje bas za ovog igraca (koliko je potrosio, sme li da vrti).
    tocak: tocakInfo(player.id),
  };
}

// Redosled igara koje je bas ovaj igrac poslednje pokretao. Launcher ih stavlja
// na pocetak police, da stalni gost ne trazi svoju igru kroz ceo spisak.
function skoroIgraneIgre(playerId) {
  return db.prepare(`
    SELECT game_id FROM game_launches
    WHERE player_id = ?
    GROUP BY game_id
    ORDER BY MAX(at) DESC
    LIMIT 8`).all(playerId).map((r) => r.game_id);
}

function zabeleziPokretanje(computerId, gameId) {
  const g = db.prepare("SELECT name FROM games WHERE id=?").get(gameId);
  // NEPOZNATA IGRA SE NE PRECUTKUJE.
  //
  // Ranije je ovde stajao go "return". Zbog toga se cela funkcija godinama
  // nije izvrsila nijednom: klijent je slao gameId: undefined (id nije bio
  // upisan u plocicu), server ne bi nasao igru i vratio bi se bez traga. Nista
  // u programu nije prijavljivalo da spisak najigranijih stoji prazan.
  //
  // Sada svaki takav slucaj ostavlja zapis. Legitiman je samo jedan - igra
  // obrisana iz panela dok je plocica jos na ekranu - i tada se bar vidi.
  if (!g) {
    const c = computerById(computerId);
    logEvent({ category: "sistem", action: "igra_nepoznata", actor: "sistem", target: c?.name || `#${computerId}`,
      detail: `Pokretanje igre koja ne postoji (id: ${gameId === undefined ? "nije poslat" : gameId})` });
    return;
  }
  const comp = computerById(computerId);
  db.prepare("INSERT INTO game_launches (game_id, player_id, computer_id, at) VALUES (?,?,?,?)")
    .run(gameId, comp?.current_player_id || null, computerId, Date.now());
  const p = comp?.current_player_id ? playerById(comp.current_player_id) : null;
  logEvent({ category: "igre", action: "launch", actor: p?.username || "?", target: comp?.name || "?", detail: `Pokrenuta igra: ${g.name}` });
}

// Igra koja nece da se pokrene. Do sada je to znao samo igrac koji sedi za tim
// racunarom: launcher mu javi "nije instalirana", on slegne ramenima i pokrene
// nesto drugo. Vlasnik sazna tek kad se neko poduzi da se pozali - a najcesci
// uzrok je precica koja na TOM racunaru fali ili se drugacije zove. Zato se
// upisuje u logove, uz ime racunara, i odmah javi panelu.
const RAZLOZI = {
  nema: "putanja ne postoji na tom računaru",
  folder: "upisan je folder umesto prečice ili .exe fajla",
  greska: "Windows je odbio da je pokrene",
};
// Isti kvar se javlja pri svakom pokusaju. Kad igrac pritisne pet puta, logovi
// ne treba da dobiju pet istih redova.
const skoroJavljeno = new Map(); // "racunarId|igra" -> ts
function igraNeRadi(computerId, msg) {
  const igra = String(msg?.igra || "").trim().slice(0, 80);
  if (!igra) return;
  const razlog = RAZLOZI[msg?.razlog] || RAZLOZI.greska;
  const kljuc = `${computerId}|${igra}`;
  const sada = Date.now();
  if (sada - (skoroJavljeno.get(kljuc) || 0) < 60000) return;
  skoroJavljeno.set(kljuc, sada);

  const comp = computerById(computerId);
  const p = comp?.current_player_id ? playerById(comp.current_player_id) : null;
  logEvent({
    category: "igre", action: "game_fail", actor: p?.username || "-", target: comp?.name || "?",
    detail: `„${igra}" nije htela da se pokrene - ${razlog}`,
  });
  broadcastPanels({ t: "event", kind: "igra-ne-radi", text: `${comp?.name || "Računar"}: „${igra}" ne može da se pokrene - ${razlog}` });
}

// ---- DALJINSKI TASK MANAGER ----
// Panel pita preko HTTP-a, a racunar odgovara preko WebSocket-a. Ta dva puta
// se spajaju ovde: svaki zahtev dobija svoj broj, pa se odgovor vrati onom ko
// je pitao. Ako racunar ne odgovori (ugasen usred pitanja, mreza pukla),
// cekanje se prekida samo - panel ne sme da visi.
let brojZahteva = 0;
const zahteviUToku = new Map(); // broj -> { res, tajmer }

function odgovorNaZahtev(msg) {
  const z = zahteviUToku.get(msg?.zahtev);
  if (!z) return; // zakasnio ili se ponovio - nema kome da se vrati
  clearTimeout(z.tajmer);
  zahteviUToku.delete(msg.zahtev);
  z.res(msg);
}

function pitajRacunar(computerId, poruka, cekajMs = 8000) {
  return new Promise((res) => {
    if (!isClientOnline(computerId)) return res({ greska: "Računar nije povezan" });
    const zahtev = ++brojZahteva;
    const tajmer = setTimeout(() => {
      zahteviUToku.delete(zahtev);
      res({ greska: "Računar se ne javlja" });
    }, cekajMs);
    zahteviUToku.set(zahtev, { res, tajmer });
    sendClient(computerId, { ...poruka, zahtev });
  });
}

export async function procesiRacunara(computerId) {
  const r = await pitajRacunar(computerId, { t: "procesi_trazi" });
  if (r.greska) return { error: r.greska };
  return { spisak: Array.isArray(r.spisak) ? r.spisak : [] };
}

export async function ugasiProcesNaRacunaru(computerId, pid, actor) {
  const r = await pitajRacunar(computerId, { t: "procesi_ugasi", pid: Number(pid) });
  if (r.greska) return { error: r.greska };
  if (!r.ok) return { error: r.greska || "Gašenje nije uspelo" };
  const comp = computerById(computerId);
  logEvent({
    category: "racunar", action: "proces_ugasen", actor: actor || "osoblje",
    target: comp?.name || "?", detail: `Ugašen program „${r.ime || pid}" sa panela`,
  });
  return { ok: true, ime: r.ime };
}

// Launcher javlja kvar na sebi (pukao ekran, ne reaguje). Igrac to ne
// prijavljuje - on vidi da racunar "ne radi" i zove radnika. Ovako u panelu
// stoji zapis sa imenom racunara: ako se ista masina javlja stalno, kvar je na
// njoj, ne u programu.
function klijentProblem(computerId, msg) {
  const vrsta = String(msg?.vrsta || "").trim().slice(0, 40);
  const opis = String(msg?.opis || "").trim().slice(0, 200);
  if (!vrsta) return;
  const comp = computerById(computerId);
  const kljuc = `problem|${computerId}|${vrsta}`;
  const sada = Date.now();
  // Pad ume da se ponovi u krug; log ne sme da se zatrpa.
  if (sada - (skoroJavljeno.get(kljuc) || 0) < 60000) return;
  skoroJavljeno.set(kljuc, sada);
  logEvent({
    category: "sistem", action: "klijent_problem", actor: "launcher",
    target: comp?.name || "?", detail: opis || vrsta,
  });
  broadcastPanels({ t: "event", kind: "klijent-problem", text: `${comp?.name || "Računar"}: ${opis || vrsta}` });
}

// Sta se najvise igralo u zadatom periodu.
export function najigranije(from, to, limit = 10) {
  return db.prepare(`
    SELECT g.name, COUNT(*) puta, COUNT(DISTINCT l.player_id) igraca
    FROM game_launches l JOIN games g ON g.id = l.game_id
    WHERE l.at BETWEEN ? AND ?
    GROUP BY g.id ORDER BY puta DESC LIMIT ?`).all(from, to, limit);
}

// glavni ruter za poruke sa klijenta
export function handleClientMessage(computerId, msg) {
  switch (msg.t) {
    case "login":
      return clientLogin(computerId, msg.username, msg.password);
    case "logout":
      return endSession(computerId, { lock: false, reason: "logout" });
    case "unlock_pin":
      return clientUnlockPin(computerId, msg.pin);
    case "verify_pin": {
      const r = checkPin(computerId, msg.pin);
      return sendClient(computerId, r.ok ? { t: "pin_ok" } : { t: "pin_err", wait: r.wait });
    }
    case "order":
      return clientOrder(computerId, msg.items || [], msg.note || "", msg.payment === "cash" ? "cash" : "credit");
    case "change_password":
      return clientChangePassword(computerId, msg.oldPassword, msg.newPassword);
    case "moja_tekstura":
      return clientTekstura(computerId, msg);
    case "install_status":
      return clientInstallStatus(computerId, msg);
    case "game_start":
      return zabeleziPokretanje(computerId, Number(msg.gameId));
    case "igra_ne_radi":
      return igraNeRadi(computerId, msg);
    case "klijent_problem":
      return klijentProblem(computerId, msg);
    case "procesi_lista":
    case "proces_ugasen":
      return odgovorNaZahtev(msg);
    case "tocak_spin":
      return clientTocakSpin(computerId);
    case "sys_info":
      return clientSysInfo(computerId, msg);
    case "hello":
      // launcher se (ponovo) učitao - pošalji mu svež katalog i stanje
      return sendWelcomeState(computerId);
    case "heartbeat":
      db.prepare("UPDATE computers SET last_seen = ? WHERE id = ?").run(Date.now(), computerId);
      if (msg.mirovanje != null) proveriMirovanje(computerId, Number(msg.mirovanje));
      return;
    default:
      return;
  }
}

// Igrac menja svoju pozadinu sa svog naloga u launcheru. Menja se samo NJEGOV
// zapis - kucnu sara dira jedino vlasnik kroz panel.
function clientTekstura(computerId, msg) {
  const comp = computerById(computerId);
  if (!comp?.current_player_id) return; // niko nije prijavljen na tom racunaru
  const r = sacuvajTemuIgraca(comp.current_player_id, {
    kljuc: msg.kljuc, jacina: msg.jacina, kretanje: msg.kretanje,
  });
  if (r.error) return sendClient(computerId, { t: "moja_tekstura_err", message: r.error });
  sendClient(computerId, { t: "tekstura", tekstura: r.tekstura, moja: r.tema });
}

// Igrač zavrteo točak sa svog računara. Ishod bira server; klijent dobija indeks
// pobedničkog polja i nagradu, pa animira do njega.
function clientTocakSpin(computerId) {
  const comp = computerById(computerId);
  if (!comp?.current_player_id) return;
  const r = zavrtiTocak(comp.current_player_id);
  if (r.error) return sendClient(computerId, { t: "tocak_err", message: r.error, tocak: tocakInfo(comp.current_player_id) });
  sendClient(computerId, { t: "tocak_rezultat", index: r.index, nagrada: r.nagrada, balance: r.balance, sledeciSpin: r.sledeciSpin });
}

function clientLogin(computerId, username, password) {
  const comp = computerById(computerId);
  if (comp.status === "locked") {
    return sendClient(computerId, { t: "login_err", message: "Računar je zaključan. Pozovite osoblje." });
  }
  // Zaštita od duple prijave (npr. dupli Enter): bez ovoga bi nastale dve
  // aktivne sesije na istom računaru i naplata bi tekla dvostruko.
  if (comp.current_player_id || activeSessionForComputer(computerId)) {
    const cur = playerById(comp.current_player_id);
    const s = activeSessionForComputer(computerId);
    if (cur && s) sendClient(computerId, loginOkPayload(cur, s));
    return;
  }
  // Kocnica se gleda tek ovde: sve iznad su uredna odbijanja koja se ne broje.
  const kljucKocnice = `igrac:${computerId}`;
  const pauza = kocnica.ceka(kljucKocnice);
  if (pauza) {
    return sendClient(computerId, { t: "login_err", message: `Previše pokušaja. Sačekajte ${pauza} s.` });
  }
  const p = db.prepare("SELECT * FROM players WHERE username = ?").get(String(username || "").trim());
  if (!p || !verifyPassword(password, p.password_hash)) {
    const cekaj = kocnica.promasaj(kljucKocnice);
    if (cekaj) {
      logEvent({ category: "prijava", action: "login_fail", actor: "sistem", target: compName(computerId),
        detail: `Više pogrešnih prijava - računar je pauziran ${cekaj} s` });
    }
    return sendClient(computerId, { t: "login_err",
      message: cekaj ? `Previše pokušaja. Sačekajte ${cekaj} s.` : "Pogrešno korisničko ime ili lozinka." });
  }
  if (p.banned) {
    return sendClient(computerId, { t: "login_err", message: "Nalog je blokiran. Pozovite osoblje." });
  }
  if (rate() > 0 && p.balance <= 0) {
    return sendClient(computerId, { t: "login_err", message: "Nemate kredita. Dopunite na kasi." });
  }
  // da li je igrac vec prijavljen negde drugde?
  const other = db.prepare("SELECT * FROM computers WHERE current_player_id = ? AND id != ?").get(p.id, computerId);
  if (other) {
    return sendClient(computerId, { t: "login_err", message: `Već ste prijavljeni na ${other.name}.` });
  }

  kocnica.pogodak(kljucKocnice);

  const now = Date.now();
  const info = db
    .prepare("INSERT INTO sessions (player_id, computer_id, started_at, status) VALUES (?,?,?, 'active')")
    .run(p.id, computerId, now);
  const sessionId = info.lastInsertRowid;
  db.prepare("UPDATE computers SET status='in_use', current_player_id=?, current_session_id=? WHERE id=?")
    .run(p.id, sessionId, computerId);
  db.prepare("UPDATE players SET last_login=? WHERE id=?").run(now, p.id);
  tickState.set(Number(sessionId), { last: now });

  const session = db.prepare("SELECT * FROM sessions WHERE id=?").get(sessionId);
  sendClient(computerId, loginOkPayload(p, session));
  pushComputers();
  broadcastPanels({ t: "event", kind: "login", text: `${p.username} se prijavio na ${comp.name}` });
  logEvent({ category: "prijava", action: "login", actor: p.username, target: comp.name, detail: "Igrač se prijavio" });
}

// KOČNICA PROTIV POGAĐANJA
// Ista za PIN osoblja, prijavu igrača i prijavu na panel: 5 promašaja pa 30 s
// pauze. Bez ovoga se lozinka pogađa hiljadama pokušaja u sekundi, a igrači sede
// na istoj mreži kao server.
// Broji se ISKLJUČIVO pogrešna lozinka ili PIN. Uredna odbijanja (nema kredita,
// već je prijavljen na drugom računaru, nalog blokiran) se ne broje - inače bi
// igrač koji svakodnevno ulazi završio zaključan bez razloga.
const KOCNICA_PROMASAJA = 5;
const KOCNICA_PAUZA = 30000;
const KOCNICA_ZABORAV = 10 * 60000; // stari ključevi ispadaju, da mapa ne raste
const promasaji = new Map(); // kljuc -> { n, do, kad }

function ocistiKocnicu() {
  const granica = Date.now() - KOCNICA_ZABORAV;
  for (const [k, f] of promasaji) if (f.kad < granica) promasaji.delete(k);
}
function kocnicaCeka(kljuc) {
  const f = promasaji.get(kljuc);
  return f && f.do > Date.now() ? Math.ceil((f.do - Date.now()) / 1000) : 0;
}
function kocnicaPromasaj(kljuc) {
  ocistiKocnicu();
  const f = promasaji.get(kljuc) || { n: 0, do: 0, kad: 0 };
  f.n++; f.kad = Date.now();
  if (f.n >= KOCNICA_PROMASAJA) { f.n = 0; f.do = Date.now() + KOCNICA_PAUZA; }
  promasaji.set(kljuc, f);
  return kocnicaCeka(kljuc);
}
function kocnicaPogodak(kljuc) { promasaji.delete(kljuc); }

// Prijava na panel je van ovog fajla (routes.js), pa joj treba pristup.
export const kocnica = { ceka: kocnicaCeka, promasaj: kocnicaPromasaj, pogodak: kocnicaPogodak };

export function checkPin(computerId, pin) {
  const kljuc = `pin:${computerId}`;
  const wait = kocnicaCeka(kljuc);
  if (wait) return { ok: false, wait };
  if (String(pin) !== String(settingsObj().unlockPin)) {
    const pauza = kocnicaPromasaj(kljuc);
    logEvent({ category: "racunar", action: "pin_fail", actor: "sistem", target: compName(computerId),
      detail: pauza ? `Pogrešan PIN - računar je pauziran ${pauza} s` : "Pogrešan PIN na računaru" });
    return { ok: false, wait: pauza };
  }
  kocnicaPogodak(kljuc);
  return { ok: true };
}

function clientUnlockPin(computerId, pin) {
  const r = checkPin(computerId, pin);
  if (!r.ok) {
    return sendClient(computerId, {
      t: "unlock_err",
      message: r.wait ? `Previše pokušaja - sačekajte ${r.wait} s.` : "Pogrešan PIN.",
    });
  }
  unlockComputer(computerId, null);
}

function clientOrder(computerId, items, note, payment = "credit") {
  const comp = computerById(computerId);
  if (!comp.current_player_id) return sendClient(computerId, { t: "error", message: "Niste prijavljeni." });
  const p = playerById(comp.current_player_id);
  // Kes placa radnik pri donosenju, pa se kredit ne dira. Sve ostalo je isto.
  const kes = payment === "cash";

  const resolved = spojiStavke(items);
  if (resolved.length === 0) return sendClient(computerId, { t: "error", message: "Prazna porudžbina." });
  const total = resolved.reduce((s, r) => s + r.item.price * r.qty, 0);

  const short = stockShortage(resolved);
  if (short) return sendClient(computerId, { t: "order_err", message: `"${short.item.name}" je rasprodato ili nema dovoljno na stanju.` });

  if (!kes && p.balance < total) {
    return sendClient(computerId, {
      t: "order_err",
      message: `Nedovoljno kredita (potrebno ${round2(total)}, imate ${round2(p.balance)}).`,
    });
  }

  const now = Date.now();
  // Porudžbina, stavke, zaliha i naplata su JEDAN posao. Nestanak struje između
  // skidanja zalihe i naplate bi ostavio piće skinuto sa stanja, a kredit
  // nenaplaćen - i to bi se otkrilo tek pri obračunu smene.
  let orderId, newBal;
  try {
    ({ orderId, newBal } = uJednomPoslu(() => {
      const info = db
        .prepare("INSERT INTO orders (player_id, computer_id, total, status, note, payment, source, created_at) VALUES (?,?,?, 'pending', ?,?, 'client', ?)")
        .run(p.id, computerId, total, note, kes ? "cash" : "credit", now);
      const id = info.lastInsertRowid;
      const insItem = db.prepare("INSERT INTO order_items (order_id, item_id, name, price, qty) VALUES (?,?,?,?,?)");
      for (const r of resolved) insItem.run(id, r.item.id, r.item.name, r.item.price, r.qty);
      consumeStock(resolved);

      let bal = round2(p.balance);
      if (!kes) {
        bal = round2(p.balance - total);
        db.prepare("UPDATE players SET balance=? WHERE id=?").run(bal, p.id);
        addTransaction(p.id, "shop", -total, bal, null, `Porudžbina #${id}`);
      }
      return { orderId: id, newBal: bal };
    }));
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `Porudžbina nije upisana: ${String(e?.message || e).slice(0, 150)}` });
    return sendClient(computerId, { t: "order_err", message: "Porudžbina nije prošla. Pokušaj ponovo ili pozovi osoblje." });
  }

  sendClient(computerId, {
    t: "order_ok",
    orderId,
    payment: kes ? "cash" : "credit",
    total: round2(total),
    balance: newBal,
    remainingSeconds: remainingSeconds(newBal),
  });
  posaljiPorudzbineIgracu(p.id);
  pushOrders();
  pushComputers();
  // Radnik mora odmah da vidi da za ovu porudžbinu naplaćuje keš na licu mesta.
  broadcastPanels({ t: "event", kind: "order", text: `Nova porudžbina #${orderId} - ${comp.name} (${p.username})${kes ? ", KEŠ" : ""}` });
  // IZNOS SE UPISUJE I ZA KEŠ.
  //
  // Obračun smene računa "Shop ukupno" iz logova (category='shop'), a "od toga
  // keš" iz tabele porudžbina, pa "Shop sa naloga" izvodi kao razliku. Dok je
  // keš porudžbina iz launchera išla bez iznosa, u ukupno nije ulazila, a iz
  // razlike je ispadala kao MINUS: gost plati kolu 130 kešom i radniku u
  // obračunu piše "Shop ukupno 0, sa naloga −130". Otkazivanje je to gurnulo i
  // korak dalje (poništenje je iznos imalo), pa je ukupan shop postajao −130.
  // Kasa je iznos oduvek upisivala; ovde je bio izuzetak bez razloga.
  //
  // Pazar je i ranije bio tačan - on keš čita iz porudžbina - pa se greška
  // videla samo u podeli, tamo gde radnik proverava sebe.
  logEvent({ category: "shop", action: "order", actor: p.username, target: comp.name,
    detail: `Porudžbina #${orderId} (${kes ? "keš" : "kredit"}): ` + resolved.map((r) => `${r.qty}x ${r.item.name}`).join(", "),
    amount: -total });
}

function clientChangePassword(computerId, oldPassword, newPassword) {
  const comp = computerById(computerId);
  if (!comp.current_player_id) return sendClient(computerId, { t: "error", message: "Niste prijavljeni." });
  const p = playerById(comp.current_player_id);
  if (!verifyPassword(oldPassword, p.password_hash)) {
    return sendClient(computerId, { t: "pw_err", message: "Trenutna lozinka nije tačna." });
  }
  if (!newPassword || String(newPassword).length < 3) {
    return sendClient(computerId, { t: "pw_err", message: "Nova lozinka mora imati bar 3 znaka." });
  }
  db.prepare("UPDATE players SET password_hash=? WHERE id=?").run(hashPassword(newPassword), p.id);
  sendClient(computerId, { t: "pw_ok" });
}

// Sesije / naplata
const tickState = new Map(); // sessionId -> { last }

// KRAJ SESIJE - JEDAN POSAO.
//
// Zatvaranje sesije, upis njene cene u istoriju naloga, zapis u logovima (iz
// kog se računa promet smene) i oslobađanje računara moraju da prođu zajedno.
// Pad između prva i poslednja dva ostavlja najgori mogući trag: sesija je
// zatvorena, ali računar i dalje nosi `current_player_id`. Panel ga tada
// pokazuje kao zauzet pa radnik nikoga ne posadi, a igrač koji sedne ne može ni
// da se prijavi - prijava vidi "neko je već tu" i tiho odustane. Mašina ostaje
// mrtva dok je neko ručno ne razreši.
export function endSession(computerId, { lock = false, reason = "logout", adminId = null } = {}) {
  const s = activeSessionForComputer(computerId);
  const now = Date.now();
  const newStatus = lock ? "locked" : "idle";
  let log = null;
  try {
    log = uJednomPoslu(() => {
      let l = null;
      if (s) {
        db.prepare("UPDATE sessions SET status='ended', ended_at=? WHERE id=?").run(now, s.id);
        const p = playerById(s.player_id);
        if (p && s.cost > 0) addTransaction(p.id, "session", -round2(s.cost), round2(p.balance), adminId, `Sesija na PC (${round2(s.cost)})`);
        const detail = reason === "time" ? "Isteklo vreme" : reason === "staff" ? "Osoblje prekinulo sesiju" : reason === "banned" ? "Nalog blokiran" : reason === "mirovanje" ? "Nije bilo aktivnosti" : "Odjava igrača";
        l = upisiLog({ category: "sesija", action: "end", actor: p?.username || "?", target: compName(computerId), detail, amount: s.cost > 0 ? -round2(s.cost) : null });
      }
      db.prepare("UPDATE computers SET status=?, current_player_id=NULL, current_session_id=NULL WHERE id=?")
        .run(newStatus, computerId);
      return l;
    });
  } catch (e) {
    // Računar ne sme da ostane zaključan u pola posla. Greška se zapisuje, a
    // stanje ostaje ono pre pokušaja - sesija i dalje teče i naplaćuje se.
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `Kraj sesije na ${compName(computerId)} nije upisan: ${String(e?.message || e).slice(0, 150)}` });
    return;
  }
  if (s) {
    tickState.delete(s.id);
    javljenoZaSesiju.delete(s.id); // sledeća sesija kreće sa čistim upozorenjima
    mirovanjeJavljeno.delete(s.id);
  }
  javiLog(log);

  // Igraceva sara odlazi sa njim - sledeci gost zatice kucnu.
  sendClient(computerId, { t: "tekstura", tekstura: teksturaObj() });
  if (lock) sendClient(computerId, { t: "locked", reason });
  else sendClient(computerId, { t: "to_login" });
  pushComputers();
}

// Naplata ide po razlici izmedju dva prolaza, a prolaz je na 5 sekundi.
// Kad sistemski sat SKOCI UNAPRED - a to na racunarima za igre nije retkost:
// RTC ode u stranu, pa Windows pri pokretanju sinhronizuje vreme i sat preskoci
// - ta razlika bi bila naplacena kao odigrano vreme. Na trinaest racunara to je
// trenutni odliv kredita i svi bi u istoj sekundi ostali bez vremena, a niko ne
// bi znao zasto. Zato se jedan prolaz ne naplacuje duze od ovoga.
// Skok UNAZAD daje negativnu razliku i preskace se nize (elapsed <= 0).
export const NAJVISE_PO_PROLAZU = 60; // sekundi

// Koliko sekundi jednog prolaza sme da se naplati.
export function sekundeZaNaplatu(proteklo) {
  if (!Number.isFinite(proteklo) || proteklo <= 0) return 0;
  return Math.min(proteklo, NAJVISE_PO_PROLAZU);
}

// Skok sata se javlja jednom u minutu - inace bi jedan pomeren sat napunio log.
let skokJavljen = 0;
function javiSkokSata(proteklo) {
  const sada = Date.now();
  if (sada - skokJavljen < 60000) return;
  skokJavljen = sada;
  logEvent({
    category: "sistem", action: "skok_sata", actor: "server",
    detail: `Sat servera je preskočio ${Math.round(proteklo)} s. Naplaćeno je najviše ${NAJVISE_PO_PROLAZU} s po prolazu - igračima nije skinuto vreme koje nisu odigrali. Proveri podešavanje vremena na glavnom računaru.`,
  });
}

// naplata svakih nekoliko sekundi
export function billingTick() {
  const r = rate();
  const now = Date.now();
  const active = db.prepare("SELECT * FROM sessions WHERE status='active'").all();
  for (const s of active) {
    const st = tickState.get(s.id) || { last: now };
    // Pauziraj naplatu ako klijent tog računara nije povezan (nestanak struje/mreže) -
    // resetuj vreme da nema "catch-up" naplate kad se ponovo poveže.
    if (!isClientOnline(s.computer_id)) { st.last = now; tickState.set(s.id, st); continue; }
    const proteklo = (now - st.last) / 1000;
    st.last = now;
    tickState.set(s.id, st);
    if (r <= 0 || proteklo <= 0) continue;
    if (proteklo > NAJVISE_PO_PROLAZU) javiSkokSata(proteklo);
    const elapsed = sekundeZaNaplatu(proteklo);

    const p = playerById(s.player_id);
    if (!p) continue;
    // Ne naplaćuj više nego što igrač ima - inače bi sesija zabeležila veći
    // trošak nego što je stvarno skinuto i promet bi bio naduvan.
    const cost = (elapsed / 3600) * r;
    const charged = Math.min(cost, Math.max(0, p.balance));
    const newBal = round2(p.balance - charged);
    const newCost = round2(s.cost + charged);

    if (newBal <= 0) {
      // Ova dva upisa NISU u istom poslu sa `endSession`, i to namerno.
      // `endSession` hvata svoju grešku i vraća se normalno; da su u zajedničkom
      // poslu, njegov rollback bi poništio samo zatvaranje sesije dok bi se
      // nulovanje kredita svejedno potvrdilo - a to je gore od oba upisa
      // posebno. Ovako se stanje samo popravlja: kredit je 0, pa sledeći prolaz
      // za pet sekundi ponovo dođe ovde i pokuša da zatvori sesiju.
      db.prepare("UPDATE players SET balance=0 WHERE id=?").run(p.id);
      db.prepare("UPDATE sessions SET cost=? WHERE id=?").run(newCost, s.id);
      endSession(s.computer_id, { lock: true, reason: "time" });
      broadcastPanels({ t: "event", kind: "timeup", text: `${p.username} - isteklo vreme (${db.prepare("SELECT name FROM computers WHERE id=?").get(s.computer_id)?.name})` });
      continue;
    }
    // Stanje na nalogu i cena sesije moraju da se pomere zajedno: ako se skine
    // kredit a cena ne upiše, taj novac nestaje iz izveštaja i iz obračuna.
    uJednomPoslu(() => {
      db.prepare("UPDATE players SET balance=? WHERE id=?").run(newBal, p.id);
      db.prepare("UPDATE sessions SET cost=? WHERE id=?").run(newCost, s.id);
    });
    const preostalo = remainingSeconds(newBal);
    sendClient(s.computer_id, { t: "balance", balance: round2(newBal), remainingSeconds: preostalo });
    javiOsobljuPredIstek(s, p, preostalo);
  }
  if (active.length) pushComputers();
}

// Igrač koji ustane i zaboravi da se odjavi plaća prazan sto, a računar stoji
// zauzet dok neko čeka. Launcher javlja koliko dugo nema dodira sa tastaturom
// i mišem, pa se sesija sama zatvara - uz odbrojavanje da ga ne prekine usred
// filma ili striminga, gde dugo nema unosa a čovek je tu.
const MIROVANJE_ODLOZI = 60; // sekundi odbrojavanja pre zatvaranja
const mirovanjeJavljeno = new Set(); // sessionId gde odbrojavanje već ide

function proveriMirovanje(computerId, sekunde) {
  const s = activeSessionForComputer(computerId);
  if (!s || !Number.isFinite(sekunde)) return;
  const prag = Number(getSetting("idle_minutes", "15")) * 60;
  if (prag <= 0) return; // vlasnik isključio

  if (sekunde < prag) {
    if (mirovanjeJavljeno.delete(s.id)) sendClient(computerId, { t: "mirovanje", preostalo: null });
    return;
  }
  if (sekunde >= prag + MIROVANJE_ODLOZI) {
    const p = playerById(s.player_id);
    mirovanjeJavljeno.delete(s.id);
    endSession(computerId, { lock: false, reason: "mirovanje" });
    const ime = compName(computerId);
    broadcastPanels({ t: "event", kind: "mirovanje", text: `${p?.username || "?"} odjavljen sa ${ime} - nije bilo aktivnosti` });
    return;
  }
  sendClient(computerId, { t: "mirovanje", preostalo: Math.max(1, Math.round(prag + MIROVANJE_ODLOZI - sekunde)) });
  mirovanjeJavljeno.add(s.id);
}

// Osoblje mora da sazna PRE nego što vreme istekne - tada može da priđe i
// ponudi dopunu. Kad se računar već zaključa, igrač po pravilu ustane i ode.
const PRAG_UPOZORENJA = [600, 300, 60]; // 10 min, 5 min, 1 min
// sessionId -> { pragovi: Set, poslednje: ms }
//
// Vreme poslednjeg javljanja stoji kao svoje polje. Ranije je bilo zakačeno kao
// obično svojstvo na sam Set (`javljeni.poslednje`) - radilo je, ali Set koji
// nosi skriveno polje je zamka za onog ko sledeći čita ovaj kod.
const javljenoZaSesiju = new Map();

function javiOsobljuPredIstek(s, p, preostalo) {
  if (preostalo == null) return;
  let javljeni = javljenoZaSesiju.get(s.id);
  if (!javljeni) { javljeni = { pragovi: new Set(), poslednje: 0 }; javljenoZaSesiju.set(s.id, javljeni); }

  const dostignuti = PRAG_UPOZORENJA.filter((x) => preostalo <= x);
  const novi = dostignuti.filter((x) => !javljeni.pragovi.has(x));
  if (!novi.length) return;
  novi.forEach((x) => javljeni.pragovi.add(x));

  // Igrač koji se prijavi sa 5 min prelazi dva praga skoro istovremeno -
  // osoblju ne treba isto upozorenje dvaput u par sekundi.
  const sada = Date.now();
  if (sada - (javljeni.poslednje || 0) < 45000) return;
  javljeni.poslednje = sada;

  // U poruci ide STVARNO preostalo vreme, ne prag. Igrač koji se prijavi sa 5 min
  // prelazi prag od 10 min odmah, pa bi "ostalo 10 min" obmanulo osoblje.
  const comp = db.prepare("SELECT name FROM computers WHERE id=?").get(s.computer_id);
  const opis = preostalo >= 60 ? `${Math.max(1, Math.round(preostalo / 60))} min` : `${Math.round(preostalo)} s`;
  broadcastPanels({
    t: "istice",
    computerId: s.computer_id,
    computer: comp?.name || "?",
    player: p.username,
    playerId: p.id,
    preostalo: Math.round(preostalo),
    text: `${comp?.name || "?"} - ${p.username}: ostalo ${opis}`,
  });
}

// ADMIN AKCIJE (iz HTTP ruta)
export function lockComputer(computerId, adminId) {
  const comp = computerById(computerId);
  if (!comp) return { error: "Nepostojeći računar" };
  if (comp.current_player_id) {
    endSession(computerId, { lock: true, reason: "staff", adminId });
  } else {
    db.prepare("UPDATE computers SET status='locked' WHERE id=?").run(computerId);
    sendClient(computerId, { t: "locked", reason: "staff" });
    pushComputers();
  }
  return { ok: true };
}

export function unlockComputer(computerId, adminId) {
  const comp = computerById(computerId);
  if (!comp) return { error: "Nepostojeći računar" };
  // ako je neko prijavljen, prvo uredno zatvori sesiju (inace bi naplata nastavila u pozadini)
  if (comp.current_player_id) {
    endSession(computerId, { lock: false, reason: "staff", adminId });
  } else {
    db.prepare("UPDATE computers SET status='idle', current_player_id=NULL, current_session_id=NULL WHERE id=?").run(computerId);
    sendClient(computerId, { t: "to_login" });
  }
  sendClient(computerId, { t: "unlock_ok" });
  pushComputers();
  return { ok: true };
}

export function forceLogout(computerId, adminId) {
  return endSession(computerId, { lock: false, reason: "staff", adminId }), { ok: true };
}

export function sendMessageToComputer(computerId, text) {
  const ok = sendClient(computerId, { t: "message", text });
  return { ok };
}

export function createPlayer({ username, password, displayName, balance, note }) {
  username = String(username || "").trim();
  if (!username || !password) return { error: "Korisničko ime i lozinka su obavezni" };
  const exists = db.prepare("SELECT id FROM players WHERE username = ?").get(username);
  if (exists) return { error: "Korisničko ime već postoji" };
  if (balance && !ispravanIznos(balance)) return { error: "Neispravan početni kredit" };
  if (Number(balance) < 0) return { error: "Početni kredit ne može biti negativan" };
  const now = Date.now();
  const info = db
    .prepare("INSERT INTO players (username, password_hash, display_name, balance, note, created_at) VALUES (?,?,?,?,?,?)")
    .run(username, hashPassword(password), displayName || username, Number(balance) || 0, note || null, now);
  if (Number(balance) > 0) addTransaction(info.lastInsertRowid, "topup", Number(balance), Number(balance), null, "Početni kredit");
  pushComputers();
  return { ok: true, id: info.lastInsertRowid };
}

// Grupa od pet ljudi uđe sa ulice i niko nema nalog. Kucanje pet imena i pet
// lozinki drži red na kasi, pa ih panel otvara odjednom: imena idu redom
// gost-01, gost-02..., lozinka je četvorocifrena da može da se izdiktira.
export function createGuests(count, balance) {
  count = Math.min(10, Math.max(1, Math.floor(Number(count) || 1)));
  balance = Math.max(0, Number(balance) || 0);
  const zauzeta = new Set(
    db.prepare("SELECT username FROM players WHERE username LIKE 'gost-%'").all().map((r) => r.username)
  );
  const datum = new Date().toLocaleDateString("sr-Latn-RS");
  const napravljeni = [];
  let broj = 1;
  for (let i = 0; i < count; i++) {
    while (zauzeta.has(`gost-${String(broj).padStart(2, "0")}`)) broj++;
    const username = `gost-${String(broj).padStart(2, "0")}`;
    zauzeta.add(username);
    const password = String(Math.floor(1000 + Math.random() * 9000));
    const r = createPlayer({ username, password, displayName: username, balance, note: `Brzi gost, ${datum}` });
    if (r.error) return { error: r.error };
    napravljeni.push({ id: r.id, username, password, balance });
  }
  return { ok: true, players: napravljeni };
}

// Gostujući nalozi se gomilaju, pa vlasnik može da počisti one potrošene.
// Dira samo gost-* naloge bez kredita, koji nisu za računarom i nisu korišćeni
// danas - sve ostalo ostaje netaknuto, uključujući redovne igrače.
export function guestsToClean() {
  const granica = Date.now() - 24 * 60 * 60 * 1000;
  return db.prepare(`
    SELECT p.id, p.username FROM players p
    WHERE p.username LIKE 'gost-%'
      AND p.balance <= 0
      AND p.created_at < ?
      AND (p.last_login IS NULL OR p.last_login < ?)
      AND NOT EXISTS (SELECT 1 FROM computers c WHERE c.current_player_id = p.id)
    ORDER BY p.username`).all(granica, granica);
}

export function cleanGuests() {
  const spisak = guestsToClean();
  let obrisano = 0;
  for (const g of spisak) if (deletePlayer(g.id).ok) obrisano++;
  return { ok: true, obrisano, imena: spisak.map((g) => g.username) };
}

// DOPUNA KREDITA - JEDAN POSAO.
//
// Ovo je put kojim prolazi svaki dinar koji gost preda preko pulta, pa je i
// najskuplje mesto da nešto prođe upola. Tri upisa moraju da idu zajedno:
// novo stanje na nalogu, red u istoriji naloga i zapis u logovima (iz kog se
// računa pazar smene). Ako bilo koji od njih prođe bez ostalih, kasa se na
// kraju smene ne poklapa, a razlika nema objašnjenje.
//
// Ime radnika ide ovamo umesto da se log piše iz rute: log mora da bude U
// ISTOM poslu sa novcem, a ruta je van njega.
export function topUpPlayer(playerId, amount, adminId, note, adminUsername = "sistem") {
  const p = playerById(playerId);
  if (!p) return { error: "Nepostojeći igrač" };
  amount = Number(amount);
  if (!amount || !ispravanIznos(amount)) return { error: "Neispravan iznos" };
  const newBal = round2((Number(p.balance) || 0) + amount);
  if (newBal < 0) return { error: `Iznos je veći od stanja (${round2(p.balance)})` };

  let log;
  try {
    log = uJednomPoslu(() => {
      db.prepare("UPDATE players SET balance=? WHERE id=?").run(newBal, playerId);
      addTransaction(playerId, amount > 0 ? "topup" : "adjust", amount, newBal, adminId, note || (amount > 0 ? "Dopuna" : "Korekcija"));
      return upisiLog({
        category: "novac", action: amount >= 0 ? "topup" : "deduct", actor: adminUsername, target: p.username,
        detail: amount >= 0 ? "Dopuna kredita" : "Skidanje / ispravka kredita", amount,
      });
    });
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `Dopuna nije upisana: ${String(e?.message || e).slice(0, 150)}` });
    return { error: "Dopuna nije prošla. Pokušaj ponovo - novac nije skinut ni dodat." };
  }
  javiLog(log);

  // ako je bio bez kredita i zakljucan, obavesti klijent o novom stanju
  const comp = db.prepare("SELECT * FROM computers WHERE current_player_id = ?").get(playerId);
  if (comp) sendClient(comp.id, { t: "balance", balance: newBal, remainingSeconds: remainingSeconds(newBal) });
  pushComputers();
  return { ok: true, balance: newBal };
}

// VREMENSKI PAKETI
export function paketiLista() {
  return db.prepare("SELECT * FROM paketi ORDER BY sort, id").all();
}
export function kreirajPaket({ name, hours, price }) {
  name = String(name || "").trim();
  hours = Number(hours);
  price = Number(price);
  if (!name) return { error: "Naziv je obavezan" };
  if (!Number.isFinite(hours) || hours <= 0) return { error: "Broj sati mora biti veći od nule" };
  if (!Number.isFinite(price) || price < 0) return { error: "Cena mora biti broj veći ili jednak nuli" };
  const sort = db.prepare("SELECT COALESCE(MAX(sort),0)+1 s FROM paketi").get().s;
  const info = db.prepare("INSERT INTO paketi (name, hours, price, available, sort, created_at) VALUES (?,?,?,1,?,?)")
    .run(name, hours, price, sort, Date.now());
  return { ok: true, id: info.lastInsertRowid };
}
export function izmeniPaket(id, { name, hours, price, available }) {
  const p = db.prepare("SELECT * FROM paketi WHERE id=?").get(id);
  if (!p) return { error: "Paket ne postoji" };
  const ime = name == null ? p.name : String(name).trim();
  const sati = hours == null ? p.hours : Number(hours);
  const cena = price == null ? p.price : Number(price);
  if (!ime) return { error: "Naziv je obavezan" };
  if (!Number.isFinite(sati) || sati <= 0) return { error: "Broj sati mora biti veći od nule" };
  if (!Number.isFinite(cena) || cena < 0) return { error: "Cena mora biti broj veći ili jednak nuli" };
  db.prepare("UPDATE paketi SET name=?, hours=?, price=?, available=? WHERE id=?")
    .run(ime, sati, cena, available === undefined ? p.available : (available ? 1 : 0), id);
  return { ok: true };
}
export function obrisiPaket(id) {
  const p = db.prepare("SELECT * FROM paketi WHERE id=?").get(id);
  if (!p) return { error: "Paket ne postoji" };
  db.prepare("DELETE FROM paketi WHERE id=?").run(id);
  return { ok: true };
}

// Prodaja paketa igraču. Igrač plati 'price' (novac koji ulazi = dopuna), a
// dobije vreme: kredit = sati * cena po satu u tom trenutku. Razlika do pune
// cene je popust i vodi se kao 'bonus' - da naplata (dopune) ostane tačna, a
// popust bude vidljiv posebno u istoriji naloga.
// PRODAJA PAKETA - JEDAN POSAO.
//
// Ovde se u jednom potezu naplaćuje najveći iznos u igraonici (fabrički 500) i
// pravе se ČETIRI upisa: naplaćeni deo u istoriju, poklonjeni popust u
// istoriju, novo stanje na nalogu i zapis u logovima iz kog se računa pazar.
// Bez zajedničke zaštite pad između njih ostavlja gosta koji je platio 500 bez
// kredita, ili sa kreditom koji nigde nije naplaćen. Isto pravilo kao kod
// porudžbine i točka - ovaj put je ranije bio propušten.
export function prodajPaket(playerId, paketId, adminId, adminUsername = "sistem") {
  const p = playerById(playerId);
  if (!p) return { error: "Nepostojeći igrač" };
  const paket = db.prepare("SELECT * FROM paketi WHERE id=?").get(paketId);
  if (!paket || paket.available === 0) return { error: "Paket ne postoji ili nije aktivan" };
  const r = rate();
  if (r <= 0) return { error: "Naplata po satu je isključena, paket nema smisla" };
  const cena = round2(paket.price);
  const kredit = round2(paket.hours * r); // vrednost paketa u kreditu

  let bal, log;
  try {
    ({ bal, log } = uJednomPoslu(() => {
      let b = round2((Number(p.balance) || 0) + cena);
      addTransaction(playerId, "topup", cena, b, adminId, `Paket "${paket.name}" - plaćeno ${cena}`);
      const bonus = round2(kredit - cena);
      if (bonus > 0) { b = round2(b + bonus); addTransaction(playerId, "bonus", bonus, b, adminId, `Popust: paket "${paket.name}"`); }
      else if (bonus < 0) { b = round2(b + bonus); addTransaction(playerId, "adjust", bonus, b, adminId, `Paket "${paket.name}"`); }
      db.prepare("UPDATE players SET balance=? WHERE id=?").run(b, playerId);
      return { bal: b, log: upisiLog({
        category: "novac", action: "paket", actor: adminUsername, target: p.username,
        detail: `Paket: ${paket.hours}h (${kredit} kredita)`, amount: cena,
      }) };
    }));
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `Paket nije upisan: ${String(e?.message || e).slice(0, 150)}` });
    return { error: "Paket nije prošao. Pokušaj ponovo - novac nije naplaćen." };
  }
  javiLog(log);

  const comp = db.prepare("SELECT * FROM computers WHERE current_player_id = ?").get(playerId);
  if (comp) sendClient(comp.id, { t: "balance", balance: bal, remainingSeconds: remainingSeconds(bal) });
  pushComputers();
  return { ok: true, balance: bal, kredit, cena, sati: paket.hours };
}

// NAGRADNI TOČAK
// Igrač koji je za nedelju dana potrošio dovoljno može jednom da zavrti i osvoji
// kredit. Ishod BIRA server (težinski nasumično), klijent samo animira do njega.
const NEDELJA = 7 * 86400000;

function potrosnjaNedelja(playerId) {
  const od = Date.now() - NEDELJA;
  return round2(db.prepare(
    "SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE player_id=? AND type IN ('session','shop') AND created_at>=?"
  ).get(playerId, od).s);
}

export function tocakNagrade() {
  return db.prepare("SELECT * FROM tocak_nagrade ORDER BY sort, id").all();
}

// Sve što klijentu treba da prikaže točak za jednog igrača.
export function tocakInfo(playerId) {
  const ukljucen = getSetting("tocak_ukljucen", "0") === "1";
  const prag = Number(getSetting("tocak_prag", "1200")) || 0;
  const p = playerById(playerId);
  const potroseno = p ? potrosnjaNedelja(playerId) : 0;
  const now = Date.now();
  const cekaDo = p && p.last_spin_at ? p.last_spin_at + NEDELJA : 0;
  const naCekanju = cekaDo > now;
  return {
    ukljucen, prag, potroseno,
    ispunjava: potroseno >= prag,           // dovoljno potrošeno
    moze: ukljucen && potroseno >= prag && !naCekanju,
    sledeciSpin: naCekanju ? cekaDo : null, // kad ponovo može (ms)
    nagrade: tocakNagrade().map((n) => ({ naziv: n.naziv, kredit: n.kredit })),
  };
}

// Izloženo radi testa raspodele - da se proveri da težine stvarno rade.
export function izaberiNagradu(nagrade) {
  const ukupno = nagrade.reduce((a, n) => a + Math.max(0, n.tezina), 0);
  if (ukupno <= 0) return 0;
  let r = Math.random() * ukupno;
  for (let i = 0; i < nagrade.length; i++) { r -= Math.max(0, nagrade[i].tezina); if (r < 0) return i; }
  return nagrade.length - 1;
}

export function zavrtiTocak(playerId) {
  if (getSetting("tocak_ukljucen", "0") !== "1") return { error: "Točak trenutno nije aktivan" };
  const p = playerById(playerId);
  if (!p) return { error: "Nepostojeći igrač" };
  const prag = Number(getSetting("tocak_prag", "1200")) || 0;
  const potroseno = potrosnjaNedelja(playerId);
  if (potroseno < prag) return { error: `Potrebno je ${prag} potrošnje ove nedelje (imaš ${potroseno})` };
  const now = Date.now();
  if (p.last_spin_at && now - p.last_spin_at < NEDELJA) return { error: "Već si zavrteo ove nedelje" };
  const nagrade = tocakNagrade();
  if (!nagrade.length) return { error: "Nema podešenih nagrada" };
  const idx = izaberiNagradu(nagrade);
  const dobit = nagrade[idx];
  // Oznaka da je vrteo i isplata nagrade su JEDAN posao. Da nisu, pad između
  // njih bi ostavio igrača bez spina i bez nagrade - ili, u obrnutom redosledu,
  // sa nagradom koju može da uzme ponovo.
  let bal;
  try {
    bal = uJednomPoslu(() => {
      // Prvo upiši da je vrteo - da dupli klik ili puknuta veza ne daju drugi spin.
      db.prepare("UPDATE players SET last_spin_at=? WHERE id=?").run(now, playerId);
      let b = round2(Number(p.balance) || 0);
      if (dobit.kredit > 0) {
        b = round2(b + dobit.kredit);
        db.prepare("UPDATE players SET balance=? WHERE id=?").run(b, playerId);
        // Kredit sa točka je poklon, ne novac u kasi - zato 'bonus', a log bez
        // iznosa da ne uđe u pazar smene.
        addTransaction(playerId, "bonus", dobit.kredit, b, null, `Nagradni točak: ${dobit.naziv}`);
      }
      return b;
    });
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `Točak nije upisan: ${String(e?.message || e).slice(0, 150)}` });
    return { error: "Točak nije prošao. Pokušaj ponovo." };
  }
  logEvent({ category: "novac", action: "tocak", actor: p.username, target: p.username, detail: `Nagradni točak: ${dobit.naziv}` });
  const comp = db.prepare("SELECT id FROM computers WHERE current_player_id=?").get(playerId);
  if (comp) sendClient(comp.id, { t: "balance", balance: bal, remainingSeconds: remainingSeconds(bal) });
  pushComputers();
  return { ok: true, index: idx, nagrada: { naziv: dobit.naziv, kredit: dobit.kredit }, balance: bal, sledeciSpin: now + NEDELJA };
}

// --- podešavanje točka (vlasnik) ---
export function tocakConfig() {
  return {
    ukljucen: getSetting("tocak_ukljucen", "0") === "1",
    prag: Number(getSetting("tocak_prag", "1200")) || 0,
    nagrade: tocakNagrade(),
  };
}
export function postaviTocak({ ukljucen, prag }) {
  if (ukljucen != null) setSetting("tocak_ukljucen", ukljucen ? "1" : "0");
  if (prag != null) {
    const n = Number(prag);
    if (!Number.isFinite(n) || n < 0) return { error: "Prag mora biti broj veći ili jednak nuli" };
    setSetting("tocak_prag", String(Math.round(n)));
  }
  pushTocak();
  return { ok: true, ...tocakConfig() };
}
export function dodajNagradu({ naziv, kredit, tezina }) {
  naziv = String(naziv || "").trim();
  kredit = Number(kredit) || 0;
  tezina = Math.max(0, Math.round(Number(tezina) || 0));
  if (!naziv) return { error: "Naziv je obavezan" };
  if (kredit < 0) return { error: "Kredit ne može biti negativan" };
  if (tezina <= 0) return { error: "Težina mora biti veća od nule" };
  const sort = db.prepare("SELECT COALESCE(MAX(sort),0)+1 s FROM tocak_nagrade").get().s;
  const info = db.prepare("INSERT INTO tocak_nagrade (naziv, kredit, tezina, sort) VALUES (?,?,?,?)").run(naziv, kredit, tezina, sort);
  pushTocak();
  return { ok: true, id: info.lastInsertRowid };
}
export function izmeniNagradu(id, { naziv, kredit, tezina }) {
  const n = db.prepare("SELECT * FROM tocak_nagrade WHERE id=?").get(id);
  if (!n) return { error: "Nagrada ne postoji" };
  const ime = naziv == null ? n.naziv : String(naziv).trim();
  const kr = kredit == null ? n.kredit : Number(kredit);
  const tz = tezina == null ? n.tezina : Math.max(0, Math.round(Number(tezina)));
  if (!ime) return { error: "Naziv je obavezan" };
  if (!Number.isFinite(kr) || kr < 0) return { error: "Kredit ne može biti negativan" };
  if (!Number.isFinite(tz) || tz <= 0) return { error: "Težina mora biti veća od nule" };
  db.prepare("UPDATE tocak_nagrade SET naziv=?, kredit=?, tezina=? WHERE id=?").run(ime, kr, tz, id);
  pushTocak();
  return { ok: true };
}
export function obrisiNagradu(id) {
  const n = db.prepare("SELECT * FROM tocak_nagrade WHERE id=?").get(id);
  if (!n) return { error: "Nagrada ne postoji" };
  db.prepare("DELETE FROM tocak_nagrade WHERE id=?").run(id);
  pushTocak();
  return { ok: true };
}
// Kad se točak upali/ugasi ili nagrade promene, prijavljeni igrači dobiju svež
// prikaz odmah - bez ponovnog učitavanja.
export function pushTocak() {
  for (const c of db.prepare("SELECT id, current_player_id FROM computers WHERE current_player_id IS NOT NULL").all()) {
    sendClient(c.id, { t: "tocak", tocak: tocakInfo(c.current_player_id) });
  }
}

// POS: radnik ručno kuca porudžbinu (kredit sa naloga ili keš)
export function createPosOrder({ items, playerId, computerId, payment = "cash", note, actor = "radnik" }) {
  // Isti artikal se spaja u jedan red - inace bi se zaliha proveravala vise
  // puta prema istom stanju i prodalo bi se vise nego sto ima. Radnik sme veci
  // broj komada i skrivene artikle.
  const resolved = spojiStavke(items, { najviseKomada: 50, samoDostupne: false });
  if (!resolved.length) return { error: "Dodajte bar jedan artikal" };
  const total = resolved.reduce((s, r) => s + r.item.price * r.qty, 0);

  const short = stockShortage(resolved);
  if (short) return { error: `"${short.item.name}" je rasprodato ili nema dovoljno na stanju` };

  let player = null;
  if (payment === "credit") {
    if (!playerId) return { error: "Za plaćanje kreditom izaberite igrača" };
    player = playerById(playerId);
    if (!player) return { error: "Igrač ne postoji" };
    if (player.balance < total) return { error: `Nedovoljno kredita (potrebno ${round2(total)}, ima ${round2(player.balance)})` };
  } else {
    payment = "cash";
    if (playerId) player = playerById(playerId);
  }

  const now = Date.now();
  // Račun, stavke, zaliha i naplata su JEDAN posao - vidi clientOrder.
  let orderId, javiIgracu = null;
  try {
    ({ orderId, javiIgracu } = uJednomPoslu(() => {
      const info = db.prepare(
        "INSERT INTO orders (player_id, computer_id, total, status, payment, source, note, created_at) VALUES (?,?,?,?,?,?,?,?)"
      ).run(player ? player.id : null, computerId || null, total, "pending", payment, "pos", note || null, now);
      const id = info.lastInsertRowid;
      const insItem = db.prepare("INSERT INTO order_items (order_id, item_id, name, price, qty) VALUES (?,?,?,?,?)");
      for (const r of resolved) insItem.run(id, r.item.id, r.item.name, r.item.price, r.qty);
      consumeStock(resolved);

      let javi = null;
      if (payment === "credit" && player) {
        const newBal = round2(player.balance - total);
        db.prepare("UPDATE players SET balance=? WHERE id=?").run(newBal, player.id);
        addTransaction(player.id, "shop", -total, newBal, null, `POS porudžbina #${id}`);
        javi = { newBal };
      }
      return { orderId: id, javiIgracu: javi };
    }));
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `POS račun nije upisan: ${String(e?.message || e).slice(0, 150)}` });
    return { error: "Račun nije upisan. Pokušaj ponovo." };
  }
  // Javljanje igraču ide POSLE potvrde upisa - inače bi mu pisalo novo stanje
  // kredita za račun koji na kraju nije prošao.
  if (javiIgracu && player) {
    const comp = db.prepare("SELECT id FROM computers WHERE current_player_id = ?").get(player.id);
    if (comp) sendClient(comp.id, { t: "balance", balance: javiIgracu.newBal, remainingSeconds: remainingSeconds(javiIgracu.newBal) });
  }

  pushOrders();
  pushComputers();
  const who = player ? player.username : "keš";
  logEvent({ category: "shop", action: "pos", actor, target: who, detail: `POS #${orderId} (${payment === "cash" ? "keš" : "kredit"}): ` + resolved.map((r) => `${r.qty}x ${r.item.name}`).join(", "), amount: -total });
  broadcastPanels({ t: "event", kind: "order", text: `Nova porudžbina #${orderId} (${payment === "cash" ? "keš" : who})` });
  return { ok: true, orderId, total: round2(total) };
}

const ORDER_STATUS_LABEL = { pending: "na čekanju", preparing: "priprema se", delivered: "dostavljeno", cancelled: "otkazano" };

export function setOrderStatus(orderId, status, actor = "osoblje") {
  const valid = ["pending", "preparing", "delivered", "cancelled"];
  if (!valid.includes(status)) return { error: "Neispravan status" };
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  if (!o) return { error: "Nepostojeća porudžbina" };
  if (o.status === status) return { ok: true }; // ništa se nije promenilo

  const cancelling = status === "cancelled" && o.status !== "cancelled";

  // OTKAZIVANJE JE JEDAN POSAO: vraćen kredit, nov status i poništenje u
  // obračunu moraju da prođu zajedno. Da nisu, pad između njih ostavlja
  // porudžbinu koja je i naplaćena i otkazana (ili obrnuto: kredit vraćen, a
  // porudžbina i dalje stoji u pazaru).
  let vracen = null, log, vracenoNaStanje = [];
  try {
    ({ vracen, log, vracenoNaStanje } = uJednomPoslu(() => {
      // Piće se vraća na stanje u ISTOM poslu sa kreditom - inače bi pad između
      // njih ostavio gosta sa vraćenim novcem i pićem koje i dalje fali u
      // evidenciji (ili obrnuto).
      const naStanje = cancelling ? vratiStock(orderId) : [];
      let v = null;
      // otkazivanje vraca kredit (samo ako je plaćeno kreditom sa naloga)
      if (cancelling && o.payment === "credit" && o.player_id) {
        const p = playerById(o.player_id);
        if (p) {
          const newBal = round2(p.balance + o.total);
          db.prepare("UPDATE players SET balance=? WHERE id=?").run(newBal, p.id);
          addTransaction(p.id, "refund", o.total, newBal, null, `Otkazana porudžbina #${orderId}`);
          v = { playerId: p.id, newBal };
        }
      }
      db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, orderId);
      // Pozitivan iznos poništava original u obračunu smene - bez ovoga bi
      // otkazana porudžbina i dalje stajala u pazaru.
      return { vracen: v, log: cancelling
        ? upisiLog({ category: "shop", action: "order_cancel", actor, target: `#${orderId}`,
            detail: `Otkazana porudžbina #${orderId}${o.payment === "credit" ? " - kredit vraćen" : ""}`,
            amount: round2(o.total) })
        : upisiLog({ category: "shop", action: "order_status", actor, target: `#${orderId}`,
            detail: `Porudžbina #${orderId}: ${ORDER_STATUS_LABEL[status] || status}` }),
        vracenoNaStanje: naStanje };
    }));
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `Status porudžbine #${orderId} nije upisan: ${String(e?.message || e).slice(0, 150)}` });
    return { error: "Izmena nije prošla. Pokušaj ponovo." };
  }
  javiLog(log);
  if (vracen) {
    const comp = db.prepare("SELECT id FROM computers WHERE current_player_id = ?").get(vracen.playerId);
    if (comp) sendClient(comp.id, { t: "balance", balance: vracen.newBal, remainingSeconds: remainingSeconds(vracen.newBal) });
  }

  if (o.computer_id) sendClient(o.computer_id, { t: "order_status", orderId, status });
  posaljiPorudzbineIgracu(o.player_id);
  // Vraceno pice mora odmah da se vidi i u launcheru ("Rasprodato" nestaje) i u
  // traci za dopunu na kontrolnoj tabli.
  if (vracenoNaStanje.length) pushCatalog();
  pushOrders();
  pushComputers();
  return { ok: true };
}

export function setPlayerBanned(playerId, banned) {
  db.prepare("UPDATE players SET banned=? WHERE id=?").run(banned ? 1 : 0, playerId);
  if (banned) {
    const comp = db.prepare("SELECT * FROM computers WHERE current_player_id = ?").get(playerId);
    if (comp) endSession(comp.id, { lock: false, reason: "banned" });
  }
  return { ok: true };
}

export function resetPlayerPassword(playerId, newPassword) {
  if (!newPassword || String(newPassword).length < 3) return { error: "Lozinka prekratka" };
  db.prepare("UPDATE players SET password_hash=? WHERE id=?").run(hashPassword(newPassword), playerId);
  return { ok: true };
}

export function updatePlayer(id, { username, displayName, note }) {
  const p = playerById(id);
  if (!p) return { error: "Igrač ne postoji" };
  username = String(username ?? p.username).trim();
  if (!username) return { error: "Korisničko ime je obavezno" };
  if (username !== p.username) {
    if (db.prepare("SELECT id FROM computers WHERE current_player_id=?").get(id))
      return { error: "Igrač je trenutno prijavljen - korisničko ime ne može da se menja dok igra" };
    if (db.prepare("SELECT id FROM players WHERE username=? AND id!=?").get(username, id))
      return { error: "Korisničko ime već postoji" };
  }
  const dn = String(displayName ?? p.display_name ?? "").trim() || username;
  const nt = String(note ?? p.note ?? "").trim() || null;
  db.prepare("UPDATE players SET username=?, display_name=?, note=? WHERE id=?").run(username, dn, nt, id);
  pushComputers();
  return { ok: true };
}

// Trajno brisanje naloga: čisti sesije i transakcije, porudžbine ostaju bez vlasnika.
// Finansijski trag ostaje u logovima.
export function deletePlayer(id) {
  const p = playerById(id);
  if (!p) return { error: "Igrač ne postoji" };
  if (db.prepare("SELECT id FROM computers WHERE current_player_id=?").get(id))
    return { error: "Igrač je trenutno prijavljen - prvo ga odjavi" };
  // Sirov BEGIN je zamenjen zajedničkim `uJednomPoslu`: on broji dubinu i
  // koristi SAVEPOINT kad je već u poslu. Sa sirovim BEGIN-om bi ovo puklo
  // ("cannot start a transaction within a transaction") čim bi se brisanje
  // pozvalo iz nekog šireg posla - a čišćenje gostiju već briše u petlji.
  try {
    uJednomPoslu(() => {
      db.prepare("UPDATE orders SET player_id=NULL WHERE player_id=?").run(id);
      db.prepare("DELETE FROM transactions WHERE player_id=?").run(id);
      db.prepare("DELETE FROM sessions WHERE player_id=?").run(id);
      db.prepare("DELETE FROM players WHERE id=?").run(id);
    });
  } catch (e) {
    return { error: "Brisanje nije uspelo: " + e.message };
  }
  return { ok: true, username: p.username };
}

// SERVER INFO (podešavanja)
export function serverInfo() {
  // Mora da ide preko DATA_DIR, ne preko pretpostavljene putanje - inace bi
  // izolovana instanca prijavljivala velicinu i kopije tudje baze.
  const dataDir = DATA_DIR;
  const sz = (f) => { try { return fs.statSync(path.join(dataDir, f)).size; } catch { return 0; } };
  let backups = [];
  try {
    const dir = path.join(dataDir, "backups");
    backups = fs.readdirSync(dir)
      .filter((f) => f.startsWith("crit-") && f.endsWith(".db"))
      .map((f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } })
      .sort((a, b) => b - a);
  } catch {}
  // Ako se package.json ne procita, bolje da pise "nepoznata" nego izmisljen
  // broj - inace bi panel javljao verziju koja nikad nije postojala.
  let version = "nepoznata";
  try { version = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || version; } catch {}
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal) ips.push(i.address);
    }
  }
  return {
    version,
    node: process.version,
    port: Number(process.env.PORT || 8095),
    startedAt: Date.now() - Math.floor(process.uptime() * 1000),
    ips,
    dbSizeBytes: sz("crit.db") + sz("crit.db-wal"),
    backups: { count: backups.length, lastAt: backups[0] || null },
  };
}

export function round2(n) {
  const x = Math.round(Number(n) * 100) / 100;
  // Infinity i NaN se u SQLite upisu kao NULL i trajno pokvare nalog, pa se
  // ovde zaustavljaju - bolje nula nego neupotrebljiv zapis.
  return Number.isFinite(x) ? x : 0;
}

// Gornja granica za sve iznose koje osoblje kuca. Nijedan realan promet u
// igraonici nije blizu ovoga, a greska u kucanju se zaustavlja pre baze.
const MAX_IZNOS = 1000000;
export function ispravanIznos(n) {
  const x = Number(n);
  return Number.isFinite(x) && Math.abs(x) <= MAX_IZNOS;
}

// Daljinske komande
// "taskmgr" je izbacen: otvarao je Task Manager NA racunaru igraca, pa je
// radnik morao da ustane i ode do te masine - a igrac bi u medjuvremenu imao
// Task Manager pred sobom. Zamenjen je daljinskim prikazom (procesiRacunara).
const POWER_CMDS = ["shutdown", "restart", "logoff", "reboot_launcher"];

export function sendCommand(computerId, cmd) {
  if (!POWER_CMDS.includes(cmd)) return { error: "Nepoznata komanda" };
  const ok = sendClient(computerId, { t: "command", cmd });
  if (ok) broadcastPanels({ t: "event", kind: "cmd", text: `Komanda "${cmdLabel(cmd)}" poslata na ${compName(computerId)}` });
  return ok ? { ok: true } : { error: "Računar nije povezan" };
}

export function bulkAction(ids, action) {
  const targets = ids && ids.length ? ids : db.prepare("SELECT id FROM computers").all().map((r) => r.id);
  let sent = 0;
  for (const id of targets) {
    if (action === "lock") { lockComputer(id, null); sent++; }
    else if (action === "unlock") {
      // grupno otključavanje dira samo zaključane - ne prekida aktivne sesije
      const c = computerById(id);
      if (c && c.status === "locked") { unlockComputer(id, null); sent++; }
    }
    else if (action === "logout") { forceLogout(id, null); sent++; }
    else { const r = sendCommand(id, action); if (r.ok) sent++; }
  }
  return { ok: true, sent, total: targets.length };
}

function compName(id) { return db.prepare("SELECT name FROM computers WHERE id=?").get(id)?.name || "?"; }
function cmdLabel(c) { return { shutdown: "Ugasi", restart: "Restartuj", logoff: "Odjava Windows", reboot_launcher: "Restart launchera" }[c] || c; }

// Radnici / admini
export function listAdmins() {
  // Ugaseni nalozi idu na dno, ali se VIDE: vlasnik mora da zna ko je sve imao
  // pristup, i da moze da vrati radnika koji se vratio na posao.
  return db.prepare("SELECT id, username, role, active, created_at FROM admins ORDER BY active DESC, role='owner' DESC, username")
    .all().map((a) => ({ id: a.id, username: a.username, role: a.role, aktivan: a.active !== 0, createdAt: a.created_at }));
}
export function createAdmin({ username, password, role }) {
  username = String(username || "").trim();
  if (!username || !password) return { error: "Korisničko ime i lozinka su obavezni" };
  if (!["owner", "staff"].includes(role)) role = "staff";
  if (db.prepare("SELECT id FROM admins WHERE username=?").get(username)) return { error: "Korisničko ime već postoji" };
  const info = db.prepare("INSERT INTO admins (username, password_hash, role, created_at) VALUES (?,?,?,?)")
    .run(username, hashPassword(password), role, Date.now());
  return { ok: true, id: info.lastInsertRowid };
}
export function updateAdminPassword(id, newPassword) {
  if (!newPassword || String(newPassword).length < 3) return { error: "Lozinka mora imati bar 3 znaka" };
  db.prepare("UPDATE admins SET password_hash=? WHERE id=?").run(hashPassword(newPassword), id);
  zaboraviProveruLozinke(); // upozorenje o fabrickoj lozinki mora odmah da nestane
  // reset lozinke odjavljuje taj nalog sa svih panela
  db.prepare("DELETE FROM admin_tokens WHERE admin_id=?").run(id);
  return { ok: true };
}
export function deleteAdmin(id, currentAdminId) {
  const a = db.prepare("SELECT * FROM admins WHERE id=?").get(id);
  if (!a) return { error: "Nalog ne postoji" };
  if (a.id === currentAdminId) return { error: "Ne možete obrisati sopstveni nalog" };
  const owners = db.prepare("SELECT COUNT(*) c FROM admins WHERE role='owner' AND active=1").get().c;
  if (a.role === "owner" && owners <= 1) return { error: "Mora postojati bar jedan vlasnik" };

  // OTPUSTEN RADNIK: nalog se GASI, ne brise.
  //
  // Smene i promet pokazuju ko je otvorio kasu i ko je upisao dopunu. Kad bi se
  // nalog obrisao, ti redovi bi ostali bez imena i obracun smene vise ne bi
  // imao smisla - a upravo zbog obracuna sve to i postoji. Ranije je brisanje
  // pucalo na stranom kljucu cim je radnik jednom otvorio smenu: vlasnik nije
  // mogao da mu oduzme pristup, a nalog i token su nastavljali da rade.
  //
  // Nalog bez ijednog traga (napravljen greskom, nikad korišćen) se brise skroz,
  // da spisak ne skuplja prazne redove.
  const trag = db.prepare(
    "SELECT (SELECT COUNT(*) FROM shifts WHERE admin_id=?) + (SELECT COUNT(*) FROM transactions WHERE admin_id=?) c"
  ).get(id, id).c;

  const r = uJednomPoslu(() => {
    db.prepare("DELETE FROM admin_tokens WHERE admin_id=?").run(id);
    if (trag === 0) {
      db.prepare("DELETE FROM admins WHERE id=?").run(id);
      return { ok: true, obrisan: true };
    }
    db.prepare("UPDATE admins SET active=0 WHERE id=?").run(id);
    return { ok: true, ugasen: true };
  });
  izbaciPanel(id);
  return r;
}

// Vracanje ugasenog naloga (radnik se vratio na posao).
export function vratiAdmin(id) {
  const a = db.prepare("SELECT * FROM admins WHERE id=?").get(id);
  if (!a) return { error: "Nalog ne postoji" };
  db.prepare("UPDATE admins SET active=1 WHERE id=?").run(id);
  return { ok: true };
}
export function changeOwnPassword(adminId, oldPassword, newPassword) {
  const a = db.prepare("SELECT * FROM admins WHERE id=?").get(adminId);
  if (!a || !verifyPassword(oldPassword, a.password_hash)) return { error: "Trenutna lozinka nije tačna" };
  if (!newPassword || String(newPassword).length < 3) return { error: "Nova lozinka mora imati bar 3 znaka" };
  db.prepare("UPDATE admins SET password_hash=? WHERE id=?").run(hashPassword(newPassword), adminId);
  zaboraviProveruLozinke();
  return { ok: true };
}

// SLIKE (shop artikli, cover igre, baner igre)
function saveImage(table, prefix, id, dataUrl, col = "image", maxBytes = 3 * 1024 * 1024) {
  const item = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!item) return { error: "Stavka ne postoji" };
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return { error: "Neispravan format slike (PNG, JPG, WEBP ili GIF)" };
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > maxBytes) return { error: `Slika je prevelika (maksimum ${Math.round(maxBytes / 1048576)} MB)` };
  const dir = path.join(__dirname, "..", "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  // obriši staru sliku ako postoji
  if (item[col]) { try { fs.unlinkSync(path.join(__dirname, "..", "public", item[col])); } catch {} }
  const fname = `${prefix}-${id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), buf);
  const url = `/uploads/${fname}`;
  db.prepare(`UPDATE ${table} SET ${col}=? WHERE id=?`).run(url, id);
  return { ok: true, image: url };
}
function removeImage(table, id, col = "image") {
  const item = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (item?.[col]) { try { fs.unlinkSync(path.join(__dirname, "..", "public", item[col])); } catch {} }
  db.prepare(`UPDATE ${table} SET ${col}=NULL WHERE id=?`).run(id);
  return { ok: true };
}
// POZADINE EKRANA U LAUNCHERU
// Slike se kace kroz panel, ne u folder launchera - inace bi se menjale rucno
// na svakom racunaru. Ovako vlasnik okaci jednom i svih 13 dobije odmah.
export const POZADINE = {
  prijava: { naziv: "Prijava", opis: "Ekran za prijavu igrača, stoji ceo dan kad je računar slobodan" },
  pocetna: { naziv: "Početna", opis: "Iza hero banera, police igara i alata" },
  shop: { naziv: "Shop", opis: "Iza kartica pića i korpe" },
  nalog: { naziv: "Nalog", opis: "Strana sa podacima igrača i porudžbinama" },
  zakljucan: { naziv: "Zaključan ekran", opis: "Kad igraču istekne vreme ili osoblje zaključa računar" },
};

export function pozadineObj() {
  const out = {};
  for (const k of Object.keys(POZADINE)) out[k] = getSetting(`pozadina_${k}`, null) || null;
  return out;
}

export function savePozadinu(kljuc, dataUrl) {
  if (!POZADINE[kljuc]) return { error: "Nepoznat ekran" };
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return { error: "Neispravan format slike (PNG, JPG ili WEBP)" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) return { error: "Slika je prevelika (maksimum 8 MB)" };
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const dir = path.join(__dirname, "..", "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const staro = getSetting(`pozadina_${kljuc}`, null);
  if (staro) { try { fs.unlinkSync(path.join(__dirname, "..", "public", staro)); } catch {} }
  const fname = `pozadina-${kljuc}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), buf);
  const url = `/uploads/${fname}`;
  setSetting(`pozadina_${kljuc}`, url);
  pushPozadine();
  return { ok: true, image: url };
}

export function removePozadinu(kljuc) {
  if (!POZADINE[kljuc]) return { error: "Nepoznat ekran" };
  const staro = getSetting(`pozadina_${kljuc}`, null);
  if (staro) { try { fs.unlinkSync(path.join(__dirname, "..", "public", staro)); } catch {} }
  setSetting(`pozadina_${kljuc}`, "");
  pushPozadine();
  return { ok: true };
}

// Launcheri odmah dobijaju novu pozadinu, bez restarta.
export function pushPozadine() {
  broadcastClients({ t: "pozadine", pozadine: pozadineObj() });
}

// TEKSTURA POZADINE
// Sitna sara koja se ponavlja preko cele pozadine. Ne cuva se kao slika nego
// kao izbor - launcher je crta sam, pa je ostra na svakoj rezoluciji, ne tezi
// nista i ne mora da se salje kroz mrezu.
// Sara se pise SAMO ovde. I launcher i panel je dobijaju odavde, pa pregled u
// panelu ne moze da se razidje od onoga sto igrac vidi.
// Prozirnost je po sari razlicita namerno: tackice pokrivaju malo povrsine pa
// im treba vise, kose linije pokrivaju mnogo pa im treba manje - da sve sare
// deluju podjednako prisutno kad se prebacuje sa jedne na drugu.
const svg = (s) => `url("data:image/svg+xml,${s.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}")`;

// ISKRE: ista sara, ali u boji kuce i punom jacinom.
// Sluzi za kretanje "Iskre" - preko nasumicne plocice u mrezi legne ista figura
// u crvenom, zasvetli i ugasi se. Zato mora da bude ISTI obris: da bi se crvena
// figura poklopila sa belom ispod nje, ne sme da se crta posebno.
const BOJA_ISKRE = "#ff2b2b";
const uIskru = (obris) => obris
  .replace(/#fff\b/g, BOJA_ISKRE)
  .replace(/(fill|stroke)-opacity='[\d.]+'/g, "$1-opacity='0.95'");

// Crvena varijanta se izvlaci iz vec napisane bele - sara se ne pise dvaput,
// pa ne mogu da se raziđu.
const dekodiraj = (u) => String(u)
  .replace(/^url\("data:image\/svg\+xml,/, "").replace(/"\)$/, "")
  .replace(/%3C/g, "<").replace(/%3E/g, ">").replace(/%23/g, "#");
const iskraOd = (sara) => (sara ? svg(uIskru(dekodiraj(sara))) : "");

export const TEKSTURE = {
  nema: { naziv: "Bez teksture", opis: "Čista pozadina, samo gradijent", sara: "", korak: 0 },

  tacke: {
    naziv: "Tačkice", opis: "Rasterske tačke iz štampe stripa, najbliže logotipu", korak: 14,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14'><circle cx='3.5' cy='3.5' r='1.15' fill='#fff' fill-opacity='0.17'/><circle cx='10.5' cy='10.5' r='1.15' fill='#fff' fill-opacity='0.17'/></svg>`),
  },
  zvezde: {
    naziv: "Zvezdice", opis: "Sitne zvezde iz Crit logotipa, poređane u red", korak: 58,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='58' height='58'><path d='M14 4c1.1 6 2.9 7.8 8.9 8.9-6 1.1-7.8 2.9-8.9 8.9-1.1-6-2.9-7.8-8.9-8.9C11.1 11.8 12.9 10 14 4z' fill='#fff' fill-opacity='0.16'/><path d='M43 33c.75 4.1 1.98 5.33 6.08 6.08-4.1.75-5.33 1.98-6.08 6.08-.75-4.1-1.98-5.33-6.08-6.08C41.02 38.33 42.25 37.1 43 33z' fill='#fff' fill-opacity='0.12'/></svg>`),
  },
  prasak: {
    naziv: "Praskovi", opis: "Mali strip prasak, isti oblik kao logotip", korak: 52,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='52' height='52'><path d='M28 10.2L19.5 15L27.3 19.5L19.1 18.5L20.7 24.9L15.9 19.8L12.7 28.3L12.7 19L4.4 23.9L10.8 16.5L1.9 15L9.9 13.2L6.2 7.6L12.5 10.8L12.6 1.7L15.8 10.5L21.9 3L18.5 12.1Z' fill='#fff' fill-opacity='0.14'/><path d='M45.9 42.3L39.8 40.3L40.4 46.2L37.6 41.5L34.4 44.5L35.5 40L29.6 40.5L35 37.7L30.1 33.7L36.2 35.7L35.6 29.8L38.4 34.5L41.6 31.5L40.5 36L46.4 35.5L41 38.3Z' fill='#fff' fill-opacity='0.1'/></svg>`),
  },
  kose: {
    naziv: "Kose linije", opis: "Strip linije brzine, pod uglom", korak: 16,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><path d='M-4 20L20 -4M-4 12L12 -4M4 20L20 4' stroke='#fff' stroke-opacity='0.09' stroke-width='1.3'/></svg>`),
  },

  // Kockica sa 20 strana je znak kritičnog pogotka - odatle i ime igraonice.
  // Od svih šara ova jedina nešto ZNAČI, pa je i najbolji izbor za kuću.
  kockice: {
    naziv: "Kockice d20", opis: "Znak kritičnog pogotka - odatle i ime Crit", korak: 64,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><g fill='none' stroke='#fff' stroke-opacity='0.15' stroke-width='1.4' stroke-linejoin='round'><path d='M16 3L27.3 9.5L27.3 22.5L16 29L4.7 22.5L4.7 9.5Z'/><path d='M16 9.5L21.6 19.3L10.3 19.3Z'/><path d='M16 3L16 9.5M27.3 22.5L21.6 19.3M4.7 22.5L10.3 19.3'/></g><g transform='translate(32 32) scale(0.62)' fill='none' stroke='#fff' stroke-opacity='0.1' stroke-width='2.2' stroke-linejoin='round'><path d='M16 3L27.3 9.5L27.3 22.5L16 29L4.7 22.5L4.7 9.5Z'/><path d='M16 9.5L21.6 19.3L10.3 19.3Z'/></g></svg>`),
  },
  // Sestougaona mreza - najmirnija od svih, dobra ispod okacene fotografije.
  // Kljuc je namerno bez nasih slova - ide kroz API i CSS.
  sace: {
    naziv: "Saće", opis: "Šestougaona mreža, mirna i tehnička", korak: 56,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='56' height='32'><g fill='none' stroke='#fff' stroke-opacity='0.1' stroke-width='1.1'><path d='M14 1L28 9L28 25L14 33L0 25L0 9Z'/><path d='M42 1L56 9L56 25L42 33L28 25L28 9Z'/></g></svg>`),
  },
  // Munje: energija, uz shop sa energetskim picima i uz gaming.
  munje: {
    naziv: "Munje", opis: "Sitne munje, najživlja od svih šara", korak: 48,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><path d='M14 4L7 21h6l-3 13 12-19h-7l4-11z' fill='#fff' fill-opacity='0.14'/><path d='M37 27L32.5 38h3.8l-1.9 8.4L42 34h-4.5l2.5-7z' fill='#fff' fill-opacity='0.1'/></svg>`),
  },
  // Slovo iz logotipa, okrenuto naizmenicno - najbrendiranija sara.
  crit: {
    naziv: "CRIT", opis: "Ime kuće kao šara, najbrendiranije", korak: 96,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><text x='6' y='30' font-family='Segoe UI, Arial, sans-serif' font-size='21' font-weight='900' letter-spacing='2' fill='#fff' fill-opacity='0.11'>CRIT</text><text x='54' y='78' font-family='Segoe UI, Arial, sans-serif' font-size='15' font-weight='900' letter-spacing='2' fill='#fff' fill-opacity='0.075' transform='rotate(-14 54 78)'>CRIT</text></svg>`),
  },
  romb: {
    naziv: "Rombovi", opis: "Mirna dijagonalna šara, najdiskretnija", korak: 34,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34'><path d='M17 2l15 15-15 15L2 17z' fill='none' stroke='#fff' stroke-opacity='0.11' stroke-width='1.1'/></svg>`),
  },
};
export const JACINE = { slabo: "Slabo", srednje: "Srednje", jako: "Jako" };
export const PROZIRNOSTI = { slabo: 0.45, srednje: 0.75, jako: 1 };

// KRETANJE SARE
// Sara moze polako da klizi. Namerno je SPORO: ovo stoji ceo dan iza igara i
// ne sme da vuce pogled dok neko igra. Brzina je u sekundama po jednom koraku
// (jedna plocica), pa je kretanje besavno bez obzira na velicinu sare.
// "mirno" je podrazumevano - ko ne zeli kretanje, ne mora da ga ima.
// Svako kretanje ima JEDNU dobro podesenu brzinu. Ranije su postojali "lagano"
// i "zivo" kao dve brzine istog klizanja - to je bio jedan efekat sa klizacem,
// a ne izbor. Sad je svaki nacin svoja stvar.
export const KRETANJA = {
  mirno: { naziv: "Mirno", opis: "Šara stoji", sekundi: 0 },
  klizanje: { naziv: "Klizanje", opis: "Šara polako putuje po dijagonali", sekundi: 30 },
  talas: { naziv: "Talas", opis: "Svetlo prelazi preko šare, kao odsjaj", sekundi: 15 },
  dubina: { naziv: "Dubina", opis: "Dva sloja, bliži prati pokret miša", sekundi: 44 },
  // Nasumicne figure u mrezi na trenutak zasvetle u boji kuce pa se ugase.
  // Sara stoji - pomera se samo svetlo, i to na malo mesta odjednom.
  iskre: { naziv: "Iskre", opis: "Pojedine figure zasvetle crveno pa se ugase", sekundi: 0 },
};
// Stara imena iz ranijih verzija - da vec sacuvan izbor ne ispadne "nepoznat"
// i tiho se ugasi kad se server nadogradi.
const STARA_KRETANJA = { lagano: "klizanje", zivo: "klizanje" };

// Pretvara izbor u gotove vrednosti za CSS. Radi i za kucnu teksturu i za
// igracevu, pa je pravilo na jednom mestu.
export function spremiTeksturu({ kljuc, jacina, kretanje } = {}) {
  const k = TEKSTURE[kljuc] ? kljuc : "nema";
  const j = JACINE[jacina] ? jacina : "srednje";
  const staro = STARA_KRETANJA[kretanje];
  const kr = KRETANJA[kretanje] ? kretanje : (staro || "mirno");
  // Bez sare nema sta da se pomera, pa se kretanje gasi umesto da CSS vrti
  // praznu animaciju u krug.
  const radi = k !== "nema" && kr !== "mirno";
  const vazi = radi ? kr : "mirno";
  return {
    kljuc: k, jacina: j, kretanje: vazi,
    sara: TEKSTURE[k].sara,
    prozirnost: k === "nema" ? 0 : PROZIRNOSTI[j],
    // Korak je velicina plocice: kretanje pomera saru za tacno jednu plocicu,
    // pa se petlja zatvara bez vidljivog skoka. Iskre ga koriste da se crvena
    // figura poklopi tacno sa belom ispod nje.
    korak: TEKSTURE[k].korak || 0,
    sekundi: radi ? KRETANJA[vazi].sekundi : 0,
    // Ista sara u boji kuce - salje se samo kad zatreba, da welcome ne nosi
    // dvostruko vise podataka bez potrebe.
    iskra: vazi === "iskre" ? iskraOd(TEKSTURE[k].sara) : "",
  };
}

export function teksturaObj() {
  return spremiTeksturu({
    kljuc: getSetting("tekstura", "nema"),
    jacina: getSetting("tekstura_jacina", "srednje"),
    kretanje: getSetting("tekstura_kretanje", "mirno"),
  });
}

export function saveTeksturu(kljuc, jacina, kretanje) {
  if (!TEKSTURE[kljuc]) return { error: "Nepoznata tekstura" };
  if (jacina != null && !JACINE[jacina]) return { error: "Nepoznata jačina" };
  if (kretanje != null && !KRETANJA[kretanje] && !STARA_KRETANJA[kretanje]) return { error: "Nepoznato kretanje" };
  if (kretanje != null) kretanje = KRETANJA[kretanje] ? kretanje : STARA_KRETANJA[kretanje];
  setSetting("tekstura", kljuc);
  if (jacina != null) setSetting("tekstura_jacina", jacina);
  if (kretanje != null) setSetting("tekstura_kretanje", kretanje);
  pushTeksturu();
  return { ok: true, ...teksturaObj() };
}

export function pushTeksturu() {
  broadcastClients({ t: "tekstura", tekstura: teksturaObj() });
  // Prijavljeni igraci koji imaju SVOJU pozadinu ne smeju da je izgube kad
  // vlasnik promeni kucnu - njima se ponovo salje njihova.
  for (const c of db.prepare("SELECT id, current_player_id FROM computers WHERE current_player_id IS NOT NULL").all()) {
    const t = temaIgraca(c.current_player_id);
    if (t) sendClient(c.id, { t: "tekstura", tekstura: t });
  }
}

// TEKSTURA IGRACA
// Igrac bira svoju saru na svom nalogu, u launcheru. Vazi samo dok je on
// prijavljen; kad se odjavi, racunar se vraca na kucnu.
export function temaIgraca(playerId) {
  const red = db.prepare("SELECT tema FROM players WHERE id=?").get(playerId);
  if (!red || !red.tema) return null;
  let t;
  try { t = JSON.parse(red.tema); } catch { return null; }
  if (!t || typeof t !== "object" || t.kljuc === "kuca") return null;
  return spremiTeksturu(t);
}

export function sacuvajTemuIgraca(playerId, { kljuc, jacina, kretanje } = {}) {
  // "kuca" znaci: vrati me na ono sto je vlasnik podesio.
  if (kljuc === "kuca") {
    db.prepare("UPDATE players SET tema=NULL WHERE id=?").run(playerId);
    return { ok: true, tema: null, tekstura: teksturaObj() };
  }
  if (!TEKSTURE[kljuc]) return { error: "Nepoznata tekstura" };
  if (jacina != null && !JACINE[jacina]) return { error: "Nepoznata jačina" };
  if (kretanje != null && !KRETANJA[kretanje] && !STARA_KRETANJA[kretanje]) return { error: "Nepoznato kretanje" };
  const t = spremiTeksturu({ kljuc, jacina, kretanje });
  db.prepare("UPDATE players SET tema=? WHERE id=?")
    .run(JSON.stringify({ kljuc: t.kljuc, jacina: t.jacina, kretanje: t.kretanje }), playerId);
  return { ok: true, tema: { kljuc: t.kljuc, jacina: t.jacina, kretanje: t.kretanje }, tekstura: t };
}

// Sta racunar treba da prikaze: igraceva sara ako je ima, inace kucna.
export function teksturaZaRacunar(playerId) {
  return (playerId && temaIgraca(playerId)) || teksturaObj();
}

// PROMO BANERI (vrh pocetne u launcheru)
export function promoLista() {
  return db.prepare("SELECT * FROM promo ORDER BY sort, id").all();
}
// samo ono sto igrac treba da vidi
export function promoZaKlijenta() {
  return db.prepare("SELECT id, image, naziv FROM promo WHERE available = 1 ORDER BY sort, id").all();
}

export function dodajPromo(dataUrl, naziv) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return { error: "Neispravan format slike (PNG, JPG ili WEBP)" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) return { error: "Slika je prevelika (maksimum 8 MB)" };
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const dir = path.join(__dirname, "..", "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const fname = `promo-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), buf);
  const url = `/uploads/${fname}`;
  const zadnji = db.prepare("SELECT COALESCE(MAX(sort), 0) s FROM promo").get().s;
  const info = db.prepare("INSERT INTO promo (image, naziv, available, sort, created_at) VALUES (?,?,1,?,?)")
    .run(url, String(naziv || "").trim() || null, zadnji + 1, Date.now());
  pushPromo();
  return { ok: true, id: info.lastInsertRowid, image: url };
}

export function obrisiPromo(id) {
  const p = db.prepare("SELECT * FROM promo WHERE id=?").get(id);
  if (!p) return { error: "Baner ne postoji" };
  try { fs.unlinkSync(path.join(__dirname, "..", "public", p.image)); } catch {}
  db.prepare("DELETE FROM promo WHERE id=?").run(id);
  pushPromo();
  return { ok: true };
}

export function promoVidljivost(id, vidljiv) {
  const p = db.prepare("SELECT * FROM promo WHERE id=?").get(id);
  if (!p) return { error: "Baner ne postoji" };
  db.prepare("UPDATE promo SET available=? WHERE id=?").run(vidljiv ? 1 : 0, id);
  pushPromo();
  return { ok: true };
}

// Pomeranje gore/dole menja mesto sa susedom - redosled je vidljiv igracu.
export function pomeriPromo(id, smer) {
  const svi = promoLista();
  const i = svi.findIndex((p) => p.id === id);
  if (i < 0) return { error: "Baner ne postoji" };
  const j = smer === "gore" ? i - 1 : i + 1;
  if (j < 0 || j >= svi.length) return { ok: true };
  const upd = db.prepare("UPDATE promo SET sort=? WHERE id=?");
  upd.run(j + 1, svi[i].id);
  upd.run(i + 1, svi[j].id);
  pushPromo();
  return { ok: true };
}

export function pushPromo() {
  broadcastClients({ t: "promo", promo: promoZaKlijenta() });
}

export const saveShopImage = (id, dataUrl) => saveImage("shop_items", "shop", id, dataUrl);
export const removeShopImage = (id) => removeImage("shop_items", id);
export const saveGameImage = (id, dataUrl) => saveImage("games", "game", id, dataUrl);
export const removeGameImage = (id) => removeImage("games", id);
export const saveGameBanner = (id, dataUrl) => saveImage("games", "banner", id, dataUrl, "banner", 5 * 1024 * 1024);
export const removeGameBanner = (id) => removeImage("games", id, "banner");
export function removeAllGameImages(id) { removeImage("games", id, "image"); removeImage("games", id, "banner"); }
export const saveToolImage = (id, dataUrl) => saveImage("tools", "tool", id, dataUrl);
export const removeToolImage = (id) => removeImage("tools", id);

// PRIVREMENI BANERI (dok pravi dizajn ne stigne)
// Crtaju se kao SVG i pisu pravo u uploads - ne idu kroz proveru za otpremljene
// slike (koja prima samo raster), jer ih pravi sam server, ne korisnik.
function upisiSvg(prefix, svgTekst, staraPutanja) {
  const dir = path.join(__dirname, "..", "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  // Obrisi prethodni SAMO ako je i on bio generisan baner (ne diramo sliku koju
  // je vlasnik sam okacio - ako je banner prava slika, ostavljamo je na miru).
  if (staraPutanja && /\/uploads\/baner-/.test(staraPutanja)) {
    try { fs.unlinkSync(path.join(__dirname, "..", "public", staraPutanja)); } catch {}
  }
  const fname = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}.svg`;
  fs.writeFileSync(path.join(dir, fname), svgTekst, "utf8");
  return `/uploads/${fname}`;
}

export function napraviBanerIgre(id) {
  const g = db.prepare("SELECT * FROM games WHERE id=?").get(id);
  if (!g) return { error: "Igra ne postoji" };
  const url = upisiSvg("baner-igra", banerIgre(g.name), g.banner);
  db.prepare("UPDATE games SET banner=? WHERE id=?").run(url, id);
  pushCatalog();
  return { ok: true, banner: url };
}

// Napravi baner svakoj igri koja ga nema. Igre sa vec okacenim banerom se ne
// diraju - privremeni baner je za prazna mesta, ne da pregazi tudji rad.
export function napraviBaneriSvimIgrama() {
  const igre = db.prepare("SELECT * FROM games WHERE banner IS NULL OR banner=''").all();
  for (const g of igre) {
    const url = upisiSvg("baner-igra", banerIgre(g.name), null);
    db.prepare("UPDATE games SET banner=? WHERE id=?").run(url, g.id);
  }
  if (igre.length) pushCatalog();
  return { ok: true, koliko: igre.length };
}

export function napraviPromoCrit() {
  const svg = promoCrit(getSetting("cafe_name", "Crit"));
  const dir = path.join(__dirname, "..", "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const fname = `promo-crit-${Date.now()}.svg`;
  fs.writeFileSync(path.join(dir, fname), svg, "utf8");
  const url = `/uploads/${fname}`;
  const zadnji = db.prepare("SELECT COALESCE(MAX(sort), 0) s FROM promo").get().s;
  const info = db.prepare("INSERT INTO promo (image, naziv, available, sort, created_at) VALUES (?,?,1,?,?)")
    .run(url, "CRIT (privremeni)", zadnji + 1, Date.now());
  pushPromo();
  return { ok: true, id: info.lastInsertRowid, image: url };
}

// Programi / daljinska instalacija
export function programsList() {
  return db.prepare("SELECT * FROM programs ORDER BY name").all();
}
export function createProgram({ name, url, args, note }) {
  name = String(name || "").trim(); url = String(url || "").trim();
  if (!name || !url) return { error: "Naziv i link su obavezni" };
  if (!/^https?:\/\//i.test(url)) return { error: "Link mora počinjati sa http:// ili https://" };
  const info = db.prepare("INSERT INTO programs (name, url, args, note, created_at) VALUES (?,?,?,?,?)")
    .run(name, url, args || "", note || null, Date.now());
  return { ok: true, id: info.lastInsertRowid };
}
export function updateProgram(id, { name, url, args, note }) {
  db.prepare("UPDATE programs SET name=?, url=?, args=?, note=? WHERE id=?")
    .run(String(name || "").trim(), String(url || "").trim(), args || "", note || null, id);
  return { ok: true };
}
export function deleteProgram(id) {
  db.prepare("DELETE FROM programs WHERE id=?").run(id);
  return { ok: true };
}

// status instalacije po računaru (u memoriji)
const installStatus = new Map(); // computerId -> { program, state, message, ts }

export function getInstallStatus() {
  return [...installStatus.entries()].map(([id, s]) => ({ computerId: id, computer: compName(id), ...s }));
}

export function clearInstallStatus() {
  installStatus.clear();
  broadcastPanels({ t: "install_clear" });
  return { ok: true };
}

export function sendInstall(ids, prog, actor = "vlasnik") {
  const targets = ids && ids.length ? ids : db.prepare("SELECT id FROM computers").all().map((r) => r.id);
  let sent = 0, offline = 0;
  for (const id of targets) {
    const ok = sendClient(id, { t: "install", name: prog.name, url: prog.url, args: prog.args || "" });
    if (ok) {
      installStatus.set(id, { program: prog.name, state: "queued", message: "Poslato", ts: Date.now() });
      broadcastPanels({ t: "install", computerId: id, computer: compName(id), program: prog.name, state: "queued", message: "Poslato", ts: Date.now() });
      sent++;
    } else offline++;
  }
  logEvent({ category: "racunar", action: "install", actor, detail: `Instalacija "${prog.name}" poslata na ${sent} računara${offline ? ` (${offline} offline)` : ""}` });
  return { ok: true, sent, offline, total: targets.length };
}

function clientInstallStatus(computerId, msg) {
  const st = { program: msg.program, state: msg.state, message: msg.message || "", ts: Date.now() };
  installStatus.set(computerId, st);
  broadcastPanels({ t: "install", computerId, computer: compName(computerId), ...st });
  if (msg.state === "done" || msg.state === "error") {
    logEvent({ category: "racunar", action: "install_" + msg.state, actor: "sistem", target: compName(computerId), detail: `Instalacija "${msg.program}": ${msg.state === "done" ? "uspešno završena" : "greška - " + (msg.message || "")}` });
  }
}

// Wake-on-lan
// Klijent javi svoje mrežne kartice; biramo MAC one čija se IP poklapa sa
// adresom koju server vidi (LAN kartica, ne VPN/VirtualBox), pa čuvamo za paljenje.
function normalizeMac(mac) {
  const hex = String(mac || "").replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12 || /^0+$/.test(hex)) return null;
  return hex.toUpperCase().match(/.{2}/g).join(":");
}
function clientSysInfo(computerId, msg) {
  // FABRICKI SERVISNI PIN SE PRIJAVLJUJE, NE PRECUTKUJE.
  //
  // Launcher javlja da li mu je servisni PIN jos uvek 1234. Taj PIN cuva ulaz u
  // podesavanja i izlaz iz kioska kad server ne radi - dok je fabricki, igrac
  // koji iscupa mrezni kabl moze da preusmeri masinu na svoj server i tako sebi
  // otvori besplatnu igru. Menja se rucno po masini, pa se na trinaestoj
  // zaboravi, a zaboravljeno se nikad ne primeti samo od sebe.
  //
  // Isti pristup kao za fabricku lozinku vlasnika: sistem to ne moze da popravi
  // umesto coveka, ali moze da stoji crveno dok se ne popravi.
  //
  // Stariji launcheri ovo ne salju. Tada se NE dira ono sto vec znamo - prazno
  // polje znaci "ne javlja", ne "sve je u redu".
  if (typeof msg.fabrickiPin === "boolean") {
    const staro = db.prepare("SELECT pin_fabricki FROM computers WHERE id=?").get(computerId)?.pin_fabricki;
    const novo = msg.fabrickiPin ? 1 : 0;
    if (staro !== novo) {
      db.prepare("UPDATE computers SET pin_fabricki=? WHERE id=?").run(novo, computerId);
      if (novo) {
        logEvent({ category: "sistem", action: "pin_fabricki", actor: "sistem", target: compName(computerId),
          detail: "Servisni PIN launchera je fabrički (1234). Dok je tako, igrač koji iščupa mrežni kabl može da preusmeri računar na svoj server." });
      }
      pushComputers();
    }
  }

  const nics = Array.isArray(msg.nics) ? msg.nics : (msg.mac ? [{ ip: null, mac: msg.mac }] : []);
  if (!nics.length) return;
  const c = db.prepare("SELECT ip, mac FROM computers WHERE id=?").get(computerId);
  // kartica čija IP odgovara onoj koju server vidi = prava LAN kartica
  let chosen = (c && c.ip && nics.find((n) => n.ip === c.ip)) || nics[0];
  const mac = normalizeMac(chosen && chosen.mac);
  if (!mac || (c && c.mac === mac)) return;
  db.prepare("UPDATE computers SET mac=? WHERE id=?").run(mac, computerId);
  pushComputers();
}
// magic packet: 6x 0xFF pa 16x ponovljen MAC (102 bajta)
function magicPacket(mac) {
  const bytes = mac.split(":").map((h) => parseInt(h, 16));
  const packet = Buffer.alloc(102, 0xff);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 6; j++) packet[6 + i * 6 + j] = bytes[j];
  return packet;
}
function sendWol(mac) {
  return new Promise((resolve) => {
    let packet;
    try { packet = magicPacket(mac); } catch { return resolve(false); }
    const sock = dgram.createSocket("udp4");
    sock.once("error", () => { try { sock.close(); } catch {} resolve(false); });
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch {}
      let pending = 2, ok = false;
      const done = (err) => { if (!err) ok = true; if (--pending === 0) { try { sock.close(); } catch {} resolve(ok); } };
      // klasični WoL portovi 9 i 7, na broadcast adresu
      sock.send(packet, 0, packet.length, 9, "255.255.255.255", done);
      sock.send(packet, 0, packet.length, 7, "255.255.255.255", done);
    });
  });
}
export async function wakeComputer(id, actor) {
  const c = db.prepare("SELECT * FROM computers WHERE id=?").get(id);
  if (!c) return { error: "Računar ne postoji" };
  if (!c.mac) return { error: "Nema zabeleženu MAC adresu - računar mora bar jednom da se poveže dok je uključen." };
  const ok = await sendWol(c.mac);
  if (ok) logEvent({ category: "racunar", action: "wake", actor: actor || "sistem", target: c.name, detail: `Signal za paljenje (WoL) na ${c.mac}` });
  return ok ? { ok: true } : { error: "Slanje signala nije uspelo" };
}
export async function wakeAll(actor) {
  const rows = db.prepare("SELECT * FROM computers WHERE mac IS NOT NULL AND mac <> '' ORDER BY name").all();
  let sent = 0;
  for (const c of rows) if (await sendWol(c.mac)) sent++;
  logEvent({ category: "racunar", action: "wake_all", actor: actor || "sistem", detail: `Signal za paljenje poslat na ${sent}/${rows.length} računara` });
  return { ok: true, sent, total: rows.length };
}

// Inicijalizuj keš aktivne smene iz baze (npr. posle restarta servera)
activeShiftId = getActiveShift()?.id ?? null;
