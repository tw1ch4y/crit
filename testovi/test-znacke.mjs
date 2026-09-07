import { radniFolder, podigniServer, brojac } from "./_okruzenje.mjs";
// ZNACKE SE RACUNAJU IZ ONOGA STO VEC POSTOJI
//
// Nivo kaze KOLIKO je neko trosio; znacka kaze STA je radio - i to je ono sto se
// pamti i prepricava. Ovde se cuva troje:
//
//   1. da znacke rade UNAZAD. Gost koji dolazi sest meseci otvori profil prvog
//      dana kad ovo stigne i zatekne zid zaradjenih znacaka, a ne prazan ekran
//      uz "kreni da skupljas". Sistem koji pocinje od nule kaznjava bas one
//      goste koji su najduze tu - a njih igraonica najmanje sme da izgubi.
//
//   2. da se broj spinova NE cita iz logova. Odrzavanje sece stare zapise, pa
//      bi znacka "10 spinova" jednog dana tiho nestala sa profila gosta koji je
//      stvarno vrteo trideset puta.
//
//   3. da se zakljucana znacka VIDI, sa napretkom. Nagrada koja se ne vidi
//      unapred nije nagrada nego iznenadjenje, a iznenadjenje ne tera nikoga da
//      dodje ponovo.
const BASE = "http://127.0.0.1:8193";
await podigniServer(radniFolder("znacke-data"), 8193);
const { proveri, kraj } = brojac();

const svc = await import("../server/src/service.js");
const { db } = await import("../server/src/db.js");
const z = await import("../server/src/znacke.js");

const DAN = 86400000;
const sad = Date.now();

// ---- 0) SAM RACUN, BEZ BAZE ----
proveri("svaka znacka ima kljuc, grupu, naziv i opis",
  z.ZNACKE.every((x) => x.kljuc && x.grupa && x.naziv && x.opis && typeof x.uslov === "function"));
proveri("svaka grupa koju znacka trazi stvarno postoji",
  z.ZNACKE.every((x) => z.GRUPE[x.grupa]), [...new Set(z.ZNACKE.map((x) => x.grupa))].join(", "));
proveri("nema dva puta isti kljuc",
  new Set(z.ZNACKE.map((x) => x.kljuc)).size === z.ZNACKE.length);
// Prazna statistika ne sme da puca - profil se otvara i za igraca koji je danas
// upisan i jos nista nije uradio.
const prazne = z.znackeZa({});
proveri("prazna statistika ne puca", Array.isArray(prazne) && prazne.length === z.ZNACKE.length);
proveri("nov igrac nema nijednu", z.brojZaradjenih(prazne) === 0);
proveri("i zakljucana znacka nosi napredak", prazne.every((x) => x.postotak === 0 && x.cilj >= 1));
proveri("pokvaren ulaz se racuna kao nula",
  z.brojZaradjenih(z.znackeZa({ sati: "mnogo", poseta: null, spinova: undefined })) === 0);

// ---- 1) IGRAC SA PROSLOSCU ----
//
// Namerno se prvo UPISE proslost, pa se tek onda cita profil - tako se proverava
// da znacke rade unazad, a ne samo za ono sto se desi posle njihovog uvodjenja.
const nalog = db.prepare("INSERT INTO players (username, password_hash, display_name, balance, created_at, xp) VALUES (?,?,?,?,?,?)")
  .run("stari", "x", "Stari", 500, sad - 400 * DAN, 9000);
const id = Number(nalog.lastInsertRowid);
const pc = db.prepare("SELECT id FROM computers LIMIT 1").get().id;

// 60 poseta, jedna od njih duga 6 sati, jedna u 8 ujutru, jedna u 23:30.
const sesija = db.prepare("INSERT INTO sessions (player_id, computer_id, started_at, ended_at, cost, status) VALUES (?,?,?,?,?, 'ended')");
for (let i = 0; i < 60; i++) {
  const pocetak = sad - (i + 1) * 3 * DAN;
  sesija.run(id, pc, pocetak, pocetak + 2 * 3600000, 240);
}
// duga sesija - 6 sati
sesija.run(id, pc, sad - 5 * DAN, sad - 5 * DAN + 6 * 3600000, 720);
// rano ujutru i kasno uvece: sat se bira lokalno, pa se postavlja preko datuma
const uSat = (danaUnazad, sat) => { const d = new Date(sad - danaUnazad * DAN); d.setHours(sat, 0, 0, 0); return d.getTime(); };
sesija.run(id, pc, uSat(9, 8), uSat(9, 8) + 3600000, 120);
sesija.run(id, pc, uSat(11, 23), uSat(11, 23) + 3600000, 120);

// igre: 6 razlicitih, jedna pokrenuta 55 puta.
// Prazna baza nema nijednu igru (u nju se upisuju tek iz panela), pa se ovde
// ubacuje osam - i zato "Sve po redu" ne sme da padne sa svega sest probanih.
const dodajIgru = db.prepare("INSERT INTO games (name, path, category) VALUES (?,?, 'Igre')");
for (let i = 1; i <= 8; i++) dodajIgru.run("Igra " + i, "C:\\games\\i" + i + ".exe");
const igre = db.prepare("SELECT id FROM games").all().map((r) => r.id);
const pokreni = db.prepare("INSERT INTO game_launches (game_id, player_id, computer_id, at) VALUES (?,?,?,?)");
for (const g of igre.slice(0, 6)) pokreni.run(g, id, pc, sad - DAN);
for (let i = 0; i < 55; i++) pokreni.run(igre[0], id, pc, sad - 2 * DAN);

