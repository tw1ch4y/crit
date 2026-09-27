// REZERVACIJE RAČUNARA
//
// Grupa zove telefonom: "sutra u 18h, pet mašina, dva sata". Dosad je to stajalo
// na papiru pored kase. Papir ne vidi radnik iz druge smene, ne vidi ga gost koji
// sedne za mašinu pola sata pre termina, i ne podseća nikoga kad termin dođe.
//
// PRAVILA
//
// - Jedan red = jedan računar. Grupa je više redova sa istim ključem `grupa`,
//   pa se otkazuje i potvrđuje odjednom, a svaki računar ima svoj termin.
// - Dva termina se na istom računaru ne smeju preklopiti. Odbija se CEO zahtev,
//   ne samo sporna mašina: pola grupe na rezervaciji je gore od nijedne, jer
//   radnik veruje da je sve upisano.
// - ZAŠTITA PRIJAVE: od PRE_MIN pre početka do kraja termina, za računar se ne
//   može prijaviti niko drugi. Ako je rezervacija na nalog igrača, taj igrač se
//   prijavljuje normalno (i time je potvrđeno da je stigao). Ako je na ime
//   (gost bez naloga), osoblje klikne "Stigli" - tek tada se računar otvara.
// - Ko je već za računarom kad termin počne, NE izbacuje se. Program ne sme sam
//   da prekine plaćeno vreme; dobija poruku na ekranu, a osoblje obaveštenje.
// - Ko ne dođe do NIJE_DOSAO_MIN posle početka, termin se sam oslobađa. Bez toga
//   bi računar stajao prazan ceo termin zbog nekog ko se predomislio.
//
// Ovde je samo rad sa bazom. Javljanje panelima, logovi i poruke na računar su u
// service.js, isto kao za sve ostalo.
import { db, uJednomPoslu } from "./db.js";

export const PRE_MIN = 15;          // koliko pre početka se računar čuva
export const PODSETI_MIN = 10;      // kad se javlja onome ko je za računarom
export const NIJE_DOSAO_MIN = 20;   // posle koliko minuta se termin sam oslobađa
const NAJKRACE_MIN = 15;
const NAJDUZE_MIN = 12 * 60;
const NAJDALJE_DANA = 60;
const NAJVISE_RACUNARA = 20;

const ZIVE = "('aktivna','stigao')";
const MIN = 60000;

const mapiraj = (r) => r && ({
  id: r.id,
  computerId: r.computer_id,
  computerName: r.computer_name ?? null,
  playerId: r.player_id,
  username: r.username ?? null,
  ime: r.ime,
  telefon: r.telefon || "",
  napomena: r.napomena || "",
  pocetak: r.pocetak,
  kraj: r.kraj,
  grupa: r.grupa,
  status: r.status,
  kreirao: r.kreirao,
  createdAt: r.created_at,
});

const SELECT = `SELECT r.*, c.name AS computer_name, p.username
  FROM rezervacije r
  LEFT JOIN computers c ON c.id = r.computer_id
  LEFT JOIN players p ON p.id = r.player_id`;

export function lista({ od, do: doKad } = {}) {
  const sada = Date.now();
  const a = Number(od) || sada - 12 * 3600 * 1000;
  const b = Number(doKad) || a + 7 * 86400000;
  return db.prepare(`${SELECT} WHERE r.kraj > ? AND r.pocetak < ? ORDER BY r.pocetak, c.name`)
    .all(a, b).map(mapiraj);
}

export function jedna(id) {
  return mapiraj(db.prepare(`${SELECT} WHERE r.id = ?`).get(Number(id)));
}

// Najbliži živ termin po računaru (u toku ili počinje u narednih `unapredMin`).
// Ide uz snapshot računara, pa kartica na kontrolnoj tabli sama kaže šta čeka.
export function najblizePoRacunaru(unapredMin = 180, sada = Date.now()) {
  const rows = db.prepare(`${SELECT} WHERE r.status IN ${ZIVE} AND r.kraj > ? AND r.pocetak < ? ORDER BY r.pocetak`)
    .all(sada, sada + unapredMin * MIN);
  const m = new Map();
  for (const r of rows) if (!m.has(r.computer_id)) m.set(r.computer_id, mapiraj(r));
  return m;
}

// Termin koji TRENUTNO čuva računar (u prozoru zaštite), ili null.
export function cuvaRacunar(computerId, sada = Date.now()) {
  return mapiraj(db.prepare(`${SELECT} WHERE r.computer_id = ? AND r.status IN ${ZIVE}
    AND r.pocetak - ? <= ? AND r.kraj > ? ORDER BY r.pocetak LIMIT 1`)
    .get(computerId, PRE_MIN * MIN, sada, sada));
}

