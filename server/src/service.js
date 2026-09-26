import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dgram from "node:dgram";
import { scryptSync, randomBytes } from "node:crypto";
import * as bezServera from "./offline.js";
import { fileURLToPath } from "node:url";
import { db, getSetting, setSetting, DATA_DIR, uJednomPoslu } from "./db.js";
import { verifyPassword, hashPassword, rang } from "./auth.js";
import { broadcastPanels, broadcastClients, sendClient, isClientOnline, izbaciPanel, izbaciRacunar } from "./hub.js";
import { banerIgre, promoCrit } from "./banner.js";
import * as nad from "./nadogradnja.js";
import { nivoZa, smeDa, otkljucanoZa, OTKLJUCAVANJA, BOJE_IMENA, OKVIRI } from "./nivoi.js";
import { stanjeInterneta } from "./internet.js";
import { znackeZa, GRUPE } from "./znacke.js";
import * as vip from "./vip.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Otpremljene slike su podaci igraonice i stoje uz bazu (DATA_DIR/uploads):
// ulaze u kopiju van računara, nadogradnja ih ne dira, a izolovana instanca
// (CRIT_DATA_DIR) ima svoje.
export const UPLOADS = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });

// Putanja do fajla iz zapisanog `/uploads/ime.png`. Samo basename, da vrednost
// iz baze ne izađe iz foldera ("../..").
const putanjaSlike = (url) => {
  const ime = path.basename(String(url || "").trim());
  return ime && ime !== "." && ime !== ".." ? path.join(UPLOADS, ime) : null;
};
// Brisanje stare slike pri zameni; fajl je možda već obrisan, pa ne baca.
const obrisiSliku = (url) => {
  const p = putanjaSlike(url);
  if (p) { try { fs.unlinkSync(p); } catch {} }
};

// Selidba slika sa starog mesta (server/public/uploads), jednom, pri prvom
// pokretanju nove verzije. Kopira se, ne premešta.
(function preseliStareSlike() {
  // Samo za pravu instalaciju; izolovana instanca (test, proba) nema šta da nasledi.
  if (process.env.CRIT_DATA_DIR) return;
  const staro = path.join(__dirname, "..", "public", "uploads");
  if (staro === UPLOADS) return;
  let imena = [];
  try { imena = fs.readdirSync(staro); } catch { return; }
  let preneto = 0;
  for (const ime of imena) {
    const izvor = path.join(staro, ime), cilj = path.join(UPLOADS, ime);
    try {
      if (fs.existsSync(cilj)) continue;
      if (!fs.statSync(izvor).isFile()) continue;
      fs.copyFileSync(izvor, cilj);
      preneto++;
    } catch {}
  }
  if (preneto) console.log(`Slike prenete uz bazu: ${preneto} (staro mesto ostaje netaknuto)`);
})();

// ID otvorene smene (keširan; postavlja se na dnu fajla).
let activeShiftId = null;

// Pomoćne
export function settingsObj() {
  return {
    cafeName: getSetting("cafe_name", "Crit"),
    currency: getSetting("currency", "RSD"),
    ratePerHour: Number(getSetting("rate_per_hour", "120")),
    unlockPin: getSetting("unlock_pin", "1234"),
    idleMinutes: Number(getSetting("idle_minutes", "15")),
    servisniPin: getSetting("servisni_pin", ""),
    fabrickaLozinka: fabrickaLozinkaVlasnika(),
  };
}

// Servisni PIN launchera. Upisuje se u panelu i stiže na sve računare kao
// heš sa soli; launcher proverava unos prema hešu i kad server ne radi. Sam
// PIN (kao ni `unlock_pin`) se klijentima ne šalje.
export function servisniPinZaKlijenta() {
  const pin = String(getSetting("servisni_pin", "") || "").trim();
  if (!pin) return null; // nije podešen - launcheri rade po starom
  // So se čuva uz PIN, da svi računari dobiju isti heš.
  let so = getSetting("servisni_pin_so", "");
  if (!so) { so = randomBytes(16).toString("hex"); setSetting("servisni_pin_so", so); }
  return { hes: scryptSync(pin, Buffer.from(so, "hex"), 32).toString("hex"), so };
}

// Nov PIN ide svim povezanim launcherima odmah.
export function posaljiServisniPin() {
  const p = servisniPinZaKlijenta();
  broadcastClients({ t: "servisni_pin", pin: p });
  logEvent({ category: "podesavanja", action: "servisni_pin", actor: "sistem",
    detail: p ? "Servisni PIN je poslat svim povezanim launcherima" : "Servisni PIN je obrisan - launcheri se vraćaju na lokalni" });
}

// Da li nalog admin još ima fabričku lozinku; panel to prikazuje crveno.
// Računa se jednom i pamti, jer je provera scrypt.
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
  // Neispravna cena (ručna izmena baze) postaje 0, odnosno "bez naplate".
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

// Logovi
//
// Obračun smene se računa iz logova (po shift_id), pa je zapis o novcu deo
// samog posla sa novcem: `upisiLog` ne guta grešku i ide u istu transakciju.
// Panelima se javlja tek posle upisa (`javiLog`).
function upisiLog({ category, action, actor = "sistem", target = null, detail = null, amount = null }) {
  const ts = Date.now();
  db.prepare("INSERT INTO logs (ts, category, action, actor, target, detail, amount, shift_id) VALUES (?,?,?,?,?,?,?,?)")
    .run(ts, category, action, actor, target, detail, amount == null ? null : Math.round(amount * 100) / 100, activeShiftId);
  return { ts, category, action, actor, target, detail, amount };
}
// Javlja panelima zapis koji je upisan.
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

// Stranična lista logova. Stare logove seče održavanje (odrzavanje.js);
// zatvorene smene čuvaju svoje brojke u `shifts`.
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

// Smene
export function getActiveShift() {
  return db.prepare("SELECT * FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1").get() || null;
}

function shiftTotals(shiftId, openedAt, until = Date.now()) {
  const one = (sql) => db.prepare(sql).get(shiftId).s;
  const topups = one("SELECT COALESCE(SUM(amount),0) s FROM logs WHERE shift_id=? AND category='novac' AND amount>0");
  const deductsNeg = one("SELECT COALESCE(SUM(amount),0) s FROM logs WHERE shift_id=? AND category='novac' AND amount<0");
  // Otkazane porudžbine se poništavaju zapisom sa pozitivnim iznosom (order_cancel).
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
    // Pazar je novac koji je stvarno ušao u kasu. Kupovina sa naloga nije nov
    // novac (ušao je pri dopuni), pa se ne sabira.
    revenue: round2(topups - deducts + shopCash),
  };
}

