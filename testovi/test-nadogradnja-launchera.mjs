import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// NADOGRADNJA LAUNCHERA SE NE OBILAZI PESKE
//
// Svaka izmena launchera je do sada znacila obilazak svih trinaest masina:
// USB, instalacija, cekanje, sledeca. Pola sata za ispravku od jednog reda -
// pa se ispravke odlazu dok se "ne skupi nekoliko", a poznata greska nedeljama
// radi u igraonici.
//
// Sad server drzi instalater, a racunari ga sami uzimaju. To je i najopasnija
// stvar u celom programu: jedan fajl koji se sam pokrece sa punim pravima na
// svih trinaest masina. Zato se ovde ne proverava da li radi kad je sve u redu,
// nego da li ODBIJA kad nesto nije:
//
//   - fajl koji covek nije pustio u rad ne postoji za spoljni svet
//   - racunar na kom neko sedi se ne dira
//   - bez tokena racunara se ne skida nista
//   - verzije se porede kao brojevi ("2.44" je novije od "2.9")
//   - instaler i launcher iz stare numeracije (pre v1.0.0) se ne porede i ne
//     šalju, iako su im brojevi veći
const BASE = "http://127.0.0.1:8179", WSB = "ws://127.0.0.1:8179";
const DATA = radniFolder("nadogradnja-data");
await podigniServer(DATA, 8179);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const uloguj = async (u, p) => (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: u, password: p }) }).then((r) => r.json())).token;
const api = (t) => (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + t },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; } return { status: r.status, body: j }; });

// ---- 1) verzije se porede kao brojevi ----
//
// Kao tekst je "2.9.0" vece od "2.44.0", jer je "9" > "4". Po tom poredjenju bi
// cela igraonica ostala na 2.9.0 i nikad ne bi uzela 2.44.0 - nadogradnja bi
// tiho stala, bez ijedne greske i bez razloga da iko posumnja.
const nad = await import(new URL("../server/src/nadogradnja.js", import.meta.url).href);
proveri("2.44.0 je novije od 2.9.0", nad.uporediVerzije("2.9.0", "2.44.0") === -1,
  "poredjenje kao tekst bi zaustavilo nadogradnju zauvek");
proveri("ista verzija je jednaka", nad.uporediVerzije("2.44.0", "2.44.0") === 0);
proveri("2.45.0 je novije od 2.44.9", nad.uporediVerzije("2.45.0", "2.44.9") === 1);
proveri("verzija iz imena fajla", nad.verzijaIzImena("Crit Launcher Setup v2.45.0.exe") === "2.45.0");
proveri("ime bez \"v\" je stara numeracija, ne verzija",
  nad.verzijaIzImena("Crit Launcher Setup 2.57.0.exe") === null && nad.izStareNumeracije("Crit Launcher Setup 2.57.0.exe") === true,
  "stari instaler 2.57.0 bi inače bio 'noviji' od v1.0.0");
proveri("brend u imenu ne smeta", nad.verzijaIzImena("Gaming Centar Setup v1.2.3.exe") === "1.2.3");
proveri("\"v\" usred reči nije znak verzije", nad.verzijaIzImena("Crit Launcherv1.0.0.exe") === null);
proveri("ime bez verzije se ne prihvata", nad.verzijaIzImena("setup.exe") === null,
  "inace bi se delio fajl za koji se ne zna sta je");

// ---- 2) instalater postavlja SERVISER, ne vlasnik ----
const alat = (args) => new Promise((res) => {
  const p = spawn(process.execPath, [path.join(KOREN, "alati", "serviser.mjs"), ...args],
    { env: { ...process.env, CRIT_DATA_DIR: DATA }, stdio: ["ignore", "pipe", "pipe"] });
  let izlaz = ""; p.stdout.on("data", (d) => (izlaz += d)); p.stderr.on("data", (d) => (izlaz += d));
  p.on("close", (kod) => res({ kod, izlaz }));
});
await alat(["servis", "ServisLozinka1"]);
const S = api(await uloguj("servis", "ServisLozinka1"));
const V = api(await uloguj("admin", "admin"));

