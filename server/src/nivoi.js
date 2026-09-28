// ISKUSTVO I NIVOI IGRAČA
//
// ODAKLE DOLAZI ISKUSTVO
//
// Jedan dinar koji je igrač POTROŠIO = jedan XP. Ne dinar koji je uplatio -
// potrošen. Razlika nije sitnica: dopuna je obećanje, a potrošnja je ono što se
// stvarno desilo. Ko dopuni 5000 i ode kući nije igrao, i nema šta da mu se
// računa.
//
// Troši se na dva načina i oba daju iskustvo: vreme za računarom (naplata teče
// dok igra) i piće iz shopa. Nagrada sa točka i poklonjen kredit NE daju XP -
// to je kuća dala, nije igrač zaradio, a inače bi točak bio prečica do nivoa.
//
// ZAŠTO OVDE, A NE U service.js
//
// Ovo je čist račun: iz jednog broja izlazi nivo, naziv i koliko fali. Nema
// bazu, nema mrežu, ništa se ne pamti - pa se može proveriti do kraja, bez
// podizanja servera. Sve što je oko toga (kad se dodaje, kome, i šta se
// otključava) stoji u service.js.

// Prag je UKUPAN XP potreban da se uđe u nivo.
//
// Razmak raste: prvi nivo dođe posle jedne duže posete, deseti tek posle mnogo
// njih. Sa cenom od 120 din/sat, jedan sat igre je 120 XP - pa je Bronza posle
// desetak sati, a Mit tek za stalnog gosta. Kriva se namerno ne diže brže:
// nivo koji se ne može dostići prestaje da bude cilj i postaje ukras.
export const NIVOI = [
  { nivo: 1,  prag: 0,     naziv: "Novajlija" },
  { nivo: 2,  prag: 1200,  naziv: "Bronza" },
  { nivo: 3,  prag: 3000,  naziv: "Srebro",   otkljucava: "boja" },
  { nivo: 4,  prag: 5400,  naziv: "Zlato",    otkljucava: "okvir" },
  { nivo: 5,  prag: 8400,  naziv: "Platina",  otkljucava: "vip" },
  { nivo: 6,  prag: 12000, naziv: "Dijamant" },
  { nivo: 7,  prag: 16200, naziv: "Master" },
  { nivo: 8,  prag: 21000, naziv: "Elita" },
  { nivo: 9,  prag: 26400, naziv: "Legenda" },
  { nivo: 10, prag: 32400, naziv: "Mit" },
];

// Šta se otključava kojim nivoom - jedno mesto za tvrdnju, da se spisak u
// launcheru i provera na serveru ne raziđu.
export const OTKLJUCAVANJA = {
  boja:  { nivo: 3, naziv: "Boja imena",        opis: "Tvoje ime dobija boju koju izabereš" },
  okvir: { nivo: 4, naziv: "Okvir oko znaka",   opis: "Znak na profilu dobija okvir" },
  vip:   { nivo: 5, naziv: "VIP",               opis: "Traka na početnoj i VIP teme" },
};

