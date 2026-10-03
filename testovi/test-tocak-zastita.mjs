import path from "node:path";
import { pathToFileURL } from "node:url";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, panelKlijent, brojac, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// NAGRADNI TOCAK: VARANJE
//
// test-tocak.mjs proverava da tocak radi. Ovde se proverava da se ne moze
// prevariti:
//   - ishod bira server, iz kriptografskog izvora; klijent ne moze da ga nametne
//   - drugi spin iste nedelje se ne isplacuje ni kad provera i upis "trce"
//   - otkazana porudzbina se ne racuna u potrosnju (poruci, zavrti, otkazi)
//   - isplata odgovara polju koje je palo

const PORT = 8215, BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
const b = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (x, y) => Math.abs(Number(x) - Number(y)) < 0.01;

await podigniServer(radniFolder("tocak-zastita-data"), PORT);
const svc = await import(pathToFileURL(path.join(KOREN, "server", "src", "service.js")).href);
const dbm = await import(pathToFileURL(path.join(KOREN, "server", "src", "db.js")).href);
const api = await panelKlijent(BASE);

// ---- 1. izbor polja: tacna raspodela, kriptografski izvor ----
const polja = [{ tezina: 2 }, { tezina: 0 }, { tezina: 3 }, { tezina: 5 }];
const pogodak = [];
for (let r = 0; r < 10; r++) pogodak.push(svc.izaberiNagradu(polja, () => r));
b.proveri("svaki broj 0..9 pada u tacno odredjeno polje", JSON.stringify(pogodak) === "[0,0,2,2,2,3,3,3,3,3]", JSON.stringify(pogodak));
b.proveri("polje sa tezinom 0 nikad ne pada", !pogodak.includes(1));
let trazeno = null;
svc.izaberiNagradu(polja, (n) => { trazeno = n; return 0; });
b.proveri("slucajan broj se trazi nad zbirom tezina (bez zaokruzivanja)", trazeno === 10, String(trazeno));
b.proveri("bez tezina vraca prvo polje, ne puca", svc.izaberiNagradu([{ tezina: 0 }]) === 0 && svc.izaberiNagradu([]) === 0);
const broj = [0, 0, 0, 0];
for (let i = 0; i < 20000; i++) broj[svc.izaberiNagradu(polja)]++;
b.proveri("podrazumevani izvor postuje tezine (2:0:3:5)",
  broj[1] === 0 && Math.abs(broj[0] / 20000 - 0.2) < 0.02 && Math.abs(broj[3] / 20000 - 0.5) < 0.02, JSON.stringify(broj));
const izvor = citajIzvor("server/src/service.js");
const izbor = izvor.slice(izvor.indexOf("export function izaberiNagradu"), izvor.indexOf("class VecVrteo"));
b.proveri("izbor koristi crypto.randomInt, ne Math.random", izbor.includes("nasumicno = randomInt") && !izbor.includes("Math.random"));

// ---- priprema: jedna nagrada od 200, prag 100 ----
for (const n of (await api("/api/tocak")).body.nagrade) await api(`/api/tocak/nagrade/${n.id}`, "DELETE");
await api("/api/tocak/nagrade", "POST", { naziv: "Ništa", kredit: 0, tezina: 1 });
await api("/api/tocak/nagrade", "POST", { naziv: "200 din", kredit: 200, tezina: 1 });
await api("/api/tocak", "POST", { ukljucen: true, prag: 100 });
const kola = (await api("/api/shop")).body.find((i) => i.name.startsWith("Coca-Cola")); // 130
const nadji = async (ime) => (await api("/api/players")).body.find((p) => p.username === ime);
const dogadjaji = async (vrsta) => (await api(`/api/bezbednost?vrsta=${vrsta}&limit=50`)).body;

// ---- 2. uslovni upis: provera i upis su jedan iskaz ----
await api("/api/players", "POST", { username: "trka", password: "trka1234", balance: 1000 });
const trka = await nadji("trka");
const sada = Date.now();
b.proveri("prvi spin se upisuje", svc.oznaciSpin(trka.id, sada) === true);
b.proveri("drugi upis iste nedelje NE prolazi", svc.oznaciSpin(trka.id, sada + 1000) === false);
b.proveri("ni posle 6 dana", svc.oznaciSpin(trka.id, sada + 6 * 86400000) === false);
b.proveri("posle nedelju dana ponovo moze", svc.oznaciSpin(trka.id, sada + 7 * 86400000) === true);
// "Trka": stanje u bazi kaze da je vec vrteo, a provera pre posla to nije videla
// (drugi proces, ili kod koji ubaci await izmedju). Isplata ne sme da prodje.
dbm.db.prepare("UPDATE players SET last_spin_at=NULL WHERE id=?").run(trka.id);
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], playerId: trka.id, payment: "credit" });
const pre = (await nadji("trka")).balance;
const original = dbm.db.prepare.bind(dbm.db);
// Podmetni da je, tacno izmedju provere i upisa, neko drugi vec zavrteo.
let podmetnuto = false;
dbm.db.prepare = (sql) => {
  if (!podmetnuto && sql.startsWith("UPDATE players SET last_spin_at=?")) {
    podmetnuto = true;
    original("UPDATE players SET last_spin_at=? WHERE id=?").run(Date.now(), trka.id);
  }
  return original(sql);
};
let rTrka;
try { rTrka = svc.zavrtiTocak(trka.id); } finally { dbm.db.prepare = original; }
b.proveri("podmetanje je stvarno izvedeno (provera bi bez njega prosla)", podmetnuto);
b.proveri("spin koji je izgubio trku se odbija", rTrka?.error === "Već si zavrteo ove nedelje", JSON.stringify(rTrka));
b.proveri("...i NE isplacuje nagradu", blizu((await nadji("trka")).balance, pre), `${pre} -> ${(await nadji("trka")).balance}`);
b.proveri("izgubljena trka je zabelezena kao dupli spin", (await dogadjaji("tocak_dupli_spin")).some((d) => d.igrac === "trka"));