// Laznи instalater: sadrzaj je svejedno, vazno je da ima verziju u imenu i da
// se otisak poklapa sa onim sto server javi.
const telo = Buffer.from("MZ" + "x".repeat(5000)); // pocinje kao .exe, dovoljno je
const otisakTela = createHash("sha256").update(telo).digest("hex");
const posaljiFajl = (t, ime, buf) => fetch(BASE + "/api/nadogradnja/fajl?ime=" + encodeURIComponent(ime), {
  method: "PUT", headers: { "content-type": "application/octet-stream", authorization: "Bearer " + t },
  body: buf }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const vTok = await uloguj("admin", "admin");
const sTok = await uloguj("servis", "ServisLozinka1");
let r = await posaljiFajl(vTok, "Crit Launcher Setup v9.0.0.exe", telo);
proveri("vlasnik NE postavlja instalater", r.status === 403,
  "instalater pravi onaj ko pise program - samo on moze da zna da li je ispravan");
r = await posaljiFajl(sTok, "zlo.txt", telo);
proveri("odbija se sve sto nije .exe", r.status === 400, JSON.stringify(r.body));
r = await posaljiFajl(sTok, "setup.exe", telo);
proveri("odbija se ime bez verzije", r.status === 400, JSON.stringify(r.body));
r = await posaljiFajl(sTok, "Crit Launcher Setup 2.57.0.exe", telo);
proveri("odbija se instaler iz stare numeracije", r.status === 400 && /stare numeracije/.test(r.body.error || ""), JSON.stringify(r.body));
r = await posaljiFajl(sTok, "Crit Launcher Setup v9.0.0.exe", telo);
proveri("serviser postavlja instalater", r.status === 200, JSON.stringify(r.body).slice(0, 150));

let st = (await S("/api/nadogradnja")).body;
proveri("server je nasao instalater", st.ima === true && st.verzija === "9.0.0", JSON.stringify(st).slice(0, 150));
proveri("otisak je tacan", st.sha256 === otisakTela, `${st.sha256} != ${otisakTela}`);
proveri("velicina je tacna", st.velicina === telo.length);
proveri("nov fajl NIJE odmah pusten u rad", st.pusteno === false,
  "fajl koji covek nije odobrio ne sme sam da krene na masine");

// ---- 3) dok nije pusteno, ne skida se ni sa ispravnim tokenom ----
const comps = (await V("/api/computers")).body;
const tokenPC1 = comps[0].token;
const skini = (q) => fetch(BASE + "/nadogradnja/launcher.exe" + q);
proveri("bez tokena racunara nema preuzimanja", (await skini("")).status === 403);
proveri("pogresan token ne prolazi", (await skini("?token=bezveze")).status === 403);
proveri("nepusteno se ne daje ni sa ispravnim tokenom", (await skini("?token=" + tokenPC1)).status === 404,
  "inace bi svaki prekopiran fajl odmah bio dostupan masinama");

// ---- 4) pustanje u rad je odluka, i to serviserova ----
r = await V("/api/nadogradnja/pusti", "POST");
proveri("vlasnik ne pusta verziju u rad", r.status === 403);
r = await S("/api/nadogradnja/pusti", "POST");
proveri("serviser pusta verziju u rad", r.status === 200 && r.body.pusteno === true, JSON.stringify(r.body).slice(0, 120));

const odg = await skini("?token=" + tokenPC1);
const skinuto = Buffer.from(await odg.arrayBuffer());
proveri("posle pustanja se skida", odg.status === 200);
proveri("stigao je isti fajl", createHash("sha256").update(skinuto).digest("hex") === otisakTela,
  `${skinuto.length} bajtova umesto ${telo.length}`);
proveri("javljena je duzina unapred", Number(odg.headers.get("content-length")) === telo.length,
  "bez toga racunar ne moze da zna da li je preuzeo ceo fajl");
proveri("instalater se ne kesira", /no-store/.test(odg.headers.get("cache-control") || ""),
  "isto ime posle nove gradnje znaci drugi sadrzaj");

// ---- 5) puštanje se ne nasleđuje ----
//
// Da se pamtilo samo "pusteno: da", prekopiran nov fajl bi nasledio odobrenje
// prethodnog i odmah krenuo na sve masine - bas ono sto se ovde sprecava.
await posaljiFajl(sTok, "Crit Launcher Setup v9.1.0.exe", Buffer.from("MZ" + "y".repeat(4000)));
st = (await S("/api/nadogradnja")).body;
proveri("uzima se najveca verzija iz foldera", st.verzija === "9.1.0", st.verzija);
proveri("NOVA verzija nije nasledila odobrenje", st.pusteno === false,
  "inace bi svaka prekopirana gradnja odmah krenula na masine");
proveri("preuzimanje opet staje", (await skini("?token=" + tokenPC1)).status === 404);

// ---- 6) puštena verzija se ne briše ispod mašina ----
const obrisi = (t, ime) => fetch(BASE + "/api/nadogradnja/fajl?ime=" + encodeURIComponent(ime),
  { method: "DELETE", headers: { authorization: "Bearer " + t } }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => ({})) }));
