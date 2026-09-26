import { radniFolder, podigniServer, ucitajWebSocket } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Prvi dan u igraonici: koraci radnika redom, i sta se desi kad se negde omane.
// Najvaznije: sta biva sa novcem naplacenim pre otvaranja smene.
const PORT = 8193;
const BASE = `http://127.0.0.1:${PORT}`;
const WSB = `ws://127.0.0.1:${PORT}`;
const DATA = radniFolder("prvi-dan-data");
await podigniServer(DATA, PORT);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (a, b, e = 0.5) => Math.abs(a - b) < e;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

const pc = (await api("/api/computers"))[0];
const artikal = (await api("/api/shop"))[0];

// ---- KORAK 1: radnik pocinje da radi BEZ otvorene smene ----
const smena0 = await api("/api/shift");
proveri("na pocetku smena nije otvorena", !smena0 || smena0.error || !smena0.id, JSON.stringify(smena0).slice(0, 90));

await api("/api/players", "POST", { username: "prvi", password: "prvi1234", displayName: "Prvi gost" });
const gost = (await api("/api/players")).find((p) => p.username === "prvi");

const dopuna = await api(`/api/players/${gost.id}/topup`, "POST", { amount: 1000, note: "keš" });
proveri("dopuna prolazi i bez otvorene smene", !dopuna?.error, JSON.stringify(dopuna).slice(0, 100));

const racun = await api("/api/pos", "POST", { items: [{ id: artikal.id, qty: 1 }], payment: "cash" });
proveri("kasa radi i bez otvorene smene", !racun?.error, JSON.stringify(racun).slice(0, 100));

// ---- OVO JE SUSTINA: gde je taj novac? ----
// Ako se ne vidi nigde, radnik na kraju dana ima kes u kasi koji ne moze da
// objasni, a vlasnik pomisli da mu neko krade.
const izvestaj = (await api("/api/stats?period=today"))?.revenue || {};
proveri("novac naplacen pre smene se VIDI u izvestaju", blizu(izvestaj.topups || 0, 1000),
  `dopune ${izvestaj.topups} - inace radnik ima kes koji niko ne moze da objasni`);

// ---- PANEL MORA DA GA UPOZORI ----
// Novac je uredno zapisan, ali radnik to ne zna dok ne prebroji kasu i ne nadje
// visak koji obracun ne pominje.
// U kasi je i dopuna i kes za pice - oba su pravi novac koji je usao.
const ocekivano = 1000 + artikal.price;
const snap = await api("/api/snapshot");
proveri("server javlja koliko je naplaceno van smene", blizu(snap.vanSmene || 0, ocekivano),
  `vanSmene ${snap.vanSmene}, ocekivano ${ocekivano} (dopuna 1000 + keš za piće ${artikal.price})`);

const panel = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../server/public/js/app.js", import.meta.url), "utf8"));
proveri("upozorenje stoji na kontrolnoj tabli", /\$\{upozorenjeSmena\(\)\}/.test(panel));
proveri("upozorenje se ne javlja dok nema sta da javi", /if \(state\.shift \|\| !\(state\.vanSmene > 0\)\) return ""/.test(panel),
  "inace bi dosadjivalo svako jutro pre nego sto igraonica pocne da radi");
proveri("pise TACAN iznos, ne samo da nesto fali", /money\(state\.vanSmene\)/.test(panel));
proveri("pominje se i pri zatvaranju smene, gde se kasa broji",
  /Danas je \$\{money\(state\.vanSmene\)\} naplaćeno/.test(panel));
// Upozorenje nosi dugme koje otvara smenu. Ako tabla ne bi bila iscrtana
// iznova, upozorenje bi ostalo na ekranu i posle uspesnog otvaranja - izgleda
// kao da dugme nista nije uradilo.
proveri("dugme u upozorenju otvara smenu", /#upzSmena.*\)\) openShiftModal\(false\)/s.test(panel));
proveri("tabla se iscrtava iznova posle otvaranja smene",
  /updateShiftBar\(\); refreshView\(\["dashboard"\]\);/.test(panel));
proveri("i posle zatvaranja smene",
  /state\.shift = null; updateShiftBar\(\); refreshView\(\["dashboard"\]\)/.test(panel));

// ---- KORAK 2: radnik se seti i otvori smenu ----
const otvorena = await api("/api/shift/open", "POST", { openingCash: 3000 });
proveri("smena moze da se otvori i naknadno", !otvorena?.error, JSON.stringify(otvorena).slice(0, 100));

// Ono sto je naplaceno PRE otvaranja ne sme da udje u ovu smenu: radnik bi
// zavrsio sa viskom koji nije njegov.
const s1 = (await api("/api/shift"))?.totals || {};
proveri("raniji novac NE ulazi u tek otvorenu smenu", blizu(s1.topups || 0, 0),
  `dopune u smeni ${s1.topups} - smena mora da broji samo svoje`);

// ---- KORAK 3: dvaput otvorena smena ----
const opet = await api("/api/shift/open", "POST", { openingCash: 5000 });
proveri("druga smena se ne otvara preko prve", !!opet?.error,
  JSON.stringify(opet).slice(0, 120) + " - dve otvorene smene znace dva obracuna nad istim novcem");

// ---- KORAK 4: normalan rad u smeni ----
await api(`/api/players/${gost.id}/topup`, "POST", { amount: 2000, note: "keš" });
await api("/api/pos", "POST", { items: [{ id: artikal.id, qty: 2 }], payment: "cash" });
const s2 = (await api("/api/shift"))?.totals || {};
proveri("smena broji svoje dopune", blizu(s2.topups, 2000), `${s2.topups}`);

// ---- KORAK 5: racunar je zakljucan, radnik ga otklucava ----
const zakljucaj = await api(`/api/computers/${pc.id}/lock`, "POST", {});
proveri("racunar moze da se zakljuca iz panela", !zakljucaj?.error);
const otkljucaj = await api(`/api/computers/${pc.id}/unlock`, "POST", {});
proveri("i da se otkljuca", !otkljucaj?.error);

// ---- KORAK 6: gost bez naloga ----
// Prvog dana ce doci neko ko nema nalog. Mora da postoji brz put.
const gosti = await api("/api/players/guests", "POST", { count: 1 });
proveri("moze da se napravi gost nalog na brzinu", !gosti?.error, JSON.stringify(gosti).slice(0, 120));

// ---- KORAK 7: zatvaranje smene ----
const zatvorena = await api("/api/shift/close", "POST", { closingCash: 5000 });
proveri("smena moze da se zatvori", !zatvorena?.error, JSON.stringify(zatvorena).slice(0, 120));
const posle = await api("/api/shift");
proveri("posle zatvaranja nema otvorene smene", !posle || posle.error || !posle.id, JSON.stringify(posle).slice(0, 90));

// ---- KORAK 8: novac pre smene je i dalje u dnevnom izvestaju ----
const izvestaj2 = (await api("/api/stats?period=today"))?.revenue || {};
proveri("dnevni izvestaj broji SVE, i pre i u smeni", blizu(izvestaj2.topups || 0, 3000),
  `dopune ${izvestaj2.topups} (1000 pre smene + 2000 u smeni)`);

console.log(`\n${prosao}/${prosao + pao} proslo`);
await cekaj(400);
process.exit(pao ? 1 : 0);