// ---- 3. otkazana porudzbina nije potrosnja ----
await api("/api/players", "POST", { username: "vraca", password: "vraca1234", balance: 1000 });
const vraca = await nadji("vraca");
const por = (await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], playerId: vraca.id, payment: "credit" })).body;
b.proveri("posle kupovine od 130 prag od 100 je ispunjen", svc.tocakInfo(vraca.id).ispunjava === true, JSON.stringify(svc.tocakInfo(vraca.id)));
await api(`/api/orders/${por.orderId}/status`, "POST", { status: "cancelled" });
const info = svc.tocakInfo(vraca.id);
b.proveri("posle otkazivanja potrosnja je 0", info.potroseno === 0 && info.ispunjava === false, JSON.stringify(info));
b.proveri("spin posle 'poruci-otkazi' se odbija", !!svc.zavrtiTocak(vraca.id).error);

// ---- 4. preko pravog WebSocketa ----
await api("/api/players", "POST", { username: "vrti", password: "vrti1234", balance: 1000 });
const vrti = await nadji("vrti");
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], playerId: vrti.id, payment: "credit" });
const pc = (await api("/api/computers")).body[0];
const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}&p=2`);
const poruke = [];
w.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
await new Promise((r) => w.once("open", r));
const posalji = async (m, ms = 500) => { poruke.length = 0; w.send(JSON.stringify(m)); await cekaj(ms); };
const zadnja = (t) => [...poruke].reverse().find((m) => m.t === t);
await posalji({ t: "login", username: "vrti", password: "vrti1234" }, 700);

// 4a) klijent pokusava da nametne ishod
await posalji({ t: "tocak_spin", index: 1, nagrada: { naziv: "200 din", kredit: 200 } });
b.proveri("zahtev sa nametnutim ishodom se ne izvrsava", !zadnja("tocak_rezultat"), JSON.stringify(poruke.map((m) => m.t)));
b.proveri("igrac i dalje nije vrteo", dbm.db.prepare("SELECT last_spin_at FROM players WHERE id=?").get(vrti.id).last_spin_at == null);
const nametanje = await dogadjaji("tocak_nametanje_ishoda");
b.proveri("pokusaj nametanja ishoda je kritican dogadjaj", nametanje.some((d) => d.racunarId === pc.id && d.nivo === "kriticno"), JSON.stringify(nametanje.slice(0, 1)));

// 4b) pravi spin: isplata tacno za polje koje je palo
const kreditPre = (await nadji("vrti")).balance;
await posalji({ t: "tocak_spin" }, 700);
const rez = zadnja("tocak_rezultat");
const nagrade = (await api("/api/tocak")).body.nagrade;
b.proveri("indeks pokazuje na polje cija je nagrada isplacena",
  rez && nagrade[rez.index]?.kredit === rez.nagrada.kredit, JSON.stringify(rez));
// Naplata vremena tece i za to vreme (oko 0,2 din na 5 s), zato tolerancija od 1 din.
b.proveri("kredit je uvecan tacno za tu nagradu", Math.abs(rez.balance - kreditPre - rez.nagrada.kredit) < 1,
  `${kreditPre} -> ${rez?.balance}, nagrada ${rez?.nagrada?.kredit}`);

// 4c) drugi i treci zahtev odmah: odbijeni, bez isplate, zabelezeni
const posle = (await nadji("vrti")).balance;
await cekaj(2000); // da kocnica brzine ne bude razlog odbijanja
await posalji({ t: "tocak_spin" }, 600);
b.proveri("ponovljeni spin iste nedelje se odbija", !!zadnja("tocak_err") && !zadnja("tocak_rezultat"), JSON.stringify(poruke.map((m) => m.t)));
// Rafal: deo odbije kocnica brzine, ostatak provera nedelje - isplate nema.
poruke.length = 0;
for (let i = 0; i < 5; i++) w.send(JSON.stringify({ t: "tocak_spin" }));
await cekaj(800);
b.proveri("rafal od pet spinova ne daje nijedan rezultat", !poruke.some((m) => m.t === "tocak_rezultat"), JSON.stringify(poruke.map((m) => m.t)));
b.proveri("ponovljeni spin ne dodaje kredit", (await nadji("vrti")).balance <= posle);
const bonusi = dbm.db.prepare("SELECT COUNT(*) n FROM transactions WHERE player_id=? AND type='bonus'").get(vrti.id).n;
b.proveri("najvise jedna isplata sa tocka", bonusi <= 1, String(bonusi));
b.proveri("ponovljeni spin je u bezbednosnom dnevniku", (await dogadjaji("tocak_dupli_spin")).some((d) => d.igrac === "vrti"));

w.close();
await b.kraj();