r = await obrisi(sTok, "Crit Launcher Setup v9.0.0.exe");
proveri("ne brise se verzija koja je puštena", r.status === 400 && /puštena/.test(r.body.error || ""), JSON.stringify(r.body));
await S("/api/nadogradnja/pusti", "POST"); // sad je 9.1.0 puštena
r = await obrisi(sTok, "Crit Launcher Setup v9.0.0.exe");
proveri("stara verzija se brise kad vise nije puštena", r.status === 200, JSON.stringify(r.body).slice(0, 120));

// ---- 7) RACUNAR NA KOM NEKO SEDI SE NE DIRA ----
//
// Nadogradnja gasi launcher. Usred placenog sata to je oduzeto vreme gostu i
// posao radniku koji mora da objasni sta se desilo.
const igrac = (await V("/api/players", "POST", { username: "pera", password: "pera1234", balance: 5000 })).body;
proveri("napravljen igrac za probu", !!igrac?.id || !!igrac?.username, JSON.stringify(igrac).slice(0, 100));

const veza = (token, verzija, numeracija = 1) => {
  const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(token)}&v=${verzija}` + (numeracija ? `&n=${numeracija}` : ""));
  const poruke = [];
  ws.on("message", (d) => { try { poruke.push(JSON.parse(d.toString())); } catch {} });
  return { ws, poruke, otvorena: new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); }) };
};

// PC-01: slobodan, stara verzija -> mora da dobije najavu
const pc1 = veza(tokenPC1, "2.40.0");
// PC-02: igrac ce se prijaviti -> ne sme da dobije nista
const pc2 = veza(comps[1].token, "2.40.0");
// PC-03: vec ima novu verziju -> nema sta da mu se salje
const pc3 = veza(comps[2].token, "9.1.0");
// PC-05: launcher iz stare numeracije - broj mu je "veći", ali se ne nadograđuje sam
const pc5 = veza(comps[4].token, "2.57.0", 0);
await Promise.all([pc1.otvorena, pc2.otvorena, pc3.otvorena, pc5.otvorena]);
pc2.ws.send(JSON.stringify({ t: "login", username: "pera", password: "pera1234" }));
await cekaj(900);

pc1.poruke.length = 0; pc2.poruke.length = 0; pc3.poruke.length = 0; pc5.poruke.length = 0;
r = await V("/api/nadogradnja/posalji", "POST");
await cekaj(600);
const najava = (p) => p.filter((m) => m.t === "nadogradnja");
proveri("slobodan racunar dobija najavu", najava(pc1.poruke).length === 1, JSON.stringify(najava(pc1.poruke)));
proveri("ZAUZET RACUNAR NE DOBIJA NISTA", najava(pc2.poruke).length === 0,
  "nadogradnja usred placenog sata je oduzeto vreme gostu");
proveri("racunar koji vec ima verziju se ne dira", najava(pc3.poruke).length === 0);
proveri("launcher iz stare numeracije ne dobija najavu", najava(pc5.poruke).length === 0 && r.body.rucno >= 1,
  "on odbija manji broj - takav računar ide ručno, i to se broji");

const n = najava(pc1.poruke)[0] || {};
proveri("uz najavu ide verzija", n.verzija === "9.1.0", JSON.stringify(n));
proveri("uz najavu ide numeracija", n.numeracija === 1, "bez nje nov launcher najavu odbija");
proveri("uz najavu ide otisak", typeof n.sha256 === "string" && n.sha256.length === 64,
  "bez njega racunar ne moze da zna da li je stigao pravi fajl");
proveri("U NAJAVI NEMA LINKA", !JSON.stringify(n).includes("http"),
  "adresu sklapa racunar sam - inace bi podmetnuta poruka pokrenula tudji .exe na svim masinama");

// Ista najava se ne salje dvaput uzastopno - drugo preuzimanje preko prvog
// koje jos traje nista ne ubrzava.
pc1.poruke.length = 0;
await V("/api/nadogradnja/posalji", "POST");
await cekaj(400);
proveri("najava se ne ponavlja odmah", najava(pc1.poruke).length === 0);

// ---- 8) stanje u panelu ----
st = (await V("/api/nadogradnja")).body;
const r1 = st.racunari.find((x) => x.id === comps[0].id);
const r2 = st.racunari.find((x) => x.id === comps[1].id);
proveri("panel vidi koji racunar zaostaje", r1.zaostaje === true && r2.zaostaje === true);
proveri("panel vidi ko je slobodan a ko ne", r1.slobodan === true && r2.slobodan === false,
  `PC-01 ${r1.slobodan}, PC-02 ${r2.slobodan}`);
proveri("panel broji zaostale", st.zaostalih >= 2, String(st.zaostalih));
const r5 = st.racunari.find((x) => x.id === comps[4].id);
proveri("panel vidi stari launcher kao 'ručno'", r5.staraNumeracija === true && r5.zaostaje === true && r1.staraNumeracija === false,
  JSON.stringify(r5));
proveri("ručne ne broji među onima koje može sam da pogura", st.zaAutomatski === st.zaostalih - st.racunari.filter((x) => x.zaostaje && x.staraNumeracija).length,
  JSON.stringify({ z: st.zaostalih, a: st.zaAutomatski, r: st.rucno }));
// PC-04 se nikad nije ni povezao, pa server ne zna koju verziju ima. To NIJE
// razlog da se preskoci: prazna verzija znaci launcher stariji od onog koji je
// pocelo da je javlja, a to je najstarija masina u igraonici.
const nikadVidjen = st.racunari.find((x) => x.id === comps[3].id);
proveri("racunar bez javljene verzije se racuna kao zaostao",
  nikadVidjen.verzija === null && nikadVidjen.zaostaje === true,
  JSON.stringify(nikadVidjen));

// Racunar javlja kako ide.
pc1.ws.send(JSON.stringify({ t: "nadogradnja_status", verzija: "9.1.0", state: "preuzimam", message: "Preuzimam..." }));
await cekaj(400);
st = (await V("/api/nadogradnja")).body;
proveri("panel prati tok po racunaru", st.racunari.find((x) => x.id === comps[0].id)?.status?.state === "preuzimam");

// Povratak sa novom verzijom je dokaz nadogradnje - ali samo u istoj numeraciji.
const pc1b = veza(tokenPC1, "9.1.0", 0);
await pc1b.otvorena;
await cekaj(400);
st = (await V("/api/nadogradnja")).body;
proveri("povratak bez numeracije nije dokaz nadogradnje", st.racunari.find((x) => x.id === comps[0].id)?.status?.state === "preuzimam",
  JSON.stringify(st.racunari.find((x) => x.id === comps[0].id)?.status));
const pc1c = veza(tokenPC1, "9.1.0");
await pc1c.otvorena;
await cekaj(400);
st = (await V("/api/nadogradnja")).body;
proveri("povratak sa novom verzijom beleži uspeh", st.racunari.find((x) => x.id === comps[0].id)?.status?.state === "gotovo",
  JSON.stringify(st.racunari.find((x) => x.id === comps[0].id)?.status));

// ---- 9) ZAUZET RACUNAR DOLAZI NA RED CIM SE OSLOBODI ----
//
// Ovo je cela obecana korist: niko ne obilazi masine. Da preskocen racunar
// ostane preskocen zauvek, nadogradnja bi bila gora od pesacenja - jer bi
// izgledala kao da je zavrsena, a jedna masina bi tiho ostala na staroj
// verziji. Server proverava u razmaku (nadogradnjaTick), a ta provera radi
// bas ono sto se ovde poziva.
pc2.poruke.length = 0;
await V(`/api/computers/${comps[1].id}/logout`, "POST");
await cekaj(600);
await V("/api/nadogradnja/posalji", "POST");
await cekaj(500);
proveri("oslobodjen racunar dobija najavu kasnije", najava(pc2.poruke).length === 1,
  "inace bi masina na kojoj se igralo ostala na staroj verziji zauvek");


// ---- 10) povlacenje zaustavlja sve ----
await S("/api/nadogradnja/povuci", "POST");
proveri("povuceno se vise ne skida", (await skini("?token=" + tokenPC1)).status === 404);
r = await V("/api/nadogradnja/posalji", "POST");
proveri("povuceno se vise ne salje", r.status === 400, JSON.stringify(r.body));

// ---- 10b) STARA NUMERACIJA U FOLDERU I U PODEŠAVANJIMA ----
//
// Na serveru u igraonici leže instaleri iz vremena pre v1.0.0, i odluka
// "puštena 2.5x" bez oznake. Brojevi su im veći od novih.
fs.writeFileSync(path.join(DATA, "nadogradnja", "Crit Launcher Setup 99.0.0.exe"), telo);
st = (await S("/api/nadogradnja")).body;
proveri("stari instaler ne pobeđuje novi, iako ima veći broj", st.verzija === "9.1.0", st.verzija);
const stariFajl = (st.fajlovi || []).find((f) => f.ime === "Crit Launcher Setup 99.0.0.exe");
proveri("ali se vidi u spisku, označen kao star", stariFajl?.stara === true && stariFajl.verzija === "99.0.0", JSON.stringify(st.fajlovi));
const { setSetting } = await import(new URL("../server/src/db.js", import.meta.url).href);
setSetting("nadogradnja_pustena", "9.1.0");
st = (await S("/api/nadogradnja")).body;
proveri("odluka zapisana bez oznake numeracije ne pušta ništa", st.pusteno === false && st.pustena === null,
  JSON.stringify({ pusteno: st.pusteno, pustena: st.pustena }));
setSetting("nadogradnja_pustena", "");
r = await obrisi(sTok, "Crit Launcher Setup 99.0.0.exe");
proveri("stari instaler sme da se obriše i kad ništa nije pušteno", r.status === 200, JSON.stringify(r.body).slice(0, 120));

// ---- 11) sta launcher radi sa tom porukom ----
const main = citajIzvor("client/main.js");
proveri("launcher sam sklapa adresu za preuzimanje",
  /config\.host[^\n]*\/nadogradnja\/launcher\.exe\?token=/.test(main),
  "adresa iz poruke bi znacila tudji .exe na svim masinama");
proveri("launcher proverava otisak pre pokretanja",
  /otisakFajla\(dest\) !== String\(msg\.sha256\)/.test(main));
proveri("launcher proverava i velicinu", /st\.size !== Number\(msg\.velicina\)/.test(main));
proveri("launcher ne nadogradjuje dok igrac sedi", /if \(sesijaAktivna\) return "igrač je prijavljen"/.test(main));
proveri("launcher ne nadogradjuje dok igra radi", /if \(spawnedGames\.size\) return "igra je pokrenuta"/.test(main));
proveri("RAZVOJNI RACUNAR SE NE NADOGRADJUJE", /if \(racunarJeZasticen\(\)\) return `zaštićen računar/.test(main),
  "isti fajl koji cuva od ciscenja cuva i od instalacije");
