import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { KOREN, brojac, citajIzvor } from "./_okruzenje.mjs";
import { FAJLOVI_SA_IMENOM } from "../igraonica.mjs";
// ALATI OSOBLJA: KO SME DA IH POKRENE I NAD KIM RADE
//
// .bat alati (zastita, POPRAVI, DEINSTALIRAJ, reset) menjaju Windows i gase
// launcher. Dve stvari moraju da drze:
//   1. igrac ih ne moze sam pokrenuti sa ucinkom - svaki trazi administratora,
//      a ne stoje u folderu u koji igrac pise (bio bi to poziv da ih izmeni i
//      saceka osoblje koje ih pokrece kao administrator)
//   2. kad ih osoblje pokrene "kao administrator", rade nad nalogom IGRACA, a
//      ne nad administratorom (HKCU i %APPDATA% su tada administratorovi)
//
// .bat se na Linux-u ne moze pustiti, pa se ovde proverava tekst i osnovna
// sintaksa blokova. zastita.ps1 se na Windows-u (CI) i parsira i pita za nalog.

const b = brojac();
const brend = JSON.parse(citajIzvor("igraonica.json"));
const ALATI = ["POPRAVI-RACUNAR.bat", "DEINSTALIRAJ-LAUNCHER.bat", "zastita-ukljuci.bat", "zastita-iskljuci.bat", "resetuj-launcher.bat"];
const bat = Object.fromEntries(ALATI.map((f) => [f, citajIzvor(`client/${f}`)]));
const ps1 = citajIzvor("client/zastita.ps1");
const redovi = (t) => t.split(/\r?\n/);
const kod = (t) => redovi(t).filter((r) => !/^\s*(REM\b|::|$)/i.test(r));