// Novac naplaćen danas dok smena nije bila otvorena. Ne pripada nijednom
// obračunu, pa se prikazuje posebno: na kontrolnoj tabli i pri zatvaranju
// smene.
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
  // Tekst umesto broja se odbija.
  const pocetno = openingCash === "" || openingCash == null ? 0 : Number(openingCash);
  if (!ispravanIznos(pocetno) || pocetno < 0) return { error: "Početno stanje kase mora biti broj veći ili jednak nuli" };
  const now = Date.now();
  const info = db.prepare("INSERT INTO shifts (admin_id, admin_username, opened_at, opening_cash, status) VALUES (?,?,?,?, 'open')")
    .run(adminId, username, now, round2(pocetno));
  activeShiftId = Number(info.lastInsertRowid);
  logEvent({ category: "sistem", action: "shift_open", actor: username, detail: `Otvorena smena - početno stanje kase ${round2(pocetno)}`, amount: round2(pocetno) });
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
  // Tekst umesto broja se odbija.
  if (closing != null && (!ispravanIznos(closing) || closing < 0)) {
    return { error: "Prebrojano stanje kase mora biti broj veći ili jednak nuli" };
  }
  const diff = closing == null ? null : round2(closing - expectedCash);
  db.prepare("UPDATE shifts SET status='closed', closed_at=?, closing_cash=?, total_topups=?, total_deducts=?, total_shop=?, total_revenue=?, total_shop_cash=?, total_sessions=? WHERE id=?")
    .run(now, closing, t.topups, t.deducts, t.shop, t.revenue, t.shopCash, t.sessions, s.id);
  logEvent({ category: "sistem", action: "shift_close", actor: username, detail: `Zatvorena smena #${s.id} - pazar ${t.revenue}`, amount: t.revenue });

  // Manjak i višak idu i u logove, da mogu da se pretražuju unazad.
  if (diff != null && Math.abs(diff) >= 0.5) {
    logEvent({
      category: "novac",
      action: diff < 0 ? "kasa_manjak" : "kasa_visak",
      actor: username,
      target: `smena #${s.id}`,
      detail: diff < 0
        ? `Manjak u kasi: prebrojano ${closing}, očekivano ${expectedCash}`
        : `Višak u kasi: prebrojano ${closing}, očekivano ${expectedCash}`,
      // Iznos je u opisu, ne u polju amount, jer se amount sabira u pazar.
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

// Objašnjenje uz smenu (npr. razlog manjka).
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
      // Razlika u kasi ide u sam spisak smena.
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

// Izveštaji
export function stats(from, to) {
  const g2 = (sql) => db.prepare(sql).get(from, to).s;
  // Trošak sesije se u `transactions` upisuje tek na kraju sesije, pa se za
  // period koji traje do sada dodaju i aktivne sesije.
  const sadaUPeriodu = to >= Date.now() - 60000;
  const uToku = sadaUPeriodu
    ? db.prepare("SELECT COALESCE(SUM(cost),0) s FROM sessions WHERE status='active' AND started_at<=?").get(to).s
    : 0;
  const sessionRev = g2("SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE type='session' AND created_at BETWEEN ? AND ?") + uToku;
  const shopRev = g2("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status!='cancelled' AND created_at BETWEEN ? AND ?");
  const shopCash = g2("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment='cash' AND status!='cancelled' AND created_at BETWEEN ? AND ?");
  const topups = g2("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='topup' AND created_at BETWEEN ? AND ?");
  // VIP članarina je promet kao i sesija ili piće.
  const vipRev = g2("SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE type='vip' AND created_at BETWEEN ? AND ?");
  // Poklonjen kredit (nagradni točak, popust na paket) ne ulazi u pazar, ali se
  // prikazuje kao trošak.
  const poklonjeno = g2("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='bonus' AND created_at BETWEEN ? AND ?");
  const sessCount = db.prepare("SELECT COUNT(*) c FROM sessions WHERE started_at BETWEEN ? AND ?").get(from, to).c;
  const playSec = db.prepare("SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at),0) s FROM sessions WHERE started_at BETWEEN ? AND ?").get(Date.now(), from, to).s;

  const dayFmt = "strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime')";
  const hourFmt = "CAST(strftime('%H', created_at/1000, 'unixepoch', 'localtime') AS INTEGER)";
  // Zbir po periodu iz više izvora (sesije, piće, članarina).
  const merge = (...nizovi) => {
    const map = {};
    for (const niz of nizovi) for (const r of niz) map[r.k] = (map[r.k] || 0) + r.v;
    return map;
  };
  const sByDay = db.prepare(`SELECT ${dayFmt} k, SUM(-amount) v FROM transactions WHERE type='session' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const oByDay = db.prepare(`SELECT ${dayFmt} k, SUM(total) v FROM orders WHERE status!='cancelled' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const vByDay = db.prepare(`SELECT ${dayFmt} k, SUM(-amount) v FROM transactions WHERE type='vip' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const dayMap = merge(sByDay, oByDay, vByDay);
  const byDay = Object.keys(dayMap).sort().map((d) => ({ label: d.slice(8) + "." + d.slice(5, 7), revenue: round2(dayMap[d]) }));

  const sByHour = db.prepare(`SELECT ${hourFmt} k, SUM(-amount) v FROM transactions WHERE type='session' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const oByHour = db.prepare(`SELECT ${hourFmt} k, SUM(total) v FROM orders WHERE status!='cancelled' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const vByHour = db.prepare(`SELECT ${hourFmt} k, SUM(-amount) v FROM transactions WHERE type='vip' AND created_at BETWEEN ? AND ? GROUP BY k`).all(from, to);
  const hourMap = merge(sByHour, oByHour, vByHour);
  const byHour = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, "0"), revenue: round2(hourMap[h] || 0) }));

  const topPlayers = db.prepare("SELECT p.username u, COALESCE(SUM(-t.amount),0) spent FROM transactions t JOIN players p ON p.id=t.player_id WHERE t.type IN ('session','shop','vip') AND t.created_at BETWEEN ? AND ? GROUP BY p.id ORDER BY spent DESC LIMIT 8")
    .all(from, to).map((r) => ({ username: imeIgraca(r.u), spent: round2(r.spent) }));
  const byComputer = db.prepare("SELECT c.name n, COALESCE(SUM(s.cost),0) rev, COUNT(*) cnt FROM sessions s JOIN computers c ON c.id=s.computer_id WHERE s.started_at BETWEEN ? AND ? GROUP BY c.id ORDER BY rev DESC")
    .all(from, to).map((r) => ({ name: imeRacunara(r.n), revenue: round2(r.rev), sessions: r.cnt }));

  // Novi igrači u periodu.
  const newPlayers = db.prepare("SELECT COUNT(*) c FROM players WHERE created_at BETWEEN ? AND ?").get(from, to).c;
  // Najprometniji sat (danas) ili dan (nedelja, mesec).
  const vrhSat = byHour.reduce((a, h) => (h.revenue > a.revenue ? h : a), { label: "", revenue: 0 });
  const vrhDan = byDay.reduce((a, h) => (h.revenue > a.revenue ? h : a), { label: "", revenue: 0 });
  return {
    revenue: { session: round2(sessionRev), shop: round2(shopRev), shopCash: round2(shopCash), shopCredit: round2(shopRev - shopCash), topups: round2(topups), poklonjeno: round2(poklonjeno), vip: round2(vipRev), total: round2(sessionRev + shopRev + vipRev) },
    sessions: {
      count: sessCount, minutes: Math.round(playSec / 60000),
      // Prosečan promet i trajanje po sesiji.
      avg: sessCount ? round2(sessionRev / sessCount) : 0,
      avgMin: sessCount ? Math.round(playSec / 60000 / sessCount) : 0,
    },
    newPlayers,
    peak: { hour: vrhSat, day: vrhDan },
    byDay, byHour, topPlayers, byComputer,
    topGames: najigranije(from, to),
  };
}

// Pun obračun jedne smene (za otvorenu - do sada).
export function shiftDetail(id) {
  const s = db.prepare("SELECT * FROM shifts WHERE id=?").get(id);
  if (!s) return null;
  const until = s.closed_at || Date.now();
  // Zatvorena smena koristi brojke zapamćene pri zatvaranju, da se obračun
  // kasnije ne menja.
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

// Snimci stanja za panel
export function computersSnapshot() {
  const rows = db.prepare("SELECT * FROM computers WHERE obrisan IS NULL ORDER BY name").all();
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
      numeracija: c.launcher_numeracija || 0,
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
  // Nivo ide uz igrača svuda gde se prikazuje.
  nivo: nivoZa(p.xp).nivo,
  nivoNaziv: nivoZa(p.xp).naziv,
  xp: Math.round(Number(p.xp) || 0),
  // VIP se računa iz roka (vip_do), ne iz zastavice.
  vip: vip.vaziVip(p.vip_do),
  vipDana: vip.danaOstalo(p.vip_do),
  vipDo: p.vip_do || null,
  banned: !!p.banned,
  note: p.note,
  createdAt: p.created_at,
  lastLogin: p.last_login,
});

export function playersSnapshot() {
  return db
    .prepare("SELECT id, username, display_name, balance, banned, note, created_at, last_login, xp, vip_do FROM players WHERE obrisan IS NULL ORDER BY username")
    .all()
    .map(mapPlayer);
}

// Stranična lista igrača.
export function playersPage({ page = 1, per = 25, search = "" } = {}) {
  const cond = search ? "WHERE obrisan IS NULL AND (username LIKE ? OR display_name LIKE ?)" : "WHERE obrisan IS NULL";
  const args = search ? [`%${search}%`, `%${search}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM players ${cond}`).get(...args).c;
  per = Math.min(100, Math.max(5, Number(per) || 25));
  const pages = Math.max(1, Math.ceil(total / per));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const items = db
    .prepare(`SELECT id, username, display_name, balance, banned, note, created_at, last_login, xp, vip_do FROM players ${cond} ORDER BY username LIMIT ? OFFSET ?`)
    .all(...args, per, (page - 1) * per)
    .map(mapPlayer);
  return { items, total, page, pages, per };
}

export function ordersSnapshot(includeDone = false) {
  const where = includeDone ? "" : "WHERE o.status IN ('pending','preparing')";
  // VIP porudžbine koje čekaju idu na vrh spiska (prednost na kasi). Redosled
  // se zadaje u SQL-u, da ga granica od 100 redova ne preseče. Istorija ide po
  // vremenu.
  const redosled = includeDone
    ? "o.created_at DESC"
    : "CASE WHEN p.vip_do > ? THEN 0 ELSE 1 END, o.created_at DESC";
  const orders = db
    .prepare(
      `SELECT o.*, p.username, p.vip_do, c.name AS computer_name
       FROM orders o
       LEFT JOIN players p ON p.id = o.player_id
       LEFT JOIN computers c ON c.id = o.computer_id
       ${where}
       ORDER BY ${redosled} LIMIT 100`
    )
    .all(...(includeDone ? [] : [Date.now()]));
  return orders.map((o) => ({
    id: o.id,
    player: o.username ? imeIgraca(o.username) : null,
    // Radnik vidi zašto je porudžbina prva.
    vip: vip.vaziVip(o.vip_do),
    computer: o.computer_name ? imeRacunara(o.computer_name) : null,
    total: round2(o.total),
    status: o.status,
    payment: o.payment,
    source: o.source,
    note: o.note,
    createdAt: o.created_at,
    items: db.prepare("SELECT name, price, qty FROM order_items WHERE order_id = ?").all(o.id),
  }));
}

// Porudžbine igrača za prikaz u launcheru.
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

// Šalje igraču svež spisak porudžbina, ako je još za računarom.
function posaljiPorudzbineIgracu(playerId) {
  if (!playerId) return;
  const comp = db.prepare("SELECT id FROM computers WHERE current_player_id = ?").get(playerId);
  if (comp) sendClient(comp.id, { t: "moje_porudzbine", porudzbine: igracevePorudzbine(playerId) });
}

// Spisak rezervnih kopija za panel (pregled i preuzimanje).
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

// Putanja do kopije, uz proveru da ime ne izlazi iz foldera.
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

// Kategorija: ista reč napisana sa drugim razmakom, veličinom slova ili bez
// kvačica ("Piće", "pice") svodi se na postojeći zapis. Stvarno različit
// zapis se ne dira; panel ispod polja nudi postojeće kategorije.
const golo = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // kvacice: pisu se kodovima, jer su same po sebi nevidljive u fajlu
  .replace(/[đĐ]/g, "d").toLowerCase().replace(/\s+/g, " ").trim();

export function uskladiKategoriju(novo, postojece) {
  const cisto = String(novo ?? "").replace(/\s+/g, " ").trim();
  if (!cisto) return "";
  const isto = (postojece || []).find((k) => golo(k) === golo(cisto));
  return isto || cisto;
}

// Isto ime artikla (poređenje kao kod kategorija) se ne spaja - svaki red ima
// svoju cenu, zalihu i istoriju prodaje - nego se javlja vlasniku.
export function istoImeArtikla(ime, osimId = null) {
  const trazeno = golo(ime);
  if (!trazeno) return null;
  const red = db.prepare(
    osimId ? "SELECT id, name, category, price FROM shop_items WHERE id <> ?" : "SELECT id, name, category, price FROM shop_items"
  ).all(...(osimId ? [Number(osimId)] : []));
  return red.find((r) => golo(r.name) === trazeno) || null;
}

// Sve kategorije koje se već koriste, po abecedi. Panel ih nudi ispod polja.
export function kategorije(sta) {
  const red = sta === "igre" ? gamesList() : shopList();
  return [...new Set(red.map((r) => String(r.category || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "sr-Latn-RS"));
}
// Samo dostupne igre (sakrivene se launcheru ne šalju).
export function gamesForClient() {
  return db.prepare("SELECT * FROM games WHERE available = 1 ORDER BY sort, name").all();
}

// ---- Prečice (Internet u launcheru) ----
export function toolsList() {
  return db.prepare("SELECT * FROM tools ORDER BY sort, name").all();
}
export function toolsForClient() {
  return db.prepare("SELECT id, name, kind, target, args, image, color FROM tools WHERE available = 1 ORDER BY sort, name").all();
}
// Boja prečice se prima samo kao heks zapis, jer je launcher upisuje u stil
// kartice. null znači "boja po imenu".
const BOJA_HEKS = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
function bojaPrecice(c) {
  if (c == null || c === "") return { boja: null };
  const s = typeof c === "string" ? c.trim() : "";
  return BOJA_HEKS.test(s) ? { boja: s } : { error: "Boja mora biti u obliku #RRGGBB" };
}
// Objekat ili niz iz zahteva ne sme da stigne do SQLite-a.
const tekstPolja = (v) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

export function createTool({ name, kind, target, args, color, available }) {
  name = tekstPolja(name).trim();
  kind = kind === "app" ? "app" : "web";
  target = tekstPolja(target).trim();
  if (!name) return { error: "Naziv je obavezan" };
  if (!target) return { error: kind === "app" ? "Putanja do programa je obavezna" : "Adresa (URL) je obavezna" };
  if (kind === "web" && !/^https?:\/\//i.test(target)) return { error: "Adresa mora počinjati sa http:// ili https://" };
  const b = bojaPrecice(color);
  if (b.error) return b;
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort),0) s FROM tools").get().s;
  const info = db.prepare("INSERT INTO tools (name, kind, target, args, color, available, sort, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(name, kind, target, tekstPolja(args), b.boja, available === false ? 0 : 1, maxSort + 1, Date.now());
  return { ok: true, id: info.lastInsertRowid };
}
export function updateTool(id, { name, kind, target, args, color, available }) {
  const t = db.prepare("SELECT * FROM tools WHERE id=?").get(id);
  if (!t) return { error: "Alat ne postoji" };
  name = tekstPolja(name ?? t.name).trim();
  kind = (kind ?? t.kind) === "app" ? "app" : "web";
  target = tekstPolja(target ?? t.target).trim();
  if (!name) return { error: "Naziv je obavezan" };
  if (!target) return { error: "Cilj (URL ili putanja) je obavezan" };
  if (kind === "web" && !/^https?:\/\//i.test(target)) return { error: "Adresa mora počinjati sa http:// ili https://" };
  // Nepostojeće ili null polje zadržava staru boju. Nepromenjena vrednost se
  // ne proverava ponovo.
  let boja = t.color ?? null;
  if (color != null && color !== t.color) {
    const b = bojaPrecice(color);
    if (b.error) return b;
    boja = b.boja;
  }
  db.prepare("UPDATE tools SET name=?, kind=?, target=?, args=?, color=?, available=? WHERE id=?")
    .run(name, kind, target, args == null ? (t.args ?? "") : tekstPolja(args), boja, available === false ? 0 : available === true ? 1 : t.available, id);
  // Promenjen cilj briše oznaku o kvaru (isto kao kod igara u routes.js).
  if (target !== t.target) ocistiKvar("tools", id);
  return { ok: true };
}
export function deleteTool(id) {
  removeImage("tools", id);
  db.prepare("DELETE FROM tools WHERE id=?").run(id);
  return { ok: true };
}

// Brisanje artikla briše i njegovu sliku. Prodat artikal ostaje u starim
// porudžbinama po imenu i ceni (order_items), a veza ka artiklu se prazni.
export function deleteShopItem(id) {
  const it = db.prepare("SELECT image FROM shop_items WHERE id=?").get(id);
  if (!it) return { error: "Artikal ne postoji" };
  try {
    uJednomPoslu(() => {
      db.prepare("UPDATE order_items SET item_id=NULL WHERE item_id=?").run(id);
      db.prepare("DELETE FROM shop_items WHERE id=?").run(id);
    });
  } catch (e) {
    return { error: "Brisanje nije uspelo: " + String(e?.message || e).slice(0, 120) };
  }
  obrisiSliku(it.image);
  return { ok: true };
}
export function reorderTools(ids) {
  const upd = db.prepare("UPDATE tools SET sort=? WHERE id=?");
  (ids || []).forEach((id, i) => upd.run(i, Number(id)));
  return { ok: true };
}

// ---- Zalihe pića (stock; NULL = neograničeno) ----
// Stavke porudžbine u čist spisak: cena uvek iz baze, količina ograničena, a
// isti artikal spojen u jedan red, da se zaliha ne proverava više puta za isti
// artikal. Server ne pretpostavlja da poruka stiže iz launchera.
export function spojiStavke(items, { najviseVrsta = 40, najviseKomada = 20, samoDostupne = true } = {}) {
  const po = new Map();
  // Radnik na kasi sme i skriven artikal, igrač ne.
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
// Ispod ovoga se osoblju javlja da je vreme za dopunu.
export const PRAG_ZALIHE = 5;

function consumeStock(resolved) {
  const upd = db.prepare("UPDATE shop_items SET stock = MAX(0, stock - ?) WHERE id=? AND stock IS NOT NULL");
  let changed = false;
  for (const r of resolved) {
    if (r.item.stock == null) continue;
    upd.run(r.qty, r.item.id);
    changed = true;
    // Javlja se jednom, kad zaliha padne ispod praga.
    const posle = db.prepare("SELECT name, stock FROM shop_items WHERE id=?").get(r.item.id);
    if (!posle) continue;
    const pre = r.item.stock;
    const nema = posle.stock === 0;
    // Dva povoda: prvi pad ispod praga i trenutak kad se artikal isprazni.
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

// Otkazana porudžbina vraća piće na stanje. Vraća se samo za artikle koji se
// i sada vode po komadu.
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

// Izmenjen katalog se šalje svim launcherima.
// Promena stanja interneta se javlja svim launcherima, samo kad se promeni.
export function javiInternet(ok) {
  broadcastClients({ t: "internet", ok: !!ok });
}

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

// Klijent: veza i prijava
const connectedSince = new Map(); // computerId -> ts (od kada je launcher povezan)

export function onClientOpen(comp, ip, verzija, opcije = {}) {
  connectedSince.set(comp.id, Date.now());
  clearTimeout(bezVezeTajmeri.get(comp.id));
  bezVezeTajmeri.delete(comp.id);
  if (opcije.offline) cekajOfflineIzvestaj(comp.id);
  // Verzija se upisuje samo kad je launcher pošalje; prazno polje u panelu
  // znači stariji launcher.
  db.prepare("UPDATE computers SET last_seen = ?, ip = COALESCE(?, ip), launcher_version = COALESCE(?, launcher_version) WHERE id = ?")
    .run(Date.now(), ip || null, verzija || null, comp.id);
  // Launcher koji javi verziju bez numeracije je iz stare (vidi verzije.js).
  const numeracija = Number(opcije.numeracija) || 0;
  if (verzija) db.prepare("UPDATE computers SET launcher_numeracija = ? WHERE id = ?").run(numeracija, comp.id);
  // Računar koji se vratio sa novom verzijom potvrđuje nadogradnju.
  nadogradnjaPoPovratku(comp, verzija, numeracija);
  sendWelcomeState(comp.id);
  pushComputers();
}

// Pun "welcome" i stanje računara. Šalje se pri povezivanju i na "hello"
// (launcher je ponovo učitao ekran).
export function sendWelcomeState(computerId) {
  const comp = computerById(computerId);
  if (!comp) return;
  const settings = settingsObj();
  sendClient(comp.id, {
    t: "welcome",
    computer: { id: comp.id, name: comp.name },
    settings: { cafeName: settings.cafeName, currency: settings.currency, ratePerHour: settings.ratePerHour },
    brend: brendObj(),
    // Heš servisnog PIN-a (vidi servisniPinZaKlijenta).
    servisniPin: servisniPinZaKlijenta(),
    shop: shopList(),
    games: gamesForClient(),
    tools: toolsForClient(),
    pozadine: pozadineObj(),
    tekstura: teksturaObj(),
    // Internet u igraonici; null znači da još nije provereno.
    internet: stanjeInterneta(),
    // Spisak šara za izbor na nalogu (oko 4 KB, jednom pri povezivanju).
    teksture: {
      spisak: teksturaSpisak(),
      jacine: JACINE, kretanja: KRETANJA, prozirnosti: PROZIRNOSTI,
    },
    promo: promoZaKlijenta(),
  });

  // Launcher koji je radio bez servera prvo šalje izveštaj; sesija mu se vraća
  // tek posle obračuna (vidi clientOfflineIzvestaj).
  if (cekaOfflineIzvestaj.has(comp.id)) return;
  posaljiStanjeSesije(comp.id);
}

// Stanje računara posle povezivanja: nastavak sesije, zaključan ekran ili prijava.
function posaljiStanjeSesije(computerId) {
  const comp = computerById(computerId);
  if (!comp) return;
  // Aktivna sesija se nastavlja (npr. posle restarta servera).
  const s = activeSessionForComputer(comp.id);
  if (s) {
    const p = playerById(s.player_id);
    db.prepare("UPDATE computers SET status='in_use', current_player_id=?, current_session_id=? WHERE id=?")
      .run(p.id, s.id, comp.id);
    sendClient(comp.id, loginOkPayload(p, s, { nastavak: true }));
  } else if (comp.status === "locked") {
    sendClient(comp.id, { t: "locked", reason: "staff" });
  } else {
    db.prepare("UPDATE computers SET status='idle' WHERE id=?").run(comp.id);
    sendClient(comp.id, { t: "to_login" });
  }
}

// ---------- RAD BEZ SERVERA ----------
//
// Launcher koji je radio bez servera javlja koliko je sekundi sesija ukupno
// trajala, a ovde se naplaćuje razlika (račun je u offline.js). Najavljuje se
// u adresi veze (offline=1). Ako izveštaj ne stigne za 15 sekundi, sesija se
// nastavlja bez naplate tog vremena i to se zapisuje.
const OFFLINE_CEKA_MS = Number(process.env.OFFLINE_IZVESTAJ_CEKA_MS) || 15000;
const cekaOfflineIzvestaj = new Map(); // computerId -> tajmer

function cekajOfflineIzvestaj(computerId) {
  clearTimeout(cekaOfflineIzvestaj.get(computerId));
  const tajmer = setTimeout(() => {
    if (cekaOfflineIzvestaj.get(computerId) !== tajmer) return;
    cekaOfflineIzvestaj.delete(computerId);
    logEvent({ category: "sistem", action: "offline_bez_izvestaja", actor: "launcher", target: compName(computerId),
      detail: "Računar je radio bez servera i najavio izveštaj, ali ga nije poslao. Sesija je nastavljena; vreme bez veze nije naplaćeno." });
    posaljiStanjeSesije(computerId);
    pushComputers();
  }, OFFLINE_CEKA_MS);
  if (tajmer.unref) tajmer.unref();
  cekaOfflineIzvestaj.set(computerId, tajmer);
}

function clientOfflineIzvestaj(computerId, msg) {
  clearTimeout(cekaOfflineIzvestaj.get(computerId));
  cekaOfflineIzvestaj.delete(computerId);
  const comp = computerById(computerId);
  if (!comp) return;

  const nastavi = () => { posaljiStanjeSesije(computerId); pushComputers(); };
  const odbij = (detail, sesija) => {
    logEvent({ category: "sistem", action: "offline_odbijen", actor: "launcher", target: comp.name, detail });
    sendClient(computerId, { t: "offline_primljen", sesija: sesija ?? null, stanje: "odbijeno" });
    nastavi();
  };

  const zapis = bezServera.procitajZapis(msg?.zapis);
  if (!zapis) return odbij("Izveštaj o radu bez servera nije ispravnog oblika - vreme bez veze nije naplaćeno.");
  if (!bezServera.potpisJeIspravan(msg.zapis, msg.potpis, comp.token)) {
    return odbij("Izveštaj o radu bez servera ne prolazi proveru potpisa - vreme bez veze nije naplaćeno. " +
      "Ako se ponavlja na istom računaru, proveri ga.", zapis.sesija);
  }

  const s = activeSessionForComputer(computerId);
  const p = s ? playerById(s.player_id) : null;
  const r = bezServera.obracun({ zapis, sesija: s, stopaServera: rate(), kredit: Number(p?.balance) || 0 });
  if (r.razlog === "drugi_igrac") {
    return odbij("Izveštaj o radu bez servera je za drugog igrača nego sesija na tom računaru - nije naplaćen.", zapis.sesija);
  }
  if (r.razlog) {
    // Osoblje je zatvorilo sesiju dok računar nije bio na vezi; vreme posle toga
    // se ne naplaćuje.
    return odbij("Sesija na ovom računaru je zatvorena dok računar nije bio na vezi - " +
      "vreme igranja bez veze nije naplaćeno.", zapis.sesija);
  }

  const noviXp = xpPosleTrosenja(p, r.naplaceno);
  if (r.dugSekundi > 0) {
    try {
      uJednomPoslu(() => {
        db.prepare("UPDATE players SET balance=?, xp=? WHERE id=?").run(r.noviKredit, noviXp, p.id);
        db.prepare("UPDATE sessions SET cost=?, sekundi=? WHERE id=?").run(round2(s.cost + r.naplaceno), r.noveSekunde, s.id);
      });
    } catch (e) {
      return odbij(`Naplata vremena bez veze nije upisana: ${String(e?.message || e).slice(0, 150)}`, s.id);
    }
    const preNivo = nivoZa(p.xp), posleNivo = nivoZa(noviXp);
    if (posleNivo.nivo > preNivo.nivo) javiNivo(p.id, { nivoPre: preNivo, nivoPosle: posleNivo });
    const minuta = Math.max(1, Math.round(r.dugSekundi / 60));
    logEvent({
      category: "sesija", action: "offline_naplata", actor: p.username, target: comp.name,
      detail: `Igrao ${minuta} min dok server nije bio dostupan - naplaćeno ${r.naplaceno}` +
        (r.nedostaje > 0 ? `. Kredita je bilo manje nego odigranog vremena, nije naplaćeno još ${r.nedostaje}.` : ""),
    });
  }

  sendClient(computerId, {
    t: "offline_primljen", sesija: s.id, stanje: r.kraj ? "zavrseno" : "nastavljeno",
    sekundi: r.dugSekundi > 0 ? r.noveSekunde : Number(s.sekundi) || 0,
    naplaceno: r.naplaceno, balance: r.noviKredit, remainingSeconds: remainingSeconds(r.noviKredit),
  });
  if (r.kraj) {
    // Isteklo vreme zaključava računar, osim ako ga je osoblje već otključalo
    // servisnim PIN-om.
    endSession(computerId, { lock: r.kraj === "vreme" && !zapis.otkljucano, reason: bezServera.RAZLOG_KRAJA[r.kraj] });
    return;
  }
  nastavi();
}

// Računar koji nestane dok je sesija otvorena (izvučen kabl, ugašen launcher,
// pad). Naplata za to vreme stoji; ako se ne vrati za minut, panel dobija
// zvučno upozorenje, a događaj ide u Logove.
const BEZ_VEZE_MS = Number(process.env.BEZ_VEZE_MS) || 60000;
const bezVezeTajmeri = new Map(); // computerId -> tajmer

function pratiNestanak(computerId) {
  clearTimeout(bezVezeTajmeri.get(computerId));
  bezVezeTajmeri.delete(computerId);
  const sesija = computerById(computerId)?.current_session_id;
  if (!sesija) return;
  const tajmer = setTimeout(() => {
    bezVezeTajmeri.delete(computerId);
    if (isClientOnline(computerId)) return;
    const comp = computerById(computerId);
    if (!comp || comp.current_session_id !== sesija) return;
    const p = comp.current_player_id ? playerById(comp.current_player_id) : null;
    const tekst = `${comp.name} se ne javlja, a ${p?.username || "igrač"} je u sesiji. Proveri kabl i da li launcher radi.`;
    logEvent({ category: "racunar", action: "bez_veze", actor: "sistem", target: comp.name, detail: tekst });
    broadcastPanels({ t: "event", kind: "bez-veze", text: tekst });
  }, BEZ_VEZE_MS);
  if (tajmer.unref) tajmer.unref();
  bezVezeTajmeri.set(computerId, tajmer);
}

export function onClientClose(computerId) {
  // Stara veza koja se zatvori posle otvaranja nove ne prekida čekanje na
  // izveštaj.
  if (!isClientOnline(computerId)) {
    clearTimeout(cekaOfflineIzvestaj.get(computerId));
    cekaOfflineIzvestaj.delete(computerId);
    connectedSince.delete(computerId);
    pratiNestanak(computerId);
  }
  db.prepare("UPDATE computers SET last_seen = ? WHERE id = ?").run(Date.now(), computerId);
  pushComputers();
}

function loginOkPayload(player, session, { nastavak = false } = {}) {
  return {
    t: "login_ok",
    player: { id: player.id, username: player.username, displayName: player.display_name },
    balance: round2(player.balance),
    remainingSeconds: remainingSeconds(player.balance),
    // `sekundi`: koliko je već naplaćeno; launcher broji dalje od toga i bez
    // servera (vidi offline.js).
    session: { id: session.id, startedAt: session.started_at, sekundi: Number(session.sekundi) || 0 },
    // Sesija koja se nastavlja posle prekida veze: launcher ne pušta pozdrav.
    nastavak,
    skoroIgrane: skoroIgraneIgre(player.id),
    porudzbine: igracevePorudzbine(player.id),
    // Igračeva šara stiže uz prijavu.
    tekstura: teksturaZaRacunar(player.id),
    // Nivo i iskustvo idu uz prijavu, za traku na vrhu početne.
    vip: vipOd(player.xp),
    profil: profilIgraca(player.id),
    // Izbor igrača; null znači "kao u igraonici".
    mojaTekstura: (() => { const t = temaIgraca(player.id); return t ? { kljuc: t.kljuc, jacina: t.jacina, kretanje: t.kretanje } : null; })(),
    // Nagradni točak za ovog igrača.
    tocak: tocakInfo(player.id),
  };
}

// Igre koje je igrač poslednje pokretao; launcher ih stavlja na početak police.
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
  // Nepoznata igra (obrisana dok je pločica bila na ekranu) se zapisuje.
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
  // Uspelo pokretanje briše zapis o kvaru.
  ocistiKvar("games", gameId);
}

// Poslednji neuspeh stoji uz samu stavku kataloga (migracija u db.js).
const KVAR_TABELE = { igra: "games", alat: "tools" };
// Ime tabele se bira iz spiska, ne prima spolja.
function upisiKvar(tabela, id, razlog, gde) {
  if (tabela !== "games" && tabela !== "tools") return;
  try {
    db.prepare(`UPDATE ${tabela} SET kvar_kad=?, kvar_razlog=?, kvar_gde=? WHERE id=?`)
      .run(Date.now(), String(razlog || "greska").slice(0, 20), String(gde || "").slice(0, 40), Number(id));
  } catch {}
}
export function ocistiKvar(tabela, id) {
  if (tabela !== "games" && tabela !== "tools") return;
  try { db.prepare(`UPDATE ${tabela} SET kvar_kad=NULL, kvar_razlog=NULL, kvar_gde=NULL WHERE id=?`).run(Number(id)); } catch {}
}

// Igra koja neće da se pokrene: zapis u logovima uz ime računara i
// obaveštenje panelu. Najčešći uzrok je prečica koja na tom računaru fali.
const RAZLOZI = {
  nema: "putanja ne postoji na tom računaru",
  folder: "upisan je folder umesto prečice ili .exe fajla",
  greska: "Windows je odbio da je pokrene",
};
// Isti kvar se javlja pri svakom pokušaju; logovi ga beleže jednom u minuti.
const skoroJavljeno = new Map(); // "racunarId|igra" -> ts
function igraNeRadi(computerId, msg) {
  const igra = String(msg?.igra || "").trim().slice(0, 80);
  if (!igra) return;
  const razlog = RAZLOZI[msg?.razlog] || RAZLOZI.greska;
  const kljuc = `${computerId}|${igra}`;
  const sada = Date.now();
  const comp = computerById(computerId);

  // Oznaka uz stavku kataloga je stanje, ne događaj, pa se upisuje pre
  // prigušenja logova.
  const tabela = KVAR_TABELE[msg?.vrsta] || "games";
  if (msg?.id != null) upisiKvar(tabela, msg.id, msg?.razlog, comp?.name);

  if (sada - (skoroJavljeno.get(kljuc) || 0) < 60000) return;
  skoroJavljeno.set(kljuc, sada);

  const p = comp?.current_player_id ? playerById(comp.current_player_id) : null;
  logEvent({
    category: "igre", action: "game_fail", actor: p?.username || "-", target: comp?.name || "?",
    detail: `„${igra}" nije htela da se pokrene - ${razlog}`,
  });
  broadcastPanels({ t: "event", kind: "igra-ne-radi", text: `${comp?.name || "Računar"}: „${igra}" ne može da se pokrene - ${razlog}` });
}

// ---- Daljinski spisak procesa ----
// Panel pita preko HTTP-a, računar odgovara preko WebSocket-a. Svaki zahtev
// ima broj, a čekanje ima rok.
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

// Kvar koji javlja launcher (pukao ekran, izlaz bez PIN-a...), sa imenom
// računara.
function klijentProblem(computerId, msg) {
  const vrsta = String(msg?.vrsta || "").trim().slice(0, 40);
  const opis = String(msg?.opis || "").trim().slice(0, 200);
  if (!vrsta) return;
  const comp = computerById(computerId);
  const kljuc = `problem|${computerId}|${vrsta}`;
  const sada = Date.now();
  // Isti kvar se ne ponavlja u logovima češće od jednom u minuti.
  if (sada - (skoroJavljeno.get(kljuc) || 0) < 60000) return;
  skoroJavljeno.set(kljuc, sada);
  logEvent({
    category: "sistem", action: "klijent_problem", actor: "launcher",
    target: comp?.name || "?", detail: opis || vrsta,
  });
  broadcastPanels({ t: "event", kind: "klijent-problem", text: `${comp?.name || "Računar"}: ${opis || vrsta}` });
}

// Zapisi launchera za osoblje: blokiran program iz Preuzimanja, očišćeni
// tragovi igrača. Tekst stiže sa računara igrača, pa se skraćuje i prigušuje.
function klijentZapis(computerId, msg) {
  const tekst = String(msg?.tekst || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!tekst) return;
  const sada = Date.now();
  // Mapa se čisti da ne raste bez granice.
  if (skoroJavljeno.size > 500) {
    for (const [k, ts] of skoroJavljeno) if (sada - ts > 10 * 60000) skoroJavljeno.delete(k);
  }
  const kljuc = `zapis|${computerId}|${tekst}`;
  if (sada - (skoroJavljeno.get(kljuc) || 0) < 60000) return;
  skoroJavljeno.set(kljuc, sada);
  const comp = computerById(computerId);
  const p = comp?.current_player_id ? playerById(comp.current_player_id) : null;
  logEvent({ category: "racunar", action: "klijent_zapis", actor: p?.username || "launcher",
    target: comp?.name || "?", detail: tekst });
}

// Najigranije igre u periodu.
export function najigranije(from, to, limit = 10) {
  return db.prepare(`
    SELECT g.name, COUNT(*) puta, COUNT(DISTINCT l.player_id) igraca
    FROM game_launches l JOIN games g ON g.id = l.game_id
    WHERE l.at BETWEEN ? AND ?
    GROUP BY g.id ORDER BY puta DESC LIMIT ?`).all(from, to, limit);
}

// Poruke sa launchera
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
      return clientOrder(computerId, msg.items || [], msg.note || "", msg.payment === "cash" ? "cash" : "credit", msg.poId);
    case "change_password":
      return clientChangePassword(computerId, msg.oldPassword, msg.newPassword);
    case "moja_tekstura":
      return clientTekstura(computerId, msg);
    case "moj_profil":
      return clientProfil(computerId, msg);
    case "install_status":
      return clientInstallStatus(computerId, msg);
    case "nadogradnja_status":
      return clientNadogradnjaStatus(computerId, msg);
    case "game_start":
      return zabeleziPokretanje(computerId, Number(msg.gameId));
    case "igra_ne_radi":
      return igraNeRadi(computerId, msg);
    case "klijent_problem":
      return klijentProblem(computerId, msg);
    case "log_klijent":
      return klijentZapis(computerId, msg);
    case "procesi_lista":
    case "proces_ugasen":
      return odgovorNaZahtev(msg);
    case "tocak_spin":
      return clientTocakSpin(computerId);
    case "kupi_vip":
      return clientKupiVip(computerId);
    case "sys_info":
      return clientSysInfo(computerId, msg);
    case "hello":
      // Launcher je ponovo učitao ekran.
      return sendWelcomeState(computerId);
    case "offline_izvestaj":
      return clientOfflineIzvestaj(computerId, msg);
    case "heartbeat":
      db.prepare("UPDATE computers SET last_seen = ? WHERE id = ?").run(Date.now(), computerId);
      if (msg.mirovanje != null) proveriMirovanje(computerId, Number(msg.mirovanje));
      return;
    default:
      return;
  }
}

// Igrač menja svoju šaru; kućnu menja samo vlasnik kroz panel.
function clientTekstura(computerId, msg) {
  const comp = computerById(computerId);
  if (!comp?.current_player_id) return; // niko nije prijavljen na tom racunaru
  const r = sacuvajTemuIgraca(comp.current_player_id, {
    kljuc: msg.kljuc, jacina: msg.jacina, kretanje: msg.kretanje,
  });
  if (r.error) return sendClient(computerId, { t: "moja_tekstura_err", message: r.error });
  sendClient(computerId, { t: "tekstura", tekstura: r.tekstura, moja: r.tema });
}

// Igrač menja izgled profila; provere su u sacuvajProfilIgraca.
function clientProfil(computerId, msg) {
  const comp = computerById(computerId);
  if (!comp?.current_player_id) return;
  // Poruka bez izmena traži profil (kad nije stigao uz prijavu). Ništa se ne
  // upisuje.
  if (msg.boja == null && msg.okvir == null) {
    return sendClient(computerId, { t: "profil", profil: profilIgraca(comp.current_player_id) });
  }
  const r = sacuvajProfilIgraca(comp.current_player_id, { boja: msg.boja, okvir: msg.okvir });
  if (r.error) return sendClient(computerId, { t: "profil_err", message: r.error });
  sendClient(computerId, { t: "profil", profil: profilIgraca(comp.current_player_id) });
}

// Nagradni točak: ishod bira server, a launcher animira do dobijenog polja.
function clientTocakSpin(computerId) {
  const comp = computerById(computerId);
  if (!comp?.current_player_id) return;
  const r = zavrtiTocak(comp.current_player_id);
  if (r.error) return sendClient(computerId, { t: "tocak_err", message: r.error, tocak: tocakInfo(comp.current_player_id) });
  sendClient(computerId, { t: "tocak_rezultat", index: r.index, nagrada: r.nagrada, balance: r.balance, sledeciSpin: r.sledeciSpin });
}

// Kupovina VIP-a sa računara igrača; sve provere su ovde.
function clientKupiVip(computerId) {
  const comp = computerById(computerId);
  if (!comp?.current_player_id) return;
  const r = kupiVip(comp.current_player_id);
  if (r.error) return sendClient(computerId, { t: "vip_err", message: r.error });
  sendClient(computerId, { t: "vip_ok", dana: r.dana, balance: r.balance });
}

function clientLogin(computerId, username, password) {
  const comp = computerById(computerId);
  if (comp.status === "locked") {
    return sendClient(computerId, { t: "login_err", message: "Računar je zaključan. Pozovite osoblje." });
  }
  // Zaštita od duple prijave na istom računaru (dvostruka naplata).
  if (comp.current_player_id || activeSessionForComputer(computerId)) {
    const cur = playerById(comp.current_player_id);
    const s = activeSessionForComputer(computerId);
    if (cur && s) sendClient(computerId, loginOkPayload(cur, s));
    return;
  }
  // Kočnica se gleda tek ovde: odbijanja iznad se ne broje.
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
  // Igrač je već prijavljen na drugom računaru?
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

// Kočnica protiv pogađanja: 5 promašaja pa 30 s pauze, za PIN osoblja,
// prijavu igrača i prijavu na panel. Broje se samo pogrešna lozinka ili PIN,
// ne i uredna odbijanja (nema kredita, blokiran nalog...).
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

// Koristi je i prijava na panel (routes.js).
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

// Ista porudžbina se ne naplaćuje dvaput. Dugme se otključava posle osam
// sekundi bez odgovora, pa uz porudžbinu ide broj pokušaja (`poId`), isti pri
// ponavljanju: server pamti šta je sa tim brojem uradio i vraća isti odgovor.
// Namerno ponovljena porudžbina nosi nov broj.
const NALOZI_PAMTI = 3 * 60000; // koliko se pamti jedan broj pokušaja
const obradjeniNalozi = new Map(); // poId -> { odgovor, kad }

function ocistiNaloge() {
  const granica = Date.now() - NALOZI_PAMTI;
  for (const [k, v] of obradjeniNalozi) if (v.kad < granica) obradjeniNalozi.delete(k);
}
// Raniji odgovor za već obrađen broj pokušaja.
export function ranijiOdgovor(poId) {
  if (!poId) return null;
  ocistiNaloge();
  return obradjeniNalozi.get(String(poId))?.odgovor ?? null;
}
export function zapamtiOdgovor(poId, odgovor) {
  if (!poId) return odgovor;
  ocistiNaloge();
  obradjeniNalozi.set(String(poId), { odgovor, kad: Date.now() });
  return odgovor;
}

function clientOrder(computerId, items, note, payment = "credit", poId = null) {
  // Broj važi po računaru, da isti broj sa drugog računara ne dobije tuđ odgovor.
  const kljucNaloga = poId ? `pc${computerId}:${String(poId).slice(0, 80)}` : null;
  const ranije = ranijiOdgovor(kljucNaloga);
  if (ranije) return sendClient(computerId, ranije);
  const comp = computerById(computerId);
  if (!comp.current_player_id) return sendClient(computerId, { t: "error", message: "Niste prijavljeni." });
  const p = playerById(comp.current_player_id);
  // Keš naplaćuje radnik pri donošenju, pa se kredit ne dira.
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
  // Porudžbina, stavke, zaliha i naplata su jedna transakcija.
  let orderId, newBal, prelaz, log;
  try {
    ({ orderId, newBal, prelaz, log } = uJednomPoslu(() => {
      const info = db
        .prepare("INSERT INTO orders (player_id, computer_id, total, status, note, payment, source, created_at) VALUES (?,?,?, 'pending', ?,?, 'client', ?)")
        .run(p.id, computerId, total, note, kes ? "cash" : "credit", now);
      const id = info.lastInsertRowid;
      const insItem = db.prepare("INSERT INTO order_items (order_id, item_id, name, price, qty) VALUES (?,?,?,?,?)");
      for (const r of resolved) insItem.run(id, r.item.id, r.item.name, r.item.price, r.qty);
      consumeStock(resolved);

      let bal = round2(p.balance);
      let prelaz = null;
      if (!kes) {
        // Iskustvo donosi samo piće plaćeno kreditom, jer se za keš ne zna čiji je.
        bal = round2(p.balance - total);
        const noviXp = xpPosleTrosenja(p, total);
        db.prepare("UPDATE players SET balance=?, xp=? WHERE id=?").run(bal, noviXp, p.id);
        addTransaction(p.id, "shop", -total, bal, null, `Porudžbina #${id}`);
        const a = nivoZa(p.xp), b = nivoZa(noviXp);
        if (b.nivo > a.nivo) prelaz = { nivoPre: a, nivoPosle: b };
      }
      // Zapis za "Shop" u obračunu smene ide u istu transakciju.
      const l = upisiLog({ category: "shop", action: "order", actor: p.username, target: comp.name,
        detail: `Porudžbina #${id} (${kes ? "keš" : "kredit"}): ` + resolved.map((r) => `${r.qty}x ${r.item.name}`).join(", "),
        amount: -total });
      return { orderId: id, newBal: bal, prelaz, log: l };
    }));
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `Porudžbina nije upisana: ${String(e?.message || e).slice(0, 150)}` });
    return sendClient(computerId, { t: "order_err", message: "Porudžbina nije prošla. Pokušaj ponovo ili pozovi osoblje." });
  }

  // Nivo se javlja tek posle upisa.
  javiNivo(p.id, prelaz);

  sendClient(computerId, zapamtiOdgovor(kljucNaloga, {
    t: "order_ok",
    orderId,
    payment: kes ? "cash" : "credit",
    total: round2(total),
    balance: newBal,
    remainingSeconds: remainingSeconds(newBal),
  }));
  posaljiPorudzbineIgracu(p.id);
  pushOrders();
  pushComputers();
  // Keš porudžbina je u obaveštenju posebno označena.
  broadcastPanels({ t: "event", kind: "order", text: `Nova porudžbina #${orderId} - ${comp.name} (${p.username})${kes ? ", KEŠ" : ""}` });
  // Iznos se upisuje i za keš: obračun smene računa "Shop ukupno" iz logova, a
  // "od toga keš" iz porudžbina, pa se "sa naloga" dobija kao razlika. Zapis je
  // upisan u transakciji iznad; ovde se samo javlja panelima.
  javiLog(log);
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

// Sesije i naplata
const tickState = new Map(); // sessionId -> { last }

// Kraj sesije je jedna transakcija: zatvaranje sesije, cena u istoriji naloga,
// zapis u logovima i oslobađanje računara. Inače bi računar ostao "zauzet"
// sa zatvorenom sesijom, a nova prijava na njemu ne bi prošla.
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
    // Ako upis ne uspe, greška se zapisuje, a sesija ostaje kakva je bila (i
    // dalje se naplaćuje).
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

  // Igračeva šara odlazi sa njim.
  sendClient(computerId, { t: "tekstura", tekstura: teksturaObj() });
  if (lock) sendClient(computerId, { t: "locked", reason });
  else sendClient(computerId, { t: "to_login" });
  pushComputers();
}

// Jedan prolaz naplate ne naplaćuje više od ovoga. Skok sistemskog sata
// unapred (sinhronizacija posle pokretanja) bi se inače naplatio kao odigrano
// vreme. Skok unazad daje negativnu razliku i preskače se.
export const NAJVISE_PO_PROLAZU = 60; // sekundi

export function sekundeZaNaplatu(proteklo) {
  if (!Number.isFinite(proteklo) || proteklo <= 0) return 0;
  return Math.min(proteklo, NAJVISE_PO_PROLAZU);
}

// Skok sata se javlja najviše jednom u minutu.
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

// Kvar naplate se javlja najviše jednom u minutu po sesiji.
const kvarNaplateJavljen = new Map();
function javiKvarNaplate(s, e) {
  const sada = Date.now();
  if (sada - (kvarNaplateJavljen.get(s.id) || 0) < 60000) return;
  kvarNaplateJavljen.set(s.id, sada);
  const ime = compName(s.computer_id);
  console.error(`naplata (${ime}):`, e);
  try {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `Naplata nije prošla na ${ime}: ${String(e?.message || e).slice(0, 150)}. Ostali računari se naplaćuju normalno.` });
  } catch {}
}

