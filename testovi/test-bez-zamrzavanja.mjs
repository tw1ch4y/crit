import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { citajIzvor, brojac } from "./_okruzenje.mjs";
// RAČUNAR NE SME DA STANE ZBOG LAUNCHERA
//
// Prijava iz igraonice: računar se retko, ali se dešava, "zakoči". Uzrok nije
// bio Electron, nego ono što je launcher radio iza igre:
//
//   1. NA SVAKE ČETIRI SEKUNDE, celu sesiju, nov PowerShell koji preko WMI
//      popiše sve procese. Pola sekunde do sekunde procesora po pozivu (izmereno),
//      trzaj slike na četiri sekunde - i BEZ ROKA: kad WMI zapne, svaki krug
//      doda još jedan zaglavljen PowerShell dok memorija ne nestane.
//   2. Temperatura procesora na 15 sekundi, preko WMI razreda koji traži
//      administratora. Nalog igrača to nije - upit nije uspeo NIJEDNOM, a
//      ponavljao se ceo dan.
//   3. `exec` svuda: komanda ide kroz cmd.exe, pa i tamo gde je rok postojao,
//      rok je gasio cmd, a zaglavljen program ispod njega je ostajao.
//   4. Zastor iza igre sa beskonačnom animacijom preko celog ekrana.
//
// Ovde se čuva da se to ne vrati - i PONAŠANJE straže koja je zamenila prvu
// tačku, bez Windows-a (lažni pomoćni proces). Sa pravim PowerShell-om to meri
// proba-straze.mjs.
const { proveri, kraj } = brojac();
const require = createRequire(import.meta.url);
const procesi = require("../client/procesi.js");
const bezCR = (s) => s.replace(/\r\n/g, "\n");
const main = bezCR(citajIzvor("client/main.js"));
const proc = bezCR(citajIzvor("client/procesi.js"));
const cisc = bezCR(citajIzvor("client/ciscenje.js"));
const podes = bezCR(citajIzvor("client/windows-podesavanja.js"));
const zastor = bezCR(citajIzvor("client/renderer/backdrop.html"));
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const telo = (izvor, pocetak) => {
  const i = izvor.indexOf(pocetak);
  if (i < 0) return "";
  const j = izvor.indexOf("\n}\n", i);
  return izvor.slice(i, j < 0 ? undefined : j + 2);
};

// ---- 1) NADZOR NE POKREĆE NIŠTA SPOLJA ----
//
// Nadzor kuca svake sekunde. Šta god se u njemu pokrene kao poseban proces,
// pokreće se 3600 puta na sat na svakom računaru.
const nadzor = telo(main, "function startWatchdog() {");
proveri("nadzor postoji", nadzor.length > 200, "nije nađen startWatchdog");
proveri("nadzor ne popisuje procese", !/presretni|popisProcesa|pokreniStrazu|powershell/i.test(nadzor),
  "popis procesa u nadzoru je bio trzaj na svake četiri sekunde");

// ---- 2) STRAŽA ŽIVI KOLIKO I SESIJA ----
const prijava = main.slice(main.indexOf('msg.t === "login_ok"'), main.indexOf('msg.t === "login_ok"') + 900);
proveri("straža se diže pri prijavi", /pokreniStrazuSesije\(\)/.test(prijava));
// Prvo ide vraćanje miša i zvuka (vidi test-igracka-podesavanja); straža odmah
// posle, pre gašenja igara. Ona svoje greške hvata sama, pa ne može da preseče
// ono što sledi.
const krajSesije = telo(main, "function zavrsiSesiju() {");
proveri("i gasi na kraju sesije, pre gašenja igara",
  krajSesije.indexOf("zaustaviStrazu()") > 0 && krajSesije.indexOf("zaustaviStrazu()") < krajSesije.indexOf("killAllGames()"));
