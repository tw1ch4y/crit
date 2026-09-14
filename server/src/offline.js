import { createHmac, createHash, timingSafeEqual } from "node:crypto";

// ---------- OBRAČUN VREMENA ODIGRANOG BEZ SERVERA ----------
//
// Launcher vodi sesiju i kad servera nema (vidi client/lokalna-sesija.js), a
// kad se vrati, javlja koliko je sekundi sesija ukupno trajala. Ovde se odlučuje
// koliko se od toga naplaćuje. Namerno bez baze i bez mreže: to je račun sa
// novcem, pa se proverava sam, na brojkama.
//
// Pravila:
//
//  1. Naplaćuje se RAZLIKA između sekundi koje je launcher odbrojao i sekundi
//     koje je server već naplatio. Isti izveštaj poslat dvaput daje nulu.
//  2. Po nižoj od dve cene: onoj koju je igrač video i onoj koja sad važi. Ako
//     je vlasnik u međuvremenu podigao cenu, igrač to nije mogao da zna.
//  3. Nikad više nego što igrač ima.
//  4. Sesija koju je osoblje u međuvremenu zatvorilo se ne dira - tada je bilo
//     razloga, a računar to nije mogao da čuje.
//  5. Izveštaj koji ne prolazi potpis ne naplaćuje ništa, ali se zapisuje.

export const TOLERANCIJA_SEKUNDI = 3;
// Duže od nedelju dana jedna sesija ne traje - veći broj je pokvaren zapis.
export const NAJDUZE_SEKUNDI = 7 * 24 * 3600;
const KRAJEVI = new Set(["odjava", "vreme", "osoblje"]);
export const RAZLOG_KRAJA = { odjava: "logout", vreme: "time", osoblje: "staff" };

// Isti zapis kao u launcheru - vidi kanonski u client/lokalna-sesija.js.
export function kanonski(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(kanonski).join(",") + "]";
  return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ":" + kanonski(v[k])).join(",") + "}";
}

const kljuc = (token) => createHash("sha256").update("crit-lokalna-sesija|" + String(token || "")).digest();

export function potpisi(podaci, token) {
  return createHmac("sha256", kljuc(token)).update(kanonski(podaci)).digest("hex");
}

export function potpisJeIspravan(podaci, potpis, token) {
  if (!token || typeof potpis !== "string" || !/^[0-9a-f]{64}$/.test(potpis)) return false;
  const a = Buffer.from(potpisi(podaci, token), "hex");
  const b = Buffer.from(potpis, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Oblik zapisa. Sve što ne liči na zapis vraća null.
export function procitajZapis(z) {
  if (!z || typeof z !== "object" || Array.isArray(z) || z.v !== 1) return null;
  const sesija = Number(z.sesija);
  const sekundi = Number(z.sekundi);
  const cena = Number(z.cena);
  if (!Number.isInteger(sesija) || sesija <= 0) return null;
  if (typeof z.sekundi !== "number" || !Number.isFinite(sekundi) || sekundi < 0 || sekundi > NAJDUZE_SEKUNDI) return null;
  if (typeof z.cena !== "number" || !Number.isFinite(cena) || cena < 0) return null;
  const kraj = z.kraj == null ? null : String(z.kraj);
  if (kraj !== null && !KRAJEVI.has(kraj)) return null;
  const igrac = z.igrac == null ? null : Number(z.igrac);
  if (igrac !== null && !Number.isInteger(igrac)) return null;
  return { sesija, sekundi, cena, kraj, igrac, otkljucano: z.otkljucano === true };
}

const naPare = (x) => Math.round(x * 100) / 100;

/**
 * @param {object} o
 * @param {object} o.zapis         rezultat procitajZapis
 * @param {object|null} o.sesija   red iz tabele sessions (aktivna na tom računaru)
 * @param {number} o.stopaServera  cena po satu koja sada važi (0 = bez naplate)
 * @param {number} o.kredit        stanje igrača sada
 * @returns {{razlog: string|null, dugSekundi?: number, naplaceno?: number, noviKredit?: number, noveSekunde?: number, kraj?: string|null, nedostaje?: number}}
 */
export function obracun({ zapis, sesija, stopaServera, kredit }) {
  if (!sesija || sesija.status !== "active" || Number(sesija.id) !== zapis.sesija) return { razlog: "sesija_nije_aktivna" };
  if (zapis.igrac != null && Number(sesija.player_id) !== zapis.igrac) return { razlog: "drugi_igrac" };

  const vec = Number(sesija.sekundi) || 0;
  let dug = zapis.sekundi - vec;
  // Oba kraja broje isto vreme sa sitnim razmakom (vreme dok poruka putuje).
  // Tri sekunde tamo-amo nisu odigrano vreme, nego šum.
  if (dug <= TOLERANCIJA_SEKUNDI) dug = 0;

  const stopa = stopaServera > 0 ? Math.min(zapis.cena, stopaServera) : 0;
  const imaKredita = Math.max(0, Number(kredit) || 0);
  const iznos = dug > 0 && stopa > 0 ? (dug / 3600) * stopa : 0;
  const naplaceno = naPare(Math.min(iznos, imaKredita));
  const noviKredit = naPare(imaKredita - naplaceno);
  const noveSekunde = Math.round((vec + dug) * 10) / 10;

  let kraj = zapis.kraj;
  if (!kraj && stopaServera > 0 && noviKredit <= 0) kraj = "vreme";

  return {
    razlog: null,
    dugSekundi: Math.round(dug * 10) / 10,
    naplaceno,
    noviKredit,
    noveSekunde,
    kraj,
    // Koliko je odigrano preko kredita. Launcher zaključava na nuli, pa se ovo
    // desi samo kad se cene razlikuju ili kad je kredit skinut u međuvremenu.
    nedostaje: naPare(Math.max(0, iznos - naplaceno)),
  };
}