// Naplata, na svakih pet sekundi.
export function billingTick() {
  const r = rate();
  const now = Date.now();
  const active = db.prepare("SELECT * FROM sessions WHERE status='active'").all();
  for (const s of active) {
    // Greška u jednoj sesiji ne sme da preskoči ostale.
    try {
      const st = tickState.get(s.id) || { last: now };
      // Računar nije na vezi: naplata stoji, a vreme se pomera da ne bude
      // naknadne naplate kad se vrati.
      if (!isClientOnline(s.computer_id)) { st.last = now; tickState.set(s.id, st); continue; }
      // Dok se čeka izveštaj o radu bez servera (najviše 15 s), ne naplaćuje se.
      if (cekaOfflineIzvestaj.has(s.computer_id)) { st.last = now; tickState.set(s.id, st); continue; }
      const proteklo = (now - st.last) / 1000;
      st.last = now;
      tickState.set(s.id, st);
      if (r <= 0 || proteklo <= 0) continue;
      if (proteklo > NAJVISE_PO_PROLAZU) javiSkokSata(proteklo);
      const elapsed = sekundeZaNaplatu(proteklo);

      const p = playerById(s.player_id);
      if (!p) continue;
      // Naplata u celim parama, sa ostatkom koji prelazi u sledeći prolaz, pa se
      // na duže vreme naplaćuje tačno upisana cena (zaokruživanje svakog prolaza
      // bi pri 120 din/h naplatilo 122,40).
      const cost = (elapsed / 3600) * r + (st.ostatak || 0);
      const celih = Math.floor(cost * 100 + 1e-7) / 100;
      // Ne naplaćuje se više nego što igrač ima.
      const charged = Math.min(celih, Math.max(0, round2(p.balance)));
      st.ostatak = charged < celih ? 0 : Math.max(0, cost - celih);
      const newBal = round2(p.balance - charged);
      const newCost = round2(s.cost + charged);
      const noveSekunde = Math.round(((Number(s.sekundi) || 0) + elapsed) * 10) / 10;

      if (newBal <= 0) {
        // Ova dva upisa nisu u transakciji sa endSession: endSession hvata svoju
        // grešku, pa bi zajednički rollback poništio samo zatvaranje sesije. Ovako
        // sledeći prolaz ponovo pokušava da zatvori sesiju.
        db.prepare("UPDATE players SET balance=0 WHERE id=?").run(p.id);
        db.prepare("UPDATE sessions SET cost=?, sekundi=? WHERE id=?").run(newCost, noveSekunde, s.id);
        endSession(s.computer_id, { lock: true, reason: "time" });
        broadcastPanels({ t: "event", kind: "timeup", text: `${p.username} - isteklo vreme (${db.prepare("SELECT name FROM computers WHERE id=?").get(s.computer_id)?.name})` });
        continue;
      }
      // Kredit, cena sesije i iskustvo se upisuju zajedno.
      const noviXp = xpPosleTrosenja(p, charged);
      uJednomPoslu(() => {
        db.prepare("UPDATE players SET balance=?, xp=? WHERE id=?").run(newBal, noviXp, p.id);
        db.prepare("UPDATE sessions SET cost=?, sekundi=? WHERE id=?").run(newCost, noveSekunde, s.id);
      });
      // Nivo se javlja tek posle upisa.
      const preNivo = nivoZa(p.xp), posleNivo = nivoZa(noviXp);
      if (posleNivo.nivo > preNivo.nivo) javiNivo(p.id, { nivoPre: preNivo, nivoPosle: posleNivo });
      const preostalo = remainingSeconds(newBal);
      sendClient(s.computer_id, { t: "balance", balance: round2(newBal), remainingSeconds: preostalo, vip: vipOd(noviXp), sesija: s.id, sekundi: noveSekunde });
      javiOsobljuPredIstek(s, p, preostalo);
    } catch (e) {
      // Vreme se pomera i kad naplata pukne, da sledeći prolaz ne naplati sve od
      // početka greške odjednom.
      tickState.set(s.id, { last: now });
      javiKvarNaplate(s, e);
    }
  }
  if (active.length) pushComputers();
}

