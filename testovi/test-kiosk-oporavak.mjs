import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Kad launcher pukne, racunar u igraonici ostaje mrtav dok radnik ne primeti.
// Igrac ne prijavljuje kvar - on vidi da "racunar ne radi" i zove nekog.
// Zato launcher sam sebe vraca, a osoblje dobija zapis sa imenom racunara.
const BASE = "http://127.0.0.1:8141", WSB = "ws://127.0.0.1:8141";
const DATA = radniFolder("kiosk-data");
await podigniServer(DATA, 8141);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/computers/bulk", "POST", { count: 1, prefix: "PC-" });
const pc = (await api("/api/computers"))[0];

const logovi = async () => {
  const l = await api("/api/logs?category=sistem");
  return (Array.isArray(l) ? l : l.items || []).filter((x) => x.action === "klijent_problem");
};

// ---- launcher javlja kvar na sebi ----
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=proba`);
await new Promise((r) => ws.on("open", r));
await cekaj(300);
proveri("pre kvara nema zapisa", (await logovi()).length === 0);

ws.send(JSON.stringify({ t: "klijent_problem", vrsta: "ekran_pukao", opis: "Ekran launchera je pukao (crashed) - vraćam ga" }));
await cekaj(600);
const posle = await logovi();
proveri("kvar stize osoblju u logove", posle.length === 1, JSON.stringify(posle.map((x) => x.detail)));
proveri("zapis nosi ime racunara", posle[0]?.target === pc.name, String(posle[0]?.target));
proveri("zapis kaze sta se desilo", /pukao/i.test(posle[0]?.detail || ""), String(posle[0]?.detail));

// Pad ume da se ponovi u krug - log ne sme da se zatrpa.
for (let i = 0; i < 5; i++) {
  ws.send(JSON.stringify({ t: "klijent_problem", vrsta: "ekran_pukao", opis: "opet" }));
  await cekaj(120);
}
await cekaj(400);
proveri("ponovljeni pad ne puni log", (await logovi()).length === 1, `zapisa: ${(await logovi()).length}`);

// Druga vrsta kvara je zaseban zapis.
ws.send(JSON.stringify({ t: "klijent_problem", vrsta: "ekran_ne_reaguje", opis: "Ekran launchera ne reaguje - vraćam ga" }));
await cekaj(600);
proveri("druga vrsta kvara se belezi zasebno", (await logovi()).length === 2);

// Besmislice ne smeju nista da upisu ni da obore server.
for (const smece of [
  { t: "klijent_problem" },
  { t: "klijent_problem", vrsta: "", opis: "x" },
  { t: "klijent_problem", vrsta: "a".repeat(500), opis: "b".repeat(5000) },
]) { ws.send(JSON.stringify(smece)); await cekaj(150); }
await cekaj(400);
proveri("prazna prijava se ne belezi", (await logovi()).length === 3, `zapisa: ${(await logovi()).length}`);
proveri("server je i dalje ziv", (await api("/api/settings")).cafeName != null);

// ---- mehanizam u launcheru ----
const main = citajIzvor("client/main.js");
proveri("launcher hvata pad ekrana", /render-process-gone/.test(main));
proveri("launcher hvata zamrznut ekran", /win\.on\("unresponsive"/.test(main));
proveri("prozor se sam vraca", /win\.reload\(\)/.test(main),
  "bez toga igrac gleda crn ekran dok radnik ne dodje");
proveri("uredno gasenje se ne prijavljuje kao kvar", /clean-exit/.test(main),
  "inace bi svaka odjava pravila laznu uzbunu");
proveri("kvar se javlja serveru", /klijent_problem/.test(main));

ws.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
