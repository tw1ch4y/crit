// ODRŽAVANJE: da disk nikad ne pukne i da baza ne buja bez kraja.
//
// Glavni računar u igraonici niko neće održavati. Uključi se ujutru, radi ceo
// dan i tako godinama. Sve što raste bez granice pre ili kasnije napuni disk, a
// kad disk stane, server ne može da piše i CELA igraonica staje - niko se ne
// prijavljuje, kasa ne radi, sesije se ne naplaćuju. To je najskuplji mogući
// kvar, i jedini koji se sasvim sigurno desi ako se ništa ne uradi.
//
// Mereno na napunjenoj bazi (testovi/godina-rada.mjs), igraonica sa 13 računara:
//
//   posle godinu dana    baza 35 MB, 228.000 redova u logovima
//   30 rezervnih kopija  1.06 GB      <- ovo je pravi problem, ne baza
//
// Zato ovde stoje tri kočnice:
//   1. logovi se seku po STAROSTI i po BROJU (šta pre dođe)
//   2. rezervne kopije se prorede kroz vreme i imaju granicu ukupne veličine
//   3. pre pravljenja kopije se gleda koliko je diska ostalo
import fs from "node:fs";
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

// ---- 1) LOGOVI: starost pa količina ----
//
// Prvo se seče po starosti. Ako i posle toga ima previše redova (dan sa
// turnirom ume da napravi višestruko više zapisa nego običan), briše se
// NAJSTARIJI red da bi novi imao mesto - dokle god se ne dođe do granice.
export function ocistiLogove(o = podesavanja(), aktivnaSmenaId = null) {
  const granica = Date.now() - o.logDana * 86400000;
  let poStarosti = 0, poBroju = 0;
  try {
    // Logovi smene koja je JOŠ OTVORENA se ne diraju ni ako su stariji: bez njih
    // obračun te smene ostaje bez podataka.
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

// ---- 2) REZERVNE KOPIJE: proređivanje kroz vreme ----
//
// Ranije se čuvalo poslednjih 30 kopija. Pošto se prave na 15 minuta, to je
// svega sedam i po sati unazad: greška primećena sledeće jutro više nije imala
// gde da se vrati, a 30 punih kopija je posle godinu dana zauzimalo preko
// gigabajta. Zato se sad čuva gusto blizu, retko daleko:
//
//   poslednjih 12          oko 3 sata unazad, na svakih 15 minuta
//   po jedna dnevno        poslednje dve nedelje
//   po jedna nedeljno      poslednja dva meseca
//
// Isti broj fajlova pokriva dva meseca umesto sedam sati.
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

  // Gornja granica ukupne veličine. Briše se najstarija dok se ne stane u
  // granicu, ali se najsvežijih pet ne dira ni po koju cenu - bez ijedne
  // skorašnje kopije rezervna kopija ne znači ništa.
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
  const slobodno = slobodnoNaDisku();
  const red = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return 0; } };
  return {
    // I bajtovi, jer nova igraonica ima bazu manju od megabajta - zaokruženo na
    // MB to je nula i u panelu izgleda kao da nešto ne radi.
    bazaBajta, kopijeBajta,
    bazaMB: Math.round(bazaBajta / MB * 10) / 10,
    kopijaKomada: kopije.length,
    kopijeMB: Math.round(kopijeBajta / MB * 10) / 10,
    najstarijaKopija: kopije.length ? kopije[kopije.length - 1].t : null,
    // Kopija na istom disku ne pomaže kad disk otkaže - zato stanje odredišta
    // van računara stoji tu, uz brojke o prostoru, a ne u zasebnom uglu.
    vanRacunara: kopijaVanPodesavanja(),
    slobodnoMB: slobodno === null ? null : Math.round(slobodno / MB),
    maloMesta: slobodno !== null && slobodno < o.diskMB * MB,
    redovi: { logs: red("logs"), sessions: red("sessions"), game_launches: red("game_launches"),
      orders: red("orders"), transactions: red("transactions") },
    granice: o,
  };
}

