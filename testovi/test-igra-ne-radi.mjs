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

// ---- KVAR OSTAJE UZ SAMU STAVKU ----
//
// Log i poruka preko ekrana vide se samo ako vlasnik bas tada gleda u panel.
// A najcesci uzrok je precica koja fali na JEDNOJ masini od trinaest: gost
// slegne ramenima, niko ne prijavi, i tako mesecima. Zato poslednji neuspeh
// stoji na samom redu - vlasnik otvori Igre i vidi koja, gde i zasto.
const post = (put, telo) => fetch(BASE + put, { method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: JSON.stringify(telo) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const put_ = (p2, telo) => fetch(BASE + p2, { method: "PUT",
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: JSON.stringify(telo) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const igra = (await post("/api/games", { name: "Proba kvara", path: "C:/igre/proba.exe" })).body;
const nadji = async () => (await api("/api/games")).find((x) => x.id === igra.id);
proveri("nova igra nema oznaku kvara", !(await nadji()).kvar_kad);

klijent.send(JSON.stringify({ t: "igra_ne_radi", igra: "Proba kvara", razlog: "folder", id: igra.id, vrsta: "igra" }));
await cekaj(400);
const saKvarom = await nadji();
proveri("KVAR OSTAJE ZAPISAN UZ IGRU", !!saKvarom.kvar_kad, JSON.stringify(saKvarom.kvar_razlog));
proveri("i pise ZASTO", saKvarom.kvar_razlog === "folder", String(saKvarom.kvar_razlog));
proveri("i NA KOM racunaru", saKvarom.kvar_gde === pc.name, String(saKvarom.kvar_gde));

// Prigusenje cuva logove od pet istih redova, ali oznaka na stavci je STANJE,
// ne dogadjaj: drugi racunar u istom minutu mora da je osvezi.
const comps = await api("/api/computers");
if (comps[1]) {
  const k2 = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[1].token)}`);
  await new Promise((r) => k2.once("open", r));
  await cekaj(200);
  k2.send(JSON.stringify({ t: "igra_ne_radi", igra: "Proba kvara", razlog: "nema", id: igra.id, vrsta: "igra" }));
  await cekaj(400);
  const drugi = await nadji();
  proveri("drugi racunar osvezava oznaku i u istom minutu", drugi.kvar_gde === comps[1].name,
    `${drugi.kvar_gde} (ocekivano ${comps[1].name})`);
  proveri("i razlog se menja na noviji", drugi.kvar_razlog === "nema", String(drugi.kvar_razlog));
  k2.close();
}

// Uspelo pokretanje brise oznaku. Oznaka koja stoji i posle popravke je gora od
// nikakve - nauci se da se ignorise, pa se preskoci i kad je istinita.
klijent.send(JSON.stringify({ t: "game_start", gameId: igra.id }));
await cekaj(400);
proveri("USPELO POKRETANJE BRISE OZNAKU", !(await nadji()).kvar_kad,
  "inace bi stajala zauvek i vlasnik bi je naucio da preskace");

// Promenjena putanja takodje: vlasnik je upravo pokusao da popravi.
klijent.send(JSON.stringify({ t: "igra_ne_radi", igra: "Proba kvara", razlog: "nema", id: igra.id, vrsta: "igra" }));
await cekaj(400);
proveri("oznaka se vratila", !!(await nadji()).kvar_kad);
await put_(`/api/games/${igra.id}`, { name: "Proba kvara", path: "C:/igre/drugo.exe" });
proveri("promena putanje brise oznaku", !(await nadji()).kvar_kad);

klijent.send(JSON.stringify({ t: "igra_ne_radi", igra: "Proba kvara", razlog: "nema", id: igra.id, vrsta: "igra" }));
await cekaj(400);
await put_(`/api/games/${igra.id}`, { name: "Drugo ime", path: "C:/igre/drugo.exe" });
proveri("promena SAMO naziva ne brise oznaku", !!(await nadji()).kvar_kad,
  "kvar i dalje vazi - putanja je ista");

// Isto vazi i za precice (Steam, Epic...), a bas one su glavni put do igara.
const alat = (await post("/api/tools", { name: "Proba alat", kind: "app", target: "C:/alati/proba.exe" })).body;
klijent.send(JSON.stringify({ t: "igra_ne_radi", igra: "Proba alat", razlog: "folder", id: alat.id, vrsta: "alat" }));
await cekaj(400);
const alatSad = (await api("/api/tools")).find((x) => x.id === alat.id);
proveri("precica takodje nosi svoj kvar", alatSad?.kvar_razlog === "folder", JSON.stringify(alatSad?.kvar_razlog));

// Nepoznata vrsta ne sme da pise ni u jednu tabelu.
klijent.send(JSON.stringify({ t: "igra_ne_radi", igra: "X", razlog: "nema", id: igra.id, vrsta: "shop_items" }));
await cekaj(300);
proveri("nepoznata vrsta pada na igre, ne na tudju tabelu",
  Array.isArray(await api("/api/shop")), "ime tabele ne sme da ulazi u upit spolja");

klijent.close(); panel.close();

// ---- izvor ----
const main = citajIzvor("client/main.js");
const app = citajIzvor("server/public/js/app.js");
proveri("launcher javlja kad putanje nema", main.includes('javiDaNeRadi(name || path.basename(gamePath), "nema", id, vrsta)'));
proveri("launcher javlja kad je upisan folder", main.includes('javiDaNeRadi(name || path.basename(gamePath), "folder", id, vrsta)'));
proveri("launcher javlja kad Windows odbije", main.includes('javiDaNeRadi(entry.name, "greska", id, vrsta)'));
// Uz poruku ide i KOJA je stavka - bez toga se ona trazi po imenu, a ime se menja.
proveri("poruka nosi id i vrstu stavke",
  /wsSend\(\{ t: "igra_ne_radi",[^}]*razlog, id, vrsta \}\)/.test(main));
proveri("igra salje svoju vrstu", citajIzvor("client/renderer/js/launcher.js").includes('{ ...g, vrsta: "igra" }'));
proveri("precica salje svoju", citajIzvor("client/renderer/js/launcher.js").includes('id: t.id, vrsta: "alat"'));
proveri("panel prikazuje obavestenje", app.includes('m.kind === "igra-ne-radi"'));
proveri("logovi imaju ikonu za igre", app.includes('igre: "igre"'));
// Bez posebnog izgleda red "igra nije htela da se pokrene" izgleda isto kao
// "pokrenuta igra" i izgubi se u spisku - a to je bas red zbog kog se logovi
// i otvaraju.
const css = citajIzvor("server/public/css/style.css").replace(/\s+/g, " ");
proveri("kvar se u logovima razlikuje od obicnog zapisa", app.includes('/_fail$/.test(l.action'));
proveri("kvar ima crvenu ikonu i crtu", /\.log-row\.kvar \.log-ic \{[^}]*var\(--danger\)/.test(css)
  && /\.log-row\.kvar \{[^}]*inset 3px 0 0 var\(--danger\)/.test(css));

// Oznaka mora da se VIDI u panelu, i to sa sve tri stvari: sta je bilo, na kom
// racunaru i kada. Bez imena racunara vlasnik ne zna gde da ode, a bez vremena
// ne zna da li je staro i odavno popravljeno.
proveri("panel crta oznaku uz igru i uz precicu",
  (app.match(/\$\{kvarHtml\(/g) || []).length === 2 && app.includes("function kvarHtml("));
proveri("oznaka kaze na kom je racunaru", /Nije se pokrenulo\$\{gde\}/.test(app));
proveri("i kada je bilo", /kvarHtml[\s\S]{0,700}timeAgo\(r\.kvar_kad\)/.test(app));
proveri("oznaka se vidi kao kvar, ne kao upozorenje",
  /\.kvar-red \{[^}]*var\(--danger\)/.test(css), "stavka koju gost vidi u launcheru NE RADI");

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
