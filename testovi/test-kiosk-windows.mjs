import { createRequire } from "node:module";
import path from "node:path";
import { citajIzvor, KOREN, brojac } from "./_okruzenje.mjs";
// Šta launcher i alati za postavljanje rade sa samim Windows-om na računaru
// igrača. Ništa se ovde ne pokreće - Windows se na razvojnom računaru ne dira.
const { proveri, kraj } = brojac();
const require = createRequire(import.meta.url);

const main = citajIzvor("client/main.js");
const ukljuci = citajIzvor("client/zastita-ukljuci.bat");
const iskljuci = citajIzvor("client/zastita-iskljuci.bat");
const popravi = citajIzvor("client/POPRAVI-RACUNAR.bat");
const deinstaliraj = citajIzvor("client/DEINSTALIRAJ-LAUNCHER.bat");
const vratiKopiju = citajIzvor("server/VRATI-KOPIJU.bat");

// ---- 1) jedan primerak ----
// Osigurač posle nadogradnje, autostart i dvoklik pokreću launcher i kad već
// radi. Drugi primerak mora da izađe odmah - `before-quit` bez `isQuitting`
// poništava izlaz, pa bi dva launchera sa istim tokenom otimala vezu.
const brava = main.indexOf("requestSingleInstanceLock");
proveri("brava jednog primerka se traži na početku", brava > 0 && brava < main.indexOf("function loadConfig"),
  "pre bilo čega što dira podešavanja ili Windows");
