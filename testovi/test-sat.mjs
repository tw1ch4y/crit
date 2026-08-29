import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor, KOREN } from "./_okruzenje.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const WebSocket = await ucitajWebSocket();
// VREME I NAPLATA
// Naplata racuna razliku izmedju dva prolaza, a prolaz je na 5 sekundi. Sve
// sto pomeri sistemski sat menja tu razliku - a razlika je novac.
//
// Racunar za igre cesto ima sat u strani (prazna baterija na maticnoj), pa ga
// Windows pri pokretanju sinhronizuje i sat preskoci. Bez ogranicenja bi ta
// razlika bila naplacena kao odigrano vreme: na trinaest racunara odjednom, a
// igraci bi u istoj sekundi ostali bez kredita i niko ne bi znao zasto.
const BASE = "http://127.0.0.1:8139", WSB = "ws://127.0.0.1:8139";
const DATA = radniFolder("sat-data");
await podigniServer(DATA, 8139);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const svc = await import(pathToFileURL(path.join(KOREN, "server", "src", "service.js")).href);

// ---- 1) koliko sekundi jednog prolaza sme da se naplati ----
const G = svc.NAJVISE_PO_PROLAZU;
proveri("postoji gornja granica po prolazu", Number.isFinite(G) && G > 0, String(G));
proveri("granica je iznad normalnog prolaza (5 s)", G >= 30,
  "prekratka granica bi krala vreme kad server nakratko zastane");
proveri("granica je ipak niska da skok ne bude skup", G <= 120, String(G));

proveri("normalan prolaz se naplacuje ceo", svc.sekundeZaNaplatu(5) === 5);
proveri("kratko zastajanje servera se naplacuje ceo", svc.sekundeZaNaplatu(20) === 20);
proveri("skok sata za sat vremena se ODSECA", svc.sekundeZaNaplatu(3600) === G,
  `naplaceno ${svc.sekundeZaNaplatu(3600)} umesto 3600`);
proveri("skok od pola dana se odseca isto", svc.sekundeZaNaplatu(43200) === G);
proveri("skok unazad se ne naplacuje", svc.sekundeZaNaplatu(-3600) === 0);
// NaN i Infinity znace pokvaren sat - tada se ne naplacuje nista, ne "najvise".
proveri("besmislena vrednost se ne naplacuje",
  svc.sekundeZaNaplatu(NaN) === 0 && svc.sekundeZaNaplatu(Infinity) === 0 && svc.sekundeZaNaplatu(0) === 0,
  `NaN=${svc.sekundeZaNaplatu(NaN)} Inf=${svc.sekundeZaNaplatu(Infinity)} nula=${svc.sekundeZaNaplatu(0)}`);

// Sat od 120 din: bez ogranicenja bi skok od sat vremena skinuo ceo sat.
const cenaSata = 120;
const bezGranice = (3600 / 3600) * cenaSata;
const saGranicom = (svc.sekundeZaNaplatu(3600) / 3600) * cenaSata;
proveri("skok sata ne moze da skine ceo sat kredita", saGranicom < bezGranice / 10,
  `sa granicom ${saGranicom.toFixed(2)} din umesto ${bezGranice.toFixed(2)} din`);

// ---- 2) mehanizam u kodu ----
const src = citajIzvor("server/src/service.js");
proveri("naplata prolazi kroz ogranicenje", /const elapsed = sekundeZaNaplatu\(proteklo\)/.test(src));
proveri("skok sata se zapisuje u logove", /action: "skok_sata"/.test(src),
  "vlasnik mora negde da vidi da mu je sat pomeren, inace trazi kvar na pogresnom mestu");
proveri("poruka kaze sta da se proveri", src.includes("Proveri podešavanje vremena na glavnom računaru"));
proveri("jedan pomeren sat ne puni log", /skokJavljen/.test(src) && /60000/.test(src));
proveri("naplata i dalje preskace negativnu razliku", /proteklo <= 0\) continue/.test(src));
proveri("naplata staje kad racunar nije na vezi", /isClientOnline\(s\.computer_id\)\) \{ st\.last = now/.test(src),
  "inace bi se po povratku veze naplatilo sve unazad");

// ---- 3) uredna naplata i dalje radi (kroz pravi server) ----
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/settings", "PUT", { ratePerHour: 3600, cafeName: "Crit", currency: "RSD" }); // 1 din u sekundi
await api("/api/computers/bulk", "POST", { count: 1, prefix: "PC-" });
const pc = (await api("/api/computers"))[0];
await api("/api/players", "POST", { username: "sat", password: "sat12345", displayName: "Sat" });
const igrac = (await api("/api/players")).find((p) => p.username === "sat");
await api(`/api/players/${igrac.id}/topup`, "POST", { amount: 500, note: "test" });

const ws = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=proba`);
await new Promise((r) => ws.on("open", r));
await cekaj(300);
ws.send(JSON.stringify({ t: "login", username: "sat", password: "sat12345" }));
await cekaj(600);
const pre = (await api("/api/players")).find((p) => p.id === igrac.id).balance;
await cekaj(11000); // dva prolaza naplate
const posle = (await api("/api/players")).find((p) => p.id === igrac.id).balance;
const skinuto = pre - posle;
proveri("naplata stvarno tece", skinuto > 0, `skinuto ${skinuto}`);
proveri("skinuto je u razumnom opsegu (ne naduvano)", skinuto < 60,
  `skinuto ${skinuto} za ~11 s pri 1 din/s - vise od toga znaci da se negde racuna unazad`);

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
