import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { KOREN, radniFolder } from "./_okruzenje.mjs";
// Racunar se uvek vraca, i kad nadogradnja ne uspe.
//
// Instalaciju vode dve batch skripte: glavna ceka instaler i vraca launcher, a
// osigurac vraca launcher i kad glavna zapne. Skripte se ovde pokrecu tacno kao
// u launcheru (odvojeno, sakriveno, bez izlaza), jer u tom okruzenju:
//   1. `tasklist` ne radi, a greska se ne vidi
//   2. `start /wait` se nikad ne vrati
//
// Lazni launcher je .vbs (wscript bez konzole), trajanja su u sekundama, a na
// kraju se gasi sve sto je proba mogla da ostavi.
const require = createRequire(import.meta.url);
const { napraviSkriptu, napraviOsigurac, KOD_OSIGURAC } =
  require(path.join(KOREN, "client", "nadogradnja-skripta.js"));

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform !== "win32") {
  console.log("  OK   preskoceno (pomocnik je Windows batch)");
  console.log("\n1/1 proslo");
  process.exit(0);
}

const RADNO = radniFolder("pomocnik-nadogradnje");
const ISHOD = path.join(RADNO, "ishod.txt");
const MARKER = path.join(RADNO, "launcher-se-vratio.txt");

