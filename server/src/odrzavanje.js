// Održavanje: da disk ne stane i da baza ne raste bez granice.
//
// Izmereno na punoj bazi za 13 računara (testovi/godina-rada.mjs): posle
// godinu dana baza 35 MB, a 30 punih rezervnih kopija 1,06 GB. Zato:
//   1. logovi se seku po starosti i po broju (šta pre dođe);
//   2. rezervne kopije se proređuju kroz vreme i imaju granicu ukupne veličine;
//   3. pre pravljenja kopije se proverava slobodan prostor.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { db, DATA_DIR, getSetting, setSetting } from "./db.js";

// ---- podrazumevane vrednosti (mogu da se promene u Podešavanjima) ----
export const PODRAZUMEVANO = {
  logDana: 365,        // koliko dugo se čuva zapis u Logovima
  logNajvise: 400000,  // ...ali nikad više od ovoliko redova
  pokretanjaDana: 365, // zapisi o pokretanju igara
  kopijaSvezih: 12,    // poslednjih 12 kopija se čuva uvek (oko 3 sata)
  kopijaDana: 14,      // + po jedna dnevno, za poslednje dve nedelje
  kopijaNedelja: 8,    // + po jedna nedeljno, za poslednja dva meseca
  kopijeMB: 2048,      // gornja granica ukupne veličine svih kopija
  diskMB: 1024,        // ispod ovoliko slobodnog diska kopija se NE pravi
};

const broj = (kljuc, podrazumevano) => {
  const v = Number(getSetting("odrzavanje_" + kljuc, ""));
  return Number.isFinite(v) && v > 0 ? v : podrazumevano;
};
export function podesavanja() {
  const o = {};
  for (const k of Object.keys(PODRAZUMEVANO)) o[k] = broj(k, PODRAZUMEVANO[k]);
  return o;
}
export function upisiPodesavanja(nova) {
  for (const k of Object.keys(PODRAZUMEVANO)) {
    const v = Number(nova?.[k]);
    if (Number.isFinite(v) && v > 0) setSetting("odrzavanje_" + k, String(Math.floor(v)));
  }
  return podesavanja();
}

const MB = 1048576;
export function slobodnoNaDisku() {
  try {
    const s = fs.statfsSync(DATA_DIR);
    return s.bsize * s.bavail;
  } catch { return null; }
}

const folderKopija = () => path.join(DATA_DIR, "backups");

function spisakKopija() {
  const dir = folderKopija();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith("crit-") && f.endsWith(".db"))
    .map((f) => {
      const p = path.join(dir, f);
      const s = fs.statSync(p);
      return { f, p, t: s.mtimeMs, velicina: s.size };
    })
    .sort((a, b) => b.t - a.t); // najnovija prva
}

// ---- 1) Logovi: starost, pa broj ----
//
// Posle sečenja po starosti, ako redova i dalje ima previše, brišu se
// najstariji dok se ne dođe do granice.
export function ocistiLogove(o = podesavanja(), aktivnaSmenaId = null) {
  const granica = Date.now() - o.logDana * 86400000;
  let poStarosti = 0, poBroju = 0;
  try {
    // Logovi otvorene smene se ne diraju (bez njih obračun smene nema podataka).
    poStarosti = Number(
      (aktivnaSmenaId
        ? db.prepare("DELETE FROM logs WHERE ts < ? AND (shift_id IS NULL OR shift_id != ?)").run(granica, aktivnaSmenaId)
        : db.prepare("DELETE FROM logs WHERE ts < ?").run(granica)
      ).changes) || 0;

    const ukupno = db.prepare("SELECT COUNT(*) c FROM logs").get().c;
    if (ukupno > o.logNajvise) {
      const visak = ukupno - o.logNajvise;
      poBroju = Number(db.prepare(
        "DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY ts ASC, id ASC LIMIT ?)"
      ).run(visak).changes) || 0;
    }
  } catch (e) { console.error("čišćenje logova:", e.message); }
  return { poStarosti, poBroju };
}