// porudzbine: 30, od toga 22 puta isti artikal
const por = db.prepare("INSERT INTO orders (player_id, computer_id, total, payment, status, created_at) VALUES (?,?,?, 'credit', 'delivered', ?)");
const stavka = db.prepare("INSERT INTO order_items (order_id, item_id, name, price, qty) VALUES (?, NULL, ?, ?, ?)");
for (let i = 0; i < 30; i++) {
  const o = Number(por.run(id, pc, 150, sad - i * DAN).lastInsertRowid);
  stavka.run(o, i < 22 ? "Coca-Cola 0.5" : "Smoki", 150, 1);
}
// potrosnja: najveci dan
db.prepare("INSERT INTO transactions (player_id, type, amount, balance_after, created_at) VALUES (?, 'session', ?, ?, ?)")
  .run(id, -1800, 0, sad - 3 * DAN);

const p1 = svc.profilIgraca(id);
const naso = (k) => p1.znacke.find((x) => x.kljuc === k);

proveri("profil nosi znacke", Array.isArray(p1.znacke) && p1.znacke.length === z.ZNACKE.length);
proveri("profil nosi i grupe", !!p1.grupeZnacaka?.vreme?.naziv);
proveri("ZNACKE RADE UNAZAD", z.brojZaradjenih(p1.znacke) > 8,
  `zaradjeno ${z.brojZaradjenih(p1.znacke)} - gost koji dolazi mesecima ne sme da zatekne prazan ekran`);

proveri("prva sesija se prepoznaje", naso("prvi-put").zaradjena);
proveri("50 poseta", naso("poseta-50").zaradjena, `poseta: ${p1.poseta}`);
proveri("100 poseta jos ne", !naso("poseta-100").zaradjena);
proveri("duga sesija se prepoznaje", naso("maratonac").zaradjena,
  `najduza: ${p1.rekordi.najduzaSesijaMin} min`);
proveri("jutarnja sesija se prepoznaje", naso("ranoranilac").zaradjena);
proveri("kasna sesija se prepoznaje", naso("nocna").zaradjena);
proveri("6 razlicitih igara: znatizeljan da, istrazivac ne",
  naso("znatizeljan").zaradjena && !naso("istrazivac").zaradjena,
  `razlicitih: ${p1.rekordi.razlicitihIgara}`);
proveri("55 pokretanja iste igre", naso("odan").zaradjena);
proveri("25 porudzbina", naso("porudzbina-25").zaradjena, `porudzbina: ${p1.porudzbina}`);
proveri("22 puta isti artikal", naso("uvek-isto").zaradjena);
proveri("omiljeno pice se prepoznaje", p1.rekordi.omiljenoPice === "Coca-Cola 0.5",
  String(p1.rekordi.omiljenoPice));
proveri("godinu dana od upisa", naso("clan-godinu").zaradjena);

// ---- 2) NAPREDAK KA ZAKLJUCANOJ ----
const sto = naso("poseta-100");
proveri("zakljucana znacka pokazuje dokle je stiglo", sto.dokle > 0 && sto.dokle < sto.cilj,
  `${sto.dokle}/${sto.cilj}`);
proveri("i postotak", sto.postotak > 0 && sto.postotak < 100, String(sto.postotak));
proveri("napredak nikad ne prelazi cilj",
  p1.znacke.every((x) => x.dokle <= x.cilj && x.postotak <= 100));

// ---- 3) SPINOVI SE BROJE NA IGRACU, NE U LOGOVIMA ----
//
// Ovo je jedina znacka koja trazi svoj brojac. `last_spin_at` pamti samo
// POSLEDNJI spin; spin bez dobitka ne upisuje transakciju; a logove odrzavanje
// sece po starosti - pa bi znacka jednog dana tiho nestala.
proveri("nov igrac nema spinova", !naso("prvi-spin").zaradjena);
db.prepare("UPDATE players SET spinova=?, spin_dobitak=? WHERE id=?").run(12, 340, id);
const p2 = svc.profilIgraca(id);
const naso2 = (k) => p2.znacke.find((x) => x.kljuc === k);
proveri("spinovi se broje sa igraca", naso2("prvi-spin").zaradjena && naso2("spin-10").zaradjena,
  `spinova: ${p2.rekordi.spinova}`);
proveri("dobitak sa tocka se pamti", naso2("dobitnik").zaradjena && p2.rekordi.dobitakUkupno === 340);

// Brisanje logova NE sme da promeni nijednu znacku - to je cela poenta brojaca.
db.prepare("DELETE FROM logs").run();
const p3 = svc.profilIgraca(id);
proveri("brisanje logova ne dira znacke",
  z.brojZaradjenih(p3.znacke) === z.brojZaradjenih(p2.znacke),
  "brojac stoji na igracu bas zato sto odrzavanje sece logove");

// ---- 4) REKORDI ----
proveri("najbolji dan se racuna", p3.rekordi.najboljiDan?.iznos >= 1800,
  JSON.stringify(p3.rekordi.najboljiDan));
proveri("omiljen dan u nedelji postoji", p3.rekordi.omiljenDan != null && p3.rekordi.omiljenDan >= 0 && p3.rekordi.omiljenDan <= 6,
  String(p3.rekordi.omiljenDan));

kraj();
