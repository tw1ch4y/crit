// ---- KOCNICA BRZINE ----
//
// Racunar igraca stoji u igraonici i na njemu sedi neko ko ima vremena. Launcher
// se moze zameniti skriptom koja salje hiljade poruka u sekundi - svaka prijava
// je scrypt (desetine milisekundi procesora), svaki "hello" je ceo katalog, a
// server je JEDAN proces koji u isto vreme vodi naplatu za trinaest racunara.
// Jedan takav racunar ne sme da zaustavi igraonicu.
//
// Ovde nema poslovne logike i nema sata iz sistema "na tvrdo": sat se ubacuje,
// pa se sve moze proveriti bez cekanja.

// KOFA SA ZETONIMA
//
// Kofa drzi najvise `kapacitet` zetona i puni se brzinom `poSekundi`. Svaka
// poruka uzme zeton (ili vise, ako je skupa). Kratak rafal prolazi - launcher pri
// povezivanju salje nekoliko poruka odjednom - a stalno zatrpavanje ne.
export class Kofa {
  constructor({ kapacitet, poSekundi, sat = Date.now }) {
    this.kapacitet = kapacitet;
    this.poSekundi = poSekundi;
    this.sat = sat;
    this.zetoni = kapacitet;
    this.poslednje = sat();
  }
  dopuni() {
    const sada = this.sat();
    const proteklo = Math.max(0, sada - this.poslednje) / 1000;
    this.poslednje = sada;
    this.zetoni = Math.min(this.kapacitet, this.zetoni + proteklo * this.poSekundi);
  }
  uzmi(cena = 1) {
    this.dopuni();
    if (this.zetoni >= cena) { this.zetoni -= cena; return true; }
    return false;
  }
}

// GRANICE ZA PORUKE SA JEDNOG RACUNARA
//
// Zajednicka kofa vazi za sve poruke. Pravi launcher salje otkucaj na 20 s,
// par poruka pri povezivanju i po jednu na klik - 10 u sekundi sa rafalom od 40
// je visestruko iznad toga.
//
// Skupe poruke imaju i SVOJU kofu, jer bi inace i 10 u sekundi bilo previse:
//   change_password  scrypt nad starom lozinkom - najskuplja poruka koja postoji
//   login            isto scrypt; kocnica za pogresne lozinke vec postoji, ovo je
//                    granica i za ispravne
//   hello            server odgovara celim katalogom (igre, shop, sare)
//   order, tocak_spin  upis u bazu u jednom poslu
export const OGRANICENJA = {
  sve: { kapacitet: 40, poSekundi: 10 },
  login: { kapacitet: 10, poSekundi: 1 },
  change_password: { kapacitet: 3, poSekundi: 1 / 20 },
  hello: { kapacitet: 4, poSekundi: 0.25 },
  order: { kapacitet: 6, poSekundi: 1 },
  tocak_spin: { kapacitet: 3, poSekundi: 0.5 },
  unlock_pin: { kapacitet: 6, poSekundi: 0.5 },
  verify_pin: { kapacitet: 6, poSekundi: 0.5 },
  moja_tekstura: { kapacitet: 10, poSekundi: 2 },
  moj_profil: { kapacitet: 10, poSekundi: 2 },
};

// Kad racunar i posle odbijanja nastavi da zatrpava, veza se prekida. Odbijene
// poruke se broje u kliznom prozoru: obican rafal nikad ne stigne do ovoga,
// petlja koja salje bez prestanka stigne za par sekundi.
export const PREKID_POSLE_ODBIJENIH = 200;
export const PROZOR_ODBIJENIH_MS = 10_000;

