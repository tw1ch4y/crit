import express from "express";
import { db, getSetting, setSetting, randomToken } from "./db.js";
import * as odrz from "./odrzavanje.js";
const backupDb = odrz.backupDb;
import fs from "node:fs";
import { verifyPassword, issueAdminToken, revokeAdminToken, requireAdmin, requireOwner, requireServiser } from "./auth.js";
import * as nadg from "./nadogradnja.js";
import * as svc from "./service.js";
import { SEME_HTTP, proveriTelo } from "./seme.js";
import { zabelezi, poslednjiZapisi, NIVO } from "./bezbednost.js";
import * as knjiga from "./knjiga.js";

// Ko je uradio, za glavnu knjigu: UVEK iz tokena, nikad iz tela zahteva.
const ko = (req) => knjiga.radnik(req.admin.adminId, req.admin.username);

export const router = express.Router();

// ---------- PROVERA ULAZA ----------
//
// Telo zahteva prolazi kroz semu (seme.js) pre nego sto ga ruta procita.
// Odbijanje ide u bezbednosni dnevnik: panel nikad ne salje objekat umesto
// broja niti nepoznatu komandu, pa takav zahtev nije napravio panel.
const telo = (sema) => proveriTelo(sema, (req, greske) => {
  zabelezi({ vrsta: "zahtev_neispravan", nivo: NIVO.upozorenje, igrac: req.admin?.username || null,
    ip: String(req.socket?.remoteAddress || "").replace(/^::ffff:/, ""),
    kljuc: `zahtev|${req.admin?.username || req.ip}|${req.method} ${req.route?.path || req.path}`,
    opis: `${req.method} ${req.path}: telo zahteva ne odgovara očekivanom (${greske.map((g) => g.polje).join(", ")})`,
    podaci: { greske } });
});

// Broj u adresi (/players/:id, /computers/:id/...) je pozitivan ceo broj. Sve
// ostalo je greska u pozivu - ranije je Number("abc") postajao NaN i isao u upit.
const BROJ_U_ADRESI = /^[1-9][0-9]{0,14}$/;
for (const ime of ["id", "pid"]) {
  router.param(ime, (req, res, next, v) => {
    if (!BROJ_U_ADRESI.test(String(v))) return res.status(400).json({ error: "Neispravan broj u adresi" });
    next();
  });
}

const pName = (id) => db.prepare("SELECT username FROM players WHERE id=?").get(id)?.username || `#${id}`;
const cName = (id) => db.prepare("SELECT name FROM computers WHERE id=?").get(id)?.name || `#${id}`;

// ---------- AUTH ----------
router.post("/login", telo(SEME_HTTP.prijava), (req, res) => {
  const { username, password } = req.body || {};
  const ime = String(username || "").trim();
  // Kljuc je racunar + ime naloga: jedan racunar ne moze da mlati jedan nalog,
  // a osoblje sa druge masine i dalje moze da se prijavi dok to traje.
  const kljuc = `panel:${req.ip}|${ime.toLowerCase()}`;
  const pauza = svc.kocnica.ceka(kljuc);
  if (pauza) return res.status(429).json({ error: `Previše pokušaja. Sačekajte ${pauza} s.` });

  // Ugasen nalog se ponasa kao da ne postoji: ista poruka, ista pauza. Kad bi
  // pisalo "nalog je ugasen", otpusten radnik bi znao da je ime jos ispravno i
  // da treba samo da ga neko vrati.
  const admin = db.prepare("SELECT * FROM admins WHERE username = ? AND active = 1").get(ime);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    const cekaj = svc.kocnica.promasaj(kljuc);
    // Cim se zakljuca, odmah se i kaze - da osoblje ne dobije obicnu gresku pa
    // ga tek sledeci pokusaj iznenadi pauzom. Isto radi i prijava igraca.
    if (cekaj) {
      svc.logEvent({ category: "prijava", action: "panel_login_fail", actor: "sistem", target: ime || "(prazno)",
        detail: `Više pogrešnih prijava na panel sa ${req.ip} - pauza ${cekaj} s` });
      return res.status(429).json({ error: `Previše pokušaja. Sačekajte ${cekaj} s.` });
    }
    return res.status(401).json({ error: "Pogrešno korisničko ime ili lozinka" });
  }
  svc.kocnica.pogodak(kljuc);
  const token = issueAdminToken(admin);
  svc.logEvent({ category: "prijava", action: "panel_login", actor: admin.username, detail: "Prijava na panel" });
  res.json({ token, admin: { id: admin.id, username: admin.username, role: admin.role } });
});

router.post("/logout", requireAdmin, (req, res) => {
  const h = req.headers["authorization"];
  if (h?.startsWith("Bearer ")) revokeAdminToken(h.slice(7));
  res.json({ ok: true });
});

router.get("/me", requireAdmin, (req, res) => res.json({ admin: req.admin }));

// Sve ispod zahteva admin token
router.use(requireAdmin);

// promena sopstvene lozinke (radnik i vlasnik)
router.post("/me/password", telo(SEME_HTTP.mojaLozinka), (req, res) => {
  const r = svc.changeOwnPassword(req.admin.adminId, req.body?.oldPassword, req.body?.newPassword);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "self_pw", actor: req.admin.username, detail: "Promenio sopstvenu lozinku" });
  res.json(r);
});

// ---------- RADNICI / ADMINI (samo vlasnik) ----------
router.get("/admins", requireOwner, (req, res) => res.json(svc.listAdmins()));
router.post("/admins", requireOwner, telo(SEME_HTTP.noviRadnik), (req, res) => {
  const r = svc.createAdmin(req.body || {}, req.admin);
  if (r.error) return res.status(400).json(r);
  const ULOGA_NAZIV = { serviser: "serviser", owner: "vlasnik", staff: "radnik" };
  svc.logEvent({ category: "nalozi", action: "admin_create", actor: req.admin.username, target: req.body?.username, detail: `Kreiran ${ULOGA_NAZIV[req.body?.role] || "radnik"} nalog` });
  res.json(r);
});
router.post("/admins/:id/password", requireOwner, telo(SEME_HTTP.lozinka), (req, res) => {
  const r = svc.updateAdminPassword(Number(req.params.id), req.body?.password, req.admin);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "admin_pw", actor: req.admin.username, detail: "Reset lozinke radniku" });
  res.json(r);
});
router.delete("/admins/:id", requireOwner, (req, res) => {
  const ko = db.prepare("SELECT username FROM admins WHERE id=?").get(Number(req.params.id))?.username || "";
  const r = svc.deleteAdmin(Number(req.params.id), req.admin.adminId, req.admin);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: r.ugasen ? "admin_off" : "admin_delete", actor: req.admin.username,
    target: ko, detail: r.ugasen ? `Ugašen nalog ${ko} - pristup oduzet, smene i promet ostaju zapisani` : `Obrisan nalog ${ko}` });
  res.json(r);
});
router.post("/admins/:id/vrati", requireOwner, (req, res) => {
  const ko = db.prepare("SELECT username FROM admins WHERE id=?").get(Number(req.params.id))?.username || "";
  const r = svc.vratiAdmin(Number(req.params.id), req.admin);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "admin_on", actor: req.admin.username, target: ko,
    detail: `Vraćen nalog ${ko}` });
  res.json(r);
});

