import express from "express";
import { db, getSetting, setSetting, randomToken } from "./db.js";
import * as odrz from "./odrzavanje.js";
const backupDb = odrz.backupDb;
import fs from "node:fs";
import { verifyPassword, issueAdminToken, revokeAdminToken, requireAdmin, requireOwner, requireServiser } from "./auth.js";
import * as nadg from "./nadogradnja.js";
import * as nadgServera from "./nadogradnja-servera.js";
import * as svc from "./service.js";

export const router = express.Router();

const pName = (id) => db.prepare("SELECT username FROM players WHERE id=?").get(id)?.username || `#${id}`;
const cName = (id) => db.prepare("SELECT name FROM computers WHERE id=?").get(id)?.name || `#${id}`;

// ---------- AUTH ----------
router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const ime = String(username || "").trim();
  // Ključ je računar + nalog: pauza ne blokira osoblje na drugim računarima.
  const kljuc = `panel:${req.ip}|${ime.toLowerCase()}`;
  const pauza = svc.kocnica.ceka(kljuc);
  if (pauza) return res.status(429).json({ error: `Previše pokušaja. Sačekajte ${pauza} s.` });

  // Ugašen nalog dobija isti odgovor kao nepostojeći.
  const admin = db.prepare("SELECT * FROM admins WHERE username = ? AND active = 1").get(ime);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    const cekaj = svc.kocnica.promasaj(kljuc);
    // Pauza se javlja odmah, u istom odgovoru.
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
router.post("/me/password", (req, res) => {
  const r = svc.changeOwnPassword(req.admin.adminId, req.body?.oldPassword, req.body?.newPassword);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "self_pw", actor: req.admin.username, detail: "Promenio sopstvenu lozinku" });
  res.json(r);
});

