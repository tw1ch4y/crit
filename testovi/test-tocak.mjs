import { radniFolder, podigniServer, ucitajWebSocket, citajIzvor, KOREN } from "./_okruzenje.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const WebSocket = await ucitajWebSocket();
// Nagradni točak: jednom nedeljno, ko je za nedelju dana potrošio dovoljno može
// da zavrti i osvoji kredit. Ishod BIRA server (težinski) - klijent samo animira.
// Ovde se gleda: prag, jednom nedeljno, težine rade, i da poklon-kredit NE uđe
// u pazar (nije novac u kasi).
const BASE = "http://127.0.0.1:8137", WSB = "ws://127.0.0.1:8137";
const DATA = radniFolder("tocak-data");
await podigniServer(DATA, 8137);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const blizu = (a, b) => Math.abs(a - b) < 0.5;

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

// ---- raspodela: težine stvarno rade (čista funkcija) ----
const svc = await import(pathToFileURL(path.join(KOREN, "server", "src", "service.js")).href);
const nagrade = [{ naziv: "A", tezina: 1 }, { naziv: "B", tezina: 4 }, { naziv: "C", tezina: 5 }];
const broj = [0, 0, 0];
for (let i = 0; i < 10000; i++) broj[svc.izaberiNagradu(nagrade)]++;
proveri("težina 5 pada češće od težine 1", broj[2] > broj[0] * 3, JSON.stringify(broj));
proveri("sva polja padnu bar ponekad", broj.every((b) => b > 0), JSON.stringify(broj));

// ---- podešavanje (vlasnik) ----
proveri("podrazumevano je isključen", (await api("/api/tocak")).ukljucen === false);
proveri("podrazumevani prag je 1200", (await api("/api/tocak")).prag === 1200);
proveri("ima podrazumevane nagrade", (await api("/api/tocak")).nagrade.length >= 4);
const nn = await api("/api/tocak/nagrade", "POST", { naziv: "1000 din", kredit: 1000, tezina: 1 });
proveri("dodavanje nagrade radi", nn.ok);
proveri("izmena nagrade radi", (await api(`/api/tocak/nagrade/${nn.id}`, "PUT", { naziv: "1000 din", kredit: 1000, tezina: 2 })).ok);
proveri("brisanje nagrade radi", (await api(`/api/tocak/nagrade/${nn.id}`, "DELETE")).ok);
proveri("nagrada bez naziva se odbija", (await api("/api/tocak/nagrade", "POST", { naziv: "", kredit: 10, tezina: 1 })).error != null);
proveri("nagrada sa težinom 0 se odbija", (await api("/api/tocak/nagrade", "POST", { naziv: "X", kredit: 10, tezina: 0 })).error != null);
proveri("negativan prag se odbija", (await api("/api/tocak", "POST", { prag: -5 })).error != null);

// upali točak, spusti prag na 100 radi lakšeg testa, nagrade = jedna fiksna od 200
for (const nag of (await api("/api/tocak")).nagrade) await api(`/api/tocak/nagrade/${nag.id}`, "DELETE");
const dobitna = await api("/api/tocak/nagrade", "POST", { naziv: "200 din", kredit: 200, tezina: 1 });
await api("/api/tocak", "POST", { ukljucen: true, prag: 100 });

// ---- igrač i potrošnja ----
const marko = await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 2000 });
const comp = (await api("/api/computers"))[0];

// klijent koji se prijavljuje i sluša
const spoji = () => new Promise((res) => {
  const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comp.token)}&v=test`);
  const poruke = [];
  w.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
  w.once("open", () => res({ w, poruke }));
});
const zadnja = (poruke, t) => [...poruke].reverse().find((m) => m.t === t);

let k = await spoji();
k.w.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(500);
let lo = zadnja(k.poruke, "login_ok");
proveri("login šalje stanje točka", lo && lo.tocak, JSON.stringify(lo?.tocak));
proveri("bez potrošnje ne ispunjava prag", lo.tocak.ispunjava === false && lo.tocak.moze === false, JSON.stringify(lo.tocak));

// pokušaj spina bez prava -> greška
k.w.send(JSON.stringify({ t: "tocak_spin" }));
await cekaj(400);
proveri("spin bez potrošnje se odbija", !!zadnja(k.poruke, "tocak_err"), JSON.stringify(zadnja(k.poruke, "tocak_err")));

// napravi potrošnju: kredit porudžbina od 100+ (shop transakcija = potrošnja)
const shop = await api("/api/shop");
await api("/api/pos", "POST", { items: [{ id: shop[0].id, qty: 1 }], playerId: marko.id, payment: "credit" }); // 130
await api("/api/pos", "POST", { items: [{ id: shop[0].id, qty: 1 }], playerId: marko.id, payment: "credit" }); // još 130 = 260 > 100

// ponovo se prijavi da dobije svež tocak info
k.w.close(); await cekaj(200);
k = await spoji();
k.w.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(500);
lo = zadnja(k.poruke, "login_ok");
proveri("posle potrošnje ispunjava prag", lo.tocak.ispunjava === true && lo.tocak.moze === true, JSON.stringify(lo.tocak));

const balPre = (await api(`/api/players?page=1&per=5&search=marko`)).items[0].balance;
k.w.send(JSON.stringify({ t: "tocak_spin" }));
await cekaj(500);
const rez = zadnja(k.poruke, "tocak_rezultat");
proveri("spin vraća rezultat sa indeksom i nagradom", rez && typeof rez.index === "number" && rez.nagrada, JSON.stringify(rez));
proveri("osvojeni kredit (200) je dodat na stanje", blizu(rez.balance, balPre + 200), `${balPre} -> ${rez.balance}`);

// drugi spin iste nedelje -> odbijen
k.w.send(JSON.stringify({ t: "tocak_spin" }));
await cekaj(400);
proveri("drugi spin iste nedelje se odbija", !!zadnja(k.poruke, "tocak_err"));

// ---- računovodstvo: poklon-kredit NIJE novac u kasi ----
const tx = await api(`/api/players/${marko.id}/transactions`);
proveri("dobitak je zaveden kao bonus", tx.some((t) => t.type === "bonus" && blizu(t.amount, 200)), JSON.stringify(tx.slice(0, 3)));
const s = await api("/api/stats?period=today");
// Dopune = početni kredit (2000). Dobitak sa točka (200) je bonus, pa dopune
// ostaju 2000 - da su ušle, bilo bi 2200. Tako se poklon ne broji kao promet.
proveri("dobitak sa točka NE ulazi u dopune (promet)", blizu(s.revenue.topups, 2000), String(s.revenue.topups));

k.w.close();

// ---- isključen točak ne vrti ----
await api("/api/tocak", "POST", { ukljucen: false });
let k2 = await spoji();
k2.w.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(400);
k2.w.send(JSON.stringify({ t: "tocak_spin" }));
await cekaj(400);
proveri("isključen točak ne vrti", !!zadnja(k2.poruke, "tocak_err"));
k2.w.close();

// ---- izvor: launcher i panel ----
const launcher = citajIzvor("client/renderer/js/launcher.js");
const app = citajIzvor("server/public/js/app.js");
proveri("launcher šalje spin", launcher.includes('t: "tocak_spin"') || launcher.includes("tocak_spin"));
proveri("launcher prikazuje točak", launcher.includes("tocak") || launcher.includes("Točak"));
proveri("panel podešava točak", app.includes("/tocak"));

proveri("server živ posle svega", Array.isArray(await api("/api/computers")));

console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
