import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// FABRICKI SERVISNI PIN SE PRIJAVLJUJE, NE PRECUTKUJE.
//
// Servisni PIN launchera cuva dve stvari koje server ne moze da pokrije:
// ulaz u podesavanja launchera i izlaz iz kioska KAD SERVER NE RADI. Dok stoji
// na fabrickom 1234, igrac koji iscupa mrezni kabl sacekaj par sekundi da se
// pojavi "Promeni adresu servera", ukuca 1234 i preusmeri masinu na svoj
// server - i time sebi otvori besplatnu igru.
//
// Menja se rucno, po masini, u podesavanja.json. Rucni korak se zaboravi bas na
// onoj trinaestoj masini, a zaboravljeno se nikad ne primeti samo od sebe.
// Launcher to ne moze da popravi umesto coveka, ali moze da PRIJAVI - pa panel
// stoji crveno dok se ne popravi. Isti pristup kao za fabricku lozinku vlasnika.
const BASE = "http://127.0.0.1:8174", WSB = "ws://127.0.0.1:8174";
await podigniServer(radniFolder("servisni-pin-data"), 8174);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p) => fetch(BASE + p, { headers: { authorization: "Bearer " + token } }).then((r) => r.json());

const pc = (await api("/api/computers"))[0];
const stanje = async () => (await api("/api/computers")).find((c) => c.id === pc.id)?.pinFabricki;