// Odjava zbog mirovanja: launcher javlja koliko dugo nema unosa, a sesija se
// zatvara posle odbrojavanja (film ili stream mogu dugo da idu bez unosa).
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

// Osoblje dobija upozorenje pre isteka vremena, da ponudi dopunu.
const PRAG_UPOZORENJA = [600, 300, 60]; // 10 min, 5 min, 1 min
// sessionId -> { pragovi: Set, poslednje: ms }
const javljenoZaSesiju = new Map();

function javiOsobljuPredIstek(s, p, preostalo) {
  if (preostalo == null) return;
  let javljeni = javljenoZaSesiju.get(s.id);
  if (!javljeni) { javljeni = { pragovi: new Set(), poslednje: 0 }; javljenoZaSesiju.set(s.id, javljeni); }

  const dostignuti = PRAG_UPOZORENJA.filter((x) => preostalo <= x);
  const novi = dostignuti.filter((x) => !javljeni.pragovi.has(x));
  if (!novi.length) return;
  novi.forEach((x) => javljeni.pragovi.add(x));

  // Dva praga u par sekundi daju jedno upozorenje.
  const sada = Date.now();
  if (sada - (javljeni.poslednje || 0) < 45000) return;
  javljeni.poslednje = sada;

  // U poruci je stvarno preostalo vreme, ne prag.
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

// Akcije osoblja (HTTP rute)
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
  // Prijavljen igrač: sesija se prvo zatvara.
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

// Početni kredit je dopuna i ulazi u obračun smene (kategorija "novac"),
// zajedno sa nalogom i istorijom naloga.
export function createPlayer({ username, password, displayName, balance, note }, { adminId = null, adminUsername = "sistem" } = {}) {
  username = String(username || "").trim();
  if (!username || !password) return { error: "Korisničko ime i lozinka su obavezni" };
  const exists = db.prepare("SELECT id FROM players WHERE username = ?").get(username);
  if (exists) return { error: "Korisničko ime već postoji" };
  if (balance && !ispravanIznos(balance)) return { error: "Neispravan početni kredit" };
  if (Number(balance) < 0) return { error: "Početni kredit ne može biti negativan" };
  const kredit = round2(Number(balance) || 0);
  const hes = hashPassword(password); // sporo namerno - van posla, da ne drži bazu
  const now = Date.now();
  let id, log;
  try {
    ({ id, log } = uJednomPoslu(() => {
      const info = db
        .prepare("INSERT INTO players (username, password_hash, display_name, balance, note, created_at) VALUES (?,?,?,?,?,?)")
        .run(username, hes, displayName || username, kredit, note || null, now);
      const novi = Number(info.lastInsertRowid);
      if (kredit <= 0) return { id: novi, log: null };
      addTransaction(novi, "topup", kredit, kredit, adminId, "Početni kredit");
      return { id: novi, log: upisiLog({ category: "novac", action: "topup", actor: adminUsername, target: username,
        detail: "Početni kredit pri otvaranju naloga", amount: kredit }) };
    }));
  } catch (e) {
    return { error: "Nalog nije otvoren: " + String(e?.message || e).slice(0, 120) };
  }
  javiLog(log);
  pushComputers();
  return { ok: true, id };
}

// Brzi gosti: do deset naloga odjednom (gost-01, gost-02...), sa
// četvorocifrenom lozinkom.
export function createGuests(count, balance, admin = {}) {
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
    const r = createPlayer({ username, password, displayName: username, balance, note: `Brzi gost, ${datum}` }, admin);
    if (r.error) return { error: r.error };
    napravljeni.push({ id: r.id, username, password, balance });
  }
  return { ok: true, players: napravljeni };
}

// Potrošeni gosti za čišćenje: samo gost-* nalozi bez kredita, koji nisu za
// računarom i nisu korišćeni poslednja 24 sata.
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

// Dopuna kredita je jedna transakcija: stanje naloga, istorija naloga i
// zapis u logovima (iz kog se računa pazar smene).
export function topUpPlayer(playerId, amount, adminId, note, adminUsername = "sistem") {
  const p = playerById(playerId);
  if (!p || p.obrisan) return { error: "Nepostojeći igrač" };
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

  // Igrač za računarom odmah dobija novo stanje.
  const comp = db.prepare("SELECT * FROM computers WHERE current_player_id = ?").get(playerId);
  if (comp) sendClient(comp.id, { t: "balance", balance: newBal, remainingSeconds: remainingSeconds(newBal) });
  pushComputers();
  return { ok: true, balance: newBal };
}

// Vremenski paketi
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

