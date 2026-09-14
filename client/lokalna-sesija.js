// LOKALNA SESIJA: LAUNCHER VODI SESIJU I KAD SERVERA NEMA
//
// Do sada je jedino server znao koliko je igraču ostalo. Kad ga nema - ugašen
// glavni računar, zatvoren prozor servera, iščupan kabl, resetovan ruter -
// launcher je prekrivao ekran natpisom "Povezivanje" i zaustavljao sat. Igra je
// iza toga radila dalje, i to BESPLATNO: vreme se nije trošilo, računar se nije
// zaključavao. Isto je dobijao i igrač koji sam iščupa svoj mrežni kabl.
//
// Sada launcher broji sam dok server ćuti:
//   - sat ide dalje i računar se zaključa kad kredit istekne, kao i inače
//   - igrač sme da se odjavi, i tada mu ostatak kredita ostaje
//   - stanje se piše na disk, pa preživi i pad launchera i restart računara
//   - kad se server vrati, launcher mu javi KOLIKO JE SEKUNDI SESIJA TRAJALA,
//     a server naplati razliku između toga i onoga što je već naplatio
//
// ZAŠTO BROJ SEKUNDI, A NE "OD KAD DO KAD"
//
// Oba kraja broje isto: server koliko je sekundi naplatio u sesiji, launcher
// koliko je sekundi sesija trajala dok je on radio. Razlika je tačno ono što
// nije naplaćeno - bez poređenja satova dva računara. Nema ni duple naplate za
// onih do pola minuta dok server još ne zna da veze nema: tada su brojala oba,
// pa se razlika poništi sama. I isti izveštaj poslat dvaput (odgovor se izgubi
// kad veza opet pukne) ne naplaćuje dvaput: drugi put je razlika nula.
//
// Sekunde se broje monotonim satom i najviše pet po otkucaju. Računar koji je
// ostao bez struje ne broji ništa dok ne proradi - igrač tada nije igrao, pa
// ni ne plaća. Pomeren sistemski sat ne pomera ništa.
//
// ZAŠTO POTPIS
//
// Zapis stoji u nalogu igrača, pa ga igrač može i otvoriti. Potpis (HMAC sa
// ključem iz tokena računara) ne čini to nemogućim - šta launcher može da
// pročita, može i igrač - ali ruka koja prepravi broj u fajlu više ne prolazi,
// a ni fajl koji se pokvari pri nestanku struje ne biva shvaćen kao istina.
// Da bi se zapis uopšte iskoristio, launcher mora da bude ugašen; a ko ume da
// ugasi launcher, već je izašao iz kioska i ovo mu ni ne treba.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHmac, createHash, timingSafeEqual } = require("node:crypto");

const VERZIJA = 1;
const NAJVISE_PO_TIKU = 5; // sekundi
const SNIMI_NAJREDJE_MS = 10000;
const KRAJEVI = new Set(["odjava", "vreme", "osoblje"]);

// JSON sa ključevima uvek istim redom. Potpis se računa nad TEKSTOM, a
// JSON.stringify piše ključeve redom kojim su dodati - isti podaci sklopljeni
// drugim redom dali bi drugi potpis. Ista funkcija stoji i na serveru
// (server/src/offline.js); test proverava da daju isto.
function kanonski(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(kanonski).join(",") + "]";
  return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ":" + kanonski(v[k])).join(",") + "}";
}

const kljuc = (token) => createHash("sha256").update("crit-lokalna-sesija|" + String(token || "")).digest();

function potpisi(podaci, token) {
  return createHmac("sha256", kljuc(token)).update(kanonski(podaci)).digest("hex");
}

