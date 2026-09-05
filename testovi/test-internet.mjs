import { citajIzvor, brojac } from "./_okruzenje.mjs";
// DA LI IGRAONICA IMA INTERNET
//
// Traku na dnu launchera gleda igrac: ako mu pregledac ne radi, hoce da vidi je
// li do njega ili do interneta.
//
// Svaki launcher je to proveravao sam, ucitavanjem google.com/favicon.ico na
// svakih 30 sekundi. Trinaest masina, oko 37.000 poziva dnevno ka Google-u iz
// jedne igraonice - a odgovor je isti za sve njih. I lagao je: kad je bas Google
// nedostupan (filter na ruteru, odvojena gostinska mreza, ispad kod jednog
// provajdera), internet radi a na svih trinaest ekrana pise da ga nema.
//
// Ovde se cuva:
//   1. da provera zaista ide sa SERVERA, jednom, i da klijent nema svoju
//   2. da se javlja samo na PROMENU (poruka svakih minut, uvek ista, je
//      saobracaj bez sadrzaja)
//   3. da nepoznato stanje ostane NEPOZNATO - izmisljen odgovor salje igraca da
//      trazi kvar tamo gde ga nema
const { proveri, kraj } = brojac();
const net = await import("../server/src/internet.js");
// Komentari objasnjavaju sta je BILO, pa moraju da smeju da pominju ono cega
// vise nema - inace bi pravilo teralo da se zaboravi zasto je promenjeno.
const bezKomentara = (x) => x.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const rend = bezKomentara(citajIzvor("client/renderer/js/launcher.js"));
const srvKod = bezKomentara(citajIzvor("server/src/internet.js"));
const idx = citajIzvor("server/src/index.js");

// ---- 1) KLIJENT VISE NE ZOVE NIKOGA SPOLJA ----
// Google kao ALATKA (precica ka pretrazivacu, pocetna strana ugradjenog
// pregledaca) ostaje - to je ono sto igrac trazi. Ne sme da ostane samo kao
// TIHA provera koju niko nije trazio.
proveri("launcher ne ucitava Google favicon", !/favicon\.ico/.test(rend),
  "trinaest masina puta dva zahteva u minuti, ceo dan");
proveri("precica ka Google-u i dalje postoji", /name: "Google"/.test(rend),
  "sklonjena je provera, ne alatka");
proveri("launcher nema svoj tajmer za internet", !/setInterval\([^)]*checkInternet/.test(rend));
proveri("stanje stize sa servera", /case "internet":/.test(rend));
proveri("stize i uz prijavu na server", /S\.internet = typeof m\.internet === "boolean"/.test(rend),
  "bez toga bi traka bila prazna do prve promene, a promena mozda ne dodje danas");

// ---- 2) TRI STANJA, NE DVA ----
proveri("nepoznato se ne prikazuje kao 'nema'", /const zna = S\.wsOk && typeof S\.internet === "boolean";/.test(rend),
  "kad server ne radi, launcher NE ZNA kakav je internet i tako mora i da pise");
proveri("pad veze osvezi i traku interneta",
  /updateServerStatus\(connected\);[\s\S]{0,220}updateInternet\(\);/.test(rend),
  "inace bi poslednji odgovor stajao kao da jos vazi");

// ---- 3) SERVER PROVERAVA, I NE OSLANJA SE NA JEDNO MESTO ----
proveri("server ima proveru", typeof net.proveri === "function");
proveri("provera ne ide na Google", !/google/i.test(srvKod),
  "adresa mora da bude mesto napravljeno za ovu proveru, ne tudja pocetna strana");
proveri("postoji vise od jedne adrese", (srvKod.match(/https:\/\//g) || []).length >= 2,
  "jedan nedostupan servis ne sme da znaci 'nema interneta'");
proveri("odgovor se PROVERAVA, ne samo broji kao stigao", /sadrzi/.test(srvKod),
  "gostinske mreze podmetnu svoju stranicu i vrate 200 - a interneta nema");
proveri("provera ima rok", /AbortSignal\.timeout/.test(srvKod),
  "bez roka bi zahtev koji ne odgovara drzao proveru dok ne istekne sistemski rok");
proveri("tajmer ne drzi proces u zivotu", /unref/.test(srvKod),
  "inace se server ne bi ugasio sam, pa bi svaki test ostavljao node koji visi");
proveri("javlja se samo na promenu", /if \(sad !== stanje\)/.test(srvKod));
proveri("server je pokrece pri startu", /internet\.pokreni\(/.test(idx));

// ---- 4) STVARNA PROVERA ----
//
// Provera se ovde ZAISTA pokrece - citanjem koda se ne vidi da li adresa jos
// postoji, da li je odgovor i dalje onaj tekst i da li stigne na vreme.
//
// Racunar bez interneta nije kvar u programu, pa se tada preskace: crven test
// zbog tudje mreze uci covek da crveno ne znaci nista.
const imaMrezu = await (async () => {
  try {
    const { promises: dns } = await import("node:dns");
    // `lookup` pita sistemski resolver, isto sto radi i pregledac. `resolve4`
    // ide pravo na upisane DNS servere i na ovom racunaru vraca ECONNREFUSED
    // iako mreza radi - pa bi provera bila "preskocena" i kad ima interneta.
    await dns.lookup("cloudflare.com");
    return true;
  } catch { return false; }
})();
if (!imaMrezu) {
  proveri("provera stvarno radi (preskočeno)", true, "ovaj računar nema internet - ne proverava se");
} else {
  const t0 = Date.now();
  const ima = await net.proveri();
  proveri("provera stvarno radi", ima === true, `vratila ${ima} za ${Date.now() - t0} ms`);
  proveri("i ne traje dugo", Date.now() - t0 < 6000, `${Date.now() - t0} ms`);
}

// Pre prve provere stanje je null, ne false.
proveri("pre prve provere stanje je nepoznato, ne 'nema'",
  net.stanjeInterneta() === null || typeof net.stanjeInterneta() === "boolean");

kraj();