// TEME LAUNCHERA
//
// Tema menja CEO launcher: podlogu, ploče, boju dugmadi i pozadinu koja se
// polako kreće iza svega. Nije ukras preko postojećeg izgleda nego drugi
// izgled.
//
// Svaki nivo od drugog do desetog donosi nešto. Ranije su nivoi 6-10 bili
// prazni - put se završavao na petom, i stalni gost posle toga nije imao zašto
// da gleda traku. Teme od petog nivoa naviše su VIP: dostupne samo onome ko je
// stigao do Platine.
//
// "kuca" je kućna tema: nosi boju koju je vlasnik izabrao u panelu.
// PALETE SU RAČUNATE, NE BIRANE NA OKO. Svaka tema ima jednu nijansu za
// neutralne boje i od nje se u OKLCH prostoru prave podloga (bg, bg2) i ploče
// (panel..panel3) u jednakim koracima svetline - pa su razmaci između slojeva
// isti u svakoj temi i nijedna ne deluje "ravnije" od druge. Tekst (t1..t3)
// nosi toplinu teme: beo na zlatu je topao, na ledu hladan. Kontrast je meren
// (test-nivoi): sporedni tekst na ploči preko 9:1, treći preko 4,5:1.
//
// akcenat je boja dugmadi i izabranog, akcenat2 drugi ton iste porodice - ide u
// prelive (dugme, traka napretka), pa dugme ima dubinu umesto ravne boje.
// naAkcentu je taman tekst za svetle akcente. amb su tri boje pozadine koja se
// preliva. Zlatna ostaje boja nagrada u svakoj temi.
// "kuca" nema svoj akcenat: nosi boju koju je vlasnik izabrao u panelu.
export const TEME = {
  kuca: { nivo: 1, naziv: "Kućna", opis: "Boje igraonice", boje: {
    bg: "#020821", bg2: "#040d27", panel: "#091532", panel2: "#101e3c", panel3: "#1b2a4b",
    t1: "#f1f3f8", t2: "#b7becb", t3: "#7f8695", akcenat: null, akcenat2: null,
    amb: ["#2f6ae8", "#6a4cf0", "#22b8e0"] } },
  grafit: { nivo: 2, naziv: "Grafit", opis: "Karbon i čelik", boje: {
    bg: "#080a0e", bg2: "#0d1013", panel: "#15171c", panel2: "#1d1f24", panel3: "#282b31",
    t1: "#f2f3f6", t2: "#babec4", t3: "#82868e", akcenat: "#ced9e6", akcenat2: "#85a9c8", naAkcentu: "#080a0e",
    amb: ["#6f86a6", "#4f7fa6", "#3a414c"], ambJacina: 0.9 } },
  arktik: { nivo: 3, naziv: "Arktik", opis: "Led i hladna tirkizna", boje: {
    bg: "#000d13", bg2: "#011219", panel: "#041a21", panel2: "#0b232a", panel3: "#162f38",
    t1: "#eef5f7", t2: "#b1c1c7", t3: "#778a91", akcenat: "#4ad6e9", akcenat2: "#a8d8fb", naAkcentu: "#000d13",
    amb: ["#00bacf", "#94ccf3", "#1d677f"] } },
  smaragd: { nivo: 4, naziv: "Smaragd", opis: "Duboki žad i limeta", boje: {
    bg: "#000e08", bg2: "#02140d", panel: "#071c14", panel2: "#0e241c", panel3: "#193128",
    t1: "#eff5f2", t2: "#b3c2bb", t3: "#798b83", akcenat: "#3fd996", akcenat2: "#b6e86e", naAkcentu: "#000e08",
    amb: ["#23ba7d", "#26bdae", "#699630"] } },
  zlato: { nivo: 5, naziv: "Zlato", opis: "Crno i zlatno", vip: true, boje: {
    bg: "#0f0903", bg2: "#140e07", panel: "#1c160d", panel2: "#251e15", panel3: "#312a20",
    t1: "#f8f3ec", t2: "#c9bcaa", t3: "#93836e", akcenat: "#ecb84e", akcenat2: "#efda9a", naAkcentu: "#0f0903",
    amb: ["#e0a93a", "#7a4a14", "#3a2408"], ambJacina: 0.75 } },
  ametist: { nivo: 6, naziv: "Ametist", opis: "Ljubičasta i magenta", vip: true, boje: {
    bg: "#0d051a", bg2: "#120a20", panel: "#1a122a", panel2: "#221a34", panel3: "#2e2542",
    t1: "#f4f2f9", t2: "#bfbbcd", t3: "#888297", akcenat: "#8142e1", akcenat2: "#e861d3",
    amb: ["#8f5aec", "#d648c2", "#4455c2"] } },
  zar: { nivo: 7, naziv: "Žar", opis: "Žar i plamen", vip: true, boje: {
    bg: "#140603", bg2: "#1a0a06", panel: "#23120c", panel2: "#2d1a14", panel3: "#3a251f",
    t1: "#faf1ee", t2: "#cfb8b1", t3: "#9a7f77", akcenat: "#fb8139", akcenat2: "#f45246", naAkcentu: "#140603",
    amb: ["#f4741e", "#db2c2f", "#ffbd47"] } },
  aurora: { nivo: 8, naziv: "Aurora", opis: "Polarna svetlost koja se preliva", vip: true, boje: {
    bg: "#000c19", bg2: "#00111f", panel: "#021928", panel2: "#072232", panel3: "#132e40",
    t1: "#eff4f8", t2: "#b3c0c9", t3: "#798993", akcenat: "#4be4bd", akcenat2: "#b696f7", naAkcentu: "#000c19",
    amb: ["#22dcb3", "#9f79e6", "#49c1ea"] } },
  obsidijan: { nivo: 9, naziv: "Obsidijan", opis: "Crno sa grimiznim", vip: true, boje: {
    bg: "#0c0909", bg2: "#110f0f", panel: "#191616", panel2: "#211e1e", panel3: "#2e2a2a",
    t1: "#f5f3f3", t2: "#c2bcbc", t3: "#8b8484", akcenat: "#d01a34", akcenat2: "#a50e19",
    amb: ["#de1d3f", "#5a0f22", "#2a2224"], ambJacina: 0.85 } },
  mit: { nivo: 10, naziv: "Mit", opis: "Sedef i zlato, za one koji su stigli do kraja", vip: true, boje: {
    bg: "#0a0816", bg2: "#0f0d1c", panel: "#161525", panel2: "#1e1d2e", panel3: "#2a293c",
    t1: "#f3f3f9", t2: "#bcbccc", t3: "#858497", akcenat: "#cfbaff", akcenat2: "#efc469", naAkcentu: "#0a0816",
    amb: ["#a58bf0", "#4a3fb0", "#d9b055"], ambJacina: 0.85 } },
};

