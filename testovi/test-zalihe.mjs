import path from "node:path";
import { KOREN, radniFolder, podigniServer, ucitajWebSocket, citajIzvor } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// Zaliha koja se blizi kraju mora sama da se javi osoblju, jednom, i da stoji
// u pregledu dok se magacin ne dopuni.
const BASE = "http://127.0.0.1:8108", WSB = "ws://127.0.0.1:8108";
const DATA = radniFolder("zalihe-data");
await podigniServer(DATA, 8108);

let pao = 0, prosao = 0;
const proveri = (n, u, d = "") => { if (u) { prosao++; console.log("  OK   " + n); } else { pao++; console.log("  PAO  " + n + (d ? "  -> " + d : "")); } };
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } });

await api("/api/computers/bulk", "POST", { count: 2, prefix: "PC-" });
const napravi = async (ime, cena, zaliha) => {
  await api("/api/shop", "POST", { name: ime, category: "Test", price: cena, stock: zaliha });
  return (await api("/api/shop")).find((i) => i.name === ime);
};
const kola = await napravi("Test Kola", 100, 8);
const voda = await napravi("Test Voda", 80, 2);
const bezLimita = await napravi("Test Tocено", 90, "");

// panel slusa dogadjaje
const dogadjaji = [];
const panel = new WebSocket(`${WSB}/ws?kind=panel&token=${encodeURIComponent(token)}`);
panel.on("message", (b) => { try { const m = JSON.parse(b.toString()); if (m.t === "event") dogadjaji.push(m); } catch {} });
await new Promise((res, rej) => { panel.once("open", res); panel.once("error", rej); });
await cekaj(300);

// --- iznad praga: tisina ---
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 2 }], payment: "cash" });
await cekaj(400);
proveri("iznad praga se ne javlja", !dogadjaji.some((d) => d.kind === "zaliha"), JSON.stringify(dogadjaji.map((d) => d.text)));

// --- prelazak praga: javi jednom ---
dogadjaji.length = 0;
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 2 }], payment: "cash" }); // 6 -> 4
await cekaj(400);
const prvo = dogadjaji.filter((d) => d.kind === "zaliha");
proveri("prelazak praga javlja", prvo.length === 1 && /ostalo još 4/.test(prvo[0].text), JSON.stringify(prvo.map((d) => d.text)));
proveri("nije oznaceno kao prazno", prvo[0] && prvo[0].nema === false, JSON.stringify(prvo[0]));

// --- jos ispod praga: ne zvoni ponovo ---
dogadjaji.length = 0;
await api("/api/pos", "POST", { items: [{ id: kola.id, qty: 1 }], payment: "cash" }); // 4 -> 3
await cekaj(400);
proveri("ne javlja se ponovo dok je vec ispod praga", !dogadjaji.some((d) => d.kind === "zaliha"), JSON.stringify(dogadjaji.map((d) => d.text)));

// --- do nule: javi da nema ---
dogadjaji.length = 0;
await api("/api/pos", "POST", { items: [{ id: voda.id, qty: 2 }], payment: "cash" }); // 2 -> 0
await cekaj(400);
const prazno = dogadjaji.filter((d) => d.kind === "zaliha");
proveri("nula javlja da nema", prazno.length === 1 && prazno[0].nema === true, JSON.stringify(prazno.map((d) => d.text)));

// --- pregled za traku ---
const spisak = await api("/api/zalihe");
const imena = spisak.map((i) => i.name);
proveri("u pregledu su oba artikla", imena.includes("Test Kola") && imena.includes("Test Voda"), JSON.stringify(imena));
proveri("prazan je prvi u spisku", spisak[0].name === "Test Voda" && spisak[0].stock === 0, JSON.stringify(spisak[0]));
proveri("artikal bez limita se ne prijavljuje", !imena.includes(bezLimita.name), JSON.stringify(imena));

// --- dopuna sklanja iz pregleda ---
await api(`/api/shop/${voda.id}/stock`, "POST", { add: 24 });
const posle = (await api("/api/zalihe")).map((i) => i.name);
proveri("posle dopune izlazi iz pregleda", !posle.includes("Test Voda"), JSON.stringify(posle));

// --- sakriven artikal se ne prijavljuje ---
await api(`/api/shop/${kola.id}`, "PUT", { name: kola.name, category: kola.category, price: kola.price, emoji: "", available: false, stock: 3 });
const posle2 = (await api("/api/zalihe")).map((i) => i.name);
proveri("sakriven artikal se ne prijavljuje", !posle2.includes("Test Kola"), JSON.stringify(posle2));

// --- upisano u logove ---
const log = (await api("/api/logs?page=1&per=30&category=shop")).items || [];
proveri("prag upisan u logove", log.some((l) => /Zaliha pri kraju/.test(l.detail || "")), JSON.stringify(log.slice(0, 2).map((l) => l.detail)));
proveri("rasprodato upisano u logove", log.some((l) => /rasprodat/i.test(l.detail || "")), JSON.stringify(log.slice(0, 3).map((l) => l.detail)));

// --- porudzbina sa klijenta takodje javlja ---
dogadjaji.length = 0;
await api("/api/players", "POST", { username: "marko", password: "test1234", balance: 900 });
const cips = await napravi("Test Cips", 100, 6);
const comps = await api("/api/computers");
const ws = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(comps[0].token)}`);
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
ws.send(JSON.stringify({ t: "login", username: "marko", password: "test1234" }));
await cekaj(600);
ws.send(JSON.stringify({ t: "order", items: [{ id: cips.id, qty: 2 }], payment: "credit" }));
await cekaj(700);
proveri("porudzbina igraca takodje javlja zalihu",
  dogadjaji.some((d) => d.kind === "zaliha" && /Test Cips/.test(d.text)), JSON.stringify(dogadjaji.map((d) => d.text)));

ws.close(); panel.close();
console.log(`\n${prosao}/${prosao + pao} proslo`);
process.exit(pao ? 1 : 0);