// ---------- RADNICI / ADMINI (samo vlasnik) ----------
router.get("/admins", requireOwner, (req, res) => res.json(svc.listAdmins()));
router.post("/admins", requireOwner, (req, res) => {
  const r = svc.createAdmin(req.body || {}, req.admin);
  if (r.error) return res.status(400).json(r);
  const ULOGA_NAZIV = { serviser: "serviser", owner: "vlasnik", staff: "radnik" };
  svc.logEvent({ category: "nalozi", action: "admin_create", actor: req.admin.username, target: req.body?.username, detail: `Kreiran ${ULOGA_NAZIV[req.body?.role] || "radnik"} nalog` });
  res.json(r);
});
router.post("/admins/:id/password", requireOwner, (req, res) => {
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
router.post("/shift/open", (req, res) => {
  const r = svc.openShift(req.admin.adminId, req.admin.username, req.body?.openingCash);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
router.post("/shift/close", (req, res) => {
  const r = svc.closeShift(req.admin.username, req.body?.closingCash);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
router.get("/shifts", requireOwner, (req, res) => res.json(svc.shiftsList(req.query.limit)));
router.get("/shifts/:id", requireOwner, (req, res) => {
  const d = svc.shiftDetail(Number(req.params.id));
  if (!d) return res.status(404).json({ error: "Smena ne postoji" });
  res.json(d);
});
router.post("/shifts/:id/napomena", requireOwner, (req, res) => {
  const r = svc.zabeleziUzSmenu(Number(req.params.id), req.body?.note);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "sistem", action: "shift_note", actor: req.admin.username,
    target: `smena #${req.params.id}`, detail: r.note ? `Napomena uz smenu: ${r.note}` : "Obrisana napomena uz smenu" });
  res.json(r);
});

// ---------- IGRAČI ----------
// Bez ?page ceo spisak (kasa), sa ?page jedna strana.
router.get("/players", (req, res) => {
  if (req.query.page) {
    return res.json(svc.playersPage({ page: req.query.page, per: req.query.per, search: req.query.search }));
  }
  res.json(svc.playersSnapshot());
});

router.post("/players", (req, res) => {
  const r = svc.createPlayer(req.body || {}, { adminId: req.admin.adminId, adminUsername: req.admin.username });
  if (r.error) return res.status(400).json(r);
  // Bez iznosa: početni kredit je već zapisan kao dopuna (createPlayer).
  svc.logEvent({ category: "nalozi", action: "player_create", actor: req.admin.username, target: req.body?.username, detail: `Kreiran nalog igrača${Number(req.body?.balance) > 0 ? `, kredit ${Number(req.body.balance)}` : ""}` });
  res.json(r);
});

router.post("/players/guests", (req, res) => {
  const r = svc.createGuests(req.body?.count, req.body?.balance, { adminId: req.admin.adminId, adminUsername: req.admin.username });
  if (r.error) return res.status(400).json(r);
  const imena = r.players.map((p) => p.username).join(", ");
  svc.logEvent({
    category: "nalozi", action: "player_create", actor: req.admin.username, target: imena,
    detail: `Otvoreni gostujući nalozi (${r.players.length})${Number(req.body?.balance) > 0 ? `, kredit ${Number(req.body.balance)} po nalogu` : ""}`,
  });
  res.json(r);
});

router.get("/players/guests/spremni", requireOwner, (req, res) => res.json(svc.guestsToClean()));
router.post("/players/guests/ocisti", requireOwner, (req, res) => {
  const r = svc.cleanGuests();
  if (r.obrisano) {
    svc.logEvent({ category: "nalozi", action: "player_delete", actor: req.admin.username, target: r.imena.join(", "), detail: `Očišćeni potrošeni gostujući nalozi (${r.obrisano})` });
  }
  res.json(r);
});

// Zapis u logove pravi sam servis, u istom poslu sa novcem - vidi topUpPlayer.
router.post("/players/:id/topup", (req, res) => {
  const id = Number(req.params.id);
  const amt = Number(req.body?.amount);
  const r = svc.topUpPlayer(id, amt, req.admin.adminId, req.body?.note, req.admin.username);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// ---------- VREMENSKI PAKETI ----------
router.get("/paketi", (req, res) => res.json(svc.paketiLista()));
router.post("/paketi", requireOwner, (req, res) => {
  const r = svc.kreirajPaket(req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "paket", actor: req.admin.username, target: req.body?.name, detail: "Dodat vremenski paket" });
  res.json(r);
});
router.put("/paketi/:id", requireOwner, (req, res) => {
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
// Prodaja paketa; zapis u logove je u transakciji u prodajPaket.
router.post("/players/:id/paket", (req, res) => {
  const id = Number(req.params.id);
  const r = svc.prodajPaket(id, Number(req.body?.paketId), req.admin.adminId, req.admin.username);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// ---------- NAGRADNI TOČAK I VIP ----------
//
// Cenu i trajanje VIP-a vidi i radnik (naplaćuje keš na kasi); launcher istu
// cenu prikazuje gostima. Brojke o zaradi vidi samo vlasnik.
router.get("/vip", (req, res) => {
  const v = svc.vipPregled();
  if (req.admin.role !== "owner") { delete v.aktivnih; delete v.prodato30; delete v.prihod30; }
  res.json(v);
});
router.post("/vip", requireOwner, (req, res) => {
  const r = svc.postaviVip(req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "vip", actor: req.admin.username,
    detail: `VIP: ${r.ukljucen ? "u ponudi" : "nije u ponudi"}, ${r.cena} za ${r.dana} dana, x${r.xpMnozilac} XP` });
  res.json(svc.vipPregled());
});
// VIP za gosta koji plaća kešom na kasi; 0 dana oduzima odmah. `naplati` je
// novac preko pulta i ide u pazar smene; poklonjen VIP ide bez njega.
router.post("/players/:id/vip", (req, res) => {
  const r = svc.postaviVipIgracu(Number(req.params.id), req.body?.dana, req.admin.username,
    { naplati: req.body?.naplati, adminId: req.admin.adminId });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

router.get("/tocak", requireOwner, (req, res) => res.json(svc.tocakConfig()));
router.post("/tocak", requireOwner, (req, res) => {
  const r = svc.postaviTocak(req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "tocak", actor: req.admin.username, detail: `Točak: ${r.ukljucen ? "uključen" : "isključen"}, prag ${r.prag}` });
  res.json(r);
});
router.post("/tocak/nagrade", requireOwner, (req, res) => {
  const r = svc.dodajNagradu(req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "podesavanja", action: "tocak", actor: req.admin.username, target: req.body?.naziv, detail: "Dodata nagrada na točak" });
  res.json(r);
});
router.put("/tocak/nagrade/:id", requireOwner, (req, res) => {
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

router.post("/players/:id/password", (req, res) => {
  const id = Number(req.params.id);
  const r = svc.resetPlayerPassword(id, req.body?.password);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "player_pw", actor: req.admin.username, target: pName(id), detail: "Reset lozinke igraču" });
  res.json(r);
});

router.post("/players/:id/ban", (req, res) => {
  const id = Number(req.params.id);
  const banned = !!req.body?.banned;
  const r = svc.setPlayerBanned(id, banned);
  if (r.error) return res.status(404).json(r);
  svc.logEvent({ category: "nalozi", action: banned ? "ban" : "unban", actor: req.admin.username, target: pName(id), detail: banned ? "Blokiran nalog" : "Odblokiran nalog" });
  res.json(r);
});

router.put("/players/:id", (req, res) => {
  const id = Number(req.params.id);
  const r = svc.updatePlayer(id, req.body || {});
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "player_edit", actor: req.admin.username, target: pName(id), detail: "Izmenjeni podaci naloga" });
  res.json(r);
});

router.delete("/players/:id", requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const nm = pName(id);
  const r = svc.deletePlayer(id);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "nalozi", action: "player_delete", actor: req.admin.username, target: nm, detail: "Obrisan nalog igrača (istorija novca ostaje)" });
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
    ip: c.ip, mac: c.mac, verzija: c.verzija, numeracija: c.numeracija, pinFabricki: c.pinFabricki, lastSeen: c.lastSeen, token: tokens.get(c.id),
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
  const r = svc.obrisiRacunar(Number(req.params.id));
  if (r.error) return res.status(r.nema ? 404 : 400).json({ error: r.error });
  svc.logEvent({ category: "racunar", action: "delete", actor: req.admin.username, target: r.ime,
    detail: r.ugasen ? "Uklonjen računar (sesije i porudžbine ostaju u istoriji)" : "Obrisan računar" });
  res.json(r);
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
  if (r.error) return res.status(404).json(r);
  svc.logEvent({ category: "racunar", action: "lock", actor: req.admin.username, target: cName(id), detail: "Zaključan računar" });
  res.json(r);
});
router.post("/computers/:id/unlock", (req, res) => {
  const id = Number(req.params.id);
  const r = svc.unlockComputer(id, req.admin.adminId);
  if (r.error) return res.status(404).json(r);
  svc.logEvent({ category: "racunar", action: "unlock", actor: req.admin.username, target: cName(id), detail: "Otključan računar" });
  res.json(r);
});
router.post("/computers/:id/logout", (req, res) => {
  const id = Number(req.params.id);
  const r = svc.forceLogout(id, req.admin.adminId);
  svc.logEvent({ category: "racunar", action: "force_logout", actor: req.admin.username, target: cName(id), detail: "Osoblje odjavilo igrača" });
  res.json(r);
});
router.post("/computers/:id/message", (req, res) => {
  const id = Number(req.params.id);
  // Poruka ide na ekran igrača i u Logove, pa je dužina ograničena.
  const text = String(req.body?.text || "").trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: "Poruka je prazna" });
  const r = svc.sendMessageToComputer(id, text);
  svc.logEvent({ category: "racunar", action: "message", actor: req.admin.username, target: cName(id), detail: `Poruka: ${text}` });
  res.json(r);
});
router.post("/computers/:id/command", (req, res) => {
  const id = Number(req.params.id);
  const cmd = String(req.body?.cmd || "");
  const r = svc.sendCommand(id, cmd, req.admin.adminId);
  if (r.error) return res.status(400).json(r);
  svc.logEvent({ category: "racunar", action: "command", actor: req.admin.username, target: cName(id), detail: `Komanda: ${cmd}` });
  res.json(r);
});

// Daljinski spisak procesa na računaru igrača.
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
router.post("/computers-action", (req, res) => {
  const { ids, action } = req.body || {};
  if (!action) return res.status(400).json({ error: "Akcija je obavezna" });
  const r = svc.bulkAction(ids, action, req.admin.adminId);
  svc.logEvent({ category: "racunar", action: "bulk", actor: req.admin.username, detail: `Grupna akcija "${action}" na ${r.sent} računara` });
  res.json(r);
});

// ---------- PORUDŽBINE ----------
router.get("/orders", (req, res) => res.json(svc.ordersSnapshot(req.query.all === "1")));
router.post("/orders/:id/status", (req, res) => {
  // logovanje radi servis (zna iznos i da li je otkazivanje)
  const r = svc.setOrderStatus(Number(req.params.id), req.body?.status, req.admin.username);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// POS: radnik ručno kuca porudžbinu
router.post("/pos", (req, res) => {
  const r = svc.createPosOrder({ ...(req.body || {}), actor: req.admin.username });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// ---------- SHOP ----------
router.get("/shop", (req, res) => res.json(svc.shopList()));
const parseStock = (v) => (v === "" || v == null ? null : Math.max(0, Math.floor(Number(v)) || 0));
// Negativna cena bi pri porudžbini dodavala kredit.
const cenaOk = (v) => svc.ispravanIznos(v) && Number(v) >= 0;
router.post("/shop", requireOwner, (req, res) => {
  const { category, price, emoji, stock } = req.body || {};
  const name = String(req.body?.name ?? "").trim();
  if (!name || price == null) return res.status(400).json({ error: "Naziv i cena su obavezni" });
  if (!cenaOk(price)) return res.status(400).json({ error: "Cena mora biti broj veći ili jednak nuli" });
  // Isto ime artikla se javlja, ne zabranjuje; ponovljen zahtev sa `svejedno`
  // ga prihvata.
  const isti = svc.istoImeArtikla(name);
  if (isti && !req.body?.svejedno) {
    return res.status(409).json({ kod: "duplikat", postojeci: { naziv: isti.name, kategorija: isti.category, cena: isti.price },
      error: `„${isti.name}" već postoji u kategoriji ${isti.category || "Ostalo"}.` });
  }
  const info = db.prepare("INSERT INTO shop_items (name, category, price, emoji, stock) VALUES (?,?,?,?,?)")
    .run(name, svc.uskladiKategoriju(category, svc.kategorije("shop")) || "Ostalo", Number(price), emoji || "", parseStock(stock));
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
  // Isto pitanje pri preimenovanju (artikal se ne poredi sa sobom).
  const istiDrugi = svc.istoImeArtikla(name, id);
  if (istiDrugi && !req.body?.svejedno) {
    return res.status(409).json({ kod: "duplikat", postojeci: { naziv: istiDrugi.name, kategorija: istiDrugi.category, cena: istiDrugi.price },
      error: `„${istiDrugi.name}" već postoji u kategoriji ${istiDrugi.category || "Ostalo"}.` });
  }
  db.prepare("UPDATE shop_items SET name=?, category=?, price=?, emoji=?, available=?, stock=? WHERE id=?")
    .run(name, category == null ? (it.category || "Ostalo") : (svc.uskladiKategoriju(category, svc.kategorije("shop")) || "Ostalo"), cena, emoji ?? it.emoji ?? "",
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
  // Dopuna bez ispravnog broja se odbija, inače bi neograničen artikal
  // (stock = NULL) postao 0 komada, odnosno rasprodat.
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
  const r = svc.deleteShopItem(Number(req.params.id));
  if (r.error) return res.status(r.error === "Artikal ne postoji" ? 404 : 400).json(r);
  svc.logEvent({ category: "podesavanja", action: "shop_delete", actor: req.admin.username, detail: "Obrisan artikal iz shopa" });
  svc.pushCatalog();
  res.json({ ok: true });
});

// ---------- IGRE ----------
router.get("/games", (req, res) => res.json(svc.gamesList()));
// Putanja kopirana iz Explorer-a često nosi razmak ili navodnike.
const ocistiPutanju = (v) => String(v ?? "").trim().replace(/^"|"$/g, "").trim();
// Razmak ispred imena bi igru poslao na početak police.
const ocistiIme = (v) => String(v ?? "").trim();
// Polje koje nije poslato zadržava staru vrednost (undefined SQLite ne prima).
const iliStaro = (novo, staro, podrazumevano = "") => novo ?? staro ?? podrazumevano;
const vidljivost = (v, staro) => (v === false ? 0 : v === true ? 1 : staro);

router.post("/games", requireOwner, (req, res) => {
  const { args, emoji, category, available } = req.body || {};
  const p = ocistiPutanju(req.body?.path);
  const name = ocistiIme(req.body?.name);
  if (!name || !p) return res.status(400).json({ error: "Naziv i putanja su obavezni" });
  const info = db.prepare("INSERT INTO games (name, path, args, emoji, category, available) VALUES (?,?,?,?,?,?)")
    .run(name, p, args || "", emoji || "", svc.uskladiKategoriju(category, svc.kategorije("igre")) || "Igre", available === false ? 0 : 1);
  svc.logEvent({ category: "podesavanja", action: "game_add", actor: req.admin.username, target: name, detail: "Dodata igra" });
  svc.pushCatalog();
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put("/games/:id", requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const g = db.prepare("SELECT * FROM games WHERE id=?").get(id);
  // Nepostojeća igra je 404, ne "ok".
  if (!g) return res.status(404).json({ error: "Igra ne postoji" });
  const { args, emoji, category, available } = req.body || {};
  const p = ocistiPutanju(req.body?.path ?? g.path);
  const name = ocistiIme(req.body?.name ?? g.name);
  if (!name) return res.status(400).json({ error: "Naziv je obavezan" });
  if (!p) return res.status(400).json({ error: "Putanja je obavezna" });
  db.prepare("UPDATE games SET name=?, path=?, args=?, emoji=?, category=?, available=? WHERE id=?")
    .run(name, p, iliStaro(args, g.args), iliStaro(emoji, g.emoji), svc.uskladiKategoriju(iliStaro(category, g.category, "Igre"), svc.kategorije("igre")) || "Igre",
      vidljivost(available, g.available), id);
  // Promenjena putanja briše oznaku o kvaru; izmena naziva ili kategorije ne.
  if (p !== g.path) svc.ocistiKvar("games", id);
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
  // 404 kaže panelu da je spisak zastareo.
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
router.put("/programs/:id", requireOwner, (req, res) => {
  const r = svc.updateProgram(Number(req.params.id), req.body || {});
  if (r.error) return res.status(r.error === "Program ne postoji" ? 404 : 400).json(r);
  res.json(r);
});
router.delete("/programs/:id", requireOwner, (req, res) => { svc.deleteProgram(Number(req.params.id)); res.json({ ok: true }); });
router.get("/install-status", requireOwner, (req, res) => res.json(svc.getInstallStatus()));
router.delete("/install-status", requireOwner, (req, res) => res.json(svc.clearInstallStatus()));
router.post("/install", requireOwner, (req, res) => {
  const { ids, programId, name, url, args } = req.body || {};
  let prog;
  if (programId) { prog = db.prepare("SELECT * FROM programs WHERE id=?").get(Number(programId)); if (!prog) return res.status(400).json({ error: "Program ne postoji" }); }
  else prog = { name, url, args };
  if (!prog.name || !prog.url) return res.status(400).json({ error: "Naziv i link su obavezni" });
  // Računar preuzima i pokreće ono što stoji na tom linku - samo http(s).
  if (!/^https?:\/\//i.test(String(prog.url))) return res.status(400).json({ error: "Link mora počinjati sa http:// ili https://" });
  res.json(svc.sendInstall(ids, prog, req.admin.username));
});

// ---------- PODEŠAVANJA ----------
router.get("/settings", (req, res) => {
  const s = svc.settingsObj();
  // Podatak o fabričkoj lozinci vlasnika vidi samo vlasnik.
  if (req.admin.role !== "owner") delete s.fabrickaLozinka;
  res.json(s);
});
router.post("/settings", requireOwner, (req, res) => {
  const map = { cafeName: "cafe_name", currency: "currency", ratePerHour: "rate_per_hour", unlockPin: "unlock_pin", idleMinutes: "idle_minutes", servisniPin: "servisni_pin" };
  // Negativna cena po satu i negativno mirovanje se odbijaju.
  const brojevi = { ratePerHour: "Cena po satu", idleMinutes: "Odjava zbog mirovanja" };
  const PIN = /^\d{4,8}$/;
  // U bazu ide proverena vrednost, ne sirova iz zahteva.
  const zaUpis = {};
  for (const [k, dbKey] of Object.entries(map)) {
    const sirovo = req.body?.[k];
    if (sirovo == null) continue;
    if (typeof sirovo === "object") return res.status(400).json({ error: `${k}: neispravna vrednost` });
    if (brojevi[k]) {
      const v = Number(sirovo);
      if (!Number.isFinite(v) || v < 0 || !svc.ispravanIznos(v)) return res.status(400).json({ error: `${brojevi[k]}: unesi broj veći ili jednak nuli` });
      zaUpis[dbKey] = v;
    } else {
      const tekst = String(sirovo).trim();
      // Prazan PIN za otključavanje je otključavao računar praznim unosom.
      if (k === "unlockPin" && !PIN.test(tekst)) return res.status(400).json({ error: "PIN za otključavanje mora imati 4 do 8 cifara" });
      if (k === "servisniPin" && tekst && !PIN.test(tekst)) {
        return res.status(400).json({ error: "Servisni PIN mora imati 4 do 8 cifara (ili ostavi prazno)" });
      }
      if (k === "cafeName" && (!tekst || tekst.length > 40)) return res.status(400).json({ error: "Naziv igraonice: od 1 do 40 znakova" });
      if (k === "currency" && (!tekst || tekst.length > 8)) return res.status(400).json({ error: "Valuta: od 1 do 8 znakova" });
      zaUpis[dbKey] = tekst;
    }
  }
  const changed = [];
  for (const [k, dbKey] of Object.entries(map)) {
    if (dbKey in zaUpis) { setSetting(dbKey, zaUpis[dbKey]); changed.push(k); }
  }
  svc.logEvent({ category: "podesavanja", action: "settings", actor: req.admin.username, detail: `Izmenjena podešavanja: ${changed.join(", ")}` });
  // Nov servisni PIN odmah ide svim launcherima.
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
router.get("/kopija-van", requireOwner, (req, res) => res.json(odrz.kopijaVanPodesavanja()));
// Rute su asinhrone jer odredište ume da ne odgovara (odrzavanje.js). Express
// 4 ne hvata grešku iz asinhrone rute, pa se hvata ovde.
router.post("/kopija-van", requireOwner, async (req, res) => {
  try {
    const r = await odrz.postaviKopijuVan(req.body?.putanja);
    if (r.error) return res.status(400).json(r);
    svc.logEvent({ category: "podesavanja", action: "kopija_van", actor: req.admin.username,
      detail: r.putanja ? `Kopija van računara: ${r.putanja}` : "Kopija van računara isključena" });
    // Prva kopija ide odmah, da vlasnik istog trena vidi da odredište radi.
    if (r.putanja) await odrz.kopirajVanRacunara();
    res.json(odrz.kopijaVanPodesavanja());
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: "Podešavanje nije sačuvano: " + String(e?.message || e).slice(0, 120) });
  }
});
router.post("/kopija-van/sada", requireOwner, async (req, res) => {
  try {
    const r = await odrz.kopirajVanRacunara();
    if (r.error) return res.status(500).json({ error: `Kopiranje nije uspelo (${r.error}). Proveri da li je disk priključen.` });
    if (r.preskoceno) return res.status(400).json({ error: `Preskočeno: ${r.preskoceno}` });
    // U log ide i broj slika.
    const koliko = (r.slike?.novih || 0) + (r.slike?.preskoceno || 0);
    svc.logEvent({ category: "sistem", action: "kopija_van", actor: req.admin.username,
      detail: `Kopija odneta van računara: ${r.fajl}${koliko ? ` + ${koliko} slika` : ""} -> ${r.cilj}` });
    res.json({ ok: true, slike: r.slike || null, ...odrz.kopijaVanPodesavanja() });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: "Kopiranje nije uspelo: " + String(e?.message || e).slice(0, 120) });
  }
});

// ---------- NADOGRADNJA LAUNCHERA ----------
//
// Vlasnik vidi stanje i sme da pošalje nadogradnju slobodnim računarima;
// instalater postavlja i pušta serviser.
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

router.post("/nadogradnja/posalji", requireOwner, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
  const r = svc.posaljiNadogradnju(ids, req.admin.username);
  if (r.error) return res.status(400).json(r);
  res.json({ ...r, ...svc.nadogradnjaStanje() });
});

// Instalater (oko 100 MB) ide pravo u fajl, komad po komad, ne kroz memoriju.
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


// ---------- NADOGRADNJA SERVERA ----------
//
// Vlasnik vidi stanje; paket postavlja i pušta serviser. Tok je opisan u
// nadogradnja-servera.js.
router.get("/nadogradnja-servera", requireOwner, (req, res) => res.json(nadgServera.stanje()));

// Paket ide kao tok, pravo u fajl - isto kao instalater launchera.
router.put("/nadogradnja-servera/paket", requireServiser, (req, res) => {
  const r = nadgServera.putanjaZaUpis();
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
    try {
      if (!fs.statSync(r.privremena).size) return propalo("Stigao je prazan fajl");
      fs.renameSync(r.privremena, r.konacna);
    } catch (e) { return propalo("Fajl nije sačuvan: " + e.message); }
    const st = nadgServera.stanjePaketa();
    // Neispravan paket se ne čuva.
    if (!st?.ispravan) {
      nadgServera.obrisiPaket();
      return res.status(400).json({ error: st?.greska || "Paket ne može da se pročita" });
    }
    nadgServera.obrisiIshod();
    svc.logEvent({ category: "sistem", action: "nadogradnja_servera_paket", actor: req.admin.username,
      detail: `Postavljen paket servera ${st.verzija} (${st.fajlova} fajlova)` });
    res.json(nadgServera.stanje());
  });
});

router.delete("/nadogradnja-servera/paket", requireServiser, (req, res) => {
  nadgServera.obrisiPaket();
  res.json(nadgServera.stanje());
});

router.post("/nadogradnja-servera/pokreni", requireServiser, (req, res) => {
  const r = nadgServera.pripremi();
  if (r.error) return res.status(400).json(r);
  // Kopija baze pre zamene: nova verzija menja bazu pri prvom pokretanju, a
  // vraćanje koda ne vraća bazu.
  const kopija = backupDb();
  svc.logEvent({ category: "sistem", action: "nadogradnja_servera", actor: req.admin.username,
    detail: `Nadogradnja servera na ${r.verzija} - server se gasi na dvadesetak sekundi` +
      (kopija ? `, kopija baze: ${kopija}` : "") });
  res.json({ ok: true, verzija: r.verzija });
  // Odgovor prvo stiže panelu, pa se poziva nadzornik (gasi server uredno i
  // menja kod).
  setTimeout(() => { try { process.send({ t: "nadogradi", verzija: r.verzija }); } catch {} }, 300);
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
  // Promet danas uključuje i ono što je nateklo aktivnim sesijama (trošak
  // sesije se u `transactions` upisuje tek na kraju). Završena sesija posle
  // upisuje pun iznos sa istim datumom, pa se broj ne udvostručuje.
  const zavrsene = db.prepare("SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE type='session' AND created_at>=?").get(from).s;
  const uToku = db.prepare("SELECT COALESCE(SUM(cost),0) s FROM sessions WHERE status='active'").get().s;
  const sessionRevenue = zavrsene + uToku;

  // Otkazane porudžbine se ne broje.
  const shopRevenue = db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment='credit' AND status!='cancelled' AND created_at>=?").get(from).s;
  const cashRevenue = db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment='cash' AND status!='cancelled' AND created_at>=?").get(from).s;
  const topups = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='topup' AND created_at>=?").get(from).s;
  const activeSessions = db.prepare("SELECT COUNT(*) c FROM sessions WHERE status='active'").get().c;
  const playersCount = db.prepare("SELECT COUNT(*) c FROM players WHERE obrisan IS NULL").get().c;
  res.json({
    sessionRevenue: svc.round2(sessionRevenue),
    shopRevenue: svc.round2(shopRevenue),
    cashRevenue: svc.round2(cashRevenue),
    topups: svc.round2(topups),
    activeSessions,
    playersCount,
  });
});

// ---------- BREND: ZNAK I BOJA (vlasnik) ----------
router.get("/brend", (req, res) => res.json(svc.brendObj()));
// Zamerke i izvedene nijanse računa server, iste koje dobija launcher; panel
// ih ne računa sam.
router.get("/brend/provera", requireOwner, (req, res) =>
  res.json({ zamerke: svc.zamerkeNaBoju(req.query?.heks), nijanse: svc.nijanse(req.query?.heks) }));
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