// Kocnica za JEDNU vezu. `propusti(tip)` se zove za svaku poruku:
//   { ok: true }
//   { ok: false, razlog: "sve" | <tip>, prekini: bool }
export class KocnicaVeze {
  constructor({ sat = Date.now, ogranicenja = OGRANICENJA } = {}) {
    this.sat = sat;
    this.ogranicenja = ogranicenja;
    this.sve = new Kofa({ ...ogranicenja.sve, sat });
    this.poTipu = new Map();
    this.odbijene = []; // vremena odbijenih poruka u prozoru
    this.ukupnoOdbijeno = 0;
  }
  // Prvi korak, pre citanja JSON-a: zajednicka kofa.
  propustiSirovu() {
    if (this.sve.uzmi(1)) return { ok: true };
    return this.odbij("sve");
  }
  // Drugi korak, kad se zna tip: kofa za skupe poruke.
  propustiTip(tip) {
    const g = typeof tip === "string" && Object.hasOwn(this.ogranicenja, tip) && tip !== "sve" ? this.ogranicenja[tip] : null;
    if (!g) return { ok: true };
    let k = this.poTipu.get(tip);
    if (!k) { k = new Kofa({ ...g, sat: this.sat }); this.poTipu.set(tip, k); }
    if (k.uzmi(1)) return { ok: true };
    return this.odbij(tip);
  }
  odbij(razlog) {
    const sada = this.sat();
    this.ukupnoOdbijeno++;
    this.odbijene.push(sada);
    while (this.odbijene.length && sada - this.odbijene[0] > PROZOR_ODBIJENIH_MS) this.odbijene.shift();
    return { ok: false, razlog, prekini: this.odbijene.length >= PREKID_POSLE_ODBIJENIH };
  }
}

// ---- POGADJANJE TOKENA RACUNARA ----
//
// Token racunara je jedino sto stoji izmedju mreze i "ja sam PC-05". Ko ga
// pogadja, pogadja ga sa jedne adrese i to brzo. Posle NEISPRAVNIH_DO_BLOKADE
// promasaja u PROZOR_NEISPRAVNIH_MS ta adresa se blokira na TRAJANJE_BLOKADE_MS -
// za to vreme se ni ne pita baza.
//
// Broje se samo NEISPRAVNI tokeni racunara. Ispravna veza ne trosi nista, pa
// trinaest racunara iza jednog rutera (ista adresa) ne smetaju jedni drugima.
export const NEISPRAVNIH_DO_BLOKADE = 10;
export const PROZOR_NEISPRAVNIH_MS = 60_000;
export const TRAJANJE_BLOKADE_MS = 5 * 60_000;

export class StrazaTokena {
  constructor({ sat = Date.now, doBlokade = NEISPRAVNIH_DO_BLOKADE, prozor = PROZOR_NEISPRAVNIH_MS,
    trajanje = TRAJANJE_BLOKADE_MS } = {}) {
    this.sat = sat;
    this.doBlokade = doBlokade;
    this.prozor = prozor;
    this.trajanje = trajanje;
    this.adrese = new Map(); // ip -> { promasaji: [ts], blokiranDo }
  }
  // Koliko jos sekundi je adresa blokirana (0 = nije).
  blokirana(ip) {
    const a = this.adrese.get(ip);
    if (!a || !a.blokiranDo) return 0;
    const ostalo = a.blokiranDo - this.sat();
    if (ostalo <= 0) { a.blokiranDo = 0; return 0; }
    return Math.ceil(ostalo / 1000);
  }
  // Zabelezi promasaj. Vraca { blokirana: bool, upravo: bool, promasaja }.
  promasaj(ip) {
    const sada = this.sat();
    this.pocisti(sada);
    let a = this.adrese.get(ip);
    if (!a) { a = { promasaji: [], blokiranDo: 0 }; this.adrese.set(ip, a); }
    a.promasaji.push(sada);
    while (a.promasaji.length && sada - a.promasaji[0] > this.prozor) a.promasaji.shift();
    if (!a.blokiranDo && a.promasaji.length >= this.doBlokade) {
      a.blokiranDo = sada + this.trajanje;
      a.promasaji = [];
      return { blokirana: true, upravo: true, promasaja: this.doBlokade };
    }
    return { blokirana: a.blokiranDo > sada, upravo: false, promasaja: a.promasaji.length };
  }
  pocisti(sada) {
    if (this.adrese.size < 1000) return;
    for (const [ip, a] of this.adrese) {
      if ((!a.blokiranDo || a.blokiranDo < sada) && (!a.promasaji.length || sada - a.promasaji.at(-1) > this.prozor)) {
        this.adrese.delete(ip);
      }
    }
  }
}

// Jedna straza za ceo server: i WebSocket i preuzimanje nadogradnje primaju
// token racunara, pa pogadjanje kroz jedan put mora da zatvori i drugi.
export const strazaTokena = new StrazaTokena();