// ---------- LOGOVI (samo vlasnik) ----------
router.get("/logs", requireOwner, (req, res) => {
  if (req.query.page) {
    return res.json(svc.logsPage({ category: req.query.category, search: req.query.search, page: req.query.page, per: req.query.per }));
  }
  res.json(svc.getLogs({ category: req.query.category, search: req.query.search, limit: req.query.limit }));
});

// ---------- GLAVNA KNJIGA (samo vlasnik) ----------
// Svaka promena kredita i keša u kasi, sa stanjem pre i posle - vidi knjiga.js.
router.get("/audit", requireOwner, (req, res) => {
  const q = req.query;
  res.json(knjiga.zapisi({
    playerId: q.player ?? null, shiftId: q.smena ?? null, tip: q.tip ?? null, racun: q.racun ?? null,
    od: q.od ?? null, doKada: q.do ?? null, page: q.page, per: q.per,
  }));
});
// Provera lanca: da li se svaki red nastavlja na prethodni i da li se kredit
// na nalozima poklapa sa knjigom. Ne menja nista.
router.get("/audit/provera", requireOwner, (req, res) => {
  res.json(knjiga.proveri({ playerId: req.query.player != null ? Number(req.query.player) : null }));
});

// ---------- BEZBEDNOSNI DOGADJAJI (samo vlasnik) ----------
// Poslednji zapisi iz memorije; ceo trag je u data/bezbednost.jsonl.
router.get("/bezbednost", requireOwner, (req, res) => {
  const nivo = ["info", "upozorenje", "kriticno"].includes(req.query.nivo) ? req.query.nivo : null;
  const vrsta = typeof req.query.vrsta === "string" ? req.query.vrsta.slice(0, 60) : null;
  res.json(poslednjiZapisi({ limit: req.query.limit, nivo, vrsta }));
});

// ---------- SNAPSHOT ----------
router.get("/snapshot", (req, res) => {
  res.json({
    computers: svc.computersSnapshot(),
    orders: svc.ordersSnapshot(),
    players: svc.playersSnapshot(),
    settings: svc.settingsObj(),
    role: req.admin.role,
    shift: svc.activeShiftInfo(),
    vanSmene: svc.novacVanSmene(),
    brend: svc.brendObj(),
    zalihe: svc.zaliheNaIzmaku(),
  });
});

router.get("/zalihe", (req, res) => res.json(svc.zaliheNaIzmaku()));

// ---------- POZADINE EKRANA U LAUNCHERU ----------
router.get("/pozadine", requireOwner, (req, res) => res.json({ spisak: svc.POZADINE, slike: svc.pozadineObj() }));
router.post("/pozadine/:kljuc", requireOwner, (req, res) => {
  const r = svc.savePozadinu(req.params.kljuc, req.body?.image);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "pozadina", actor: req.admin.username, target: req.params.kljuc, detail: "Postavljena pozadina ekrana" });
  res.json(r);
});
// ---------- TEKSTURA POZADINE ----------
router.get("/tekstura", requireOwner, (req, res) =>
  res.json({ spisak: svc.teksturaSpisak(), jacine: svc.JACINE, kretanja: svc.KRETANJA,
    izbor: svc.teksturaObj(), prozirnosti: svc.PROZIRNOSTI }));
router.post("/tekstura", requireOwner, (req, res) => {
  const r = svc.saveTeksturu(req.body?.kljuc, req.body?.jacina, req.body?.kretanje);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "tekstura", actor: req.admin.username,
    target: r.kljuc, detail: `Tekstura pozadine: ${svc.TEKSTURE[r.kljuc].naziv} (${svc.JACINE[r.jacina].toLowerCase()})` });
  res.json(r);
});

// ---------- PROMO BANERI ----------
router.get("/promo", requireOwner, (req, res) => res.json(svc.promoLista()));
router.post("/promo", requireOwner, (req, res) => {
  const r = svc.dodajPromo(req.body?.image, req.body?.naziv);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "promo", actor: req.admin.username, target: req.body?.naziv || `#${r.id}`, detail: "Dodat promo baner" });
  res.json(r);
});
// Privremeni CRIT promo baner - dok pravi promo materijal ne stigne.
router.post("/promo/crit", requireOwner, (req, res) => {
  const r = svc.napraviPromoCrit();
  svc.logEvent({ category: "podesavanja", action: "promo", actor: req.admin.username, target: "CRIT", detail: "Napravljen privremeni CRIT baner" });
  res.json(r);
});
router.post("/promo/:id/vidljivost", requireOwner, (req, res) => {
  const r = svc.promoVidljivost(Number(req.params.id), !!req.body?.vidljiv);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
router.post("/promo/:id/pomeri", requireOwner, (req, res) => {
  const r = svc.pomeriPromo(Number(req.params.id), req.body?.smer === "gore" ? "gore" : "dole");
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
router.delete("/promo/:id", requireOwner, (req, res) => {
  const r = svc.obrisiPromo(Number(req.params.id));
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "promo", actor: req.admin.username, target: `#${req.params.id}`, detail: "Obrisan promo baner" });
  res.json(r);
});

router.delete("/pozadine/:kljuc", requireOwner, (req, res) => {
  const r = svc.removePozadinu(req.params.kljuc);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "pozadina", actor: req.admin.username, target: req.params.kljuc, detail: "Uklonjena pozadina ekrana" });
  res.json(r);
});

// ---------- SMENE ----------
router.get("/shift", (req, res) => res.json(svc.activeShiftInfo()));
router.post("/shift/open", telo(SEME_HTTP.otvoriSmenu), (req, res) => {
  const r = svc.openShift(req.admin.adminId, req.admin.username, req.body?.openingCash);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
router.post("/shift/close", telo(SEME_HTTP.zatvoriSmenu), (req, res) => {
  const r = svc.closeShift(req.admin.username, req.body?.closingCash, req.admin.adminId);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
router.get("/shifts", requireOwner, (req, res) => res.json(svc.shiftsList(req.query.limit)));
router.get("/shifts/:id", requireOwner, (req, res) => {
  const d = svc.shiftDetail(Number(req.params.id));
  if (!d) return res.status(404).json({ error: "Smena ne postoji" });
  res.json(d);
});
router.post("/shifts/:id/napomena", requireOwner, telo(SEME_HTTP.napomenaSmene), (req, res) => {
  const r = svc.zabeleziUzSmenu(Number(req.params.id), req.body?.note);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "sistem", action: "shift_note", actor: req.admin.username,
    target: `smena #${req.params.id}`, detail: r.note ? `Napomena uz smenu: ${r.note}` : "Obrisana napomena uz smenu" });
  res.json(r);
});

// ---------- IGRAČI ----------
// Bez ?page vraća ceo niz (koristi POS/kasa za izbor igrača); sa ?page vraća stranicu.
router.get("/players", (req, res) => {
  if (req.query.page) {
    return res.json(svc.playersPage({ page: req.query.page, per: req.query.per, search: req.query.search }));
  }
  res.json(svc.playersSnapshot());
});

router.post("/players", telo(SEME_HTTP.noviIgrac), (req, res) => {
  const r = svc.createPlayer({ ...(req.body || {}), operator: ko(req) });
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "player_create", actor: req.admin.username, target: req.body?.username, detail: `Kreiran nalog igrača${Number(req.body?.balance) > 0 ? `, kredit ${Number(req.body.balance)}` : ""}`, amount: Number(req.body?.balance) || null });
  res.json(r);
});

