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
// Boje: podloga (bg, bg2), ploče (panel..panel3), sporedni tekst (t2, t3),
// akcenat (dugmad, izabrano) i tri boje pozadine koja se preliva (amb). Glavni
// tekst je svuda isti, skoro beo - čitljivost se ne menja sa temom. Zlatna
// ostaje boja nagrada u svakoj temi.
// "kuca" nema svoj akcenat: nosi boju koju je vlasnik izabrao u panelu.
export const TEME = {
  kuca: { nivo: 1, naziv: "Kućna", opis: "Boje igraonice", boje: {
    bg: "#070c1c", bg2: "#0b1226", panel: "#111a36", panel2: "#172343", panel3: "#1f2d54",
    t2: "#a4adca", t3: "#626c8c", akcenat: null, amb: ["#2f6ae8", "#ffb527", "#3fc9e0"] } },
  grafit: { nivo: 2, naziv: "Grafit", opis: "Tamno siva, mirna", boje: {
    bg: "#0b0c0f", bg2: "#101115", panel: "#15171c", panel2: "#1b1e24", panel3: "#252932",
    t2: "#a7abb4", t3: "#6b707a", akcenat: "#5b7cfa", amb: ["#3d4a66", "#5b7cfa", "#2a2f3a"] } },
  arktik: { nivo: 3, naziv: "Arktik", opis: "Hladna tirkizna i led", boje: {
    bg: "#041318", bg2: "#06191f", panel: "#0b222a", panel2: "#102c36", panel3: "#173a46",
    t2: "#9fbac2", t3: "#5f7d86", akcenat: "#0fb5c7", naAkcentu: "#0b0d12", amb: ["#0fb5c7", "#7dd3fc", "#0e7490"] } },
  smaragd: { nivo: 4, naziv: "Smaragd", opis: "Duboka zelena", boje: {
    bg: "#04120d", bg2: "#061812", panel: "#0b2019", panel2: "#112a21", panel3: "#18372c",
    t2: "#9fc0b1", t3: "#5d7d6f", akcenat: "#10b981", naAkcentu: "#0b0d12", amb: ["#10b981", "#34d399", "#065f46"] } },
  zlato: { nivo: 5, naziv: "Zlato", opis: "Crno i zlatno", vip: true, boje: {
    bg: "#0c0a06", bg2: "#110e08", panel: "#17130c", panel2: "#1e1910", panel3: "#2a2316",
    t2: "#c2b59a", t3: "#7d7359", akcenat: "#c9951a", naAkcentu: "#0b0d12", amb: ["#d4a017", "#8a5a12", "#f5d27a"] } },
  ametist: { nivo: 6, naziv: "Ametist", opis: "Ljubičasta noć", vip: true, boje: {
    bg: "#0c0816", bg2: "#110b1e", panel: "#171027", panel2: "#1e1532", panel3: "#2a1e45",
    t2: "#b3a8cc", t3: "#6f6588", akcenat: "#8b5cf6", amb: ["#8b5cf6", "#d946ef", "#4338ca"] } },
  zar: { nivo: 7, naziv: "Žar", opis: "Toplo narandžasto, kao žar", vip: true, boje: {
    bg: "#120806", bg2: "#180b08", panel: "#1f100c", panel2: "#281510", panel3: "#361d16",
    t2: "#c9ada3", t3: "#83685f", akcenat: "#ea6a1e", naAkcentu: "#0b0d12", amb: ["#f97316", "#dc2626", "#fbbf24"] } },
  aurora: { nivo: 8, naziv: "Aurora", opis: "Polarna svetlost koja se preliva", vip: true, boje: {
    bg: "#040b14", bg2: "#06101c", panel: "#0b1726", panel2: "#101f32", panel3: "#172a42",
    t2: "#a3b6cc", t3: "#607489", akcenat: "#14b8a6", naAkcentu: "#0b0d12", amb: ["#2dd4bf", "#a78bfa", "#38bdf8"] } },
  obsidijan: { nivo: 9, naziv: "Obsidijan", opis: "Potpuno crno sa grimiznim", vip: true, boje: {
    bg: "#050506", bg2: "#09090b", panel: "#0f0f12", panel2: "#151518", panel3: "#1f1f24",
    t2: "#a8a8b0", t3: "#66666f", akcenat: "#e11d48", amb: ["#e11d48", "#3f3f46", "#7f1d1d"] } },
  mit: { nivo: 10, naziv: "Mit", opis: "Samo za one koji su stigli do kraja", vip: true, boje: {
    bg: "#0a0a12", bg2: "#0e0e18", panel: "#14141f", panel2: "#1b1b29", panel3: "#262638",
    t2: "#bdb8c9", t3: "#767286", akcenat: "#c99a2e", naAkcentu: "#0b0d12", amb: ["#e8b64c", "#c4b5fd", "#fef3c7"] } },
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
