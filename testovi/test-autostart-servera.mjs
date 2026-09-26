import fs from "node:fs";
import path from "node:path";
import { citajIzvor, brojac, KOREN } from "./_okruzenje.mjs";
import * as N from "../server/src/nadzor.js";
// Autostart servera, bez pravljenja zakazanog zadatka (to menja Windows
// razvojnog računara): zdravlje servera, uredno gašenje, skripte za zadatak i
// zagrade u imenu foldera. Nadzornika sa pravim serverom meri
// test-nadzornik-uzivo.mjs.
const { proveri, kraj } = brojac();
const bezCR = (s) => s.replace(/\r\n/g, "\n");
const idx = bezCR(citajIzvor("server/src/index.js"));
const nadzornik = bezCR(citajIzvor("server/nadzornik.mjs"));
const pokreni = citajIzvor("server/Pokreni server.bat");
const podesi = citajIzvor("server/Podesi autostart.bat");
const ukloni = citajIzvor("server/Ukloni autostart.bat");
const ps = citajIzvor("server/podesi-autostart.ps1");
const psU = citajIzvor("server/ukloni-autostart.ps1");
const vrati = citajIzvor("server/VRATI-KOPIJU.bat");
const paket = citajIzvor("napravi-paket.mjs");
const hub = citajIzvor("server/src/hub.js");

// ---- 1) SERVER ----
const zdr = idx.indexOf('app.get("/api/zdravlje"');
proveri("zdravlje se pita bez prijave", zdr > 0 && zdr < idx.indexOf('app.use("/api", router)'),
  "iza rutera bi tražilo prijavu, pa bi nadzornik zdrav server proglasio zaglavljenim");
proveri("zdravlje proverava i bazu", /\/api\/zdravlje[\s\S]{0,250}SELECT 1/.test(idx));
proveri("zauzet port gasi server kodom koji nadzornik zna",
  new RegExp(`EADDRINUSE[\\s\\S]{0,250}process\\.exit\\(${N.KOD_PORT_ZAUZET}\\)`).test(idx));
proveri("rukovalac greške servera se kači pre WebSocket-a",
  idx.indexOf('server.on("error"') > 0 && idx.indexOf('server.on("error"') < idx.indexOf("initWs(server"),
  "ws grešku prosleđuje na sebe i baca je kao neuhvaćenu - server ostane živ bez porta umesto da izađe sa kodom 3");