router.post("/players/guests", telo(SEME_HTTP.gosti), (req, res) => {
  const r = svc.createGuests(req.body?.count, req.body?.balance, ko(req));
  if (r.error) return res.status(400).json(r);
  const imena = r.players.map((p) => p.username).join(", ");
  svc.logEvent({
    category: "nalozi", action: "player_create", actor: req.admin.username, target: imena,
    detail: `Otvoreni gostujući nalozi (${r.players.length})${Number(req.body?.balance) > 0 ? `, kredit ${Number(req.body.balance)} po nalogu` : ""}`,
    amount: Number(req.body?.balance) > 0 ? Number(req.body.balance) * r.players.length : null,
  });
  res.json(r);
});

router.get("/players/guests/spremni", requireOwner, (req, res) => res.json(svc.guestsToClean()));
router.post("/players/guests/ocisti", requireOwner, (req, res) => {
  const r = svc.cleanGuests(ko(req));
  if (r.obrisano) {
    svc.logEvent({ category: "nalozi", action: "player_delete", actor: req.admin.username, target: r.imena.join(", "), detail: `Očišćeni potrošeni gostujući nalozi (${r.obrisano})` });
  }
  res.json(r);
});

// Zapis u logove pravi sam servis, u istom poslu sa novcem - vidi topUpPlayer.
router.post("/players/:id/topup", telo(SEME_HTTP.dopuna), (req, res) => {
  const id = Number(req.params.id);
  const amt = Number(req.body?.amount);
  const r = svc.topUpPlayer(id, amt, req.admin.adminId, req.body?.note, req.admin.username);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// ---------- VREMENSKI PAKETI ----------
router.get("/paketi", (req, res) => res.json(svc.paketiLista()));
router.post("/paketi", requireOwner, telo(SEME_HTTP.paket), (req, res) => {
  const r = svc.kreirajPaket(req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "paket", actor: req.admin.username, target: req.body?.name, detail: "Dodat vremenski paket" });
  res.json(r);
});
router.put("/paketi/:id", requireOwner, telo(SEME_HTTP.paket), (req, res) => {
  const r = svc.izmeniPaket(Number(req.params.id), req.body || {});
  if (r.error === "Paket ne postoji") return res.status(404).json(r);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "paket", actor: req.admin.username, target: req.body?.name, detail: "Izmenjen vremenski paket" });
  res.json(r);
});
router.delete("/paketi/:id", requireOwner, (req, res) => {
  const r = svc.obrisiPaket(Number(req.params.id));
  if (r.error) return res.status(404).json(r);
  svc.logEvent({ category: "podesavanja", action: "paket", actor: req.admin.username, target: `#${req.params.id}`, detail: "Obrisan vremenski paket" });
  res.json(r);
});
// Prodaja paketa igraču - novac koji uđe se vodi kao dopuna (pazar smene).
// Zapis u logove pravi sam servis, u istom poslu sa novcem - vidi prodajPaket.
router.post("/players/:id/paket", telo(SEME_HTTP.prodajaPaketa), (req, res) => {
  const id = Number(req.params.id);
  const r = svc.prodajPaket(id, Number(req.body?.paketId), req.admin.adminId, req.admin.username);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// ---------- NAGRADNI TOČAK (podešavanje) ----------
router.get("/tocak", requireOwner, (req, res) => res.json(svc.tocakConfig()));
router.post("/tocak", requireOwner, telo(SEME_HTTP.tocak), (req, res) => {
  const r = svc.postaviTocak(req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "tocak", actor: req.admin.username, detail: `Točak: ${r.ukljucen ? "uključen" : "isključen"}, prag ${r.prag}` });
  res.json(r);
});
router.post("/tocak/nagrade", requireOwner, telo(SEME_HTTP.nagrada), (req, res) => {
  const r = svc.dodajNagradu(req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "tocak", actor: req.admin.username, target: req.body?.naziv, detail: "Dodata nagrada na točak" });
  res.json(r);
});
router.put("/tocak/nagrade/:id", requireOwner, telo(SEME_HTTP.nagrada), (req, res) => {
  const r = svc.izmeniNagradu(Number(req.params.id), req.body || {});
  if (r.error === "Nagrada ne postoji") return res.status(404).json(r);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
router.delete("/tocak/nagrade/:id", requireOwner, (req, res) => {
  const r = svc.obrisiNagradu(Number(req.params.id));
  if (r.error) return res.status(404).json(r);
  res.json(r);
});

router.post("/players/:id/password", telo(SEME_HTTP.lozinka), (req, res) => {
  const id = Number(req.params.id);
  const r = svc.resetPlayerPassword(id, req.body?.password);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "player_pw", actor: req.admin.username, target: pName(id), detail: "Reset lozinke igraču" });
  res.json(r);
});

router.post("/players/:id/ban", telo(SEME_HTTP.blokada), (req, res) => {
  const id = Number(req.params.id);
  const banned = !!req.body?.banned;
  const r = svc.setPlayerBanned(id, banned);
  svc.logEvent({ category: "nalozi", action: banned ? "ban" : "unban", actor: req.admin.username, target: pName(id), detail: banned ? "Blokiran nalog" : "Odblokiran nalog" });
  res.json(r);
});

router.put("/players/:id", telo(SEME_HTTP.izmenaIgraca), (req, res) => {
  const id = Number(req.params.id);
  const r = svc.updatePlayer(id, req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "player_edit", actor: req.admin.username, target: pName(id), detail: "Izmenjeni podaci naloga" });
  res.json(r);
});

router.delete("/players/:id", requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const nm = pName(id);
  const r = svc.deletePlayer(id, ko(req));
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "player_delete", actor: req.admin.username, target: nm, detail: "Trajno obrisan nalog igrača" });
  res.json(r);
});