export function ocistiPokretanja(o = podesavanja()) {
  try {
    const granica = Date.now() - o.pokretanjaDana * 86400000;
    return Number(db.prepare("DELETE FROM game_launches WHERE at < ?").run(granica).changes) || 0;
  } catch { return 0; }
}

// ---- 2) Rezervne kopije: proređivanje kroz vreme ----
//
//   poslednjih 12          oko 3 sata unazad, na 15 minuta
//   po jedna dnevno        poslednje dve nedelje
//   po jedna nedeljno      poslednja dva meseca
export function srediKopije(o = podesavanja()) {
  const sve = spisakKopija();
  if (!sve.length) return { obrisano: 0, zadrzano: 0, ukupnoMB: 0 };

  const cuvaj = new Set();
  sve.slice(0, o.kopijaSvezih).forEach((k) => cuvaj.add(k.f));

  const kljucDana = (t) => new Date(t).toISOString().slice(0, 10);
  const kljucNedelje = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-n${Math.floor(d.getTime() / 604800000)}`; };
  const najnovijePo = (kljuc, koliko) => {
    const videno = new Map();
    for (const k of sve) {                    // već poređano od najnovije
      const kl = kljuc(k.t);
      if (!videno.has(kl)) videno.set(kl, k);
    }
    [...videno.values()].slice(0, koliko).forEach((k) => cuvaj.add(k.f));
  };
  najnovijePo(kljucDana, o.kopijaDana);
  najnovijePo(kljucNedelje, o.kopijaNedelja);

  let obrisano = 0;
  for (const k of sve) {
    if (cuvaj.has(k.f)) continue;
    try { fs.unlinkSync(k.p); obrisano++; } catch {}
  }

  // Granica ukupne veličine: briše se najstarija, ali pet najnovijih ostaje uvek.
  let preostale = spisakKopija();
  let ukupno = preostale.reduce((z, k) => z + k.velicina, 0);
  while (ukupno > o.kopijeMB * MB && preostale.length > 5) {
    const najstarija = preostale[preostale.length - 1];
    try { fs.unlinkSync(najstarija.p); obrisano++; ukupno -= najstarija.velicina; } catch { break; }
    preostale.pop();
  }
  return { obrisano, zadrzano: preostale.length, ukupnoMB: Math.round(ukupno / MB) };
}

// ---- 3) STANJE SKLADIŠTA (za panel) ----
export function stanjeSkladista() {
  const o = podesavanja();
  let bazaBajta = 0;
  for (const f of ["crit.db", "crit.db-wal", "crit.db-shm"]) {
    try { bazaBajta += fs.statSync(path.join(DATA_DIR, f)).size; } catch {}
  }
  const kopije = spisakKopija();
  const kopijeBajta = kopije.reduce((z, k) => z + k.velicina, 0);
  // Slike se broje posebno; obično zauzimaju više od same baze.
  let slikeBajta = 0, slikaKomada = 0;
  try {
    for (const f of fs.readdirSync(path.join(DATA_DIR, "uploads"))) {
      try { slikeBajta += fs.statSync(path.join(DATA_DIR, "uploads", f)).size; slikaKomada++; } catch {}
    }
  } catch {}
  const slobodno = slobodnoNaDisku();
  const red = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return 0; } };
  return {
    // I u bajtovima: nova baza je manja od megabajta.
    bazaBajta, kopijeBajta, slikeBajta, slikaKomada,
    bazaMB: Math.round(bazaBajta / MB * 10) / 10,
    slikeMB: Math.round(slikeBajta / MB * 10) / 10,
    kopijaKomada: kopije.length,
    kopijeMB: Math.round(kopijeBajta / MB * 10) / 10,
    najstarijaKopija: kopije.length ? kopije[kopije.length - 1].t : null,
    // Stanje kopije van računara ide uz brojke o prostoru.
    vanRacunara: kopijaVanPodesavanja(),
    slobodnoMB: slobodno === null ? null : Math.round(slobodno / MB),
    maloMesta: slobodno !== null && slobodno < o.diskMB * MB,
    redovi: { logs: red("logs"), sessions: red("sessions"), game_launches: red("game_launches"),
      orders: red("orders"), transactions: red("transactions") },
    granice: o,
  };
}

// ---- 4) Pravljenje kopije ----
//
// Ovde, a ne u db.js, jer ide uz proređivanje i proveru diska.
export function backupDb() {
  try {
    const dir = folderKopija();
    fs.mkdirSync(dir, { recursive: true });

    // Kad je disk pri kraju, kopija se preskače.
    const dozvola = smeKopija();
    if (!dozvola.sme) {
      console.error(`backup preskočen: na disku je ostalo ${dozvola.slobodnoMB} MB`);
      return null;
    }

    // Ime sa milisekundama: VACUUM INTO ne piše preko postojećeg fajla, a dve
    // kopije u istoj sekundi (ručna i automatska) su moguće.
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
    let dest = path.join(dir, `crit-${ts}.db`).replace(/\\/g, "/");
    for (let i = 2; fs.existsSync(dest) && i < 100; i++) {
      dest = path.join(dir, `crit-${ts}-${i}.db`).replace(/\\/g, "/");
    }
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    srediKopije();
    return dest;
  } catch (e) {
    console.error("backup neuspešan:", e.message);
    return null;
  }
}

// ---- 5) Kopija van računara ----
//
// Baza i sve rezervne kopije su na istom disku. Jednom dnevno se najsvežija
// kopija prepisuje na drugo odredište (USB, drugi disk, mrežni folder).
// Dok odredište nije upisano, ovo ne radi ništa, a panel stoji žuto.
const KOPIJA_PUT = "kopija_van_putanja";
const KOPIJA_KAD = "kopija_van_poslednja";
const KOPIJA_GRESKA = "kopija_van_greska";
export const KOPIJA_VAN_ZADRZI = 7;   // koliko dana unazad stoji na odredištu
const KOPIJA_VAN_ZASTARELA = 2 * 86400000; // starija od ovoga = panel crveni

// Sve što dira odredište je asinhrono i ima rok: sinhroni poziv ka mrežnoj
// putanji koja ne odgovara ume da blokira server i po minut. Poziv koji pređe
// rok i dalje zauzima nit za rad sa diskom, pa novo kopiranje ne kreće dok on
// ne završi.
const ROK_ODREDISTA_MS = Number(process.env.ROK_ODREDISTA_MS) || 20000;
const ROK_KOPIRANJA_MS = 10 * 60 * 1000; // sama baza preko spore mreže
let zaglavljeno = 0; // pozivi ka odredištu koji su prešli rok, a još nisu završeni

function saRokom(obecanje, ms, sta) {
  let tajmer, istekao = false;
  const rok = new Promise((_, ne) => {
    tajmer = setTimeout(() => {
      istekao = true;
      zaglavljeno++;
      ne(Object.assign(new Error(`${sta}: odredište ne odgovara`), { code: "ROK" }));
    }, ms);
    tajmer.unref?.();
  });
  obecanje.then(() => {}, () => {}).finally(() => {
    clearTimeout(tajmer);
    if (istekao) zaglavljeno--;
  });
  return Promise.race([obecanje, rok]);
}
// Stat koji "ne postoji" vraća kao null, a rok i dalje baca.
const statIliNista = (p, sta) => saRokom(fsp.stat(p), ROK_ODREDISTA_MS, sta)
  .catch((e) => { if (e?.code === "ROK") throw e; return null; });

export function kopijaVanPodesavanja() {
  const putanja = getSetting(KOPIJA_PUT, "") || "";
  const kad = Number(getSetting(KOPIJA_KAD, "")) || null;
  const greska = getSetting(KOPIJA_GRESKA, "") || null;
  // Stanja: nepodesena, nikad, uredna, pala, zastarela. "pala" se proverava pre
  // starosti: sveža kopija uz poslednji neuspeh znači da je odredište nestalo.
  let stanje = "uredna";
  if (!putanja) stanje = "nepodesena";
  else if (greska) stanje = "pala";
  else if (!kad) stanje = "nikad";
  else if (Date.now() - kad > KOPIJA_VAN_ZASTARELA) stanje = "zastarela";
  return { putanja, ukljucena: !!putanja, poslednja: kad, greska, stanje, zadrzi: KOPIJA_VAN_ZADRZI };
}

export async function postaviKopijuVan(putanja) {
  const p = String(putanja ?? "").trim();
  if (!p) {
    setSetting(KOPIJA_PUT, "");
    setSetting(KOPIJA_GRESKA, "");
    return { ok: true, ...kopijaVanPodesavanja() };
  }
  // Odredište se proverava odmah pri čuvanju, dok vlasnik gleda u ekran.
  try {
    await saRokom(fsp.mkdir(p, { recursive: true }), ROK_ODREDISTA_MS, "pravljenje foldera");
    const proba = path.join(p, ".crit-proba");
    await saRokom(fsp.writeFile(proba, "proba"), ROK_ODREDISTA_MS, "probni upis");
    await saRokom(fsp.unlink(proba), ROK_ODREDISTA_MS, "brisanje probe");
  } catch (e) {
    const razlog = e?.code === "ROK" ? "odredište ne odgovara" : (e?.code || e?.message);
    return { error: `Ne mogu da pišem u "${p}": ${razlog}. Proveri da li je disk priključen i da putanja postoji.` };
  }
  setSetting(KOPIJA_PUT, p);
  setSetting(KOPIJA_GRESKA, "");
  return { ok: true, ...kopijaVanPodesavanja() };
}

// Slike uz kopiju baze: kopira se samo ono čega na odredištu nema ili je druge
// veličine. Sa odredišta se ništa ne briše.
async function kopirajSlike(cilj) {
  const izvor = path.join(DATA_DIR, "uploads");
  let imena = [];
  try { imena = fs.readdirSync(izvor); } catch { return { preskoceno: "nema slika" }; }
  const dir = path.join(cilj, "slike");
  try { await saRokom(fsp.mkdir(dir, { recursive: true }), ROK_ODREDISTA_MS, "folder za slike"); }
  catch (e) { if (e?.code === "ROK") throw e; return { greska: e?.code || e?.message }; }
  let novih = 0, preskoceno = 0;
  for (const ime of imena) {
    const s = path.join(izvor, ime), d = path.join(dir, ime);
    let izv;
    try { izv = fs.statSync(s); } catch { continue; } // lokalni disk
    if (!izv.isFile()) continue;
    const tamo = await statIliNista(d, "provera slike");
    if (tamo && tamo.size === izv.size) { preskoceno++; continue; }
    try {
      await saRokom(fsp.copyFile(s, d), ROK_ODREDISTA_MS, "kopiranje slike");
      novih++;
    } catch (e) { if (e?.code === "ROK") throw e; }
  }
  return { novih, preskoceno };
}

// Najsvežija kopija na odredište, uz proređivanje tamošnjih. Ne baca; dva
// poziva odjednom (dnevno održavanje i dugme u panelu) dele isti posao.
let kopiranjeUToku = null;
export function kopirajVanRacunara() {
  if (!kopiranjeUToku) kopiranjeUToku = kopirajSada().finally(() => { kopiranjeUToku = null; });
  return kopiranjeUToku;
}

async function kopirajSada() {
  const cilj = getSetting(KOPIJA_PUT, "") || "";
  if (!cilj) return { preskoceno: "nije podešeno" };
  if (zaglavljeno > 0) {
    const poruka = "odredište ne odgovara (prethodno kopiranje još nije završeno)";
    setSetting(KOPIJA_GRESKA, poruka);
    return { error: poruka, cilj };
  }
  const sve = spisakKopija();
  if (!sve.length) return { preskoceno: "nema kopija" };
  const izvor = sve[0];
  try {
    // Odredište se ovde samo proverava, ne pravi: ako ga nema, medij je nestao
    // (izvučen USB, odjavljen mrežni disk), a `mkdir` bi napravio prazan folder
    // na sistemskom disku i kopija bi "uspela" na istom disku. Nepostojeće
    // odredište je greška.
    const st = await statIliNista(cilj, "provera odredišta");
    if (!st || !st.isDirectory()) {
      throw Object.assign(new Error("odredište nije dostupno"), { code: "NEMA_ODREDISTA" });
    }
    const dest = path.join(cilj, izvor.f);
    // Kopija koja je već na odredištu se ne prepisuje.
    const postojeca = await statIliNista(dest, "provera kopije");
    if (!postojeca || postojeca.size !== izvor.velicina) {
      await saRokom(fsp.copyFile(izvor.p, dest), ROK_KOPIRANJA_MS, "kopiranje baze");
    }
    // Na odredištu se drži poslednjih nekoliko, da USB ne nabuja.
    const tamo = (await saRokom(fsp.readdir(cilj), ROK_ODREDISTA_MS, "čitanje odredišta"))
      .filter((f) => f.startsWith("crit-") && f.endsWith(".db"))
      .map((f) => ({ f, p: path.join(cilj, f) }))
      .sort((a, b) => (a.f < b.f ? 1 : -1)); // ime nosi vreme, pa se ređa po njemu
    let obrisano = 0;
    for (const k of tamo.slice(KOPIJA_VAN_ZADRZI)) {
      try { await saRokom(fsp.unlink(k.p), ROK_ODREDISTA_MS, "brisanje stare kopije"); obrisano++; }
      catch (e) { if (e?.code === "ROK") throw e; }
    }
    // Slike idu zajedno sa bazom.
    const slike = await kopirajSlike(cilj);
    setSetting(KOPIJA_KAD, String(Date.now()));
    setSetting(KOPIJA_GRESKA, "");
    return { ok: true, fajl: izvor.f, cilj, obrisano, slike };
  } catch (e) {
    const poruka = e?.code === "NEMA_ODREDISTA"
      ? "odredište nije dostupno (disk nije priključen ili je folder obrisan)"
      : e?.code === "ROK"
        ? "odredište ne odgovara (mrežni disk ili USB se ne javlja)"
        : `${e?.code || e?.message}`;
    setSetting(KOPIJA_GRESKA, poruka);
    return { error: poruka, cilj };
  }
}

// Sve osim kopije van računara, jednom dnevno i pri pokretanju servera.
// Kopiju van računara pozivalac pokreće posebno (asinhrona je).
export function odrzavanje(aktivnaSmenaId = null) {
  const o = podesavanja();
  const logovi = ocistiLogove(o, aktivnaSmenaId);
  const pokretanja = ocistiPokretanja(o);
  const kopije = srediKopije(o);
  const s = stanjeSkladista();
  return { logovi, pokretanja, kopije, stanje: s };
}

// Da li sme nova kopija. Kad je disk pri kraju, prvo se brišu stare kopije;
// ako ni to ne pomogne, kopija se preskače.
export function smeKopija(o = podesavanja()) {
  let slobodno = slobodnoNaDisku();
  if (slobodno === null) return { sme: true };
  if (slobodno >= o.diskMB * MB) return { sme: true };

  srediKopije({ ...o, kopijaSvezih: 5, kopijaDana: 3, kopijaNedelja: 2 });
  slobodno = slobodnoNaDisku();
  if (slobodno >= o.diskMB * MB) return { sme: true, oslobodjeno: true };
  return { sme: false, slobodnoMB: Math.round(slobodno / MB) };
}
