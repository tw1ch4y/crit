import { randomUUID } from "node:crypto";
import { db, uPoslu, uJednomPoslu } from "./db.js";

// ---- GLAVNA KNJIGA ----
//
// Jedino mesto koje menja kredit igraca i vodi keš u kasi. Svaka promena ide
// u istom poslu sa zapisom u audit_log, sa stanjem pre i posle.
//
// ZASTO OVDE, A NE SVAKA FUNKCIJA ZA SEBE
//
// Ranije je svaka putanja sa novcem radila isto, a pogresno: procita igraca
// PRE posla, izracuna novo stanje u JavaScript-u i upise ga kao gotov broj
// ("SET balance = 0"). Dok je server jedan proces i sve je sinhrono, to drzi
// slucajno. Cim neko drugi pise u bazu izmedju citanja i upisa (drugi proces,
// alat za servis, ili jedan `await` dodat za godinu dana), oba posla vide "ima
// 130", oba prodju i oba upisu "ostalo 0": pet pica za cenu jednog. To je
// izmereno (testovi/test-paralelna-kupovina.mjs, "naivno").
//
// Ovde se stanje cita UNUTAR posla, posao drzi bravu za pisanje od pocetka
// (BEGIN IMMEDIATE, vidi db.js), provera "ima li dovoljno" je nad tim
// procitanim stanjem, a upis je uslovan (WHERE balance = <procitano>). Ko ne
// prodje proveru dobija NedovoljnoKredita i ceo njegov posao se ponistava.

const r2 = (n) => {
  const x = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(x) ? x : 0;
};
const ISTO = 0.005; // pola pare - ispod toga su dva iznosa ista

export const TIPOVI = Object.freeze([
  "uplata", "trosak_vreme", "kupovina_artikla", "storno", "otvaranje_smene", "zatvaranje_smene",
  // Uz trazene: rucno skidanje kredita, poklon (tocak, popust na paketu) i
  // stanje preneto pri uvodjenju knjige.
  "korekcija", "poklon", "pocetno_stanje",
]);

// Zbirni odsecak vremena. Naplata tece na 5 s; red po prolazu bi bio 17 000
// redova dnevno po racunaru. Zato jedan red skuplja vreme dok traje odsecak, a
// zatvara se cim se desi bilo sta drugo na tom nalogu (porudzbina, dopuna) -
// tako lanac stanja ostaje neprekinut.
export const ODSECAK_MS = 30 * 60_000;

// ---- ko je uradio ----
export const SISTEM = Object.freeze({ id: null, ime: "sistem", tip: "sistem" });
export const radnik = (id, ime) => ({
  id: Number.isInteger(Number(id)) && id != null ? Number(id) : null,
  ime: String(ime || "radnik").slice(0, 80),
  tip: "radnik",
});
export const igrac = (ime) => ({ id: null, ime: String(ime || "igrac").slice(0, 80), tip: "igrac" });

// ---- greske ----
export class NedovoljnoKredita extends Error {
  constructor(potrebno, ima) {
    super(`Nedovoljno kredita (potrebno ${r2(potrebno)}, ima ${r2(ima)})`);
    this.name = "NedovoljnoKredita";
    this.kod = "NEDOVOLJNO_KREDITA";
    this.potrebno = r2(potrebno);
    this.ima = r2(ima);
  }
}
// Uslovan upis nije nasao stanje koje je procitao. Uz BEGIN IMMEDIATE se ne
// desava; ako se desi, neko pise mimo posla i bolje je odbiti nego pogoditi.
export class IzmenjenoUMedjuvremenu extends Error {
  constructor() {
    super("Stanje naloga se promenilo u toku obrade. Pokušaj ponovo.");
    this.name = "IzmenjenoUMedjuvremenu";
    this.kod = "IZMENJENO";
  }
}

function traziPosao() {
  if (!uPoslu()) throw new Error("knjiga: knjiženje ide samo unutar uJednomPoslu");
}

export const novaOperacija = () => randomUUID();

