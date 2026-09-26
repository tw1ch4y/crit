import { radniFolder, podigniServer, ucitajWebSocket } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Racunar kome je iscupan kabl.
//
// TCP veza posle nasilnog prekida ostaje otvorena satima. Server zato salje ping
// i gasi vezu koja ne odgovori, pa panel prikaze racunar kao nedostupan, a
// naplata stane. Klijentu se ovde zaustavi citanje sa uticnice: ping stigne, a
// odgovor nikad ne krene.
const PORT = 8187;
const BASE = `http://127.0.0.1:${PORT}`;
const WSB = `ws://127.0.0.1:${PORT}`;
const DATA = radniFolder("mrtva-veza-data");
await podigniServer(DATA, PORT);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

// Visoka cena da se naplata vidi za par sekundi.
await api("/api/settings", "POST", { ratePerHour: 3600 });   // 1 dinar u sekundi
await api("/api/players", "POST", { username: "mile", password: "mile1234", displayName: "Mile" });
const mile = (await api("/api/players")).find((p) => p.username === "mile");
await api(`/api/players/${mile.id}/topup`, "POST", { amount: 3000, note: "keš" });
const pc = (await api("/api/computers"))[0];

const ws = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=mrtva`);
await new Promise((r) => ws.on("open", r));
await cekaj(400);
ws.send(JSON.stringify({ t: "login", username: "mile", password: "mile1234" }));
await cekaj(1200);

const stanjeRacunara = async () => (await api("/api/computers")).find((c) => c.id === pc.id);
const kredit = async () => (await api("/api/players")).find((p) => p.id === mile.id).balance;

proveri("sesija je pokrenuta", (await stanjeRacunara()).status === "in_use");
proveri("racunar je na mrezi", (await stanjeRacunara()).online === true);

// ---- naplata radi dok je veza ziva ----
const k1 = await kredit();
await cekaj(6000);
const k2 = await kredit();
proveri("naplata tece dok je racunar tu", k2 < k1 - 3, `${k1} -> ${k2}`);

// ---- KABL SE CUPA ----
// Uticnica se zaustavlja: podaci stizu do masine, ali ih niko ne cita i nista
// se ne salje nazad. Veza je i dalje "otvorena" za oba kraja.
ws._socket.pause();
const kPre = await kredit();

// Server pinguje na 15 s i gasi vezu koja je propustila prethodni ping, pa
// otkrivanje traje do 30 s. Ovde se ceka do 45 s.
let primetio = false;
for (let i = 0; i < 45; i++) {
  await cekaj(1000);
  if ((await stanjeRacunara()).online === false) { primetio = true; break; }
}
proveri("server je primetio da racunara nema", primetio,
  "bez ping-a veza ostaje otvorena satima, a naplata tece za praznu stolicu");

const kPosle = await kredit();
await cekaj(6000);
const kJos = await kredit();
proveri("naplata je stala kad je veza pukla", Math.abs(kJos - kPosle) < 1,
  `${kPosle} -> ${kJos}; igrac bi platio vreme koje nije proveo`);

const naplacenoUPadu = kPre - kPosle;
proveri("naplaceno je najvise 30-ak sekundi pre otkrivanja", naplacenoUPadu < 40,
  `naplaceno ${naplacenoUPadu.toFixed(0)} din za vreme dok je server otkrivao`);

// ---- panel to i pokazuje ----
const c = await stanjeRacunara();
proveri("panel vise ne pokazuje racunar kao na mrezi", c.online === false);

// ---- kad se vrati, sve radi dalje ----
try { ws.terminate(); } catch {}
const ws2 = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=mrtva`);
await new Promise((r) => ws2.on("open", r));
await cekaj(1500);
proveri("racunar se normalno vraca na mrezu", (await stanjeRacunara()).online === true);
const kVracen = await kredit();
await cekaj(5000);
proveri("naplata se nastavlja posle povratka", (await kredit()) < kVracen - 2,
  `${kVracen} -> ${await kredit()}`);
proveri("nema nadoknadne naplate za vreme pada", (await kredit()) > kVracen - 30,
  "resetovanje vremena pri povratku cuva igraca od 'catch-up' racuna");

try { ws2.close(); } catch {}
console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(500);
process.exit(pao ? 1 : 0);
