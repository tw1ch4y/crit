import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { KOREN, brojac, citajIzvor } from "./_okruzenje.mjs";
// ZASTITA KIOSKA: PRAVILA
//
// Launcher je jedini program koji igrac vidi. Ono sto on pusti kroz tastaturu,
// adresu ili komandnu liniju, igrac ima. Pravila su u client/kiosk.js, bez
// Electron-a, pa se ovde proveravaju do kraja; na kraju se proverava i da ih
// main.js stvarno primenjuje.

const require = createRequire(import.meta.url);
const k = require(path.join(KOREN, "client", "kiosk.js"));
const b = brojac();
const taster = (key, mod = {}) => k.opasanTaster({ type: "keyDown", key, code: mod.code || "", control: !!mod.ctrl, shift: !!mod.shift, alt: !!mod.alt, meta: !!mod.meta });

// ---- 1. tastatura ----
for (const [opis, key, mod] of [
  ["Ctrl+R (osvezi)", "r", { ctrl: true }],
  ["Ctrl+Shift+R", "R", { ctrl: true, shift: true }],
  ["F5", "F5"],
  ["F12 (razvojni alati)", "F12"],
  ["Ctrl+Shift+I (razvojni alati)", "I", { ctrl: true, shift: true }],
  ["Ctrl+Shift+J (konzola)", "J", { ctrl: true, shift: true }],
  ["Ctrl+Shift+C (inspektor)", "C", { ctrl: true, shift: true }],
  ["Ctrl+W (zatvori)", "w", { ctrl: true }],
  ["Ctrl+Q", "q", { ctrl: true }],
  ["Ctrl+P (stampa, sistemski dijalog)", "p", { ctrl: true }],
  ["Ctrl+O (otvori fajl)", "o", { ctrl: true }],
  ["Ctrl+S (sacuvaj)", "s", { ctrl: true }],
  ["Ctrl+U (izvorni kod)", "u", { ctrl: true }],
  ["Ctrl+plus (zum)", "+", { ctrl: true }],
  ["Ctrl+minus (zum)", "-", { ctrl: true }],
  ["Ctrl+0 (zum)", "0", { ctrl: true }],
  ["Ctrl+numericki plus", "+", { ctrl: true, code: "NumpadAdd" }],
  ["Alt+F4", "F4", { alt: true }],
  ["Alt+Space (sistemski meni)", " ", { alt: true, code: "Space" }],
  ["Alt+strelica levo (nazad)", "ArrowLeft", { alt: true }],
  ["F11", "F11"],
  ["taster 'nazad' na misu/tastaturi", "BrowserBack"],
]) b.proveri(`blokira ${opis}`, taster(key, mod) === true);

for (const [opis, key, mod] of [
  ["slovo", "a"], ["broj", "5"], ["Enter", "Enter"], ["Backspace", "Backspace"], ["Tab", "Tab"],
  ["strelice", "ArrowDown"], ["Escape (zatvara prozorcic)", "Escape"],
  ["Ctrl+A (izaberi sve u polju)", "a", { ctrl: true }],
  ["Ctrl+C", "c", { ctrl: true }], ["Ctrl+V", "v", { ctrl: true }], ["Ctrl+X", "x", { ctrl: true }],
  ["Ctrl+Z", "z", { ctrl: true }], ["Ctrl+Y", "y", { ctrl: true }],
  ["Shift+slovo", "A", { shift: true }],
  ["Ctrl+Shift+strelica (biranje reci)", "ArrowLeft", { ctrl: true, shift: true }],
  ["AltGr znak (@ na nasoj tastaturi)", "@", { ctrl: true, alt: true }],
]) b.proveri(`ne dira ${opis}`, taster(key, mod) === false);
b.proveri("otpustanje tastera se ne blokira", k.opasanTaster({ type: "keyUp", key: "r", control: true }) === false);
b.proveri("prazan ulaz ne puca", k.opasanTaster(null) === false && k.opasanTaster({}) === false);