// Da li igrač sme da se prijavi na računar. Vraća null ako sme, inače poruku.
export function proveriPrijavu(computerId, playerId, sada = Date.now()) {
  const r = cuvaRacunar(computerId, sada);
  if (!r) return null;
  if (r.status === "stigao") {
    // Gost je stigao i osoblje ga je pustilo. Kod rezervacije na nalog računar
    // i dalje pripada tom nalogu - drugi igrač bi inače seo na tuđe mesto čim
    // se pravi vlasnik termina odjavi na pauzu.
    if (r.playerId && r.playerId !== playerId) return poruka(r);
    return null;
  }
  if (r.playerId && r.playerId === playerId) return null;
  return poruka(r);
}
function poruka(r) {
  const s = new Date(r.pocetak).toLocaleTimeString("sr-Latn-RS", { hour: "2-digit", minute: "2-digit" });
  const k = new Date(r.kraj).toLocaleTimeString("sr-Latn-RS", { hour: "2-digit", minute: "2-digit" });
  return `Računar je rezervisan (${s}-${k}). Pozovite osoblje ili sedite za drugi računar.`;
}

// Igrač sa rezervacijom se prijavio - termin je time potvrđen.
export function potvrdiDolazak(computerId, playerId, sada = Date.now()) {
  const r = cuvaRacunar(computerId, sada);
  if (r && r.status === "aktivna" && r.playerId === playerId) {
    db.prepare("UPDATE rezervacije SET status='stigao' WHERE id=?").run(r.id);
    return r;
  }
  return null;
}

const tekst = (v, max) => String(v ?? "").trim().slice(0, max);

export function kreiraj({ computerIds, playerId, ime, telefon, napomena, pocetak, trajanjeMin }, kreirao = "osoblje", sada = Date.now()) {
  const ids = [...new Set((Array.isArray(computerIds) ? computerIds : [computerIds]).map(Number).filter((n) => n > 0))];
  if (!ids.length) return { error: "Izaberi bar jedan računar" };
  if (ids.length > NAJVISE_RACUNARA) return { error: `Najviše ${NAJVISE_RACUNARA} računara u jednoj rezervaciji` };

  // Na minut: sekunde iz sata na telefonu nemaju šta da traže u terminu.
  const poc = Math.round(Number(pocetak) / MIN) * MIN;
  const traj = Math.round(Number(trajanjeMin));
  if (!Number.isFinite(poc) || poc <= 0) return { error: "Neispravan početak" };
  if (!Number.isFinite(traj) || traj < NAJKRACE_MIN || traj > NAJDUZE_MIN) {
    return { error: `Trajanje mora biti od ${NAJKRACE_MIN} min do ${NAJDUZE_MIN / 60} h` };
  }
  // Pet minuta unazad je dozvoljeno: radnik upisuje termin "za sad" dok gost
  // stoji ispred njega, a sat na telefonu i serveru nisu nikad isti.
  if (poc < sada - 5 * MIN) return { error: "Početak je u prošlosti" };
  if (poc > sada + NAJDALJE_DANA * 86400000) return { error: `Rezervacija najviše ${NAJDALJE_DANA} dana unapred` };
  const kraj = poc + traj * MIN;

  let pid = null;
  let naIme = tekst(ime, 60);
  if (playerId) {
    const p = db.prepare("SELECT id, username, display_name FROM players WHERE id=?").get(Number(playerId));
    if (!p) return { error: "Igrač ne postoji" };
    pid = p.id;
    if (!naIme) naIme = p.display_name || p.username;
  }
  if (!naIme) return { error: "Upiši na koga glasi rezervacija" };

  const racunari = ids.map((id) => db.prepare("SELECT id, name FROM computers WHERE id=?").get(id));
  if (racunari.some((c) => !c)) return { error: "Računar ne postoji" };

  const sudar = racunari.filter((c) => db.prepare(
    `SELECT 1 FROM rezervacije WHERE computer_id=? AND status IN ${ZIVE} AND pocetak < ? AND kraj > ? LIMIT 1`,
  ).get(c.id, kraj, poc));
  if (sudar.length) {
    return { error: `Već rezervisano u tom terminu: ${sudar.map((c) => c.name).join(", ")}`, zauzeti: sudar.map((c) => c.id) };
  }

  const grupa = ids.length > 1 ? `g${sada.toString(36)}${Math.random().toString(36).slice(2, 6)}` : null;
  const ins = db.prepare(`INSERT INTO rezervacije (computer_id, player_id, ime, telefon, napomena, pocetak, kraj, grupa, status, kreirao, created_at)
    VALUES (?,?,?,?,?,?,?,?, 'aktivna', ?, ?)`);
  // Sve mašine ili nijedna - isto pravilo kao kod provere sudara.
  const nove = uJednomPoslu(() => racunari.map((c) => Number(
    ins.run(c.id, pid, naIme, tekst(telefon, 30) || null, tekst(napomena, 200) || null, poc, kraj, grupa, kreirao, sada).lastInsertRowid)));
  return { ok: true, ids: nove, grupa, racunari: racunari.map((c) => c.name), ime: naIme, pocetak: poc, kraj };
}