function potpisJeIspravan(podaci, potpis, token) {
  if (typeof potpis !== "string" || !/^[0-9a-f]{64}$/.test(potpis)) return false;
  const a = Buffer.from(potpisi(podaci, token), "hex");
  const b = Buffer.from(potpis, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// UPIS JE ATOMSKI: prvo pored, pa preimenovanje preko starog.
//
// Upis direktno u fajl koji prekine nestanak struje ostavi pola JSON-a - i
// posle toga nema ni starog stanja ni novog. Preimenovanje je jedan korak koji
// se ili desi ili ne desi, pa na disku uvek stoji jedna cela verzija.
function snimiPotpisano(putanja, podaci, token, fsx = fs) {
  const telo = JSON.stringify({ podaci, potpis: potpisi(podaci, token) });
  fsx.mkdirSync(path.dirname(putanja), { recursive: true });
  const privremeni = putanja + ".novo";
  fsx.writeFileSync(privremeni, telo, "utf8");
  fsx.renameSync(privremeni, putanja);
}

// Vraća { podaci, razlog }. razlog: null | "nema" | "ostecen" | "potpis"
function ucitajPotpisano(putanja, token, fsx = fs) {
  let sirovo;
  try { sirovo = fsx.readFileSync(putanja, "utf8"); } catch { return { podaci: null, razlog: "nema" }; }
  let o;
  try { o = JSON.parse(sirovo); } catch { return { podaci: null, razlog: "ostecen" }; }
  if (!o || typeof o !== "object" || !("podaci" in o)) return { podaci: null, razlog: "ostecen" };
  if (!potpisJeIspravan(o.podaci, o.potpis, token)) return { podaci: null, razlog: "potpis" };
  return { podaci: o.podaci, razlog: null };
}

const broj = (x, podrazumevano = 0) => {
  const n = Number(x);
  return x !== null && x !== "" && Number.isFinite(n) ? n : podrazumevano;
};
const naDecimalu = (x) => Math.round(x * 10) / 10;
const naPare = (x) => Math.round(x * 100) / 100;
const podrazumevaniMonoton = () => Number(process.hrtime.bigint() / 1000000n);

class LokalnaSesija {
  /**
   * @param {object} o
   * @param {string} o.putanja  gde se stanje čuva
   * @param {string} o.token    token računara - od njega je ključ potpisa
   * Sat, monotoni sat i fs se ubacuju zbog testova.
   */
  constructor({ putanja, token, sat = Date.now, monoton = podrazumevaniMonoton, fsx = fs } = {}) {
    this.putanja = putanja;
    this.token = token;
    this.sat = sat;
    this.monoton = monoton;
    this.fsx = fsx;
    this.s = null;
    this.naVezi = false;
    this.cena = 0; // cena po satu iz "welcome"
    this.poslednjiMono = monoton();
    this.poslednjiUpis = 0;
    this.neispravanZapis = null;
    this.greskaUpisa = null;
  }

  postaviToken(token) { this.token = token; }

  // Cena po satu stiže uz "welcome". Dok je veza živa, važi poslednja poznata;
  // bez servera se broji po onoj koju je igrač poslednju video.
  postaviCenu(cena) {
    const c = broj(cena, NaN);
    if (!(c >= 0)) return;
    this.cena = c;
    if (this.s && !this.s.kraj && !this.s.nepotvrdjeno) this.s.cena = c;
  }

  postaviVezu(naVezi) { this.naVezi = !!naVezi; }

  // Prijava (login_ok).
  zapocni(msg) {
    const sesija = broj(msg?.session?.id, NaN);
    if (!Number.isInteger(sesija)) return false;
    const igrac = {
      id: broj(msg?.player?.id, null),
      username: String(msg?.player?.username || ""),
      displayName: String(msg?.player?.displayName || msg?.player?.username || ""),
    };
    // ISTA SESIJA ČIJI IZVEŠTAJ JOŠ NIJE POTVRĐEN: brojač se ne dira.
    //
    // Server od verzije koja ovo zna ne vraća sesiju pre izveštaja. Ali stariji
    // server ga ne zna, pa vrati sesiju odmah - a zapis bi se tada obrisao sa
    // svim sekundama odigranim bez veze.
    if (this.s && this.s.sesija === sesija && this.s.nepotvrdjeno && !this.s.kraj) {
      this.s.igrac = igrac;
      this.snimi(true);
      return true;
    }
    const podrzava = !!msg.session && "sekundi" in msg.session;
    const kredit = broj(msg.balance);
    let cena = this.cena;
    if (msg.remainingSeconds === null) cena = 0; // server: bez naplate
    else if (!(cena > 0) && broj(msg.remainingSeconds) > 0) cena = (kredit / broj(msg.remainingSeconds)) * 3600;
    this.s = {
      v: VERZIJA,
      sesija,
      igrac,
      cena,
      kredit,
      sekundiServer: podrzava ? broj(msg.session.sekundi) : 0,
      odSinhronizacije: 0,
      podrzava,
      nepotvrdjeno: false,
      offlineOd: null,
      kraj: null,
      krajKad: null,
    };
    this.poslednjiMono = this.monoton();
    this.snimi(true);
    return true;
  }

  // Stanje sa servera (balance).
  sinhronizuj(msg) {
    if (!this.s || this.s.kraj || !msg) return false;
    if ("sesija" in msg && msg.sesija !== this.s.sesija) return false;

    if ("sekundi" in msg) {
      // Naplata servera. Dok izveštaj o radu bez veze nije potvrđen, ove brojke
      // su iz vremena PRE obračuna i ne smeju da pregaze brojač.
      if (this.s.nepotvrdjeno) return false;
      this.s.kredit = broj(msg.balance, this.s.kredit);
      this.s.sekundiServer = broj(msg.sekundi, this.s.sekundiServer);
      this.s.odSinhronizacije = 0;
      this.s.podrzava = true;
      if (msg.remainingSeconds === null) this.s.cena = 0;
      else if (this.cena > 0) this.s.cena = this.cena;
      this.snimi(false);
      return true;
    }
    if (this.s.podrzava) {
      // Dopuna, točak, porudžbina: menja se samo kredit. Stanje sa servera je
      // stanje posle poslednje naplate, a sekunde od te naplate i dalje stoje.
      this.s.kredit = broj(msg.balance, this.s.kredit);
      this.snimi(true);
      return true;
    }
    // Stariji server: ne broji sekunde i ne prima izveštaj. Launcher i dalje
    // zaključa računar kad lokalno istekne, ali posle povratka ne javlja ništa.
    this.s.kredit = broj(msg.balance, this.s.kredit);
    this.s.sekundiServer += this.s.odSinhronizacije;
    this.s.odSinhronizacije = 0;
    this.s.nepotvrdjeno = false;
    this.s.offlineOd = null;
    this.snimi(false);
    return true;
  }

  // Otkucaj, jednom u sekundi.
  tik() {
    const sada = this.monoton();
    let delta = (sada - this.poslednjiMono) / 1000;
    this.poslednjiMono = sada;
    if (!(delta > 0)) delta = 0;
    if (delta > NAJVISE_PO_TIKU) delta = NAJVISE_PO_TIKU;
    if (!this.s || this.s.kraj) return;
    if (delta > 0) {
      this.s.odSinhronizacije += delta;
      // Svaka sekunda odbrojana bez veze mora da se prijavi, pa i ona posle
      // restarta launchera koji je do tada bio na vezi.
      if (!this.naVezi && !this.s.nepotvrdjeno) {
        this.s.nepotvrdjeno = true;
        this.s.offlineOd = this.sat();
        this.snimi(true);
        return;
      }
    }
    this.snimi(false);
  }

  aktivna() { return !!this.s && !this.s.kraj; }
  cekaPotvrdu() { return !!this.s && (this.s.nepotvrdjeno || !!this.s.kraj); }
  ukupnoSekundi() { return this.s ? naDecimalu(this.s.sekundiServer + this.s.odSinhronizacije) : 0; }

  // Koliko je ostalo, u sekundama. null = bez ograničenja.
  preostalo() {
    if (!this.s) return null;
    if (!(this.s.cena > 0)) return null;
    if (this.s.kraj) return 0;
    return Math.max(0, Math.floor((this.s.kredit / this.s.cena) * 3600 - this.s.odSinhronizacije));
  }

  procenaKredita() {
    if (!this.s) return null;
    if (!(this.s.cena > 0)) return this.s.kredit;
    return Math.max(0, naPare(this.s.kredit - (this.s.odSinhronizacije / 3600) * this.s.cena));
  }

  // Kraj bez servera: odjava, isteklo vreme, ili osoblje.
  zavrsi(razlog) {
    if (!this.s || this.s.kraj || !KRAJEVI.has(razlog)) return false;
    this.tik(); // odbroj do ovog trenutka
    this.s.kraj = razlog;
    this.s.krajKad = this.sat();
    this.s.nepotvrdjeno = true;
    this.snimi(true);
    return true;
  }

  // Osoblje je servisnim PIN-om otključalo računar kome je vreme isteklo dok
  // servera nije bilo. Kraj ostaje "vreme", ali server posle obračuna više ne
  // zaključava - inače bi se računar zaključao ponovo čim se veza vrati.
  otkljucaj() {
    if (!this.s || this.s.kraj !== "vreme" || this.s.otkljucano) return false;
    this.s.otkljucano = true;
    this.snimi(true);
    return true;
  }

  izvestaj() {
    if (!this.cekaPotvrdu() || !this.s.podrzava) return null;
    const zapis = {
      v: VERZIJA,
      sesija: this.s.sesija,
      igrac: this.s.igrac?.id ?? null,
      sekundi: this.ukupnoSekundi(),
      cena: naPare(this.s.cena),
      kraj: this.s.kraj,
      krajKad: this.s.krajKad,
      offlineOd: this.s.offlineOd,
      otkljucano: !!this.s.otkljucano,
      poslato: this.sat(),
    };
    return { zapis, potpis: potpisi(zapis, this.token) };
  }

  // Odgovor servera na izveštaj (offline_primljen).
  potvrdi(msg) {
    if (!this.s || !msg || msg.sesija !== this.s.sesija) return false;
    if (msg.stanje === "nastavljeno" && !this.s.kraj) {
      const sek = broj(msg.sekundi, NaN);
      if (Number.isFinite(sek)) {
        // Sekunde odbrojane POSLE slanja izveštaja nisu u obračunu - one ostaju.
        const ukupno = this.s.sekundiServer + this.s.odSinhronizacije;
        this.s.sekundiServer = sek;
        this.s.odSinhronizacije = Math.max(0, ukupno - sek);
      }
      if (Number.isFinite(broj(msg.balance, NaN))) this.s.kredit = broj(msg.balance);
      this.s.nepotvrdjeno = false;
      this.s.offlineOd = null;
      this.snimi(true);
      return true;
    }
    if (msg.stanje === "zavrseno") { this.obrisi(); return true; }
    if (msg.stanje === "odbijeno") {
      // Server ga je pročitao i odbio, i to je zapisao. Ponovo slat, dobio bi
      // isti odgovor - pa se ne šalje. Kraj ili nastavak stižu posebnom porukom.
      if (this.s.kraj) this.obrisi();
      else { this.s.nepotvrdjeno = false; this.s.offlineOd = null; this.snimi(true); }
      return true;
    }
    return false;
  }

  obrisi() {
    this.s = null;
    try { this.fsx.unlinkSync(this.putanja); } catch {}
  }

  snimi(odmah) {
    if (!this.s || !this.putanja) return;
    const sada = this.sat();
    if (!odmah && sada - this.poslednjiUpis < SNIMI_NAJREDJE_MS) return;
    try {
      snimiPotpisano(this.putanja, this.s, this.token, this.fsx);
      this.poslednjiUpis = sada;
      this.greskaUpisa = null;
    } catch (e) {
      this.greskaUpisa = String(e?.message || e);
    }
  }

  // Posle pokretanja launchera. Vreme dok launcher nije radio se ne broji.
  ucitaj() {
    const r = ucitajPotpisano(this.putanja, this.token, this.fsx);
    this.poslednjiMono = this.monoton();
    this.neispravanZapis = null;
    if (!r.podaci) {
      this.s = null;
      if (r.razlog !== "nema") this.neispravanZapis = r.razlog;
      return null;
    }
    const p = r.podaci;
    if (!p || p.v !== VERZIJA || !Number.isInteger(p.sesija)) {
      this.s = null;
      this.neispravanZapis = "verzija";
      return null;
    }
    this.s = p;
    return this.stanje();
  }

  stanje() { return this.s ? JSON.parse(JSON.stringify(this.s)) : null; }
}

module.exports = {
  LokalnaSesija, kanonski, potpisi, potpisJeIspravan, snimiPotpisano, ucitajPotpisano,
  NAJVISE_PO_TIKU, SNIMI_NAJREDJE_MS,
};