// ---- 2. adrese za pregledac ----
for (const a of ["https://www.youtube.com", "http://192.168.1.100:8095/", "https://store.steampowered.com/app/1"]) {
  b.proveri(`pusta ${a}`, k.bezbednaAdresa(a));
}
for (const a of [
  "file:///C:/Windows/System32/cmd.exe", "FILE:///C:/x.exe", "ms-settings:", "ms-settings:windowsupdate",
  "javascript:alert(1)", "data:text/html,<script>1</script>", "\\\\server\\share\\x.exe", "C:\\Windows\\System32\\cmd.exe",
  "search-ms:query=cmd", "shell:startup", "steam://run/1", "https://user:pass@evil.example", "", null, "x".repeat(3000),
]) b.proveri(`odbija ${String(a).slice(0, 40)}`, !k.bezbednaAdresa(a));

// ---- 3. navigacija ekrana ----
const ekran = path.join(KOREN, "client", "renderer");
const fajl = (p) => pathToFileURL(path.join(ekran, p)).href;
b.proveri("ekran sme svoju stranu", k.lokalnaStrana(fajl("index.html"), ekran));
b.proveri("ekran sme overlay i zastor", k.lokalnaStrana(fajl("overlay.html"), ekran) && k.lokalnaStrana(fajl("backdrop.html"), ekran));
b.proveri("ekran ne sme internet", !k.lokalnaStrana("https://evil.example/", ekran));
b.proveri("ekran ne sme fajl van svog foldera", !k.lokalnaStrana(pathToFileURL(path.join(KOREN, "client", "main.js")).href, ekran));
b.proveri("ekran ne sme izlaz preko ..", !k.lokalnaStrana(fajl("index.html").replace("/renderer/index.html", "/renderer/../main.js"), ekran));
b.proveri("ekran ne sme izlaz preko %2e%2e", !k.lokalnaStrana(fajl("x").replace(/\/x$/, "/%2e%2e/main.js"), ekran));
b.proveri("ekran ne sme mrezni fajl (file://server/share)", !k.lokalnaStrana("file://server/share/x.html", ekran));
b.proveri("ekran ne sme folder sa slicnim imenom (renderer-zlo)", !k.lokalnaStrana(pathToFileURL(path.join(KOREN, "client", "renderer-zlo", "x.html")).href, ekran));

// ---- 4. komandna linija ----
const opasni = ["--remote-debugging-port=9222", "--remote-debugging-pipe", "--inspect", "--inspect=9229", "--inspect-brk",
  "--js-flags=--allow-natives-syntax", "--disable-web-security", "--no-sandbox", "--proxy-server=evil:8080",
  "--load-extension=C:\\x", "--user-data-dir=C:\\x", "--dev", "--no-lock", "--host-rules=MAP * evil", "--disable-features=X"];
for (const a of opasni) b.proveri(`prepoznaje opasan argument ${a.split("=")[0]}`, k.opasniArgumenti([a]).length === 1);
b.proveri("obican argument nije opasan", k.opasniArgumenti(["C:\\Program Files\\x\\Crit Launcher.exe", "--updated", "--odbijeni-argumenti=inspect"]).length === 0);
for (const a of ["-remote-debugging-port=9222", "/remote-debugging-port=9222", "--REMOTE-DEBUGGING-PORT=9222", "/inspect",
  "--renderer-cmd-prefix=powershell", "--gpu-launcher=cmd", "--browser-subprocess-path=C:\\x.exe", "--utility-cmd-prefix=x"]) {
  b.proveri(`prepoznaje i oblik ${a.split("=")[0]} (Chromium na Windows-u prima -, -- i /)`, k.trebaPonovo([a]));
}
b.proveri("putanja programa nije prekidac", k.opasniArgumenti(["/home/x/Crit Launcher", "C:/x/debug.exe"]).length === 0);
b.proveri("--dev i --no-lock se samo zanemaruju (bez ponovnog pokretanja)", !k.trebaPonovo(["--dev", "--no-lock"]));
b.proveri("razvojni alati spolja traze ponovno pokretanje", k.trebaPonovo(["--remote-debugging-port=9222"]) && k.trebaPonovo(["--inspect"]));