function upisi({ sada = Date.now(), operator = SISTEM, tip, racun, playerId = null, shiftId = null, iznos, pre, posle,
  operacija = null, referenca = null, opis = null, tsDo = null, zatvoren = 1 }) {
  if (!TIPOVI.includes(tip)) throw new Error(`knjiga: nepoznat tip "${tip}"`);
  const op = operator || SISTEM;
  const info = db.prepare(`
    INSERT INTO audit_log (ts, operator_id, operator, operator_tip, tip, racun, player_id, shift_id, iznos,
      stanje_pre, stanje_posle, operacija, referenca, opis, ts_do, zatvoren)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    sada, op.id ?? null, String(op.ime ?? "sistem").slice(0, 80), op.tip || "sistem", tip, racun,
    playerId, shiftId, r2(iznos), r2(pre), r2(posle), operacija || novaOperacija(),
    referenca, opis == null ? null : String(opis).slice(0, 300), tsDo, zatvoren);
  return Number(info.lastInsertRowid);
}

const otvorenaSmena = () => db.prepare("SELECT * FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1").get() || null;

// ---------- KREDIT IGRACA ----------

// Zatvori otvoren odsecak vremena. Poziva se pre svake druge promene na nalogu
// i na kraju sesije.
export function zatvoriVreme(playerId) {
  traziPosao();
  db.prepare("UPDATE audit_log SET zatvoren = 1 WHERE zatvoren = 0 AND player_id = ?").run(playerId);
}

// Promena kredita za `iznos` (+ dodaje, - skida). Minus koji bi spustio nalog
// ispod nule baca NedovoljnoKredita. Vraca { pre, posle, iznos, auditId }.
export function promeniKredit({ playerId, iznos, tip, operator = SISTEM, operacija = null, referenca = null, opis = null,
  sada = Date.now() }) {
  traziPosao();
  const delta = r2(iznos);
  if (!Number.isFinite(Number(iznos))) throw new Error("knjiga: iznos nije broj");
  const red = db.prepare("SELECT balance FROM players WHERE id = ?").get(playerId);
  if (!red) throw new Error("Igrač ne postoji");
  const pre = r2(red.balance);
  if (delta === 0) return { pre, posle: pre, iznos: 0, auditId: null };
  const posle = r2(pre + delta);
  if (delta < 0 && posle < 0) throw new NedovoljnoKredita(-delta, pre);
  zatvoriVreme(playerId);
  const u = db.prepare("UPDATE players SET balance = ? WHERE id = ? AND balance = ?").run(posle, playerId, red.balance);
  if (u.changes !== 1) throw new IzmenjenoUMedjuvremenu();
  const auditId = upisi({ sada, operator, tip, racun: "igrac", playerId, shiftId: otvorenaSmena()?.id ?? null,
    iznos: delta, pre, posle, operacija, referenca, opis });
  return { pre, posle, iznos: delta, auditId };
}

// Naplata vremena za sesiju: skida najvise onoliko koliko ima (ne baca gresku -
// kad kredit dodje do nule, sesija se zavrsava). Vraca { pre, posle, naplaceno }.
export function naplatiVreme({ playerId, sessionId, trazeno, sada = Date.now(), odsecakMs = ODSECAK_MS }) {
  traziPosao();
  const red = db.prepare("SELECT balance FROM players WHERE id = ?").get(playerId);
  if (!red) return null;
  const pre = r2(red.balance);
  const posle = r2(pre - Math.min(Math.max(0, Number(trazeno) || 0), Math.max(0, pre)));
  const naplaceno = r2(pre - posle);
  if (naplaceno <= 0) return { pre, posle: pre, naplaceno: 0 };
  const u = db.prepare("UPDATE players SET balance = ? WHERE id = ? AND balance = ?").run(posle, playerId, red.balance);
  if (u.changes !== 1) throw new IzmenjenoUMedjuvremenu();

  const ref = `sesija:${sessionId}`;
  const o = db.prepare("SELECT id, ts, iznos, stanje_posle, referenca FROM audit_log WHERE zatvoren = 0 AND player_id = ? ORDER BY id DESC LIMIT 1")
    .get(playerId);
  if (o && o.referenca === ref && Math.abs(o.stanje_posle - pre) < ISTO && sada - o.ts < odsecakMs) {
    db.prepare("UPDATE audit_log SET iznos = ?, stanje_posle = ?, ts_do = ? WHERE id = ?").run(r2(o.iznos - naplaceno), posle, sada, o.id);
  } else {
    zatvoriVreme(playerId);
    upisi({ sada, operator: SISTEM, tip: "trosak_vreme", racun: "igrac", playerId, shiftId: otvorenaSmena()?.id ?? null,
      iznos: -naplaceno, pre, posle, referenca: ref, opis: "Vreme za računarom", tsDo: sada, zatvoren: 0 });
  }
  return { pre, posle, naplaceno };
}

// ---------- KEŠ U KASI ----------
//
// Kasa se vodi samo dok je smena otvorena, i to tacno po istom pravilu po kom
// obracun smene racuna "ocekivano u kasi":
//   pocetno stanje + dopune - skidanja + keš porudzbine (osim otkazanih)
// Zato se na zatvaranju stanje kase iz knjige mora poklopiti sa obracunom.

export function stanjeKase(shiftId) {
  const r = db.prepare("SELECT stanje_posle FROM audit_log WHERE racun = 'kasa' AND shift_id = ? ORDER BY id DESC LIMIT 1").get(shiftId);
  return r ? r2(r.stanje_posle) : null;
}

// Promena keša u otvorenoj smeni. Van smene vraca null (taj novac obracun
// prikazuje zasebno, kao "naplaceno van smene").
export function promeniKasu({ iznos, tip, operator = SISTEM, operacija = null, referenca = null, opis = null, playerId = null,
  sada = Date.now(), smena = undefined }) {
  traziPosao();
  const s = smena === undefined ? otvorenaSmena() : smena;
  if (!s) return null;
  const delta = r2(iznos);
  if (delta === 0) return null;
  const pre = stanjeKase(s.id) ?? r2(s.opening_cash);
  const posle = r2(pre + delta);
  const auditId = upisi({ sada, operator, tip, racun: "kasa", playerId, shiftId: s.id, iznos: delta, pre, posle,
    operacija, referenca, opis });
  return { shiftId: s.id, pre, posle, auditId };
}

export function otvoriKasu({ smena, operator, sada = Date.now() }) {
  traziPosao();
  const pocetno = r2(smena.opening_cash);
  return upisi({ sada, operator, tip: "otvaranje_smene", racun: "kasa", shiftId: smena.id, iznos: pocetno, pre: 0, posle: pocetno,
    referenca: `smena:${smena.id}`, opis: `Otvorena smena #${smena.id} - početno stanje kase ${pocetno}` });
}

// Zatvaranje: stanje pre = ono sto je knjiga vodila, stanje posle = prebrojano
// (ako nije prebrojano, isto kao pre). Iznos je manjak (-) ili visak (+).
export function zatvoriKasu({ smena, prebrojano = null, ocekivano = null, operator, sada = Date.now() }) {
  traziPosao();
  const pre = stanjeKase(smena.id) ?? r2(smena.opening_cash);
  const posle = prebrojano == null ? pre : r2(prebrojano);
  const razlika = r2(posle - pre);
  let opis = prebrojano == null ? "Kasa nije prebrojana" : `Prebrojano ${posle}, po knjizi ${pre}`;
  if (razlika) opis += razlika < 0 ? ` - manjak ${-razlika}` : ` - višak ${razlika}`;
  if (ocekivano != null && Math.abs(r2(ocekivano) - pre) >= ISTO) opis += `. PAŽNJA: obračun smene kaže ${r2(ocekivano)}`;
  return upisi({ sada, operator, tip: "zatvaranje_smene", racun: "kasa", shiftId: smena.id, iznos: razlika, pre, posle,
    referenca: `smena:${smena.id}`, opis });
}

// ---------- PRVO POKRETANJE SA KNJIGOM ----------
//
// Baza iz igraonice vec ima naloge sa kreditom i mozda otvorenu smenu. Bez
// pocetnog stanja lanac bi poceo od nule i svaka provera bi javljala gresku.
// Upisuje se jednom: posle toga svaki nalog vec ima svoj prvi red.
export function pripremi({ ocekivanoUKasi = null } = {}) {
  return uJednomPoslu(() => {
    let naloga = 0;
    const bez = db.prepare(`SELECT id, balance FROM players p WHERE balance <> 0
      AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.racun = 'igrac' AND a.player_id = p.id)`).all();
    for (const p of bez) {
      upisi({ tip: "pocetno_stanje", racun: "igrac", playerId: p.id, iznos: 0, pre: p.balance, posle: p.balance,
        opis: "Stanje preneto pri uvođenju knjige" });
      naloga++;
    }
    let kasa = false;
    const s = otvorenaSmena();
    if (s && stanjeKase(s.id) == null) {
      const st = r2(ocekivanoUKasi ? ocekivanoUKasi(s) : s.opening_cash);
      upisi({ tip: "pocetno_stanje", racun: "kasa", shiftId: s.id, iznos: 0, pre: st, posle: st, referenca: `smena:${s.id}`,
        opis: "Smena je otvorena pre uvođenja knjige - stanje preuzeto iz obračuna" });
      kasa = true;
    }
    return { naloga, kasa };
  });
}

// ---------- PROVERA ----------
//
// Ide kroz celu knjigu i trazi:
//   - red u kom pre + iznos != posle
//   - prekid lanca: posle jednog reda != pre sledeceg (novac pomeren mimo knjige)
//   - nalog ciji kredit ne odgovara poslednjem redu
//   - nalog sa kreditom a bez ijednog reda
// Ne menja nista.
export function proveri({ playerId = null } = {}) {
  if (playerId != null && !Number.isInteger(Number(playerId))) playerId = null;
  const greske = [];
  const dodaj = (g) => { if (greske.length < 200) greske.push(g); };
  const redovi = db.prepare(`SELECT id, player_id, shift_id, racun, iznos, stanje_pre, stanje_posle FROM audit_log
    WHERE racun = 'igrac' ${playerId != null ? "AND player_id = ?" : ""} ORDER BY player_id, id`)
    .all(...(playerId != null ? [playerId] : []));
  const poslednje = new Map();
  for (const r of redovi) {
    if (Math.abs(r.stanje_pre + r.iznos - r.stanje_posle) >= ISTO) {
      dodaj({ vrsta: "red_ne_sabira", auditId: r.id, playerId: r.player_id });
    }
    const pre = poslednje.get(r.player_id);
    if (pre && Math.abs(pre.stanje_posle - r.stanje_pre) >= ISTO) {
      dodaj({ vrsta: "prekid_lanca", auditId: r.id, playerId: r.player_id, ocekivano: r2(pre.stanje_posle), zapisano: r2(r.stanje_pre) });
    }
    poslednje.set(r.player_id, r);
  }
  const igraci = db.prepare(`SELECT id, balance FROM players ${playerId != null ? "WHERE id = ?" : ""}`)
    .all(...(playerId != null ? [playerId] : []));
  const postoji = new Set();
  for (const p of igraci) {
    postoji.add(p.id);
    const z = poslednje.get(p.id);
    if (!z) {
      if (Math.abs(p.balance) >= ISTO) dodaj({ vrsta: "nalog_bez_knjige", playerId: p.id, stanje: r2(p.balance) });
    } else if (Math.abs(z.stanje_posle - p.balance) >= ISTO) {
      dodaj({ vrsta: "stanje_ne_odgovara", playerId: p.id, poKnjizi: r2(z.stanje_posle), naNalogu: r2(p.balance) });
    }
  }
  // Obrisan nalog mora da se zavrsi na nuli (brisanje knjizi preostali kredit).
  for (const [pid, z] of poslednje) {
    if (!postoji.has(pid) && playerId == null && Math.abs(z.stanje_posle) >= ISTO) {
      dodaj({ vrsta: "obrisan_nalog_sa_kreditom", playerId: pid, poKnjizi: r2(z.stanje_posle) });
    }
  }

  // Kasa: isti lanac, po smeni.
  let redovaKase = 0;
  if (playerId == null) {
    const kasa = db.prepare("SELECT id, shift_id, iznos, stanje_pre, stanje_posle FROM audit_log WHERE racun = 'kasa' ORDER BY shift_id, id").all();
    redovaKase = kasa.length;
    const posl = new Map();
    for (const r of kasa) {
      if (Math.abs(r.stanje_pre + r.iznos - r.stanje_posle) >= ISTO) dodaj({ vrsta: "red_ne_sabira", auditId: r.id, shiftId: r.shift_id });
      const pre = posl.get(r.shift_id);
      if (pre && Math.abs(pre.stanje_posle - r.stanje_pre) >= ISTO) {
        dodaj({ vrsta: "prekid_lanca_kase", auditId: r.id, shiftId: r.shift_id, ocekivano: r2(pre.stanje_posle), zapisano: r2(r.stanje_pre) });
      }
      posl.set(r.shift_id, r);
    }
  }
  return { ok: greske.length === 0, greske, redova: redovi.length + redovaKase, naloga: igraci.length };
}

// ---------- CITANJE ----------
export function zapisi({ playerId = null, shiftId = null, tip = null, racun = null, od = null, doKada = null, page = 1, per = 50 } = {}) {
  const uslovi = [], arg = [];
  const ceo = (v) => v != null && v !== "" && Number.isInteger(Number(v));
  if (ceo(playerId)) { uslovi.push("player_id = ?"); arg.push(Number(playerId)); }
  if (ceo(shiftId)) { uslovi.push("shift_id = ?"); arg.push(Number(shiftId)); }
  if (tip && TIPOVI.includes(tip)) { uslovi.push("tip = ?"); arg.push(tip); }
  if (racun === "igrac" || racun === "kasa") { uslovi.push("racun = ?"); arg.push(racun); }
  if (od != null && Number.isFinite(Number(od))) { uslovi.push("ts >= ?"); arg.push(Number(od)); }
  if (doKada != null && Number.isFinite(Number(doKada))) { uslovi.push("ts <= ?"); arg.push(Number(doKada)); }
  const gde = uslovi.length ? "WHERE " + uslovi.join(" AND ") : "";
  const n = Math.max(1, Math.min(500, Math.floor(Number(per)) || 50));
  const str = Math.max(1, Math.floor(Number(page)) || 1);
  const ukupno = db.prepare(`SELECT COUNT(*) c FROM audit_log ${gde}`).get(...arg).c;
  const items = db.prepare(`SELECT * FROM audit_log ${gde} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...arg, n, (str - 1) * n);
  return { items, ukupno, page: str, per: n };
}
