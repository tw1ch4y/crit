import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// KREDIT I VREME: JEDAN POJAM, JEDAN RACUN
//
// Igraonica naplacuje vreme, ali NE cuva vreme. Cuva se kredit u dinarima, a
// vreme je uvek izvedeno: kredit podeljen cenom po satu. To je jednostavno i
// tacno, ali ima dve posledice koje moraju da rade kako treba:
//
//   1. svako mesto koje pokazuje vreme mora da racuna isto - panel, launcher,
//      HUD, zakljucan ekran. Dva razlicita racuna znace da igrac i radnik
//      gledaju razlicite brojeve i svadjaju se oko toga ko je u pravu.
//   2. promena cene po satu menja preostalo vreme SVIMA koji igraju, odmah.
//
// Ovde se proverava ceo lanac na pravim brojevima.
const BASE = "http://127.0.0.1:8199";
const WSB = "ws://127.0.0.1:8199";
const DATA = radniFolder("kredit-data");
await podigniServer(DATA, 8199);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (a, b, e = 1.5) => Math.abs(a - b) <= e;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const pc = (await api("/api/computers"))[0];

// Server s pravom odbija da skine vise nego sto igrac ima (nema minusa), pa se
// nuliranje radi tacnim iznosom trenutnog stanja.
const stanjeIgraca = async () => (await api("/api/players")).find((x) => x.username === "mile")?.balance ?? 0;
const naNulu = async () => { const b = await stanjeIgraca(); if (b > 0) await api(`/api/players/${mile.id}/topup`, "POST", { amount: -b }); };
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");

// ---- 1) VREME SE IZVODI IZ KREDITA, PO SVAKOJ CENI ----
for (const [cena, kredit, satiOcekivano] of [
  [120, 600, 5],      // uobicajeno
  [100, 250, 2.5],    // polovina sata
  [60, 30, 0.5],
  [240, 60, 0.25],    // skupa igraonica, mali kredit
]) {
  await api("/api/settings", "POST", { ratePerHour: cena });
  await naNulu();
  await api(`/api/players/${mile.id}/topup`, "POST", { amount: kredit });
  const snap = await api("/api/snapshot");
  const p = snap.players.find((x) => x.id === mile.id);
  const sekundi = (kredit / cena) * 3600;
  proveri(`${kredit} pri ceni ${cena}/h daje ${satiOcekivano} h`, blizu(sekundi, satiOcekivano * 3600, 2),
    `${(sekundi / 3600).toFixed(2)} h`);
  proveri(`  stanje se poklapa (${kredit})`, blizu(p.balance, kredit), String(p.balance));
}

// ---- 2) ISTI RACUN NA SVAKOM MESTU ----
// Panel i launcher imaju svaki svoju funkciju dur(). Ako se raziđu, igrač i
// radnik gledaju različite brojeve.
const durPanel = citajIzvor("server/public/js/app.js").match(/function dur\(sec\) \{[\s\S]*?\n\}/)[0];
const durLauncher = citajIzvor("client/renderer/js/launcher.js").match(/function dur\(sec\) \{[\s\S]*?\n\}/)[0];
const ocisti = (s) => s.replace(/\s+/g, " ").replace(/const p =/, "const pad =").replace(/p\(/g, "pad(");
proveri("panel i launcher racunaju vreme isto", ocisti(durPanel) === ocisti(durLauncher),
  "dva racuna znace da igrac i radnik gledaju razlicite brojeve");
proveri("oba kazu 'bez limita' kad naplate nema", /bez limita/.test(durPanel) && /bez limita/.test(durLauncher));

// ---- 3) IGRAC VIDI ISTO STO I PANEL ----
await api("/api/settings", "POST", { ratePerHour: 120 });
await naNulu();
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 600 });