// ---- 5. nadzor veze (lazni sat) ----
let sad = 1_000_000;
const sat = () => sad;
const n = k.napraviNadzorVeze({ sat });
const korak = (o) => n.korak({ vezaOtvorena: true, podeseno: true, ...o });
b.proveri("ugovor sa serverom: 15 s", k.TISINA_MS === 15000);
sad += 14_000;
let r = korak();
b.proveri("14 s tisine jos nije prekid", !r.zakljucaj && !r.prekiniVezu && !r.zakljucano);
n.znak(); sad += 10_000;
b.proveri("znak od servera vraca brojanje na nulu", !korak().zakljucano);
sad += 6_000;
r = korak();
b.proveri("posle 16 s tisine: veza se prekida i racunar zakljucava", r.prekiniVezu && r.zakljucaj && r.zakljucano, JSON.stringify(r));
sad += 1000;
r = korak({ vezaOtvorena: false });
b.proveri("zakljucavanje se javlja jednom, ne na svaki otkucaj", !r.zakljucaj && r.zakljucano && !r.prekiniVezu);
sad += 60_000;
b.proveri("posle minut igre jos rade (zagrcnuta mreza ne kosta igru)", !korak({ vezaOtvorena: false }).ugasiIgre);
sad += 60_000;
r = korak({ vezaOtvorena: false });
b.proveri("posle 2 min bez veze: igre se gase", r.ugasiIgre === true);
sad += 1000;
b.proveri("gasenje igara jednom", korak({ vezaOtvorena: false }).ugasiIgre === false);
n.znak();
r = korak();
b.proveri("server se javio: otkljucava se", r.otkljucaj && !r.zakljucano);
b.proveri("posle otkljucavanja cisto stanje", !n.stanje().zakljucano && !n.stanje().igreUgasene);
sad += 20_000;
b.proveri("nov prekid opet zakljucava", korak({ vezaOtvorena: false }).zakljucaj);
r = n.korak({ podeseno: false });
b.proveri("launcher bez podesavanja (ekran za podesavanje) se ne zakljucava", r.otkljucaj && !r.zakljucano);
sad += 60_000;
b.proveri("...ni posle minut", !n.korak({ podeseno: false }).zakljucano);
const n2 = k.napraviNadzorVeze({ sat, ugasiIgrePosleMs: 30_000 });
sad += 16_000;
n2.korak({ vezaOtvorena: false });
sad += 30_000;
b.proveri("vreme do gasenja igara je podesivo", n2.korak({ vezaOtvorena: false }).ugasiIgre);

// ---- 6. pad igre ----
b.proveri("pristup memoriji (0xC0000005) je pad", k.vrstaIzlaza({ kod: 3221225477 }) === "pad");
b.proveri("isti kod kao negativan broj je pad", k.vrstaIzlaza({ kod: -1073741819 }) === "pad");
b.proveri(".NET izuzetak (0xE0434352) je pad", k.vrstaIzlaza({ kod: 0xE0434352 }) === "pad");
b.proveri("proces ubijen signalom je pad", k.vrstaIzlaza({ kod: null, signal: "SIGKILL" }) === "pad");
b.proveri("uredan izlaz nije pad", k.vrstaIzlaza({ kod: 0 }) === null);
b.proveri("pokretac koji izadje sa 1 nije pad (igra se tek otvara)", k.vrstaIzlaza({ kod: 1 }) === null);
b.proveri("bez koda nije pad", k.vrstaIzlaza({}) === null && k.vrstaIzlaza() === null);

