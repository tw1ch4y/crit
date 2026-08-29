import { radniFolder, podigniServer, citajIzvor } from "./_okruzenje.mjs";
// Panel se otvara sa SVAKOG telefona na mrezi, a preko njega se dopunjuje
// kredit. Ko udje sa admin/admin moze sebi da upise koliko hoce.
// Dosad je o fabrickoj lozinki pisalo samo u konzoli servera pri prvom
// pokretanju - a taj prozor niko ne cita i najcesce je minimizovan.
const BASE = "http://127.0.0.1:8145";
const DATA = radniFolder("lozinka-data");
await podigniServer(DATA, 8145);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const prijava = async (lozinka) => (await fetch(BASE + "/api/login", { method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: lozinka }) }).then((r) => r.json()));

let token = (await prijava("admin")).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

// ---- 1) sistem sam kaze da je lozinka fabricka ----
proveri("prijava sa admin/admin prolazi na svezoj bazi", !!token);
const s1 = await api("/api/settings");
proveri("podesavanja javljaju fabricku lozinku", s1.fabrickaLozinka === true, JSON.stringify(s1.fabrickaLozinka));

// ---- 2) posle promene upozorenje odmah nestaje ----
const r = await api("/api/me/password", "POST", { oldPassword: "admin", newPassword: "jacaLozinka2026" });
proveri("lozinka moze da se promeni", r.ok === true, JSON.stringify(r).slice(0, 100));
const s2 = await api("/api/settings");
proveri("upozorenje nestaje ODMAH, bez restarta", s2.fabrickaLozinka === false, JSON.stringify(s2.fabrickaLozinka));

// ---- 3) stara lozinka vise ne radi, nova radi ----
proveri("stara lozinka vise ne prolazi", !(await prijava("admin")).token);
const novi = await prijava("jacaLozinka2026");
proveri("nova lozinka prolazi", !!novi.token);
token = novi.token;
proveri("i dalje javlja da nije fabricka", (await api("/api/settings")).fabrickaLozinka === false);

// ---- 4) upozorenje stoji tamo gde vlasnik gleda ----
const panel = citajIzvor("server/public/js/app.js");
proveri("upozorenje je na kontrolnoj tabli", /\$\{upozorenjeLozinka\(\)\}/.test(panel),
  "u Podesavanjima ga vlasnik ne bi video - tu ulazi jednom");
proveri("upozorenje kaze zasto je vazno", panel.includes("dopunjuje kredit"));
// Ranije je tu pisalo "klikni na svoje ime dole levo". Na telefonu profil stoji
// GORE DESNO, pa je uputstvo vodilo na pogresnu stranu ekrana. Sad upozorenje
// nosi svoje dugme, pa nema sta da promasi.
proveri("upozorenje ima dugme za promenu lozinke", /id="upzLozinka"/.test(panel));
proveri("dugme stvarno otvara promenu lozinke", /#upzLozinka.*\)\) promenaLozinkeModal\(\)/s.test(panel));
proveri("upozorenje ne upucuje na stranu ekrana", !panel.includes("dole levo"),
  "profil na telefonu stoji gore desno, pa takvo uputstvo vodi pogresno");
proveri("upozorenje se ne prikazuje bez potrebe", /if \(!state\.settings\?\.fabrickaLozinka\) return ""/.test(panel));
proveri("upozorenje je vidno oznaceno", /\.upozorenje-fabricko \{/.test(citajIzvor("server/public/css/style.css")));

// ---- 5) provera se ne racuna na svaki zahtev ----
// scrypt je namerno spor; da se racuna svaki put, kontrolna tabla bi se
// osvezavala svake sekunde i trosila procesor bez potrebe.
const src = citajIzvor("server/src/service.js");
proveri("rezultat provere se pamti", /let _fabricka = null/.test(src));
proveri("pamcenje se ponisti pri promeni lozinke",
  (src.match(/zaboraviProveruLozinke\(\)/g) || []).length >= 2,
  "inace bi upozorenje ostalo na ekranu i posle promene");

// PIN ima svoje upozorenje od ranije - proveravamo da nije nestalo.
proveri("upozorenje za fabricki PIN i dalje stoji", panel.includes("Još uvek stoji fabrički PIN 1234"));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