router.get("/players/:id/transactions", (req, res) => {
  const rows = db
    .prepare("SELECT type, amount, balance_after, note, created_at FROM transactions WHERE player_id = ? ORDER BY created_at DESC LIMIT 100")
    .all(Number(req.params.id));
  res.json(rows);
});

// ---------- RAČUNARI ----------
router.get("/computers", (req, res) => {
  // status iz snapshota (offline se računa po živoj konekciji, ne po koloni u bazi)
  const tokens = new Map(db.prepare("SELECT id, token FROM computers").all().map((r) => [r.id, r.token]));
  res.json(svc.computersSnapshot().map((c) => ({
    id: c.id, name: c.name, status: c.status, online: c.online,
    ip: c.ip, mac: c.mac, verzija: c.verzija, pinFabricki: c.pinFabricki, lastSeen: c.lastSeen, token: tokens.get(c.id),
  })));
});

router.post("/computers", requireOwner, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Naziv je obavezan" });
  try {
    const info = db.prepare("INSERT INTO computers (name, token, status) VALUES (?,?, 'offline')").run(name, "pc-" + randomToken());
    svc.logEvent({ category: "racunar", action: "add", actor: req.admin.username, target: name, detail: "Dodat računar" });
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch {
    res.status(400).json({ error: "Naziv već postoji" });
  }
});

// grupno dodavanje: obezbedi da postoji ukupno N računara (PC-01..PC-N)
router.post("/computers/bulk", requireOwner, (req, res) => {
  const target = Math.max(1, Math.min(200, Number(req.body?.count) || 1));
  const existing = new Set(db.prepare("SELECT name FROM computers").all().map((r) => r.name));
  let added = 0;
  for (let n = 1; n <= target; n++) {
    const name = `PC-${String(n).padStart(2, "0")}`;
    if (!existing.has(name)) {
      db.prepare("INSERT INTO computers (name, token, status) VALUES (?,?, 'offline')").run(name, "pc-" + randomToken());
      added++;
    }
  }
  if (added) svc.logEvent({ category: "racunar", action: "bulk_add", actor: req.admin.username, detail: `Dodato ${added} računara` });
  res.json({ ok: true, added });
});

router.delete("/computers/:id", requireOwner, (req, res) => {
  const nm = cName(Number(req.params.id));
  db.prepare("DELETE FROM computers WHERE id=?").run(Number(req.params.id));
  svc.logEvent({ category: "racunar", action: "delete", actor: req.admin.username, target: nm, detail: "Obrisan računar" });
  res.json({ ok: true });
});

router.put("/computers/:id", requireOwner, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Naziv je obavezan" });
  try {
    db.prepare("UPDATE computers SET name=? WHERE id=?").run(name, Number(req.params.id));
    svc.logEvent({ category: "racunar", action: "rename", actor: req.admin.username, target: name, detail: "Preimenovan računar" });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "Naziv već postoji" });
  }
});

router.post("/computers/:id/lock", (req, res) => {
  const id = Number(req.params.id);
  const r = svc.lockComputer(id, req.admin.adminId);
  svc.logEvent({ category: "racunar", action: "lock", actor: req.admin.username, target: cName(id), detail: "Zaključan računar" });
  res.json(r);
});
router.post("/computers/:id/unlock", (req, res) => {
  const id = Number(req.params.id);
  const r = svc.unlockComputer(id, req.admin.adminId);
  svc.logEvent({ category: "racunar", action: "unlock", actor: req.admin.username, target: cName(id), detail: "Otključan računar" });
  res.json(r);
});
router.post("/computers/:id/logout", (req, res) => {
  const id = Number(req.params.id);
  const r = svc.forceLogout(id, req.admin.adminId);
  svc.logEvent({ category: "racunar", action: "force_logout", actor: req.admin.username, target: cName(id), detail: "Osoblje odjavilo igrača" });
  res.json(r);
});
router.post("/computers/:id/message", telo(SEME_HTTP.porukaRacunaru), (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.text || "");
  const r = svc.sendMessageToComputer(id, text);
  svc.logEvent({ category: "racunar", action: "message", actor: req.admin.username, target: cName(id), detail: `Poruka: ${text}` });
  res.json(r);
});
router.post("/computers/:id/command", telo(SEME_HTTP.komanda), (req, res) => {
  const id = Number(req.params.id);
  const cmd = String(req.body?.cmd || "");
  const r = svc.sendCommand(id, cmd);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "racunar", action: "command", actor: req.admin.username, target: cName(id), detail: `Komanda: ${cmd}` });
  res.json(r);
});