const gasenje = main.slice(main.indexOf('app.on("will-quit"'), main.indexOf('app.on("will-quit"') + 400);
proveri("i kad se launcher gasi", /zaustaviStrazu\(\)/.test(gasenje));
proveri("jedna po sesiji, ne nova na svaku prijavu", /if \(NO_LOCK \|\| straza \|\|/.test(main));
proveri("launcher stvarno koristi stražu", /pokreniStrazu\(\{/.test(main));

// ---- 3) SVAKA SPOLJNA KOMANDA IMA ROK, I NE IDE KROZ cmd.exe ----
const golExec = (izvor) => (izvor.match(/(^|[^.\w])exec\(/gm) || []).length;
for (const [ime, izvor] of [["main.js", main], ["procesi.js", proc], ["ciscenje.js", cisc]]) {
  proveri(`${ime}: nijedna komanda kroz cmd.exe`, golExec(izvor) === 0,
    `${golExec(izvor)} poziva exec( - rok gasi cmd, a zaglavljen program ispod njega ostaje`);
}
const bezRoka = (izvor) => [...izvor.matchAll(/execFile\(/g)]
  .filter((x) => !/timeout/.test(izvor.slice(x.index, x.index + 400))).length;
for (const [ime, izvor] of [["main.js", main], ["procesi.js", proc], ["ciscenje.js", cisc], ["windows-podesavanja.js", podes]]) {
  proveri(`${ime}: svaki execFile ima rok`, bezRoka(izvor) === 0, `${bezRoka(izvor)} bez roka`);
}
proveri("neuspela provera igre znači da igra RADI", /cb\(err \? true :/.test(main),
  "obrnut odgovor šalje launcher preko žive igre - a to je menjalo rezoluciju");
proveri("provere igre se ne preklapaju", /if \(proveraIgreUToku\) return;/.test(main));

// ---- 4) TEMPERATURA ----
const temp = telo(main, "function cpuTemp() {");
proveri("temperatura odustaje posle neuspeha", /neuspeha >= 3/.test(temp),
  "na nalogu bez administratora upit nikad ne uspe - a ponavljao se ceo dan");
proveri("dok igra radi, temperatura se ne pita", /gameActive\(\)/.test(temp));

// ---- 5) SKRIPTA STRAŽE ----
const sk = procesi.skriptaStraze(4242, 3000);
proveri("skripta nema dvostrukih navodnika", !sk.includes('"'),
  "ide kao argument za -Command, a PowerShell 5.1 ih tamo tumači nedosledno");
proveri("radi na sniženom prioritetu", /BelowNormal/.test(sk));
proveri("piše UTF-8", /UTF8Encoding/.test(sk), "inače putanja naloga sa ć ili đ stigne izmenjena");
proveri("gasi se sama kad launchera nema", /\$roditelj = 4242/.test(sk) && /ProcessName -ne \$imeRoditelja/.test(sk));
proveri("javlja samo procese koje nije video", /ContainsKey\(\$k\)/.test(sk));
proveri("ne pita WMI", !/Get-CimInstance|Get-WmiObject/.test(sk));
proveri("javlja znak života", /WriteLine\('ZIV'\)/.test(sk));

// ---- 6) PONAŠANJE STRAŽE (bez Windows-a) ----
function laznoDete() {
  const d = new EventEmitter();
  d.pid = 10000 + Math.floor(Math.random() * 50000);
  d.stdout = new EventEmitter();
  d.stdout.setEncoding = () => {};
  d.ubijeno = false;
  d.kill = () => { d.ubijeno = true; setImmediate(() => d.emit("exit", 1)); };
  d.pisi = (t) => d.stdout.emit("data", t);
  return d;
}
const B = String.fromCharCode(92);
const put = (...d) => d.join(B);
// Nalog sa č/ć u imenu, namerno.
const ENV = { USERPROFILE: put("C:", "Users", "Petrović"), TEMP: put("C:", "Users", "Petrović", "AppData", "Local", "Temp") };
const red = (pid, ime, putanja) => JSON.stringify({ pid, ime, putanja }) + "\n";

function napravi(opcije = {}) {
  const t = { deca: [], gasenja: [], obavesteni: [], logovi: [], kvarovi: [] };
  t.straza = procesi.pokreniStrazu({
    env: ENV, razmakMs: 1000, pauzaPosleSmrti: 30, pauzaPokusaja: 10,
    obavesti: (ime) => t.obavesteni.push(ime),
    log: (x) => t.logovi.push(x),
    kvar: (x) => t.kvarovi.push(x),
    _spawn: () => { const d = laznoDete(); t.deca.push(d); return d; },
    _ugasi: (pid, cb) => { t.gasenja.push(pid); setImmediate(() => cb(opcije.gasenjePada ? new Error("odbijeno") : null)); },
    ...opcije,
  });
  return t;
}

{
  const t = napravi();
  const d = t.deca[0];
  proveri("pri pokretanju diže TAČNO jedan pomoćni proces", t.deca.length === 1, `${t.deca.length}`);
  d.pisi(red(501, "skinuto", put("C:", "Users", "Petrović", "Downloads", "skinuto.exe")));
  d.pisi(red(502, "cs2", put("C:", "Games", "CS2", "cs2.exe")));
  d.pisi(red(503, "svchost", put("C:", "Windows", "System32", "svchost.exe")));
  d.pisi(red(504, "explorer", put("C:", "Users", "Petrović", "Desktop", "explorer.exe")));
  d.pisi(red(505, "setup", put("C:", "Users", "Petrović", "AppData", "Local", "Temp", "crit-install", "setup.exe")));
  d.pisi(red(506, "bezputanje", null));
  await cekaj(60);
  proveri("gasi program iz Preuzimanja (nalog sa ć u imenu)", t.gasenja.includes(501), JSON.stringify(t.gasenja));
  proveri("ne dira instaliranu igru", !t.gasenja.includes(502));
  proveri("ne dira Windows", !t.gasenja.includes(503));
  proveri("ne dira zaštićena imena (ime bez .exe se dopuni)", !t.gasenja.includes(504));
  proveri("ne dira našu daljinsku instalaciju", !t.gasenja.includes(505));
  proveri("ne dira proces bez putanje", !t.gasenja.includes(506));
  proveri("igrač saznaje šta je ugašeno", t.obavesteni.includes("skinuto.exe"), JSON.stringify(t.obavesteni));

  // Isti proces dva puta u istom komadu, pre nego što je gašenje odgovorilo.
  const dvaput = red(507, "drugi", put("C:", "Users", "Petrović", "Desktop", "drugi.exe"));
  d.pisi(dvaput + dvaput);
  await cekaj(40);
  proveri("isti PID se ne gasi dvaput", t.gasenja.filter((p) => p === 507).length === 1);

  // Red iseckan na dva komada, sa BOM-om napred.
  const ceo = red(508, "iseckan", put("C:", "Users", "Petrović", "Desktop", "iseckan.exe"));
  d.pisi("﻿" + ceo.slice(0, 17));
  d.pisi(ceo.slice(17));
  await cekaj(40);
  proveri("red koji stigne u dva komada se pročita ceo", t.gasenja.includes(508));
  t.straza.zaustavi();
}

{
  const t = napravi();
  t.deca[0].emit("exit", 1);
  await cekaj(150);
  proveri("pala straža se sama diže", t.deca.length === 2, `${t.deca.length}`);
  t.straza.zaustavi();
  proveri("zaustavljanje gasi pomoćni proces", t.deca[1].ubijeno);
  await cekaj(150);
  proveri("i posle zaustavljanja se više ne diže", t.deca.length === 2, `${t.deca.length}`);
}

{
  const t = napravi();
  for (let i = 0; i < 8; i++) { t.deca.at(-1).emit("exit", 1); await cekaj(70); }
  proveri("straža koja stalno pada ne vrti se u krug", t.deca.length === 5, `${t.deca.length} podizanja`);
  proveri("osoblje dobija JEDNU prijavu", t.kvarovi.length === 1, JSON.stringify(t.kvarovi));
  t.straza.zaustavi();
}

{
  const t = napravi({ rokTisine: 150 });
  await cekaj(700);
  proveri("straža koja ćuti se gasi", t.deca[0].ubijeno);
  proveri("i diže iznova", t.deca.length >= 2, `${t.deca.length}`);
  t.straza.zaustavi();
}

{
  const t = napravi({ rokTisine: 150 });
  const kuc = setInterval(() => t.deca.at(-1)?.pisi("ZIV\n"), 40);
  await cekaj(700);
  clearInterval(kuc);
  proveri("straža koja javlja znak života se ne dira", t.deca.length === 1 && !t.deca[0].ubijeno,
    `${t.deca.length} podizanja`);
  t.straza.zaustavi();
}

{
  const t = napravi({ suvo: true });
  t.deca[0].pisi(red(701, "x", put("C:", "Users", "Petrović", "Downloads", "x.exe")));
  await cekaj(40);
  proveri("probni rad ništa ne gasi", t.gasenja.length === 0);
  proveri("ali kaže šta bi ugasio", t.logovi.some((l) => /PROBNI RAD/.test(l) && l.includes("x.exe")));
  t.straza.zaustavi();
}

{
  const t = napravi({ gasenjePada: true });
  t.deca[0].pisi(red(801, "y", put("C:", "Users", "Petrović", "Downloads", "y.exe")));
  await cekaj(200);
  proveri("odbijeno gašenje se pokuša još dva puta", t.gasenja.filter((p) => p === 801).length === 3,
    `${t.gasenja.filter((p) => p === 801).length} pokušaja`);
  proveri("igraču se ne javlja da je ugašeno nešto što nije", !t.obavesteni.includes("y.exe"));
  t.straza.zaustavi();
}

// ---- 7) ZASTOR ----
proveri("animacija zastora stoji dok je iza igre",
  /animation-play-state:\s*paused/.test(zastor) && /hasFocus\(\)/.test(zastor));
proveri("zastor nema staru crvenu", !/255,\s*43,\s*43/.test(zastor));
proveri("zastor je boje launchera, i stranica i prozor", /#070c1c/i.test(zastor) && /backgroundColor: "#070c1c"/.test(main));

await kraj();
