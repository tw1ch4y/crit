import { radniFolder, podigniServer, citajIzvor, brojac } from "./_okruzenje.mjs";
// Rang lista igraonice i mesto igraca na njoj.
//
//   1. mesto (prebrojavanje onih ispred) se poklapa sa redosledom spiska
//   2. "do sledeceg mesta ti fali X" je tacno
//   3. privremeni gosti (gost-01, gost-02...) nisu na listi
//   4. blokiran nalog nije na listi
const BASE = "http://127.0.0.1:8197";
await podigniServer(radniFolder("rang-data"), 8197);
const { proveri, kraj } = brojac();

const svc = await import("../server/src/service.js");
const { db } = await import("../server/src/db.js");

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// ---- 0) PRAZNA IGRAONICA ----
//
// Nova igraonica nema koga da rangira. Prazna tabela izgleda kao kvar, pa se
// proverava da funkcija ne puca i da spisak stvarno bude prazan.
const prazna = svc.rangLista(null);
proveri("prazna lista ne puca", Array.isArray(prazna.vrh) && prazna.vrh.length === 0);
proveri("i kaze da nikoga nema", prazna.ukupno === 0 && prazna.ja === null);

// ---- 1) NAPRAVI IGRAONICU OD 15 IGRACA ----
//
// Iskustvo se ne upisuje rukom nego kroz dodajXp - isti put kojim ide i u
// igraonici. Da se upisivalo pravo u bazu, test bi merio nesto sto se nikad ne
// desava.
const igraci = [];
for (let i = 1; i <= 15; i++) {
  const u = `igrac${String(i).padStart(2, "0")}`;
  const r = (await api("/api/players", "POST", { username: u, password: u + "xx", displayName: "Igrač " + i })).body;
  igraci.push(r);
  // Prvi ima najvise, petnaesti najmanje - da ocekivan redosled bude poznat.
  svc.dodajXp(r.id, (16 - i) * 1000);
}

const lista = svc.rangLista(null, 10);
proveri("vrh ima tacno deset redova", lista.vrh.length === 10, String(lista.vrh.length));
proveri("ukupno se broji", lista.ukupno === 15, String(lista.ukupno));
proveri("prvi je onaj sa najvise iskustva", lista.vrh[0].ime === "Igrač 1", lista.vrh[0].ime);
proveri("mesta idu redom od 1", lista.vrh.every((r, i) => r.mesto === i + 1));
proveri("iskustvo opada niz spisak",
  lista.vrh.every((r, i) => i === 0 || lista.vrh[i - 1].xp >= r.xp));
proveri("svaki red nosi nivo i naziv", lista.vrh.every((r) => r.nivo >= 1 && typeof r.naziv === "string" && r.naziv));

// ---- 2) MESTO SE POKLAPA SA SPISKOM ----
//
// Ovo je greska koja se ne vidi dok neko ne prijavi da je "sedmi, a na spisku
// sesti": mesto se racuna prebrojavanjem, a spisak citanjem - dva upita koja
// moraju da imaju IDENTICAN redosled.
for (const p of igraci) {
  const l = svc.rangLista(p.id, 15);
  const uSpisku = l.vrh.find((r) => r.ja);
  if (!uSpisku) { proveri(`${p.username}: nema sebe u spisku od 15`, false); continue; }
  if (uSpisku.mesto !== l.ja.mesto) {
    proveri(`${p.username}: mesto se poklapa`, false, `racun kaze ${l.ja.mesto}, spisak ${uSpisku.mesto}`);
  }
}
proveri("mesto se poklapa sa spiskom kod svih 15", true);

