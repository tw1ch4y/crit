import { brojac } from "./_okruzenje.mjs";
import { NIVOI, OTKLJUCAVANJA, nivoZa, smeDa, otkljucanoZa } from "../server/src/nivoi.js";
// ISKUSTVO I NIVOI - CIST RACUN
//
// Iz jednog broja izlazi nivo, naziv i koliko fali. Nema bazu ni mrezu, pa se
// moze proveriti do kraja - i treba, jer se na tom racunu vidi traka koju igrac
// gleda ceo dan. Traka koja pokaze pogresno "jos malo" je gora od nikakve.
const { proveri, kraj } = brojac();

// ---- 1) tablica je smislena ----
proveri("nivoi idu redom", NIVOI.every((n, i) => n.nivo === i + 1));
proveri("pragovi rastu", NIVOI.every((n, i) => i === 0 || n.prag > NIVOI[i - 1].prag),
  NIVOI.map((n) => n.prag).join(", "));
proveri("prvi nivo pocinje od nule", NIVOI[0].prag === 0,
  "igrac koji se tek upisao mora vec da bude na nekom nivou, ne ispod tablice");
proveri("svaki nivo ima naziv", NIVOI.every((n) => !!n.naziv));
// Razmak raste: bez toga bi deseti nivo dosao isto tako brzo kao drugi, pa
// napredovanje prestaje da znaci bilo sta.
const razmaci = NIVOI.slice(1).map((n, i) => n.prag - NIVOI[i].prag);
proveri("razmak izmedju nivoa raste", razmaci.every((r, i) => i === 0 || r > razmaci[i - 1]),
  razmaci.join(", "));

// ---- 2) racun na granicama ----
proveri("nula je prvi nivo", nivoZa(0).nivo === 1);
proveri("tacno na pragu se ULAZI u nivo", nivoZa(1200).nivo === 2, String(nivoZa(1200).nivo));
proveri("jedan XP ispod praga je jos stari nivo", nivoZa(1199).nivo === 1, String(nivoZa(1199).nivo));
proveri("veliki broj je poslednji nivo", nivoZa(999999).nivo === NIVOI.length);

// ---- 3) POKVAREN ULAZ SE PONASA KAO NULA ----
//
// XP dolazi iz baze. Stara baza ga nema, pokvaren red moze da ima tekst ili
// negativan broj. Igrac bez iskustva je NOV IGRAC, a ne ekran koji puca.
for (const los of [null, undefined, -50, "abc", NaN, {}, Infinity * -1]) {
  const r = nivoZa(los);
  proveri(`pokvaren XP (${JSON.stringify(los)}) daje prvi nivo`, r.nivo === 1 && r.xp === 0,
    JSON.stringify(r).slice(0, 80));
}

// ---- 4) traka meri napredak U NIVOU, ne od nule ----
//
// Da meri od nule, igrac na devetom nivou bi video traku skoro punu i nikad je
// ne bi napunio - a to nije napredak nego zid.
const n3 = nivoZa(4000); // nivo 3 (prag 3000), sledeci 5400
proveri("napredak se racuna od praga tekuceg nivoa", n3.uNivou === 1000, String(n3.uNivou));
proveri("granica je razmak do sledeceg", n3.zaSledeci === 2400, String(n3.zaSledeci));
proveri("kaze koliko tacno fali", n3.doSledeceg === 1400, String(n3.doSledeceg));
proveri("kaze koji nivo sledi", n3.sledeciNaziv === NIVOI[3].naziv, String(n3.sledeciNaziv));

// ---- 5) POSLEDNJI NIVO NEMA LAZNU GRANICU ----
//
// Ako bi se poslednjem nivou izmislio sledeci prag, svaki sledeci dinar bi
// izgledao kao napredak ka necemu cega nema.
const zadnji = nivoZa(NIVOI[NIVOI.length - 1].prag + 5000);
proveri("poslednji nivo je oznacen", zadnji.poslednji === true);
proveri("poslednji nivo nema sledeci prag", zadnji.xpDo === null, String(zadnji.xpDo));
proveri("poslednji nivo ne trazi jos XP", zadnji.doSledeceg === 0);

// ---- 6) otkljucavanja ----
proveri("svako otkljucavanje pokazuje na postojeci nivo",
  Object.values(OTKLJUCAVANJA).every((o) => NIVOI.some((n) => n.nivo === o.nivo)));
proveri("na prvom nivou nista nije otkljucano",
  otkljucanoZa(0).every((o) => !o.otkljucano),
  "inace nagrada ne bi bila nagrada");
proveri("sara se otkljucava na drugom nivou", smeDa(1200, "sara") && !smeDa(1199, "sara"));
// VIP nije nagrada za nivo: rang se zaradjuje igranjem, a VIP se kupuje. Nista
// sto se placa ne sme da se otkljuca nivoom.
proveri("VIP se ne otkljucava nivoom", !smeDa(999999, "vip"),
  "rang je status i besplatan je; VIP je prihod i kupuje se - vidi vip.js");
proveri("nivoom se otkljucava samo izgled",
  Object.keys(OTKLJUCAVANJA).every((k) => ["sara", "boja", "okvir"].includes(k)),
  Object.keys(OTKLJUCAVANJA).join(", "));
proveri("nepoznata stvar se ne otkljucava nikad", !smeDa(999999, "necega-nema"),
  "provera mora da kaze NE na ono sto ne poznaje, ne DA");
proveri("spisak nosi i sta jos nije otkljucano",
  otkljucanoZa(1200).filter((o) => !o.otkljucano).length > 0,
  "igrac treba da vidi sta ga ceka, ne samo sta ima");
proveri("spisak kaze na kom nivou sta dolazi",
  otkljucanoZa(0).every((o) => Number.isFinite(o.nivo) && !!o.naziv && !!o.opis));

kraj();
