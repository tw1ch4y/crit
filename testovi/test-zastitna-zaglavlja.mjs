import { radniFolder, podigniServer, brojac, citajIzvor } from "./_okruzenje.mjs";
// UBACENA SKRIPTA NE SME DA SE POKRENE U PANELU
//
// Panel prikazuje ono sto ljudi upisuju: imena igraca, nazive igara, beleske uz
// nalog, nazive artikala. Sve to prolazi kroz `esc()` pre nego sto udje u
// stranu, i to je prva brana.
//
// Ovo je druga. I da jedno jedino mesto ikad promasi escape, pregledac odbija
// da izvrsi skriptu koja nije dosla sa ovog servera.
//
// Zasto bas ovde: iz panela se upisuje kredit. Skripta koja se izvrsi u
// vlasnikovom pregledacu ne mora nista da provaljuje - ona VEC jeste vlasnik.
// Jedan promasen escape u imenu igraca bio bi dovoljan.
const BASE = "http://127.0.0.1:8183";
await podigniServer(radniFolder("zaglavlja-data"), 8183);
const { proveri, kraj } = brojac();

const glava = async (put) => {
  const r = await fetch(BASE + put);
  return { status: r.status, csp: r.headers.get("content-security-policy") || "", h: r.headers };
};

const panel = await glava("/");
proveri("panel salje pravilo o sadrzaju", !!panel.csp, "nema Content-Security-Policy zaglavlja");

// ---- ono zbog cega sve ovo postoji ----
proveri("SKRIPTE SAMO SA OVOG SERVERA", /script-src 'self'/.test(panel.csp), panel.csp);
proveri("ubacena skripta u samoj strani se ne izvrsava",
  !/script-src[^;]*'unsafe-inline'/.test(panel.csp),
  "sa 'unsafe-inline' u script-src cela zastita ne vredi nista");
proveri("nema izvrsavanja teksta kao koda", !/script-src[^;]*'unsafe-eval'/.test(panel.csp));
proveri("dodaci i objekti su zabranjeni", /object-src 'none'/.test(panel.csp));
proveri("panel ne moze da se ugradi u tudju stranu", /frame-ancestors 'none'/.test(panel.csp),
  "bez toga se panel moze staviti u nevidljiv okvir i klikovi preusmeriti");
proveri("osnovna adresa se ne moze prepisati", /base-uri 'none'/.test(panel.csp),
  "inace bi ubacen <base> preusmerio ucitavanje app.js na tudji server");

// ---- ono sto MORA da bude dozvoljeno, inace panel ne radi ----
//
// Ovo nisu popustanja iz nemara nego dve stvari bez kojih strana ne radi, i
// obe su proverene u pravom pregledacu:
proveri("stilovi u samoj strani su dozvoljeni", /style-src[^;]*'unsafe-inline'/.test(panel.csp),
  "panel sklapa HTML sa style=\"...\" na desetinama mesta");
proveri("slike kao data adresa su dozvoljene", /img-src[^;]*data:/.test(panel.csp),
  "sara pozadine je SVG kao data adresa, a pregled slike pre slanja isto");

// ---- ostala zaglavlja ----
proveri("pregledac ne nagadja vrstu fajla", panel.h.get("x-content-type-options") === "nosniff",
  "slika koja 'lici' na skriptu ne sme da se izvrsi kao skripta");
proveri("ne javlja se odakle se doslo", /no-referrer/.test(panel.h.get("referrer-policy") || ""));

// Zaglavlja idu na SVE odgovore, ne samo na pocetnu stranu.
const stat = await glava("/js/app.js");
proveri("i staticki fajlovi nose ista pravila", !!stat.csp && stat.csp === panel.csp, stat.csp.slice(0, 60));
const api = await glava("/api/settings");
proveri("i odgovori API-ja nose ista pravila", !!api.csp, api.csp.slice(0, 60));

// ---- veza sa launcherom i panelom ne sme da bude odsecena ----
//
// Panel se osvezava uzivo preko WebSocket-a. `connect-src 'self'` to pokriva
// jer je ista adresa; provereno u pravom pregledacu (veza se otvara).
proveri("veza ka svom serveru je dozvoljena", /connect-src 'self'/.test(panel.csp), panel.csp);

// ---- pravilo stoji u kodu servera, ne u strani ----
//
// Zaglavlje je jace od <meta> oznake: vazi za svaki odgovor i ne moze da se
// zaobidje ubacivanjem sadrzaja iznad njega u samoj strani.
const idx = citajIzvor("server/src/index.js");
proveri("pravilo se salje kao zaglavlje", /setHeader\("Content-Security-Policy"/.test(idx),
  "u <meta> oznaci bi vazilo samo za tu stranu");

// ---- ISTO PRAVILO I NA EKRANU IGRACA ----
//
// Launcher prikazuje isti sadrzaj sa servera: nazive igara, imena, artikle.
// Tu ne postoji zaglavlje (strana se ucitava sa diska), pa pravilo stoji kao
// <meta> oznaka u samoj strani.
//
// Provereno sa 17 alata na pravom Electronu - svi ekrani, svako dugme, porudzbina,
// tocak i obavestenja rade sa ovim pravilom.
const launcher = citajIzvor("client/renderer/index.html");
const meta = launcher.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
proveri("launcher ima pravilo o sadrzaju", !!meta, "nema <meta> sa Content-Security-Policy");
proveri("i tamo skripte idu samo iz launchera", /script-src 'self'/.test(meta), meta);
proveri("ubacena skripta se ne izvrsava ni tamo", !/script-src[^;]*'unsafe-inline'/.test(meta));
// Korice igara stizu sa servera cija se adresa upisuje pri postavljanju, pa se
// ne moze unapred upisati. Slike se ne izvrsavaju, pa to nista ne otvara.
proveri("slike sa servera i iz Windows-a prolaze", /img-src[^;]*data:/.test(meta) && /img-src[^;]*http:/.test(meta), meta);

kraj();
