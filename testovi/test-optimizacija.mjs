import { citajIzvor, KOREN } from "./_okruzenje.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
// ŠTA LAUNCHER RADI SA SAMIM RAČUNAROM
// Čišćenje sesije i plan napajanja. Oboje dira Windows, pa je granica bitnija
// od same funkcije: mora da bude jasno šta se NE dira i mora da se vrati.

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const ciscenje = await import(pathToFileURL(path.join(KOREN, "client", "ciscenje.js")).href);
const izvorC = citajIzvor("client/ciscenje.js");
const main = citajIzvor("client/main.js");

// ---- 1) šta se briše ----
const okruzenje = {
  LOCALAPPDATA: "C:\\Users\\igrac\\AppData\\Local",
  APPDATA: "C:\\Users\\igrac\\AppData\\Roaming",
  USERPROFILE: "C:\\Users\\igrac",
  TEMP: "C:\\Users\\igrac\\AppData\\Local\\Temp",
};
const mete = ciscenje.mete(okruzenje);
const opisi = mete.map((m) => m.opis);

for (const sta of ["Chrome profil", "Firefox profili", "Steam prijava", "Privremeni fajlovi", "Skorašnji dokumenti"]) {
  proveri(`briše se: ${sta}`, opisi.includes(sta));
}
// Keš šejdera se za mesec dana nakupi u GB, a pokvaren keš pravi trzanje u igri
// koje izgleda kao kvar na grafičkoj. Igre ga same naprave ponovo.
for (const sta of ["DirectX keš šejdera", "NVIDIA keš šejdera", "AMD keš šejdera"]) {
  proveri(`briše se: ${sta}`, opisi.includes(sta));
}
proveri("korpa za otpatke se prazni", /Clear-RecycleBin/.test(izvorC));
proveri("korpa se prazni zvaničnim putem, ne brisanjem fascikle",
  !/\$Recycle\.Bin/i.test(izvorC),
  "direktno brisanje ume da ostavi korpu u nevaljanom stanju");

// ---- 2) šta se NE dira ----
const licne = mete.filter((m) => m.licno).map((m) => m.opis);
proveri("Preuzimanja i Radna površina su izborni", licne.includes("Preuzimanja") && licne.includes("Radna površina"),
  "na računarima sa OneDrive-om bi brisanje otišlo i u oblak, nepovratno");
proveri("fascikle u oblaku se preskaču", /function uOblaku/.test(izvorC) && /OneDrive\|Dropbox/.test(izvorC));
proveri("prazna ili prekratka putanja se odbija", /put\.length < 8/.test(izvorC),
  "bez toga bi greška u putanji obrisala koren diska");
proveri("čišćenje ne radi u probnom režimu", /if \(!dozvoljeno\)/.test(izvorC));
proveri("čišćenje mora biti izričito uključeno", /pod\.ciscenjeSesije !== true/.test(izvorC));
proveri("postoji probni rad koji ništa ne briše", /--suvo/.test(izvorC));

// ---- 3) plan napajanja ----
// Windows fabrički gasi ekran i uspavljuje računar posle par minuta mirovanja.
// U igraonici to znači crn ekran nasred filma i prekid igre koja se ne dira mišem.
proveri("plan napajanja se postavlja", /function planNapajanja/.test(main));
proveri("prelazi na High performance", main.includes("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"));
proveri("ekran se ne gasi", /monitor-timeout-ac 0/.test(main));
proveri("računar ne ide na spavanje", /standby-timeout-ac 0/.test(main));
proveri("plan se postavlja pri pokretanju", /planNapajanja\(true\)/.test(main));
proveri("plan se VRAĆA pri admin izlazu", /planNapajanja\(false\)/.test(main),
  "inače bi računar zauvek ostao bez uspavljivanja, i posle deinstalacije launchera");
proveri("vraća se na Balanced", main.includes("381b4222-f694-41f0-9685-ff5bb260df2e"));
proveri("ne dira Windows na programerskoj mašini", /function planNapajanja[\s\S]{0,120}if \(NO_LOCK/.test(main));

// ---- 4) plan projekta ne sme da laže ----
// Stavke koje su odavno gotove stajale su kao neurađene - vlasnik onda ne zna
// šta ga još čeka.
const plan = citajIzvor("PLAN.md");
for (const gotovo of ["Plan napajanja na **High Performance**", "Vremenski paketi", "Autostart servera"]) {
  const red = plan.split("\n").find((l) => l.includes(gotovo));
  proveri(`plan zna da je gotovo: ${gotovo.replace(/\*/g, "").slice(0, 34)}`, !!red && red.startsWith("- [x]"), red?.slice(0, 60));
}
// Svaka neurađena stavka mora da kaže U KOM JE STANJU. Bez toga se posle dva
// meseca ne razlikuje ono što je namerno odbačeno od onoga što je ispalo iz
// glave - a jedino drugo traži da se nešto uradi.
//
// "sledeće na redu" i "planirano" su dodati kasnije: plan je u početku imao samo
// gotovo i odbačeno, pa je i rečnik pokrivao sve. Čim se pojavila stavka koja je
// prihvaćena i čeka red, pravilo ju je odbijalo iako je uredno objašnjena.
proveri("neurađeno stoji uz razlog zašto",
  plan.split("\n").filter((l) => l.startsWith("- [ ]")).every((l) => /NIJE urađeno|ne planira se|preporuka|Nije potrebna|sledeće na redu|planirano/.test(l)),
  "stavka bez objašnjenja ne kaže da li je zaboravljena, odbačena ili čeka red");
proveri("odlaganje ažuriranja je objašnjeno u uputstvu",
  /Active hours/.test(citajIzvor("DEPLOY.md")),
  "restart nasred turnira je najskuplji kvar u igraonici");

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