// Da li igrač sa tim iskustvom sme temu. Nepoznata tema - ne sme.
export function smeTemu(xpSirovo, kljuc) {
  if (typeof kljuc !== "string" || !Object.hasOwn(TEME, kljuc)) return false;
  const t = TEME[kljuc];
  return nivoZa(xpSirovo).nivo >= t.nivo;
}

// Pokvaren ili nepostojeći XP se ponaša kao nula, ne kao greška: igrač bez
// iskustva je nov igrač, a ne kvar koji ruši ekran.
const ceo = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);

export function nivoZa(xpSirovo) {
  const xp = ceo(xpSirovo);
  let tekuci = NIVOI[0];
  for (const n of NIVOI) if (xp >= n.prag) tekuci = n;
  const sledeci = NIVOI.find((n) => n.nivo === tekuci.nivo + 1) || null;

  // Na poslednjem nivou nema "koliko fali". Traka se tada prikazuje punom -
  // ali se NE pravi lažna granica, jer bi svaki sledeći dinar izgledao kao
  // napredak ka nečemu čega nema.
  const uNivou = xp - tekuci.prag;
  const zaSledeci = sledeci ? sledeci.prag - tekuci.prag : 0;

  return {
    nivo: tekuci.nivo,
    naziv: tekuci.naziv,
    xp,
    // xpOd/xpDo su granice TEKUĆEG nivoa, ne ukupne - traka meri napredak
    // unutar nivoa, a ne od nule do kraja sveta.
    xpOd: tekuci.prag,
    xpDo: sledeci ? sledeci.prag : null,
    uNivou,
    zaSledeci,
    doSledeceg: sledeci ? sledeci.prag - xp : 0,
    poslednji: !sledeci,
    sledeciNaziv: sledeci ? sledeci.naziv : null,
  };
}

// Da li igrač sa tim iskustvom sme da koristi neku od stvari sa profila.
export function smeDa(xpSirovo, sta) {
  const o = Object.hasOwn(OTKLJUCAVANJA, String(sta)) ? OTKLJUCAVANJA[sta] : null;
  if (!o) return false;
  return nivoZa(xpSirovo).nivo >= o.nivo;
}

// Spisak za launcher: šta je otključano, šta tek dolazi i na kom nivou.
export function otkljucanoZa(xpSirovo) {
  const n = nivoZa(xpSirovo).nivo;
  const osnovno = Object.entries(OTKLJUCAVANJA).map(([kljuc, o]) => ({
    kljuc, naziv: o.naziv, opis: o.opis, nivo: o.nivo, otkljucano: n >= o.nivo,
  }));
  // Svaka tema posle prve je nagrada za svoj nivo - sa ključem "tema:ime", da
  // launcher na putu kroz nivoe zna šta da nacrta.
  const teme = Object.entries(TEME).filter(([, t]) => t.nivo > 1).map(([k, t]) => ({
    kljuc: `tema:${k}`, naziv: `Tema ${t.naziv}`, opis: t.opis, nivo: t.nivo, vip: !!t.vip, otkljucano: n >= t.nivo,
  }));
  return [...osnovno, ...teme].sort((a, b) => a.nivo - b.nivo);
}