// ---- 1. svaki alat trazi administratora PRE prve radnje ----
const RADNJA = /^\s*(taskkill|reg |rmdir|del |powershell|wmic|powercfg|start |for )/i;
for (const f of ALATI) {
  const k = kod(bat[f]);
  const brava = k.findIndex((r) => /net session/i.test(r));
  const prvaRadnja = k.findIndex((r) => RADNJA.test(r));
  b.proveri(`${f}: trazi administratora pre prve radnje`, brava > -1 && brava < prvaRadnja,
    `brava na ${brava}, prva radnja na ${prvaRadnja}: ${k[prvaRadnja] || ""}`);
}
b.proveri("resetuj-launcher vise ne radi bez administratora",
  /net session[\s\S]{0,80}if errorlevel 1 \(/.test(bat["resetuj-launcher.bat"]),
  "bez ovoga igrac sam gasi launcher i brise mu adresu servera");

// ---- 2. potvrda pre necega sto se ne vraca jednim klikom ----
for (const f of ["POPRAVI-RACUNAR.bat", "DEINSTALIRAJ-LAUNCHER.bat", "resetuj-launcher.bat"]) {
  b.proveri(`${f}: trazi potvrdu`, /choice \/C DN/.test(bat[f]));
}

// ---- 3. nad nalogom IGRACA ----
for (const f of ["zastita-ukljuci.bat", "zastita-iskljuci.bat"]) {
  b.proveri(`${f}: ne pise u HKCU (to bi bio administrator)`, !kod(bat[f]).some((r) => /HKCU/i.test(r)));
  b.proveri(`${f}: radi kroz zastita.ps1`, /-File "%~dp0zastita\.ps1" -Rezim (ukljuci|iskljuci)/.test(bat[f]));
  b.proveri(`${f}: proverava da je zastita.ps1 tu`, /if not exist "%~dp0zastita\.ps1"/.test(bat[f]));
}
for (const f of ["DEINSTALIRAJ-LAUNCHER.bat", "resetuj-launcher.bat"]) {
  const t = bat[f];
  const preusmereno = t.indexOf('set "APPDATA=%PROFIL%\\AppData\\Roaming"');
  const prvaUpotreba = t.indexOf("%APPDATA%\\", t.indexOf("net session"));
  b.proveri(`${f}: %APPDATA% pokazuje na profil igraca pre brisanja`,
    preusmereno > -1 && preusmereno < prvaUpotreba, `${preusmereno} / ${prvaUpotreba}`);
  b.proveri(`${f}: nalog igraca daje zastita.ps1`, /zastita\.ps1" -Rezim nalog/.test(t));
}
b.proveri("DEINSTALIRAJ: i LOCALAPPDATA ide na profil igraca (tamo je instaliran launcher)",
  bat["DEINSTALIRAJ-LAUNCHER.bat"].includes('set "LOCALAPPDATA=%PROFIL%\\AppData\\Local"'));
b.proveri("POPRAVI: precica u autostartu se brise u SVIM profilima",
  /for \/d %%P in \("%SystemDrive%\\Users\\\*"\) do del [^\n]*Startup\\/.test(bat["POPRAVI-RACUNAR.bat"]));
b.proveri("POPRAVI: skida i zabranu komandne linije", /DisableCMD/.test(bat["POPRAVI-RACUNAR.bat"]));
b.proveri("POPRAVI: odjavljeni nalozi idu kroz zastita.ps1 -Rezim popravi",
  /zastita\.ps1" -Rezim popravi/.test(bat["POPRAVI-RACUNAR.bat"]));
b.proveri("POPRAVI: ne pokrece Explorer iz prozora administratora",
  !kod(bat["POPRAVI-RACUNAR.bat"]).some((r) => /start\s+explorer/i.test(r)),
  "Explorer pokrenut odatle ume da ostane sa pravima administratora na ekranu igraca");

// ---- 4. zastita.ps1 ----
b.proveri("zastita.ps1 pise u registar naloga (HKEY_USERS), ne u HKCU",
  /Registry::HKEY_USERS\\/.test(ps1) && !/HKCU:/i.test(ps1));
b.proveri("ukljucivanje i iskljucivanje idu iz istog spiska",
  /foreach \(\$v in \$VREDNOSTI\) \{\s*try \{ Upisi/.test(ps1) && /foreach \(\$v in \$VREDNOSTI\) \{[^}]*\}?\s*try \{ Obrisi/.test(ps1));
for (const [ime, vrednost] of [["DisableTaskMgr", 1], ["DisableRegistryTools", 1], ["NoWinKeys", 1], ["NoRun", 1],
  ["NoControlPanel", 1], ["DisableCMD", 2], ["DisallowRun", 1], ["DontShowUI", 1]]) {
  b.proveri(`zastita.ps1 postavlja ${ime}=${vrednost}`, new RegExp(`Ime = "${ime}"; Vrednost = ${vrednost} \\}`).test(ps1));
}
b.proveri("DisableCMD=2: .bat skripte i dalje rade (nadogradnja launchera)", !/Ime = "DisableCMD"; Vrednost = 1/.test(ps1));
for (const p of ["cmd.exe", "powershell.exe", "pwsh.exe", "taskmgr.exe", "regedit.exe", "mshta.exe", "wscript.exe"]) {
  b.proveri(`Explorer ne pokrece ${p}`, ps1.includes(`"${p}"`));
}
b.proveri("deinstalacija launchera je zabranjena (ne trazi administratora)",
  bat["zastita-ukljuci.bat"].includes(`-Zabrani "Uninstall ${brend.launcher}.exe"`));
b.proveri("tudji unosi u DisallowRun ostaju", /Tudji unosi ostaju/.test(ps1) && /\$ostalo -eq 0/.test(ps1));
b.proveri("upozorava kad je nalog igraca administrator", /\$n\.Admin -eq "da"/.test(ps1));
b.proveri("ne zakljucava nalog sa kog osoblje radi bez pitanja", /\$n\.Sid -eq \$ja/.test(ps1));
b.proveri("neprijavljen nalog: registar se otvara i zatvara", /reg\.exe load/.test(ps1) && /reg\.exe unload/.test(ps1));
b.proveri("zastita.ps1 trazi administratora", /if \(-not \(JeAdministrator\)\)/.test(ps1));
b.proveri("zastita.ps1 je ASCII (Windows PowerShell 5.1 cita fajl bez BOM-a kao ANSI)", !/[^\x00-\x7f]/.test(ps1));

// ---- 5. alati ne idu na racunar igraca ----
const paket = JSON.parse(citajIzvor("client/package.json"));
const extra = (paket.build.extraResources || []).map((r) => String(r.from || r));
b.proveri("instaler ne nosi .bat ni .ps1 u folder igraca", !extra.some((f) => /\.(bat|cmd|ps1)$/i.test(f)), extra.join(", "));
b.proveri("instaler i dalje nosi podesavanja.json", extra.includes("podesavanja.json"));
const np = citajIzvor("napravi-paket.mjs");
for (const f of [...ALATI, "zastita.ps1"]) {
  b.proveri(`paket nosi ${f} u ALATI OSOBLJA`, np.includes(`"${f}"`) && /path\.join\(ROOT, "client", f\)/.test(np));
}

// ---- 6. kopije u korenu su iste i preimenuju se ----
for (const f of ["POPRAVI-RACUNAR.bat", "DEINSTALIRAJ-LAUNCHER.bat"]) {
  b.proveri(`${f}: kopija u korenu je ista kao u client/`, citajIzvor(f) === bat[f]);
  b.proveri(`${f}: kopija u korenu se preimenuje sa igraonicom`, FAJLOVI_SA_IMENOM.includes(f));
}

// ---- 7. sintaksa blokova u .bat ----
//
// Najcesca greska u .bat fajlu: ")" u echo redu UNUTAR bloka "if (...)" zatvori
// blok pre vremena, i ostatak se izvrsi bez uslova. Zagrade u echo-u unutar
// bloka moraju biti ^( ^).
function proveriBlokove(t) {
  let dubina = 0;
  const greske = [];
  redovi(t).forEach((red, i) => {
    const r = red.trim();
    if (!r || /^(REM\b|::)/i.test(r)) return;
    if (r.startsWith(")")) dubina--;
    if (dubina > 0 && /^echo\b/i.test(r) && /(^|[^^])\)/.test(r.replace(/^echo\.?/i, ""))) greske.push(`${i + 1}: ${r.slice(0, 60)}`);
    if (/\($/.test(r)) dubina++;
    if (dubina < 0) greske.push(`${i + 1}: visak ")"`);
  });
  if (dubina !== 0) greske.push(`nezatvoren blok (dubina ${dubina})`);
  return greske;
}
for (const f of fs.readdirSync(path.join(KOREN, "client")).filter((x) => x.endsWith(".bat"))) {
  const g = proveriBlokove(citajIzvor(`client/${f}`));
  b.proveri(`${f}: blokovi su zatvoreni, echo u bloku nema golu zagradu`, g.length === 0, g.join(" | "));
}

// ---- 8. logika zastita.ps1, bez pravog registra ----
//
// zastita-logika.ps1 uzme funkcije iz zastita.ps1 i pusti ih nad registrom u
// memoriji: ukljuci, ponovo ukljuci, iskljuci, tudji unosi u spisku zabrana.
// Na Windows-u ide kroz Windows PowerShell 5.1 (isti koji pokrecu .bat
// fajlovi); drugde kroz pwsh ako ga ima (CRIT_PWSH = putanja do njega).
{
  const ps = process.platform === "win32" ? "powershell" : (process.env.CRIT_PWSH || "pwsh");
  let izlaz = null;
  try {
    izlaz = execFileSync(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      path.join(KOREN, "testovi", "zastita-logika.ps1"), "-Skripta", path.join(KOREN, "client", "zastita.ps1")],
    { encoding: "utf8", timeout: 120000 });
  } catch (e) {
    if (e.code === "ENOENT") console.log("  --   logika zastita.ps1: nema PowerShell-a na ovom racunaru (proverava se na CI-ju)");
    else izlaz = String(e.stdout || "") + "\nPAO pokretanje: " + String(e.message).slice(0, 200);
  }
  if (izlaz != null) {
    const redovi2 = izlaz.split(/\r?\n/).filter((r) => /^(OK|PAO) /.test(r));
    b.proveri("logika zastita.ps1: proveravano je nesto", redovi2.length >= 15, izlaz.slice(0, 300));
    for (const r of redovi2) b.proveri(`logika zastita.ps1: ${r.replace(/^(OK|PAO)\s+/, "")}`, r.startsWith("OK"));
  }
}

// ---- 9. zastita.ps1 na pravom Windows-u (CI) ----
if (process.platform === "win32") {
  const put = path.join(KOREN, "client", "zastita.ps1");
  let parse = "";
  try {
    parse = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:F,[ref]$t,[ref]$e);if($e){$e|%{$_.Extent.StartLineNumber.ToString()+': '+$_.Message};exit 1};'OK'"],
    { env: { ...process.env, F: put }, encoding: "utf8", timeout: 60000 }).trim();
  } catch (e) { parse = String(e.stdout || e.message); }
  b.proveri("zastita.ps1 se parsira u Windows PowerShell-u", parse === "OK", parse.slice(0, 300));
  // Samo CITANJE: koji je SID i profil naloga. Nista se ne upisuje.
  let red = "";
  try {
    red = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", put,
      "-Rezim", "nalog", "-Nalog", os.userInfo().username], { encoding: "utf8", timeout: 60000 }).trim();
  } catch (e) { red = String(e.stdout || e.message); }
  b.proveri("zastita.ps1 -Rezim nalog daje SID|profil|ime|admin", /^S-1-5-21-[\d-]+\|[^|]+\|[^|]+\|(da|ne|\?)$/.test(red), red.slice(0, 200));
} else {
  console.log("  --   zastita.ps1 se parsira i pokrece samo na Windows-u (CI)");
}

await b.kraj();
