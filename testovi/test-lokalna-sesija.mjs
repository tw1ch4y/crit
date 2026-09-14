import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { radniFolder, brojac } from "./_okruzenje.mjs";
import * as srv from "../server/src/offline.js";
// SESIJA KOJA RADI I KAD SERVERA NEMA - RAČUN, BEZ MREŽE I BEZ ELECTRONA
//
// Launcher broji sekunde sesije i kad server ćuti, a server kad se vrati
// naplaćuje razliku. Ovo je račun sa novcem igrača, pa se ovde proverava na
// brojkama, sa lažnim satovima:
//
//   - launcher i server potpisuju isto (inače bi svaki izveštaj bio odbijen)
//   - bez veze se broji dalje i vreme se troši; sa vezom vodi server
//   - sat koji preskoči ili ode unazad ne pomera brojač
//   - zapis preživi restart, a vreme dok launcher nije radio se ne broji
//   - prepravljen, prekinut ili tuđi zapis se ne prihvata
//   - potvrda ne gubi sekunde odbrojane dok je putovala
//   - server naplaćuje samo razliku, po nižoj ceni, nikad više od kredita,
//     i isti izveštaj poslat dvaput ne naplaćuje dvaput
//
// Sa pravim serverom i WebSocket-om to proverava test-offline-naplata.mjs.
const require = createRequire(import.meta.url);
const L = require("../client/lokalna-sesija.js");
const { proveri, kraj } = brojac();
const DIR = radniFolder("lokalna-sesija");
const naDec = (x) => Math.round(x * 10) / 10;

let mono = 5000;
let zid = 1780000000000;
const napravi = (ime, token = "token-pc-07") =>
  new L.LokalnaSesija({ putanja: path.join(DIR, ime + ".json"), token, sat: () => zid, monoton: () => mono });
// Protekne n sekundi, sa otkucajem svake sekunde - kao u launcheru.
const protekne = (ls, n) => { for (let i = 0; i < n; i++) { mono += 1000; zid += 1000; ls.tik(); } };
const prijava = (o = {}) => ({
  t: "login_ok", player: { id: 7, username: "mile", displayName: "Mile" },
  balance: 120, remainingSeconds: 3600, session: { id: 42, startedAt: zid, sekundi: 0 }, ...o,
});

// ---- 1) POTPIS JE ISTI NA OBA KRAJA ----
const z = { v: 1, sesija: 42, sekundi: 12.5, cena: 120, kraj: null, igrac: 7 };
const zObrnut = { igrac: 7, kraj: null, cena: 120, sekundi: 12.5, sesija: 42, v: 1 };
proveri("launcher i server potpisuju isto", L.potpisi(z, "t") === srv.potpisi(z, "t"));
proveri("redosled ključeva ne menja potpis", L.potpisi(z, "t") === L.potpisi(zObrnut, "t"));
proveri("drugi token daje drugi potpis", L.potpisi(z, "t") !== L.potpisi(z, "t2"));
proveri("server prihvata potpis launchera", srv.potpisJeIspravan(z, L.potpisi(z, "t"), "t"));
proveri("prepravljen broj ne prolazi", !srv.potpisJeIspravan({ ...z, sekundi: 2 }, L.potpisi(z, "t"), "t"));
proveri("računar bez tokena ne prolazi", !srv.potpisJeIspravan(z, L.potpisi(z, ""), ""));
proveri("smeće umesto potpisa ne prolazi", !srv.potpisJeIspravan(z, "abc", "t") && !srv.potpisJeIspravan(z, null, "t"));

// ---- 2) DOK JE VEZA ŽIVA, VODI SERVER ----
const ls = napravi("glavna");
ls.postaviCenu(120);
ls.postaviVezu(true);
proveri("prijava pokreće sesiju", ls.zapocni(prijava()) && ls.aktivna());
proveri("na početku je sat pun", ls.preostalo() === 3600, String(ls.preostalo()));
protekne(ls, 10);
proveri("broji dok je na vezi", ls.ukupnoSekundi() === 10, String(ls.ukupnoSekundi()));
proveri("na vezi nema šta da se prijavi", ls.izvestaj() === null && !ls.cekaPotvrdu());
ls.sinhronizuj({ t: "balance", balance: 119.67, remainingSeconds: 3590, sesija: 42, sekundi: 10 });
proveri("naplata servera poravna brojač", ls.ukupnoSekundi() === 10 && ls.stanje().odSinhronizacije === 0);

