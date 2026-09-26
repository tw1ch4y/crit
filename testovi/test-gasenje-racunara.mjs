import { radniFolder, podigniServer, ucitajWebSocket, panelKlijent, brojac } from "./_okruzenje.mjs";
// Gašenje računara iz panela i računar koji nestane dok neko igra.
//
//  1. "Ugasi" i "Ugasi sve (kraj smene)" zatvaraju sesiju pre komande. Inače
//     sesija ostaje otvorena preko noći i nastavlja se, sa naplatom, čim se
//     računar ujutru upali.
//  2. Restart zadržava sesiju - računar se vraća za minut.
//  3. Računar sa igračem koji se ne vrati na vezu javlja se osoblju. Rok je ovde
//     skraćen na sekundu i po (BEZ_VEZE_MS); u igraonici je minut.
process.env.BEZ_VEZE_MS = "1500";
const WebSocket = await ucitajWebSocket();
const PORT = 8241;
const BASE = `http://127.0.0.1:${PORT}`;
const WSB = `ws://127.0.0.1:${PORT}`;
await podigniServer(radniFolder("gasenje-racunara"), PORT);

const { proveri, kraj } = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const api = await panelKlijent(BASE);

// Panel koji sluša događaje, kao pravi panel osoblja.
const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const dogadjaji = [];
const panel = new WebSocket(`${WSB}/ws?kind=panel&token=${token}`);
panel.on("message", (b) => { try { const m = JSON.parse(String(b)); if (m.t === "event") dogadjaji.push(m); } catch {} });
await new Promise((r) => panel.on("open", r));

await api("/api/settings", "POST", { ratePerHour: 120 });
for (const ime of ["ana", "boki", "ceca"]) {
  await api("/api/players", "POST", { username: ime, password: ime + "1234", displayName: ime });
  const p = (await api("/api/players")).body.find((x) => x.username === ime);
  await api(`/api/players/${p.id}/topup`, "POST", { amount: 1000, note: "keš" });
}
const racunari = (await api("/api/computers")).body;
const stanje = async (id) => (await api("/api/snapshot")).body.computers.find((c) => c.id === id);

// Lažni launcher: pamti sve što mu server pošalje.
async function launcher(pc, igrac) {
  const primljeno = [];
  const ws = new WebSocket(`${WSB}/ws?kind=client&token=${pc.token}&v=proba`);
  ws.on("message", (b) => { try { primljeno.push(JSON.parse(String(b))); } catch {} });
  await new Promise((r) => ws.on("open", r));
  await cekaj(300);
  if (igrac) {
    ws.send(JSON.stringify({ t: "login", username: igrac, password: igrac + "1234" }));
    await cekaj(900);
  }
  return { ws, primljeno };
}

// ---- 1) Ugasi: sesija se zatvara pre komande ----
const pc1 = racunari[0];
const l1 = await launcher(pc1, "ana");
proveri("ana igra na prvom računaru", (await stanje(pc1.id)).player?.username === "ana");
const r1 = await api(`/api/computers/${pc1.id}/command`, "POST", { cmd: "shutdown" });
await cekaj(500);
proveri("komanda za gašenje je prihvaćena", r1.status === 200, JSON.stringify(r1.body));
proveri("gašenje zatvara sesiju", !(await stanje(pc1.id)).player,
  "otvorena sesija bi se nastavila i naplaćivala kad se računar ujutru upali");
const i1 = l1.primljeno.findIndex((m) => m.t === "to_login");
const i2 = l1.primljeno.findIndex((m) => m.t === "command" && m.cmd === "shutdown");
proveri("launcher prvo dobija kraj sesije, pa komandu", i1 >= 0 && i2 > i1,
  l1.primljeno.map((m) => m.t).join(","));

// ---- 2) Restart zadržava sesiju ----
const pc2 = racunari[1];
const l2 = await launcher(pc2, "boki");
await api(`/api/computers/${pc2.id}/command`, "POST", { cmd: "restart" });
await cekaj(500);
proveri("restart ne zatvara sesiju", (await stanje(pc2.id)).player?.username === "boki",
  "računar se vraća za minut i igrač nastavlja");
proveri("launcher dobija komandu za restart", l2.primljeno.some((m) => m.t === "command" && m.cmd === "restart"));

// ---- 3) Kraj smene: grupno gašenje zatvara sve sesije ----
const pc3 = racunari[2];
const l3 = await launcher(pc3, "ceca");
const grupno = await api("/api/computers-action", "POST", { ids: [pc2.id, pc3.id], action: "shutdown" });
await cekaj(500);
proveri("grupno gašenje je poslato", grupno.body?.sent === 2, JSON.stringify(grupno.body));
proveri("grupno gašenje zatvara sesije", !(await stanje(pc2.id)).player && !(await stanje(pc3.id)).player);

// ---- 4) Računar koji nije na vezi ne prima komandu ----
try { l1.ws.terminate(); } catch {}
await cekaj(400);
const r4 = await api(`/api/computers/${pc1.id}/command`, "POST", { cmd: "shutdown" });
proveri("računar van mreže ne prima komandu", r4.status === 400, JSON.stringify(r4.body));

// ---- 5) Nestanak dok neko igra ----
try { l2.ws.terminate(); } catch {}
try { l3.ws.terminate(); } catch {}
await cekaj(400);
const l5 = await launcher(pc1, "ana");
proveri("ana ponovo igra", (await stanje(pc1.id)).player?.username === "ana");
dogadjaji.length = 0;
l5.ws.terminate();
await cekaj(700);
proveri("pre roka nema upozorenja", !dogadjaji.some((m) => m.kind === "bez-veze"));
proveri("panel pokazuje da je sesija i dalje otvorena", (await stanje(pc1.id)).player?.username === "ana"
  && (await stanje(pc1.id)).online === false);
await cekaj(1600);
const upozorenje = dogadjaji.find((m) => m.kind === "bez-veze");
proveri("osoblje dobija upozorenje kad se računar ne vrati", !!upozorenje, JSON.stringify(dogadjaji));
proveri("upozorenje kaže koji računar i ko igra",
  !!upozorenje && upozorenje.text.includes(pc1.name) && upozorenje.text.includes("ana"), upozorenje?.text);
const logovi = (await api("/api/logs?category=racunar")).body;
const lista = Array.isArray(logovi) ? logovi : (logovi?.logs || logovi?.items || []);
proveri("upozorenje ostaje u Logovima", lista.some((l) => l.action === "bez_veze"), JSON.stringify(logovi).slice(0, 200));

// ---- 6) Računar koji se vrati na vreme se ne prijavljuje ----
const l6 = await launcher(pc1);
await cekaj(500);
dogadjaji.length = 0;
l6.ws.terminate();
await cekaj(500);
const l7 = await launcher(pc1);
await cekaj(1800);
proveri("povratak u roku ne diže uzbunu", !dogadjaji.some((m) => m.kind === "bez-veze"), JSON.stringify(dogadjaji));

// ---- 7) Prazan računar koji nestane nije vest ----
await api(`/api/computers/${pc1.id}/logout`, "POST");
await cekaj(300);
dogadjaji.length = 0;
l7.ws.terminate();
await cekaj(2200);
proveri("prazan računar bez veze ne diže uzbunu", !dogadjaji.some((m) => m.kind === "bez-veze"), JSON.stringify(dogadjaji));

try { panel.close(); } catch {}
await kraj();