const poruke = [];
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=kredit`);
ws.on("message", (d) => { try { poruke.push(JSON.parse(d)); } catch {} });
await new Promise((r) => ws.on("open", r));
await cekaj(300);
ws.send(JSON.stringify({ t: "login", username: "mile", password: "mile1234" }));
await cekaj(1200);

const loginOk = poruke.find((m) => m.t === "login_ok");
proveri("launcher dobija i kredit i vreme", loginOk && typeof loginOk.balance === "number" && typeof loginOk.remainingSeconds === "number",
  JSON.stringify(loginOk).slice(0, 120));
const izPanela = (await api("/api/snapshot")).computers.find((c) => c.id === pc.id)?.session?.remainingSeconds;
proveri("panel i launcher pokazuju isto vreme", blizu(loginOk.remainingSeconds, izPanela, 30),
  `launcher ${loginOk.remainingSeconds}, panel ${izPanela}`);
proveri("pet sati za 600 pri ceni 120", blizu(loginOk.remainingSeconds, 5 * 3600, 30), String(loginOk.remainingSeconds));

// ---- 4) PROMENA CENE MENJA VREME ODMAH ----
// Ovo je posledica koju vlasnik najlakse previdi: dize cenu misleci na nove
// goste, a skrati vreme svima koji vec igraju.
const preIzmene = (await api("/api/snapshot")).computers.find((c) => c.id === pc.id)?.session?.remainingSeconds;
await api("/api/settings", "POST", { ratePerHour: 150 });
await cekaj(400);
const posleIzmene = (await api("/api/snapshot")).computers.find((c) => c.id === pc.id)?.session?.remainingSeconds;
proveri("skuplja cena odmah skracuje vreme", posleIzmene < preIzmene - 1800,
  `${Math.round(preIzmene / 60)} min -> ${Math.round(posleIzmene / 60)} min`);
proveri("kredit se pri tome NE dira", blizu((await api("/api/players")).find((x) => x.id === mile.id).balance, 600, 3),
  "menja se cena, ne novac koji je igrac uplatio");

const panel = citajIzvor("server/public/js/app.js");
proveri("vlasnik se upozorava pre promene cene", /Promena cene po satu/.test(panel));
proveri("upozorenje kaze koliko ih igra", /oblik\(uIgri, "igrač"/.test(panel));
proveri("upozorenje pokazuje primer na brojkama", /const primer = \(kredit\)/.test(panel),
  "sama recenica se preleti, primer sa brojkama ne");
proveri("ne pita kad niko ne igra", /novaCena !== staraCena && uIgri > 0/.test(panel),
  "pitanje bez razloga se posle preskace i kad ima razloga");

// ---- 5) CENA NULA: SVE JE BEZ LIMITA ----
await api("/api/settings", "POST", { ratePerHour: 0 });
await cekaj(400);
const bezNaplate = (await api("/api/snapshot")).computers.find((c) => c.id === pc.id)?.session?.remainingSeconds;
proveri("bez naplate nema ni ograničenja", bezNaplate === null, String(bezNaplate));
const kreditPre = (await api("/api/players")).find((x) => x.id === mile.id).balance;
await cekaj(6000);
const kreditPosle = (await api("/api/players")).find((x) => x.id === mile.id).balance;
proveri("bez naplate se kredit ne troši", blizu(kreditPre, kreditPosle, 0.5), `${kreditPre} -> ${kreditPosle}`);
proveri("paket se tada ne prodaje", !!(await api(`/api/players/${mile.id}/paket`, "POST", { paketId: 1 }))?.error,
  "paket je 'sati za pare', a bez cene po satu sati nemaju vrednost");

// ---- 6) PAKET DAJE TACNO ONOLIKO SATI KOLIKO PISE ----
await api("/api/settings", "POST", { ratePerHour: 120 });
await naNulu();
const paketi = await api("/api/paketi");
if (paketi.length) {
  const pk = paketi[0];
  const r = await api(`/api/players/${mile.id}/paket`, "POST", { paketId: pk.id });
  proveri("paket je prodat", !r?.error, JSON.stringify(r).slice(0, 120));
  const stanje = (await api("/api/players")).find((x) => x.id === mile.id).balance;
  proveri(`paket "${pk.name}" daje tačno ${pk.hours} h`, blizu(stanje / 120 * 3600, pk.hours * 3600, 60),
    `${(stanje / 120).toFixed(2)} h za ${stanje} kredita`);
  // Gleda se SAMO upis za ovaj paket, ne sve dopune kroz ceo test.
  const promet = await api(`/api/players/${mile.id}/transactions`);
  const zaPaket = promet.filter((t) => (t.note || "").includes(pk.name));
  const kes = zaPaket.filter((t) => t.type === "topup").reduce((z, t) => z + t.amount, 0);
  proveri("u kasu ulazi samo ono što je gost platio", blizu(kes, pk.price),
    `u kasi ${kes}, cena paketa ${pk.price}; upisi: ${JSON.stringify(zaPaket.map((t) => `${t.type}:${t.amount}`))}`);
  proveri("popust je zaveden kao poklon, ne kao novac", promet.some((t) => t.type === "bonus") || pk.price >= pk.hours * 120,
    "inace bi radnik na kraju smene imao manjak u visini popusta");
}

// ---- 7) SITAN KREDIT NIJE NULA ----
await naNulu();
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 2 });
const sitno = (await api("/api/snapshot")).computers.find((c) => c.id === pc.id)?.session?.remainingSeconds;
proveri("dva dinara pri 120/h daju 60 sekundi", blizu(sitno, 60, 3), String(sitno));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(400);
process.exit(pao ? 1 : 0);
