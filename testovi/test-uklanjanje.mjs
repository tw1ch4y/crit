import { radniFolder, podigniServer, ucitajWebSocket, brojac } from "./_okruzenje.mjs";
const WebSocket = await ucitajWebSocket();
// UKLANJANJE STVARI KOJE IMAJU ISTORIJU, I PROVERA ONOGA ŠTO SE KUCA
//
// Računar i artikal se ne mogu obrisati kao prazan red: na njih pokazuju sesije
// i porudžbine, a baza ima uključene strane ključeve. Dok se to nije gledalo,
// brisanje korišćenog računara i prodatog pića vraćalo je "Greška na serveru".
//
// Uz to: iznosi smene i PIN-ovi se proveravaju pre upisa. Tekst umesto broja je
// zatvarao smenu "bez razlike", a prazan PIN je otključavao računar praznim unosom.
const PORT = 8233;
const BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
await podigniServer(radniFolder("uklanjanje-data"), PORT);
const { proveri, kraj } = brojac();
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin" }) }).then((r) => r.json())).token;
const api = (p, m = "GET", b) => fetch(BASE + "/api" + p, { method: m,
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const comps = (await api("/computers")).body;
const [pc1, pc2, pc3] = comps;
await api("/players", "POST", { username: "marko", password: "marko1234", balance: 500 });

// ---- 1) RAČUNAR KOJI JE KORIŠĆEN ----
const veza = (tok) => {
  const w = new WebSocket(`${WSB}/ws?kind=client&token=${encodeURIComponent(tok)}&v=1.0.0&n=1`);
  const poruke = [];
  w.on("message", (b) => { try { poruke.push(JSON.parse(b.toString())); } catch {} });
  let zatvorena = false;
  w.on("close", () => { zatvorena = true; });
  return { w, poruke, zatvorena: () => zatvorena, otvorena: new Promise((res) => { w.once("open", () => res(true)); w.once("error", () => res(false)); }) };
};
const k1 = veza(pc1.token);
await k1.otvorena;
k1.w.send(JSON.stringify({ t: "login", username: "marko", password: "marko1234" }));
await cekaj(700);
let r = await api(`/computers/${pc1.id}`, "DELETE");
proveri("računar na kom neko igra se ne uklanja", r.status === 400 && /igra/.test(r.body?.error || ""), JSON.stringify(r.body));
k1.w.send(JSON.stringify({ t: "logout" }));
await cekaj(600);
const pre = (await api("/stats?period=today")).body;
r = await api(`/computers/${pc1.id}`, "DELETE");
proveri("korišćen računar se uklanja bez greške", r.status === 200 && r.body?.ugasen === true, JSON.stringify(r.body));
proveri("nestaje sa spiska", !(await api("/computers")).body.some((c) => c.id === pc1.id));
for (let i = 0; i < 20 && !k1.zatvorena(); i++) await cekaj(100);
proveri("njegova otvorena veza se zatvara", k1.zatvorena());
const k1b = veza(pc1.token);
const ponovo = await k1b.otvorena;
await cekaj(400);
proveri("stari token više ne prolazi", !ponovo || k1b.poruke.some((m) => m.t === "error") || k1b.zatvorena(), JSON.stringify(k1b.poruke));
const posle = (await api("/stats?period=today")).body;
proveri("istorija ostaje: broj sesija se ne menja", posle?.sessions?.count === pre?.sessions?.count && pre?.sessions?.count >= 1,
  `${pre?.sessions?.count} -> ${posle?.sessions?.count}`);
proveri("u izveštaju stoji pravo ime računara", (posle?.byComputer || []).some((x) => x.name === pc1.name),
  JSON.stringify(posle?.byComputer));
r = await api("/computers", "POST", { name: pc1.name });
proveri("ime se oslobađa za nov računar", r.status === 200, JSON.stringify(r.body));
r = await api(`/computers/${pc1.id}`, "DELETE");
proveri("uklonjen računar ne postoji za drugo uklanjanje", r.status === 404, JSON.stringify(r.body));

// ---- 2) RAČUNAR BEZ ISTORIJE SE BRIŠE SKROZ ----
r = await api(`/computers/${pc2.id}`, "DELETE");
proveri("nekorišćen računar se briše skroz", r.status === 200 && r.body?.ugasen === false, JSON.stringify(r.body));

// ---- 3) NEPOSTOJEĆ RAČUNAR ----
r = await api("/computers/999999/lock", "POST", {});
proveri("zaključavanje nepostojećeg računara je 404", r.status === 404, JSON.stringify(r.body));
r = await api(`/computers/${pc3.id}/message`, "POST", { text: "   " });
proveri("prazna poruka se ne šalje", r.status === 400);

// ---- 4) PRODAT ARTIKAL ----
r = await api("/shop", "POST", { name: "Probni sok", price: 99, category: "Pića" });
const sokId = r.body?.id;
const racun = await api("/pos", "POST", { items: [{ id: sokId, qty: 2 }], payment: "cash" });
proveri("artikal je prodat", racun.status === 200, JSON.stringify(racun.body));
r = await api(`/shop/${sokId}`, "DELETE");
proveri("prodat artikal se briše bez greške", r.status === 200, JSON.stringify(r.body));
const istorija = (await api("/orders?all=1")).body || [];
const nasa = istorija.find((o) => o.id === racun.body?.orderId);
proveri("stara porudžbina i dalje zna šta je prodato", nasa?.items?.some((i) => i.name === "Probni sok" && i.qty === 2),
  JSON.stringify(nasa));
r = await api(`/shop/${sokId}`, "DELETE");
proveri("drugo brisanje istog artikla je 404", r.status === 404);

// ---- 5) SMENA: IZNOSI SE PROVERAVAJU ----
r = await api("/shift/open", "POST", { openingCash: "sto" });
proveri("početno stanje kase mora biti broj", r.status === 400, JSON.stringify(r.body));
r = await api("/shift/open", "POST", { openingCash: -50 });
proveri("i ne sme biti negativno", r.status === 400);
r = await api("/shift/open", "POST", { openingCash: 1000 });
proveri("ispravna smena se otvara", r.status === 200);
r = await api("/shift/close", "POST", { closingCash: "hiljadu" });
proveri("zatvaranje sa tekstom umesto broja se odbija", r.status === 400, JSON.stringify(r.body));
proveri("i smena ostaje otvorena", !!(await api("/shift")).body?.id);
r = await api("/shift/close", "POST", { closingCash: 1000 });
proveri("ispravno zatvaranje prolazi", r.status === 200 && r.body?.summary?.difference === 0, JSON.stringify(r.body?.summary));

// ---- 6) PODEŠAVANJA ----
r = await api("/settings", "POST", { unlockPin: "" });
proveri("prazan PIN za otključavanje se odbija", r.status === 400, JSON.stringify(r.body));
r = await api("/settings", "POST", { unlockPin: "12a4" });
proveri("PIN sa slovom se odbija", r.status === 400);
r = await api("/settings", "POST", { unlockPin: "4821" });
proveri("ispravan PIN prolazi", r.status === 200 && r.body?.settings?.unlockPin === "4821");
r = await api("/settings", "POST", { servisniPin: "" });
proveri("prazan servisni PIN je dozvoljen (nije podešen)", r.status === 200);
r = await api("/settings", "POST", { servisniPin: "12" });
proveri("prekratak servisni PIN se odbija", r.status === 400);
r = await api("/settings", "POST", { cafeName: "   " });
proveri("prazan naziv igraonice se odbija", r.status === 400);
r = await api("/settings", "POST", { ratePerHour: 1e12 });
proveri("nemoguća cena po satu se odbija", r.status === 400);

// ---- 7) PROGRAMI ----
r = await api("/programs", "POST", { name: "Proba", url: "https://example.com/setup.exe" });
const progId = r.body?.id;
r = await api(`/programs/${progId}`, "PUT", { url: "" });
proveri("izmena ne može da isprazni link", r.status === 400, JSON.stringify(r.body));
r = await api(`/programs/${progId}`, "PUT", { url: "file:///C:/Windows/zlo.exe" });
proveri("izmena ne prima link koji nije http(s)", r.status === 400);
r = await api("/install", "POST", { name: "Zlo", url: "file:///C:/zlo.exe", ids: [pc3.id] });
proveri("daljinska instalacija ne prima link koji nije http(s)", r.status === 400, JSON.stringify(r.body));

for (const x of [k1, k1b]) { try { x.w.close(); } catch {} }
await kraj();