// Menja se samo ono što se u praksi menja: vreme, trajanje, ime i napomena.
// Računar se ne menja - za to se otkaže i napravi nova, da provera sudara ostane
// na jednom mestu.
export function izmeni(id, { ime, telefon, napomena, pocetak, trajanjeMin }, sada = Date.now()) {
  const r = jedna(id);
  if (!r) return { error: "Rezervacija ne postoji" };
  if (r.status !== "aktivna" && r.status !== "stigao") return { error: "Završena rezervacija se ne menja" };
  const poc = pocetak != null ? Math.round(Number(pocetak) / MIN) * MIN : r.pocetak;
  const traj = trajanjeMin != null ? Math.round(Number(trajanjeMin)) : Math.round((r.kraj - r.pocetak) / MIN);
  if (!Number.isFinite(poc) || poc <= 0) return { error: "Neispravan početak" };
  if (!Number.isFinite(traj) || traj < NAJKRACE_MIN || traj > NAJDUZE_MIN) {
    return { error: `Trajanje mora biti od ${NAJKRACE_MIN} min do ${NAJDUZE_MIN / 60} h` };
  }
  if (poc !== r.pocetak && poc < sada - 5 * MIN) return { error: "Početak je u prošlosti" };
  const kraj = poc + traj * MIN;
  const sudar = db.prepare(`SELECT 1 FROM rezervacije WHERE computer_id=? AND id != ? AND status IN ${ZIVE} AND pocetak < ? AND kraj > ? LIMIT 1`)
    .get(r.computerId, r.id, kraj, poc);
  if (sudar) return { error: `${r.computerName} je već rezervisan u tom terminu` };
  const novoIme = ime != null ? tekst(ime, 60) : r.ime;
  if (!novoIme) return { error: "Upiši na koga glasi rezervacija" };
  db.prepare("UPDATE rezervacije SET ime=?, telefon=?, napomena=?, pocetak=?, kraj=? WHERE id=?").run(
    novoIme,
    telefon != null ? tekst(telefon, 30) || null : r.telefon || null,
    napomena != null ? tekst(napomena, 200) || null : r.napomena || null,
    poc, kraj, r.id);
  return { ok: true, rezervacija: jedna(r.id) };
}

// Otkazivanje i "stigli" rade nad celom grupom kad se traži, jer grupa od pet
// stiže zajedno i otkazuje zajedno - pet klikova je pet prilika da se jedan
// zaboravi.
function ciljevi(id, celaGrupa) {
  const r = jedna(id);
  if (!r) return { error: "Rezervacija ne postoji" };
  const ids = celaGrupa && r.grupa
    ? db.prepare(`SELECT id FROM rezervacije WHERE grupa=? AND status IN ${ZIVE}`).all(r.grupa).map((x) => x.id)
    : [r.id];
  return { r, ids };
}

export function otkazi(id, celaGrupa = false) {
  const c = ciljevi(id, celaGrupa);
  if (c.error) return c;
  if (c.r.status !== "aktivna" && c.r.status !== "stigao") return { error: "Rezervacija je već zatvorena" };
  const upd = db.prepare("UPDATE rezervacije SET status='otkazana' WHERE id=?");
  for (const x of c.ids) upd.run(x);
  return { ok: true, broj: c.ids.length, rezervacija: c.r };
}

export function stigli(id, celaGrupa = false) {
  const c = ciljevi(id, celaGrupa);
  if (c.error) return c;
  if (c.r.status !== "aktivna") return { error: c.r.status === "stigao" ? "Već je označeno da su stigli" : "Rezervacija je zatvorena" };
  const upd = db.prepare("UPDATE rezervacije SET status='stigao' WHERE id=? AND status='aktivna'");
  for (const x of c.ids) upd.run(x);
  return { ok: true, broj: c.ids.length, rezervacija: c.r };
}

// Periodična provera. Vraća šta se desilo, a service.js to javlja.
//  - nisuDosli: termini koji su sami oslobođeni
//  - podsetnici: termini koji uskoro počinju, a za računarom sedi neko drugi
const podsetnikPoslat = new Set();
export function tick(zauzetiRacunari, sada = Date.now()) {
  const nisuDosli = db.prepare(`${SELECT} WHERE r.status='aktivna' AND r.pocetak + ? <= ?`)
    .all(NIJE_DOSAO_MIN * MIN, sada).map(mapiraj);
  const upd = db.prepare("UPDATE rezervacije SET status='nije_dosao' WHERE id=? AND status='aktivna'");
  for (const r of nisuDosli) upd.run(r.id);

  const podsetnici = [];
  const uskoro = db.prepare(`${SELECT} WHERE r.status='aktivna' AND r.pocetak > ? AND r.pocetak - ? <= ?`)
    .all(sada, PODSETI_MIN * MIN, sada).map(mapiraj);
  for (const r of uskoro) {
    if (podsetnikPoslat.has(r.id)) continue;
    const ko = zauzetiRacunari.get(r.computerId);
    if (ko == null || (r.playerId && ko === r.playerId)) continue;
    podsetnikPoslat.add(r.id);
    podsetnici.push(r);
  }
  if (podsetnikPoslat.size > 5000) podsetnikPoslat.clear();
  return { nisuDosli, podsetnici };
}
