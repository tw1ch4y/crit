import fs from "node:fs";
import path from "node:path";
import { KOREN, citajIzvor, brojac } from "./_okruzenje.mjs";
import { mesta, zamene, oznaka, FAJLOVI_SA_IMENOM } from "../igraonica.mjs";
// SVAKA IGRAONICA DOBIJA INSTALER SA SVOJIM IMENOM
//
// Ime `Crit` je stajalo u instaleru, u precici na desktopu, u imenu foldera u
// koji se launcher instalira i u alatima za oporavak. Dok je igraonica jedna,
// to nikome ne smeta. Cim program dobije drugu igraonicu, ona dobija instaler
// koji se zove tudjim imenom - a njeni alati za oporavak gase proces koji na toj
// masini ne postoji, i pri tom uredno jave da je sve proslo.
//
// OVA PROVERA JE VEC NASLA DVA PROMASAJA pri prvom preimenovanju. Jedan
// bezazlen (folder sa podesavanjima se ne obrise), drugi opasan: u
// POPRAVI-RACUNAR.bat je `find` bio zamenjen a `tasklist /FI "IMAGENAME eq ..."`
// nije - pa bi alat za oporavak zauvek mislio da launcher jos radi. Alat koji se
// pokrece kad je vec sve otislo naopako mora da radi.
//
// Zato se ovde preimenovanje STVARNO IZVRSI (u memoriji, fajlovi se ne diraju) i
// gleda sta je prezivelo.
const { proveri, kraj } = brojac();

const brend = JSON.parse(citajIzvor("igraonica.json"));

// ---- 1) izvor je sam sa sobom u skladu ----
proveri("ime igraonice je upisano", !!brend.ime && brend.ime.length <= 40, JSON.stringify(brend.ime));
proveri("ime launchera prati ime igraonice", brend.launcher === `${brend.ime} Launcher`, brend.launcher);
proveri("oznaka je izvedena iz imena", brend.oznaka === oznaka(brend.ime), `${brend.oznaka} != ${oznaka(brend.ime)}`);
proveri("appId nosi oznaku", brend.appId === `rs.${brend.oznaka}.launcher`, brend.appId);

// ---- 2) svako mesto nosi to ime ----
const uzmi = (o, put) => put.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
for (const m of mesta(brend)) {
  const sad = uzmi(JSON.parse(citajIzvor(m.fajl)), m.polje);
  proveri(`${m.fajl} ${m.polje} (${m.opis})`, sad === m.vrednost, `"${sad}" umesto "${m.vrednost}"`);
}

// ---- 3) alati za oporavak zovu launcher TACNIM imenom ----
//
// Ovi .bat fajlovi se pokrecu kad masina vec ne radi kako treba. Ako gadjaju
// pogresno ime procesa, ne rade nista - a ispisu da je sve proslo.
const popravi = citajIzvor("client/POPRAVI-RACUNAR.bat");
const deinstaliraj = citajIzvor("client/DEINSTALIRAJ-LAUNCHER.bat");
const reset = citajIzvor("client/resetuj-launcher.bat");
const exe = `${brend.launcher}.exe`;
proveri("POPRAVI-RACUNAR gasi pravi proces", popravi.includes(`taskkill /IM "${exe}"`), exe);
proveri("POPRAVI-RACUNAR proverava pravi proces",
  popravi.includes(`IMAGENAME eq ${exe}`) && popravi.includes(`find /I "${exe}"`),
  "oba mesta moraju da gadjaju isto ime - inace petlja misli da launcher jos radi");
proveri("DEINSTALIRAJ gasi pravi proces", deinstaliraj.includes(`taskkill /IM "${exe}"`), exe);
proveri("DEINSTALIRAJ zna obe putanje instalacije",
  deinstaliraj.includes(`%ProgramFiles%\\${brend.launcher}\\Uninstall ${brend.launcher}.exe`) &&
  deinstaliraj.includes(`%LOCALAPPDATA%\\Programs\\${brend.launcher}\\Uninstall ${brend.launcher}.exe`),
  "stara instalacija je isla u Program Files, nova ide u profil - alat mora da nadje obe");
proveri("DEINSTALIRAJ brise pravi folder podesavanja",
  deinstaliraj.includes(`%APPDATA%\\${brend.oznaka}-launcher`) && deinstaliraj.includes(`%APPDATA%\\${brend.launcher}`),
  "Electron folder imenuje po productName, a stariji po imenu paketa");
proveri("reset brise pravi folder podesavanja",
  reset.includes(`"${brend.oznaka}-launcher"`) && reset.includes(`"${brend.launcher}"`));
proveri("precica u autostartu se trazi po imenu igraonice",
  popravi.includes(`Startup\\${brend.ime}*.lnk`), `Startup\\${brend.ime}*.lnk`);