// DALJINSKI TASK MANAGER: radnik sa glavnog računara vidi šta radi na izabranoj
// mašini i gasi zaglavljen program, bez ustajanja od kase.
router.get("/computers/:id/procesi", async (req, res) => {
  const r = await svc.procesiRacunara(Number(req.params.id));
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
router.post("/computers/:id/procesi/:pid/ugasi", async (req, res) => {
  const id = Number(req.params.id);
  const r = await svc.ugasiProcesNaRacunaru(id, req.params.pid, req.admin.username);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// Wake-on-LAN: paljenje računara preko mreže (magic packet)
router.post("/computers/wake-all", async (req, res) => {
  const r = await svc.wakeAll(req.admin.username);
  res.json(r);
});
router.post("/computers/:id/wake", async (req, res) => {
  const r = await svc.wakeComputer(Number(req.params.id), req.admin.username);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// grupna akcija
router.post("/computers-action", telo(SEME_HTTP.grupnaAkcija), (req, res) => {
  const { ids, action } = req.body || {};
  if (!action) return res.status(400).json({ error: "Akcija je obavezna" });
  const r = svc.bulkAction(ids, action);
  svc.logEvent({ category: "racunar", action: "bulk", actor: req.admin.username, detail: `Grupna akcija "${action}" na ${r.sent} računara` });
  res.json(r);
});

// ---------- PORUDŽBINE ----------
router.get("/orders", (req, res) => res.json(svc.ordersSnapshot(req.query.all === "1")));
router.post("/orders/:id/status", telo(SEME_HTTP.statusPorudzbine), (req, res) => {
  // logovanje radi servis (zna iznos i da li je otkazivanje)
  const r = svc.setOrderStatus(Number(req.params.id), req.body?.status, req.admin.username, req.admin.adminId);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// POS: radnik ručno kuca porudžbinu
router.post("/pos", telo(SEME_HTTP.kasa), (req, res) => {
  const r = svc.createPosOrder({ ...(req.body || {}), actor: req.admin.username, adminId: req.admin.adminId });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// ---------- SHOP ----------
router.get("/shop", (req, res) => res.json(svc.shopList()));
const parseStock = (v) => (v === "" || v == null ? null : Math.max(0, Math.floor(Number(v)) || 0));
// Artikal sa negativnom cenom bi pri porudžbini DODAVAO kredit igraču, pa se
// takva cena ne pušta u bazu ni preko kucanja ni preko izmene.
const cenaOk = (v) => svc.ispravanIznos(v) && Number(v) >= 0;
router.post("/shop", requireOwner, (req, res) => {
  const { category, price, emoji, stock } = req.body || {};
  const name = String(req.body?.name ?? "").trim();
  if (!name || price == null) return res.status(400).json({ error: "Naziv i cena su obavezni" });
  if (!cenaOk(price)) return res.status(400).json({ error: "Cena mora biti broj veći ili jednak nuli" });
  const info = db.prepare("INSERT INTO shop_items (name, category, price, emoji, stock) VALUES (?,?,?,?,?)")
    .run(name, category || "Ostalo", Number(price), emoji || "", parseStock(stock));
  svc.logEvent({ category: "podesavanja", action: "shop_add", actor: req.admin.username, target: name, detail: `Dodat artikal, cena ${Number(price)}` });
  svc.pushCatalog();
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put("/shop/:id", requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const it = db.prepare("SELECT * FROM shop_items WHERE id=?").get(id);
  if (!it) return res.status(404).json({ error: "Artikal ne postoji" });
  const { category, price, emoji, available, stock } = req.body || {};
  const name = String(req.body?.name ?? it.name).trim();
  if (!name) return res.status(400).json({ error: "Naziv je obavezan" });
  const cena = price == null ? it.price : Number(price);
  if (!cenaOk(cena)) return res.status(400).json({ error: "Cena mora biti broj veći ili jednak nuli" });
  db.prepare("UPDATE shop_items SET name=?, category=?, price=?, emoji=?, available=?, stock=? WHERE id=?")
    .run(name, category ?? it.category ?? "Ostalo", cena, emoji ?? it.emoji ?? "",
      available === undefined ? it.available : (available ? 1 : 0),
      stock === undefined ? it.stock : parseStock(stock), id);
  svc.logEvent({ category: "podesavanja", action: "shop_edit", actor: req.admin.username, target: name, detail: `Izmenjen artikal, cena ${cena}` });
  svc.pushCatalog();
  res.json({ ok: true });
});
// brza dopuna zaliha (dodaje na trenutno stanje)
router.post("/shop/:id/stock", requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const add = Math.floor(Number(req.body?.add) || 0);
  const it = db.prepare("SELECT name, stock FROM shop_items WHERE id=?").get(id);
  if (!it) return res.status(404).json({ error: "Artikal ne postoji" });
  // DOPUNA NULOM NE SME DA RASPRODA ARTIKAL.
  //
  // Neograničen artikal (stock = NULL) se ovom rutom prvi put stavlja pod
  // brojanje: base je 0, pa "dopuni +10" daje 10. Ali zahtev bez ispravnog
  // broja - pogrešno ime polja, prazno polje, tekst umesto broja - daje add = 0,
  // pa je isti taj artikal postajao 0 komada, to jest RASPRODAT. Piće bi
  // nestalo iz launchera bez ijedne poruke, a niko ne bi znao zašto.
  if (!add) return res.status(400).json({ error: "Unesi koliko komada dodaješ (ili oduzimaš)" });
  const base = it.stock == null ? 0 : it.stock;
  const next = Math.max(0, base + add);
  db.prepare("UPDATE shop_items SET stock=? WHERE id=?").run(next, id);
  svc.logEvent({ category: "podesavanja", action: "shop_stock", actor: req.admin.username, target: it.name, detail: `Dopuna zaliha ${add >= 0 ? "+" : ""}${add}, novo stanje ${next}` });
  svc.pushCatalog();
  res.json({ ok: true, stock: next });
});
router.post("/shop/:id/image", requireOwner, (req, res) => {
  const r = svc.saveShopImage(Number(req.params.id), req.body?.image);
  if (r.error) return res.status(400).json(r);
  svc.pushCatalog();
  res.json(r);
});
router.delete("/shop/:id/image", requireOwner, (req, res) => {
  const r = svc.removeShopImage(Number(req.params.id));
  svc.pushCatalog();
  res.json(r);
});
router.delete("/shop/:id", requireOwner, (req, res) => {
  svc.deleteShopItem(Number(req.params.id));
  svc.logEvent({ category: "podesavanja", action: "shop_delete", actor: req.admin.username, detail: "Obrisan artikal iz shopa" });
  svc.pushCatalog();
  res.json({ ok: true });
});

// ---------- IGRE ----------
router.get("/games", (req, res) => res.json(svc.gamesList()));
// Kopiranje putanje iz Explorera cesto ponese razmak ili navodnike - onda igra
// "nece da se pokrene" a razlog se ne vidi.
const ocistiPutanju = (v) => String(v ?? "").trim().replace(/^"|"$/g, "").trim();
// Razmak ispred imena se ne vidi u polju, a igra zbog njega skoci na pocetak
// police i postane izdvojena na pocetnoj strani. Tako je " Team Fortress 2"
// zavrsio kao naslovna igra u igraonici.
const ocistiIme = (v) => String(v ?? "").trim();
// Kad polje ne dodje u zahtevu, ostaje ono sto je vec u bazi. Ranije se pisalo
// undefined, sto SQLite ne prima - server je vracao 500 sa celim stack trace-om
// umesto poruke koju panel ume da prikaze.
const iliStaro = (novo, staro, podrazumevano = "") => novo ?? staro ?? podrazumevano;
const vidljivost = (v, staro) => (v === false ? 0 : v === true ? 1 : staro);

router.post("/games", requireOwner, (req, res) => {
  const { args, emoji, category, available } = req.body || {};
  const p = ocistiPutanju(req.body?.path);
  const name = ocistiIme(req.body?.name);
  if (!name || !p) return res.status(400).json({ error: "Naziv i putanja su obavezni" });
  const info = db.prepare("INSERT INTO games (name, path, args, emoji, category, available) VALUES (?,?,?,?,?,?)")
    .run(name, p, args || "", emoji || "", category || "Igre", available === false ? 0 : 1);
  svc.logEvent({ category: "podesavanja", action: "game_add", actor: req.admin.username, target: name, detail: "Dodata igra" });
  svc.pushCatalog();
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put("/games/:id", requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const g = db.prepare("SELECT * FROM games WHERE id=?").get(id);
  // Izmena necega sto ne postoji je greska u pozivu, ne uspeh. Kad server na to
  // kaze "ok", panel javi "Sacuvano" a nista nije sacuvano.
  if (!g) return res.status(404).json({ error: "Igra ne postoji" });
  const { args, emoji, category, available } = req.body || {};
  const p = ocistiPutanju(req.body?.path ?? g.path);
  const name = ocistiIme(req.body?.name ?? g.name);
  if (!name) return res.status(400).json({ error: "Naziv je obavezan" });
  if (!p) return res.status(400).json({ error: "Putanja je obavezna" });
  db.prepare("UPDATE games SET name=?, path=?, args=?, emoji=?, category=?, available=? WHERE id=?")
    .run(name, p, iliStaro(args, g.args), iliStaro(emoji, g.emoji), iliStaro(category, g.category, "Igre"),
      vidljivost(available, g.available), id);
  svc.logEvent({ category: "podesavanja", action: "game_edit", actor: req.admin.username, target: name, detail: `Izmenjena igra${available === false ? " (sakrivena)" : ""}` });
  svc.pushCatalog();
  res.json({ ok: true });
});
router.post("/games/:id/image", requireOwner, (req, res) => {
  const r = svc.saveGameImage(Number(req.params.id), req.body?.image);
  if (r.error) return res.status(400).json(r);
  svc.pushCatalog();
  res.json(r);
});
router.delete("/games/:id/image", requireOwner, (req, res) => {
  const r = svc.removeGameImage(Number(req.params.id));
  svc.pushCatalog();
  res.json(r);
});
router.post("/games/:id/banner", requireOwner, (req, res) => {
  const r = svc.saveGameBanner(Number(req.params.id), req.body?.image);
  if (r.error) return res.status(400).json(r);
  svc.pushCatalog();
  res.json(r);
});
router.delete("/games/:id/banner", requireOwner, (req, res) => {
  const r = svc.removeGameBanner(Number(req.params.id));
  svc.pushCatalog();
  res.json(r);
});
// Privremeni, generisani baner - dok pravi dizajn ne stigne.
router.post("/games/:id/banner-auto", requireOwner, (req, res) => {
  const r = svc.napraviBanerIgre(Number(req.params.id));
  if (r.error) return res.status(404).json(r);
  svc.logEvent({ category: "podesavanja", action: "game_edit", actor: req.admin.username, detail: "Napravljen privremeni baner igre" });
  res.json(r);
});
router.post("/games/banneri-auto", requireOwner, (req, res) => {
  const r = svc.napraviBaneriSvimIgrama();
  svc.logEvent({ category: "podesavanja", action: "game_edit", actor: req.admin.username, detail: `Napravljeni privremeni baneri (${r.koliko})` });
  res.json(r);
});
router.delete("/games/:id", requireOwner, (req, res) => {
  svc.removeAllGameImages(Number(req.params.id));
  db.prepare("DELETE FROM games WHERE id=?").run(Number(req.params.id));
  svc.logEvent({ category: "podesavanja", action: "game_delete", actor: req.admin.username, detail: "Obrisana igra" });
  svc.pushCatalog();
  res.json({ ok: true });
});

// ---------- ALATI / PREČICE (Internet sekcija launchera) ----------
router.get("/tools", (req, res) => res.json(svc.toolsList()));
router.post("/tools", requireOwner, (req, res) => {
  const r = svc.createTool(req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "tool_add", actor: req.admin.username, target: req.body?.name, detail: `Dodat alat (${req.body?.kind === "app" ? "program" : "sajt"})` });
  svc.pushCatalog();
  res.json(r);
});
router.put("/tools/:id", requireOwner, (req, res) => {
  const r = svc.updateTool(Number(req.params.id), req.body || {});
  // "Ne postoji" nije ista greska kao "pogresno popunjeno" - panel na 404 zna
  // da mu je spisak zastareo i da treba da se osvezi.
  if (r.error === "Alat ne postoji") return res.status(404).json(r);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "tool_edit", actor: req.admin.username, target: req.body?.name, detail: "Izmenjen alat" });
  svc.pushCatalog();
  res.json(r);
});
router.post("/tools/:id/image", requireOwner, (req, res) => {
  const r = svc.saveToolImage(Number(req.params.id), req.body?.image);
  if (r.error) return res.status(400).json(r);
  svc.pushCatalog();
  res.json(r);
});
router.delete("/tools/:id/image", requireOwner, (req, res) => {
  const r = svc.removeToolImage(Number(req.params.id));
  svc.pushCatalog();
  res.json(r);
});
router.post("/tools/reorder", requireOwner, (req, res) => {
  const r = svc.reorderTools(req.body?.ids);
  svc.pushCatalog();
  res.json(r);
});
router.delete("/tools/:id", requireOwner, (req, res) => {
  svc.deleteTool(Number(req.params.id));
  svc.logEvent({ category: "podesavanja", action: "tool_delete", actor: req.admin.username, detail: "Obrisan alat" });
  svc.pushCatalog();
  res.json({ ok: true });
});

// ---------- PROGRAMI / DALJINSKA INSTALACIJA (samo vlasnik) ----------
router.get("/programs", requireOwner, (req, res) => res.json(svc.programsList()));
router.post("/programs", requireOwner, (req, res) => {
  const r = svc.createProgram(req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "program_add", actor: req.admin.username, target: req.body?.name, detail: "Dodat program u biblioteku" });
  res.json(r);
});
router.put("/programs/:id", requireOwner, (req, res) => res.json(svc.updateProgram(Number(req.params.id), req.body || {})));
router.delete("/programs/:id", requireOwner, (req, res) => { svc.deleteProgram(Number(req.params.id)); res.json({ ok: true }); });
router.get("/install-status", requireOwner, (req, res) => res.json(svc.getInstallStatus()));
router.delete("/install-status", requireOwner, (req, res) => res.json(svc.clearInstallStatus()));
router.post("/install", requireOwner, telo(SEME_HTTP.instalacija), (req, res) => {
  const { ids, programId, name, url, args } = req.body || {};
  let prog;
  if (programId) { prog = db.prepare("SELECT * FROM programs WHERE id=?").get(Number(programId)); if (!prog) return res.status(400).json({ error: "Program ne postoji" }); }
  else prog = { name, url, args };
  if (!prog.name || !prog.url) return res.status(400).json({ error: "Naziv i link su obavezni" });
  res.json(svc.sendInstall(ids, prog, req.admin.username));
});

// ---------- PODEŠAVANJA ----------
router.get("/settings", (req, res) => {
  const s = svc.settingsObj();
  // "Vlasnik jos uvek ima admin/admin" je uputstvo kako da mu se udje u nalog, a
  // iz tog naloga se kredit upisuje bez ikakve kocnice. Radniku to ne treba.
  if (req.admin.role !== "owner") delete s.fabrickaLozinka;
  res.json(s);
});
router.post("/settings", requireOwner, telo(SEME_HTTP.podesavanja), (req, res) => {
  const map = { cafeName: "cafe_name", currency: "currency", ratePerHour: "rate_per_hour", unlockPin: "unlock_pin", idleMinutes: "idle_minutes", servisniPin: "servisni_pin" };
  // Negativna cena po satu bi igračima DODAVALA kredit dok sede, a negativno
  // mirovanje bi ih odjavljivalo odmah - oba se odbijaju pre upisa.
  const brojevi = { ratePerHour: "Cena po satu", idleMinutes: "Odjava zbog mirovanja" };
  // U bazu ide PROVERENA vrednost, ne ono što je stiglo u zahtevu. Ranije je
  // provera radila nad Number(...) a upisivala se sirova vrednost, pa je
  // ratePerHour: true prolazilo kao ispravno i završavalo kao NULL u bazi -
  // a to tiho gasi naplatu svima, bez ijedne greške.
  const zaUpis = {};
  for (const [k, dbKey] of Object.entries(map)) {
    const sirovo = req.body?.[k];
    if (sirovo == null) continue;
    if (typeof sirovo === "object") return res.status(400).json({ error: `${k}: neispravna vrednost` });
    if (brojevi[k]) {
      const v = Number(sirovo);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${brojevi[k]}: unesi broj veći ili jednak nuli` });
      zaUpis[dbKey] = v;
    } else {
      zaUpis[dbKey] = String(sirovo).trim();
    }
  }
  const changed = [];
  for (const [k, dbKey] of Object.entries(map)) {
    if (dbKey in zaUpis) { setSetting(dbKey, zaUpis[dbKey]); changed.push(k); }
  }
  svc.logEvent({ category: "podesavanja", action: "settings", actor: req.admin.username, detail: `Izmenjena podešavanja: ${changed.join(", ")}` });
  // Nov servisni PIN mora da stigne do launchera ODMAH, dok vlasnik gleda u
  // ekran - inače bi važio tek posle restarta svakog računara, a niko ne bi
  // znao kada je to bilo. Strana Računari odmah pokazuje ko ga je primio.
  if (changed.includes("servisniPin")) svc.posaljiServisniPin();
  res.json({ ok: true, settings: svc.settingsObj() });
});

// ---------- SERVER INFO / BACKUP (vlasnik) ----------
router.get("/server-info", requireOwner, (req, res) => res.json(svc.serverInfo()));
router.get("/kopije", requireOwner, (req, res) => res.json(svc.listaKopija()));

// Preuzimanje kopije da vlasnik moze da je odnese van racunara (USB, mejl).
router.get("/kopije/:fajl", requireOwner, (req, res) => {
  const p = svc.putanjaKopije(req.params.fajl);
  if (!p) return res.status(404).json({ error: "Kopija ne postoji" });
  svc.logEvent({ category: "sistem", action: "backup_download", actor: req.admin.username, target: req.params.fajl, detail: "Preuzeta rezervna kopija" });
  res.download(p);
});

router.post("/backup", requireOwner, (req, res) => {
  const dest = backupDb();
  if (!dest) {
    // Najčešći razlog nije greška u programu nego pun disk - to treba i da piše.
    const s = odrz.stanjeSkladista();
    return res.status(500).json({ error: s.maloMesta
      ? `Nema dovoljno mesta na disku (slobodno ${s.slobodnoMB} MB). Oslobodi prostor pa pokušaj ponovo.`
      : "Backup nije uspeo" });
  }
  svc.logEvent({ category: "sistem", action: "backup", actor: req.admin.username, detail: "Ručno napravljena rezervna kopija baze" });
  res.json({ ok: true });
});

// ---------- KOPIJA VAN RAČUNARA (vlasnik) ----------
//
// Baza i sve rezervne kopije stoje na istom disku. Kad taj disk otkaže, nestaje
// i jedno i drugo - zato odredište van računara (USB, drugi disk, mrežni
// folder) nije luksuz nego jedina zaštita od te jedne greške.
router.get("/kopija-van", requireOwner, (req, res) => res.json(odrz.kopijaVanPodesavanja()));
router.post("/kopija-van", requireOwner, (req, res) => {
  const r = odrz.postaviKopijuVan(req.body?.putanja);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "kopija_van", actor: req.admin.username,
    detail: r.putanja ? `Kopija van računara: ${r.putanja}` : "Kopija van računara isključena" });
  // Prva kopija ide odmah, da vlasnik istog trena vidi da odredište radi.
  if (r.putanja) odrz.kopirajVanRacunara();
  res.json(odrz.kopijaVanPodesavanja());
});
router.post("/kopija-van/sada", requireOwner, (req, res) => {
  const r = odrz.kopirajVanRacunara();
  if (r.error) return res.status(500).json({ error: `Kopiranje nije uspelo (${r.error}). Proveri da li je disk priključen.` });
  if (r.preskoceno) return res.status(400).json({ error: `Preskočeno: ${r.preskoceno}` });
  svc.logEvent({ category: "sistem", action: "kopija_van", actor: req.admin.username,
    detail: `Kopija odneta van računara: ${r.fajl} -> ${r.cilj}` });
  res.json({ ok: true, ...odrz.kopijaVanPodesavanja() });
});

// ---------- NADOGRADNJA LAUNCHERA ----------
//
// Vlasnik VIDI stanje i sme da pogura nadogradnju na slobodne racunare.
// Sta ce se uopste deliti bira SERVISER - on je taj koji je instalater i
// napravio, i jedini koji moze da zna da li je ispravan.
router.get("/nadogradnja", requireOwner, (req, res) => res.json(svc.nadogradnjaStanje()));

router.post("/nadogradnja/pusti", requireServiser, (req, res) => {
  const r = nadg.pusti(req.body?.verzija);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "racunar", action: "nadogradnja_pustena", actor: req.admin.username,
    detail: `Verzija ${r.verzija} puštena u rad - računari je preuzimaju čim se oslobode` });
  // Ko je vec slobodan ne mora da ceka sledecu proveru.
  svc.nadogradnjaTick();
  res.json(svc.nadogradnjaStanje());
});

router.post("/nadogradnja/povuci", requireServiser, (req, res) => {
  nadg.povuci();
  svc.logEvent({ category: "racunar", action: "nadogradnja_povucena", actor: req.admin.username,
    detail: "Nadogradnja povučena - računari je više ne preuzimaju" });
  res.json(svc.nadogradnjaStanje());
});

router.post("/nadogradnja/posalji", requireOwner, telo(SEME_HTTP.nadogradnjaPosalji), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
  const r = svc.posaljiNadogradnju(ids, req.admin.username);
  if (r.error) return res.status(400).json(r);
  res.json({ ...r, ...svc.nadogradnjaStanje() });
});

// PRENOS INSTALATERA U KOMADIMA, NE U MEMORIJI.
//
// Instalater je oko sto megabajta. Da ide kroz express.json, ceo bi se pre
// upisa skupio u memoriji servera - a taj server u igraonici deli racunar sa
// bazom i naplatom. Zato telo zahteva ide pravo u fajl, komad po komad.
router.put("/nadogradnja/fajl", requireServiser, (req, res) => {
  const r = nadg.putanjaZaUpis(req.query?.ime);
  if (r.error) return res.status(400).json(r);
  const izlaz = fs.createWriteStream(r.privremena);
  let pukao = false;
  const propalo = (poruka) => {
    if (pukao) return;
    pukao = true;
    try { izlaz.destroy(); } catch {}
    try { fs.unlinkSync(r.privremena); } catch {}
    if (!res.headersSent) res.status(400).json({ error: poruka });
  };
  req.on("aborted", () => propalo("Prenos je prekinut"));
  req.on("error", (e) => propalo("Prenos nije uspeo: " + e.message));
  izlaz.on("error", (e) => propalo("Upis nije uspeo: " + e.message));
  req.pipe(izlaz);
  izlaz.on("finish", () => {
    if (pukao) return;
    // Prazan fajl je prekinut prenos koji se zavrsio "uredno".
    let st;
    try { st = fs.statSync(r.privremena); } catch { return propalo("Fajl nije sačuvan"); }
    if (!st.size) return propalo("Stigao je prazan fajl");
    try { fs.renameSync(r.privremena, r.konacna); } catch (e) { return propalo("Premeštanje nije uspelo: " + e.message); }
    svc.logEvent({ category: "racunar", action: "nadogradnja_fajl", actor: req.admin.username,
      detail: `Postavljen instalater ${r.ime} (${Math.round(st.size / 1048576)} MB)` });
    res.json(svc.nadogradnjaStanje());
  });
});

router.delete("/nadogradnja/fajl", requireServiser, (req, res) => {
  const r = nadg.obrisi(req.query?.ime);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "racunar", action: "nadogradnja_brisanje", actor: req.admin.username,
    detail: `Obrisan instalater ${req.query.ime}` });
  res.json(svc.nadogradnjaStanje());
});


// ---------- SKLADIŠTE / ODRŽAVANJE (vlasnik) ----------
router.get("/skladiste", requireOwner, (req, res) => res.json(odrz.stanjeSkladista()));
router.post("/skladiste", requireOwner, (req, res) => {
  const granice = odrz.upisiPodesavanja(req.body || {});
  svc.logEvent({ category: "podesavanja", action: "odrzavanje", actor: req.admin.username,
    detail: `Granice čuvanja: logovi ${granice.logDana} dana / ${granice.logNajvise} zapisa, kopije do ${granice.kopijeMB} MB` });
  res.json(granice);
});
router.post("/skladiste/ocisti", requireOwner, (req, res) => {
  const r = odrz.odrzavanje(svc.getActiveShift()?.id ?? null);
  const obrisano = r.logovi.poStarosti + r.logovi.poBroju + r.pokretanja;
  svc.logEvent({ category: "sistem", action: "odrzavanje", actor: req.admin.username,
    detail: `Ručno čišćenje: obrisano ${obrisano} zapisa i ${r.kopije.obrisano} rezervnih kopija` });
  res.json(r);
});

// ---------- STATISTIKA (vlasnik) ----------
router.get("/stats", requireOwner, (req, res) => {
  const now = Date.now();
  const period = req.query.period || "today";
  let from, to = now;
  if (period === "week") from = now - 7 * 86400000;
  else if (period === "month") from = now - 30 * 86400000;
  else { const d = new Date(); d.setHours(0, 0, 0, 0); from = d.getTime(); }
  if (req.query.from) from = Number(req.query.from);
  if (req.query.to) to = Number(req.query.to);
  res.json({ period, from, to, ...svc.stats(from, to) });
});

// ---------- IZVEŠTAJ (danas) ----------
router.get("/report", (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  // PROMET DANAS MORA DA VIDI I ONE KOJI TRENUTNO IGRAJU.
  //
  // Trošak sesije se u `transactions` upisuje tek kad se sesija ZAVRŠI. Dok se
  // gledalo samo tamo, kontrolna tabla u osam uveče nije brojala nikoga ko je za
  // računarom: sa deset zauzetih mašina po dva sata to je oko 2400 dinara koje
  // vlasnik ne vidi, pa mu veče izgleda slabo dok je u stvari puno.
  //
  // Zato se dodaje i ono što je do sada nateklo aktivnim sesijama. Kad se takva
  // sesija završi, njen zapis stigne sa PUNIM iznosom i istim datumom, pa brojka
  // ne poskoči - ovo je isto ono što bi ionako ušlo, samo ranije.
  const zavrsene = db.prepare("SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE type='session' AND created_at>=?").get(from).s;
  const uToku = db.prepare("SELECT COALESCE(SUM(cost),0) s FROM sessions WHERE status='active'").get().s;
  const sessionRevenue = zavrsene + uToku;

  // OTKAZANO NIJE PRODATO.
  //
  // Ovde se ranije brojalo sve, pa je otkazana porudžbina ostajala u prometu
  // zauvek: keš zato što se filter po statusu nije ni pisao, a kupovina sa
  // naloga zato što se čitala iz `transactions`, gde povraćaj ulazi kao zaseban
  // red tipa `refund` i original ne poništava. Obračun smene i Izveštaji su
  // otkazano oduvek izbacivali - kontrolna tabla je jedina pokazivala više.
  const shopRevenue = db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment='credit' AND status!='cancelled' AND created_at>=?").get(from).s;
  const cashRevenue = db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment='cash' AND status!='cancelled' AND created_at>=?").get(from).s;
  const topups = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='topup' AND created_at>=?").get(from).s;
  const activeSessions = db.prepare("SELECT COUNT(*) c FROM sessions WHERE status='active'").get().c;
  const playersCount = db.prepare("SELECT COUNT(*) c FROM players").get().c;
  res.json({
    sessionRevenue: svc.round2(sessionRevenue),
    shopRevenue: svc.round2(shopRevenue),
    cashRevenue: svc.round2(cashRevenue),
    topups: svc.round2(topups),
    activeSessions,
    playersCount,
  });
});

// ---------- BREND: LOGO I BOJA (vlasnik) ----------
//
// Svaka igraonica ima svoje ime, svoj znak i svoju boju. Dok su logo i crvena
// stajali usiveni u fajlove, druga igraonica je morala da dobije prepravljenu
// kopiju programa - pa bi svaka nadogradnja morala da se pravi posebno za
// svakoga. Ovako se program izdaje jedan, a izgled se podesava odavde.
router.get("/brend", (req, res) => res.json(svc.brendObj()));
router.post("/brend/logo", requireOwner, (req, res) => {
  const r = svc.sacuvajLogo(req.body?.image);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "brend", actor: req.admin.username, detail: "Postavljen logo igraonice" });
  res.json(r);
});
router.delete("/brend/logo", requireOwner, (req, res) => {
  const r = svc.obrisiLogo();
  svc.logEvent({ category: "podesavanja", action: "brend", actor: req.admin.username, detail: "Uklonjen logo igraonice" });
  res.json(r);
});
router.post("/brend/boja", requireOwner, (req, res) => {
  const r = svc.sacuvajAkcenat(req.body?.akcenat);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "brend", actor: req.admin.username, detail: `Boja igraonice: ${r.akcenat}` });
  res.json(r);
});
