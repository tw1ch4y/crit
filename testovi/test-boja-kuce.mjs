import { radniFolder, podigniServer, citajIzvor, brojac } from "./_okruzenje.mjs";
// Boja kuce se bira iz ponudjenih.
//
//   1. fabricka boja stoji na jednom mestu
//   2. spisak gotovih boja ne nudi ono na sta program upozorava (zelena "ima
//      kredita", zlatna "nagrada", crvena "istice vreme", slab kontrast)
//   3. upozorenje ne zabranjuje: vlasnik moze da izabere i takvu boju
const BASE = "http://127.0.0.1:8189";
await podigniServer(radniFolder("boja-data"), 8189);
const { proveri, kraj } = brojac();

const svc = await import("../server/src/service.js");
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; });

// ---- 1) FABRICKA BOJA STOJI NA JEDNOM MESTU ----
const brend = (await api("/api/brend")).body;
proveri("server salje fabricku boju", brend.fabricki === svc.AKCENAT_PODRAZUMEVANI, String(brend.fabricki));
proveri("panel je NE ponavlja",
  !/["']#[0-9a-f]{6}["']/i.test(
    (await import("node:fs")).readFileSync(new URL("../server/public/js/app.js", import.meta.url), "utf8")
      .split("\n").filter((r) => /brendVrati|fabrick/i.test(r)).join("\n")),
  "dugme \"Fabricka\" je vracalo staru crvenu i posle promene fabricke boje");

// ---- 2) SPISAK GOTOVIH ----
proveri("server salje spisak gotovih boja", Array.isArray(brend.gotove) && brend.gotove.length >= 8,
  String(brend.gotove?.length));
