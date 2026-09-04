import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Tekstura pozadine: sitna sara koja se ponavlja preko celog ekrana. Bitno je
// da postoji SAMO jedna definicija sare (u service.js) - da pregled u panelu ne
// pokazuje jedno a igrac vidi drugo. Zato se ovde proverava i da panel i
// launcher nemaju svoje kopije.
const BASE = "http://127.0.0.1:8113", WSB = "ws://127.0.0.1:8113";
const DATA = radniFolder("tekstura-data");
await podigniServer(DATA, 8113);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const prijava = async (ko, lozinka) => (await fetch(BASE + "/api/login", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ko, password: lozinka }) }).then((r) => r.json())).token;
const zovi = (t) => async (p, m = "GET", b) => {
  const r = await fetch(BASE + p, { method: m,
    headers: { "content-type": "application/json", authorization: "Bearer " + t },
    body: b ? JSON.stringify(b) : undefined });
  const tx = await r.text(); let j; try { j = JSON.parse(tx); } catch { j = tx; }
  return { status: r.status, body: j };
};
const api = zovi(await prijava("admin", "admin"));

// ---- spisak ----
const spisak = (await api("/api/tekstura")).body;
const kljucevi = Object.keys(spisak.spisak);
proveri("nudi deset izbora", kljucevi.length === 10, JSON.stringify(kljucevi));
proveri("izbori su ocekivani",
  ["nema", "tacke", "zvezde", "prasak", "kose", "kockice", "sace", "munje", "crit", "romb"].every((k) => kljucevi.includes(k)),
  JSON.stringify(kljucevi));
// Sveza igraonica dobija saru upaljenu - inace izgleda ravno i niko ne zna da
// funkcija postoji dok je ne potrazi u podesavanjima. Vlasnik koji hoce ravnu
// pozadinu bira "bez sare"; njegov izbor se pamti (seed ga ne gazi).
proveri("podrazumevano je sara ukljucena",
  spisak.izbor.kljuc === "crit" && spisak.izbor.prozirnost > 0, JSON.stringify(spisak.izbor));
proveri("podrazumevano kretanje se vidi (nije mirno)",
  spisak.izbor.kretanje === "talas", JSON.stringify(spisak.izbor.kretanje));
proveri("nudi tri jacine", Object.keys(spisak.jacine).length === 3, JSON.stringify(spisak.jacine));