// ---- 3) IZJEDNACENI ----
//
// Dvoje sa istim iskustvom moraju da dobiju RAZLICITA mesta, i to uvek ista.
// Da se redosled menjao od poziva do poziva, igrac bi na svako otvaranje video
// drugi broj - a to izgleda kao da program racuna nasumicno.
const a = (await api("/api/players", "POST", { username: "blizanac-a", password: "aaaa1111" })).body;
const b = (await api("/api/players", "POST", { username: "blizanac-b", password: "bbbb1111" })).body;
svc.dodajXp(a.id, 4500);
svc.dodajXp(b.id, 4500);
const mestoA = svc.rangLista(a.id).ja.mesto, mestoB = svc.rangLista(b.id).ja.mesto;
proveri("izjednaceni nisu na istom mestu", mestoA !== mestoB, `${mestoA} i ${mestoB}`);
proveri("stariji nalog je ispred", mestoA < mestoB, "ko je tu duze, taj je i stigao pre");
proveri("redosled se ne menja izmedju poziva", svc.rangLista(a.id).ja.mesto === mestoA);
proveri("izjednacenom pise da mu fali nula", svc.rangLista(b.id).ja.doSledecegMesta === 0,
  String(svc.rangLista(b.id).ja.doSledecegMesta));

// ---- 4) "DO SLEDECEG MESTA TI FALI X" ----
//
// Jedina recenica zbog koje neko dodje u utorak. Mora da bude tacna do XP-a.
const zadnji = igraci[14];   // najmanje iskustva
const lz = svc.rangLista(zadnji.id);
const preda = svc.rangLista(null, 50).vrh.find((r) => r.mesto === lz.ja.mesto - 1);
proveri("racun do sledeceg mesta je tacan",
  lz.ja.doSledecegMesta === preda.xp - lz.ja.xp,
  `pise ${lz.ja.doSledecegMesta}, a razlika je ${preda.xp - lz.ja.xp}`);
proveri("i pise KO je ispred", lz.ja.ispredMene === preda.ime, `${lz.ja.ispredMene} / ${preda.ime}`);
proveri("prvi nema koga da stize", svc.rangLista(igraci[0].id).ja.doSledecegMesta === null);

// ---- 5) KOMSILUK ----
//
// Ko je van vrha vidi svoj deo spiska. Ko je u vrhu ga ne vidi - isti ljudi
// dvaput jedan ispod drugog izgledaju kao greska.
const uVrhu = svc.rangLista(igraci[1].id, 10);
proveri("ko je u vrhu nema komsiluk", uVrhu.komsiluk.length === 0, String(uVrhu.komsiluk.length));
const vanVrha = svc.rangLista(zadnji.id, 10);
proveri("ko je van vrha dobija komsiluk", vanVrha.komsiluk.length > 0, String(vanVrha.komsiluk.length));
proveri("i u komsiluku je on sam", vanVrha.komsiluk.some((r) => r.ja));
proveri("komsiluk nosi tacna mesta",
  vanVrha.komsiluk.find((r) => r.ja)?.mesto === vanVrha.ja.mesto);
proveri("komsiluk je u nizu, bez rupa",
  vanVrha.komsiluk.every((r, i) => i === 0 || r.mesto === vanVrha.komsiluk[i - 1].mesto + 1),
  vanVrha.komsiluk.map((r) => r.mesto).join(","));

// ---- 6) KO SE NE RANGIRA ----
//
// Brzi gosti se prave po nekoliko dnevno i posle brisu; da ulaze na listu,
// preplavili bi je imenima koja nikom nista ne znace.
await api("/api/players/guests", "POST", { count: 3, balance: 0 });
const gosti = db.prepare("SELECT id FROM players WHERE username LIKE 'gost-%'").all();
for (const g of gosti) svc.dodajXp(g.id, 99000);   // vise nego iko
const saGostima = svc.rangLista(null, 10);
proveri("brzi gosti ne ulaze na listu",
  !saGostima.vrh.some((r) => /^gost-/.test(r.ime)),
  saGostima.vrh.map((r) => r.ime).join(", "));
proveri("i ne broje se u ukupno", saGostima.ukupno === 17, String(saGostima.ukupno));
const gostLista = svc.rangLista(gosti[0].id);
proveri("gost vidi listu, ali sebe na njoj nema", gostLista.ja === null && gostLista.vrh.length > 0,
  "izmisljeno mesto bi bilo gore od nikakvog");