// Launcher se javlja isto kao pravi.
const spoji = () => new Promise((res) => {
  const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}&v=2.45.0`);
  w.once("open", () => res(w));
  w.once("error", () => res(null));
  setTimeout(() => res(null), 2500);
});

// ---- 1) dok se nista ne javi, ne tvrdi se da je u redu ----
// Prazno polje znaci "ne javlja", ne "sve je uredno". Kad bi se pretpostavljalo
// da je dobro, stariji launcher bi ispao bezbedniji od novog.
proveri("na pocetku se ne zna", (await stanje()) == null, String(await stanje()));

// ---- 2) launcher javi da je PIN fabricki ----
let w = await spoji();
w.send(JSON.stringify({ t: "sys_info", nics: [{ ip: "192.168.1.50", mac: "aa:bb:cc:dd:ee:01" }], fabrickiPin: true }));
await cekaj(500);
proveri("fabricki PIN stize do panela", (await stanje()) === true, String(await stanje()));

const logovi = await api("/api/logs?category=sistem");
const zapis = (logovi.items || logovi).find((l) => l.action === "pin_fabricki");
proveri("upisuje se u Logove", !!zapis, "bez toga se ne moze naci unazad");
proveri("zapis kaze U CEMU JE OPASNOST", /preusmeri/.test(zapis?.detail || ""),
  "gola tvrdnja 'PIN je fabricki' nikome ne kaze zasto je to bitno");
proveri("zapis kaze na kom je racunaru", zapis?.target === pc.name, String(zapis?.target));

w.close(); await cekaj(300);

// ---- 3) promenjen PIN gasi upozorenje ----
w = await spoji();
w.send(JSON.stringify({ t: "sys_info", nics: [{ ip: "192.168.1.50", mac: "aa:bb:cc:dd:ee:01" }], fabrickiPin: false }));
await cekaj(500);
proveri("promenjen PIN gasi upozorenje", (await stanje()) === false, String(await stanje()));
w.close(); await cekaj(300);

// ---- 4) STARIJI LAUNCHER NE SME DA OBRISE ONO STO ZNAMO ----
// Racunar se u medjuvremenu mogao samo restartovati na staru verziju; poslednje
// sto je javio je i dalje tacan podatak o toj masini.
w = await spoji();
w.send(JSON.stringify({ t: "sys_info", nics: [{ ip: "192.168.1.50", mac: "aa:bb:cc:dd:ee:01" }] })); // bez polja
await cekaj(500);
proveri("stariji launcher ne brise poznato stanje", (await stanje()) === false, String(await stanje()));
w.close(); await cekaj(300);

// ---- 5) ne javlja se dvaput za isto ----
// Launcher salje sys_info pri svakom povezivanju, a veza puca i vraca se.
// Bez provere promene bi se log punio istim zapisom svakih par minuta.
const preBroj = ((await api("/api/logs?category=sistem")).items || []).filter((l) => l.action === "pin_fabricki").length;
for (let i = 0; i < 3; i++) {
  w = await spoji();
  w.send(JSON.stringify({ t: "sys_info", nics: [{ ip: "192.168.1.50", mac: "aa:bb:cc:dd:ee:01" }], fabrickiPin: false }));
  await cekaj(300);
  w.close(); await cekaj(200);
}
const posleBroj = ((await api("/api/logs?category=sistem")).items || []).filter((l) => l.action === "pin_fabricki").length;
proveri("isto stanje se ne upisuje ponovo", posleBroj === preBroj, `${preBroj} -> ${posleBroj}`);

// ---- 6) panel i launcher stvarno rade svoj deo ----
const app = citajIzvor("server/public/js/app.js");
proveri("panel ima upozorenje za fabricki PIN", /function upozorenjePin\(/.test(app));
proveri("upozorenje stoji na kontrolnoj tabli", /\$\{upozorenjePin\(\)\}/.test(app));
proveri("upozorenje NABRAJA racunare", /masine\.join\(", "\)/.test(app),
  "bez imena vlasnik mora da obidje svih 13 masina da nadje koju");
const main = citajIzvor("client/main.js");
proveri("launcher javlja stanje svog PIN-a",
  /fabrickiPin: !imaPinSaServera\(\) && servisniPin\(\) === FABRICKI_PIN/.test(main));

// ---- PIN SE UPISUJE JEDNOM, U PANELU, I STIZE NA SVE MASINE ----
//
// Rucno upisivanje u podesavanja.json na svakoj masini nije bila nezgodna
// procedura nego los dizajn: PIN koji se menja na trinaest mesta ne promeni se
// nigde. Ostajao je fabricki 1234 - bas onaj kojim igrac koji iscupa mrezni
// kabl preusmerava racunar na svoj server.
const srv = citajIzvor("server/src/service.js");
proveri("server ume da posalje servisni PIN", /export function servisniPinZaKlijenta\(/.test(srv));
proveri("SALJE SE HES, NE SAM PIN", /scryptSync\(pin, Buffer\.from\(so, "hex"\), 32\)/.test(srv),
  "server nikad ne salje unlock_pin klijentima; isto pravilo vazi i ovde");
proveri("PIN ide uz svako povezivanje", /servisniPin: servisniPinZaKlijenta\(\),/.test(srv));
proveri("izmena u panelu stize ODMAH", /export function posaljiServisniPin\(/.test(srv)
  && /broadcastClients\(\{ t: "servisni_pin"/.test(srv),
  "inace bi nov PIN vazio tek posle restarta svakog racunara");
const rt = citajIzvor("server/src/routes.js");
proveri("ruta salje PIN kad se promeni", /if \(changed\.includes\("servisniPin"\)\) svc\.posaljiServisniPin\(\)/.test(rt));

proveri("launcher pamti PIN sa servera", /function zapamtiServisniPin\(/.test(main));
proveri("cuva se u config.json koji nadogradnja ne dira", /servisniPinHes: novi/.test(main));
// Kad PIN stigne sa servera, vazi SAMO on: i fabricki 1234 i PIN iz
// podesavanja.json prestaju da vaze. Fajl je u folderu instalacije, a on je u
// profilu igraca - igrac bi upisao svoj PIN i njime izasao iz kioska.
proveri("FABRICKI PRESTAJE DA VAZI kad stigne pravi (i PIN iz fajla)",
  /if \(saServera\?\.hes\) return false;\s*const lokalni = servisniPin\(\);/.test(main),
  "cela poenta: dok 1234 radi, masina se preusmerava na tudji server");
proveri("dok PIN sa servera nije stigao, i dalje prolazi rucno upisan PIN", /return pin === lokalni;/.test(main),
  "pogresna strogost ovde zakljucava osoblje na svih 13 masina");
proveri("poredjenje hesa je otporno na merenje vremena", /timingSafeEqual\(Buffer\.from\(test, "hex"\)/.test(main));

proveri("panel ima polje za servisni PIN", /id="setSPin"/.test(app));
proveri("polje se salje pri cuvanju", /servisniPin: \$\("#setSPin"\)\.value/.test(app));
proveri("panel upozorava dok PIN nije podesen", /Još nije podešen, pa na računarima važi fabrički 1234/.test(app));

console.log(`\n${prosao}/${prosao + pao} proslo`);
await new Promise((r) => setTimeout(r, 300));
process.exit(pao ? 1 : 0);