// Sara mora da bude url("data:image/svg+xml,...") sa kodiranim < > #, inace je
// CSS ne primi. Nekodiran znak bi ostavio pozadinu praznom bez ijedne greske.
for (const [k, o] of Object.entries(spisak.spisak)) {
  if (k === "nema") { proveri('"nema" nema saru', o.sara === ""); continue; }
  proveri(`"${k}" ima ispravan oblik sare`, /^url\("data:image\/svg\+xml,[^"]+"\)$/.test(o.sara), o.sara.slice(0, 60));
  proveri(`"${k}" nema nekodiran znak`, !/[<>#]/.test(o.sara), (o.sara.match(/[<>#]/g) || []).join(""));
  proveri(`"${k}" ima naziv i opis`, !!o.naziv && !!o.opis);
}

// ---- biranje ----
const r1 = await api("/api/tekstura", "POST", { kljuc: "zvezde", jacina: "jako" });
proveri("izbor se pamti", r1.status === 200 && r1.body.kljuc === "zvezde" && r1.body.jacina === "jako", JSON.stringify(r1.body));
proveri("odgovor nosi saru i prozirnost",
  /^url\("data:image/.test(r1.body.sara || "") && r1.body.prozirnost === 1, JSON.stringify({ p: r1.body.prozirnost }));

const posle = (await api("/api/tekstura")).body;
proveri("izbor prezivi novo citanje", posle.izbor.kljuc === "zvezde" && posle.izbor.jacina === "jako", JSON.stringify(posle.izbor));

// jacina se menja bez diranja sare
const r2 = await api("/api/tekstura", "POST", { kljuc: "zvezde", jacina: "slabo" });
proveri("slabija jacina spusta prozirnost", r2.body.prozirnost < 1 && r2.body.prozirnost > 0, String(r2.body.prozirnost));
proveri("sara ostaje ista pri promeni jacine", r2.body.sara === r1.body.sara);

// "nema" uvek gasi teksturu, bez obzira na jacinu
const r3 = await api("/api/tekstura", "POST", { kljuc: "nema", jacina: "jako" });
proveri('"nema" gasi teksturu i na jakoj jacini', r3.body.prozirnost === 0 && r3.body.sara === "", JSON.stringify(r3.body));

// ---- neispravan unos ----
proveri("nepoznata sara se odbija", (await api("/api/tekstura", "POST", { kljuc: "duga" })).status === 400);
proveri("nepoznata jacina se odbija", (await api("/api/tekstura", "POST", { kljuc: "tacke", jacina: "ultra" })).status === 400);
proveri("prazan zahtev se odbija", (await api("/api/tekstura", "POST", {})).status === 400);
const posleLosih = (await api("/api/tekstura")).body.izbor;
proveri("losi zahtevi ne menjaju izbor", posleLosih.kljuc === "nema", JSON.stringify(posleLosih));

// ---- radnik ne sme da menja izgled ----
const radnik = await api("/api/admins", "POST", { username: "pera", password: "pera1234", role: "staff" });
proveri("radnik je napravljen za probu", radnik.status === 200, JSON.stringify(radnik.body));
const apiRadnik = zovi(await prijava("pera", "pera1234"));
proveri("radnik ne sme da menja teksturu", (await apiRadnik("/api/tekstura", "POST", { kljuc: "tacke" })).status === 403);
proveri("radnik ne vidi ni spisak", (await apiRadnik("/api/tekstura")).status === 403);

// ---- launcher dobija izbor odmah ----
await api("/api/tekstura", "POST", { kljuc: "tacke", jacina: "srednje" });
const comps = (await api("/api/computers")).body;
const poruke = [];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
ws.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
await cekaj(600);

const welcome = poruke.find((m) => m.t === "welcome");
proveri("welcome nosi teksturu", !!welcome?.tekstura, JSON.stringify(Object.keys(welcome || {})));
proveri("welcome nosi gotovu saru", /^url\("data:image/.test(welcome?.tekstura?.sara || ""), JSON.stringify(welcome?.tekstura?.kljuc));

poruke.length = 0;
await api("/api/tekstura", "POST", { kljuc: "romb", jacina: "slabo" });
await cekaj(600);
const push = [...poruke].reverse().find((m) => m.t === "tekstura");
proveri("promena stize launcheru bez restarta", !!push, JSON.stringify(poruke.map((m) => m.t)));
proveri("push nosi novu saru", push?.tekstura?.kljuc === "romb" && push?.tekstura?.prozirnost === 0.45, JSON.stringify(push?.tekstura));
ws.close();

// ---- jedna definicija, bez kopija ----
const app = citajIzvor("server/public/js/app.js");
const css = citajIzvor("client/renderer/css/launcher.css");
const launcher = citajIzvor("client/renderer/js/launcher.js");

// Kopija sare izgleda ovako: url("data:image/svg+xml,%3Csvg ... Trazi se bas
// taj oblik, ne samo pomen formata - inace bi i obican komentar pao na testu.
const kopijaSare = (s) => /url\(\s*["']?data:image\/svg\+xml,\s*%3Csvg/i.test(s);
proveri("panel nema svoju kopiju sare", !kopijaSare(app),
  "app.js sadrzi sopstvenu saru - pregled bi mogao da se razidje od launchera");
proveri("launcher.css nema svoju kopiju sare", !kopijaSare(css));
proveri("launcher.js nema svoju kopiju sare", !kopijaSare(launcher));
proveri("css crta saru iz promenljive", css.includes("var(--tekstura, none)") && css.includes("var(--tekstura-vid, 0)"));
proveri("tekstura stoji iznad okacene pozadine",
  css.indexOf("z-index: -1") > 0 && /\.pozadina \{[^}]*z-index: -2/.test(css));

// Server je jedini izvor sare, ali launcher i dalje proverava oblik - da losa
// vrednost ne zavrsi kao CSS koji niko nije napisao.
proveri("launcher proverava oblik sare pre nego sto je upise",
  launcher.includes("^url\\(\"data:image\\/svg\\+xml,"), "nema provere u primeniTeksturu");
proveri("launcher gasi teksturu kad je vrednost neispravna",
  /ispravna \? sara : "none"/.test(launcher));

// Pregled launchera mora da salje teksturu, inace se menja a niko ne primeti.
const pregled = citajIzvor("testovi/pregled-launchera.mjs");
proveri("pregled launchera salje teksturu", pregled.includes("tekstura: tex.izbor"));

// ---- KRETANJE SARE ----
// Sara sme polako da klizi. Korak je velicina plocice: pomeranje za tacno
// jednu plocicu zatvara petlju bez vidljivog skoka.
// Sare koje moraju da postoje. "kockice" je d20 - znak kriticnog pogotka, po
// kome se igraonica i zove, pa se ne sme tiho izgubiti pri nekoj doradi.
const TEKSTURE_OCEKIVANE = { tacke: 1, zvezde: 1, prasak: 1, kose: 1, kockice: 1, sace: 1, munje: 1, crit: 1, romb: 1 };
const sveSare = (await api("/api/tekstura")).body;
proveri("nudi pet nacina kretanja", Object.keys(sveSare.kretanja || {}).length === 5, JSON.stringify(Object.keys(sveSare.kretanja || {})));
proveri("nacini kretanja su ocekivani",
  ["mirno", "klizanje", "talas", "dubina", "iskre"].every((k) => sveSare.kretanja?.[k]), JSON.stringify(Object.keys(sveSare.kretanja || {})));
proveri("mirno znaci da sara stoji", sveSare.kretanja?.mirno?.sekundi === 0);
// Svaki nacin ima svoju brzinu - ako se dva izjednace, jedan od njih je suvisan.
const brzine = ["klizanje", "talas", "dubina"].map((k) => sveSare.kretanja[k].sekundi);
proveri("svaki nacin ima svoju brzinu", new Set(brzine).size === 3, JSON.stringify(brzine));
for (const [k, o] of Object.entries(TEKSTURE_OCEKIVANE)) {
  const s = sveSare.spisak[k];
  proveri(`sara "${k}" postoji`, !!s, JSON.stringify(Object.keys(sveSare.spisak)));
}
const saKretanjem = await api("/api/tekstura", "POST", { kljuc: "kockice", jacina: "srednje", kretanje: "dubina" });
proveri("kretanje se pamti", saKretanjem.body.kretanje === "dubina", JSON.stringify(saKretanjem.body.kretanje));
proveri("uz kretanje stize i korak plocice", saKretanjem.body.korak > 0 && saKretanjem.body.sekundi > 0,
  JSON.stringify({ korak: saKretanjem.body.korak, sekundi: saKretanjem.body.sekundi }));
proveri("bez sare nema ni kretanja",
  (await api("/api/tekstura", "POST", { kljuc: "nema", kretanje: "talas" })).body.sekundi === 0);
// Stara imena iz ranijih verzija ne smeju da ispadnu "nepoznata" i tiho ugase
// kretanje kad se server nadogradi nad zatecenom bazom.
const staro = await api("/api/tekstura", "POST", { kljuc: "kockice", kretanje: "lagano" });
proveri("staro ime kretanja se prevodi, ne odbija", staro.status === 200 && staro.body.kretanje === "klizanje",
  JSON.stringify({ status: staro.status, kretanje: staro.body?.kretanje }));
proveri("nepoznato kretanje se odbija", (await api("/api/tekstura", "POST", { kljuc: "tacke", kretanje: "raketa" })).status === 400);

proveri("css pomera saru za jednu plocicu",
  css.includes("var(--tekstura-korak, 0px)") && css.includes("tekstura-klizi"));
// Svaki nacin ima svoje pravilo u CSS-u i svoju animaciju.
// Blok svakog nacina se izdvoji pa se gleda sta pise u njemu - jednostavnije i
// citljivije nego jedan veliki regex preko celog fajla.
const blok = (selektor) => {
  const i = css.indexOf(selektor);
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
};
// Vraca goli SVG iz url("data:image/svg+xml,...") - da se bela i crvena
// varijanta mogu porediti kao tekst.
const dekodiraj = (u) => String(u)
  .replace(/^url\("data:image\/svg\+xml,/, "").replace(/"\)$/, "")
  .replace(/%3C/g, "<").replace(/%3E/g, ">").replace(/%23/g, "#");
proveri("klizanje pomera poziciju pozadine", blok('[data-kretanje="klizanje"]::after').includes("tekstura-klizi"));
proveri("talas pomera masku, ne saru",
  blok('[data-kretanje="talas"]::after').includes("mask-image") && css.includes("tekstura-talas"));
proveri("dubina crta dva sloja",
  blok('[data-kretanje="dubina"]::after').includes("var(--tekstura, none), var(--tekstura, none)"));
proveri("dubina ima rezervu preko ivica ekrana", blok("body::after").includes("inset: -60px"),
  "bez rezerve bi pomeranje za misem otkrilo prazne ivice");
proveri("launcher prati mis samo za dubinu", launcher.includes("pratiMisZaDubinu"));
proveri("pomeranje se racuna u ritmu iscrtavanja", /dubinaZakazana/.test(launcher),
  "bez toga bi se posao gomilao dok igrac brzo prevlaci misem");
proveri("ime precice se ne lomi nasred reci", blok(".site-name {").includes("word-break: normal"),
  '"BATTLENET" se na 1280 lomio u "BATTLENE / T"');

// ---- ISKRE ----
// Preko nasumicne plocice legne ISTA figura u boji kuce. Da bi izgledalo kao
// da je bas ta figura zasvetlela, crvena mora da se poklopi sa belom ispod nje.
const saIskrama = await api("/api/tekstura", "POST", { kljuc: "kockice", jacina: "srednje", kretanje: "iskre" });
proveri("iskre saljemo kao svoje kretanje", saIskrama.body.kretanje === "iskre", JSON.stringify(saIskrama.body.kretanje));
proveri("uz iskre stize varijanta sare u boji kuce", /^url\("data:image/.test(saIskrama.body.iskra || ""), String(saIskrama.body.iskra).slice(0, 50));
// Iskra nosi BOJU KUCE - koja god da je. Ranije je ovde stajala upisana crvena,
// pa bi provera prolazila i da iskra ignorise izbor vlasnika.
const bojaKuce = (await api("/api/brend")).body.akcenat;
const uAdresi = "%23" + bojaKuce.slice(1);
proveri("iskra nosi boju kuce", (saIskrama.body.iskra || "").includes(uAdresi),
  `${bojaKuce} nije u sari`);
proveri("iskra je puna jacine", (saIskrama.body.iskra || "").includes("0.95"),
  "prigusena iskra se ne bi videla preko bele");
proveri("iskra je ISTI obris kao bela sara",
  dekodiraj(saIskrama.body.iskra).split(bojaKuce).join("#fff").replace(/(fill|stroke)-opacity='[\d.]+'/g, "X")
  === dekodiraj(saIskrama.body.sara).replace(/(fill|stroke)-opacity='[\d.]+'/g, "X"),
  "ako se obrisi razidju, figura u boji kuce nece leci tacno preko bele");
proveri("uz druga kretanja se crvena ne salje",
  (await api("/api/tekstura", "POST", { kljuc: "kockice", kretanje: "talas" })).body.iskra === "",
  "welcome bi bez potrebe nosio dvostruko vise podataka");
proveri("bez sare nema iskri",
  (await api("/api/tekstura", "POST", { kljuc: "nema", kretanje: "iskre" })).body.iskra === "");

proveri("launcher pali iskre", launcher.includes("function pustiIskre"));
proveri("iskra se poravnava na korak mreze", launcher.includes("kolona * korak") && launcher.includes("red * korak"),
  "van mreze bi crvena figura izgledala kao nalepljen kvadrat");
proveri("broj iskri je ogranicen", launcher.includes("NAJVISE_ISKRI"),
  "bez granice bi se gomilale i pozadina bi postala crvena");
proveri("iskra se sama uklanja kad se ugasi", launcher.includes('addEventListener("animationend"'));
proveri("korak vazi i kad se sara ne pomera", launcher.includes("const imaKorak = ispravna"),
  "iskre nemaju trajanje animacije, a korak im treba");
proveri("css ima sloj za iskre", css.includes(".iskre-sloj") && css.includes("iskra-zasvetli"));
// Racunari u igraonici se podesavaju za igre, pa Windows animacije budu
// iskljucene i pregledac javlja prefers-reduced-motion: reduce. Dok su tu
// stajala pravila koja gase saru i iskre, na tim racunarima pozadina je bila
// mrtva iako ju je vlasnik izricito upalio - a niko nije znao zasto.
// Prekidac za kretanje je u panelu (Izgled launchera > Mirno), i to je jedini
// nacin na koji ono sme da se ugasi.
{
  const blokovi = [...css.replace(/\s+/g, " ").matchAll(/@media \(prefers-reduced-motion: reduce\) \{(.*?)\} \}/g)].map((m) => m[1]);
  proveri("smanjen motion ne gasi saru u pozadini", blokovi.every((b) => !/body::after/.test(b)),
    JSON.stringify(blokovi.map((b) => b.slice(0, 80))));
  proveri("smanjen motion ne gasi iskre", blokovi.every((b) => !/iskre-sloj/.test(b)));
  proveri("smanjen motion ne gasi sve animacije redom", blokovi.every((b) => !/\*, \*::before/.test(b)));
}
proveri("launcher ne pusta besmislenu brzinu",
  /sekundi >= 3 && sekundi <= 120/.test(launcher),
  "bez granice bi los zapis napravio trepereci ekran ili animaciju od sat vremena");

// ---- IGRACEVA POZADINA ----
// Igrac bira svoju saru na svom nalogu. Vazi dok je prijavljen; kad se odjavi,
// racunar se vraca na ono sto je vlasnik podesio.
await api("/api/tekstura", "POST", { kljuc: "tacke", jacina: "srednje", kretanje: "mirno" }); // kucna
await api("/api/players", "POST", { username: "pera", password: "pera1234", balance: 500 });
const racunari = (await api("/api/computers")).body;

const poruke2 = [];
const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(racunari[0].token)}`);
w.on("message", (b) => { try { poruke2.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { w.once("open", res); w.once("error", rej); });
await cekaj(500);

const welcome2 = poruke2.find((m) => m.t === "welcome");
proveri("welcome nosi spisak sara za biranje", !!welcome2?.teksture?.spisak,
  "bez toga se na Nalogu ne prikaze panel Moja pozadina");
proveri("spisak nosi i jacine i kretanja", !!welcome2?.teksture?.jacine && !!welcome2?.teksture?.kretanja);

poruke2.length = 0;
w.send(JSON.stringify({ t: "login", username: "pera", password: "pera1234" }));
await cekaj(600);
const prvaPrijava = poruke2.find((m) => m.t === "login_ok");
proveri("igrac bez svog izbora dobija kucnu saru", prvaPrijava?.tekstura?.kljuc === "tacke", JSON.stringify(prvaPrijava?.tekstura?.kljuc));
proveri("i javlja se da svoj izbor nema", prvaPrijava?.mojaTekstura === null, JSON.stringify(prvaPrijava?.mojaTekstura));

poruke2.length = 0;
w.send(JSON.stringify({ t: "moja_tekstura", kljuc: "munje", jacina: "jako", kretanje: "talas" }));
await cekaj(500);
const svoja = [...poruke2].reverse().find((m) => m.t === "tekstura");
proveri("igracev izbor se odmah primenjuje", svoja?.tekstura?.kljuc === "munje", JSON.stringify(svoja?.tekstura?.kljuc));
proveri("javlja se sta je igrac izabrao", svoja?.moja?.kljuc === "munje" && svoja?.moja?.kretanje === "talas", JSON.stringify(svoja?.moja));

// Vlasnik menja kucnu - igracu koji ima svoju to ne sme da je promeni.
poruke2.length = 0;
await api("/api/tekstura", "POST", { kljuc: "romb", jacina: "slabo", kretanje: "mirno" });
await cekaj(600);
const posleKucne = [...poruke2].reverse().find((m) => m.t === "tekstura");
proveri("kucna sara ne gazi igracevu", posleKucne?.tekstura?.kljuc === "munje", JSON.stringify(posleKucne?.tekstura?.kljuc));

proveri("nepoznata sara od igraca se odbija", await (async () => {
  poruke2.length = 0;
  w.send(JSON.stringify({ t: "moja_tekstura", kljuc: "duga" }));
  await cekaj(400);
  return poruke2.some((m) => m.t === "moja_tekstura_err");
})());

// Ponovna prijava mora da zatekne izbor - pamti se uz nalog, ne uz racunar.
w.close();
await cekaj(300);
const poruke3 = [];
const w2 = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(racunari[1].token)}`);
w2.on("message", (b) => { try { poruke3.push(JSON.parse(b.toString())); } catch {} });
await new Promise((res, rej) => { w2.once("open", res); w2.once("error", rej); });
await cekaj(400);
await api(`/api/computers/${racunari[0].id}/logout`, "POST");
await cekaj(400);
poruke3.length = 0;
w2.send(JSON.stringify({ t: "login", username: "pera", password: "pera1234" }));
await cekaj(600);
const opet = poruke3.find((m) => m.t === "login_ok");
proveri("izbor prati nalog i na drugom racunaru", opet?.tekstura?.kljuc === "munje", JSON.stringify(opet?.tekstura?.kljuc));
proveri("i javlja se kao njegov izbor", opet?.mojaTekstura?.kljuc === "munje", JSON.stringify(opet?.mojaTekstura));

// "kuca" vraca igraca na ono sto je vlasnik podesio.
poruke3.length = 0;
w2.send(JSON.stringify({ t: "moja_tekstura", kljuc: "kuca" }));
await cekaj(500);
const nazad = [...poruke3].reverse().find((m) => m.t === "tekstura");
proveri('"kao u igraonici" vraca kucnu saru', nazad?.tekstura?.kljuc === "romb", JSON.stringify(nazad?.tekstura?.kljuc));
proveri("i brise igracev izbor", nazad?.moja === null || nazad?.moja === undefined, JSON.stringify(nazad?.moja));

// Odjava vraca racunar na kucnu, da sledeci gost ne zatekne tudju saru.
poruke3.length = 0;
w2.send(JSON.stringify({ t: "moja_tekstura", kljuc: "munje" }));
await cekaj(400);
poruke3.length = 0;
await api(`/api/computers/${racunari[1].id}/logout`, "POST");
await cekaj(600);
const poOdjavi = [...poruke3].reverse().find((m) => m.t === "tekstura");
proveri("posle odjave racunar pokazuje kucnu saru", poOdjavi?.tekstura?.kljuc === "romb", JSON.stringify(poOdjavi?.tekstura?.kljuc));
w2.close();

proveri("baza pamti igracevu temu", citajIzvor("server/src/db.js").includes('ALTER TABLE players ADD COLUMN tema'));
proveri("panel nudi i kretanje", app.includes("data-tex-kretanje"));
proveri("panel menja jedno polje a ostala cuva", /snimiTeksturu = async \(izmena\)/.test(app),
  "inace bi promena jacine obrisala izabrano kretanje");
proveri("launcher ima panel za izbor pozadine", launcher.includes("function panelMojaPozadina"));
proveri("izbor se salje serveru bez dugmeta sacuvaj", launcher.includes('t: "moja_tekstura"'));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