// Sta je proba ostavila da radi: samo procesi koje proba pravi
// (cmd/ping/wscript) i samo oni cija komandna linija pokazuje na ovaj radni
// folder. Bez suzenja po imenu brojali bi se i `node` koji pokrece probu i
// `powershell` koji broji.
const MOJI = "@('cmd.exe','PING.EXE','wscript.exe')";
const USLOV = `$_.Name -in ${MOJI} -and $_.CommandLine -like '*${RADNO.replace(/'/g, "''")}*'`;
const ps = (naredba) => {
  try { return execFileSync("powershell", ["-NoProfile", "-Command", naredba], { encoding: "utf8", timeout: 20000 }); }
  catch { return ""; }
};
function zaostali() {
  return ps(`Get-CimInstance Win32_Process | Where-Object { ${USLOV} } | Select-Object -ExpandProperty ProcessId`)
    .split(/\s+/).map(Number).filter(Boolean);
}
// Gasi se STABLO, ne samo pronadjeni proces. Skripta ceka preko `ping`-a, a
// gasenje samog cmd-a ostavlja taj ping da otkuca svoje do kraja - proces koji
// niko vise ne gleda, ali se i dalje vidi na racunaru.
function pospremi() {
  for (const pid of zaostali()) {
    try { execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", timeout: 10000 }); } catch {}
  }
}

// "Launcher" koji se vraca. .vbs, ne .cmd: `start` batch fajl otvara sa `/K` pa
// prozor ostane otvoren dok ga neko rucno ne zatvori, a wscript odradi svoje
// bez ijednog prozora i sam se ugasi.
const LAUNCHER = path.join(RADNO, "lazni-launcher.vbs");
fs.writeFileSync(LAUNCHER,
  'Set fso = CreateObject("Scripting.FileSystemObject")\r\n' +
  `fso.OpenTextFile("${MARKER.replace(/\\/g, "\\\\")}", 8, True).WriteLine "x"\r\n`, "utf8");

// Lazni instalater: .cmd, da bi se izlazni kod i trajanje mogli zadati. Pravi
// instalater je .exe, ali skripta ga zove sa `call` bas zato da joj vrsta fajla
// ne menja ponasanje - pa je ovo verna zamena, a ne olaksica.
const napraviInstalater = (ime, kod, sekundi = 0) => {
  const put = path.join(RADNO, ime);
  fs.writeFileSync(put, `@echo off\r\nping -n ${sekundi + 1} 127.0.0.1 >nul\r\nexit /b ${kod}\r\n`, "utf8");
  return put;
};

// TACNO onako kako to radi launcher (vidi pokreniNadogradnju u main.js).
const pusti = (skripta) => {
  const p = spawn("cmd.exe", ["/c", skripta], { detached: true, stdio: "ignore", windowsHide: true });
  p.unref();
};
const cekajFajl = async (put, granica) => {
  let cekao = 0;
  while (!fs.existsSync(put) && cekao < granica) { await cekaj(400); cekao += 400; }
  return cekao;
};
const ocisti = () => { fs.rmSync(MARKER, { force: true }); fs.rmSync(ISHOD, { force: true }); };
const citajIshod = () => { try { return fs.readFileSync(ISHOD, "utf8").trim(); } catch { return ""; } };

// ---- 1) INSTALACIJA KOJA PROLAZI ----
ocisti();
const dobar = napraviInstalater("dobar.cmd", 0, 3);
const s1 = path.join(RADNO, "nadogradi-1.cmd");
fs.writeFileSync(s1, napraviSkriptu({ instalater: dobar, launcher: LAUNCHER, ishod: ISHOD, verzija: "9.9.9" }), "utf8");
let pocetak = Date.now();
pusti(s1);
let cekao = await cekajFajl(MARKER, 30000);
proveri("launcher se vratio posle instalacije", fs.existsSync(MARKER), `posle ${cekao} ms nije`);
proveri("CEKALO SE DA INSTALACIJA ZAVRSI", fs.existsSync(MARKER) && Date.now() - pocetak >= 6000,
  `vratio se za ${Date.now() - pocetak} ms, a instalacija traje 3 s uz 3 s cekanja na gasenje - ` +
  "ranije se vracao odmah i prekidao instalaciju nasred");
proveri("zapisan je izlazni kod instalacije", /^0\s+N1\s+9\.9\.9$/.test(citajIshod()), `ishod: "${citajIshod()}"`);
proveri("skripta je obrisala samu sebe", !fs.existsSync(s1));
proveri("instalater je pospremljen", !fs.existsSync(dobar), "inace u Temp fascikli ostaje po sto megabajta");

// ---- 2) INSTALACIJA KOJA PUKNE ----
//
// Launcher mora nazad i tada, a kod greske mora da se sacuva - po njemu stari
// launcher javi vlasniku sta se desilo.
ocisti();
const los = napraviInstalater("los.cmd", 1603, 0); // 1603 je klasican MSI "fatal error"
const s2 = path.join(RADNO, "nadogradi-2.cmd");
fs.writeFileSync(s2, napraviSkriptu({ instalater: los, launcher: LAUNCHER, ishod: ISHOD, verzija: "9.9.9" }), "utf8");
pusti(s2);
cekao = await cekajFajl(MARKER, 30000);
proveri("launcher se vratio i posle pukle instalacije", fs.existsSync(MARKER), `posle ${cekao} ms nije`);
proveri("kod greske je sacuvan", /^1603\s+N1\s+9\.9\.9$/.test(citajIshod()), `ishod: "${citajIshod()}"`);

// ---- 3) OSIGURAC: INSTALACIJA KOJA SE NIKAD NE ZAVRSAVA ----
//
// Najgori slucaj: UAC prozor koji niko ne odobri. Glavna skripta ostaje da
// ceka - i to je u redu, dok god osigurac vrati launcher.
ocisti();
const visi = napraviInstalater("visi.cmd", 0, 15); // "nikad", meren u strpljenju probe
const s3 = path.join(RADNO, "nadogradi-3.cmd");
const o3 = path.join(RADNO, "osigurac-3.cmd");
fs.writeFileSync(s3, napraviSkriptu({ instalater: visi, launcher: LAUNCHER, ishod: ISHOD, verzija: "9.9.9" }), "utf8");
fs.writeFileSync(o3, napraviOsigurac({ launcher: LAUNCHER, ishod: ISHOD, verzija: "9.9.9", sekundi: 5 }), "utf8");
pocetak = Date.now();
pusti(s3);
pusti(o3);
cekao = await cekajFajl(MARKER, 30000);
const zaKoliko = Date.now() - pocetak;
proveri("OSIGURAC JE VRATIO LAUNCHER dok instalacija jos visi", fs.existsSync(MARKER),
  `posle ${cekao} ms nije - racunar bi ostao sa otvorenim Windowsom do kraja smene`);
proveri("vratio ga je bez cekanja na instalaciju", fs.existsSync(MARKER) && zaKoliko < 14000,
  `${Math.round(zaKoliko / 1000)} s, a instalacija traje 15 s`);
proveri("po ishodu se prepoznaje da je osigurac", citajIshod().startsWith(KOD_OSIGURAC + " "),
  `ishod: "${citajIshod()}" - vlasnik mora da vidi "nije odobreno", a ne "nesto nije uspelo"`);
pospremi(); // instalater koji "visi" ne mora da dovrsi svojih 15 s

// ---- 4) OSIGURAC NE PISE PREKO TUDJEG ODGOVORA ----
//
// Kad glavna skripta uredno zavrsi, njen kod je tacniji od bilo cega sto
// osigurac moze da zna. Bez ovoga bi svaka uspesna nadogradnja pet minuta
// kasnije bila prijavljena kao neuspela.
ocisti();
fs.writeFileSync(ISHOD, "0 9.9.9\r\n", "utf8");
const o4 = path.join(RADNO, "osigurac-4.cmd");
fs.writeFileSync(o4, napraviOsigurac({ launcher: LAUNCHER, ishod: ISHOD, verzija: "9.9.9", sekundi: 2 }), "utf8");
pusti(o4);
await cekajFajl(MARKER, 20000);
await cekaj(800);
proveri("osigurac ne prepisuje vec zapisan ishod", citajIshod() === "0 9.9.9", `ishod: "${citajIshod()}"`);

// ---- 5) sta skripta uopste sadrzi ----
//
// Poredi se ceo red, ne uzorak: putanje na Windows-u su pune obrnutih kosih
// crta, pa uzorak koji ih trazi lakse promasi zbog svog bekstva nego zbog
// stvarne greske - a takva provera onda pada kad je sve u redu.
const INST = "C:\\probno\\Setup 2.45.0.exe", LAUN = "C:\\program\\Crit.exe";
const redovi = napraviSkriptu({ instalater: INST, launcher: LAUN, ishod: "C:\\probno\\i.txt", verzija: "2.45.0" }).split("\r\n");
proveri("instalater se pokrece tiho, i ceka se na njega", redovi.includes(`call "${INST}" /S`),
  JSON.stringify(redovi));
proveri("ne pita se tasklist da li instalater radi", !redovi.some((r) => /tasklist/i.test(r)),
  "bez konzole tasklist tiho odgovara 'nema ga' i launcher se vrati nasred instalacije");
proveri("instalater se NE pokrece preko start /wait", !redovi.some((r) => /start .*\/wait/i.test(r)),
  "start trazi konzolu koje nema, pa se skripta zaglavi zauvek");
proveri("launcher se pokrece na kraju, bez uslova", redovi[redovi.length - 2] === `start "" "${LAUN}"`,
  JSON.stringify(redovi.slice(-3)));

// Nista ne sme da ostane da radi posle probe.
pospremi();
await cekaj(800);
const ostali = zaostali();
proveri("proba nije ostavila nijedan proces za sobom", ostali.length === 0,
  `jos rade: ${ostali.join(", ")} - ranije su tako ostajali otvoreni crni prozori`);

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