// DOSTIGNUĆA
//
// Nivo meri koliko je igrač potrošio. Dostignuća mere KAKO dolazi: koliko
// često, koliko dugo, šta sve proba. Tako i gost koji malo troši a stalno
// dolazi ima šta da skuplja, a svaki stepen je sledeći razlog da se vrati.
// Stepeni rastu tako da je prvi blizu (odmah se vidi kako radi), a poslednji
// traži mesece - da ima šta da se juri i posle godinu dana.
export const DOSTIGNUCA = [
  { kljuc: "dolasci", naziv: "Stalni gost", opis: "Dolazaka u igraonicu", jedinica: "dolazaka", ikona: "vrata", stepeni: [1, 10, 50, 150] },
  { kljuc: "sati", naziv: "Maratonac", opis: "Sati za računarom", jedinica: "sati", ikona: "sat", stepeni: [5, 25, 100, 300] },
  { kljuc: "niz", naziv: "Veran", opis: "Nedelja zaredom sa dolaskom", jedinica: "nedelja", ikona: "kalendar", stepeni: [2, 4, 8, 16] },
  { kljuc: "igre", naziv: "Istraživač", opis: "Različitih igara pokrenuto", jedinica: "igara", ikona: "gamepad", stepeni: [3, 6, 10, 15] },
  { kljuc: "porudzbine", naziv: "Gurman", opis: "Porudžbina iz shopa", jedinica: "porudžbina", ikona: "cup", stepeni: [1, 10, 40, 100] },
  { kljuc: "noc", naziv: "Noćna ptica", opis: "Dolazaka posle 22 časa", jedinica: "dolazaka", ikona: "mesec", stepeni: [1, 5, 20, 50] },
];

// Koliko je stepeni dostignuto za datu vrednost (0 = nijedan).
export function stepenZa(d, vrednost) {
  const v = Number(vrednost) || 0;
  return d.stepeni.filter((s) => v >= s).length;
}

// NIZ NEDELJA
//
// Niz se meri u NEDELJAMA, ne u danima. Dnevni niz u igraonici je kazna, ne
// nagrada: niko ne dolazi svaki dan, pa bi niz pucao stalno i igrač bi
// prestao da mari. Nedelja je ritam kojim stalni gosti stvarno dolaze.
//
// Nedelja počinje ponedeljkom po lokalnom vremenu. Ponedeljci se računaju
// preko kalendara (new Date(g, m, d - 7)), ne oduzimanjem 7 * 24 h - zbog
// pomeranja sata bi inače jedna nedelja godišnje "nestala".
const ponedeljak = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); };
const nedeljePre = (pon, n) => new Date(pon.getFullYear(), pon.getMonth(), pon.getDate() - 7 * n);
const oznakaNedelje = (pon) => pon.getFullYear() * 10000 + (pon.getMonth() + 1) * 100 + pon.getDate();

export function nizNedelja(vremenaDolazaka, sad = Date.now(), prikazi = 12) {
  const nedelje = new Set();
  for (const t of vremenaDolazaka) if (Number.isFinite(Number(t)) && Number(t) > 0) nedelje.add(oznakaNedelje(ponedeljak(Number(t))));
  const ova = ponedeljak(sad);
  const ovaNedelja = nedelje.has(oznakaNedelje(ova));
  // Niz se ne prekida dok tekuća nedelja traje: ko je bio prošle nedelje i
  // još nije došao ove, i dalje ima niz - samo mora da dođe do nedelje uveče.
  let niz = 0;
  for (let i = ovaNedelja ? 0 : 1; nedelje.has(oznakaNedelje(nedeljePre(ova, i))); i++) niz++;
  // Najduži niz ikad - za dostignuće, koje ne sme da se izgubi kad niz pukne.
  let najduzi = 0, tekuci = 0, pre = null;
  const sortirano = [...nedelje].sort((a, b) => a - b);
  for (const o of sortirano) {
    const g = Math.floor(o / 10000), m = Math.floor(o / 100) % 100, d = o % 100;
    const sledecaPosle = pre == null ? null : oznakaNedelje(nedeljePre(pre, -1));
    tekuci = sledecaPosle === o ? tekuci + 1 : 1;
    najduzi = Math.max(najduzi, tekuci);
    pre = new Date(g, m - 1, d);
  }
  const poslednje = Array.from({ length: prikazi }, (_, i) => nedelje.has(oznakaNedelje(nedeljePre(ova, prikazi - 1 - i))));
  return { niz, ovaNedelja, najduzi, poslednje };
}
