import { radniFolder, podigniServer, citajIzvor } from "./_okruzenje.mjs";
// DALJINSKI TASK MANAGER I BIBLIOTEKA INSTALACIJA
//
// "Task Manager" iz panela je otvarao Task Manager NA racunaru igraca: radnik
// bi morao da ustane i ode do te masine, a igrac bi u medjuvremenu imao Task
// Manager pred sobom. Sada radnik sa glavnog racunara vidi sta radi na
// izabranoj masini i gasi zaglavljen program odatle.
//
// Ceo tok kroz pravi launcher (PowerShell popis, taskkill, WebSocket) proverava
// zaseban alat, jer trazi Electron:
//   node proba-procesa.mjs
const BASE = "http://127.0.0.1:8155";
const DATA = radniFolder("dalj-procesi-data");
await podigniServer(DATA, 8155);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const panel = citajIzvor("server/public/js/app.js");
const svc = citajIzvor("server/src/service.js");
const rute = citajIzvor("server/src/routes.js");
const main = citajIzvor("client/main.js");
const proc = citajIzvor("client/procesi.js");

// ---- 1) staro ponasanje je uklonjeno ----
proveri("panel vise ne salje komandu taskmgr", !panel.includes('data-d="taskmgr"'));
proveri("server vise ne prima komandu taskmgr", !/POWER_CMDS = \[[^\]]*"taskmgr"/.test(svc));
proveri("launcher vise ne otvara Task Manager igracu", !/case "taskmgr":/.test(main));

// ---- 2) rute za daljinski prikaz ----
proveri("ruta za spisak procesa postoji", /computers\/:id\/procesi"/.test(rute));
proveri("ruta za gasenje procesa postoji", /computers\/:id\/procesi\/:pid\/ugasi"/.test(rute));
await api("/api/computers/bulk", "POST", { count: 1, prefix: "PC-" });
const pc = (await api("/api/computers"))[0];
const r1 = await api(`/api/computers/${pc.id}/procesi`);
proveri("racunar bez veze javlja jasnu poruku", /nije povezan/i.test(r1.error || ""), JSON.stringify(r1).slice(0, 120));
const r2 = await api(`/api/computers/${pc.id}/procesi/999/ugasi`, "POST");
proveri("ni gasenje ne visi kad racunara nema", /nije povezan/i.test(r2.error || ""), JSON.stringify(r2).slice(0, 120));

// ---- 3) spajanje pitanja i odgovora ----
// Panel pita preko HTTP-a, racunar odgovara preko WebSocket-a. Bez broja
// zahteva odgovor ne bi znao kome pripada; bez roka bi panel visio zauvek kad
// se racunar ugasi bas dok je pitan.
proveri("svaki zahtev ima svoj broj", /const zahtev = \+\+brojZahteva/.test(svc));
proveri("odgovor se vraca onom ko je pitao", /function odgovorNaZahtev/.test(svc));
proveri("cekanje ima rok", /cekajMs = 8000/.test(svc) && /Računar se ne javlja/.test(svc));
proveri("zakasneo odgovor se odbacuje", /if \(!z\) return;/.test(svc));
proveri("launcher odgovara na oba pitanja",
  /msg\.t === "procesi_trazi"/.test(main) && /msg\.t === "procesi_ugasi"/.test(main));

// ---- 4) sistemski programi se ne gase ----
proveri("popis oznacava sistemske", /zasticen: zasticen\(p, null\)/.test(proc));
proveri("gasenje ponovo proverava pre nego sto ubije", /if \(zasticen\(p, null\)\) return res\(\{ ok: false/.test(proc),
  "spisak koji radnik gleda moze da bude star, a PID se u medjuvremenu dodeli drugom programu");
proveri("panel ne nudi dugme za sistemske", /p\.zasticen\s*\?\s*'<span class="pill faint"/.test(panel));
proveri("neispravan PID se odbija", /Number\.isInteger\(broj\) \|\| broj <= 0/.test(proc));

// ---- 5) upotrebljivost ----
proveri("spisak je poredjan po memoriji", /sort\(\(a, b\) => b\.memorija - a\.memorija\)/.test(proc));
proveri("memorija se prijavljuje", /WorkingSetSize/.test(proc));
proveri("sistemski su podrazumevano sakriveni", /let sviProcesi = false/.test(panel),
  "dve trecine spiska su sistemski procesi koji se ionako ne gase - samo smetaju");
proveri("moze da se prikaze sve", /#prSvi/.test(panel));
proveri("gasenje trazi potvrdu", /Nesačuvan rad se gubi/.test(panel));
proveri("gasenje se belezi ko je i sta ugasio", /action: "proces_ugasen"/.test(svc));

// ---- 6) biblioteka instalacija nije prazna ----
// Strana je bila prazna, pa je vlasnik morao sam da trazi linkove i tihe
// argumente. Mrtav link je gori od prazne strane: radnik klikne "Instaliraj" i
// dobije gresku nasred smene - zato je svaki link proveren da vraca instalaciju.
const programi = await api("/api/programs");
proveri("biblioteka nije prazna", Array.isArray(programi) && programi.length >= 5, `${programi.length} programa`);
for (const ime of ["Steam", "Discord", "Google Chrome", "Epic Games Launcher"]) {
  proveri(`u biblioteci ima: ${ime}`, programi.some((p) => p.name === ime));
}
proveri("svaki program ima link", programi.every((p) => /^https:\/\//.test(p.url)));
proveri("linkovi idu preko HTTPS-a", programi.every((p) => p.url.startsWith("https://")));
proveri("tihi argumenti su upisani gde postoje",
  programi.filter((p) => p.args && p.args.trim()).length >= 5,
  JSON.stringify(programi.map((p) => `${p.name}:${p.args}`)));
const bnet = programi.find((p) => p.name === "Battle.net");
proveri("program bez tihe instalacije je oznacen", /PAŽNJA/.test(bnet?.note || ""),
  "inace radnik ocekuje da prodje samo, a na racunaru igraca se otvori prozor");
proveri("MSI paket ima /qn", programi.find((p) => p.url.endsWith(".msi"))?.args === "/qn");
proveri("klijent zna da pokrene MSI kroz msiexec", /cmd = "msiexec"; cargs = \["\/i", dest/.test(main));

console.log(`\n${prosao}/${prosao + pao} proslo`);
// Kratka pauza pre izlaza: server radi u istom procesu i ima svoje tajmere i
// otvorene veze. Bez ovoga se process.exit poklopi sa zatvaranjem jedne od njih
// i libuv pukne na izlazu - suita bi bila oznacena kao pala iako je sve proslo.
await new Promise((r) => setTimeout(r, 400));
process.exit(pao ? 1 : 0);
