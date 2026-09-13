import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { KOREN, brojac } from "./_okruzenje.mjs";
// STRAŽA NAD SKINUTIM PROGRAMIMA, SA PRAVIM POWERSHELL-OM
//
// test-bez-zamrzavanja.mjs proverava odluke straže sa lažnim pomoćnim
// procesom. Ovde se pušta pravi, jer tri stvari mogu da se vide samo na
// Windows-u:
//
//   1. da skripta uopšte radi kao argument za -Command (navodnici, prelomi)
//   2. da za sve vreme radi JEDAN PowerShell - ranije je na svake četiri sekunde
//      kretao novi, i to je bio trzaj u igri i put do zamrznutog računara
//   3. da pomoćni proces sam nestane kad launcher umre bez pozdrava - inače bi
//      ostajao da radi do gašenja računara, po jedan za svaki pad launchera
//
// "Skinut program" je kopija ping.exe u lažnoj fascikli Preuzimanja, u
// privremenoj fascikli ove probe. Straža dobija lažan korisnički folder, pa na
// ovom računaru ne može da prepozna - ni da ugasi - ništa osim te kopije.
//
//   node proba-straze.mjs
if (process.platform !== "win32") { console.log("proba radi samo na Windows-u"); process.exit(0); }

const require = createRequire(import.meta.url);
const { pokreniStrazu, skriptaStraze } = require("../client/procesi.js");
let odvojena = null; // skripta pokrenuta van Node-ovog posla, u 4. delu
const { proveri, kraj } = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const ziv = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

const RADNO = path.join(os.tmpdir(), "crit-proba-straze");
fs.rmSync(RADNO, { recursive: true, force: true });
const KORISNIK = path.join(RADNO, "korisnik");
const PREUZIMANJA = path.join(KORISNIK, "Downloads");
fs.mkdirSync(PREUZIMANJA, { recursive: true });
const ENV = { USERPROFILE: KORISNIK, TEMP: path.join(KORISNIK, "AppData", "Local", "Temp") };
const SKINUTO = path.join(PREUZIMANJA, "skinuto.exe");
fs.copyFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "PING.EXE"), SKINUTO);

// Koliko PowerShell procesa je dete OVOG procesa (bez onog koji broji).
const powershellIspod = (roditelj) => {
  try {
    const izlaz = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${roditelj}' | ` +
      "Where-Object { $_.Name -eq 'powershell.exe' -and $_.ProcessId -ne $PID }).Count"],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
    return parseInt(String(izlaz).trim(), 10);
  } catch { return -1; }
};