proveri("i ws ima svog slušaoca greške", /wss\.on\("error"/.test(hub));
proveri("greška posle dobijenog porta ne gasi server", /server\.on\("error", \(e\) => \{\s*(\/\/[^\n]*\n\s*)*if \(server\.listening\) return zapisiPad/.test(idx));
proveri("redovni poslovi kreću tek kad server dobije port",
  /server\.listen\(PORT, \(\) => \{[\s\S]*pokreniRedovnePoslove\(\);/.test(idx) && /function pokreniRedovnePoslove\(\) \{[\s\S]*billingTick/.test(idx));
proveri("nijedan redovni posao ne kreće pre porta",
  !/^setInterval\(/m.test(idx) && !/^backupDb\(\);/m.test(idx) && !/^odrzavanjeSada\("start"\);/m.test(idx),
  "drugi pokrenut server bi pravio kopiju i sekao logove nad istom bazom pre nego što sazna da ne može da radi");
proveri("uredno gašenje na signal i na poruku nadzornika",
  ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"].every((s) => idx.includes(`"${s}"`)) && /poruka\?\.t === "ugasi"/.test(idx));
proveri("pre izlaska se baza prepiše i zatvori", /function ugasiUredno[\s\S]{0,1600}checkpoint\(\);[\s\S]{0,80}db\.close\(\)/.test(idx));
proveri("pad i zastoj idu u Logove", /RAZLOG_POKRETANJA[\s\S]{0,2000}server_ponovo_pokrenut/.test(idx));

// ---- 2) NADZORNIK ----
proveri("brava je port na lokalnoj adresi, ne fajl sa PID-om",
  /host: "127\.0\.0\.1", port: PORT \+ 1000, exclusive: true/.test(nadzornik),
  "PID iz fajla posle nestanka struje dobije neki drugi proces, pa bi server zauvek 'već radio'");
proveri("drugi nadzornik izlazi sa kodom 0", /EADDRINUSE[\s\S]{0,400}process\.exit\(0\)/.test(nadzornik),
  "sa greškom bi ga zakazani zadatak pokretao u krug");
proveri("gasi se na fajl nadzor-stani", /nadzor-stani/.test(nadzornik));
proveri("provera diže server samo iza nestalog nadzornika",
  /if \(PROVERA\) \{[\s\S]{0,300}existsSync\(STANJE\)[\s\S]{0,120}process\.exit\(0\)/.test(nadzornik),
  "inače bi digla i namerno ugašen server - usred vraćanja kopije");
proveri("uredno gašenje briše zapis, a ubijen nadzornik ga ostavi", /async function ugasi[\s\S]{0,300}unlinkSync\(STANJE\)/.test(nadzornik));
proveri("zapis postoji od prvog trenutka", /unlinkSync\(POKRENI\)[\s\S]{0,200}upisiStanje\(null\)/.test(nadzornik));
proveri("stari zahtev za gašenje ne važi za novo pokretanje", /nadzornik je pokrenut[\s\S]{0,300}unlinkSync\(STANI\)/.test(nadzornik));
proveri("server gasi porukom, ne silom", /d\.send\(\{ t: "ugasi" \}\)/.test(nadzornik));
proveri("greške servera idu i u zapis", /"server: "/.test(nadzornik), "zadatak nema prozor - razlog pada bi nestao");
proveri("zapis ne raste bez granice", /NAJVECI_ZAPIS/.test(nadzornik));

// ---- 3) SKRIPTE ----
proveri("'Pokreni server.bat' pokreće nadzornika", /node nadzornik\.mjs/.test(pokreni) && !/node src\\index\.js/.test(pokreni));
proveri("autostart traži administratora", /-Verb RunAs/.test(podesi) && /net session/.test(podesi));
proveri("i poziva skriptu koja pravi zadatak", /podesi-autostart\.ps1/.test(podesi));
proveri("uklanjanje takođe", /-Verb RunAs/.test(ukloni) && /ukloni-autostart\.ps1/.test(ukloni));
proveri("zadatak se pokreće pri paljenju, pre prijave", /New-ScheduledTaskTrigger -AtStartup/.test(ps));
proveri("kao SYSTEM", /-UserId "SYSTEM"/.test(ps));
proveri("bez vremenskog ograničenja", /-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/.test(ps));
proveri("i ponovo ako zadatak ne uspe da krene", /-RestartCount \d+/.test(ps));
proveri("uz proveru na 5 minuta, jer ponavljanje ne pokriva ubijenog nadzornika",
  /-Daily[\s\S]{0,200}-RepetitionInterval \(New-TimeSpan -Minutes 5\) -RepetitionDuration \(New-TimeSpan -Days 1\)/.test(ps) &&
  /\$skripta \+ " --provera"/.test(ps),
  "nadzornik ugašen u Task Manager-u povuče i server, a zadatak ga ne diže do restarta");
proveri("provera se ne ostavlja ako je Windows nije zakazao", /NextRunTime/.test(ps) && /Provera na 5 minuta NIJE podesena/.test(ps));
proveri("nadzornik pod zadatkom provere nije 'server u prozoru'", /\(Zdravlje\) -and -not \(Radi-Neki\)/.test(ps));
proveri("uklanjanje briše oba zadatka, proveru prvu", /foreach \(\$z in @\(\$ImeProvere, \$Ime\)\)[\s\S]{0,200}Unregister-ScheduledTask/.test(psU));
proveri("nikad dva odjednom", /-MultipleInstances IgnoreNew/.test(ps));
proveri("skripta proverava da je server stvarno proradio", /Start-ScheduledTask[\s\S]*Zdravlje/.test(ps));
proveri("a ako nije, vraća sve kako je bilo", /if \(-not \$ok\) \{\s*Ugasi-Postojeci/.test(ps));
proveri("i kad nešto pukne u pravljenju", /catch \{\s*Ukloni-Zadatak/.test(ps));
proveri("ne pravi zadatak dok server radi u prozoru", /Server vec radi u prozoru/.test(ps));
proveri("upozorava na OneDrive folder", /-match "OneDrive"/.test(ps));
proveri("sklanja staru prečicu iz Startup foldera", /GetFolderPath\("Startup"\)[\s\S]{0,120}Crit Server\.lnk/.test(ps));
for (const [ime, s] of [["podesi-autostart.ps1", ps], ["ukloni-autostart.ps1", psU]]) {
  proveri(`${ime} je bez kvačica`, !/[^\x00-\x7F]/.test(s),
    "Windows PowerShell 5.1 fajl bez BOM-a čita u staroj kodnoj strani, pa bi poruke bile iskvarene");
}

// Folder servera u imenu ima zagrade: "1 - SERVER (glavni racunar)". cmd.exe
// putanju sa zagradom UNUTAR bloka shvati kao kraj bloka, i skripta pukne na
// redu koji izgleda savršeno ispravno - i to samo u paketu, ne u razvoju.
for (const ime of ["Pokreni server.bat", "Podesi autostart.bat", "Ukloni autostart.bat", "VRATI-KOPIJU.bat", "Otvori port u firewall-u.bat"]) {
  const redovi = bezCR(citajIzvor(`server/${ime}`)).split("\n");
  let dubina = 0;
  const lose = [];
  for (const [i, r] of redovi.entries()) {
    const t = r.trim();
    if (dubina > 0 && /%~[a-z]*[fdp]0|%CD%/i.test(t)) lose.push(i + 1);
    if (/\($/.test(t)) dubina++;
    if (/^\)/.test(t)) dubina = Math.max(0, dubina - 1);
  }
  proveri(`${ime}: putanja programa se ne koristi unutar bloka sa zagradama`, lose.length === 0, `redovi ${lose.join(", ")}`);
  proveri(`${ime}: CRLF`, /\r\n/.test(citajIzvor(`server/${ime}`)) && !/[^\r]\n/.test(citajIzvor(`server/${ime}`)),
    "cmd.exe na goli LF ume da preskoči ili spoji redove");
}
proveri("vraćanje kopije gasi server uredno, i onaj bez prozora", /type nul > "data\\nadzor-stani"/.test(vrati));
proveri("i i dalje ne radi dok server radi", /imagename eq node\.exe/.test(vrati));
proveri("vraćanje gasi server tek posle potvrde", vrati.indexOf('type nul > "data\\nadzor-stani"') > vrati.indexOf("Upisi DA"),
  "ko je odustao, ostajao je bez servera");
proveri("i posle vraćanja traži da se server upali", /type nul > "data\\nadzor-pokreni"/.test(vrati));

// ---- 4) PAKET ----
for (const f of ["nadzornik.mjs", "Ukloni autostart.bat", "podesi-autostart.ps1", "ukloni-autostart.ps1"]) {
  proveri(`paket nosi ${f}`, paket.includes(`"${f}"`));
}
proveri("nema stare skripte sa petljom bez nadzornika", !fs.existsSync(path.join(KOREN, "server", "start-server.bat")),
  "dve skripte za isto posao - neko pokrene staru, i server opet živi u prozoru koji se zatvori klikom");

await kraj();