// ---- 3) BEZ VEZE ----
ls.postaviVezu(false);
protekne(ls, 30);
proveri("bez veze sat ide dalje", ls.ukupnoSekundi() === 40, String(ls.ukupnoSekundi()));
proveri("i vreme se troši", ls.preostalo() === Math.floor((119.67 / 120) * 3600 - 30), String(ls.preostalo()));
proveri("i to mora da se prijavi", ls.cekaPotvrdu());
const staraNaplata = ls.sinhronizuj({ t: "balance", balance: 119.5, remainingSeconds: 3585, sesija: 42, sekundi: 15 });
proveri("zakasnela naplata ne pregazi brojač pre potvrde", !staraNaplata && ls.ukupnoSekundi() === 40);
ls.sinhronizuj({ t: "balance", balance: 619.67, remainingSeconds: 18590 });
proveri("dopuna menja samo kredit", ls.stanje().kredit === 619.67 && ls.ukupnoSekundi() === 40);
ls.sinhronizuj({ t: "balance", balance: 119.67, remainingSeconds: 3590 });

// ---- 4) IZVEŠTAJ ----
const iz = ls.izvestaj();
proveri("izveštaj nosi ukupno odbrojane sekunde", iz?.zapis.sekundi === 40, JSON.stringify(iz?.zapis));
proveri("i cenu koju je igrač video", iz?.zapis.cena === 120);
proveri("server ga čita i prihvata potpis", !!srv.procitajZapis(iz.zapis) && srv.potpisJeIspravan(iz.zapis, iz.potpis, "token-pc-07"));

// ---- 5) SAT KOJI LAŽE ----
const pre = ls.ukupnoSekundi();
mono += 3600 * 1000; ls.tik();
proveri("sat koji preskoči sat vremena broji najviše 5 s", ls.ukupnoSekundi() === pre + L.NAJVISE_PO_TIKU,
  `${pre} -> ${ls.ukupnoSekundi()}`);
const pre2 = ls.ukupnoSekundi();
mono -= 50000; ls.tik();
proveri("sat koji ode unazad ne oduzima", ls.ukupnoSekundi() === pre2);

// ---- 6) ZAPIS NA DISKU ----
const put = path.join(DIR, "glavna.json");
ls.snimi(true);
proveri("zapis je na disku", fs.existsSync(put));
proveri("i bez privremenog fajla", !fs.existsSync(put + ".novo"));
mono += 7200 * 1000; // launcher nije radio dva sata
const vracena = napravi("glavna");
vracena.ucitaj();
proveri("posle restarta sesija je tu, sa istim brojem", vracena.aktivna() && vracena.ukupnoSekundi() === ls.ukupnoSekundi(),
  `${vracena.ukupnoSekundi()} vs ${ls.ukupnoSekundi()}`);
vracena.postaviVezu(false);
protekne(vracena, 1);
proveri("vreme dok launcher nije radio se ne broji", vracena.ukupnoSekundi() === naDec(ls.ukupnoSekundi() + 1),
  String(vracena.ukupnoSekundi()));