// Prodaja paketa: igrač plaća `price`, a dobija kredit = sati x cena po satu.
// Razlika je popust i vodi se kao 'bonus'. Sve (naplata, popust, stanje
// naloga, zapis u logovima) je jedna transakcija.
export function prodajPaket(playerId, paketId, adminId, adminUsername = "sistem") {
  const p = playerById(playerId);
  if (!p || p.obrisan) return { error: "Nepostojeći igrač" };
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

// Nagradni točak: igrač koji je za sedam dana potrošio dovoljno vrti jednom.
// Ishod bira server (težinski nasumično).
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

// Stanje točka za jednog igrača.
export function tocakInfo(playerId) {
  const ukljucen = getSetting("tocak_ukljucen", "0") === "1";
  const p = playerById(playerId);
  // VIP ima niži prag; nikad viši od običnog (vidi pragZaSpin).
  const prag = vip.pragZaSpin({
    jeVip: vip.vaziVip(p?.vip_do),
    prag: Number(getSetting("tocak_prag", "1200")) || 0,
    vipPrag: Number(getSetting("vip_tocak_prag", vip.PODRAZUMEVANO.tocakPrag)),
  });
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

// Izvezena radi testa raspodele.
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
  if (!p || p.obrisan) return { error: "Nepostojeći igrač" };
  const prag = vip.pragZaSpin({
    jeVip: vip.vaziVip(p.vip_do),
    prag: Number(getSetting("tocak_prag", "1200")) || 0,
    vipPrag: Number(getSetting("vip_tocak_prag", vip.PODRAZUMEVANO.tocakPrag)),
  });
  const potroseno = potrosnjaNedelja(playerId);
  if (potroseno < prag) return { error: `Potrebno je ${prag} potrošnje ove nedelje (imaš ${potroseno})` };
  const now = Date.now();
  if (p.last_spin_at && now - p.last_spin_at < NEDELJA) return { error: "Već si zavrteo ove nedelje" };
  const nagrade = tocakNagrade();
  if (!nagrade.length) return { error: "Nema podešenih nagrada" };
  const idx = izaberiNagradu(nagrade);
  const dobit = nagrade[idx];
  // Oznaka spina i isplata nagrade su jedna transakcija.
  let bal;
  try {
    bal = uJednomPoslu(() => {
      // Spin se upisuje prvi, da dupli klik ne da drugi. Broj spinova i ukupan
      // dobitak idu u isti upis (značke ih koriste, a logovi se seku).
      db.prepare("UPDATE players SET last_spin_at=?, spinova=COALESCE(spinova,0)+1, spin_dobitak=COALESCE(spin_dobitak,0)+? WHERE id=?")
        .run(now, dobit.kredit > 0 ? dobit.kredit : 0, playerId);
      let b = round2(Number(p.balance) || 0);
      if (dobit.kredit > 0) {
        b = round2(b + dobit.kredit);
        db.prepare("UPDATE players SET balance=? WHERE id=?").run(b, playerId);
        // Kredit sa točka je poklon ('bonus'); log je bez iznosa, da ne uđe u pazar.
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

// Podešavanje točka (vlasnik)
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
// Izmena točka stiže prijavljenim igračima odmah.
export function pushTocak() {
  for (const c of db.prepare("SELECT id, current_player_id FROM computers WHERE current_player_id IS NOT NULL").all()) {
    sendClient(c.id, { t: "tocak", tocak: tocakInfo(c.current_player_id) });
  }
}

// Kasa: radnik kuca porudžbinu (kredit sa naloga ili keš).
export function createPosOrder({ items, playerId, computerId, payment = "cash", note, actor = "radnik", poId = null }) {
  // Ponovljen pokušaj vraća raniji odgovor (vidi obradjeniNalozi).
  const ranije = ranijiOdgovor(poId);
  if (ranije) return ranije;
  // Isti artikal se spaja u jedan red. Radnik sme više komada i skrivene artikle.
  const resolved = spojiStavke(items, { najviseKomada: 50, samoDostupne: false });
  if (!resolved.length) return { error: "Dodajte bar jedan artikal" };
  const total = resolved.reduce((s, r) => s + r.item.price * r.qty, 0);

  const short = stockShortage(resolved);
  if (short) return { error: `"${short.item.name}" je rasprodato ili nema dovoljno na stanju` };

  let player = null;
  if (payment === "credit") {
    if (!playerId) return { error: "Za plaćanje kreditom izaberite igrača" };
    player = playerById(playerId);
    if (!player || player.obrisan) return { error: "Igrač ne postoji" };
    if (player.balance < total) return { error: `Nedovoljno kredita (potrebno ${round2(total)}, ima ${round2(player.balance)})` };
  } else {
    payment = "cash";
    if (playerId) player = playerById(playerId);
  }

  const now = Date.now();
  // Jedna transakcija, kao u clientOrder.
  let orderId, javiIgracu = null, log = null;
  try {
    ({ orderId, javiIgracu, log } = uJednomPoslu(() => {
      const info = db.prepare(
        "INSERT INTO orders (player_id, computer_id, total, status, payment, source, note, created_at) VALUES (?,?,?,?,?,?,?,?)"
      ).run(player ? player.id : null, computerId || null, total, "pending", payment, "pos", note || null, now);
      const id = info.lastInsertRowid;
      const insItem = db.prepare("INSERT INTO order_items (order_id, item_id, name, price, qty) VALUES (?,?,?,?,?)");
      for (const r of resolved) insItem.run(id, r.item.id, r.item.name, r.item.price, r.qty);
      consumeStock(resolved);

      let javi = null;
      if (payment === "credit" && player) {
        // Kredit donosi iskustvo, kao i porudžbina sa računara.
        const newBal = round2(player.balance - total);
        const noviXp = xpPosleTrosenja(player, total);
        db.prepare("UPDATE players SET balance=?, xp=? WHERE id=?").run(newBal, noviXp, player.id);
        addTransaction(player.id, "shop", -total, newBal, null, `POS porudžbina #${id}`);
        const a = nivoZa(player.xp), b = nivoZa(noviXp);
        javi = { newBal, playerId: player.id, prelaz: b.nivo > a.nivo ? { nivoPre: a, nivoPosle: b } : null };
      }
      const l = upisiLog({ category: "shop", action: "pos", actor, target: player ? player.username : "keš",
        detail: `POS #${id} (${payment === "cash" ? "keš" : "kredit"}): ` + resolved.map((r) => `${r.qty}x ${r.item.name}`).join(", "),
        amount: -total });
      return { orderId: id, javiIgracu: javi, log: l };
    }));
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `POS račun nije upisan: ${String(e?.message || e).slice(0, 150)}` });
    return { error: "Račun nije upisan. Pokušaj ponovo." };
  }
  // Igraču se javlja posle upisa.
  if (javiIgracu && player) {
    const comp = db.prepare("SELECT id FROM computers WHERE current_player_id = ?").get(player.id);
    if (comp) sendClient(comp.id, { t: "balance", balance: javiIgracu.newBal, remainingSeconds: remainingSeconds(javiIgracu.newBal) });
    javiNivo(player.id, javiIgracu.prelaz);
  }

  pushOrders();
  pushComputers();
  const who = player ? player.username : "keš";
  javiLog(log);
  broadcastPanels({ t: "event", kind: "order", text: `Nova porudžbina #${orderId} (${payment === "cash" ? "keš" : who})` });
  return zapamtiOdgovor(poId, { ok: true, orderId, total: round2(total) });
}

const ORDER_STATUS_LABEL = { pending: "na čekanju", preparing: "priprema se", delivered: "dostavljeno", cancelled: "otkazano" };

export function setOrderStatus(orderId, status, actor = "osoblje") {
  const valid = ["pending", "preparing", "delivered", "cancelled"];
  if (!valid.includes(status)) return { error: "Neispravan status" };
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  if (!o) return { error: "Nepostojeća porudžbina" };
  if (o.status === status) return { ok: true }; // ništa se nije promenilo
  // Otkazano je konačno: kredit i piće su vraćeni, iznos je izašao iz pazara.
  if (o.status === "cancelled") return { error: "Otkazana porudžbina ne može da se vrati - napravi novu." };

  const cancelling = status === "cancelled" && o.status !== "cancelled";

  // Otkazivanje je jedna transakcija: vraćen kredit, piće na stanju, status i
  // poništenje u obračunu.
  let vracen = null, log, vracenoNaStanje = [];
  try {
    ({ vracen, log, vracenoNaStanje } = uJednomPoslu(() => {
      const naStanje = cancelling ? vratiStock(orderId) : [];
      let v = null;
      // Kredit se vraća samo za porudžbinu plaćenu kreditom.
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
      // Pozitivan iznos poništava original u obračunu smene.
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
  // Vraćeno piće se odmah vidi u launcheru i u traci za dopunu.
  if (vracenoNaStanje.length) pushCatalog();
  pushOrders();
  pushComputers();
  return { ok: true };
}

export function setPlayerBanned(playerId, banned) {
  const p = playerById(playerId);
  if (!p || p.obrisan) return { error: "Igrač ne postoji" };
  db.prepare("UPDATE players SET banned=? WHERE id=?").run(banned ? 1 : 0, playerId);
  if (banned) {
    const comp = db.prepare("SELECT * FROM computers WHERE current_player_id = ?").get(playerId);
    if (comp) endSession(comp.id, { lock: false, reason: "banned" });
  }
  return { ok: true };
}

export function resetPlayerPassword(playerId, newPassword) {
  if (!newPassword || String(newPassword).length < 3) return { error: "Lozinka prekratka" };
  const p = playerById(playerId);
  if (!p || p.obrisan) return { error: "Igrač ne postoji" };
  db.prepare("UPDATE players SET password_hash=? WHERE id=?").run(hashPassword(newPassword), playerId);
  return { ok: true };
}

export function updatePlayer(id, { username, displayName, note }) {
  const p = playerById(id);
  if (!p || p.obrisan) return { error: "Igrač ne postoji" };
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

// Brisanje naloga ne briše istoriju novca: izveštaji se računaju iz
// transakcija i sesija. Nalog se gasi - ime dobija oznaku, lozinka se briše,
// nalog nestaje iz spiskova - a istorija ostaje.
export const OZNAKA_OBRISANOG = /^obrisan-\d+-/;
export const imeIgraca = (ime) => String(ime ?? "").replace(OZNAKA_OBRISANOG, "");
export function deletePlayer(id) {
  const p = playerById(id);
  if (!p || p.obrisan) return { error: "Igrač ne postoji" };
  if (db.prepare("SELECT id FROM computers WHERE current_player_id=?").get(id))
    return { error: "Igrač je trenutno prijavljen - prvo ga odjavi" };
  try {
    db.prepare("UPDATE players SET obrisan=?, username=?, password_hash='', banned=1 WHERE id=?")
      .run(Date.now(), `obrisan-${p.id}-${p.username}`, id);
  } catch (e) {
    return { error: "Brisanje nije uspelo: " + e.message };
  }
  return { ok: true, username: p.username };
}

// Podaci o serveru (Podešavanja)
export function serverInfo() {
  // Preko DATA_DIR, da izolovana instanca prijavljuje svoju bazu.
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
  // Infinity i NaN se u SQLite upisuju kao NULL, pa postaju 0.
  return Number.isFinite(x) ? x : 0;
}

// Gornja granica za iznose koje osoblje kuca.
const MAX_IZNOS = 1000000;
export function ispravanIznos(n) {
  const x = Number(n);
  return Number.isFinite(x) && Math.abs(x) <= MAX_IZNOS;
}

// Daljinske komande
const POWER_CMDS = ["shutdown", "restart", "logoff", "reboot_launcher"];

// Gašenje i odjava sa Windows-a prvo zatvaraju sesiju: ugašen računar se
// vraća tek sledećeg dana, a otvorena sesija bi se tada nastavila i
// naplaćivala. Restart i restart launchera zadržavaju sesiju.
const KOMANDE_KOJE_ZATVARAJU = ["shutdown", "logoff"];

export function sendCommand(computerId, cmd, adminId = null) {
  if (!POWER_CMDS.includes(cmd)) return { error: "Nepoznata komanda" };
  if (!isClientOnline(computerId)) return { error: "Računar nije povezan" };
  if (KOMANDE_KOJE_ZATVARAJU.includes(cmd) && computerById(computerId)?.current_player_id) {
    endSession(computerId, { lock: false, reason: "staff", adminId });
  }
  const ok = sendClient(computerId, { t: "command", cmd });
  if (ok) broadcastPanels({ t: "event", kind: "cmd", text: `Komanda "${cmdLabel(cmd)}" poslata na ${compName(computerId)}` });
  return ok ? { ok: true } : { error: "Računar nije povezan" };
}

export function bulkAction(ids, action, adminId = null) {
  const targets = ids && ids.length ? ids : db.prepare("SELECT id FROM computers WHERE obrisan IS NULL").all().map((r) => r.id);
  let sent = 0;
  for (const id of targets) {
    if (action === "lock") { lockComputer(id, null); sent++; }
    else if (action === "unlock") {
      // Grupno otključavanje dira samo zaključane računare.
      const c = computerById(id);
      if (c && c.status === "locked") { unlockComputer(id, null); sent++; }
    }
    else if (action === "logout") { forceLogout(id, null); sent++; }
    else { const r = sendCommand(id, action, adminId); if (r.ok) sent++; }
  }
  return { ok: true, sent, total: targets.length };
}

function compName(id) { return db.prepare("SELECT name FROM computers WHERE id=?").get(id)?.name || "?"; }
function cmdLabel(c) { return { shutdown: "Ugasi", restart: "Restartuj", logoff: "Odjava Windows", reboot_launcher: "Restart launchera" }[c] || c; }

// Uklanjanje računara: računar sa istorijom (sesije, porudžbine) se gasi -
// ime se oslobađa, token prestaje da važi, otvorena veza se zatvara - a
// istorija ostaje. Računar bez istorije se briše.
export function obrisiRacunar(id) {
  const c = computerById(id);
  if (!c || c.obrisan) return { error: "Računar ne postoji", nema: true };
  if (c.current_player_id || activeSessionForComputer(id)) return { error: "Na računaru neko igra - prvo ga odjavi." };
  const trag = db.prepare(
    "SELECT (SELECT COUNT(*) FROM sessions WHERE computer_id=?) + (SELECT COUNT(*) FROM orders WHERE computer_id=?) c"
  ).get(id, id).c;
  try {
    if (trag === 0) {
      db.prepare("DELETE FROM computers WHERE id=?").run(id);
    } else {
      db.prepare("UPDATE computers SET obrisan=?, name=?, token=?, status='offline', current_player_id=NULL, current_session_id=NULL WHERE id=?")
        .run(Date.now(), `obrisan-${id}-${c.name}`, `obrisan-${id}-${randomBytes(12).toString("hex")}`, id);
    }
  } catch (e) {
    return { error: "Uklanjanje nije uspelo: " + String(e?.message || e).slice(0, 120) };
  }
  izbaciRacunar(id);
  connectedSince.delete(id);
  pushComputers();
  return { ok: true, ugasen: trag > 0, ime: c.name };
}
export const imeRacunara = (ime) => String(ime ?? "").replace(/^obrisan-\d+-/, "");

// Radnici
export function listAdmins() {
  // Ugašeni nalozi idu na dno spiska, ali se vide. Redosled: serviser,
  // vlasnici, radnici.
  return db.prepare("SELECT id, username, role, active, created_at FROM admins ORDER BY active DESC, CASE role WHEN 'serviser' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END, username")
    .all().map((a) => ({ id: a.id, username: a.username, role: a.role, aktivan: a.active !== 0, createdAt: a.created_at }));
}
// Ko koga sme da menja: samo naloge niže uloge. Važi za promenu lozinke,
// oduzimanje i vraćanje pristupa.
export function smePreko(kojiRadi, ciljnaUloga) {
  return rang(kojiRadi?.role) > rang(ciljnaUloga);
}
function proveriPravo(kojiRadi, cilj) {
  if (!cilj) return { error: "Nalog ne postoji" };
  if (smePreko(kojiRadi, cilj.role)) return null;
  return {
    error: cilj.role === "serviser"
      ? "Serviserski nalog može da menja samo serviser."
      : "Nemate pravo nad ovim nalogom.",
  };
}

export function createAdmin({ username, password, role }, kojiRadi) {
  username = String(username || "").trim();
  if (!username || !password) return { error: "Korisničko ime i lozinka su obavezni" };
  if (!["owner", "staff", "serviser"].includes(role)) role = "staff";
  // Pravljenje ide do sopstvene uloge (vlasnik sme drugog vlasnika), a menjanje
  // samo ispod nje, pa se dva vlasnika ne mogu međusobno isključiti. Naviše se
  // ne ide.
  if (rang(kojiRadi?.role) < rang(role)) {
    return { error: role === "serviser"
      ? "Serviserski nalog može da napravi samo serviser."
      : "Nemate pravo da pravite nalog te uloge." };
  }
  if (db.prepare("SELECT id FROM admins WHERE username=?").get(username)) return { error: "Korisničko ime već postoji" };
  const info = db.prepare("INSERT INTO admins (username, password_hash, role, created_at) VALUES (?,?,?,?)")
    .run(username, hashPassword(password), role, Date.now());
  return { ok: true, id: info.lastInsertRowid };
}
export function updateAdminPassword(id, newPassword, kojiRadi) {
  const cilj = db.prepare("SELECT id, role FROM admins WHERE id=?").get(id);
  const zabrana = proveriPravo(kojiRadi, cilj);
  if (zabrana) return zabrana;
  if (!newPassword || String(newPassword).length < 3) return { error: "Lozinka mora imati bar 3 znaka" };
  db.prepare("UPDATE admins SET password_hash=? WHERE id=?").run(hashPassword(newPassword), id);
  zaboraviProveruLozinke(); // upozorenje o fabrickoj lozinki mora odmah da nestane
  // Promena lozinke odjavljuje taj nalog sa svih panela.
  db.prepare("DELETE FROM admin_tokens WHERE admin_id=?").run(id);
  return { ok: true };
}
export function deleteAdmin(id, currentAdminId, kojiRadi) {
  const a = db.prepare("SELECT * FROM admins WHERE id=?").get(id);
  if (!a) return { error: "Nalog ne postoji" };
  if (a.id === currentAdminId) return { error: "Ne možete obrisati sopstveni nalog" };
  const zabrana = proveriPravo(kojiRadi, a);
  if (zabrana) return zabrana;
  const owners = db.prepare("SELECT COUNT(*) c FROM admins WHERE role='owner' AND active=1").get().c;
  if (a.role === "owner" && owners <= 1) return { error: "Mora postojati bar jedan vlasnik" };

  // Radniku kome se oduzima pristup nalog se gasi, ne briše: smene i dopune
  // ostaju potpisane njegovim imenom. Nalog bez ijednog traga se briše.
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

// Vraćanje ugašenog naloga.
export function vratiAdmin(id, kojiRadi) {
  const a = db.prepare("SELECT * FROM admins WHERE id=?").get(id);
  const zabrana = proveriPravo(kojiRadi, a);
  if (zabrana) return zabrana;
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

// Slike (artikli, omoti i baneri igara)
function saveImage(table, prefix, id, dataUrl, col = "image", maxBytes = 3 * 1024 * 1024) {
  const item = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!item) return { error: "Stavka ne postoji" };
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return { error: "Neispravan format slike (PNG, JPG, WEBP ili GIF)" };
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > maxBytes) return { error: `Slika je prevelika (maksimum ${Math.round(maxBytes / 1048576)} MB)` };
  const dir = UPLOADS;
  fs.mkdirSync(dir, { recursive: true });
  if (item[col]) { obrisiSliku(item[col]); }
  const fname = `${prefix}-${id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), buf);
  const url = `/uploads/${fname}`;
  db.prepare(`UPDATE ${table} SET ${col}=? WHERE id=?`).run(url, id);
  return { ok: true, image: url };
}
function removeImage(table, id, col = "image") {
  const item = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (item?.[col]) { obrisiSliku(item[col]); }
  db.prepare(`UPDATE ${table} SET ${col}=NULL WHERE id=?`).run(id);
  return { ok: true };
}
// Pozadine ekrana u launcheru, iz panela, za sve računare odjednom.
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

// Brend: znak i boja igraonice, iz panela. Program je isti za svaku
// igraonicu, a izgled se podešava.
export const AKCENAT_PODRAZUMEVANI = "#2f6ae8";

// Gotove boje kuće, proverene za čitljivost na tamnoj podlozi i belo slovo na
// dugmetu. Crvene, narandžaste i zelene nema: te boje nose značenja (ističe
// vreme, nagrada, ima kredita). Heks se može upisati i ručno, uz upozorenje.
// Nijedna gotova boja ne sme da nosi zamerku (čuva test).
export const BOJE_KUCE = [
  { kljuc: "plava",       naziv: "Plava",       heks: "#2f6ae8" },
  { kljuc: "indigo",      naziv: "Indigo",      heks: "#5145d8" },
  { kljuc: "ljubicasta",  naziv: "Ljubičasta",  heks: "#8a45d6" },
  { kljuc: "magenta",     naziv: "Magenta",     heks: "#c2398f" },
  { kljuc: "roze",        naziv: "Roze",        heks: "#e0568f" },
  { kljuc: "sljiva",      naziv: "Šljiva",      heks: "#9c3fb0" },
  { kljuc: "nebo",        naziv: "Nebo",        heks: "#2f9fe8" },
  { kljuc: "tirkiz",      naziv: "Tirkiz",      heks: "#1aa5bd" },
  { kljuc: "celik",       naziv: "Čelik",       heks: "#64789c" },
  { kljuc: "srebro",      naziv: "Srebro",      heks: "#c3c9dc" },
];

// Boje koje nose značenje; boja kuće ne sme da bude preblizu njima.
const ZNACENJA = [
  { heks: "#3dc97e", sta: "„ima kredita“" },
  { heks: "#ffb527", sta: "„nagrada“" },
  { heks: "#ff3b3b", sta: "„ističe vreme“" },
];

const uRgb = (h) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(h || ""));
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};

// Ton u stepenima. Poredi se ton, ne cela boja.
function ton(heks) {
  const rgb = uRgb(heks);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return null; // siva nema ton - i ne može da se pomeša ni sa čim
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// Svetlina: pretamna se ne vidi na tamnoj podlozi, presvetla ne nosi belo slovo.
function svetlina(heks) {
  const rgb = uRgb(heks);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Zamerke na izabranu boju; prazan spisak znači da je u redu. Upozorava, ne
// zabranjuje.
export function zamerkeNaBoju(heks) {
  const t = ton(heks), s = svetlina(heks);
  const lista = [];
  if (s == null) return lista;

  // Donja granica: dugme se gubi u podlozi (#070c1c). Gornja: belo slovo se
  // slabo čita.
  if (s < 0.045) lista.push({ vrsta: "tamna", tekst: "Ova boja je pretamna - dugmad se gube u podlozi." });
  if (s > 0.62) lista.push({ vrsta: "svetla", tekst: "Ova boja je presvetla - belo slovo na dugmetu se slabo čita." });

  if (t != null) {
    for (const z of ZNACENJA) {
      const tz = ton(z.heks);
      if (tz == null) continue;
      const razlika = Math.min(Math.abs(t - tz), 360 - Math.abs(t - tz));
      if (razlika < 22) {
        lista.push({ vrsta: "znacenje", tekst: `Vrlo je blizu boje koja znači ${z.sta} - igraču će se te dve stvari mešati.` });
      }
    }
  }
  return lista;
}

const HEKS = /^#[0-9a-f]{6}$/i;

// Sve nijanse za panel i launcher izvode se iz jedne boje.
export function nijanse(heks) {
  const osnovna = HEKS.test(String(heks || "")) ? String(heks).toLowerCase() : AKCENAT_PODRAZUMEVANI;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(osnovna.slice(i, i + 2), 16));
  const pomeri = (k) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)))
    .toString(16).padStart(2, "0")).join("");
  return {
    akcenat: osnovna,
    hover: pomeri(1.14),
    down: pomeri(0.86),
    soft: `rgba(${r}, ${g}, ${b}, 0.12)`,
    line: `rgba(${r}, ${g}, ${b}, 0.45)`,
    rgb: `${r}, ${g}, ${b}`,
  };
}

export function brendObj() {
  return {
    naziv: getSetting("cafe_name", "Crit"),
    logo: getSetting("brend_logo", "") || null,
    ...nijanse(getSetting("brend_akcenat", AKCENAT_PODRAZUMEVANI)),
    // Fabričku boju i gotove boje šalje server; panel ih ne drži posebno.
    fabricki: AKCENAT_PODRAZUMEVANI,
    gotove: BOJE_KUCE,
  };
}

export function sacuvajLogo(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return { error: "Neispravan format slike (PNG, JPG, WEBP ili SVG)" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 3 * 1024 * 1024) return { error: "Logo je prevelik (maksimum 3 MB)" };
  const ext = { jpeg: "jpg", "svg+xml": "svg" }[m[1].toLowerCase()] || m[1].toLowerCase();
  const dir = UPLOADS;
  fs.mkdirSync(dir, { recursive: true });
  const staro = getSetting("brend_logo", null);
  if (staro) { obrisiSliku(staro); }
  const fname = `logo-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), buf);
  const url = `/uploads/${fname}`;
  setSetting("brend_logo", url);
  pushBrend();
  return { ok: true, ...brendObj() };
}

export function obrisiLogo() {
  const staro = getSetting("brend_logo", null);
  if (staro) { obrisiSliku(staro); }
  setSetting("brend_logo", "");
  pushBrend();
  return { ok: true, ...brendObj() };
}

export function sacuvajAkcenat(heks) {
  const v = String(heks || "").trim();
  if (!HEKS.test(v)) return { error: "Boja mora biti u obliku #RRGGBB (npr. #2f6ae8)" };
  setSetting("brend_akcenat", v.toLowerCase());
  pushBrend();
  return { ok: true, ...brendObj() };
}

// Izgled se menja odmah u panelu i na svim launcherima.
export function pushBrend() {
  const b = brendObj();
  broadcastClients({ t: "brend", brend: b });
  broadcastPanels({ t: "brend", brend: b });
}

export function savePozadinu(kljuc, dataUrl) {
  if (!POZADINE[kljuc]) return { error: "Nepoznat ekran" };
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return { error: "Neispravan format slike (PNG, JPG ili WEBP)" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) return { error: "Slika je prevelika (maksimum 8 MB)" };
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const dir = UPLOADS;
  fs.mkdirSync(dir, { recursive: true });
  const staro = getSetting(`pozadina_${kljuc}`, null);
  if (staro) { obrisiSliku(staro); }
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
  if (staro) { obrisiSliku(staro); }
  setSetting(`pozadina_${kljuc}`, "");
  pushPozadine();
  return { ok: true };
}

export function pushPozadine() {
  broadcastClients({ t: "pozadine", pozadine: pozadineObj() });
}

// Šara pozadine. Čuva se kao izbor, a launcher je crta sam (oštra na svakoj
// rezoluciji). Definicija postoji samo ovde, pa panel i launcher prikazuju
// isto. Prozirnost je po šari različita, da sve deluju podjednako prisutno.
// Šara sa imenom igraonice se pravi u hodu (saraOd).
const saraTeksture = (o) => (o.saraOd ? o.saraOd(getSetting("cafe_name", "Igraonica")) : o.sara);

// Spisak šara za slanje launcheru i panelu, sa već izračunatom šarom od imena
// (funkcija se ne može poslati kao JSON).
export function teksturaSpisak() {
  return Object.fromEntries(Object.entries(TEKSTURE)
    .map(([k, o]) => [k, { naziv: o.naziv, opis: o.opis, korak: o.korak, sara: saraTeksture(o) }]));
}
// Razmaci i prelomi reda se sklanjaju: CSS `url("...")` sa prelomom reda se
// tiho odbacuje.
const svg = (s) => `url("data:image/svg+xml,${s.replace(/\s+/g, " ").trim().replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}")`;
// Naziv igraonice ulazi u SVG, pa se eskejpuje (`&` ili `<` bi pokvarili sliku).
const escXml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Iskre: ista šara u boji kuće i punom jačinom, za kretanje "Iskre". Obris
// je isti, da se figure poklope; boja kuće se čita pri crtanju.
const uIskru = (obris) => obris
  .replace(/#fff\b/g, getSetting("brend_akcenat", AKCENAT_PODRAZUMEVANI))
  .replace(/(fill|stroke)-opacity='[\d.]+'/g, "$1-opacity='0.95'");

// Varijanta u boji kuće se izvodi iz bele, da se šara ne piše dvaput.
const dekodiraj = (u) => String(u)
  .replace(/^url\("data:image\/svg\+xml,/, "").replace(/"\)$/, "")
  .replace(/%3C/g, "<").replace(/%3E/g, ">").replace(/%23/g, "#");
const iskraOd = (sara) => (sara ? svg(uIskru(dekodiraj(sara))) : "");

export const TEKSTURE = {
  nema: { naziv: "Bez teksture", opis: "Čista pozadina, samo gradijent", sara: "", korak: 0 },

  // Raster pod 45 stepeni sa tri veličine tačke; tačke na ivici se ponavljaju
  // sa suprotne strane, pa se spoj pločica ne vidi.
  tacke: {
    naziv: "Raster", opis: "Rasterske tačke iz štampe stripa, tri veličine", korak: 48,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><g fill='#fff'>
      <circle cx='12' cy='12' r='2.1' fill-opacity='0.20'/><circle cx='36' cy='36' r='2.1' fill-opacity='0.20'/>
      <circle cx='36' cy='12' r='1.25' fill-opacity='0.14'/><circle cx='12' cy='36' r='1.25' fill-opacity='0.14'/>
      <circle cx='24' cy='0' r='0.75' fill-opacity='0.10'/><circle cx='24' cy='48' r='0.75' fill-opacity='0.10'/>
      <circle cx='0' cy='24' r='0.75' fill-opacity='0.10'/><circle cx='48' cy='24' r='0.75' fill-opacity='0.10'/>
      <circle cx='24' cy='24' r='0.75' fill-opacity='0.10'/></g></svg>`),
  },
  // Četvorokrake iskre sa uvučenim stranicama, pet veličina, van rešetke.
  zvezde: {
    naziv: "Iskre", opis: "Četvorokrake iskre sa znaka, pet veličina", korak: 88,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='88' height='88'><g fill='#fff'>
      <path d='M22 15C24.9 23.1 24.9 23.1 33 26C24.9 28.9 24.9 28.9 22 37C19.1 28.9 19.1 28.9 11 26C19.1 23.1 19.1 23.1 22 15z' fill-opacity='0.19'/>
      <path d='M64 52.5C66 58 66 58 71.5 60C66 62 66 62 64 67.5C62 62 62 62 56.5 60C62 58 62 58 64 52.5z' fill-opacity='0.14'/>
      <path d='M72 11.5C73.2 15 73.2 15 76.5 16C73.2 17 73.2 17 72 20.5C70.8 17 70.8 17 67.5 16C70.8 15 70.8 15 72 11.5z' fill-opacity='0.10'/>
      <path d='M14 64.5C14.9 67.2 14.9 67.2 17.5 68C14.9 68.8 14.9 68.8 14 71.5C13.1 68.8 13.1 68.8 10.5 68C13.1 67.2 13.1 67.2 14 64.5z' fill-opacity='0.09'/>
      <path d='M44 41.4C44.7 43.3 44.7 43.3 46.6 44C44.7 44.7 44.7 44.7 44 46.6C43.3 44.7 43.3 44.7 41.4 44C43.3 43.3 43.3 43.3 44 41.4z' fill-opacity='0.07'/>
    </g></svg>`),
  },
  // Prasak: glavni oblik pomeren iz sredine i prigušen, oko njega sitniji pod
  // različitim uglovima, pa se u ponavljanju ne vidi rešetka.
  prasak: {
    naziv: "Praskovi", opis: "Strip prasak iz znaka, raspoređen bez reda", korak: 150,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'><g fill='none' stroke='#fff' stroke-linejoin='round'>
      <path d='M54.8 46.4L44.1 51.4L45.6 63.1L37.4 54.7L27.2 60.7L31.5 49.7L21.2 43.9L33 43.3L34.9 31.6L40.5 42.1L51.4 37.6L44.4 46.9z' stroke-opacity='0.13' stroke-width='1.5'/>
      <path d='M122.5 100.6L115.6 104L116.6 111.6L111.2 106.1L104.6 110L107.4 102.9L100.8 99.1L108.4 98.7L109.7 91.1L113.3 97.9L120.3 95z' stroke-opacity='0.10' stroke-width='1.2'/>
      <path d='M124.3 24.3L120.5 26.2L121.1 30.4L118.1 27.4L114.5 29.5L116 25.6L112.4 23.5L116.6 23.3L117.3 19.1L119.3 22.8L123.2 21.2z' stroke-opacity='0.085' stroke-width='1'/>
      <path d='M23.4 117.9L20.6 119.3L21 122.4L18.8 120.2L16.1 121.8L17.2 118.9L14.6 117.3L17.7 117.2L18.2 114.1L19.7 116.8L22.6 115.6z' stroke-opacity='0.075' stroke-width='0.9'/>
    </g></svg>`),
  },
  // Zašiljene linije brzine pod tačno 45 stepeni, da se pločice spajaju bez šava.
  kose: {
    naziv: "Brzina", opis: "Zašiljene linije brzine, kao iza figure u stripu", korak: 96,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><g fill='#fff'>
      <path d='M-16 20 l60 60 l0 -3.2 l-60 -60z' fill-opacity='0.16'/><path d='M80 20 l60 60 l0 -3.2 l-60 -60z' fill-opacity='0.16'/>
      <path d='M10 62 l38 38 l0 -2 l-38 -38z' fill-opacity='0.11'/>
      <path d='M44 8 l28 28 l0 -1.4 l-28 -28z' fill-opacity='0.09'/>
      <path d='M-8 88 l34 34 l0 -1.8 l-34 -34z' fill-opacity='0.10'/><path d='M88 88 l34 34 l0 -1.8 l-34 -34z' fill-opacity='0.10'/>
      <path d='M56 52 l22 22 l0 -1.1 l-22 -22z' fill-opacity='0.07'/>
    </g></svg>`),
  },
  kockice: {
    naziv: "Kockice d20", opis: "Znak kritičnog pogotka iz stonih igara", korak: 64,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><g fill='none' stroke='#fff' stroke-opacity='0.15' stroke-width='1.4' stroke-linejoin='round'><path d='M16 3L27.3 9.5L27.3 22.5L16 29L4.7 22.5L4.7 9.5Z'/><path d='M16 9.5L21.6 19.3L10.3 19.3Z'/><path d='M16 3L16 9.5M27.3 22.5L21.6 19.3M4.7 22.5L10.3 19.3'/></g><g transform='translate(32 32) scale(0.62)' fill='none' stroke='#fff' stroke-opacity='0.1' stroke-width='2.2' stroke-linejoin='round'><path d='M16 3L27.3 9.5L27.3 22.5L16 29L4.7 22.5L4.7 9.5Z'/><path d='M16 9.5L21.6 19.3L10.3 19.3Z'/></g></svg>`),
  },
  // Šestougaona mreža; najmirnija, dobra ispod fotografije. Ključ je bez naših
  // slova (API i CSS).
  sace: {
    naziv: "Saće", opis: "Šestougaona mreža, krupna i sitna u njoj", korak: 84,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='84' height='48'><g fill='none' stroke='#fff'>
      <g stroke-opacity='0.12' stroke-width='1.2'><path d='M21 1L42 13v24L21 49L0 37V13z'/><path d='M63 1L84 13v24L63 49L42 37V13z'/></g>
      <g stroke-opacity='0.055' stroke-width='0.9'><path d='M21 13L31 19v12l-10 6-10-6V19z'/><path d='M63 13L73 19v12l-10 6-10-6V19z'/></g>
    </g></svg>`),
  },
  // Munje.
  munje: {
    naziv: "Munje", opis: "Sitne munje, najživlja od svih šara", korak: 48,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><path d='M14 4L7 21h6l-3 13 12-19h-7l4-11z' fill='#fff' fill-opacity='0.14'/><path d='M37 27L32.5 38h3.8l-1.9 8.4L42 34h-4.5l2.5-7z' fill='#fff' fill-opacity='0.1'/></svg>`),
  },
  // Šara sa imenom igraonice se crta od naziva iz Podešavanja. Ključ ostaje
  // `crit` jer ga postojeće baze imaju upisanog.
  crit: {
    naziv: "Ime kuće", opis: "Naziv igraonice kao šara, najbrendiranije", korak: 96,
    saraOd: (ime) => {
      // Duga imena se smanjuju, ne skraćuju.
      const t = String(ime || "").toUpperCase().trim().slice(0, 14) || "?";
      const v = Math.max(9, Math.min(21, Math.round(126 / Math.max(t.length, 4))));
      return svg(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><text x='6' y='30' font-family='Segoe UI, Arial, sans-serif' font-size='${v}' font-weight='900' letter-spacing='2' fill='#fff' fill-opacity='0.11'>${escXml(t)}</text><text x='54' y='78' font-family='Segoe UI, Arial, sans-serif' font-size='${Math.round(v * 0.72)}' font-weight='900' letter-spacing='2' fill='#fff' fill-opacity='0.075' transform='rotate(-14 54 78)'>${escXml(t)}</text></svg>`);
    },
  },
  romb: {
    naziv: "Rombovi", opis: "Mirna dijagonalna šara, najdiskretnija", korak: 34,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34'><path d='M17 2l15 15-15 15L2 17z' fill='none' stroke='#fff' stroke-opacity='0.11' stroke-width='1.1'/></svg>`),
  },
  // Karbonsko tkanje: polja se smenjuju po pravcu i imaju svetlu ivicu.
  ugljenik: {
    naziv: "Ugljenik", opis: "Tkanje kao na gaming opremi, sitno i mirno", korak: 18,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><g fill='#fff'>
      <rect x='0' y='0' width='9' height='9' fill-opacity='0.055'/><rect x='9' y='9' width='9' height='9' fill-opacity='0.055'/>
      <rect x='9' y='0' width='9' height='9' fill-opacity='0.028'/><rect x='0' y='9' width='9' height='9' fill-opacity='0.028'/>
      <rect x='0' y='0' width='9' height='1.5' fill-opacity='0.075'/><rect x='9' y='9' width='9' height='1.5' fill-opacity='0.075'/>
      <rect x='9' y='0' width='1.5' height='9' fill-opacity='0.06'/><rect x='0' y='9' width='1.5' height='9' fill-opacity='0.06'/>
    </g></svg>`),
  },
  // Veze sa štampane ploče; glavne linije prelaze celu pločicu, da se spajaju sa
  // susednim.
  kolo: {
    naziv: "Kolo", opis: "Veze sa štampane ploče, tehnička i mirna", korak: 128,
    sara: svg(`<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'>
      <g fill='none' stroke='#fff' stroke-opacity='0.11' stroke-width='1.25' stroke-linecap='round' stroke-linejoin='round'>
        <path d='M0 34h128'/><path d='M96 0v128'/><path d='M0 96h44l16-16h36'/>
        <path d='M32 128V80l14-14h50'/><path d='M96 62l14-14h18'/><path d='M60 34v22'/>
      </g>
      <g fill='#fff' fill-opacity='0.15'><circle cx='96' cy='34' r='2.6'/><circle cx='60' cy='56' r='2'/>
        <circle cx='96' cy='80' r='2'/><circle cx='46' cy='66' r='1.7'/></g></svg>`),
  },
};
export const JACINE = { slabo: "Slabo", srednje: "Srednje", jako: "Jako" };
// Koliko se šara vidi.
export const PROZIRNOSTI = { slabo: 0.22, srednje: 0.42, jako: 0.7 };

// Kretanje šare, sporo jer stoji iza igara ceo dan. Brzina je u sekundama po
// jednoj pločici, pa je kretanje bez šava. Podrazumevano je "mirno".
export const KRETANJA = {
  mirno: { naziv: "Mirno", opis: "Šara stoji", sekundi: 0 },
  klizanje: { naziv: "Klizanje", opis: "Šara polako putuje po dijagonali", sekundi: 30 },
  talas: { naziv: "Talas", opis: "Svetlo prelazi preko šare, kao odsjaj", sekundi: 15 },
  dubina: { naziv: "Dubina", opis: "Dva sloja, bliži prati pokret miša", sekundi: 44 },
  // Nasumične figure zasvetle u boji kuće; šara stoji.
  iskre: { naziv: "Iskre", opis: "Pojedine figure zasvetle crveno pa se ugase", sekundi: 0 },
};
// Imena iz ranijih verzija, da sačuvan izbor ostane važeći.
const STARA_KRETANJA = { lagano: "klizanje", zivo: "klizanje" };

// Izbor u vrednosti za CSS, za kućnu i za igračevu šaru.
export function spremiTeksturu({ kljuc, jacina, kretanje } = {}) {
  const k = TEKSTURE[kljuc] ? kljuc : "nema";
  const j = JACINE[jacina] ? jacina : "srednje";
  const staro = STARA_KRETANJA[kretanje];
  const kr = KRETANJA[kretanje] ? kretanje : (staro || "mirno");
  // Bez šare se kretanje gasi.
  const radi = k !== "nema" && kr !== "mirno";
  const vazi = radi ? kr : "mirno";
  return {
    kljuc: k, jacina: j, kretanje: vazi,
    sara: saraTeksture(TEKSTURE[k]),
    prozirnost: k === "nema" ? 0 : PROZIRNOSTI[j],
    // Korak je veličina pločice: kretanje pomera šaru za tačno jednu pločicu.
    korak: TEKSTURE[k].korak || 0,
    sekundi: radi ? KRETANJA[vazi].sekundi : 0,
    // Šara u boji kuće, samo kad je kretanje "iskre".
    iskra: vazi === "iskre" ? iskraOd(saraTeksture(TEKSTURE[k])) : "",
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
  // Igrači sa svojom šarom je zadržavaju kad vlasnik promeni kućnu.
  for (const c of db.prepare("SELECT id, current_player_id FROM computers WHERE current_player_id IS NOT NULL").all()) {
    const t = temaIgraca(c.current_player_id);
    if (t) sendClient(c.id, { t: "tekstura", tekstura: t });
  }
}

// Šara igrača: važi dok je prijavljen.
export function temaIgraca(playerId) {
  const red = db.prepare("SELECT tema FROM players WHERE id=?").get(playerId);
  if (!red || !red.tema) return null;
  let t;
  try { t = JSON.parse(red.tema); } catch { return null; }
  if (!t || typeof t !== "object" || t.kljuc === "kuca") return null;
  return spremiTeksturu(t);
}

export function sacuvajTemuIgraca(playerId, { kljuc, jacina, kretanje } = {}) {
  // "kuca" vraća na šaru igraonice.
  if (kljuc === "kuca") {
    db.prepare("UPDATE players SET tema=NULL WHERE id=?").run(playerId);
    return { ok: true, tema: null, tekstura: teksturaObj() };
  }
  // Svoja šara se otključava na drugom nivou; provera je na serveru.
  if (!smeDa(db.prepare("SELECT xp FROM players WHERE id=?").get(playerId)?.xp, "sara")) {
    return { error: `Svoja šara se otključava na ${OTKLJUCAVANJA.sara.nivo}. nivou` };
  }
  if (!TEKSTURE[kljuc]) return { error: "Nepoznata tekstura" };
  if (jacina != null && !JACINE[jacina]) return { error: "Nepoznata jačina" };
  if (kretanje != null && !KRETANJA[kretanje] && !STARA_KRETANJA[kretanje]) return { error: "Nepoznato kretanje" };
  const t = spremiTeksturu({ kljuc, jacina, kretanje });
  db.prepare("UPDATE players SET tema=? WHERE id=?")
    .run(JSON.stringify({ kljuc: t.kljuc, jacina: t.jacina, kretanje: t.kretanje }), playerId);
  return { ok: true, tema: { kljuc: t.kljuc, jacina: t.jacina, kretanje: t.kretanje }, tekstura: t };
}

// Igračeva šara ako je ima, inače kućna.
export function teksturaZaRacunar(playerId) {
  return (playerId && temaIgraca(playerId)) || teksturaObj();
}

// Promo baneri (vrh početne u launcheru)
export function promoLista() {
  return db.prepare("SELECT * FROM promo ORDER BY sort, id").all();
}
// Samo ono što igrač vidi.
export function promoZaKlijenta() {
  return db.prepare("SELECT id, image, naziv FROM promo WHERE available = 1 ORDER BY sort, id").all();
}

export function dodajPromo(dataUrl, naziv) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return { error: "Neispravan format slike (PNG, JPG ili WEBP)" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) return { error: "Slika je prevelika (maksimum 8 MB)" };
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const dir = UPLOADS;
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
  obrisiSliku(p.image);
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

// Pomeranje gore/dole menja mesto sa susedom.
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

// Privremeni baneri: server ih crta kao SVG i upisuje direktno u uploads
// (provera otpremljenih slika prima samo raster).
function upisiSvg(prefix, svgTekst, staraPutanja) {
  const dir = UPLOADS;
  fs.mkdirSync(dir, { recursive: true });
  // Briše se samo prethodni generisan baner, ne slika koju je okačio vlasnik.
  if (staraPutanja && /\/uploads\/baner-/.test(staraPutanja)) {
    obrisiSliku(staraPutanja);
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

// Baner za svaku igru koja ga nema; okačeni baneri se ne diraju.
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
  const dir = UPLOADS;
  fs.mkdirSync(dir, { recursive: true });
  const fname = `promo-crit-${Date.now()}.svg`;
  fs.writeFileSync(path.join(dir, fname), svg, "utf8");
  const url = `/uploads/${fname}`;
  const zadnji = db.prepare("SELECT COALESCE(MAX(sort), 0) s FROM promo").get().s;
  const info = db.prepare("INSERT INTO promo (image, naziv, available, sort, created_at) VALUES (?,?,1,?,?)")
    .run(url, `${getSetting("cafe_name", "Igraonica")} (privremeni)`, zadnji + 1, Date.now());
  pushPromo();
  return { ok: true, id: info.lastInsertRowid, image: url };
}

// Daljinska instalacija programa
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
  const p = db.prepare("SELECT * FROM programs WHERE id=?").get(id);
  if (!p) return { error: "Program ne postoji" };
  name = String(name ?? p.name).trim(); url = String(url ?? p.url).trim();
  // Iste provere kao pri dodavanju.
  if (!name || !url) return { error: "Naziv i link su obavezni" };
  if (!/^https?:\/\//i.test(url)) return { error: "Link mora počinjati sa http:// ili https://" };
  db.prepare("UPDATE programs SET name=?, url=?, args=?, note=? WHERE id=?")
    .run(name, url, args ?? p.args ?? "", note ?? p.note ?? null, id);
  return { ok: true };
}
export function deleteProgram(id) {
  db.prepare("DELETE FROM programs WHERE id=?").run(id);
  return { ok: true };
}

// Stanje instalacije po računaru (u memoriji).
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
  const targets = ids && ids.length ? ids : db.prepare("SELECT id FROM computers WHERE obrisan IS NULL").all().map((r) => r.id);
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

// ---------- ISKUSTVO I PROFIL IGRAČA ----------
//
// Pravila nivoa su u nivoi.js; ovde je kada se iskustvo dodaje i šta se time
// otključava.

// Boje imena i okviri su u nivoi.js (nagrade po nivou); ovde se samo
// prosleđuju.
export { BOJE_IMENA, OKVIRI };

const profilIzBaze = (red) => {
  let p = {};
  try { p = JSON.parse(red?.profil || "{}") || {}; } catch { p = {}; }
  return {
    // VIP izbor ostaje zapisan i kad članarina istekne, i važi ponovo posle obnove.
    boja: BOJE_IMENA[p.boja] || vip.VIP_BOJE[p.boja] ? p.boja : "bela",
    okvir: OKVIRI[p.okvir] || vip.VIP_OKVIRI[p.okvir] ? p.okvir : "nema",
  };
};

// Iskustvo se dodaje pri potrošnji (vreme, piće sa kredita), ne pri dopuni,
// poklonjenom kreditu ni nagradi sa točka. Vraća { nivoPre, nivoPosle } kad se
// pređe nivo, inače null.
export function dodajXp(playerId, iznos) {
  const dodatak = Number(iznos);
  if (!playerId || !Number.isFinite(dodatak) || dodatak <= 0) return null;
  const red = db.prepare("SELECT xp, vip_do FROM players WHERE id=?").get(playerId);
  if (!red) return null;
  const pre = nivoZa(red.xp);
  const novo = xpPosleTrosenja(red, dodatak);
  db.prepare("UPDATE players SET xp=? WHERE id=?").run(novo, playerId);
  const posle = nivoZa(novo);
  return posle.nivo > pre.nivo ? { nivoPre: pre, nivoPosle: posle } : null;
}

// Iskustvo posle potrošnje, sa VIP množiocem. Samo račun: poslovi sa novcem
// iskustvo upisuju zajedno sa kreditom. Kroz ovo prolazi svaka potrošnja
// (vreme, piće, kasa, rad bez servera).
function xpPosleTrosenja(p, iznos) {
  const staro = Number(p?.xp) || 0;
  const dodatak = Number(iznos);
  if (!Number.isFinite(dodatak) || dodatak <= 0) return round2(staro);
  const mnozilac = vip.xpMnozilac(vip.vaziVip(p?.vip_do), Number(getSetting("vip_xp", vip.PODRAZUMEVANO.xpMnozilac)));
  return round2(staro + dodatak * mnozilac);
}

// Nov nivo se odmah javlja igraču na ekranu.
function javiNivo(playerId, prelaz) {
  if (!prelaz) return;
  const comp = db.prepare("SELECT id FROM computers WHERE current_player_id=?").get(playerId);
  if (comp) {
    sendClient(comp.id, {
      t: "nivo_gore",
      nivo: prelaz.nivoPosle.nivo,
      naziv: prelaz.nivoPosle.naziv,
      otkljucano: otkljucanoZa(prelaz.nivoPosle.xp).filter((o) => o.nivo === prelaz.nivoPosle.nivo),
    });
    sendClient(comp.id, { t: "vip", vip: vipZaIgraca(playerId) });
  }
  const ime = db.prepare("SELECT username FROM players WHERE id=?").get(playerId)?.username || `#${playerId}`;
  logEvent({ category: "igrac", action: "nivo", actor: "sistem", target: ime,
    detail: `Nivo ${prelaz.nivoPosle.nivo} - ${prelaz.nivoPosle.naziv}` });
}

// Dodaje iskustvo i javlja nov nivo.
export function zaradiXp(playerId, iznos) {
  javiNivo(playerId, dodajXp(playerId, iznos));
}

// Podaci za traku na vrhu početne.
export function vipZaIgraca(playerId) {
  const red = playerId ? db.prepare("SELECT xp, vip_do FROM players WHERE id=?").get(playerId) : null;
  return red ? vipOd(red.xp, red.vip_do) : null;
}

// Isto, bez čitanja iz baze (naplata već ima xp).
export function vipOd(xp, vipDo) {
  const n = nivoZa(xp);
  const jeVip = vip.vaziVip(vipDo);
  return {
    nivo: n.nivo, naziv: n.naziv,
    // Napredak unutar nivoa, ne od nule.
    xp: n.uNivou, xpDo: n.poslednji ? null : n.zaSledeci,
    poslednji: n.poslednji, sledeci: n.sledeciNaziv,
    // VIP se kupuje; važi do roka.
    vip: jeVip,
    vipDana: vip.danaOstalo(vipDo),
    mnozilac: vip.xpMnozilac(jeVip, Number(getSetting("vip_xp", vip.PODRAZUMEVANO.xpMnozilac))),
  };
}

// ---- VIP članarina ----
//
// Plaća se kreditom koji je gost već uplatio na kasi, samouslužno iz
// launchera.
export function vipObj() {
  return {
    ukljucen: getSetting("vip_ukljucen", "0") === "1",
    cena: Number(getSetting("vip_cena", vip.PODRAZUMEVANO.cena)) || 0,
    dana: Number(getSetting("vip_dana", vip.PODRAZUMEVANO.dana)) || vip.PODRAZUMEVANO.dana,
    xpMnozilac: Number(getSetting("vip_xp", vip.PODRAZUMEVANO.xpMnozilac)) || 1,
    tocakPrag: Number(getSetting("vip_tocak_prag", vip.PODRAZUMEVANO.tocakPrag)) || 0,
    pogodnosti: vip.POGODNOSTI,
  };
}

// Podešavanje VIP-a uz brojke prodaje za poslednjih 30 dana. Odvojeno od
// vipObj, koji se zove pri svakoj kupovini.
export function vipPregled() {
  const sada = Date.now();
  const aktivnih = db.prepare("SELECT COUNT(*) c FROM players WHERE vip_do > ? AND obrisan IS NULL").get(sada).c;
  // Trideset dana, kao i trajanje članarine.
  const od = sada - 30 * 86400000;
  const r = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(-amount),0) s FROM transactions WHERE type='vip' AND created_at > ?").get(od);
  return { ...vipObj(), aktivnih, prodato30: r.c, prihod30: round2(r.s) };
}

export function postaviVip({ ukljucen, cena, dana, xpMnozilac, tocakPrag }) {
  if (ukljucen != null) setSetting("vip_ukljucen", ukljucen ? "1" : "0");
  if (cena != null) {
    if (!ispravanIznos(cena) || Number(cena) < 0) return { error: "Cena mora biti broj veći ili jednak nuli" };
    setSetting("vip_cena", String(Number(cena)));
  }
  if (dana != null) {
    const d = Math.floor(Number(dana));
    if (!Number.isFinite(d) || d < 1 || d > 400) return { error: "Trajanje mora biti između 1 i 400 dana" };
    setSetting("vip_dana", String(d));
  }
  if (xpMnozilac != null) {
    const m = Number(xpMnozilac);
    // Množilac između 1 i 5.
    if (!Number.isFinite(m) || m < 1 || m > 5) return { error: "Množilac iskustva mora biti između 1 i 5" };
    setSetting("vip_xp", String(m));
  }
  if (tocakPrag != null) {
    if (!ispravanIznos(tocakPrag) || Number(tocakPrag) < 0) return { error: "Prag mora biti broj veći ili jednak nuli" };
    setSetting("vip_tocak_prag", String(Number(tocakPrag)));
  }
  return { ok: true, ...vipObj() };
}

// Kupovina iz launchera, kreditom igrača.
export function kupiVip(playerId) {
  const o = vipObj();
  if (!o.ukljucen) return { error: "VIP trenutno nije u ponudi." };
  const p = playerById(playerId);
  if (!p || p.obrisan) return { error: "Nepostojeći nalog." };
  if (o.cena <= 0) return { error: "Cena VIP-a nije podešena. Pozovi osoblje." };
  if (round2(Number(p.balance) || 0) < o.cena) {
    // Poruka kaže tačno koliko fali.
    const fali = Math.ceil(o.cena - (Number(p.balance) || 0));
    return { error: `Fali ti još ${fali} ${getSetting("currency", "RSD")}. Dopuni na kasi pa probaj ponovo.` };
  }
  let stanje, rok;
  try {
    // Naplata i rok su jedna transakcija.
    ({ stanje, rok } = uJednomPoslu(() => {
      const b = round2((Number(p.balance) || 0) - o.cena);
      const r = vip.novRok(p.vip_do, o.dana);
      db.prepare("UPDATE players SET balance=?, vip_do=? WHERE id=?").run(b, r, playerId);
      addTransaction(playerId, "vip", -o.cena, b, null, `VIP članarina ${o.dana} dana`);
      return { stanje: b, rok: r };
    }));
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `VIP nije upisan: ${String(e?.message || e).slice(0, 150)}` });
    return { error: "Kupovina nije prošla. Pokušaj ponovo." };
  }
  // Bez `amount`: u kategoriji "novac" amount je keš u kasi (obračun smene), a
  // VIP se plaća kreditom. Kretanje kredita je u `transactions` (tip "vip"),
  // odakle ga čitaju izveštaji.
  logEvent({ category: "novac", action: "vip", actor: p.username, target: p.username,
    detail: `Kupio VIP na ${o.dana} dana (${o.cena} sa kredita)` });
  const comp = db.prepare("SELECT id FROM computers WHERE current_player_id=?").get(playerId);
  if (comp) {
    sendClient(comp.id, { t: "balance", balance: stanje, remainingSeconds: remainingSeconds(stanje) });
    sendClient(comp.id, { t: "vip", vip: vipZaIgraca(playerId) });
    sendClient(comp.id, { t: "profil", profil: profilIgraca(playerId) });
  }
  pushComputers();
  return { ok: true, vipDo: rok, dana: vip.danaOstalo(rok), balance: stanje };
}

// "1 dan", "2 dana", "21 dan".
const oblikDana = (n) => (Math.abs(n) % 10 === 1 && Math.abs(n) % 100 !== 11 ? "dan" : "dana");

// VIP iz panela, za goste koji plaćaju kešom na kasi. Keš se vodi kao dopuna
// pa naplata članarine: stanje naloga se ne menja, dopuna ulazi u pazar
// smene, a naplata u promet VIP-a.
export function postaviVipIgracu(playerId, dana, ko, { naplati = 0, adminId = null } = {}) {
  const p = playerById(playerId);
  if (!p || p.obrisan) return { error: "Nepostojeći nalog." };
  const d = Math.floor(Number(dana));
  if (!Number.isFinite(d)) return { error: "Broj dana nije ispravan." };
  // 0 oduzima VIP odmah; negativan broj se ne prima.
  if (d < 0 || d > 400) return { error: "Broj dana mora biti između 0 i 400." };
  const kes = round2(Number(naplati) || 0);
  if (kes < 0) return { error: "Naplaćen iznos ne može biti negativan." };
  if (kes > 0 && d === 0) return { error: "Oduzimanje VIP-a se ne naplaćuje." };

  const rok = d === 0 ? null : vip.novRok(p.vip_do, d);
  let log = null;
  try {
    // Rok i novac su jedna transakcija.
    log = uJednomPoslu(() => {
      db.prepare("UPDATE players SET vip_do=? WHERE id=?").run(rok, playerId);
      if (kes <= 0) return null;
      const stanje = round2(Number(p.balance) || 0);
      addTransaction(playerId, "topup", kes, stanje, adminId, `Keš za VIP članarinu (${d} dana)`);
      addTransaction(playerId, "vip", -kes, stanje, adminId, `VIP članarina ${d} dana`);
      return upisiLog({ category: "novac", action: "topup", actor: ko || "sistem", target: p.username,
        detail: `Keš za VIP članarinu (${d} ${oblikDana(d)})`, amount: kes });
    });
  } catch (e) {
    logEvent({ category: "sistem", action: "greska", actor: "server",
      detail: `VIP iz panela nije upisan: ${String(e?.message || e).slice(0, 150)}` });
    return { error: "Upis nije prošao. Pokušaj ponovo - novac nije naplaćen." };
  }
  if (log) javiLog(log);
  logEvent({ category: "nalozi", action: d === 0 ? "vip_off" : "vip_on", actor: ko || "sistem", target: p.username,
    detail: d === 0 ? "Oduzet VIP" : `Dodat VIP na ${d} ${oblikDana(d)}${kes > 0 ? `, naplaćeno ${kes} kešom` : " (bez naplate)"}` });
  const comp = db.prepare("SELECT id FROM computers WHERE current_player_id=?").get(playerId);
  if (comp) {
    sendClient(comp.id, { t: "vip", vip: vipZaIgraca(playerId) });
    sendClient(comp.id, { t: "profil", profil: profilIgraca(playerId) });
  }
  pushComputers();
  return { ok: true, vipDo: rok, dana: vip.danaOstalo(rok), naplaceno: kes };
}

// ---- Rang lista ----
//
// Uz vrh ide i mesto igrača, dvojica iznad i ispod njega i koliko mu fali do
// sledećeg mesta. Rangira se po iskustvu, ne po potrošnji. Brzi gosti
// (gost-*) i blokirani se ne rangiraju.
const RANG_USLOV = "banned = 0 AND obrisan IS NULL AND username NOT LIKE 'gost-%'";

export function rangLista(playerId = null, koliko = 10) {
  const n = Math.min(50, Math.max(3, Math.floor(Number(koliko) || 10)));
  // Isti redosled u oba upita, do poslednjeg kriterijuma; kod jednakog
  // iskustva prvi je stariji nalog.
  const redosled = "ORDER BY xp DESC, created_at ASC, id ASC";
  const kolone = "id, username, display_name, xp, profil, vip_do, created_at";
  const red = (r, mesto) => ({
    mesto,
    ime: r.display_name || r.username,
    nivo: nivoZa(r.xp).nivo,
    naziv: nivoZa(r.xp).naziv,
    xp: Math.round(Number(r.xp) || 0),
    vip: vip.vaziVip(r.vip_do),
    izgled: profilIzBaze(r),
    ja: playerId != null && r.id === playerId,
  });

  const vrh = db.prepare(`SELECT ${kolone} FROM players WHERE ${RANG_USLOV} ${redosled} LIMIT ?`)
    .all(n).map((r, i) => red(r, i + 1));
  const ukupno = db.prepare(`SELECT COUNT(*) c FROM players WHERE ${RANG_USLOV}`).get().c;

  const ja = playerId != null
    ? db.prepare(`SELECT ${kolone}, banned FROM players WHERE id=?`).get(playerId)
    : null;
  // Nalog koji se ne rangira vidi listu bez sopstvenog mesta.
  const rangira = !!ja && !ja.banned && !/^gost-/.test(ja.username);
  if (!rangira) return { vrh, ukupno, ja: null, komsiluk: [] };

  // Mesto se dobija prebrojavanjem onih ispred; uslov prati redosled.
  const ispred = db.prepare(
    `SELECT COUNT(*) c FROM players WHERE ${RANG_USLOV}
     AND (xp > ? OR (xp = ? AND (created_at < ? OR (created_at = ? AND id < ?))))`
  ).get(ja.xp, ja.xp, ja.created_at, ja.created_at, ja.id).c;
  const mesto = ispred + 1;

  // Prvi ispred igrača (koliko mu fali do sledećeg mesta).
  const goreRed = db.prepare(
    `SELECT ${kolone} FROM players WHERE ${RANG_USLOV}
     AND (xp > ? OR (xp = ? AND (created_at < ? OR (created_at = ? AND id < ?))))
     ORDER BY xp ASC, created_at DESC, id DESC LIMIT 1`
  ).get(ja.xp, ja.xp, ja.created_at, ja.created_at, ja.id);

  // Susedi se preskaču kad je igrač u vrhu.
  let komsiluk = [];
  if (mesto > n) {
    const od = Math.max(0, mesto - 3);
    komsiluk = db.prepare(`SELECT ${kolone} FROM players WHERE ${RANG_USLOV} ${redosled} LIMIT 5 OFFSET ?`)
      .all(od).map((r, i) => red(r, od + i + 1));
  }

  return {
    vrh, ukupno, komsiluk,
    ja: { ...red(ja, mesto), doSledecegMesta: goreRed ? Math.max(0, Math.round(goreRed.xp - ja.xp)) : null,
      ispredMene: goreRed ? (goreRed.display_name || goreRed.username) : null },
  };
}

// Profil igrača.
export function profilIgraca(playerId) {
  const p = db.prepare("SELECT id, username, display_name, xp, profil, created_at, spinova, spin_dobitak, vip_do FROM players WHERE id=?").get(playerId);
  if (!p) return null;
  const n = nivoZa(p.xp);
  const jedan = (sql, ...a) => db.prepare(sql).get(...a) || {};

  // Sati se računaju iz troška sesija i cene, ne iz trajanja: cena se menjala,
  // a vreme bez naplate ne ulazi.
  const ukupno = jedan("SELECT COALESCE(SUM(cost),0) c, COUNT(*) n FROM sessions WHERE player_id=?", playerId);
  const cena = rate();
  const porudzbina = jedan("SELECT COUNT(*) n FROM orders WHERE player_id=? AND status<>'cancelled'", playerId);
  const omiljena = jedan(
    `SELECT g.name ime, COUNT(*) n FROM game_launches gl JOIN games g ON g.id=gl.game_id
     WHERE gl.player_id=? GROUP BY gl.game_id ORDER BY n DESC LIMIT 1`, playerId);

  const sati = cena > 0 ? round2(ukupno.c / cena) : 0;
  const stat = statistikaIgraca(p, { sati, poseta: ukupno.n || 0, porudzbina: porudzbina.n || 0 });

  return {
    username: p.username,
    ime: p.display_name || p.username,
    clanOd: p.created_at,
    nivo: n.nivo, naziv: n.naziv, xp: n.xp,
    uNivou: n.uNivou, zaSledeci: n.zaSledeci, doSledeceg: n.doSledeceg,
    poslednji: n.poslednji, sledeciNaziv: n.sledeciNaziv,
    sati,
    poseta: ukupno.n || 0,
    porudzbina: porudzbina.n || 0,
    omiljenaIgra: omiljena.ime || null,
    omiljenaPuta: omiljena.n || 0,
    izgled: profilIzBaze(p),
    otkljucano: otkljucanoZa(p.xp),
    // Spisak nosi i VIP izgled, označen, da se vidi šta članarina donosi.
    boje: { ...BOJE_IMENA, ...vip.VIP_BOJE }, okviri: { ...OKVIRI, ...vip.VIP_OKVIRI },
    // Stanje članarine: ponuda ili preostali dani.
    clanarina: (() => {
      const o = vipObj();
      const jeVip = vip.vaziVip(p.vip_do);
      return { ukljucen: o.ukljucen, jeVip, dana: vip.danaOstalo(p.vip_do),
        cena: o.cena, trajanje: o.dana, mnozilac: o.xpMnozilac,
        tocakPrag: o.tocakPrag, pogodnosti: o.pogodnosti };
    })(),
    // Rang lista stiže uz profil.
    rang: rangLista(playerId),
    // Značke i lični rekordi (znacke.js, statistikaIgraca).
    znacke: znackeZa(stat),
    grupeZnacaka: GRUPE,
    rekordi: {
      najduzaSesijaMin: stat.najduzaSesijaMin,
      najboljiDan: stat.najboljiDan,
      omiljenDan: stat.omiljenDan,
      razlicitihIgara: stat.razlicitihIgara,
      spinova: stat.spinova,
      dobitakUkupno: stat.dobitakUkupno,
      nedeljaZaredom: stat.nedeljaZaredom,
      omiljenoPice: stat.omiljenoPice,
      omiljenoPicePuta: stat.omiljenoPicePuta,
    },
  };
}

// Statistika za značke u nekoliko upita, ne po upit za svaku značku (profil
// se traži pri svakoj prijavi).
function statistikaIgraca(p, vec) {
  const jedan = (sql, ...a) => db.prepare(sql).get(...a) || {};
  const id = p.id;

  // Sat se vadi u lokalnom vremenu igraonice.
  const sesije = jedan(`
    SELECT
      MAX(COALESCE(ended_at, started_at) - started_at) najduza,
      SUM(CASE WHEN CAST(strftime('%H', started_at/1000, 'unixepoch', 'localtime') AS INTEGER) < 10 THEN 1 ELSE 0 END) rano,
      SUM(CASE WHEN CAST(strftime('%H', started_at/1000, 'unixepoch', 'localtime') AS INTEGER) >= 23 THEN 1 ELSE 0 END) kasno
    FROM sessions WHERE player_id=?`, id);

  // Dan u nedelji sa najviše poseta; 0 = nedelja, kao strftime('%w').
  const dan = jedan(`
    SELECT strftime('%w', started_at/1000, 'unixepoch', 'localtime') d, COUNT(*) n
    FROM sessions WHERE player_id=? GROUP BY d ORDER BY n DESC LIMIT 1`, id);

  // Najveća potrošnja u jednom danu.
  const najboljiDan = jedan(`
    SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') d, SUM(-amount) iznos
    FROM transactions WHERE player_id=? AND amount < 0
    GROUP BY d ORDER BY iznos DESC LIMIT 1`, id);

  const igre = jedan(`
    SELECT COUNT(DISTINCT game_id) razlicitih, COUNT(*) ukupno FROM game_launches WHERE player_id=?`, id);
  const najviseIgra = jedan(`
    SELECT COUNT(*) n FROM game_launches WHERE player_id=? GROUP BY game_id ORDER BY n DESC LIMIT 1`, id);
  const uKatalogu = jedan("SELECT COUNT(*) n FROM games");

  const najvisePice = jedan(`
    SELECT oi.name ime, SUM(oi.qty) n FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.player_id=? AND o.status<>'cancelled' GROUP BY oi.name ORDER BY n DESC LIMIT 1`, id);

  // Uzastopne nedelje sa bar jednom posetom, unazad od tekuće.
  const nedelje = db.prepare(`
    SELECT DISTINCT strftime('%Y-%W', started_at/1000, 'unixepoch', 'localtime') w
    FROM sessions WHERE player_id=? ORDER BY w DESC`).all(id).map((r) => r.w);
  const nedeljaSad = new Date();
  let zaredom = 0;
  for (let i = 0; i < 520; i++) {
    const d = new Date(nedeljaSad.getTime() - i * 7 * 86400000);
    if (!nedelje.includes(kljucNedelje(d))) { if (i === 0) continue; break; }
    zaredom++;
  }

  return {
    sati: vec.sati, poseta: vec.poseta, porudzbina: vec.porudzbina,
    najduzaSesijaMin: Math.round((Number(sesije.najduza) || 0) / 60000),
    ranoSesija: Number(sesije.rano) || 0,
    kasnaSesija: Number(sesije.kasno) || 0,
    omiljenDan: dan.d != null ? Number(dan.d) : null,
    najboljiDan: najboljiDan.iznos ? { datum: najboljiDan.d, iznos: round2(najboljiDan.iznos) } : null,
    razlicitihIgara: Number(igre.razlicitih) || 0,
    pokretanja: Number(igre.ukupno) || 0,
    najvisePutaIgra: Number(najviseIgra.n) || 0,
    igaraUKatalogu: Number(uKatalogu.n) || 0,
    najvisePutaArtikal: Number(najvisePice.n) || 0,
    omiljenoPice: najvisePice.ime || null,
    omiljenoPicePuta: Number(najvisePice.n) || 0,
    spinova: Number(p.spinova) || 0,
    dobitakUkupno: round2(Number(p.spin_dobitak) || 0),
    nedeljaZaredom: zaredom,
    danaOdUpisa: Math.floor((Date.now() - (Number(p.created_at) || Date.now())) / 86400000),
  };
}

// Ključ nedelje, isti kao SQLite-ov %W (nedelja počinje ponedeljkom, dani pre
// prvog ponedeljka su nedelja 00). Dan u godini se računa zaokruživanjem, jer
// dan prelaska na letnje vreme traje 23 sata.
export function kljucNedelje(ms) {
  const t = new Date(ms);
  const ponoc = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const danUGodini = Math.round((ponoc - new Date(t.getFullYear(), 0, 1)) / 86400000);
  const w = Math.floor((danUGodini + 7 - ((t.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-${String(w).padStart(2, "0")}`;
}

// Izgled profila se proverava na serveru (nivo, VIP).
export function sacuvajProfilIgraca(playerId, { boja, okvir } = {}) {
  const p = db.prepare("SELECT xp, profil, vip_do FROM players WHERE id=?").get(playerId);
  if (!p) return { error: "Nalog ne postoji" };
  const sad = profilIzBaze(p);
  const novo = { ...sad };
  const jeVip = vip.vaziVip(p.vip_do);

  if (boja != null) {
    const vipBoja = !!vip.VIP_BOJE[boja];
    if (!BOJE_IMENA[boja] && !vipBoja) return { error: "Nepoznata boja" };
    // VIP boje se ne zarađuju nivoom.
    if (vipBoja && !jeVip) return { error: "Ova boja ide uz VIP." };
    if (!vipBoja && boja !== "bela" && !smeDa(p.xp, "boja")) {
      return { error: `Boja imena se otključava na ${OTKLJUCAVANJA.boja.nivo}. nivou` };
    }
    novo.boja = boja;
  }
  if (okvir != null) {
    const vipOkvir = !!vip.VIP_OKVIRI[okvir];
    if (!OKVIRI[okvir] && !vipOkvir) return { error: "Nepoznat okvir" };
    if (vipOkvir && !jeVip) return { error: "Ovaj okvir ide uz VIP." };
    if (!vipOkvir && okvir !== "nema" && !smeDa(p.xp, "okvir")) {
      return { error: `Okvir se otključava na ${OTKLJUCAVANJA.okvir.nivo}. nivou` };
    }
    novo.okvir = okvir;
  }
  db.prepare("UPDATE players SET profil=? WHERE id=?").run(JSON.stringify(novo), playerId);
  return { ok: true, izgled: novo };
}

// ---------- NADOGRADNJA LAUNCHERA ----------
//
// Pravila su u nadogradnja.js; ovde je kome se i kada šalje.

// Nadograđuje se samo računar koji je na vezi, nije zauzet i nema sesiju:
// stanje "idle" (ekran prijave) ili "locked".
function smeNadogradnju(c) {
  if (!isClientOnline(c.id)) return false;
  if (c.current_session_id) return false;
  return c.status === "idle" || c.status === "locked";
}

// Posle najave se čeka, da se ne pokrene drugo preuzimanje preko prvog.
const nadogradnjaPoslato = new Map(); // computerId -> { verzija, ts }
const NADOGRADNJA_PAUZA = 10 * 60 * 1000;

// Stanje nadogradnje po računaru, za panel.
const nadogradnjaStatus = new Map(); // computerId -> { verzija, state, message, ts }

export function nadogradnjaStanje() {
  const st = nad.stanje();
  const racunari = db.prepare("SELECT * FROM computers WHERE obrisan IS NULL ORDER BY id").all().map((c) => {
    const v = c.launcher_version || null;
    const stara = (c.launcher_numeracija || 0) < nad.NUMERACIJA;
    return {
      id: c.id,
      name: c.name,
      verzija: v,
      online: isClientOnline(c.id),
      slobodan: smeNadogradnju(c),
      // Launcher iz stare numeracije (ili koji se nije javio) ide ručno.
      staraNumeracija: stara,
      zaostaje: st.ima ? (stara || !v || nad.uporediVerzije(v, st.verzija) < 0) : false,
      status: nadogradnjaStatus.get(c.id) || null,
    };
  });
  return {
    ...st,
    fajlovi: nad.listaFajlova(),
    racunari,
    zaostalih: racunari.filter((r) => r.zaostaje).length,
    rucno: racunari.filter((r) => r.staraNumeracija).length,
    zaAutomatski: racunari.filter((r) => r.zaostaje && !r.staraNumeracija).length,
  };
}

// Najava za računar. Adresu preuzimanja launcher sklapa sam (vidi main.js).
function najava(st) {
  return { t: "nadogradnja", verzija: st.verzija, numeracija: nad.NUMERACIJA, sha256: st.sha256, velicina: st.velicina };
}

export function posaljiNadogradnju(ids, actor = "vlasnik", automatski = false) {
  const st = nad.stanje();
  if (!st.ima) return { error: "Nema instalatera na serveru" };
  if (!st.pusteno) return { error: "Ta verzija nije puštena u rad" };

  const svi = db.prepare("SELECT * FROM computers WHERE obrisan IS NULL ORDER BY id").all();
  const trazeni = ids && ids.length ? svi.filter((c) => ids.includes(c.id)) : svi;
  let poslato = 0, zauzeto = 0, vecImaju = 0, rucno = 0;
  for (const c of trazeni) {
    const v = c.launcher_version || null;
    // Stara numeracija ide ručno.
    if ((c.launcher_numeracija || 0) < nad.NUMERACIJA) { rucno++; continue; }
    if (v && nad.uporediVerzije(v, st.verzija) >= 0) { vecImaju++; continue; }
    if (!smeNadogradnju(c)) { zauzeto++; continue; }
    const ranije = nadogradnjaPoslato.get(c.id);
    if (ranije && ranije.verzija === st.verzija && Date.now() - ranije.ts < NADOGRADNJA_PAUZA) continue;
    if (!sendClient(c.id, najava(st))) { zauzeto++; continue; }
    nadogradnjaPoslato.set(c.id, { verzija: st.verzija, ts: Date.now() });
    nadogradnjaStatus.set(c.id, { verzija: st.verzija, state: "poslato", message: "Poslato", ts: Date.now() });
    poslato++;
  }
  if (poslato) {
    broadcastPanels({ t: "nadogradnja" });
    logEvent({ category: "racunar", action: "nadogradnja", actor,
      detail: `Nadogradnja na ${st.verzija} poslata na ${poslato} računara` +
        (zauzeto ? ` (${zauzeto} zauzeto ili offline)` : "") + (automatski ? " (automatski)" : "") });
  }
  return { ok: true, poslato, zauzeto, vecImaju, rucno };
}

// Računari se nadograđuju čim se oslobode. Jedna periodična provera pokriva
// sve puteve (kraj sesije, zaključavanje, povratak posle restarta).
export function nadogradnjaTick() {
  const st = nad.stanje();
  if (!st.ima || !st.pusteno) return;
  posaljiNadogradnju(null, "sistem", true);
}

function clientNadogradnjaStatus(computerId, msg) {
  const stanje = String(msg.state || "").slice(0, 20);
  const st = { verzija: String(msg.verzija || "").slice(0, 20), state: stanje, message: String(msg.message || "").slice(0, 200), ts: Date.now() };
  nadogradnjaStatus.set(computerId, st);
  broadcastPanels({ t: "nadogradnja" });
  if (stanje === "greska") {
    // Posle greške računar sme odmah ponovo, bez pauze.
    nadogradnjaPoslato.delete(computerId);
    logEvent({ category: "racunar", action: "nadogradnja_greska", actor: "sistem", target: compName(computerId),
      detail: `Nadogradnja nije uspela: ${st.message}` });
  }
  if (stanje === "instaliram") {
    logEvent({ category: "racunar", action: "nadogradnja_start", actor: "sistem", target: compName(computerId),
      detail: `Instalira launcher ${st.verzija}` });
  }
}

// Uspeh se potvrđuje kad se računar vrati i javi novom verzijom.
function nadogradnjaPoPovratku(comp, verzija, numeracija) {
  const cekao = nadogradnjaStatus.get(comp.id);
  if (!cekao || !verzija) return;
  if (numeracija !== nad.NUMERACIJA) return;
  if (nad.uporediVerzije(verzija, cekao.verzija) < 0) return;
  nadogradnjaStatus.set(comp.id, { verzija, state: "gotovo", message: "Nadogradnja uspela", ts: Date.now() });
  nadogradnjaPoslato.delete(comp.id);
  logEvent({ category: "racunar", action: "nadogradnja_gotovo", actor: "sistem", target: comp.name,
    detail: `Launcher nadograđen na ${verzija}` });
}

// Wake-on-LAN
// Launcher javlja mrežne kartice; bira se MAC kartice čija IP adresa odgovara
// onoj koju server vidi (LAN, ne VPN).
function normalizeMac(mac) {
  const hex = String(mac || "").replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12 || /^0+$/.test(hex)) return null;
  return hex.toUpperCase().match(/.{2}/g).join(":");
}
function clientSysInfo(computerId, msg) {
  // Launcher javlja da li mu je servisni PIN još fabrički; panel to prikazuje
  // po računaru. Stariji launcher ovo ne šalje, i tada se poznato stanje ne
  // menja.
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
  // Kartica čija IP adresa odgovara onoj koju server vidi.
  let chosen = (c && c.ip && nics.find((n) => n.ip === c.ip)) || nics[0];
  const mac = normalizeMac(chosen && chosen.mac);
  if (!mac || (c && c.mac === mac)) return;
  db.prepare("UPDATE computers SET mac=? WHERE id=?").run(mac, computerId);
  pushComputers();
}
// Magic packet: 6 x 0xFF, pa 16 puta MAC (102 bajta).
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
      // WoL portovi 9 i 7, na broadcast adresu.
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
  const rows = db.prepare("SELECT * FROM computers WHERE obrisan IS NULL AND mac IS NOT NULL AND mac <> '' ORDER BY name").all();
  let sent = 0;
  for (const c of rows) if (await sendWol(c.mac)) sent++;
  logEvent({ category: "racunar", action: "wake_all", actor: actor || "sistem", detail: `Signal za paljenje poslat na ${sent}/${rows.length} računara` });
  return { ok: true, sent, total: rows.length };
}

// Keš otvorene smene iz baze (posle restarta servera).
activeShiftId = getActiveShift()?.id ?? null;
