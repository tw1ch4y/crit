import { citajIzvor } from "./_okruzenje.mjs";
// BEG IZ KIOSKA
// Za racunarom sedi tinejdzer koji ima vremena i koji ce probati sve. Ovde se
// gleda da nijedan put napolje ne stoji otvoren.
//
// Najozbiljniji nadjen put nije bio precica nego MREZNI KABL:
// iscupa se kabl -> launcher posle par sekundi ponudi "Promeni adresu servera"
// -> to je brisalo podesavanje BEZ ijedne provere -> masina se preusmeri na
// server koji igrac drzi na telefonu i on sam sebi otvori besplatnu igru.

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const main = citajIzvor("client/main.js");
const rend = citajIzvor("client/renderer/js/launcher.js");
const preload = citajIzvor("client/preload.js");
const pod = citajIzvor("client/podesavanja.json");

// ---- 1) ulaz u podesavanja trazi PIN ----
proveri("brisanje podesavanja trazi servisni PIN",
  /ipcMain\.handle\("reset-config", \(e, pin\) => \{[\s\S]{0,220}proveriPin\(pin\)/.test(main),
  "bez toga se masina preusmerava na tudji server jednim klikom");
proveri("pogresan PIN ne brise nista", /return \{ ok: false, error: "Pogrešan servisni PIN\." \}/.test(main));
proveri("dugme u launcheru otvara PIN, ne resetuje odmah",
  /#connSetup"\)\.addEventListener\("click", \(\) => openPin\(/.test(rend));
proveri("PIN se prosledjuje pri brisanju", /resetConfig\(\$\("#pinInput"\)\.value\.trim\(\)\)/.test(rend));
proveri("most prosledjuje PIN", /resetConfig: \(pin\) =>/.test(preload));

// ---- 2) PIN mora da radi BEZ servera ----
// Tu se i ide baš kad servera nema, pa provera preko servera ne bi mogla ni da
// se izvrsi. Isto vazi i za admin izlaz: kad server padne, osoblje bi inace
// ostalo zakljucano na svih trinaest masina.
proveri("postoji lokalna provera PIN-a", /ipcMain\.handle\("proveri-servisni-pin"/.test(main));
proveri("ulaz u podesavanja se uvek proverava lokalno",
  /S\.pinSvrha === "setup" \|\| !S\.wsOk/.test(rend));
proveri("admin izlaz pada na lokalni PIN kad nema veze", /!S\.wsOk/.test(rend),
  "inace pri padu servera nema izlaza iz launchera");
proveri("PIN se cita iz podesavanja pored programa", /function servisniPin\(\)/.test(main) && /podesavanja\.json/.test(main));
proveri("fabricki PIN postoji ali je oznacen kao privremen",
  /"servisniPin": "1234"/.test(pod) && /OBAVEZNO promeni/.test(pod));

// ---- 3) precice i politike ----
for (const [sta, sablon] of [
  ["Task Manager", /DisableTaskMgr/],
  ["Win tasteri", /NoWinKeys/],
  ["odjava sa Windows-a", /NoLogoff/],
  ["zatvaranje sistema", /NoClose/],
  ["zakljucavanje stanice", /DisableLockWorkstation/],
  ["promena lozinke Windows naloga", /DisableChangePassword/],
]) proveri(`blokirano: ${sta}`, sablon.test(main));

for (const precica of ["Control+Shift+Escape", "Control+Escape", "Alt+Escape", "Super+R", "Super+E", "Super+D", "F11"]) {
  proveri(`presretnuta precica: ${precica}`, main.includes(`"${precica}"`));
}

// ---- 4) prozor ne moze da se zatvori ni osvezi ----
proveri("prozor odbija zatvaranje", /win\.on\("close", \(e\) => \{\s*if \(!app\.isQuitting\) e\.preventDefault\(\)/.test(main));
proveri("novi prozori iz sadrzaja su zabranjeni", /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/.test(main));
proveri("F5 i Ctrl+R ne osvezavaju stranu", /e\.key === "F5" \|\| \(e\.ctrlKey && \(e\.key === "r"/.test(rend));
proveri("desni klik ne otvara meni", /contextmenu", \(e\) => e\.preventDefault\(\)/.test(rend));
proveri("alatke za programere su samo u dev rezimu", /devTools: DEV/.test(main));

// ---- 5) programi skinuti kroz pregledac ----
// Igrac skine .exe kroz Steam ili Discord i pokrene ga iz Preuzimanja.
proveri("presretanje pokretanja postoji", /pokreniStrazu\(/.test(main));
proveri("blokiranje preuzetih programa se moze ukljuciti", /blokirajPreuzeteProgram/.test(pod));

// A sada ista stvar PONASANJEM, ne citanjem koda: pusta se prava funkcija koja
// odlucuje sta se gasi. Gornje dve provere hvataju da je neko obrisao liniju;
// ove hvataju da odluka nije tacna - a ta razlika se ovde placa skupo na obe
// strane. Prestrogo gasi igru igracu usred partije, preblago pusta .exe koji je
// upravo skinuo.
const { createRequire } = await import("node:module");
const { zabranjenaPutanja } = createRequire(import.meta.url)("../client/procesi.js");
const B = String.fromCharCode(92); // obrnuta kosa crta
const env = { USERPROFILE: `C:${B}Users${B}igrac`, TEMP: `C:${B}Users${B}igrac${B}AppData${B}Local${B}Temp` };
const put = (...d) => d.join(B);

for (const [opis, p, ocekivano] of [
  ["skinut .exe iz Preuzimanja", put("C:", "Users", "igrac", "Downloads", "hack.exe"), true],
  ["nesto ostavljeno na radnoj povrsini", put("C:", "Users", "igrac", "Desktop", "cheat.exe"), true],
  ["pokrenuto iz Temp fascikle", put("C:", "Users", "igrac", "AppData", "Local", "Temp", "x.exe"), true],
  ["nasa daljinska instalacija", put("C:", "Users", "igrac", "AppData", "Local", "Temp", "crit-install", "setup.exe"), false],
  ["uredno instalirana igra", put("C:", "Games", "CS2", "cs2.exe"), false],
  // Bez zavrsne kose crte u poredjenju, "...\Downloads" hvata i
  // "...\Downloads-igre". Igra u folderu takvog imena bi se gasila igracu
  // usred partije, a iz panela bi to izgledalo kao da igra puca sama od sebe.
  ["folder koji samo POCINJE isto (Downloads-igre)", put("C:", "Users", "igrac", "Downloads-igre", "game.exe"), false],
  ["folder koji samo POCINJE isto (DesktopIgre)", put("C:", "Users", "igrac", "DesktopIgre", "game.exe"), false],
]) {
  const r = zabranjenaPutanja(p, env);
  proveri(`${ocekivano ? "gasi" : "pusta"}: ${opis}`, r === ocekivano, `dobijeno ${r ? "gasi" : "pusta"} za ${p}`);
}

// ---- 6) prekid veze ne oslobadja racunar ----
proveri("prekid veze pokriva ekran", /show\("connScreen"\)/.test(rend));
proveri("naplata staje dok nema veze", /stopTimer\(\)/.test(rend));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