const sirovo = JSON.parse(fs.readFileSync(put, "utf8"));
sirovo.podaci.sekundiServer = 0;
fs.writeFileSync(path.join(DIR, "prepravljena.json"), JSON.stringify(sirovo));
const prep = napravi("prepravljena"); prep.ucitaj();
proveri("prepravljen zapis se ne prihvata", !prep.aktivna() && prep.neispravanZapis === "potpis");
fs.writeFileSync(path.join(DIR, "pola.json"), fs.readFileSync(put, "utf8").slice(0, 40));
const pola = napravi("pola"); pola.ucitaj();
proveri("prekinut upis se ne prihvata", !pola.aktivna() && pola.neispravanZapis === "ostecen");
fs.copyFileSync(put, path.join(DIR, "drugi-token.json"));
const tudj = napravi("drugi-token", "token-drugog-servera"); tudj.ucitaj();
proveri("zapis sa tokenom drugog servera se ne prihvata", !tudj.aktivna() && tudj.neispravanZapis === "potpis");
const nema = napravi("ne-postoji"); nema.ucitaj();
proveri("kad zapisa nema, to nije greška", !nema.aktivna() && nema.neispravanZapis === null);
fs.writeFileSync(path.join(DIR, "stari.json.novo"), "{pola");
fs.copyFileSync(put, path.join(DIR, "stari.json"));
const sPriv = napravi("stari"); sPriv.ucitaj();
proveri("ostatak prekinutog upisa ne smeta celom zapisu", sPriv.aktivna());

// ---- 7) POTVRDA ----
// Dalje radi vraćena instanca - ona je launcher posle restarta. Stara je
// ostala sa satom od pre dva sata i više ništa ne broji.
// Izveštaj je poslat sa 45 s; dok potvrda putuje, prođu još 3 s na vezi.
vracena.postaviVezu(true);
const poslato = vracena.ukupnoSekundi();
protekne(vracena, 3);
proveri("potvrda je prihvaćena",
  vracena.potvrdi({ t: "offline_primljen", sesija: 42, stanje: "nastavljeno", sekundi: poslato, balance: 118.5 }));
proveri("sekunde posle slanja nisu izgubljene", vracena.ukupnoSekundi() === naDec(poslato + 3) && naDec(vracena.stanje().odSinhronizacije) === 3,
  JSON.stringify(vracena.stanje()));
proveri("kredit je onaj posle obračuna", vracena.stanje().kredit === 118.5);
proveri("posle potvrde nema šta da se šalje", !vracena.cekaPotvrdu() && vracena.izvestaj() === null);
proveri("potvrda za tuđu sesiju se ne prihvata", !vracena.potvrdi({ sesija: 99, stanje: "zavrseno" }) && vracena.aktivna());
vracena.sinhronizuj({ t: "balance", balance: 118.4, remainingSeconds: 3552, sesija: 42, sekundi: 48 });
proveri("posle potvrde naplata servera opet vodi", vracena.ukupnoSekundi() === 48 && vracena.stanje().odSinhronizacije === 0);

// ---- 8) KRAJ BEZ SERVERA ----
vracena.postaviVezu(false);
protekne(vracena, 5);
proveri("odjava bez servera", vracena.zavrsi("odjava") && !vracena.aktivna() && vracena.cekaPotvrdu());
const krajBroj = vracena.ukupnoSekundi();
protekne(vracena, 20);
proveri("posle kraja sat stoji", vracena.ukupnoSekundi() === krajBroj);
proveri("kraj ide u izveštaj", vracena.izvestaj()?.zapis.kraj === "odjava");
proveri("drugi kraj se ne upisuje preko prvog", !vracena.zavrsi("vreme") && vracena.izvestaj().zapis.kraj === "odjava");
proveri("nepoznat razlog kraja se ne prima", !napravi("x").zavrsi("bilo sta"));
vracena.potvrdi({ t: "offline_primljen", sesija: 42, stanje: "zavrseno" });
proveri("potvrđen kraj briše zapis", !vracena.cekaPotvrdu() && !fs.existsSync(put));