proveri("nepakovan launcher se ne nadogradjuje", /if \(!PAKOVAN\) return "launcher radi iz izvornog koda/.test(main),
  "instalacija pored izvornog koda je zabuna koja se trazi danima");
proveri("instalaciju vodi izdvojena skripta, sa osiguracem",
  /napraviSkriptu\(\{ instalater/.test(main) && /pusti\(osigurac\)/.test(main),
  "sama skripta ima svoju probu koja je stvarno pokrece - test-pomocnik-nadogradnje.mjs");
proveri("neuspela instalacija se javi po povratku", /function javiIshodNadogradnje\(\)/.test(main) &&
  /javiIshodNadogradnje\(\);/.test(main));
proveri("launcher javlja numeraciju uz verziju", /"&n=" \+ NUMERACIJA/.test(main));
proveri("launcher ne pokreće instaler iz druge numeracije", /if \(numeracija !== NUMERACIJA\) return/.test(main) &&
  /nadogradnjaSmeta\(verzija, Number\(msg\.numeracija\) \|\| 0\)/.test(main));
proveri("ishod ostao od stare numeracije se ne javlja kao greška", /if \(znak !== "N" \+ NUMERACIJA\) return;/.test(main));
const skripta = createRequire(import.meta.url)("../client/nadogradnja-skripta.js");
proveri("launcher i server imaju istu numeraciju", skripta.NUMERACIJA === nad.NUMERACIJA,
  `launcher ${skripta.NUMERACIJA}, server ${nad.NUMERACIJA}`);

// ---- 12) INSTALACIJA MORA DA BUDE PO KORISNIKU ----
//
// Sve gore radi do poslednjeg koraka, a taj korak zavisi od jedne recu u
// package.json. Sa `perMachine: true` instaler ide u Program Files i trazi
// administratora; launcher radi pod nalogom igraca, pa Windows podigne UAC
// prozor i ceka klik koji za kasom niko nece dati. Nadogradnja tada ne prolazi
// nigde, a razlog se ne vidi ni u jednoj poruci - izgleda kao da mreza ne valja.
//
// Launcheru administrator ni ne treba: politike pise u HKCU, `powercfg` menja
// korisnikov plan, a autostart je precica u Startup folderu tog korisnika.
// Program Files je cuvao samo sam fajl launchera od igraca - a igrac koji ume
// da pokrene svoj program pod svojim nalogom ionako moze da ugasi launcher i
// obrise precicu, pa kiosk pada i bez diranja Program Files-a.
const pkg = JSON.parse(citajIzvor("client/package.json"));
proveri("instalacija je po korisniku, ne po masini", pkg.build?.nsis?.perMachine === false,
  "sa perMachine: true nadogradnja ceka UAC koji niko nece odobriti");
proveri("verzija launchera stoji u package.json", /^\d+\.\d+\.\d+$/.test(pkg.version || ""),
  "po njoj se imenuje instaler, a po imenu server zna sta je novije");
proveri("ime instalera nosi znak nove numeracije", pkg.build?.artifactName === "${productName} Setup v${version}.${ext}",
  "bez \"v\" server instaler vidi kao stari i ne pušta ga");
proveri("skripta za nadogradnju ide u paket", (pkg.build?.files || []).includes("nadogradnja-skripta.js"),
  "bez nje launcher puca pri pokretanju u igraonici");

for (const x of [pc1, pc2, pc3, pc5, pc1b, pc1c]) { try { x.ws.close(); } catch {} }
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(300);
process.exit(pao ? 1 : 0);
