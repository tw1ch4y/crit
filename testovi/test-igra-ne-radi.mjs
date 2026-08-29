import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Igra koja nece da se pokrene mora da stigne do vlasnika.
//
// Povod: launcher javi igracu "nije instalirana", igrac slegne ramenima i
// pokrene nesto drugo. Vlasnik sazna tek ako se neko poduzi da mu kaze - a
// najcesci uzrok je precica koja bas na tom racunaru fali ili se drugacije
// zove. U bazi koja ide u igraonicu vec stoje putanje kao "C:\games\aplex".
const BASE = "http://127.0.0.1:8127", WSB = "ws://127.0.0.1:8127";
await podigniServer(radniFolder("igra-ne-radi-data"), 8127);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p) => fetch(BASE + p, { headers: { authorization: "Bearer " + token } }).then((r) => r.json());

const pc = (await api("/api/computers"))[0];

// Panel slusa - isto kao kad je vlasnik otvoren na kontrolnoj tabli.
const panel = new WebSocket(`${WSB}/ws?kind=panel&token=${encodeURIComponent(token)}`);
const izPanela = [];
panel.on("message", (b) => { try { izPanela.push(JSON.parse(b.toString())); } catch {} });
await new Promise((r) => panel.once("open", r));

const klijent = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(pc.token)}&v=2.22.0`);
await new Promise((r) => klijent.once("open", r));
await cekaj(300);

const logovi = async () => (await api("/api/logs?page=1&per=30&category=igre&search=")).items || [];

// ---- putanja ne postoji ----
klijent.send(JSON.stringify({ t: "igra_ne_radi", igra: "APEX", razlog: "nema" }));
await cekaj(400);
let l = await logovi();
const zapis = l.find((x) => (x.detail || "").includes("APEX"));
proveri("kvar se upisuje u logove", !!zapis, JSON.stringify(l.slice(0, 2)));
proveri("zapis kaze koji je racunar", zapis?.target === pc.name, JSON.stringify(zapis?.target));
proveri("zapis kaze zasto", /putanja ne postoji/.test(zapis?.detail || ""), JSON.stringify(zapis?.detail));
proveri("zapis ide u kategoriju Igre", zapis?.category === "igre", JSON.stringify(zapis?.category));
proveri("panel je odmah obavesten",
  izPanela.some((m) => m.t === "event" && m.kind === "igra-ne-radi" && /APEX/.test(m.text || "")),
  JSON.stringify(izPanela.filter((m) => m.t === "event").slice(-2)));

// ---- isti kvar se ne ponavlja u logovima ----
// Igrac pritisne pet puta zaredom; logovi ne treba da dobiju pet istih redova.
for (let i = 0; i < 5; i++) klijent.send(JSON.stringify({ t: "igra_ne_radi", igra: "APEX", razlog: "nema" }));
await cekaj(500);
const koliko = (await logovi()).filter((x) => (x.detail || "").includes("APEX")).length;
proveri("uzastopni pokusaji ne trpaju logove", koliko === 1, `zapisa: ${koliko}`);

// ---- druga igra prolazi odmah ----
klijent.send(JSON.stringify({ t: "igra_ne_radi", igra: "Roblox", razlog: "folder" }));
await cekaj(400);
const rob = (await logovi()).find((x) => (x.detail || "").includes("Roblox"));
proveri("druga igra se javlja odmah", !!rob);
proveri("razlog 'folder' ima svoje objasnjenje", /folder umesto/.test(rob?.detail || ""), JSON.stringify(rob?.detail));

// ---- smece ne obara server ----
for (const m of [
  { t: "igra_ne_radi" },
  { t: "igra_ne_radi", igra: "" },
  { t: "igra_ne_radi", igra: "   " },
  { t: "igra_ne_radi", igra: {}, razlog: [] },
  { t: "igra_ne_radi", igra: "x".repeat(500), razlog: "nepoznat razlog" },
]) klijent.send(JSON.stringify(m));
await cekaj(500);
proveri("smece ne obara server", Array.isArray(await api("/api/computers")));
const dugacak = (await logovi()).find((x) => /x{50}/.test(x.detail || ""));
proveri("predugacko ime se odseca", !dugacak || (dugacak.detail.match(/x+/)?.[0].length ?? 0) <= 80,
  String(dugacak?.detail?.match(/x+/)?.[0].length));
proveri("prazno ime se ne upisuje", !(await logovi()).some((x) => /„" nije htela/.test(x.detail || "")));

klijent.close(); panel.close();

// ---- izvor ----
const main = citajIzvor("client/main.js");
const app = citajIzvor("server/public/js/app.js");
proveri("launcher javlja kad putanje nema", main.includes('javiDaNeRadi(name || path.basename(gamePath), "nema")'));
proveri("launcher javlja kad je upisan folder", main.includes('javiDaNeRadi(name || path.basename(gamePath), "folder")'));
proveri("launcher javlja kad Windows odbije", main.includes('javiDaNeRadi(entry.name, "greska")'));
proveri("panel prikazuje obavestenje", app.includes('m.kind === "igra-ne-radi"'));
proveri("logovi imaju ikonu za igre", app.includes('igre: "igre"'));
// Bez posebnog izgleda red "igra nije htela da se pokrene" izgleda isto kao
// "pokrenuta igra" i izgubi se u spisku - a to je bas red zbog kog se logovi
// i otvaraju.
const css = citajIzvor("server/public/css/style.css").replace(/\s+/g, " ");
proveri("kvar se u logovima razlikuje od obicnog zapisa", app.includes('/_fail$/.test(l.action'));
proveri("kvar ima crvenu ikonu i crtu", /\.log-row\.kvar \.log-ic \{[^}]*var\(--danger\)/.test(css)
  && /\.log-row\.kvar \{[^}]*inset 3px 0 0 var\(--danger\)/.test(css));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