// ---- 8b) OTKLJUČANO BEZ SERVERA ----
const ot = napravi("otkljucavanje"); ot.postaviCenu(120); ot.postaviVezu(false);
ot.zapocni(prijava({ session: { id: 60, startedAt: zid, sekundi: 0 } }));
proveri("aktivna sesija se ne otključava", !ot.otkljucaj());
protekne(ot, 3); ot.zavrsi("vreme");
proveri("zaključan ekran posle isteklog vremena se otključava", ot.otkljucaj() && ot.izvestaj().zapis.otkljucano === true);
proveri("i to samo jednom", !ot.otkljucaj());
const oj = napravi("odjava-otkljucavanje"); oj.postaviCenu(120); oj.postaviVezu(false);
oj.zapocni(prijava({ session: { id: 61, startedAt: zid, sekundi: 0 } })); oj.zavrsi("odjava");
proveri("posle odjave nema šta da se otključa", !oj.otkljucaj() && oj.izvestaj().zapis.otkljucano === false);
proveri("server čita otključavanje samo kao pravo da",
  srv.procitajZapis({ v: 1, sesija: 1, sekundi: 5, cena: 1, kraj: "vreme", otkljucano: true }).otkljucano === true &&
  srv.procitajZapis({ v: 1, sesija: 1, sekundi: 5, cena: 1, kraj: "vreme", otkljucano: "da" }).otkljucano === false);

// ---- 9) PRIJAVA ----
const n = napravi("nova"); n.postaviCenu(120); n.postaviVezu(true);
n.zapocni(prijava());
n.postaviVezu(false); protekne(n, 12);
n.postaviVezu(true);
n.zapocni(prijava({ balance: 100 })); // stariji server vrati istu sesiju pre izveštaja
proveri("ista sesija pre potvrde: brojač ostaje", n.ukupnoSekundi() === 12 && n.cekaPotvrdu());
n.zapocni(prijava({ session: { id: 43, startedAt: zid, sekundi: 0 } }));
proveri("nova sesija počinje od nule", n.ukupnoSekundi() === 0 && !n.cekaPotvrdu() && n.stanje().sesija === 43);

// ---- 10) STARIJI SERVER ----
const st = napravi("stari-server"); st.postaviCenu(120); st.postaviVezu(true);
st.zapocni(prijava({ session: { id: 50, startedAt: zid } })); // bez "sekundi"
st.postaviVezu(false); protekne(st, 20);
proveri("bez servera i dalje odbrojava", st.preostalo() === 3580, String(st.preostalo()));
proveri("ali stariji server ne dobija izveštaj koji ne ume da pročita", st.izvestaj() === null);
st.postaviVezu(true);
st.sinhronizuj({ t: "balance", balance: 119, remainingSeconds: 3570 });
proveri("i posle povratka ne čeka potvrdu", !st.cekaPotvrdu());

// ---- 11) BEZ NAPLATE I NULA ----
const bn = napravi("bez-naplate"); bn.postaviCenu(0); bn.postaviVezu(false);
bn.zapocni(prijava({ remainingSeconds: null }));
protekne(bn, 100);
proveri("bez naplate nema ni odbrojavanja", bn.preostalo() === null);

const nula = napravi("nula"); nula.postaviCenu(120); nula.postaviVezu(false);
nula.zapocni(prijava({ balance: 0.5, remainingSeconds: 15 }));
protekne(nula, 14);
proveri("sekunda pre kraja", nula.preostalo() === 1, String(nula.preostalo()));
protekne(nula, 2);
proveri("kad istekne, ostalo je nula (tada launcher zaključava)", nula.preostalo() === 0);
protekne(nula, 50);
proveri("i ne ide ispod nule", nula.preostalo() === 0 && nula.procenaKredita() === 0);

// ---- 12) SERVER: OBRAČUN ----
const ses = (o = {}) => ({ id: 42, player_id: 7, status: "active", sekundi: 100, cost: 3.33, ...o });
const zap = (o = {}) => srv.procitajZapis({ v: 1, sesija: 42, igrac: 7, sekundi: 700, cena: 120, kraj: null, ...o });
let r = srv.obracun({ zapis: zap(), sesija: ses(), stopaServera: 120, kredit: 50 });
proveri("naplaćuje se samo razlika", r.dugSekundi === 600 && r.naplaceno === 20 && r.noviKredit === 30 && r.noveSekunde === 700,
  JSON.stringify(r));