// ---- 4) PREIMENOVANJE PROLAZI KROZ SVE ----
//
// Ovo je provera koja je nasla prave greske. Preimenuje se u memoriji, pa se
// gleda da li je igde ostalo staro ime.
// Probno ime NE SME da lici na pravo. Prvi put je ovde stajalo bas ono ime na
// koje je igraonica u medjuvremenu preimenovana - pa je provera trazila staro
// ime, nalazila novo (isto), i prijavila devet gresaka kojih nema.
const PROBNO = "Vrbaska Kockica";
const NOVO = { ime: PROBNO, launcher: `${PROBNO} Launcher`, oznaka: oznaka(PROBNO), appId: `rs.${oznaka(PROBNO)}.launcher` };
proveri("probno ime se ne preklapa sa pravim",
  !new RegExp(brend.ime, "i").test(PROBNO) && !new RegExp(PROBNO, "i").test(brend.ime),
  `"${brend.ime}" i "${PROBNO}" - promeni probno ime u ovoj proveri`);
const z = zamene(brend, NOVO);

// STA SME DA OSTANE: unutrasnja imena koja ne vidi nijedan korisnik. Baza se ne
// preimenuje jer bi svi postojeci podaci ostali sa strane; kljuc sare i imena
// funkcija idu kroz kod, ne na ekran.
const SME_DA_OSTANE = [
  /crit\.db/i,               // ime fajla baze - preimenovanje bi odseklo postojece podatke
  // ime rezervne kopije (crit-<vreme>.db) - "crit-" samo za sebe NIJE dozvoljeno,
  // jer je i "crit-launcher" takav, a on mora da se preimenuje
  /crit-[\s\S]*\.db|\.db[\s\S]*crit-/i,
  /CRIT_DATA_DIR/,           // promenljiva okruzenja za izolovanu instancu
  /X-Crit-/,                 // zaglavlja u odgovoru servera, ne vidi ih korisnik
  /promoCrit|napraviPromoCrit|promo-crit-/, // imena funkcija i fajla
  /^\s*crit: \{/,            // kljuc sare - postojece baze ga imaju upisanog
  /tekstura: "crit"/,        // podrazumevani kljuc sare u bazi
  // Komentari su za onoga ko odrzava program, ne za igraonicu. Traze se CELI
  // redovi komentara - kod iza komentara u istom redu i dalje mora da se
  // preimenuje, pa ovo ne otvara rupu.
  /^\s*(\/\/|REM\b)/,
];

for (const f of [...FAJLOVI_SA_IMENOM, "client/package.json", "server/package.json"]) {
  let t;
  try { t = fs.readFileSync(path.join(KOREN, f), "utf8"); } catch { continue; }
  // package.json se menja po poljima, pa se ovde primenjuju i ta pravila
  let posle = t;
  for (const [a, b] of z) posle = posle.split(a).join(b);
  if (f.endsWith("package.json")) {
    for (const m of mesta(brend)) {
      if (m.fajl !== f) continue;
      posle = posle.split(JSON.stringify(m.vrednost)).join(JSON.stringify(mesta(NOVO).find((x) => x.polje === m.polje && x.fajl === f).vrednost));
    }
  }
  const ostalo = posle.split("\n")
    .map((red, i) => ({ red, i: i + 1 }))
    .filter(({ red }) => new RegExp(brend.ime, "i").test(red))
    .filter(({ red }) => !SME_DA_OSTANE.some((r) => r.test(red)));
  proveri(`${f}: preimenovanje ne ostavlja staro ime`, ostalo.length === 0,
    ostalo.map(({ red, i }) => `${i}: ${red.trim().slice(0, 70)}`).join(" | "));
}

// ---- 5) alat za pakovanje ime CITA, ne nosi upisano ----
const paket = citajIzvor("napravi-paket.mjs");
proveri("napravi-paket cita ime iz igraonica.json", /igraonica\.json/.test(paket),
  "inace bi uputstvo koje ide u tudju igraonicu nosilo tudje ime");
proveri("napravi-paket nema upisano ime",
  !new RegExp(brend.ime, "i").test(paket.replace(/crit\.db/gi, "")),
  "instaler se trazi po imenu - upisano ime bi u drugoj igraonici naslo nista");

// ---- 6) sara sa imenom kuce se crta od naziva iz panela ----
//
// Jedina stvar u launcheru koju vlasnik ne bi mogao da promeni iz panela, a
// igrac je gleda ceo dan iza svake police.
const svc = citajIzvor("server/src/service.js");
proveri("sara sa imenom kuce se crta u hodu", /saraOd: \(ime\) =>/.test(svc));
proveri("ime u sari je eskejpovano", /escXml\(t\)/.test(svc),
  "naziv sa & ili < pokvario bi ceo SVG, a to je pozadina svakog ekrana");
proveri("spisak sara je na jednom mestu", /export function teksturaSpisak\(\)/.test(svc) &&
  /svc\.teksturaSpisak\(\)/.test(citajIzvor("server/src/routes.js")),
  "vec se jednom razislo: launcher je dobijao razresenu saru, panel sirov objekat sa funkcijom");

kraj();