let ping = null;
let siroce = 0;
let siroceNestalo = true;
const straze = [];
console.log("PROBA STRAŽE (pravi PowerShell)\n");
try {
  // ---- 1) probni rad: vidi, ne gasi, i radi JEDAN proces ----
  const logovi = [];
  const s1 = pokreniStrazu({ env: ENV, suvo: true, razmakMs: 1000, log: (x) => logovi.push(x) });
  straze.push(s1);
  ping = spawn(SKINUTO, ["-n", "90", "127.0.0.1"], { windowsHide: true, stdio: "ignore" });
  const vidi = () => logovi.some((l) => l.toLowerCase().includes("skinuto.exe"));
  const t0 = Date.now();
  for (let i = 0; i < 80 && !vidi(); i++) await cekaj(250);
  proveri("straža vidi program pokrenut iz Preuzimanja", vidi(),
    logovi.slice(-2).join(" | ") || "za 20 s nije javila ništa - skripta verovatno ne radi");
  if (vidi()) console.log(`       (prepoznat za ${Date.now() - t0} ms, zajedno sa pokretanjem PowerShell-a)`);
  proveri("u probnom radu ga ne gasi", ziv(ping.pid));

  const pomocni = s1.pid;
  await cekaj(5000); // pet krugova
  proveri("posle pet krugova radi isti pomoćni proces", s1.pid === pomocni && ziv(pomocni), `${pomocni} -> ${s1.pid}`);
  const n = powershellIspod(process.pid);
  proveri("i JEDAN PowerShell ispod launchera, ne nov na svaki krug", n === 1, `${n} PowerShell procesa`);
  s1.zaustavi();
  await cekaj(1500);
  proveri("zaustavljena straža ne ostavlja proces", !ziv(pomocni), `PID ${pomocni} i dalje radi`);

  // ---- 2) pravi rad: gasi ga i javlja ----
  const obavesteni = [];
  const s2 = pokreniStrazu({ env: ENV, razmakMs: 1000, obavesti: (ime) => obavesteni.push(ime) });
  straze.push(s2);
  const t1 = Date.now();
  for (let i = 0; i < 80 && ziv(ping.pid); i++) await cekaj(250);
  const trajalo = Date.now() - t1;
  proveri("program iz Preuzimanja je ugašen", !ziv(ping.pid));
  proveri("za manje od 10 sekundi", trajalo < 10000, `${trajalo} ms`);
  for (let i = 0; i < 30 && !obavesteni.length; i++) await cekaj(100);
  proveri("igraču se kaže šta je ugašeno", obavesteni.includes("skinuto.exe"), JSON.stringify(obavesteni));
  s2.zaustavi();

  // ---- 3) launcher umre bez pozdrava ----
  const rodPut = path.join(RADNO, "roditelj.cjs");
  fs.writeFileSync(rodPut, [
    `const { pokreniStrazu } = require(${JSON.stringify(path.join(KOREN, "client", "procesi.js"))});`,
    `const s = pokreniStrazu({ razmakMs: 500, suvo: true, env: ${JSON.stringify({ USERPROFILE: path.join(RADNO, "nema"), TEMP: path.join(RADNO, "nema", "t") })} });`,
    // Izlaz bez zaustavi(): isto kao kad launcher pukne.
    "setTimeout(() => { console.log('POMOCNI ' + s.pid); setTimeout(() => process.exit(0), 200); }, 2500);",
  ].join("\n"), "utf8");
  const rod = spawn(process.execPath, [rodPut], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  let izlaz = "";
  rod.stdout.on("data", (d) => (izlaz += d));
  await new Promise((r) => rod.on("exit", r));
  siroce = Number((/POMOCNI (\d+)/.exec(izlaz) || [])[1]) || 0;
  proveri("launcher je podigao stražu pre nego što je umro", siroce > 0, izlaz.trim() || "nije javio PID");
  siroceNestalo = false;
  const t2 = Date.now();
  for (let i = 0; i < 40; i++) { if (!ziv(siroce)) { siroceNestalo = true; break; } await cekaj(250); }
  proveri("kad launcher umre, straža nestane sama", siroceNestalo, `PID ${siroce} i dalje radi posle 10 s`);
  if (siroceNestalo) console.log(`       (nestala ${Date.now() - t2} ms posle launchera)`);

  // ---- 4) ...i to NE SAMO zato što je Node ubije ----
  //
  // Gornja provera prolazi i bez ijedne linije u skripti: Node na Windows-u
  // gasi svoje procese kad sam izađe. Ta zaštita postoji, ali se ne vidi iz
  // našeg koda i ne zavisi od nas. Provera roditelja u skripti je druga,
  // nezavisna brava - i ovde se meri baš ona.
  //
  // Straža je dete OVE probe, ali joj se za roditelja daje DRUGI proces - lažan,
  // koji proba ubije. Proba i dalje živi, pa Node nema razloga da gasi išta; ako
  // straža nestane, ugasila se sama. (Pokretanje sa `detached` ovde ne vredi: na
  // Windows-u je to proces bez ikakve konzole i PowerShell tada ni ne krene.)
  const lazanRoditelj = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { windowsHide: true, stdio: "ignore" });
  await cekaj(300);
  odvojena = spawn("powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", skriptaStraze(lazanRoditelj.pid, 500)],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let znakovi = 0;
  let greske = "";
  odvojena.stdout.on("data", (d) => { znakovi += (String(d).match(/ZIV/g) || []).length; });
  odvojena.stderr.on("data", (d) => { greske += d; });
  for (let i = 0; i < 60 && znakovi < 2 && odvojena.exitCode === null; i++) await cekaj(250);
  proveri("straža nad tuđim roditeljem radi u krug", znakovi >= 2,
    `${znakovi} znakova života, izlaz ${odvojena.exitCode}${greske ? ": " + greske.trim().split("\n")[0].slice(0, 160) : ""}`);
  const radilaPreSmrti = znakovi >= 2 && odvojena.exitCode === null;
  lazanRoditelj.kill();
  const t3 = Date.now();
  let odvojenaNestala = false;
  for (let i = 0; i < 40; i++) { if (odvojena.exitCode !== null) { odvojenaNestala = true; break; } await cekaj(250); }
  proveri("i sama skripta se gasi kad roditelja nema", radilaPreSmrti && odvojenaNestala,
    radilaPreSmrti ? "provera roditelja u skripti ne radi" : "nije ni radila - provera ne bi ništa dokazala");
  if (radilaPreSmrti && odvojenaNestala) console.log(`       (${Date.now() - t3} ms posle roditelja, krug je 500 ms)`);
} finally {
  if (odvojena && odvojena.exitCode === null) { try { odvojena.kill(); } catch {} }
  for (const s of straze) { try { s.zaustavi(); } catch {} }
  if (ping && ziv(ping.pid)) { try { ping.kill(); } catch {} }
  // Siroče se gasi po PID-u samo ako proba NIJE videla da je nestalo - inače bi
  // PID mogao da pripada nečem sasvim drugom na ovom računaru.
  if (siroce && !siroceNestalo && ziv(siroce)) { try { process.kill(siroce); } catch {} }
  await cekaj(500);
  try { fs.rmSync(RADNO, { recursive: true, force: true }); } catch {}
}

await kraj();