// ---- 7. main.js stvarno primenjuje pravila ----
const main = citajIzvor("client/main.js");
b.proveri("main.js koristi kiosk.js", /require\("\.\/kiosk\.js"\)/.test(main));
b.proveri("tastatura se proverava pre ekrana (before-input-event)", /before-input-event[\s\S]{0,200}opasanTaster/.test(main));
b.proveri("podrazumevani meni je uklonjen", /Menu\.setApplicationMenu\(null\)/.test(main));
b.proveri("navigacija van ekrana je zabranjena", /will-navigate[\s\S]{0,200}lokalnaStrana/.test(main));
b.proveri("pregledac otvara samo bezbednu adresu", /function openBrowser[\s\S]{0,300}bezbednaAdresa/.test(main));
b.proveri("opasni argumenti se proveravaju", /opasniArgumenti\(/.test(main) && /trebaPonovo\(/.test(main));
b.proveri("--dev ne vazi u instaliranom launcheru", /const DEV = !app\.isPackaged && process\.argv\.includes\("--dev"\)/.test(main));
b.proveri("nadzor veze se koristi", /napraviNadzorVeze\(/.test(main));
b.proveri("razvojni alati: zatvaraju se ako se ipak otvore", /devtools-opened/.test(main));
b.proveri("druga instanca stvarno izlazi", /if \(!gotLock\) \{[^}]*app\.exit\(0\)/.test(main));
b.proveri("admin izlaz trazi odobrenje u glavnom procesu", /ipcMain\.handle\("admin-exit"[\s\S]{0,300}izlazOdobren/.test(main));
const paket = JSON.parse(citajIzvor("client/package.json"));
b.proveri("kiosk.js ide u instaler", paket.build.files.includes("kiosk.js"));

// ---- 8. most izmedju ekrana i glavnog procesa ----
//
// Ekran (renderer) nije brava: sve sto on sme, sme i kod koji bi se u njega
// ubacio. Zato glavni proces sam proverava ono sto gasi kiosk ili menja server.
const blok = (od, duzina = 700) => { const i = main.indexOf(od); return i < 0 ? "" : main.slice(i, i + duzina); };
b.proveri("save-config prima samo adresu i token (ne ...c)", /config = \{ \.\.\.config, host, token, configured: true \}/.test(main) && !/\.\.\.c, host/.test(main));
b.proveri("save-config radi samo dok launcher nije podesen", /ipcMain\.handle\("save-config"[\s\S]{0,400}if \(podesen\(\)\) return \{ ok: false/.test(main));
b.proveri("lokalni PIN odobrava izlaz tek kad je tacan", /pinPogodjen\(\);\s*odobriIzlaz\(\);/.test(blok('ipcMain.handle("proveri-servisni-pin"')));
b.proveri("PIN sa servera (pin_ok) odobrava izlaz u glavnom procesu", /msg\.t === "pin_ok"\) odobriIzlaz\(\)/.test(main));
b.proveri("odobrenje izlaza kratko traje i trosi se", /izlazOdobrenDo = Date\.now\(\) \+ 30000/.test(main) && /izlazOdobrenDo = 0;\s*app\.isQuitting = true;/.test(main));
b.proveri("lokalni PIN ima kocnicu (i za reset adrese)", /if \(pinKocnica\(\)\)/.test(blok('ipcMain.handle("proveri-servisni-pin"')) && /if \(pinKocnica\(\)\)/.test(blok('ipcMain.handle("reset-config"')));
b.proveri("Ctrl+Alt+Shift+R ne brise podesavanje bez PIN-a", !/Shift\+R"[\s\S]{0,200}resetConfig\(\)/.test(main) && /action: "setup"/.test(main));
b.proveri("igra i sajt se otvaraju samo u sesiji", /ipcMain\.handle\("launch-game"[\s\S]{0,120}!sesijaAktivna/.test(main) && /ipcMain\.handle\("open-browser"[\s\S]{0,120}!sesijaAktivna/.test(main));

// ---- 9. prozori ----
b.proveri("svi prozori: razvojni alati samo u DEV", (main.match(/devTools: DEV/g) || []).length === 3);
b.proveri("svi prozori: sandbox", (main.match(/sandbox: true/g) || []).length === 3);
b.proveri("nijedan prozor ne otvara nov prozor ni webview",
  /web-contents-created[\s\S]{0,2000}setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/.test(main) && /will-attach-webview", \(e\) => e\.preventDefault\(\)/.test(main));
b.proveri("dozvole (kamera, mikrofon...) se odbijaju", /setPermissionRequestHandler\(\(_wc, _dozvola, odgovor\) => odgovor\(false\)\)/.test(main));
b.proveri("ponovno pokretanje bez opasnih argumenata", /app\.relaunch\(\{[\s\S]{0,200}OPASNI_ARGUMENTI/.test(main));
b.proveri("relaunch ne uzima bravu jedne kopije", /const gotLock = !ponovoPokrecem && app\.requestSingleInstanceLock\(\)/.test(main));
b.proveri("bez-zakljucavanja.txt vazi samo na administratorskom nalogu (igrac ga ne moze podmetnuti)",
  /function zastavaBezZakljucavanja[\s\S]{0,900}if \(nalogJeAdministrator\(\)\)/.test(main) && /zastavaBezZakljucavanja\(\) \|\|/.test(main) && !/GetOwner/.test(main));
b.proveri("aktivna zastava se javlja osoblju", /if \(zastavaAktivna\) javiProblem\("zastava_aktivna"/.test(main));
b.proveri("svaki prekid veze nosi stanje zakljucavanja", /sveza\.on\("close"[\s\S]{0,400}sendToRenderer\("ws-status", statusBezVeze\(\)\)/.test(main));
b.proveri("ekran menja opis, ne zelenu tacku", /\$\("#connSesija b \+ span"\)/.test(citajIzvor("client/renderer/js/launcher.js")));
b.proveri("--no-lock ne vazi u instaliranom launcheru", /\(!PAKOVAN && process\.argv\.includes\("--no-lock"\)\)/.test(main));
b.proveri("neuhvacena greska ne otvara sistemski prozor", /process\.on\("uncaughtException"/.test(main));
b.proveri("bez cmd.exe izmedju launchera i Windows alata (execFile)", !/\bexec\(/.test(main));

// ---- 10. pad igre ----
b.proveri("izlaz igre se razvrstava (vrstaIzlaza)", /child\.on\("exit", \(kod, signal\)[\s\S]{0,500}vrstaIzlaza\(\{ kod, signal/.test(main));
b.proveri("igra koju gasi launcher nije pad", /g\.ugasena = true/.test(main) && /entry\.ugasena \|\|/.test(main));
b.proveri("posle pada: prozor sa greskom se gasi, launcher se vraca", /function igraPala[\s\S]{0,700}WerFault\.exe[\s\S]{0,400}focusLauncher\(\)/.test(main));
b.proveri("prozor 'prestao je da radi' se ne prikazuje (DontShowUI)", /\[WER_KLJUC, "DontShowUI"\]/.test(main));
b.proveri(".bat igre mimo Windows 'otvori' (zabrana cmd.exe ih ne sme stici)", /function pokreniSkriptu[\s\S]{0,300}windowsVerbatimArguments: true/.test(main));

// ---- 11. nadzor veze ----
b.proveri("ping sa servera je znak zivota", /sveza\.on\("ping", \(\) => \{ if \(jeAktuelna\(\)\) nadzorVeze\.znak\(\); \}\)/.test(main));
b.proveri("poruka sa servera je znak zivota", /sveza\.on\("message"[\s\S]{0,80}nadzorVeze\.znak\(\)/.test(main));
b.proveri("tisina: veza se prekida", /r\.prekiniVezu && ws[\s\S]{0,120}ws\.terminate\(\)/.test(main));
b.proveri("bez veze nadzor prozora ide granom 'zakljucano', i u sesiji", /if \(sesijaAktivna && !bezVeze\)/.test(main) && /else if \(gameActive\(\) && !bezVeze\)/.test(main));
b.proveri("bez veze launcher je iznad svega i u sesiji", /setAlwaysOnTop\(!sesijaAktivna \|\| bezVeze, "screen-saver"\)/.test(main));
b.proveri("sat nadzora je monoton (pomeranje sata ne zakljucava)", /sat: \(\) => performance\.now\(\)/.test(main));
b.proveri("vreme do gasenja igara je u podesavanja.json", /"gasiIgreBezVezeSekundi": 120/.test(citajIzvor("client/podesavanja.json")));
b.proveri("veza koja visi u povezivanju ima rok", /handshakeTimeout: 10000/.test(main));
b.proveri("nastavak sesije ne snima ponovo stanje 'pre sesije'", /const novaSesija = !sesijaAktivna;[\s\S]{0,400}if \(novaSesija\)/.test(main));
const ekranJs = citajIzvor("client/renderer/js/launcher.js");
b.proveri("ekran kaze igracu da je zakljucano i da mu se vreme ne trosi", /function tekstBezVeze[\s\S]{0,900}Računar je zaključan dok se veza ne vrati/.test(ekranJs));

// ---- 12. fuses (prekidaci u samom .exe) ----
const fuses = citajIzvor("client/fuses.js");
b.proveri("fuses se postavljaju posle pakovanja", paket.build.afterPack === "./fuses.js");
for (const [ime, vrednost] of [["RunAsNode", false], ["EnableNodeOptionsEnvironmentVariable", false], ["EnableNodeCliInspectArguments", false], ["OnlyLoadAppFromAsar", true]]) {
  b.proveri(`fuse ${ime}: ${vrednost}`, new RegExp(`\\[FuseV1Options\\.${ime}\\]: ${vrednost},`).test(fuses));
}
b.proveri("fuses.js ne ide u instaler", !paket.build.files.includes("fuses.js"));

await b.kraj();