proveri("svaka gotova ima kljuc, naziv i heks",
  brend.gotove.every((b) => b.kljuc && b.naziv && /^#[0-9a-f]{6}$/i.test(b.heks)));
proveri("fabricka je medju gotovima", brend.gotove.some((b) => b.heks === brend.fabricki),
  "inace vlasnik ne moze da se vrati na nju klikom, nego samo posebnim dugmetom");

// SPISAK NE SME DA PROTIVRECI SAM SEBI.
//
// Ponuditi boju na koju isti program upozorava znaci da jedno od to dvoje nije
// tacno - a vlasnik ne moze da zna koje.
const sporne = brend.gotove.filter((b) => svc.zamerkeNaBoju(b.heks).length);
proveri("nijedna gotova boja ne nosi zamerku", sporne.length === 0,
  sporne.map((b) => b.naziv).join(", "));

// Crvena, narandzasta i zelena su zauzete znacenjima - i to se vidi po tome sto
// ih u spisku nema.
const tonovi = brend.gotove.map((b) => svc.zamerkeNaBoju(b.heks).length);
proveri("nema boje iz porodica koje nesto znace", tonovi.every((t) => t === 0));

// ---- 3) UPOZORENJA ----
proveri("zelena se prepoznaje kao znacenje",
  svc.zamerkeNaBoju("#3dc97e").some((z) => z.vrsta === "znacenje"),
  "zelena znaci 'ima kredita' - kuca te boje bi igracu pomesala stanje naloga sa brendom");
proveri("zlatna se prepoznaje", svc.zamerkeNaBoju("#ffb527").some((z) => z.vrsta === "znacenje"));
proveri("crvena se prepoznaje", svc.zamerkeNaBoju("#ff3b3b").some((z) => z.vrsta === "znacenje"));
// Ton se poredi, ne cela boja: tamnija zelena je i dalje zelena i igrac je vidi
// kao istu stvar.
proveri("i tamnija nijansa iste porodice se prepoznaje",
  svc.zamerkeNaBoju("#1f6b42").some((z) => z.vrsta === "znacenje"),
  "poredi se TON, ne svetlina - inace bi tamnija zelena prosla");

proveri("pretamna boja se prepoznaje", svc.zamerkeNaBoju("#101010").some((z) => z.vrsta === "tamna"),
  "dugmad bi se izgubila u podlozi");
proveri("presvetla boja se prepoznaje", svc.zamerkeNaBoju("#ffffff").some((z) => z.vrsta === "svetla"),
  "belo slovo na dugmetu se ne bi citalo");
proveri("siva nema ton pa se ni sa cim ne mesa",
  !svc.zamerkeNaBoju("#8a8a8a").some((z) => z.vrsta === "znacenje"));
proveri("dobra boja nema zamerku", svc.zamerkeNaBoju("#2f6ae8").length === 0);
proveri("svaka zamerka ima objasnjenje, ne samo oznaku",
  svc.zamerkeNaBoju("#3dc97e").every((z) => typeof z.tekst === "string" && z.tekst.length > 20),
  "'nije dobro' bez razloga niko ne moze da ispravi");

// ---- 4) UPOZORENJE NE ZABRANJUJE ----
//
// Vlasnik odlucuje kako mu izgleda igraonica. Program mora da kaze sta ga to
// kosta, ali ne da odbije - inace bi neko ko ima zelen znak ostao bez svoje boje.
const r = await api("/api/brend/boja", "POST", { akcenat: "#3dc97e" });
proveri("boja sa zamerkom se ipak PRIMA", r.status === 200, JSON.stringify(r.body).slice(0, 120));
proveri("i stvarno je upisana", (await api("/api/brend")).body.akcenat === "#3dc97e");
await api("/api/brend/boja", "POST", { akcenat: brend.fabricki });

// Neispravan oblik se i dalje odbija - to nije stvar ukusa nego greska.
proveri("neispravan heks se odbija", (await api("/api/brend/boja", "POST", { akcenat: "plava" })).status === 400);
proveri("pokvaren ulaz ne ostavlja zamerku da puca",
  Array.isArray(svc.zamerkeNaBoju(null)) && Array.isArray(svc.zamerkeNaBoju("bezveze")),
  "provera boje se poziva i dok vlasnik jos kuca - ne sme da puca na pola unosa");


// ---- 5) PANEL: PROBA PRE PRIMENE ----
//
// Boja se menja na svih trinaest masina odjednom. Dok se birala klikom koji
// odmah upisuje, vlasnik je saznavao kako izgleda tek kad je vec bilo primenjeno
// - a povratak je bio jos jedan takav krug kroz celu igraonicu.
const panel = citajIzvor("server/public/js/app.js");
const stil = citajIzvor("server/public/css/style.css");

proveri("postoji spisak gotovih boja u panelu", /data-bk="/.test(panel),
  "polje za heks trazi da vlasnik ZNA koja boja valja, a nema kako da zna");
proveri("klik na boju je PROBA, ne primena", /\[data-bk\]"\)[\s\S]{0,120}postaviProbu\(/.test(panel),
  "primena ide na trinaest masina; izbor sme da bude samo proba");
proveri("primena je posebno dugme", /id="bkPrimeni"/.test(panel) && /bkPrimeni[\s\S]{0,300}\/brend\/boja/.test(panel));
proveri("dugme kaze STA radi", /Primeni na sve računare/.test(panel),
  "\"Primeni boju\" ne kaze da se menja na svim masinama odjednom");

// PROBA SME DA FARBA SAMO SEBE.
//
// Postavljanje na koren bi ostavilo ceo panel prefarban i kad vlasnik ode sa
// stranice bez potvrde - izgledalo bi kao da je boja primenjena, a nije.
proveri("proba farba samo svoj okvir", /\$\("#bkProba"\)[\s\S]{0,90}\.style\.setProperty\("--accent"/.test(panel));
proveri("proba NE dira koren dokumenta",
  !/documentElement[\s\S]{0,200}bkIzbor/.test(panel),
  "inace panel ostaje u boji koja nikad nije primenjena");
proveri("proba je ogranicena i u CSS-u", /\.bk-proba \{/.test(stil));

// U probi stoje zelena, zlatna i crvena. Ako se boja kuce priblizila necijem
// znacenju, to se vidi ODMAH, jedno pored drugog, a ne tek u igraonici.
proveri("proba pokazuje boju kuce uz boje koje nesto znace",
  /\.bk-proba-kredit \{[^}]*var\(--online\)/.test(stil) &&
  /\.bk-proba-vip \{[^}]*var\(--locked\)/.test(stil) &&
  /\.bk-proba-kraj \{[^}]*var\(--danger\)/.test(stil));

// IZVEDENE NIJANSE RACUNA SERVER.
//
// Iz jedne boje se prave svetlija, tamnija i dve providne. Da ih panel racuna
// sam, proba bi pokazivala jednu boju a masine dobile drugu - i to tiho, jer bi
// oba racuna "radila".
const nij = (await api(`/api/brend/provera?heks=${encodeURIComponent("#8a45d6")}`)).body;
proveri("provera vraca i izvedene nijanse", !!nij?.nijanse?.hover && !!nij?.nijanse?.soft,
  JSON.stringify(nij?.nijanse));
proveri("iste su kao one koje dobija launcher",
  nij.nijanse.hover === svc.nijanse("#8a45d6").hover && nij.nijanse.soft === svc.nijanse("#8a45d6").soft);
proveri("panel ih ne racuna sam", !/function nijanse|\+ \(255 - v\)/.test(panel),
  "dve kopije istog racuna se raziđu, a obe izgledaju kao da rade");

// Fabricka boja se cita sa servera, ne iz panela.
proveri("dugme \"Fabricka\" uzima vrednost sa servera", /postaviProbu\(bkBrend\.fabricki\)/.test(panel));

// Upozorenje ne zabranjuje - i to pise, jer inace vlasnik trazi "ispravnu" boju
// koje nema.
proveri("uz upozorenje stoji da se boja ipak moze primeniti",
  /upozorenje, ne zabrana/.test(panel));

// Polje za heks i sistemski birac su dva prikaza ISTE stvari. Dok se nisu
// pratili, jedan je pokazivao staru a drugi novu boju - i nije se znalo koja ce
// se primeniti.
proveri("heks i birac se prate u oba smera",
  panel.includes("if (biras) biras.value = v;") && panel.includes("if (heks) heks.value = biras.value"),
  "jedan je pokazivao staru a drugi novu boju, pa se nije znalo koja ce se primeniti");

kraj();