proveri("drugi primerak izlazi mimo before-quit",
  /if \(!JEDINI_PRIMERAK\) \{\s*app\.isQuitting = true;\s*app\.quit\(\);/.test(main));
proveri("drugi primerak ne pravi prozor", /app\.whenReady\(\)\.then\(\(\) => \{\s*if \(!JEDINI_PRIMERAK\) return;/.test(main));
proveri("drugi primerak ne vraća politike prvome",
  /app\.on\("will-quit", \(\) => \{[\s\S]{0,200}if \(!JEDINI_PRIMERAK\) return;[\s\S]{0,200}setPolicies\(false\)/.test(main),
  "setPolicies(false) iz drugog primerka bi otključao računar dok prvi radi");
proveri("postoji samo jedna brava", (main.match(/requestSingleInstanceLock/g) || []).length === 1);

// ---- 2) politike naloga ----
const politike = main.slice(main.indexOf("function setPolicies"), main.indexOf("function setPolicies") + 900);
for (const ime of ["DisableTaskMgr", "NoWinKeys", "NoRun", "NoControlPanel", "NoClose", "NoLogoff"]) {
  proveri(`launcher upisuje ${ime}`, politike.includes(`"${ime}"`));
}
proveri("DisableRegistryTools se ne upisuje",
  !main.includes("DisableRegistryTools"),
  "reg.exe ga poštuje, pa launcher posle ne bi mogao da skine ni sopstvene politike");

// ---- 3) prečice pristupačnosti ----
const winPod = require(path.join(KOREN, "client", "windows-podesavanja.js"));
const ugasi = winPod.skriptaPristupacnosti(false);
const vrati = winPod.skriptaPristupacnosti(true);
for (const [kod, sta] of [["0x3B", "lepljivi tasteri"], ["0x35", "zvučni tasteri"], ["0x33", "filter tastera"]]) {
  proveri(`prečica se upisuje: ${sta}`, ugasi.includes(`SystemParametersInfo(${kod},`));
}
proveri("upis važi odmah i ostaje zapamćen", (ugasi.match(/\[ref\]\$[stf], 3\)/g) || []).length === 3,
  "SPIF_UPDATEINIFILE | SPIF_SENDCHANGE");
proveri("gašenje skida bitove prečice", ugasi.includes("if ($false)") && /\$v - 4/.test(ugasi) && /\$v - 8/.test(ugasi));
proveri("vraćanje ide na fabričko stanje Windows-a", vrati.includes("if ($true)") && vrati.includes("-bor 12"));
proveri("prečice se gase pri pokretanju i vraćaju na izlazu",
  /precicePristupacnosti\(false\)/.test(main) && /precicePristupacnosti\(true\)/.test(main));
proveri("prečice se ne diraju na razvojnom računaru", /function precicePristupacnosti\(ukljucene\) \{\s*if \(NO_LOCK/.test(main));

// ---- 4) autostart ----
proveri("launcher se sam upisuje u autostart", /setLoginItemSettings\(\{ openAtLogin: true/.test(main),
  "ručna prečica u Startup folderu se zaboravi ili pokazuje na staru putanju");
proveri("autostart se ne upisuje na razvojnom računaru", /function upisiAutostart\(\) \{\s*if \(NO_LOCK/.test(main));
proveri("autostart nosi ime koje POPRAVI-RACUNAR briše",
  /path\.basename\(process\.execPath/.test(main) && popravi.includes('\\Run" /v "Crit Launcher"'));

proveri("stara prečica iz Startup-a se briše samo kad pokazuje na ovaj program",
  /function ukloniStaruPrecicu\(\)/.test(main) &&
  /path\.basename\(cilj\)\.toLowerCase\(\) !== exe\) continue;/.test(main) &&
  /=== path\.resolve\(process\.execPath\)\.toLowerCase\(\)\) continue;/.test(main),
  "tuđe prečice u autostartu se ne diraju");

// ---- 5) gašenje čeka brisanje tragova ----
proveri("gašenje sa panela čeka brisanje tragova igrača",
  /case "shutdown": posleCiscenja\(/.test(main) && /Promise\.race\(\[posaoCiscenja/.test(main));

// ---- 6) šta se briše posle igrača ----
const { mete } = require(path.join(KOREN, "client", "ciscenje.js"));
const opisi = mete({ LOCALAPPDATA: "C:\\L", APPDATA: "C:\\R", USERPROFILE: "C:\\U", TEMP: "C:\\L\\Temp" }).map((m) => m.opis);
for (const sta of ["Discord prijava", "Spotify prijava", "Steam zapamćena prijava", "Minecraft nalozi", "Roblox prijava"]) {
  proveri(`briše se: ${sta}`, opisi.includes(sta), "sledeći igrač bi zatekao tuđi nalog");
}

// ---- 7) zastita-ukljuci.bat radi za nalog igrača ----
proveri("zaštita se ne zaključava za administratora",
  !/net session[\s\S]{0,80}neq 0[\s\S]{0,200}exit \/b 1/.test(ukljuci),
  "sa standardnog naloga 'Run as administrator' pokrene skriptu pod drugim nalogom");
proveri("zaštita proverava čiji je ekran", /GetOwner/.test(ukljuci) && /explorer\.exe/.test(ukljuci));
proveri("deo za ceo računar sam traži administratora", /-Verb RunAs/.test(ukljuci) && /goto masina/.test(ukljuci));
for (const ime of ["NoControlPanel", "NoRun", "DisableTaskMgr"]) {
  proveri(`zaštita upisuje ${ime}`, ukljuci.includes(ime));
}
proveri("zaštita ne upisuje DisableRegistryTools", !ukljuci.includes("DisableRegistryTools"));
proveri("zaštita gasi prečice pristupačnosti", /StickyKeys" \/v Flags \/t REG_SZ \/d 498/.test(ukljuci));
proveri("pregledač bez dijaloga za fajlove", /AllowFileSelectionDialogs \/t REG_DWORD \/d 0/.test(ukljuci),
  "dijalog za čuvanje je pun Explorer: iz njega se pokreće bilo šta");
proveri("pregledač ne otvara lokalne fajlove", ukljuci.includes('/d "file://*"'));
proveri("pregledač ne pamti lozinke", /PasswordManagerEnabled \/t REG_DWORD \/d 0/.test(ukljuci));
proveri("isključivanje skida sve što uključivanje upiše",
  ["NoControlPanel", "NoRun", "AllowFileSelectionDialogs", "PasswordManagerEnabled", "URLBlocklist", "HideFirstRunExperience"]
    .every((x) => iskljuci.includes(x)) && /StickyKeys" \/v Flags \/t REG_SZ \/d 510/.test(iskljuci));

// ---- 8) alati za oporavak ----
for (const [ime, t] of [["POPRAVI-RACUNAR", popravi], ["VRATI-KOPIJU", vratiKopiju]]) {
  const kod = t.split(/\r?\n/).filter((r) => !/^\s*(rem|::)/i.test(r)).join("\n");
  proveri(`${ime} ne koristi wmic`, !/\bwmic\b/i.test(kod), "wmic je uklonjen iz novih Windows 11");
}
proveri("POPRAVI-RACUNAR briše autostart iz svih profila", /for \/d %%P in \("%SystemDrive%\\Users\\\*"\)/.test(popravi));
proveri("POPRAVI-RACUNAR briše autostart iz registra svih naloga",
  /%%K\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" \/v "Crit Launcher"/.test(popravi));
proveri("DEINSTALIRAJ radi sa naloga igrača", !/net session/.test(deinstaliraj),
  "instalacija je po korisniku - administrator ne vidi profil igrača");
proveri("DEINSTALIRAJ skida autostart i ograničenja",
  /CurrentVersion\\Run" \/v "Crit Launcher"/.test(deinstaliraj) && deinstaliraj.includes("NoControlPanel"));
proveri("koren i client nose iste alate",
  citajIzvor("POPRAVI-RACUNAR.bat") === popravi && citajIzvor("DEINSTALIRAJ-LAUNCHER.bat") === deinstaliraj);

// ---- 9) .bat fajlovi imaju CRLF ----
// cmd.exe na goli LF ume da ne nađe oznaku za goto.
for (const [ime, t] of [["zastita-ukljuci", ukljuci], ["zastita-iskljuci", iskljuci], ["POPRAVI-RACUNAR", popravi],
  ["DEINSTALIRAJ-LAUNCHER", deinstaliraj], ["VRATI-KOPIJU", vratiKopiju]]) {
  const goli = (t.match(/(^|[^\r])\n/g) || []).length;
  proveri(`${ime}.bat ima CRLF`, goli === 0, `${goli} redova sa golim LF`);
}

await kraj();
