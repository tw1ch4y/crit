import { citajIzvor } from "./_okruzenje.mjs";
// PODESAVANJA KOJA IGRAC SME DA MENJA
//
// Windows podesavanja su u kiosku zakljucana i s razlogom, pa je igracu jedini
// izlaz bio da zove radnika za svaku sitnicu. Launcher zato nudi ono sto je za
// igru bitno, a bezbedno je menjati.
//
// Sto se stvarno primeni na Windows-u i sto se pri odjavi vrati - to proverava
// proba-podesavanja na pravoj masini. Ovde se cuvaju PRAVILA: sta sme da udje u
// taj spisak i sta ne, jer se to iz koda ne vidi.
const win = citajIzvor("client/windows-podesavanja.js");
const launcher = citajIzvor("client/renderer/js/launcher.js");
const main = citajIzvor("client/main.js");
const preload = citajIzvor("client/preload.js");
const css = citajIzvor("client/renderer/css/launcher.css");

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

// ---- STA SME DA UDJE ----
proveri("miš: brzina pokazivača", /MouseSensitivity/.test(win));
proveri("miš: ubrzanje pokazivača", /MouseSpeed/.test(win) && /MouseThreshold1/.test(win) && /MouseThreshold2/.test(win),
  "gasenje samo jedne od tri vrednosti ostavlja ubrzanje upola");
proveri("zvuk: jačina sistema", /IAudioEndpointVolume/.test(win));

// ---- STA NE SME ----
// Windows ume da prihvati rezim koji monitor NE prikaze: ekran ostane crn, a
// igrac u kiosku nema cime da vrati staro. Dobitak ne vredi te cene.
proveri("nema menjanja rezolucije ni osvežavanja",
  !/ChangeDisplaySettings|dmPelsWidth|dmDisplayFrequency/.test(win),
  "crn ekran usred smene, a igrač u kiosku nema čime da vrati staro");
proveri("zapisano je i zašto toga nema", /crn|monitor ne prikaže/i.test(win));
// Sve mora da bude po korisniku - inace jedan gost menja racunar svima.
proveri("ništa ne traži administratora", !/RunAs|Start-Process.*-Verb|HKLM:/.test(win),
  "nalog igrača je standardni, pa bi UAC odbio bez ijedne poruke");
proveri("menja se samo nalog igrača (HKCU)", /HKCU:/.test(win) && !/HKEY_LOCAL_MACHINE/.test(win));

// ---- VRACANJE NA ZATECENO ----
// Igraonica ne sme da pamti podesavanja jednog gosta za sledeceg.
proveri("stanje se pamti pri prijavi", /podesavanjaPreSesije = s/.test(main));
proveri("vraća se pri odjavi", /function vratiPodesavanja/.test(main) && /vratiPodesavanja\(\);/.test(main));
proveri("vraćanje ide na početku zavrsiSesiju", /function zavrsiSesiju\(\) \{\s*vratiPodesavanja\(\);/.test(main),
  "ako ide posle gasenja igara, moze da se preskoci kad nesto pukne");

// ---- SIGURNOSNE KOCNICE ----
proveri("ne menja se ništa bez prijavljenog igrača", /if \(!sesijaAktivna\) return \{ ok: false/.test(main),
  "inace bi zakljucan racunar mogao da menja podesavanja");
proveri("brzina se drži u dozvoljenom opsegu", /Math\.max\(1, Math\.min\(20/.test(win));
proveri("jačina zvuka se drži u opsegu", /Math\.max\(0, Math\.min\(100/.test(win));

// ---- MOST DO EKRANA ----
proveri("preload nudi čitanje i primenu", /podesavanjaCitaj/.test(preload) && /podesavanjaPrimeni/.test(preload));
proveri("odeljak stoji u meniju naloga", /kljuc: "podesavanja"/.test(launcher));
proveri("čita se tek kad zatreba", /if \(S\.accSekcija === "podesavanja"\) ucitajWinPodesavanja\(\)/.test(launcher),
  "citanje ide preko PowerShell-a i traje oko sekunde - ne sme na svaku prijavu");
proveri("klizač ne šalje na svaki pomeraj", /brz\.onchange = \(\) =>/.test(launcher) && /brz\.oninput = \(\)/.test(launcher),
  "slanje na svaki pomeraj otvara PowerShell desetinama puta");

// ---- ZVUCI I ANIMACIJE LAUNCHERA ----
proveri("zvuci launchera mogu da se ugase", /S\.sfxUkljucen === false\) return;/.test(launcher),
  "provera stoji na jednom mestu, ne na svakom pozivu");
proveri("izbor se pamti uz nalog na tom računaru", /crit_launcher_izbor/.test(launcher));
proveri("gašenje animacija stvarno gasi animacije", /body\.bez-animacija \*/.test(css));

// ---- KAD NESTO NE PRODJE ----
proveri("jedan deo koji ne uspe ne obara ostale", /Promise\.all\(\[citajMis\(\), citajZvuk\(\)\]\)/.test(win));
proveri("zvuk koji ne prođe se sakrije, ne prikaže prazan", /const imaZvuk = p\.zvuk && p\.zvuk\.jacina != null/.test(launcher));

// ---- SVAKI MODUL MORA DA UDJE U PAKET ----
//
// electron-builder pakuje samo ono sto je nabrojano u build.files. Novi modul
// koji se tamo ne doda NE ide u instaler, a main.js ga zahteva - launcher se
// srusi pri pokretanju, i to tek na racunaru u igraonici. Na racunaru na kom se
// radi sve izgleda ispravno, jer se tamo cita iz izvornog foldera.
//
// Zato se ovde poredi: svaki lokalni modul koji main.js zahteva mora da bude i
// u spisku za pakovanje.
import fs from "node:fs";
import path from "node:path";
import { KOREN } from "./_okruzenje.mjs";
const pkg = JSON.parse(fs.readFileSync(path.join(KOREN, "client", "package.json"), "utf8"));
const spisak = pkg.build?.files || [];
const trazeni = [...main.matchAll(/require\("\.\/([\w.-]+\.js)"\)/g)].map((m) => m[1]);
const nedostaju = trazeni.filter((f) => !spisak.includes(f));
proveri("svaki modul koji main.js traži je u spisku za pakovanje", nedostaju.length === 0,
  `fali u build.files: ${nedostaju.join(", ")} - launcher bi pukao pri pokretanju u igraonici`);
proveri("ima šta da se proveri", trazeni.length >= 3, `nađeno ${trazeni.length} modula`);

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
