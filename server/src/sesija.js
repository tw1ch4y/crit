import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, getSetting, setSetting } from "./db.js";

// ---- TOKEN SESIJE IGRACA ----
//
// Token racunara kaze samo "ja sam PC-05". Ne kaze KO sedi za njim. Do sada je
// sve sto stigne sa veze PC-05 vazilo kao da salje igrac koji je tamo
// prijavljen - pa je ko god ima token racunara (stoji u podesavanjima na samoj
// masini) mogao sa drugog mesta da poruci na tudji kredit, zavrti tudji tocak
// ili odjavi tudju sesiju.
//
// Sada sesiju nosi VEZA na kojoj je obavljena prijava. Uz prijavu server izda
// token koji je potpisan (HMAC-SHA256) i vezan za:
//
//   - tu sesiju (njen broj i trenutak pocetka)
//   - taj racunar
//   - tog igraca
//
// Token sluzi samo za NASTAVAK: kad launcher izgubi vezu (restart servera,
// zagrcnuta mreza) i ponovo se poveze, pokaze token i server ga prepozna kao
// istog igraca na istoj masini. Ko se poveze bez tokena vidi stanje, ali ne
// moze nista da uradi u ime igraca.
//
// Token ne stoji u bazi - proverava se racunom. Zato vazi tacno dok traje
// sesija: kad se sesija zavrsi, njen status vise nije "active" i token pada,
// bez ikakvog brisanja.

const VERZIJA = "s1";
const OBLIK = /^s1\.([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/;

let _tajna = null;
// Tajna se pravi jednom i cuva u bazi, da tokeni prezive restart servera - bas
// tada launcheri moraju da nastave sesije. Ko zeli da ponisti SVE tokene
// odjednom (npr. posle krađe kopije baze), obrise `sesija_tajna` iz settings;
// sesije teku dalje, a igraci se jednom ponovo prijave.
function tajna() {
  if (_tajna) return _tajna;
  let hex = String(getSetting("sesija_tajna", "") || "");
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    hex = randomBytes(32).toString("hex");
    setSetting("sesija_tajna", hex);
  }
  _tajna = Buffer.from(hex, "hex");
  return _tajna;
}
// Samo za testove: zaboravi kesiranu tajnu (posle rucne izmene u bazi).
export function zaboraviTajnu() { _tajna = null; }

function potpis(s) {
  return createHmac("sha256", tajna())
    .update(`${VERZIJA}|${s.id}|${s.computer_id}|${s.player_id}|${s.started_at}`)
    .digest("base64url");
}

// Token za sesiju (red iz tabele sessions).
export function izdajToken(s) {
  if (!s || !s.id) return null;
  return `${VERZIJA}.${s.id}.${potpis(s)}`;
}

// Proverava token koji je stigao sa racunara `racunarId`. Vraca:
//   { ok: true, sesija }
//   { ok: false, razlog, sesija? }
//
// Razlozi su razdvojeni jer ne znace isto:
//   oblik          nije ni nalik tokenu (smece, rucno kucano)
//   nepoznata      takva sesija nikad nije postojala
//   potpis         sesija postoji, ali potpis ne valja - token je PRAVLJEN
//   tudji_racunar  potpis valja, ali sesija je na drugom racunaru - token je
//                  ODNET sa druge masine
//   zavrsena       sve valja, samo je sesija u medjuvremenu zavrsena (osoblje
//                  odjavilo dok racunar nije bio na mrezi) - to je normalno
export function proveriToken(token, racunarId) {
  const m = OBLIK.exec(String(token ?? ""));
  if (!m) return { ok: false, razlog: "oblik" };
  const s = db.prepare("SELECT id, player_id, computer_id, started_at, status FROM sessions WHERE id = ?").get(Number(m[1]));
  if (!s) return { ok: false, razlog: "nepoznata" };
  const ocekivano = Buffer.from(potpis(s));
  const dobijeno = Buffer.from(m[2]);
  if (ocekivano.length !== dobijeno.length || !timingSafeEqual(ocekivano, dobijeno)) {
    return { ok: false, razlog: "potpis", sesija: s };
  }
  if (s.computer_id !== Number(racunarId)) return { ok: false, razlog: "tudji_racunar", sesija: s };
  if (s.status !== "active") return { ok: false, razlog: "zavrsena", sesija: s };
  return { ok: true, sesija: s };
}