proveri("i sesija ide dalje", r.kraj === null);
r = srv.obracun({ zapis: zap(), sesija: ses({ sekundi: 700 }), stopaServera: 120, kredit: 30 });
proveri("isti izveštaj drugi put ne naplaćuje ništa", r.naplaceno === 0 && r.noveSekunde === 700);
r = srv.obracun({ zapis: zap({ sekundi: 702 }), sesija: ses({ sekundi: 700 }), stopaServera: 120, kredit: 30 });
proveri("tri sekunde šuma nisu naplata", r.naplaceno === 0 && r.noveSekunde === 700);
r = srv.obracun({ zapis: zap({ sekundi: 500 }), sesija: ses({ sekundi: 700 }), stopaServera: 120, kredit: 30 });
proveri("manje od već naplaćenog ne vraća novac i ne kvari brojač", r.naplaceno === 0 && r.noveSekunde === 700);
r = srv.obracun({ zapis: zap(), sesija: ses(), stopaServera: 240, kredit: 50 });
proveri("po nižoj ceni kad je vlasnik u međuvremenu podigao", r.naplaceno === 20, String(r.naplaceno));
r = srv.obracun({ zapis: zap({ cena: 240 }), sesija: ses(), stopaServera: 120, kredit: 50 });
proveri("i kad ju je spustio", r.naplaceno === 20);
r = srv.obracun({ zapis: zap(), sesija: ses(), stopaServera: 120, kredit: 5 });
proveri("nikad više nego što igrač ima", r.naplaceno === 5 && r.noviKredit === 0 && r.nedostaje === 15, JSON.stringify(r));
proveri("a kad kredita nema, sesija se završava", r.kraj === "vreme");
r = srv.obracun({ zapis: zap({ kraj: "odjava" }), sesija: ses(), stopaServera: 120, kredit: 50 });
proveri("odjava bez servera se poštuje", r.kraj === "odjava" && r.naplaceno === 20);
r = srv.obracun({ zapis: zap({ kraj: "vreme" }), sesija: ses(), stopaServera: 120, kredit: 500 });
proveri("isteklo lokalno ostaje kraj i kad je u međuvremenu dopunjen", r.kraj === "vreme" && r.noviKredit === 480);
r = srv.obracun({ zapis: zap(), sesija: ses(), stopaServera: 0, kredit: 50 });
proveri("bez cene nema naplate", r.naplaceno === 0 && r.kraj === null);
proveri("zatvorena sesija se ne dira",
  srv.obracun({ zapis: zap(), sesija: ses({ status: "ended" }), stopaServera: 120, kredit: 50 }).razlog === "sesija_nije_aktivna");
proveri("ni kad sesije nema", srv.obracun({ zapis: zap(), sesija: null, stopaServera: 120, kredit: 50 }).razlog === "sesija_nije_aktivna");
proveri("ni druga sesija", srv.obracun({ zapis: zap({ sesija: 41 }), sesija: ses(), stopaServera: 120, kredit: 50 }).razlog === "sesija_nije_aktivna");
proveri("ni drugi igrač", srv.obracun({ zapis: zap({ igrac: 8 }), sesija: ses(), stopaServera: 120, kredit: 50 }).razlog === "drugi_igrac");

// ---- 13) OBLIK ZAPISA ----
for (const [opis, zz] of [
  ["prazno", null], ["niz", []], ["druga verzija", { v: 2, sesija: 1, sekundi: 1, cena: 1 }],
  ["sekunde kao tekst", { v: 1, sesija: 1, sekundi: "100", cena: 120 }],
  ["negativne sekunde", { v: 1, sesija: 1, sekundi: -5, cena: 120 }],
  ["nemoguće duga sesija", { v: 1, sesija: 1, sekundi: srv.NAJDUZE_SEKUNDI + 1, cena: 120 }],
  ["nepoznat kraj", { v: 1, sesija: 1, sekundi: 5, cena: 120, kraj: "hakovano" }],
  ["sesija nije broj", { v: 1, sesija: "1 OR 1=1", sekundi: 5, cena: 120 }],
  ["cena NaN", { v: 1, sesija: 1, sekundi: 5, cena: NaN }],
]) proveri(`odbija: ${opis}`, srv.procitajZapis(zz) === null);
proveri("prima ispravan", !!srv.procitajZapis({ v: 1, sesija: 1, sekundi: 5, cena: 120, kraj: "vreme", igrac: 3 }));

await kraj();