// ---- 4) PRAVLJENJE KOPIJE ----
//
// Stoji ovde, a ne u db.js, jer bez proređivanja i provere diska kopija nije
// zaštita nego način da se disk napuni.
export function backupDb() {
  try {
    const dir = folderKopija();
    fs.mkdirSync(dir, { recursive: true });

    // Ako je disk pri kraju, kopija se preskače. Puna kopija baze na disku bez
    // mesta je najbrži način da stane i sama baza, a tada staje cela igraonica.
    const dozvola = smeKopija();
    if (!dozvola.sme) {
      console.error(`backup preskočen: na disku je ostalo ${dozvola.slobodnoMB} MB`);
      return null;
    }

    // VACUUM INTO ODBIJA da piše preko postojećeg fajla. Dok je ime imalo
    // tačnost od sekunde, dve kopije u istoj sekundi su davale isto ime i druga
    // je tiho pucala uz "Backup nije uspeo" - a to se dešava kad vlasnik
    // pritisne "Napravi kopiju sada" baš dok kreće automatska (na 15 min), ili
    // dvaput zaredom. Sa milisekundama imena su jedinstvena, iste su dužine, pa
    // se i ispravno ređaju po vremenu.
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

// ---- 5) KOPIJA VAN RAČUNARA ----
//
// Sve iznad pazi da disk ne pukne. Ništa od toga ne pomaže kad disk OTKAŽE -
// a baza i svih trideset kopija stoje na istom fizičkom disku. Tog dana nestaje
// sve: nalozi, kredit koji su gosti uplatili, promet, cela evidencija.
//
// Zato se najsvežija kopija jednom dnevno prepiše NEGDE DRUGDE: USB koji stalno
// stoji u računaru, drugi disk, mrežni folder. Panel može da preuzme kopiju i
// ručno, ali ručno znači da neko mora da se seti - a neće, jer se seti tek kad
// zatreba.
//
// Odredište je prazno dok ga vlasnik ne upiše (Podešavanja > Rezervne kopije).
// Dok je prazno, ovo ne radi ništa i ne javlja grešku - ali panel stoji žut,
// da se ne zaboravi.
const KOPIJA_PUT = "kopija_van_putanja";
const KOPIJA_KAD = "kopija_van_poslednja";
const KOPIJA_GRESKA = "kopija_van_greska";
export const KOPIJA_VAN_ZADRZI = 7;   // koliko dana unazad stoji na odredištu
const KOPIJA_VAN_ZASTARELA = 2 * 86400000; // starija od ovoga = panel crveni

export function kopijaVanPodesavanja() {
  const putanja = getSetting(KOPIJA_PUT, "") || "";
  const kad = Number(getSetting(KOPIJA_KAD, "")) || null;
  const greska = getSetting(KOPIJA_GRESKA, "") || null;
  // Stanja umesto "radi / ne radi": svako traži drugačiji potez od vlasnika, pa
  // panel za svako ima svoju boju i svoj tekst.
  //
  // "pala" se gleda PRE starosti, i to je bitno: kopija od jutros je i dalje
  // sveža, ali ako je poslednji pokušaj pukao, USB je već iščupan i sutra
  // kopije neće biti. Da se gledala samo starost, upozorenje bi kasnilo dva dana.
  let stanje = "uredna";
  if (!putanja) stanje = "nepodesena";
  else if (greska) stanje = "pala";
  else if (!kad) stanje = "nikad";
  else if (Date.now() - kad > KOPIJA_VAN_ZASTARELA) stanje = "zastarela";
  return { putanja, ukljucena: !!putanja, poslednja: kad, greska, stanje, zadrzi: KOPIJA_VAN_ZADRZI };
}

export function postaviKopijuVan(putanja) {
  const p = String(putanja ?? "").trim();
  if (!p) {
    setSetting(KOPIJA_PUT, "");
    setSetting(KOPIJA_GRESKA, "");
    return { ok: true, ...kopijaVanPodesavanja() };
  }
  // Odredište se proverava ODMAH, dok vlasnik gleda u ekran. Kad bi se prvi put
  // pisalo tek u ponoć, pogrešno otkucana putanja bi se otkrila tek onog dana
  // kad kopija zatreba - a tada je kasno.
  try {
    fs.mkdirSync(p, { recursive: true });
    const proba = path.join(p, ".crit-proba");
    fs.writeFileSync(proba, "proba");
    fs.unlinkSync(proba);
  } catch (e) {
    return { error: `Ne mogu da pišem u "${p}": ${e.code || e.message}. Proveri da li je disk priključen i da putanja postoji.` };
  }
  setSetting(KOPIJA_PUT, p);
  setSetting(KOPIJA_GRESKA, "");
  return { ok: true, ...kopijaVanPodesavanja() };
}

// Prepiše najsvežiju kopiju na odredište i proredi tamošnje.
// Nikad ne baca: odredište je po prirodi nepouzdano (iščupan USB, mreža pala),
// a to ne sme da obori održavanje ni server.
export function kopirajVanRacunara() {
  const cilj = getSetting(KOPIJA_PUT, "") || "";
  if (!cilj) return { preskoceno: "nije podešeno" };
  const sve = spisakKopija();
  if (!sve.length) return { preskoceno: "nema kopija" };
  const izvor = sve[0];
  try {
    // ODREDIŠTE SE NE PRAVI OVDE, NEGO SAMO PROVERAVA.
    //
    // Folder se pravi jednom, kad ga vlasnik upiše i dok gleda u ekran. Ako ga
    // ovde nema, to znači da je nestao medij - iščupan USB, odjavljen mrežni
    // disk. Sa `mkdirSync` bi se u tom trenutku napravio NOV PRAZAN folder na
    // sistemskom disku, kopija bi se uredno upisala u njega i javilo bi se da
    // je sve u redu. Vlasnik bi mesecima gledao zeleno stanje, a jedini primerak
    // baze bi i dalje bio na jednom disku - i to bi se otkrilo tek onog dana kad
    // kopija zatreba. Zato je nepostojeće odredište GREŠKA, ne posao.
    if (!fs.existsSync(cilj)) {
      throw Object.assign(new Error("odredište nije dostupno"), { code: "NEMA_ODREDISTA" });
    }
    const dest = path.join(cilj, izvor.f);
    // Ista kopija se ne prepisuje drugi put - dnevno pokretanje bi inače
    // svaki put nanovo pisalo isti fajl na USB bez potrebe.
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== izvor.velicina) {
      fs.copyFileSync(izvor.p, dest);
    }
    // Na odredištu se drži poslednjih nekoliko, da USB ne nabuja.
    const tamo = fs.readdirSync(cilj)
      .filter((f) => f.startsWith("crit-") && f.endsWith(".db"))
      .map((f) => ({ f, p: path.join(cilj, f) }))
      .sort((a, b) => (a.f < b.f ? 1 : -1)); // ime nosi vreme, pa se ređa po njemu
    let obrisano = 0;
    for (const k of tamo.slice(KOPIJA_VAN_ZADRZI)) { try { fs.unlinkSync(k.p); obrisano++; } catch {} }
    setSetting(KOPIJA_KAD, String(Date.now()));
    setSetting(KOPIJA_GRESKA, "");
    return { ok: true, fajl: izvor.f, cilj, obrisano };
  } catch (e) {
    const poruka = e.code === "NEMA_ODREDISTA"
      ? "odredište nije dostupno (disk nije priključen ili je folder obrisan)"
      : `${e.code || e.message}`;
    setSetting(KOPIJA_GRESKA, poruka);
    return { error: poruka, cilj };
  }
}

// Sve odjednom: jednom dnevno i pri pokretanju servera.
export function odrzavanje(aktivnaSmenaId = null) {
  const o = podesavanja();
  const logovi = ocistiLogove(o, aktivnaSmenaId);
  const pokretanja = ocistiPokretanja(o);
  const kopije = srediKopije(o);
  const vanRacunara = kopirajVanRacunara();
  const s = stanjeSkladista();
  return { logovi, pokretanja, kopije, vanRacunara, stanje: s };
}

// Da li uopšte sme da se pravi nova kopija.
//
// Ako je disk pri kraju, prvo se pokuša oslobađanje brisanjem starih kopija.
// Ako ni to ne pomogne, kopija se preskače: bolje ostati bez jedne kopije nego
// napuniti disk do kraja, jer tada prestaje da radi i sama baza.
export function smeKopija(o = podesavanja()) {
  let slobodno = slobodnoNaDisku();
  if (slobodno === null) return { sme: true };
  if (slobodno >= o.diskMB * MB) return { sme: true };

  srediKopije({ ...o, kopijaSvezih: 5, kopijaDana: 3, kopijaNedelja: 2 });
  slobodno = slobodnoNaDisku();
  if (slobodno >= o.diskMB * MB) return { sme: true, oslobodjeno: true };
  return { sme: false, slobodnoMB: Math.round(slobodno / MB) };
}