// Blokiran nalog izlazi sa spiska odmah.
await api(`/api/players/${igraci[0].id}/ban`, "POST", { banned: true });
const posleBana = svc.rangLista(null, 10);
proveri("blokiran nalog izlazi sa liste", !posleBana.vrh.some((r) => r.ime === "Igrač 1"),
  posleBana.vrh.map((r) => r.ime).join(", "));
proveri("i mesta se popunjavaju za njim", posleBana.vrh[0].ime === "Igrač 2", posleBana.vrh[0].ime);
await api(`/api/players/${igraci[0].id}/ban`, "POST", { banned: false });

// ---- 7) LISTA STIZE UZ PROFIL ----
//
// Bez toga bi launcher morao da je trazi posebnom porukom, a profil se ionako
// trazi pri svakom otvaranju Naloga.
const prof = svc.profilIgraca(igraci[5].id);
proveri("profil nosi rang listu", !!prof.rang && Array.isArray(prof.rang.vrh));
proveri("i moje mesto u njoj", prof.rang.ja?.mesto > 0, JSON.stringify(prof.rang.ja?.mesto));

// ---- 8) VIP I IZGLED SE VIDE NA LISTI ----
//
// Oznaka VIP pored imena je jedna od pogodnosti koje se placaju ("stoji uz tvoje
// ime, i na rang listi igraonice"). Obecano je, pa mora i da postoji.
await api("/api/vip", "POST", { ukljucen: true, cena: 100, dana: 30 });
await api(`/api/players/${igraci[3].id}/vip`, "POST", { dana: 30 });
const saVipom = svc.rangLista(null, 15);
proveri("VIP se vidi na listi", saVipom.vrh.find((r) => r.ime === "Igrač 4")?.vip === true);
proveri("ostali nisu oznaceni", saVipom.vrh.find((r) => r.ime === "Igrač 5")?.vip === false);
proveri("red nosi i izabranu boju i okvir",
  saVipom.vrh.every((r) => r.izgled && typeof r.izgled.boja === "string" && typeof r.izgled.okvir === "string"));

// ---- 9) LAUNCHER ZAISTA IMA STRANU ----
const rend = citajIzvor("client/renderer/js/launcher.js");
const css = citajIzvor("client/renderer/css/launcher.css");
proveri("Nalog ima stavku Rang lista", /kljuc: "rang", naziv: "Rang lista"/.test(rend));
proveri("i ona se stvarno crta", /case "rang": return sekcijaRang\(\);/.test(rend) && /function sekcijaRang\(\)/.test(rend));
// Tvoje mesto ide PRE spiska - ono je razlog zbog kog se strana otvara.
const sek = rend.slice(rend.indexOf("function sekcijaRang()"), rend.indexOf("function sekcijaRang()") + 3200);
proveri("tvoje mesto stoji iznad spiska",
  sek.indexOf("${tvoje}") > 0 && sek.indexOf("${tvoje}") < sek.indexOf("Najbolji u kući"),
  "spisak prvo, a tvoje mesto ispod, znaci da ga onaj koga treba pokrenuti nikad ne vidi");
proveri("prazna lista ne pokazuje praznu tabelu", /Lista se tek pravi/.test(sek));
proveri("nalog koji se ne rangira to i kaze", /Ovaj nalog se ne rangira/.test(sek));
// Zlatna znaci NAGRADA i tu je jedina na ekranu; drugo i trece mesto nose boju
// kuce. Srebrna i bronzana bi bile dve nove boje koje nigde nista ne znace.
proveri("prvo mesto je zlatno", /\.rl-m\.m1 \{ color: var\(--gold\); \}/.test(css));
proveri("drugo i trece nose boju kuće", /\.rl-m\.m2, \.rl-m\.m3 \{ color: var\(--brend\); \}/.test(css));
proveri("tvoj red se vidi bez čitanja", /\.rl-red\.ja \{/.test(css) && /inset 3px 0 0 var\(--brend\)/.test(css));

kraj();
